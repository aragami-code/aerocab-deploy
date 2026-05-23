import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { SettingsService } from '../settings/settings.service';

/**
 * Gère la récupération de la commission AeroCab sur les courses payées en espèces.
 *
 * Principe (Section 5 CDC + décision architecture) :
 * - Le chauffeur collecte directement le cash du passager.
 * - AeroCab retient 50% des frais d'inscription comme dépôt de garantie.
 * - À chaque course cash : cashCommissionDebt += commissionAmount.
 * - Le chauffeur déduit sa dette de son cashDepositBalance ou via son DriverEarningsWallet.
 * - Si cashCommissionDebt >= seuil configurable → cashRidesAllowed = false (blocage).
 */
@Injectable()
export class CashCommissionService {
  private readonly logger = new Logger(CashCommissionService.name);

  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
  ) {}

  /**
   * Enregistre la dette de commission cash après une course.
   * Tente de la déduire du cashDepositBalance en priorité.
   */
  async recordDebt(driverProfileId: string, commissionAmount: number): Promise<void> {
    const profile = await this.prisma.driverProfile.findUnique({
      where:  { id: driverProfileId },
      select: { cashDepositBalance: true, cashCommissionDebt: true, cashRidesAllowed: true },
    });
    if (!profile) return;

    let remainingDebt = commissionAmount;
    const depositUpdate: any = {};

    // Déduire du dépôt de garantie si disponible
    if (profile.cashDepositBalance > 0) {
      const deducted = Math.min(profile.cashDepositBalance, commissionAmount);
      remainingDebt -= deducted;
      depositUpdate.cashDepositBalance = { decrement: deducted };
    }

    const newDebt = profile.cashCommissionDebt + remainingDebt;

    // Vérifier le seuil de blocage
    const blockThresholdRaw = await this.settings.get('cash_commission_block_threshold', '10000');
    const blockThreshold    = parseFloat(blockThresholdRaw);
    const shouldBlock       = newDebt >= blockThreshold;

    await this.prisma.driverProfile.update({
      where: { id: driverProfileId },
      data: {
        cashCommissionDebt: { increment: remainingDebt },
        cashRidesAllowed:   shouldBlock ? false : true,
        ...depositUpdate,
      },
    });

    if (shouldBlock) {
      this.logger.warn(
        `Chauffeur ${driverProfileId} bloqué: dette commission cash ${newDebt} XAF >= seuil ${blockThreshold}`,
      );
    }

    this.logger.log(
      `Debt cash enregistrée: driver=${driverProfileId} commission=${commissionAmount} restant=${remainingDebt} total_debt=${newDebt}`,
    );
  }

  /**
   * Régularise la dette de commission cash (paiement volontaire du chauffeur
   * ou déduction automatique depuis le DriverEarningsWallet lors d'un retrait).
   */
  async settleDebt(driverProfileId: string, amount: number): Promise<void> {
    const profile = await this.prisma.driverProfile.findUnique({
      where:  { id: driverProfileId },
      select: { cashCommissionDebt: true },
    });
    if (!profile) return;

    const settled = Math.min(amount, profile.cashCommissionDebt);
    if (settled <= 0) return;

    const newDebt = profile.cashCommissionDebt - settled;
    const blockThresholdRaw = await this.settings.get('cash_commission_block_threshold', '10000');
    const blockThreshold    = parseFloat(blockThresholdRaw);

    await this.prisma.driverProfile.update({
      where: { id: driverProfileId },
      data: {
        cashCommissionDebt: { decrement: settled },
        cashRidesAllowed:   newDebt < blockThreshold,
      },
    });

    this.logger.log(`Dette cash régularisée: driver=${driverProfileId} settled=${settled} remaining=${newDebt}`);
  }

  /**
   * Alimente le cashDepositBalance lors du paiement des frais d'inscription.
   * 50% du montant va en dépôt de garantie pour la commission cash.
   */
  async creditDeposit(driverProfileId: string, registrationFeeAmount: number): Promise<void> {
    const depositPctRaw = await this.settings.get('registration_fee_deposit_pct', '50');
    const depositPct    = parseFloat(depositPctRaw) / 100;
    const depositAmount = Math.round(registrationFeeAmount * depositPct * 100) / 100;

    await this.prisma.driverProfile.update({
      where: { id: driverProfileId },
      data:  { cashDepositBalance: { increment: depositAmount } },
    });

    this.logger.log(`Dépôt garantie crédité: driver=${driverProfileId} montant=${depositAmount} XAF`);
  }

  async getStatus(driverProfileId: string): Promise<{
    cashCommissionDebt: number;
    cashDepositBalance: number;
    cashRidesAllowed: boolean;
    blockThreshold: number;
  }> {
    const profile = await this.prisma.driverProfile.findUnique({
      where:  { id: driverProfileId },
      select: { cashCommissionDebt: true, cashDepositBalance: true, cashRidesAllowed: true },
    });
    const blockThresholdRaw = await this.settings.get('cash_commission_block_threshold', '10000');

    return {
      cashCommissionDebt: profile?.cashCommissionDebt ?? 0,
      cashDepositBalance: profile?.cashDepositBalance ?? 0,
      cashRidesAllowed:   profile?.cashRidesAllowed   ?? true,
      blockThreshold:     parseFloat(blockThresholdRaw),
    };
  }
}
