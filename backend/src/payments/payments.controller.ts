import { Controller, Post, Get, Body, Logger, UseGuards, Request, Query, Headers } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { FlutterwaveService } from './flutterwave.service';
import { StripeService } from './stripe.service';
import { PrismaService } from '../database/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { JwtAuthGuard, RolesGuard } from '../auth/guards';
import { Roles } from '../auth/decorators';

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
    private flutterwave: FlutterwaveService,
    private stripe: StripeService,
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
   * Lance un paiement pour acheter des points.
   * Body: { packageId, customAmount?, provider: 'cinetpay' | 'flutterwave' | 'stripe', currency? }
   *
   * provider par défaut : cinetpay (mobile money Afrique)
   * flutterwave         : mobile money multi-pays Afrique
   * stripe              : carte bancaire internationale
   */
  @Post('recharge')
  @UseGuards(JwtAuthGuard)
  async recharge(
    @Request() req: any,
    @Body() body: {
      packageId: string;
      customAmount?: number;
      provider?: 'cinetpay' | 'flutterwave' | 'stripe';
      currency?: string; // pour Stripe : 'eur', 'usd', 'gbp' ; pour Flutterwave : 'XAF', 'NGN', 'GHS'…
    },
  ) {
    const userId = req.user.id;
    const provider = body.provider ?? 'cinetpay';

    // ── Résoudre le forfait ──────────────────────────────────────────────────
    let points = 0;
    let label = '';
    if (body.packageId === 'custom' && body.customAmount) {
      points = body.customAmount;
      label = 'Recharge personnalisée';
    } else {
      const match = body.packageId?.match(/^pack_(\d+)$/);
      if (!match) throw new Error(`Forfait inconnu: ${body.packageId}`);
      points = parseInt(match[1], 10);
      const labelMap: Record<number, string> = { 1000: 'Standard', 3000: 'Pack Argent', 5000: 'Pack Or', 10000: 'VIP Rewards' };
      label = labelMap[points] ?? `${points} pts`;
    }

    const tariffs = await this.settings.getTariffs();
    const amountFcfa = points * tariffs.fcfaPerPoint;

    // ── Wallet ───────────────────────────────────────────────────────────────
    let wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) wallet = await this.prisma.wallet.create({ data: { userId, balance: 0 } });

    const userInfo = await this.prisma.user.findUnique({ where: { id: userId } });
    const reference = `WALLET-${provider.toUpperCase()}-${Date.now()}-${userId.slice(0, 8)}`;

    // ── Transaction en attente ───────────────────────────────────────────────
    await this.prisma.transaction.create({
      data: {
        walletId: wallet.id,
        amount: amountFcfa,
        type: 'deposit',
        status: 'pending',
        reference,
        metadata: { packageId: body.packageId, points, provider },
      },
    });

    const description = `AeroGo 24 — ${label} (${points} pts)`;

    // ── Redirection vers le provider ─────────────────────────────────────────
    if (provider === 'flutterwave') {
      const currency = body.currency?.toUpperCase() ?? 'XAF';
      return this.flutterwave.initiate({
        transactionId: reference,
        amount: convertFromFcfa(amountFcfa, currency),
        currency,
        description,
        customerName: userInfo?.name || 'Client',
        customerPhone: userInfo?.phone || '',
        customerEmail: userInfo?.email || 'client@aerogo24.com',
      });
    }

    if (provider === 'stripe') {
      // Stripe n'accepte pas XAF — conversion obligatoire vers EUR/USD/GBP
      const stripeCurrency = (body.currency ?? 'eur').toLowerCase();
      const STRIPE_RATES: Record<string, number> = { eur: 0.00152, usd: 0.00165, gbp: 0.00130, cad: 0.00224 };
      const rate = STRIPE_RATES[stripeCurrency] ?? STRIPE_RATES['eur'];
      const amountCents = Math.round(amountFcfa * rate * 100); // Stripe veut des centimes
      return this.stripe.initiate({
        transactionId: reference,
        amountCents,
        currency: stripeCurrency,
        description,
        customerEmail: userInfo?.email || '',
      });
    }

    // Défaut : CinetPay
    return this.payments.initiate({
      transactionId: reference,
      amount: amountFcfa,
      description,
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
    const txExists = transactionId.startsWith('WALLET-')
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

    if (verifiedStatus === 'ACCEPTED' && transactionId.startsWith('WALLET-')) {
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

    return { received: true };
  }

  /**
   * POST /payments/webhook/flutterwave
   * Webhook Flutterwave — vérifie la signature et crédite le wallet.
   */
  @Post('webhook/flutterwave')
  async handleFlutterwaveWebhook(
    @Body() body: Record<string, any>,
    @Headers('verif-hash') signature: string,
  ) {
    // Vérification de la signature via secret partagé (header verif-hash)
    const secretHash = process.env.FLUTTERWAVE_WEBHOOK_HASH ?? '';
    if (secretHash && signature !== secretHash) {
      this.logger.warn('Flutterwave webhook: signature invalide');
      return { received: true };
    }

    const txRef: string = body?.data?.tx_ref ?? body?.txRef ?? '';
    const status: string = body?.data?.status ?? '';
    const flwTxId: string = String(body?.data?.id ?? '');

    this.logger.log(`Flutterwave webhook: ${txRef} status=${status}`);

    if (!txRef.startsWith('WALLET-FLUTTERWAVE-')) return { received: true };

    if (status === 'successful' && flwTxId) {
      // Double-vérification via l'API Flutterwave
      const verified = await this.flutterwave.verify(flwTxId).catch(() => 'PENDING' as const);
      if (verified !== 'ACCEPTED') return { received: true };

      await this.creditWalletFromTransaction(txRef);
    }

    return { received: true };
  }

  /**
   * POST /payments/webhook/stripe
   * Webhook Stripe — vérifie la signature et crédite le wallet.
   */
  @Post('webhook/stripe')
  async handleStripeWebhook(
    @Body() body: Record<string, any>,
    @Headers('stripe-signature') signature: string,
  ) {
    if (!this.stripe.verifyWebhookSignature(JSON.stringify(body), signature)) {
      this.logger.warn('Stripe webhook: signature invalide');
      return { received: true };
    }

    const eventType: string = body?.type ?? '';
    const sessionId: string = body?.data?.object?.id ?? '';
    const txRef: string = body?.data?.object?.metadata?.transaction_id ?? '';

    this.logger.log(`Stripe webhook: ${eventType} session=${sessionId}`);

    if (eventType === 'checkout.session.completed' && txRef.startsWith('WALLET-STRIPE-')) {
      const paymentStatus: string = body?.data?.object?.payment_status ?? '';
      if (paymentStatus === 'paid') {
        await this.creditWalletFromTransaction(txRef);
      }
    }

    return { received: true };
  }

  /** Crédite le wallet en points depuis une référence de transaction pending.
   *  Idempotent : l'updateMany atomique garantit qu'un seul webhook concurrent
   *  peut passer status pending→completed (les suivants trouvent count=0 et s'arrêtent).
   */
  private async creditWalletFromTransaction(reference: string): Promise<void> {
    // Lecture préalable pour récupérer les métadonnées et le walletId
    const tx = await this.prisma.transaction.findUnique({
      where: { reference },
    });
    if (!tx) return;

    const meta = tx.metadata as any;
    const tariffs = await this.settings.getTariffs();
    const pointsToCredit: number = meta?.points ?? Math.floor(tx.amount / (tariffs.pointRechargeRate ?? tariffs.fcfaPerPoint ?? 1));

    // Mise à jour atomique avec condition status=pending → garantit l'idempotence
    // (un retry concurrent trouvera count=0 et ne créditera pas deux fois)
    const { count } = await this.prisma.transaction.updateMany({
      where: { id: tx.id, status: 'pending' },
      data: { status: 'completed' },
    });
    if (count === 0) {
      this.logger.warn(`Webhook duplicate ou déjà traité : ${reference}`);
      return;
    }

    await this.prisma.wallet.update({
      where: { id: tx.walletId },
      data: { balance: { increment: pointsToCredit } },
    });
    this.logger.log(`Wallet ${tx.walletId} crédité de ${pointsToCredit} pts via ${reference}`);
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
