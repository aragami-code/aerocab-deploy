import { Controller, Post, Get, Patch, Body, Logger, UseGuards, Request, Query, Headers, Req, BadRequestException, Param, ForbiddenException } from '@nestjs/common';
import { ExchangeRateService } from './exchange-rate.service';
import type { RawBodyRequest } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { UsersService } from '../users/users.service';
import { FlutterwaveService } from './flutterwave.service';
import { StripeService } from './stripe.service';
import { NotchPayService } from './notchpay.service';
import { EdoctorPaymentService } from './edoctor-payment.service';
import { MpesaService } from './mpesa.service';
import { PaypalService } from './paypal.service';
import { WaveService } from './wave.service';
import { PaymentIntentService } from './payment-intent.service';
import { PayoutService } from './payout.service';
import { TipService } from './tip.service';
import { SplitService } from './split.service';
import { PrismaService } from '../database/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { JwtAuthGuard, RolesGuard } from '../auth/guards';
import { Roles } from '../auth/decorators';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { extractCountryFromPhone } from '../common/phone-country';

/**
 * Taux de change XAF → devise cible (1 XAF = X devise).
 * Approximations statiques — remplacer par une API de change en production.
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
  KES: 0.133,     // 1 KES ≈ 7.5 XAF  (M-Pesa Kenya)
};

const CURRENCY_SYMBOLS: Record<string, string> = {
  XAF: 'FCFA', USD: '$', EUR: '€', GBP: '£', CAD: 'CA$',
  CHF: 'CHF', NGN: '₦', GHS: '₵', MAD: 'DH', DZD: 'DA',
  CNY: '¥', JPY: '¥', KES: 'KSh',
};

function convertFromFcfa(amountFcfa: number, currency: string): number {
  const rate = EXCHANGE_RATES[currency] ?? EXCHANGE_RATES['USD'];
  const converted = amountFcfa * rate;
  if (['JPY', 'NGN', 'DZD', 'KES', 'XAF'].includes(currency)) return Math.round(converted);
  return Math.round(converted * 100) / 100;
}

type Provider = 'cinetpay' | 'flutterwave' | 'stripe' | 'notchpay' | 'mpesa' | 'paypal' | 'wave' | 'mock';

@Controller('payments')
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  constructor(
    private payments: PaymentsService,
    private flutterwave: FlutterwaveService,
    private stripe: StripeService,
    private notchpay: NotchPayService,
    private edoctor: EdoctorPaymentService,
    private mpesa: MpesaService,
    private paypal: PaypalService,
    private wave: WaveService,
    private paymentIntent: PaymentIntentService,
    private payout: PayoutService,
    private tip: TipService,
    private split: SplitService,
    private prisma: PrismaService,
    private settings: SettingsService,
    private usersService: UsersService,
    private exchangeRate: ExchangeRateService,
  ) {}

  /**
   * GET /payments/wallet?currency=USD
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

    const transactions = await this.prisma.transaction.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    const packagesRaw = await this.settings.get('points_recharge_packages', '[1000,3000,5000,10000]');
    let packageSizes: number[];
    try { packageSizes = JSON.parse(packagesRaw); } catch { packageSizes = [1000, 3000, 5000, 10000]; }
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
   * GET /payments/methods
   * Retourne les méthodes de paiement disponibles selon le pays de l'utilisateur (via préfixe téléphonique).
   */
  @Get('methods')
  @UseGuards(JwtAuthGuard)
  async getPaymentMethods(@Request() req: any, @Query('country') country?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: req.user.id },
      select: { phone: true },
    });

    const phoneCountry = (user?.phone ? extractCountryFromPhone(user.phone) : null) ?? 'CM';
    const countryCode = (country ?? phoneCountry).toUpperCase();

    const countryRow = await this.prisma.country.findUnique({
      where: { code: countryCode },
      select: { paymentMethods: true },
    });

    const DEFAULT_METHODS = [
      { id: 'orange_money_cm', label: 'Orange Money', icon: 'orange_money' },
      { id: 'mtn_cm',          label: 'MTN MoMo',     icon: 'mtn_momo' },
      { id: 'cash',            label: 'Espèces',       icon: 'cash' },
    ];

    const methods = Array.isArray(countryRow?.paymentMethods) && (countryRow.paymentMethods as any[]).length
      ? countryRow.paymentMethods as any[]
      : DEFAULT_METHODS;

    return { methods, countryCode };
  }

  /**
   * GET /payments/default-payment-method
   * Retourne la méthode de paiement par défaut de l'utilisateur.
   */
  @Get('default-payment-method')
  @UseGuards(JwtAuthGuard)
  async getDefaultPaymentMethod(@Request() req: any) {
    const user = await this.prisma.user.findUnique({
      where: { id: req.user.id },
      select: { defaultPaymentMethod: true },
    });
    return { defaultPaymentMethod: user?.defaultPaymentMethod ?? null };
  }

  /**
   * PATCH /payments/default-payment-method
   * Définit la méthode de paiement par défaut de l'utilisateur.
   */
  @Patch('default-payment-method')
  @UseGuards(JwtAuthGuard)
  async setDefaultPaymentMethod(
    @Request() req: any,
    @Body() body: { method: string },
  ) {
    if (!body.method) throw new BadRequestException('method requis');
    await this.prisma.user.update({
      where: { id: req.user.id },
      data: { defaultPaymentMethod: body.method },
    });
    return { defaultPaymentMethod: body.method };
  }

  /**
   * GET /payments/spending?month=2026-04
   * Retourne le total dépensé et le nombre de trajets pour un mois donné.
   */
  @Get('spending')
  @UseGuards(JwtAuthGuard)
  async getMonthlySpending(@Request() req: any, @Query('month') month?: string) {
    const target = month ? new Date(`${month}-01`) : new Date();
    const startOfMonth = new Date(target.getFullYear(), target.getMonth(), 1);
    const endOfMonth   = new Date(target.getFullYear(), target.getMonth() + 1, 0, 23, 59, 59);

    const result = await this.prisma.booking.aggregate({
      where: {
        passengerId: req.user.id,
        status: 'completed',
        createdAt: { gte: startOfMonth, lte: endOfMonth },
      },
      _sum: { estimatedPrice: true },
      _count: { id: true },
    });

    return {
      totalFcfa: result._sum.estimatedPrice ?? 0,
      tripCount: result._count.id ?? 0,
      month: `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}`,
    };
  }

  /**
   * POST /payments/purchase-pass
   * Initie le paiement du pass d'accès passager via NotchPay.
   * Référence format : PASS-{userId8}-{timestamp}
   */
  @Post('purchase-pass')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  async purchasePass(@Request() req: any) {
    const userId = req.user.id;

    const passEnabled = await this.settings.get('access_pass_enabled', 'false');
    if (passEnabled !== 'true') {
      throw new ForbiddenException('Le pass d\'accès n\'est pas activé');
    }

    const [priceFcfaRaw, durationRaw] = await Promise.all([
      this.settings.get('access_pass_price_fcfa', '2000'),
      this.settings.get('access_pass_duration_days', '30'),
    ]);
    const amountFcfa = parseInt(priceFcfaRaw, 10) || 2000;
    const duration   = parseInt(durationRaw, 10) || 30;

    const userInfo  = await this.prisma.user.findUnique({ where: { id: userId } });
    const reference = `PASS-${userId.slice(0, 8)}-${Date.now()}`;
    const description = `Pass AeroCab ${duration} jours — ${amountFcfa.toLocaleString()} FCFA`;

    await this.prisma.transaction.create({
      data: {
        walletId: (await this.prisma.wallet.upsert({
          where:  { userId },
          create: { userId, balance: 0 },
          update: {},
        })).id,
        amount:    amountFcfa,
        type:      'deposit',
        status:    'pending',
        reference,
        metadata:  { type: 'access_pass', userId, durationDays: duration },
      },
    });

    return this.notchpay.initiate({
      transactionId: reference,
      amount:        amountFcfa,
      currency:      'XAF',
      description,
      customerName:  userInfo?.name  || 'Client',
      customerPhone: userInfo?.phone || '',
      customerEmail: userInfo?.email || 'client@aerogo24.com',
    });
  }

  /**
   * POST /payments/recharge
   * provider: cinetpay | flutterwave | stripe | notchpay | mpesa | paypal | wave
   *
   * Stripe/PayPal: currency = 'eur'|'usd'|'gbp'
   * Flutterwave:   currency = 'XAF'|'NGN'|'GHS'…
   * M-Pesa:        phone requis (format international +254…)
   *
   * Rate limit : 5 tentatives / minute / utilisateur
   */
  @Post('recharge')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @UseGuards(JwtAuthGuard)
  async recharge(
    @Request() req: any,
    @Body() body: {
      packageId: string;
      customAmount?: number;
      provider?: Provider;
      currency?: string;
      phone?: string; // requis pour M-Pesa
    },
  ) {
    const userId   = req.user.id;
    const provider = (body.provider ?? 'cinetpay') as Provider;

    // ── Vérifier que le fournisseur est activé ───────────────────────────────
    const enabledFlag = await this.settings.get(`payment_${provider}_enabled`, 'true');
    if (enabledFlag === 'false') {
      throw new BadRequestException(`Le fournisseur de paiement "${provider}" est désactivé`);
    }

    // ── Résoudre le forfait ──────────────────────────────────────────────────
    let points = 0;
    let label  = '';
    if (body.packageId === 'custom' && body.customAmount) {
      points = body.customAmount;
      label  = 'Recharge personnalisée';
    } else {
      const match = body.packageId?.match(/^pack_(\d+)$/);
      if (!match) throw new Error(`Forfait inconnu: ${body.packageId}`);
      points = parseInt(match[1], 10);
      const labelMap: Record<number, string> = { 1000: 'Standard', 3000: 'Pack Argent', 5000: 'Pack Or', 10000: 'VIP Rewards' };
      label  = labelMap[points] ?? `${points} pts`;
    }

    const tariffs    = await this.settings.getTariffs();
    const amountFcfa = points * tariffs.fcfaPerPoint;

    // ── Contrôle montant maximum ─────────────────────────────────────────────
    const maxRaw = await this.settings.get('payment_max_recharge_amount', '500000');
    const maxAmount = parseInt(maxRaw, 10) || 500000;
    if (amountFcfa > maxAmount) {
      throw new BadRequestException(
        `Montant maximum de recharge dépassé : ${maxAmount.toLocaleString()} FCFA autorisés par transaction`,
      );
    }

    let wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) wallet = await this.prisma.wallet.create({ data: { userId, balance: 0 } });

    const userInfo  = await this.prisma.user.findUnique({ where: { id: userId } });
    const reference = `WALLET-${provider.toUpperCase()}-${Date.now()}-${userId.slice(0, 8)}`;
    const description = `AeroGo 24 — ${label} (${points} pts)`;

    // Créer la transaction en attente (metadata sera enrichi pour M-Pesa)
    await this.prisma.transaction.create({
      data: {
        walletId: wallet.id,
        amount:   amountFcfa,
        type:     'deposit',
        status:   'pending',
        reference,
        metadata: { packageId: body.packageId, points, provider },
      },
    });

    // ── Flutterwave ──────────────────────────────────────────────────────────
    if (provider === 'flutterwave') {
      const currency = body.currency?.toUpperCase() ?? 'XAF';
      return this.flutterwave.initiate({
        transactionId: reference,
        amount:        convertFromFcfa(amountFcfa, currency),
        currency,
        description,
        customerName:  userInfo?.name  || 'Client',
        customerPhone: userInfo?.phone || '',
        customerEmail: userInfo?.email || 'client@aerogo24.com',
      });
    }

    // ── Stripe (carte + Link + Apple Pay + Google Pay) ───────────────────────
    if (provider === 'stripe') {
      const stripeCurrency = (body.currency ?? 'eur').toLowerCase();
      const STRIPE_RATES: Record<string, number> = { eur: 0.00152, usd: 0.00165, gbp: 0.00130, cad: 0.00224 };
      const rate       = STRIPE_RATES[stripeCurrency] ?? STRIPE_RATES['eur'];
      const amountCents = Math.round(amountFcfa * rate * 100);
      return this.stripe.initiate({
        transactionId: reference,
        amountCents,
        currency:      stripeCurrency,
        description,
        customerEmail: userInfo?.email || '',
      });
    }

    // ── NotchPay (Orange Money CM, MTN MoMo CM, carte) ──────────────────────
    if (provider === 'notchpay') {
      return this.notchpay.initiate({
        transactionId: reference,
        amount:        amountFcfa,
        currency:      'XAF',
        description,
        customerName:  userInfo?.name  || 'Client',
        customerPhone: userInfo?.phone || '',
        customerEmail: userInfo?.email || 'client@aerogo24.com',
      });
    }

    // ── M-Pesa (STK Push Kenya) ──────────────────────────────────────────────
    if (provider === 'mpesa') {
      const phone = body.phone || userInfo?.phone || '';
      if (!phone) throw new Error('M-Pesa: numéro de téléphone requis (paramètre phone)');
      const mpesaPhone = MpesaService.formatPhone(phone);
      const amountKes  = convertFromFcfa(amountFcfa, 'KES');
      const result     = await this.mpesa.stkPush({
        transactionId: reference,
        amountKes,
        phone:         mpesaPhone,
        description,
      });
      // Stocker le checkoutRequestId pour retrouver la transaction lors du callback
      await this.prisma.transaction.update({
        where: { reference },
        data:  { metadata: { packageId: body.packageId, points, provider, checkoutRequestId: result.checkoutRequestId } },
      });
      return result;
    }

    // ── PayPal (USD/EUR, carte internationale) ───────────────────────────────
    if (provider === 'paypal') {
      const paypalCurrency = (body.currency ?? 'USD').toUpperCase();
      const rate   = EXCHANGE_RATES[paypalCurrency] ?? EXCHANGE_RATES['USD'];
      const amount = Math.round(amountFcfa * rate * 100) / 100;
      const { paymentUrl, orderId } = await this.paypal.initiate({
        transactionId: reference,
        amount,
        currency:      paypalCurrency,
        description,
        customerEmail: userInfo?.email,
      });
      // Stocker l'orderId pour la capture dans le webhook
      await this.prisma.transaction.update({
        where: { reference },
        data:  { metadata: { packageId: body.packageId, points, provider, orderId } },
      });
      return { paymentUrl };
    }

    // ── Wave (XOF Afrique de l'Ouest) ────────────────────────────────────────
    if (provider === 'wave') {
      const { paymentUrl } = await this.wave.initiate({
        transactionId: reference,
        amount:        amountFcfa, // XAF ≈ XOF 1:1
        description,
      });
      return { paymentUrl };
    }

    // ── Mock (mode test uniquement) ──────────────────────────────────────────
    if (provider === 'mock') {
      const testMode = await this.settings.get('test_mode_enabled', 'false');
      if (testMode !== 'true') {
        throw new BadRequestException('Le provider mock est uniquement disponible en mode test');
      }
      await this.creditWalletFromTransaction(reference);
      this.logger.log(`Mock payment: ${points} pts crédités directement pour ${userId}`);
      return { success: true, mock: true, points, reference };
    }

    // ── CinetPay (défaut) ────────────────────────────────────────────────────
    return this.payments.initiate({
      transactionId: reference,
      amount:        amountFcfa,
      description,
      customerName:  userInfo?.name  || 'Client',
      customerPhone: userInfo?.phone || '',
    });
  }

  // ── Webhooks ─────────────────────────────────────────────────────────────────

  /** POST /payments/webhook — CinetPay */
  @Post('webhook')
  @SkipThrottle()
  async handleWebhook(@Body() body: Record<string, string>) {
    const transactionId = body.cpm_trans_id;
    if (!transactionId) {
      this.logger.warn('Webhook reçu sans cpm_trans_id');
      return { received: true };
    }

    const configuredSiteId = process.env.CINETPAY_SITE_ID;
    if (configuredSiteId && body.cpm_site_id && body.cpm_site_id !== configuredSiteId) {
      this.logger.warn(`Webhook rejeté: cpm_site_id=${body.cpm_site_id}`);
      return { received: true };
    }

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
    if (verifiedStatus === 'ACCEPTED') await this.creditWalletFromTransaction(transactionId);

    return { received: true };
  }

  /** POST /payments/webhook/flutterwave — Flutterwave */
  @Post('webhook/flutterwave')
  @SkipThrottle()
  async handleFlutterwaveWebhook(
    @Body() body: Record<string, any>,
    @Headers('verif-hash') signature: string,
  ) {
    const secretHash = await this.flutterwave.getWebhookHash();
    if (secretHash && signature !== secretHash) {
      this.logger.warn('Flutterwave webhook: signature invalide');
      return { received: true };
    }

    const txRef   = String(body?.data?.tx_ref ?? body?.txRef ?? '');
    const status  = String(body?.data?.status ?? '');
    const flwTxId = String(body?.data?.id ?? '');

    this.logger.log(`Flutterwave webhook: ${txRef} status=${status}`);
    if (!txRef.startsWith('WALLET-FLUTTERWAVE-')) return { received: true };

    if (status === 'successful' && flwTxId) {
      const verified = await this.flutterwave.verify(flwTxId).catch(() => 'PENDING' as const);
      if (verified === 'ACCEPTED') await this.creditWalletFromTransaction(txRef);
    }

    return { received: true };
  }

  /** POST /payments/webhook/stripe — Stripe (raw body requis pour la vérification de signature) */
  @Post('webhook/stripe')
  @SkipThrottle()
  async handleStripeWebhook(
    @Req() req: RawBodyRequest<any>,
    @Body() body: Record<string, any>,
    @Headers('stripe-signature') signature: string,
  ) {
    const rawBody       = req.rawBody ?? Buffer.from(JSON.stringify(body));
    const webhookSecret = await this.stripe.getWebhookSecret();
    if (!this.stripe.verifyWebhookSignature(rawBody, signature, webhookSecret)) {
      this.logger.warn('Stripe webhook: signature invalide');
      return { received: true };
    }

    const eventType = String(body?.type ?? '');
    const txRef     = String(body?.data?.object?.metadata?.transaction_id ?? '');
    const piId      = String(body?.data?.object?.id ?? '');
    this.logger.log(`Stripe webhook: ${eventType}`);

    // Rechargement wallet (Checkout Session)
    if (eventType === 'checkout.session.completed' && txRef.startsWith('WALLET-STRIPE-')) {
      if (body?.data?.object?.payment_status === 'paid') {
        await this.creditWalletFromTransaction(txRef);
      }
    }

    // Pré-autorisation course (PaymentIntent, capture manuelle)
    if (eventType === 'payment_intent.amount_capturable_updated' && piId) {
      await this.paymentIntent.markAuthorizedByStripe(piId).catch((err) => {
        this.logger.warn(`Stripe markAuthorized error: ${err.message}`);
      });
    }

    // Pourboire PaymentIntent capturé par le passager
    if (eventType === 'payment_intent.succeeded' && piId) {
      await this.tip.captureByProviderRef(piId).catch(() => {});
    }

    return { received: true };
  }

  /** POST /payments/webhook/notchpay — NotchPay (POST server webhook) */
  @Post('webhook/notchpay')
  @SkipThrottle()
  async handleNotchPayWebhook(
    @Req() req: RawBodyRequest<any>,
    @Body() body: Record<string, any>,
    @Query() query: Record<string, any>,
    @Headers('x-notch-signature') signature: string,
  ) {
    // NotchPay peut envoyer les données en JSON body (webhook server) ou en query params (redirect fallback)
    const merged      = { ...query, ...body };
    const rawBody      = req.rawBody ?? Buffer.from(JSON.stringify(body));
    const notchSecret  = await this.notchpay.getWebhookSecret();
    if (!this.notchpay.verifyWebhookSignature(rawBody, signature, notchSecret)) {
      this.logger.warn('NotchPay webhook: signature invalide');
      return { received: true };
    }

    // NotchPay payload :
    //   trxref / transaction.merchant_reference → notre référence (WALLET-NOTCHPAY-...)
    //   reference / transaction.reference        → référence interne NotchPay (trx.xxx)
    const merchantRef  = String(
      merged?.trxref ?? merged?.transaction?.merchant_reference ?? merged?.transaction?.trxref ?? '',
    );
    const notchpayRef  = String(merged?.reference ?? merged?.transaction?.reference ?? '');
    const status       = String(merged?.transaction?.status ?? merged?.status ?? '').toLowerCase();

    this.logger.log(`NotchPay webhook: merchant=${merchantRef} notchRef=${notchpayRef} status=${status}`);
    const refToVerify = notchpayRef || merchantRef;

    if (merchantRef.startsWith('WALLET-NOTCHPAY-')) {
      if (status === 'complete' || status === 'completed') {
        const verified = await this.notchpay.verify(refToVerify).catch(() => 'PENDING' as const);
        if (verified === 'ACCEPTED') await this.creditWalletFromTransaction(merchantRef);
      }
      return { received: true };
    }

    // Paiement de course (BOOKING-ORANGE_MONEY_CM-* ou BOOKING-MTN_CM-*)
    if (merchantRef.startsWith('BOOKING-')) {
      if (status === 'complete' || status === 'completed') {
        const verified = await this.notchpay.verify(refToVerify).catch(() => 'PENDING' as const);
        if (verified === 'ACCEPTED') {
          const bookingId = await this.resolveBookingFromRef(merchantRef);
          if (bookingId) await this.paymentIntent.markAuthorizedByNotchPay(bookingId, notchpayRef);
        }
      }
      return { received: true };
    }

    // Pourboire (TIP-*)
    if (merchantRef.startsWith('TIP-')) {
      if (status === 'complete' || status === 'completed') {
        const verified = await this.notchpay.verify(refToVerify).catch(() => 'PENDING' as const);
        if (verified === 'ACCEPTED') await this.tip.captureByProviderRef(merchantRef);
      }
    }

    // Frais d'inscription chauffeur (REGFEE-*)
    if (merchantRef.startsWith('REGFEE-')) {
      if (status === 'complete' || status === 'completed') {
        const verified = await this.notchpay.verify(refToVerify).catch(() => 'PENDING' as const);
        if (verified === 'ACCEPTED') await this.confirmRegistrationFee(merchantRef);
      }
    }

    // Pass d'accès passager (PASS-*)
    if (merchantRef.startsWith('PASS-')) {
      if (status === 'complete' || status === 'completed') {
        const verified = await this.notchpay.verify(refToVerify).catch(() => 'PENDING' as const);
        if (verified === 'ACCEPTED') await this.confirmAccessPass(merchantRef);
      }
    }

    return { received: true };
  }

  /** GET /payments/webhook/notchpay — redirect navigateur après paiement NotchPay */
  @Get('webhook/notchpay')
  @SkipThrottle()
  async handleNotchPayRedirect(@Query() query: Record<string, any>) {
    const merchantRef = String(query?.trxref ?? query?.notchpay_trxref ?? '');
    const notchpayRef = String(query?.reference ?? '');
    const status      = String(query?.status ?? '').toLowerCase();
    this.logger.log(`NotchPay redirect GET: merchant=${merchantRef} status=${status}`);

    const refToVerify = notchpayRef || merchantRef;

    if (merchantRef.startsWith('WALLET-NOTCHPAY-') && (status === 'complete' || status === 'completed')) {
      const verified = await this.notchpay.verify(refToVerify).catch(() => 'PENDING' as const);
      if (verified === 'ACCEPTED') await this.creditWalletFromTransaction(merchantRef);
    }

    if (merchantRef.startsWith('BOOKING-') && (status === 'complete' || status === 'completed')) {
      const verified = await this.notchpay.verify(refToVerify).catch(() => 'PENDING' as const);
      if (verified === 'ACCEPTED') {
        const bookingId = await this.resolveBookingFromRef(merchantRef);
        if (bookingId) await this.paymentIntent.markAuthorizedByNotchPay(bookingId, notchpayRef);
      }
    }

    if (merchantRef.startsWith('REGFEE-') && (status === 'complete' || status === 'completed')) {
      const verified = await this.notchpay.verify(refToVerify).catch(() => 'PENDING' as const);
      if (verified === 'ACCEPTED') await this.confirmRegistrationFee(merchantRef);
    }

    if (merchantRef.startsWith('PASS-') && (status === 'complete' || status === 'completed')) {
      const verified = await this.notchpay.verify(refToVerify).catch(() => 'PENDING' as const);
      if (verified === 'ACCEPTED') await this.confirmAccessPass(merchantRef);
    }

    return { received: true, status };
  }

  /** POST /payments/webhook/mpesa — M-Pesa STK Push callback */
  @Post('webhook/mpesa')
  @SkipThrottle()
  async handleMpesaWebhook(@Body() body: Record<string, any>) {
    const callback = body?.Body?.stkCallback;
    if (!callback) {
      this.logger.warn('M-Pesa webhook: format inattendu');
      return { ResultCode: 0, ResultDesc: 'Accepted' };
    }

    const checkoutRequestId = String(callback.CheckoutRequestID ?? '');
    const resultCode        = Number(callback.ResultCode ?? -1);

    this.logger.log(`M-Pesa callback: ${checkoutRequestId} resultCode=${resultCode}`);

    // Retrouver la transaction via le checkoutRequestId stocké dans les métadonnées
    const tx = await this.prisma.transaction.findFirst({
      where: { metadata: { path: ['checkoutRequestId'], equals: checkoutRequestId } },
    });

    if (!tx) {
      this.logger.warn(`M-Pesa callback ignoré: checkoutRequestId inconnu ${checkoutRequestId}`);
      return { ResultCode: 0, ResultDesc: 'Accepted' };
    }

    if (resultCode === 0) {
      await this.creditWalletFromTransaction(tx.reference);
    } else {
      // Paiement refusé ou annulé — marquer la transaction comme échouée
      await this.prisma.transaction.updateMany({
        where: { id: tx.id, status: 'pending' },
        data:  { status: 'failed' },
      });
      this.logger.warn(`M-Pesa paiement refusé: ${callback.ResultDesc}`);
    }

    return { ResultCode: 0, ResultDesc: 'Accepted' };
  }

  /** POST /payments/webhook/paypal — PayPal IPN/webhook */
  @Post('webhook/paypal')
  @SkipThrottle()
  async handlePaypalWebhook(
    @Req() req: RawBodyRequest<any>,
    @Body() body: Record<string, any>,
    @Headers() headers: Record<string, string>,
  ) {
    const rawBody = req.rawBody ? req.rawBody.toString() : JSON.stringify(body);
    const isValid = await this.paypal.verifyWebhookSignature(headers, rawBody).catch(() => false);
    if (!isValid) {
      this.logger.warn('PayPal webhook: signature invalide');
      return { received: true };
    }

    const eventType = String(body?.event_type ?? '');
    this.logger.log(`PayPal webhook: ${eventType}`);

    // CHECKOUT.ORDER.APPROVED → capturer les fonds, puis créditer
    if (eventType === 'CHECKOUT.ORDER.APPROVED') {
      const orderId   = String(body?.resource?.id ?? '');
      const reference = String(body?.resource?.purchase_units?.[0]?.reference_id ?? '');

      if (reference.startsWith('WALLET-PAYPAL-') && orderId) {
        const captured = await this.paypal.captureOrder(orderId).catch(() => 'PENDING' as const);
        if (captured === 'ACCEPTED') await this.creditWalletFromTransaction(reference);
      }
    }

    // PAYMENT.CAPTURE.COMPLETED → crédit idempotent (fallback si le webhook APPROVED a déjà crédité)
    if (eventType === 'PAYMENT.CAPTURE.COMPLETED') {
      const reference = String(body?.resource?.custom_id ?? '');
      if (reference.startsWith('WALLET-PAYPAL-')) {
        await this.creditWalletFromTransaction(reference);
      }
    }

    return { received: true };
  }

  /** POST /payments/webhook/wave — Wave */
  @Post('webhook/wave')
  @SkipThrottle()
  async handleWaveWebhook(
    @Req() req: RawBodyRequest<any>,
    @Body() body: Record<string, any>,
    @Headers('wave-signature') signature: string,
  ) {
    const rawBody    = req.rawBody ?? Buffer.from(JSON.stringify(body));
    const waveSecret = await this.wave.getWebhookSecret();
    if (!this.wave.verifyWebhookSignature(rawBody, signature, waveSecret)) {
      this.logger.warn('Wave webhook: signature invalide');
      return { received: true };
    }

    const reference = String(body?.client_reference ?? body?.checkout_session?.client_reference ?? '');
    const status    = String(body?.checkout_session?.payment_status ?? body?.payment_status ?? '');

    this.logger.log(`Wave webhook: ${reference} status=${status}`);
    if (!reference.startsWith('WALLET-WAVE-')) return { received: true };

    if (status === 'succeeded') await this.creditWalletFromTransaction(reference);

    return { received: true };
  }

  /**
   * Crédite le wallet depuis une transaction pending.
   * Atomique via updateMany(status=pending) — idempotent contre les webhooks dupliqués.
   */
  private async creditWalletFromTransaction(reference: string): Promise<void> {
    const tx = await this.prisma.transaction.findUnique({ where: { reference } });
    if (!tx) return;

    const meta   = tx.metadata as any;
    const tariffs = await this.settings.getTariffs();
    const pointsToCredit: number = meta?.points ?? Math.floor(tx.amount / (tariffs.pointRechargeRate ?? tariffs.fcfaPerPoint ?? 1));

    const { count } = await this.prisma.transaction.updateMany({
      where: { id: tx.id, status: 'pending' },
      data:  { status: 'completed' },
    });
    if (count === 0) {
      this.logger.warn(`Webhook duplicate ou déjà traité : ${reference}`);
      return;
    }

    await this.prisma.wallet.update({
      where: { id: tx.walletId },
      data:  { balance: { increment: pointsToCredit } },
    });
    this.logger.log(`Wallet ${tx.walletId} crédité de ${pointsToCredit} pts via ${reference}`);

    // Créer aussi une PointsTransaction pour les sous-soldes (source: recharge)
    const walletOwner = await this.prisma.wallet.findUnique({
      where: { id: tx.walletId },
      select: { userId: true },
    });
    if (walletOwner) {
      const provider = meta?.provider ?? 'wallet';
      await this.prisma.pointsTransaction.create({
        data: {
          userId: walletOwner.userId,
          type: 'credit',
          source: 'recharge',
          points: pointsToCredit,
          label: `Recharge ${provider.toUpperCase()} — ${pointsToCredit} pts`,
        },
      });
    }
  }

  /** POST /payments/refund — Admin only */
  @Post('refund')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async refund(
    @Body('transactionId') transactionId: string,
    @Body('amount') amount: number,
  ) {
    return this.payments.refund(transactionId, amount);
  }

  // ── F4 — Paiement de course ───────────────────────────────────────────────

  /**
   * POST /payments/booking/:bookingId/initiate
   * Initie le paiement d'une course (Mobile Money, Carte, Cash).
   * Retourne paymentUrl (Mobile Money) ou clientSecret (Stripe).
   */
  @Post('booking/:bookingId/initiate')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @UseGuards(JwtAuthGuard)
  async initiateBookingPayment(
    @Param('bookingId') bookingId: string,
    @Request() req: any,
    @Body() body: {
      provider: 'orange_money_cm' | 'mtn_cm' | 'card' | 'cash';
      currency?: string;
    },
  ) {
    const user = await this.prisma.user.findUnique({
      where:  { id: req.user.id },
      select: { name: true, phone: true, email: true },
    });

    const booking = await this.prisma.booking.findUnique({
      where:  { id: bookingId },
      select: { estimatedPrice: true, currency: true, operatingCountry: true, passengerId: true },
    });
    if (!booking) throw new BadRequestException('Booking introuvable');
    if (booking.passengerId !== req.user.id) throw new BadRequestException('Non autorisé');

    return this.paymentIntent.create({
      bookingId,
      provider:         body.provider,
      amount:           booking.estimatedPrice,
      currency:         body.currency ?? booking.currency ?? 'XAF',
      operatingCountry: booking.operatingCountry ?? 'CM',
      passengerName:    user?.name  ?? '',
      passengerPhone:   user?.phone ?? '',
      passengerEmail:   user?.email ?? '',
    });
  }

  /**
   * GET /payments/booking/:bookingId/status
   * Retourne le statut du PaymentIntent d'une course.
   */
  @Get('booking/:bookingId/status')
  @UseGuards(JwtAuthGuard)
  async getBookingPaymentStatus(@Param('bookingId') bookingId: string, @Request() req: any) {
    // Sync EdoctorPay si le paiement est en attente via edoctor
    await this.paymentIntent.syncEdoctorStatus(bookingId).catch(() => {});

    const intent = await this.paymentIntent.findByBooking(bookingId);
    if (!intent) return { status: 'not_found' };
    return {
      intentId:    intent.id,
      status:      intent.status,
      provider:    intent.provider,
      amount:      intent.amount,
      currency:    intent.currency,
      authorizedAt: intent.authorizedAt,
      capturedAt:   intent.capturedAt,
    };
  }

  /** POST /payments/webhook/edoctor — callback statut depuis le serveur edoctor */
  @Post('webhook/edoctor')
  @SkipThrottle()
  async handleEdoctorWebhook(@Body() body: Record<string, any>) {
    const paymentId = String(body?.id ?? body?.payment_id ?? '');
    const status    = String(body?.status ?? '');
    this.logger.log(`EdoctorPay webhook: id=${paymentId} status=${status}`);

    if (!paymentId) return { received: true };

    // Retrouver le PaymentIntent par providerRef
    const intent = await this.prisma.paymentIntent.findFirst({
      where: { providerRef: paymentId },
    });

    if (intent && intent.status === 'pending') {
      const mapped = (status === 'success' || status === 'successful') ? 'captured'
        : (status === 'failed' || status === 'cancelled') ? 'failed' : null;

      if (mapped === 'captured') {
        await this.prisma.paymentIntent.update({
          where: { id: intent.id },
          data: { status: 'captured', authorizedAt: new Date(), capturedAt: new Date() },
        });
      } else if (mapped === 'failed') {
        await this.prisma.paymentIntent.update({
          where: { id: intent.id },
          data: { status: 'failed', failedAt: new Date() },
        });
      }
    }

    return { received: true };
  }

  /**
   * POST /payments/booking/:bookingId/tip
   * Initie un pourboire pour le chauffeur après la course.
   */
  @Post('booking/:bookingId/tip')
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @UseGuards(JwtAuthGuard)
  async initiateTip(
    @Param('bookingId') bookingId: string,
    @Request() req: any,
    @Body() body: { amount: number; currency?: string; provider: string },
  ) {
    const user = await this.prisma.user.findUnique({
      where:  { id: req.user.id },
      select: { name: true, phone: true, email: true },
    });

    return this.tip.initiate({
      bookingId,
      payerId:       req.user.id,
      amount:        body.amount,
      currency:      body.currency ?? 'XAF',
      provider:      body.provider,
      passengerName:  user?.name  ?? '',
      passengerPhone: user?.phone ?? '',
      passengerEmail: user?.email ?? '',
    });
  }

  /**
   * POST /payments/booking/:bookingId/split
   * Initie un paiement fractionné — envoie des liens SMS aux co-payeurs.
   */
  @Post('booking/:bookingId/split')
  @UseGuards(JwtAuthGuard)
  async initiateSplitPayment(
    @Param('bookingId') bookingId: string,
    @Request() req: any,
    @Body() body: {
      participants: Array<{ phone: string; name?: string; shareAmount: number; shareCurrency: string }>;
    },
  ) {
    return this.split.initiateSplit({
      bookingId,
      participants:  body.participants,
      initiatorId:   req.user.id,
    });
  }

  /**
   * GET /payments/split/:token
   * Retourne les infos d'un lien de paiement fractionné (public, sans auth).
   */
  @Get('split/:token')
  @SkipThrottle()
  async getSplitLink(@Param('token') token: string) {
    const link = await this.prisma.paymentLink.findUnique({
      where:   { token },
      include: { booking: { select: { destination: true, estimatedPrice: true, currency: true } } },
    });
    if (!link) throw new BadRequestException('Lien introuvable');
    if (link.status === 'expired' || link.expiresAt < new Date()) return { expired: true };
    return {
      token,
      amount:      link.amount,
      currency:    link.currency,
      destination: link.booking?.destination,
      status:      link.status,
      expiresAt:   link.expiresAt,
    };
  }

  /**
   * POST /payments/split/:token/pay
   * Paiement d'une part fractionnée via lien (sans nécessiter de compte).
   */
  @Post('split/:token/pay')
  @SkipThrottle()
  async payByToken(
    @Param('token') token: string,
    @Body() body: {
      provider: 'orange_money_cm' | 'mtn_cm' | 'card';
      payerName: string;
      payerPhone: string;
      payerEmail?: string;
    },
  ) {
    return this.split.payByToken({
      inviteToken:  token,
      provider:     body.provider,
      payerName:    body.payerName,
      payerPhone:   body.payerPhone,
      payerEmail:   body.payerEmail ?? '',
    });
  }

  // ── Gains chauffeur ───────────────────────────────────────────────────────

  /**
   * GET /payments/earnings
   * Retourne le solde du DriverEarningsWallet du chauffeur connecté.
   */
  @Get('earnings')
  @UseGuards(JwtAuthGuard)
  async getDriverEarnings(@Request() req: any) {
    const profile = await this.prisma.driverProfile.findFirst({
      where:  { userId: req.user.id },
      select: { id: true },
    });
    if (!profile) throw new BadRequestException('Profil chauffeur introuvable');
    return this.payout.getBalance(profile.id);
  }

  /**
   * POST /payments/withdraw
   * Demande de virement vers le compte Mobile Money du chauffeur.
   */
  @Post('withdraw')
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @UseGuards(JwtAuthGuard)
  async requestWithdrawal(
    @Request() req: any,
    @Body() body: { amount: number },
  ) {
    const profile = await this.prisma.driverProfile.findFirst({
      where:  { userId: req.user.id },
      select: { id: true },
    });
    if (!profile) throw new BadRequestException('Profil chauffeur introuvable');
    return this.payout.disburse({ driverProfileId: profile.id, amount: body.amount });
  }

  // ── Taux de change public (aucune auth requise) ──────────────────────────

  /**
   * GET /payments/exchange-rate?from=XAF&to=EUR
   * Retourne le taux de conversion entre deux devises.
   * Endpoint public — utilisé par les apps mobile pour l'affichage multi-devises.
   */
  @Get('exchange-rate')
  @SkipThrottle()
  async getExchangeRate(
    @Query('from') from = 'XAF',
    @Query('to')   to   = 'EUR',
  ) {
    const fromUpper = from.toUpperCase();
    const toUpper   = to.toUpperCase();
    const rate = await this.exchangeRate.getRate(fromUpper, toUpper);
    return { from: fromUpper, to: toUpper, rate, timestamp: Date.now() };
  }

  // ── Helper : retrouve un bookingId depuis une référence de paiement ────────

  private async resolveBookingFromRef(ref: string): Promise<string | null> {
    const intent = await this.prisma.paymentIntent.findFirst({ where: { providerRef: ref } });
    return intent?.bookingId ?? null;
  }

  private async confirmAccessPass(merchantRef: string): Promise<void> {
    // Look up userId via transaction → wallet → user
    const tx = await this.prisma.transaction.findFirst({
      where: { reference: merchantRef },
      select: { wallet: { select: { userId: true } } },
    });
    if (!tx?.wallet?.userId) {
      this.logger.warn(`confirmAccessPass: transaction introuvable pour ref ${merchantRef}`);
      return;
    }
    const userId = tx.wallet.userId;
    await this.prisma.transaction.updateMany({
      where: { reference: merchantRef },
      data:  { status: 'completed' },
    });
    await this.usersService.confirmPass(userId);
    this.logger.log(`Pass d'accès confirmé: userId=${userId} ref=${merchantRef}`);
  }

  private async confirmRegistrationFee(providerRef: string): Promise<void> {
    const regPayment = await this.prisma.driverRegistrationPayment.findFirst({ where: { providerRef } });
    if (!regPayment || regPayment.status === 'paid') return;
    await this.prisma.$transaction([
      this.prisma.driverRegistrationPayment.update({
        where: { id: regPayment.id },
        data:  { status: 'paid', paidAt: new Date() },
      }),
      this.prisma.driverProfile.update({
        where: { id: regPayment.driverProfileId },
        data:  {
          registrationFeePaid:   true,
          registrationFeeAmount: regPayment.totalAmount,
          registrationFeePaidAt: new Date(),
          cashDepositBalance:    { increment: regPayment.depositAmount },
        },
      }),
    ]);
    this.logger.log(`Frais inscription confirmés via webhook: driverId=${regPayment.driverProfileId}`);
  }
}
