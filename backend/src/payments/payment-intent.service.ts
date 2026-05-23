import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { ExchangeRateService } from './exchange-rate.service';
import { NotchPayService } from './notchpay.service';
import { EdoctorPaymentService } from './edoctor-payment.service';
import { StripeService } from './stripe.service';
import { SettingsService } from '../settings/settings.service';

export type IntentProvider = 'orange_money_cm' | 'mtn_cm' | 'card' | 'cash';

export interface CreateIntentParams {
  bookingId: string;
  provider: IntentProvider;
  amount: number;       // montant dans la devise de la course
  currency: string;     // devise de la course (XAF, USD, EUR, ...)
  operatingCountry: string;
  passengerName: string;
  passengerPhone: string;
  passengerEmail: string;
  participantId?: string;
}

export interface CreateIntentResult {
  intentId: string;
  paymentUrl?: string;    // Mobile Money
  clientSecret?: string;  // Stripe card
}

@Injectable()
export class PaymentIntentService {
  private readonly logger = new Logger(PaymentIntentService.name);

  constructor(
    private prisma: PrismaService,
    private exchange: ExchangeRateService,
    private notchpay: NotchPayService,
    private edoctor: EdoctorPaymentService,
    private stripe: StripeService,
    private settings: SettingsService,
  ) {}

  /**
   * Crée un PaymentIntent en DB et initie le paiement auprès du provider.
   * - cash         → autorisé immédiatement, sans API externe
   * - orange/mtn   → NotchPay redirect URL
   * - card         → Stripe PaymentIntent (capture manuelle), retourne clientSecret
   */
  async create(params: CreateIntentParams): Promise<CreateIntentResult> {
    const { bookingId, provider, amount, currency } = params;

    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      select: { id: true, paymentIntent: { select: { id: true, status: true } } },
    });
    if (!booking) throw new NotFoundException('Booking introuvable');

    const existing = booking.paymentIntent;
    if (existing && !['failed', 'voided'].includes(existing.status)) {
      throw new BadRequestException('Un PaymentIntent actif existe déjà pour ce booking');
    }

    // Taux de change gelé au moment de la réservation (CDC O2)
    const baseCurrency = 'XAF';
    const exchangeRate = await this.exchange.getRate(currency, baseCurrency);
    const amountBase   = Math.round(amount * exchangeRate * 100) / 100;

    const intent = await this.prisma.paymentIntent.upsert({
      where: { bookingId },
      create: {
        bookingId,
        participantId: params.participantId ?? null,
        provider,
        amount,
        currency,
        amountBase,
        baseCurrency,
        exchangeRate,
        status: 'pending',
      },
      update: {
        provider,
        amount,
        currency,
        amountBase,
        baseCurrency,
        exchangeRate,
        status:       'pending',
        providerRef:  null,
        authorizedAt: null,
        capturedAt:   null,
        failedAt:     null,
        metadata:     null,
      },
    });

    const backendUrl  = await this.settings.get('backend_url', process.env.BACKEND_URL ?? 'https://aerocab-api.onrender.com');
    const reference   = `BOOKING-${provider.toUpperCase()}-${bookingId.slice(0, 8)}-${Date.now()}`;
    const description = `Course AeroCab — ${bookingId.slice(0, 8)}`;

    // ── Cash ─────────────────────────────────────────────────────────────────
    if (provider === 'cash') {
      await this.prisma.paymentIntent.update({
        where: { id: intent.id },
        data:  { providerRef: `cash_${bookingId}`, status: 'authorized', authorizedAt: new Date() },
      });
      return { intentId: intent.id };
    }

    // ── Mobile Money (Orange Money CM / MTN MoMo CM) ─────────────────────────
    if (provider === 'orange_money_cm' || provider === 'mtn_cm') {
      const amountXaf = currency === 'XAF' ? amount : amountBase;

      // Routage : EdoctorPay si configuré, sinon NotchPay en fallback
      const useEdoctor = await this.edoctor.isConfigured() &&
        (await this.settings.get('payment_edoctor_enabled', 'false')) === 'true';

      if (useEdoctor) {
        const payment = await this.edoctor.collect({
          amount:      amountXaf,
          phone:       params.passengerPhone,
          reference,
          currency:    'XAF',
          description,
          metadata:    { bookingId, provider },
        });

        await this.prisma.paymentIntent.update({
          where: { id: intent.id },
          data:  {
            providerRef: payment.id,
            metadata:    { edoctorPaymentId: payment.id, edoctorRef: reference, via: 'edoctor' },
          },
        });

        // Pas de redirect URL — le passager reçoit une notification push sur son téléphone
        return { intentId: intent.id };
      }

      // Fallback NotchPay
      let paymentUrl: string;
      try {
        ({ paymentUrl } = await this.notchpay.initiate({
          transactionId: reference,
          amount:        amountXaf,
          currency:      'XAF',
          description,
          customerName:  params.passengerName,
          customerPhone: params.passengerPhone,
          customerEmail: params.passengerEmail,
        }));
      } catch (err) {
        this.logger.error(`NotchPay initiate failed for booking ${bookingId}: ${(err as Error).message}`);
        await this.prisma.paymentIntent.update({
          where: { id: intent.id },
          data:  { status: 'failed', failedAt: new Date() },
        });
        await this.prisma.booking.update({
          where: { id: bookingId },
          data:  { status: 'cancelled' },
        });
        throw new BadRequestException(
          'Service de paiement mobile temporairement indisponible. Veuillez utiliser Espèces ou Carte bancaire.',
        );
      }

      await this.prisma.paymentIntent.update({
        where: { id: intent.id },
        data:  { providerRef: reference, metadata: { notchpayInitRef: reference } },
      });

      return { intentId: intent.id, paymentUrl };
    }

    // ── Carte bancaire (Stripe PaymentIntent, capture manuelle) ───────────────
    if (provider === 'card') {
      // Stripe exige des centimes (ou centièmes selon la devise)
      const amountCents = Math.round(amount * 100);

      const { paymentIntentId, clientSecret } = await this.stripe.createPaymentIntent({
        reference,
        amountCents,
        currency:      currency.toLowerCase(),
        description,
        customerEmail: params.passengerEmail,
        backendUrl,
        bookingId,
      });

      await this.prisma.paymentIntent.update({
        where: { id: intent.id },
        data:  { providerRef: paymentIntentId, metadata: { stripePaymentIntentId: paymentIntentId } },
      });

      return { intentId: intent.id, clientSecret };
    }

    throw new BadRequestException(`Provider inconnu: ${provider}`);
  }

  /**
   * Marque le PaymentIntent comme autorisé depuis un webhook NotchPay.
   * Pour Mobile Money, l'autorisation = capture immédiate (pas de capture séparée).
   */
  async markAuthorizedByNotchPay(bookingId: string, notchpayConfirmedRef?: string): Promise<void> {
    const intent = await this.prisma.paymentIntent.findUnique({ where: { bookingId } });
    if (!intent || intent.status !== 'pending') return;

    const meta   = (intent.metadata as any) ?? {};
    const update = {
      status:       'captured' as const, // Mobile Money = capture immédiate
      authorizedAt: new Date(),
      capturedAt:   new Date(),
      metadata:     { ...meta, notchpayConfirmedRef: notchpayConfirmedRef ?? '' },
    };

    await this.prisma.paymentIntent.update({ where: { id: intent.id }, data: update });
    this.logger.log(`PaymentIntent ${intent.id} autorisé+capturé (Mobile Money NotchPay)`);
  }

  /**
   * Interroge EdoctorPay pour le statut d'un paiement en cours.
   * Appelé lors de chaque GET /payments/booking/:id/status côté passager (polling).
   * Si succès → marque captured immédiatement.
   */
  async syncEdoctorStatus(bookingId: string): Promise<void> {
    const intent = await this.prisma.paymentIntent.findUnique({ where: { bookingId } });
    if (!intent || intent.status !== 'pending') return;

    const meta = (intent.metadata as any) ?? {};
    if (meta.via !== 'edoctor' || !meta.edoctorPaymentId) return;

    const status = await this.edoctor.checkStatus(String(meta.edoctorPaymentId)).catch(() => 'pending' as const);

    if (status === 'success') {
      await this.prisma.paymentIntent.update({
        where: { id: intent.id },
        data: {
          status:       'captured',
          authorizedAt: new Date(),
          capturedAt:   new Date(),
          metadata:     { ...meta, edoctorConfirmedAt: new Date().toISOString() },
        },
      });
      this.logger.log(`PaymentIntent ${intent.id} capturé via EdoctorPay`);
    } else if (status === 'failed' || status === 'cancelled') {
      await this.prisma.paymentIntent.update({
        where: { id: intent.id },
        data:  { status: 'failed', failedAt: new Date() },
      });
    }
  }

  /**
   * Marque le PaymentIntent comme autorisé depuis un webhook Stripe
   * (event: payment_intent.amount_capturable_updated).
   * La capture effective se fera à la fin de la course.
   */
  async markAuthorizedByStripe(stripePaymentIntentId: string): Promise<void> {
    const intent = await this.prisma.paymentIntent.findFirst({
      where: { providerRef: stripePaymentIntentId },
    });
    if (!intent || intent.status !== 'pending') return;

    await this.prisma.paymentIntent.update({
      where: { id: intent.id },
      data:  { status: 'authorized', authorizedAt: new Date() },
    });
    this.logger.log(`PaymentIntent ${intent.id} autorisé (Stripe card, capture en attente)`);
  }

  /**
   * Capture les fonds à la fin de la course.
   * - card         → capture Stripe
   * - mobile money → déjà capturé lors de l'autorisation, no-op
   * - cash         → aucune API, update DB uniquement
   */
  async capture(bookingId: string): Promise<void> {
    const intent = await this.prisma.paymentIntent.findUnique({ where: { bookingId } });
    if (!intent) throw new NotFoundException('PaymentIntent introuvable');
    if (intent.status === 'captured') return;
    if (!['authorized'].includes(intent.status)) {
      throw new BadRequestException(`Capture impossible — statut: ${intent.status}`);
    }

    if (intent.provider === 'card') {
      if (!intent.providerRef) throw new BadRequestException('providerRef Stripe manquant');
      await this.stripe.capturePaymentIntent(intent.providerRef);
    }

    await this.prisma.paymentIntent.update({
      where: { id: intent.id },
      data:  { status: 'captured', capturedAt: new Date() },
    });
    this.logger.log(`PaymentIntent ${intent.id} capturé (${intent.provider})`);
  }

  /**
   * Rembourse le passager lors d'une annulation.
   * penaltyPct = 0  → avant dispatch (remboursement total)
   * penaltyPct = 20 → après dispatch (20% retenu par AeroCab)
   */
  async refund(bookingId: string, params: { reason: string; penaltyPct?: number }): Promise<void> {
    const intent = await this.prisma.paymentIntent.findUnique({ where: { bookingId } });
    if (!intent) return;
    if (['refunded', 'voided', 'failed'].includes(intent.status)) return;

    const penaltyPct   = params.penaltyPct ?? 0;
    const refundAmount = intent.amount * (1 - penaltyPct / 100);

    if (intent.provider === 'card' && intent.providerRef) {
      if (intent.status === 'authorized') {
        // Pré-auth non capturée → simple annulation (void)
        await this.stripe.cancelPaymentIntent(intent.providerRef);
      } else if (intent.status === 'captured') {
        const refundCents = Math.round(refundAmount * 100);
        await this.stripe.refundPaymentIntent(intent.providerRef, refundCents);
      }
    }

    // Mobile Money déjà capturé → remboursement via transfer NotchPay (géré manuellement en MVP)
    if (
      (intent.provider === 'orange_money_cm' || intent.provider === 'mtn_cm') &&
      intent.status === 'captured'
    ) {
      this.logger.warn(
        `Remboursement Mobile Money requis: booking=${bookingId} montant=${refundAmount} ${intent.currency}`,
      );
    }

    const meta = (intent.metadata as any) ?? {};
    await this.prisma.paymentIntent.update({
      where: { id: intent.id },
      data: {
        status:     'refunded',
        refundedAt: new Date(),
        metadata:   { ...meta, refundReason: params.reason, penaltyPct, refundAmount },
      },
    });
    this.logger.log(`PaymentIntent ${intent.id} remboursé (pénalité ${penaltyPct}%)`);
  }

  /**
   * Annule un intent encore en attente (passager n'a pas finalisé le paiement).
   */
  async void(bookingId: string): Promise<void> {
    const intent = await this.prisma.paymentIntent.findUnique({ where: { bookingId } });
    if (!intent) return;
    if (!['pending', 'authorized'].includes(intent.status)) return;

    if (intent.provider === 'card' && intent.providerRef && intent.status === 'authorized') {
      await this.stripe.cancelPaymentIntent(intent.providerRef).catch(() => {});
    }

    await this.prisma.paymentIntent.update({
      where: { id: intent.id },
      data:  { status: 'voided' },
    });
    this.logger.log(`PaymentIntent ${intent.id} annulé (void)`);
  }

  async findByBooking(bookingId: string) {
    return this.prisma.paymentIntent.findUnique({ where: { bookingId } });
  }

  async findByProviderRef(providerRef: string) {
    return this.prisma.paymentIntent.findFirst({ where: { providerRef } });
  }
}
