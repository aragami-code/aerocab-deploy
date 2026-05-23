"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var PaymentIntentService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PaymentIntentService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../database/prisma.service");
const exchange_rate_service_1 = require("./exchange-rate.service");
const notchpay_service_1 = require("./notchpay.service");
const stripe_service_1 = require("./stripe.service");
const settings_service_1 = require("../settings/settings.service");
let PaymentIntentService = PaymentIntentService_1 = class PaymentIntentService {
    constructor(prisma, exchange, notchpay, stripe, settings) {
        this.prisma = prisma;
        this.exchange = exchange;
        this.notchpay = notchpay;
        this.stripe = stripe;
        this.settings = settings;
        this.logger = new common_1.Logger(PaymentIntentService_1.name);
    }
    /**
     * Crée un PaymentIntent en DB et initie le paiement auprès du provider.
     * - cash         → autorisé immédiatement, sans API externe
     * - orange/mtn   → NotchPay redirect URL
     * - card         → Stripe PaymentIntent (capture manuelle), retourne clientSecret
     */
    async create(params) {
        var _a, _b;
        const { bookingId, provider, amount, currency } = params;
        const booking = await this.prisma.booking.findUnique({
            where: { id: bookingId },
            select: { id: true, paymentIntent: { select: { id: true, status: true } } },
        });
        if (!booking)
            throw new common_1.NotFoundException('Booking introuvable');
        const existing = booking.paymentIntent;
        if (existing && !['failed', 'voided'].includes(existing.status)) {
            throw new common_1.BadRequestException('Un PaymentIntent actif existe déjà pour ce booking');
        }
        // Taux de change gelé au moment de la réservation (CDC O2)
        const baseCurrency = 'XAF';
        const exchangeRate = await this.exchange.getRate(currency, baseCurrency);
        const amountBase = Math.round(amount * exchangeRate * 100) / 100;
        const intent = await this.prisma.paymentIntent.upsert({
            where: { bookingId },
            create: {
                bookingId,
                participantId: (_a = params.participantId) !== null && _a !== void 0 ? _a : null,
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
                status: 'pending',
                providerRef: null,
                authorizedAt: null,
                capturedAt: null,
                failedAt: null,
                metadata: null,
            },
        });
        const backendUrl = await this.settings.get('backend_url', (_b = process.env.BACKEND_URL) !== null && _b !== void 0 ? _b : 'https://aerocab-api.onrender.com');
        const reference = `BOOKING-${provider.toUpperCase()}-${bookingId.slice(0, 8)}-${Date.now()}`;
        const description = `Course AeroCab — ${bookingId.slice(0, 8)}`;
        // ── Cash ─────────────────────────────────────────────────────────────────
        if (provider === 'cash') {
            await this.prisma.paymentIntent.update({
                where: { id: intent.id },
                data: { providerRef: `cash_${bookingId}`, status: 'authorized', authorizedAt: new Date() },
            });
            return { intentId: intent.id };
        }
        // ── Mobile Money (Orange Money CM / MTN MoMo CM via NotchPay) ────────────
        if (provider === 'orange_money_cm' || provider === 'mtn_cm') {
            const amountXaf = currency === 'XAF' ? amount : amountBase;
            const { paymentUrl } = await this.notchpay.initiate({
                transactionId: reference,
                amount: amountXaf,
                currency: 'XAF',
                description,
                customerName: params.passengerName,
                customerPhone: params.passengerPhone,
                customerEmail: params.passengerEmail,
            });
            await this.prisma.paymentIntent.update({
                where: { id: intent.id },
                data: { providerRef: reference, metadata: { notchpayInitRef: reference } },
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
                currency: currency.toLowerCase(),
                description,
                customerEmail: params.passengerEmail,
                backendUrl,
                bookingId,
            });
            await this.prisma.paymentIntent.update({
                where: { id: intent.id },
                data: { providerRef: paymentIntentId, metadata: { stripePaymentIntentId: paymentIntentId } },
            });
            return { intentId: intent.id, clientSecret };
        }
        throw new common_1.BadRequestException(`Provider inconnu: ${provider}`);
    }
    /**
     * Marque le PaymentIntent comme autorisé depuis un webhook NotchPay.
     * Pour Mobile Money, l'autorisation = capture immédiate (pas de capture séparée).
     */
    async markAuthorizedByNotchPay(bookingId, notchpayConfirmedRef) {
        var _a;
        const intent = await this.prisma.paymentIntent.findUnique({ where: { bookingId } });
        if (!intent || intent.status !== 'pending')
            return;
        const meta = (_a = intent.metadata) !== null && _a !== void 0 ? _a : {};
        const update = {
            status: 'captured', // Mobile Money = capture immédiate
            authorizedAt: new Date(),
            capturedAt: new Date(),
            metadata: Object.assign(Object.assign({}, meta), { notchpayConfirmedRef: notchpayConfirmedRef !== null && notchpayConfirmedRef !== void 0 ? notchpayConfirmedRef : '' }),
        };
        await this.prisma.paymentIntent.update({ where: { id: intent.id }, data: update });
        this.logger.log(`PaymentIntent ${intent.id} autorisé+capturé (Mobile Money NotchPay)`);
    }
    /**
     * Marque le PaymentIntent comme autorisé depuis un webhook Stripe
     * (event: payment_intent.amount_capturable_updated).
     * La capture effective se fera à la fin de la course.
     */
    async markAuthorizedByStripe(stripePaymentIntentId) {
        const intent = await this.prisma.paymentIntent.findFirst({
            where: { providerRef: stripePaymentIntentId },
        });
        if (!intent || intent.status !== 'pending')
            return;
        await this.prisma.paymentIntent.update({
            where: { id: intent.id },
            data: { status: 'authorized', authorizedAt: new Date() },
        });
        this.logger.log(`PaymentIntent ${intent.id} autorisé (Stripe card, capture en attente)`);
    }
    /**
     * Capture les fonds à la fin de la course.
     * - card         → capture Stripe
     * - mobile money → déjà capturé lors de l'autorisation, no-op
     * - cash         → aucune API, update DB uniquement
     */
    async capture(bookingId) {
        const intent = await this.prisma.paymentIntent.findUnique({ where: { bookingId } });
        if (!intent)
            throw new common_1.NotFoundException('PaymentIntent introuvable');
        if (intent.status === 'captured')
            return;
        if (!['authorized'].includes(intent.status)) {
            throw new common_1.BadRequestException(`Capture impossible — statut: ${intent.status}`);
        }
        if (intent.provider === 'card') {
            if (!intent.providerRef)
                throw new common_1.BadRequestException('providerRef Stripe manquant');
            await this.stripe.capturePaymentIntent(intent.providerRef);
        }
        await this.prisma.paymentIntent.update({
            where: { id: intent.id },
            data: { status: 'captured', capturedAt: new Date() },
        });
        this.logger.log(`PaymentIntent ${intent.id} capturé (${intent.provider})`);
    }
    /**
     * Rembourse le passager lors d'une annulation.
     * penaltyPct = 0  → avant dispatch (remboursement total)
     * penaltyPct = 20 → après dispatch (20% retenu par AeroCab)
     */
    async refund(bookingId, params) {
        var _a, _b;
        const intent = await this.prisma.paymentIntent.findUnique({ where: { bookingId } });
        if (!intent)
            return;
        if (['refunded', 'voided', 'failed'].includes(intent.status))
            return;
        const penaltyPct = (_a = params.penaltyPct) !== null && _a !== void 0 ? _a : 0;
        const refundAmount = intent.amount * (1 - penaltyPct / 100);
        if (intent.provider === 'card' && intent.providerRef) {
            if (intent.status === 'authorized') {
                // Pré-auth non capturée → simple annulation (void)
                await this.stripe.cancelPaymentIntent(intent.providerRef);
            }
            else if (intent.status === 'captured') {
                const refundCents = Math.round(refundAmount * 100);
                await this.stripe.refundPaymentIntent(intent.providerRef, refundCents);
            }
        }
        // Mobile Money déjà capturé → remboursement via transfer NotchPay (géré manuellement en MVP)
        if ((intent.provider === 'orange_money_cm' || intent.provider === 'mtn_cm') &&
            intent.status === 'captured') {
            this.logger.warn(`Remboursement Mobile Money requis: booking=${bookingId} montant=${refundAmount} ${intent.currency}`);
        }
        const meta = (_b = intent.metadata) !== null && _b !== void 0 ? _b : {};
        await this.prisma.paymentIntent.update({
            where: { id: intent.id },
            data: {
                status: 'refunded',
                refundedAt: new Date(),
                metadata: Object.assign(Object.assign({}, meta), { refundReason: params.reason, penaltyPct, refundAmount }),
            },
        });
        this.logger.log(`PaymentIntent ${intent.id} remboursé (pénalité ${penaltyPct}%)`);
    }
    /**
     * Annule un intent encore en attente (passager n'a pas finalisé le paiement).
     */
    async void(bookingId) {
        const intent = await this.prisma.paymentIntent.findUnique({ where: { bookingId } });
        if (!intent)
            return;
        if (!['pending', 'authorized'].includes(intent.status))
            return;
        if (intent.provider === 'card' && intent.providerRef && intent.status === 'authorized') {
            await this.stripe.cancelPaymentIntent(intent.providerRef).catch(() => { });
        }
        await this.prisma.paymentIntent.update({
            where: { id: intent.id },
            data: { status: 'voided' },
        });
        this.logger.log(`PaymentIntent ${intent.id} annulé (void)`);
    }
    async findByBooking(bookingId) {
        return this.prisma.paymentIntent.findUnique({ where: { bookingId } });
    }
    async findByProviderRef(providerRef) {
        return this.prisma.paymentIntent.findFirst({ where: { providerRef } });
    }
};
exports.PaymentIntentService = PaymentIntentService;
exports.PaymentIntentService = PaymentIntentService = PaymentIntentService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        exchange_rate_service_1.ExchangeRateService,
        notchpay_service_1.NotchPayService,
        stripe_service_1.StripeService,
        settings_service_1.SettingsService])
], PaymentIntentService);
//# sourceMappingURL=payment-intent.service.js.map