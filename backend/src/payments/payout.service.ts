import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { NotchPayService, WITHDRAWAL_METHOD_TO_NOTCHPAY } from './notchpay.service';
import { EdoctorPaymentService } from './edoctor-payment.service';
import { SettingsService } from '../settings/settings.service';

@Injectable()
export class PayoutService {
  private readonly logger = new Logger(PayoutService.name);

  constructor(
    private prisma: PrismaService,
    private notchpay: NotchPayService,
    private edoctor: EdoctorPaymentService,
    private settings: SettingsService,
  ) {}

  /**
   * Assure l'existence du DriverEarningsWallet pour un chauffeur.
   * Idempotent — appelable à chaque fin de course.
   */
  async ensureWallet(driverProfileId: string) {
    return this.prisma.driverEarningsWallet.upsert({
      where:  { driverProfileId },
      create: { driverProfileId, balance: 0, pendingBalance: 0, currency: 'XAF' },
      update: {},
    });
  }

  /**
   * Crédite le DriverEarningsWallet après une course terminée.
   * Crée le BookingPayout et met à jour le solde atomiquement.
   *
   * @param isCash - true si le passager a payé en espèces (chauffeur détient les fonds)
   */
  async creditFromRide(params: {
    bookingId: string;
    driverProfileId: string;
    grossAmount: number;  // prix total de la course (XAF)
    isCash: boolean;
    tipAmount?: number;
  }): Promise<void> {
    const { bookingId, driverProfileId, grossAmount, isCash } = params;
    const tipAmount = params.tipAmount ?? 0;

    // Lire les paramètres financiers dynamiquement
    const commissionRaw    = await this.settings.get('commission_rate_pct', '15');
    const vipCommissionRaw = await this.settings.get('commission_rate_vip_pct', '25');
    const providerFeeRaw   = await this.settings.get('payment_provider_fee_pct', '2');

    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      select: { vehicleType: true },
    });
    const isVip = booking?.vehicleType === 'VIP';

    const commissionRate    = (isVip ? parseFloat(vipCommissionRaw) : parseFloat(commissionRaw)) / 100;
    const providerFeeRate   = isCash ? 0 : parseFloat(providerFeeRaw) / 100;
    const commissionAmount  = Math.round(grossAmount * commissionRate * 100) / 100;
    const providerFeeAmount = Math.round(grossAmount * providerFeeRate * 100) / 100;
    const netAmount         = grossAmount - commissionAmount - providerFeeAmount + tipAmount;

    // Vérifier idempotence — un payout par booking
    const existing = await this.prisma.bookingPayout.findUnique({ where: { bookingId } });
    if (existing) {
      this.logger.warn(`BookingPayout déjà existant pour booking ${bookingId}`);
      return;
    }

    // Transaction atomique : créer BookingPayout + incrémenter wallet
    await this.prisma.$transaction(async (tx) => {
      await tx.bookingPayout.create({
        data: {
          bookingId,
          driverProfileId,
          grossAmount,
          commissionRate,
          commissionAmount,
          providerFeeRate,
          providerFeeAmount,
          netAmount,
          tipAmount,
          currency:  'XAF',
          isCash,
          status:    isCash ? 'pending' : 'pending',
        },
      });

      await this.ensureWalletTx(tx, driverProfileId);

      // Pour les courses non-cash : créditer directement en balance disponible
      // Pour les courses cash   : créditer en pendingBalance (à confirmer quand commission récupérée)
      if (isCash) {
        // On enregistre la dette de commission (le chauffeur doit rembourser commissionAmount à AeroCab)
        await tx.driverProfile.update({
          where: { id: driverProfileId },
          data:  { cashCommissionDebt: { increment: commissionAmount } },
        });
      } else {
        await tx.driverEarningsWallet.update({
          where: { driverProfileId },
          data: {
            balance:      { increment: netAmount },
            totalEarned:  { increment: netAmount },
          },
        });
      }
    });

    this.logger.log(
      `Payout créé: booking=${bookingId} driver=${driverProfileId} net=${netAmount} XAF (cash=${isCash})`,
    );
  }

  /**
   * Lance un virement vers le compte Mobile Money du chauffeur.
   * Vérifie la dette de commission cash avant de permettre le retrait.
   */
  async disburse(params: {
    driverProfileId: string;
    amount: number;
    initiatedByAdminId?: string;
  }): Promise<{ reference: string }> {
    const { driverProfileId, amount } = params;

    const profile = await this.prisma.driverProfile.findUnique({
      where:  { id: driverProfileId },
      select: {
        payoutPhone: true, payoutMethod: true, payoutName: true, payoutVerified: true,
        cashCommissionDebt: true, cashDepositBalance: true,
        earningsWallet: true,
      },
    });
    if (!profile) throw new NotFoundException('Profil chauffeur introuvable');
    if (!profile.payoutPhone || !profile.payoutMethod) {
      throw new BadRequestException('Compte de virement non configuré');
    }
    if (!profile.payoutVerified) {
      throw new BadRequestException('Compte de virement non vérifié');
    }

    // Vérifier la dette de commission cash
    if (profile.cashCommissionDebt > 0) {
      const minDebt = parseFloat(
        await this.settings.get('cash_commission_min_debt_block', '1000'),
      );
      if (profile.cashCommissionDebt >= minDebt) {
        throw new BadRequestException(
          `Retrait bloqué : dette de commission cash de ${profile.cashCommissionDebt} XAF à régulariser`,
        );
      }
    }

    const wallet = profile.earningsWallet;
    if (!wallet || wallet.balance < amount) {
      throw new BadRequestException(
        `Solde insuffisant (disponible: ${wallet?.balance ?? 0} XAF)`,
      );
    }

    const minWithdrawal = parseFloat(await this.settings.get('min_withdrawal_amount', '5000'));
    if (amount < minWithdrawal) {
      throw new BadRequestException(`Montant minimum de retrait: ${minWithdrawal} XAF`);
    }

    const channel = WITHDRAWAL_METHOD_TO_NOTCHPAY[profile.payoutMethod];
    if (!channel) throw new BadRequestException(`Méthode de paiement non supportée: ${profile.payoutMethod}`);

    const reference = `PAYOUT-${driverProfileId.slice(0, 8)}-${Date.now()}`;

    // Débit atomique du wallet avant le virement
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.driverEarningsWallet.updateMany({
        where: { driverProfileId, balance: { gte: amount } },
        data:  { balance: { decrement: amount }, totalWithdrawn: { increment: amount } },
      });
      if (updated.count === 0) throw new BadRequestException('Solde insuffisant (race condition)');
    });

    // Routage vers EdoctorPay si configuré et activé, sinon NotchPay
    const useEdoctor = await this.edoctor.isConfigured() &&
      (await this.settings.get('payment_edoctor_enabled', 'false')) === 'true';

    let transferId: string;
    let transferStatus: string;

    if (useEdoctor) {
      const isMtn = profile.payoutMethod === 'mtn_momo';
      const result = isMtn
        ? await this.edoctor.withdrawMtn({ amount, phone: profile.payoutPhone, reference })
        : await this.edoctor.withdrawOrange({ amount, phone: profile.payoutPhone, reference });
      transferId     = result.id;
      transferStatus = result.status;
    } else {
      if (!channel) throw new BadRequestException(`Méthode de paiement non supportée: ${profile.payoutMethod}`);
      const result = await this.notchpay.transfer({
        reference,
        amount,
        currency:        'XAF',
        beneficiaryName:  profile.payoutName ?? '',
        beneficiaryPhone: profile.payoutPhone,
        channel,
        description:     `Virement AeroCab — ${reference}`,
      });
      transferId     = result.id;
      transferStatus = result.status;
    }

    this.logger.log(`Virement initié: ref=${reference} id=${transferId} status=${transferStatus} via=${useEdoctor ? 'edoctor' : 'notchpay'}`);

    // Mettre à jour le BookingPayout ou créer un enregistrement de retrait séparé
    // (le retrait peut couvrir plusieurs courses → pas de lien 1:1)

    return { reference };
  }

  /** Retourne le solde du DriverEarningsWallet. */
  async getBalance(driverProfileId: string): Promise<{
    balance: number;
    pendingBalance: number;
    totalEarned: number;
    totalWithdrawn: number;
    currency: string;
    cashCommissionDebt: number;
  }> {
    const wallet = await this.prisma.driverEarningsWallet.findUnique({ where: { driverProfileId } });
    const profile = await this.prisma.driverProfile.findUnique({
      where:  { id: driverProfileId },
      select: { cashCommissionDebt: true },
    });

    return {
      balance:            wallet?.balance            ?? 0,
      pendingBalance:     wallet?.pendingBalance      ?? 0,
      totalEarned:        wallet?.totalEarned         ?? 0,
      totalWithdrawn:     wallet?.totalWithdrawn      ?? 0,
      currency:           wallet?.currency            ?? 'XAF',
      cashCommissionDebt: profile?.cashCommissionDebt ?? 0,
    };
  }

  private async ensureWalletTx(tx: any, driverProfileId: string) {
    await tx.driverEarningsWallet.upsert({
      where:  { driverProfileId },
      create: { driverProfileId, balance: 0, pendingBalance: 0, currency: 'XAF' },
      update: {},
    });
  }
}
