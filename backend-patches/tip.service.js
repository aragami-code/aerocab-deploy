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
var TipService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.TipService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../database/prisma.service");
const notchpay_service_1 = require("./notchpay.service");
const stripe_service_1 = require("./stripe.service");
const settings_service_1 = require("../settings/settings.service");
const payout_service_1 = require("./payout.service");
let TipService = TipService_1 = class TipService {
    constructor(prisma, notchpay, stripe, settings, payout) {
        this.prisma = prisma;
        this.notchpay = notchpay;
        this.stripe = stripe;
        this.settings = settings;
        this.payout = payout;
        this.logger = new common_1.Logger(TipService_1.name);
    }
    /**
     * Initie un pourboire pour le chauffeur après la course.
     * - 100% du pourboire va au chauffeur (aucune commission AeroCab)
     * - Provider hérité du mode de paiement original de la course
     * - Disponible uniquement sur les courses completed
     */
    async initiate(params) {
        var _a;
        const { bookingId, payerId, amount, currency, provider } = params;
        const booking = await this.prisma.booking.findUnique({
            where: { id: bookingId },
            select: {
                id: true,
                status: true,
                driverProfileId: true,
            },
        });
        if (!booking)
            throw new common_1.NotFoundException('Course introuvable');
        if (booking.status !== 'completed') {
            throw new common_1.BadRequestException("Le pourboire n'est disponible que sur les courses terminées");
        }
        const maxTipRaw = await this.settings.get('tip_max_amount', '10000');
        const maxTip = parseFloat(maxTipRaw);
        if (amount > maxTip) {
            throw new common_1.BadRequestException(`Pourboire maximum: ${maxTip} ${currency}`);
        }
        const reference = `TIP-${bookingId.slice(0, 8)}-${Date.now()}`;
        const tipEnabled = await this.settings.get('tip_enabled', 'true');
        if (tipEnabled === 'false')
            throw new common_1.BadRequestException('Les pourboires sont désactivés');
        const tip = await this.prisma.tipTransaction.create({
            data: {
                bookingId,
                payerId,
                driverProfileId: booking.driverProfileId,
                amount,
                currency,
                provider,
                status: 'pending',
            },
        });
        const description = `Pourboire AeroCab — course ${bookingId.slice(0, 8)}`;
        // ── Mobile Money (NotchPay) ──────────────────────────────────────────────
        if (provider === 'orange_money_cm' || provider === 'mtn_cm') {
            const { paymentUrl } = await this.notchpay.initiate({
                transactionId: reference,
                amount: currency === 'XAF' ? amount : amount,
                currency: 'XAF',
                description,
                customerName: params.passengerName,
                customerPhone: params.passengerPhone,
                customerEmail: params.passengerEmail,
            });
            await this.prisma.tipTransaction.update({
                where: { id: tip.id },
                data: { providerRef: reference },
            });
            return { tipId: tip.id, paymentUrl };
        }
        // ── Carte bancaire (Stripe) ──────────────────────────────────────────────
        if (provider === 'card') {
            const backendUrl = await this.settings.get('backend_url', (_a = process.env.BACKEND_URL) !== null && _a !== void 0 ? _a : '');
            const { paymentIntentId, clientSecret } = await this.stripe.createPaymentIntent({
                reference,
                amountCents: Math.round(amount * 100),
                currency: currency.toLowerCase(),
                description,
                customerEmail: params.passengerEmail,
                backendUrl,
                bookingId,
            });
            await this.prisma.tipTransaction.update({
                where: { id: tip.id },
                data: { providerRef: paymentIntentId },
            });
            return { tipId: tip.id, clientSecret };
        }
        throw new common_1.BadRequestException(`Provider de pourboire non supporté: ${provider}`);
    }
    /**
     * Capture le pourboire (appelé par webhook NotchPay ou Stripe).
     * Crédite directement le DriverEarningsWallet du chauffeur.
     */
    async capture(tipId) {
        const tip = await this.prisma.tipTransaction.findUnique({ where: { id: tipId } });
        if (!tip || tip.status === 'captured')
            return;
        // Pour Stripe : capture du PaymentIntent
        if (tip.provider === 'card' && tip.providerRef) {
            await this.stripe.capturePaymentIntent(tip.providerRef).catch((err) => {
                this.logger.warn(`Tip Stripe capture error: ${err.message}`);
            });
        }
        await this.prisma.tipTransaction.update({
            where: { id: tipId },
            data: { status: 'captured', capturedAt: new Date() },
        });
        // Créditer le DriverEarningsWallet (100% au chauffeur, sans commission)
        await this.payout.ensureWallet(tip.driverProfileId);
        await this.prisma.driverEarningsWallet.update({
            where: { driverProfileId: tip.driverProfileId },
            data: { balance: { increment: tip.amount }, totalEarned: { increment: tip.amount } },
        });
        // Mettre à jour le tipAmount sur le BookingPayout s'il existe
        await this.prisma.bookingPayout.updateMany({
            where: { bookingId: tip.bookingId },
            data: { tipAmount: { increment: tip.amount } },
        });
        this.logger.log(`Pourboire capturé: tip=${tipId} driver=${tip.driverProfileId} montant=${tip.amount}`);
    }
    async captureByProviderRef(providerRef) {
        const tip = await this.prisma.tipTransaction.findFirst({ where: { providerRef } });
        if (tip)
            await this.capture(tip.id);
    }
};
exports.TipService = TipService;
exports.TipService = TipService = TipService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        notchpay_service_1.NotchPayService,
        stripe_service_1.StripeService,
        settings_service_1.SettingsService,
        payout_service_1.PayoutService])
], TipService);
//# sourceMappingURL=tip.service.js.map