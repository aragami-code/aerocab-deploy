import { Controller, Post, Get, Body, Logger, UseGuards, Request, Query } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PrismaService } from '../database/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { JwtAuthGuard, RolesGuard } from '../auth/guards';
import { Roles } from '../auth/decorators';

const ACCESS_DURATION_MS = 48 * 60 * 60 * 1000;

/**
 * Taux de change par rapport au FCFA (XAF).
 * 1 XAF = X <currency>
 * Ces taux sont une approximation ; pour la production on pourrait appeler une API.
 */
const EXCHANGE_RATES: Record<string, number> = {
  XAF: 1,
  USD: 0.00165,   // 1 USD ≈ 606 XAF
  EUR: 0.00152,   // 1 EUR ≈ 656 XAF
  GBP: 0.00130,   // 1 GBP ≈ 769 XAF
  CAD: 0.00224,   // 1 CAD ≈ 446 XAF
  CHF: 0.00152,   // 1 CHF ≈ 656 XAF
  NGN: 2.50,      // 1 NGN ≈ 0.40 XAF
  GHS: 0.020,     // 1 GHS ≈ 50 XAF
  MAD: 0.0165,    // 1 MAD ≈ 60 XAF
  DZD: 0.224,     // 1 DZD ≈ 4.5 XAF
  CNY: 0.012,     // 1 CNY ≈ 83 XAF
  JPY: 0.25,      // 1 JPY ≈ 4 XAF
};

/** Symboles des devises */
const CURRENCY_SYMBOLS: Record<string, string> = {
  XAF: 'FCFA', USD: '$', EUR: '€', GBP: '£', CAD: 'CA$',
  CHF: 'CHF', NGN: '₦', GHS: '₵', MAD: 'DH', DZD: 'DA', CNY: '¥', JPY: '¥',
};

/** Convertit un montant FCFA vers une devise cible */
function convertFromFcfa(amountFcfa: number, currency: string): number {
  const rate = EXCHANGE_RATES[currency] ?? EXCHANGE_RATES['USD'];
  const converted = amountFcfa * rate;
  // Arrondi propre selon la devise
  if (['JPY', 'NGN', 'DZD'].includes(currency)) return Math.round(converted);
  if (['XAF'].includes(currency)) return Math.round(converted);
  return Math.round(converted * 100) / 100; // 2 décimales
}

@Controller('payments')
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  constructor(
    private payments: PaymentsService,
    private prisma: PrismaService,
    private settings: SettingsService,
  ) {}

  /**
   * GET /payments/wallet?currency=USD
   * Retourne le solde en points + la liste des forfaits avec prix dans la devise demandée.
   */
  @Get('wallet')
  @UseGuards(JwtAuthGuard)
  async getWallet(@Request() req: any, @Query('currency') currency = 'XAF') {
    const userId = req.user.id;
    const targetCurrency = (EXCHANGE_RATES[currency] ? currency : 'XAF').toUpperCase();

    let wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) {
      wallet = await this.prisma.wallet.create({ data: { userId, balance: 0 } });
    }

    const tariffs = await this.settings.getTariffs();
    const fcfaPerPoint = tariffs.fcfaPerPoint;

    // Fetch recent transactions
    const transactions = await this.prisma.transaction.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    // Forfaits : tailles fixes, prix calculé depuis fcfaPerPoint + conversion devise
    const packageSizes = [1000, 3000, 5000, 10000];
    const labelMap: Record<number, string> = { 1000: 'Standard', 3000: 'Pack Argent', 5000: 'Pack Or', 10000: 'VIP Rewards' };
    const packages = packageSizes.map((points) => {
      const amountFcfa = points * fcfaPerPoint;
      const amountLocal = convertFromFcfa(amountFcfa, targetCurrency);
      return {
        id: `pack_${points}`,
        points,
        amountFcfa,
        amountLocal,
        currency: targetCurrency,
        symbol: CURRENCY_SYMBOLS[targetCurrency] ?? targetCurrency,
        label: labelMap[points] ?? `${points} pts`,
      };
    });

    return {
      balance: Math.floor(wallet.balance),
      packages,
      transactions,
      fcfaPerPoint,
      currency: targetCurrency,
      symbol: CURRENCY_SYMBOLS[targetCurrency] ?? targetCurrency,
    };
  }

  /**
   * POST /payments/recharge
   * Lance un paiement CinetPay pour acheter un forfait de points.
   * Body: { packageId: 'pack_50' | 'pack_100' | 'pack_200' | 'pack_500' }
   */
  @Post('recharge')
  @UseGuards(JwtAuthGuard)
  async recharge(@Request() req: any, @Body() body: { packageId: string; customAmount?: number }) {
    const userId = req.user.id;

    // Résoudre le forfait depuis l'ID ou utiliser le montant personnalisé
    let points = 0;
    let label = '';
    
    if (body.packageId === 'custom' && body.customAmount) {
      points = body.customAmount;
      label = `Recharge personnalisée`;
    } else {
      const match = body.packageId?.match(/^pack_(\d+)$/);
      if (!match) throw new Error(`Forfait inconnu: ${body.packageId}`);
      points = parseInt(match[1], 10);
      const labelMap: Record<number, string> = { 1000: 'Standard', 3000: 'Pack Argent', 5000: 'Pack Or', 10000: 'VIP Rewards' };
      label = labelMap[points] ?? `${points} pts`;
    }

    const tariffs = await this.settings.getTariffs();
    const amountFcfa = points * tariffs.fcfaPerPoint;

    // 1. Créer ou récupérer le wallet
    let wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) {
      wallet = await this.prisma.wallet.create({ data: { userId, balance: 0 } });
    }

    /* restriction retirée pour permettre le rechargement cumulatif */
    /* if (wallet.balance > 0) {
      throw new Error('Le rechargement n\'est possible que si votre solde est nul.');
    } */

    // 2. Créer une transaction en attente
    const reference = `WALLET-${Date.now()}-${userId.slice(0, 8)}`;
    await this.prisma.transaction.create({
      data: {
        walletId: wallet.id,
        amount: amountFcfa,
        type: 'deposit',
        status: 'pending',
        reference,
        metadata: { packageId: body.packageId, points },
      },
    });

    // 3. Initialisation CinetPay
    const userInfo = await this.prisma.user.findUnique({ where: { id: userId } });
    return this.payments.initiate({
      transactionId: reference,
      amount: amountFcfa,
      description: `AeroGo 24 — ${label} (${points} points)`,
      customerName: userInfo?.name || 'Client',
      customerPhone: userInfo?.phone || '',
    });
  }

  /**
   * POST /payments/webhook
   * Appelé par CinetPay après un paiement.
   */
  @Post('webhook')
  async handleWebhook(@Body() body: Record<string, string>) {
    const transactionId = body.cpm_trans_id;

    if (!transactionId) {
      this.logger.warn('Webhook reçu sans cpm_trans_id');
      return { received: true };
    }

    // 1. Valider le site_id si configuré
    const configuredSiteId = process.env.CINETPAY_SITE_ID;
    if (configuredSiteId && body.cpm_site_id && body.cpm_site_id !== configuredSiteId) {
      this.logger.warn(`Webhook rejeté: cpm_site_id=${body.cpm_site_id}`);
      return { received: true };
    }

    // 2. Vérifier que la transaction existe en DB
    const txExists = transactionId.startsWith('ACCESS-')
      ? await this.prisma.accessPass.findFirst({ where: { paymentRef: transactionId }, select: { id: true } })
      : transactionId.startsWith('WALLET-')
        ? await this.prisma.transaction.findUnique({ where: { reference: transactionId }, select: { id: true } })
        : null;

    if (!txExists) {
      this.logger.warn(`Webhook ignoré: transaction inconnue ${transactionId}`);
      return { received: true };
    }

    this.logger.log(`Webhook CinetPay: ${transactionId} | raw_status=${body.cpm_trans_status}`);

    const verifiedStatus = await this.payments.verify(transactionId).catch((e) => {
      this.logger.error('Erreur vérification CinetPay', e.message);
      return 'PENDING' as const;
    });

    if (verifiedStatus === 'ACCEPTED') {
      if (transactionId.startsWith('ACCESS-')) {
        const passId = transactionId.slice('ACCESS-'.length);
        const now = new Date();
        await this.prisma.accessPass
          .updateMany({
            where: { id: passId, status: 'pending' },
            data: {
              status: 'active',
              activatedAt: now,
              expiresAt: new Date(now.getTime() + ACCESS_DURATION_MS),
            },
          })
          .catch((e) => this.logger.error('Erreur activation pass', e.message));
        this.logger.log(`Pass ${passId} activé`);
      } else if (transactionId.startsWith('WALLET-')) {
        const tx = await this.prisma.transaction.findUnique({
          where: { reference: transactionId },
          include: { wallet: true },
        });

        if (tx && tx.status === 'pending') {
          const meta = tx.metadata as any;
          const fcfaPerPoint = (await this.settings.getFcfaPerPoint()) || 100;
          const pointsToCredit: number = meta?.points ?? Math.floor(tx.amount / fcfaPerPoint);

          await this.prisma.$transaction([
            this.prisma.transaction.update({
              where: { id: tx.id },
              data: { status: 'completed' },
            }),
            this.prisma.wallet.update({
              where: { id: tx.walletId },
              data: { balance: { increment: pointsToCredit } },
            }),
          ]);
          this.logger.log(`Wallet ${tx.walletId} crédité de ${pointsToCredit} pts (${tx.amount} FCFA)`);
        }
      }
    } else if (verifiedStatus === 'REFUSED') {
      if (transactionId.startsWith('ACCESS-')) {
        const passId = transactionId.slice('ACCESS-'.length);
        await this.prisma.accessPass
          .updateMany({ where: { id: passId }, data: { status: 'failed' } })
          .catch(() => {});
      }
    }

    return { received: true };
  }

  /**
   * POST /payments/refund — Admin only
   */
  @Post('refund')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async refund(
    @Body('transactionId') transactionId: string,
    @Body('amount') amount: number,
  ) {
    return this.payments.refund(transactionId, amount);
  }
}
