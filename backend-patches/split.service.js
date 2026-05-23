"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var SplitService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SplitService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../database/prisma.service");
const smart_sms_router_1 = require("../sms/smart-sms.router");
const settings_service_1 = require("../settings/settings.service");
const payment_intent_service_1 = require("./payment-intent.service");
const crypto = __importStar(require("crypto"));
let SplitService = SplitService_1 = class SplitService {
    constructor(prisma, sms, settings, paymentIntent) {
        this.prisma = prisma;
        this.sms = sms;
        this.settings = settings;
        this.paymentIntent = paymentIntent;
        this.logger = new common_1.Logger(SplitService_1.name);
    }
    /**
     * Initie un paiement fractionné pour une course.
     * Crée un BookingParticipant par co-payeur avec un inviteToken unique.
     * Envoie un lien de paiement via SMS (sans nécessiter l'app).
     */
    async initiateSplit(params) {
        var _a, _b, _c;
        const { bookingId, participants } = params;
        const booking = await this.prisma.booking.findUnique({
            where: { id: bookingId },
            select: { id: true, status: true, isSplitPayment: true, estimatedPrice: true },
        });
        if (!booking)
            throw new common_1.NotFoundException('Booking introuvable');
        if (booking.status !== 'pending') {
            throw new common_1.BadRequestException('Le paiement fractionné doit être initié avant l\'envoi du chauffeur');
        }
        const maxParticipants = parseInt(await this.settings.get('split_max_participants', '4'));
        if (participants.length > maxParticipants) {
            throw new common_1.BadRequestException(`Maximum ${maxParticipants} participants par paiement fractionné`);
        }
        const frontendUrl = await this.settings.get('frontend_url', (_a = process.env.BACKEND_URL) !== null && _a !== void 0 ? _a : 'https://aerocab.com');
        const ttlMinutes = parseInt(await this.settings.get('split_invite_ttl_min', '60'));
        const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);
        const results = [];
        for (const p of participants) {
            const inviteToken = crypto.randomBytes(16).toString('hex');
            const paymentLink = `${frontendUrl}/pay/${inviteToken}`;
            const participant = await this.prisma.bookingParticipant.create({
                data: {
                    bookingId,
                    phone: p.phone,
                    name: (_b = p.name) !== null && _b !== void 0 ? _b : null,
                    shareAmount: p.shareAmount,
                    shareCurrency: p.shareCurrency,
                    inviteToken,
                    inviteExpiresAt: expiresAt,
                    status: 'pending',
                },
            });
            // Créer le PaymentLink dans la table unifiée (F4 + F16)
            await this.prisma.paymentLink.create({
                data: {
                    token: inviteToken,
                    bookingId,
                    participantId: participant.id,
                    source: 'split',
                    amount: p.shareAmount,
                    currency: p.shareCurrency,
                    expiresAt,
                    status: 'pending',
                },
            });
            // Envoyer le lien par SMS
            const smsText = this.buildSplitSms(paymentLink, p.shareAmount, p.shareCurrency, (_c = booking.estimatedPrice) !== null && _c !== void 0 ? _c : 0);
            await this.sms.send(p.phone, smsText).catch((err) => {
                this.logger.warn(`Split SMS envoi échoué vers ${p.phone}: ${err.message}`);
            });
            await this.prisma.bookingParticipant.update({
                where: { id: participant.id },
                data: { inviteSentAt: new Date() },
            });
            results.push({ phone: p.phone, inviteToken, paymentLink });
            this.logger.log(`Split invite envoyé: booking=${bookingId} phone=${p.phone} token=${inviteToken}`);
        }
        // Marquer la course comme paiement fractionné
        await this.prisma.booking.update({
            where: { id: bookingId },
            data: { isSplitPayment: true },
        });
        return results;
    }
    /**
     * Traite le paiement d'un participant via son inviteToken.
     * Crée un PaymentIntent dédié à ce participant.
     */
    async payByToken(params) {
        var _a, _b;
        const link = await this.prisma.paymentLink.findUnique({
            where: { token: params.inviteToken },
            include: { booking: { select: { id: true, status: true, operatingCountry: true } } },
        });
        if (!link)
            throw new common_1.NotFoundException('Lien de paiement introuvable');
        if (link.status !== 'pending')
            throw new common_1.BadRequestException('Ce lien de paiement a déjà été utilisé');
        if (link.expiresAt < new Date()) {
            await this.prisma.paymentLink.update({ where: { id: link.id }, data: { status: 'expired' } });
            throw new common_1.BadRequestException('Ce lien de paiement a expiré');
        }
        const result = await this.paymentIntent.create({
            bookingId: link.bookingId,
            provider: params.provider,
            amount: link.amount,
            currency: link.currency,
            operatingCountry: (_a = link.booking.operatingCountry) !== null && _a !== void 0 ? _a : 'CM',
            passengerName: params.payerName,
            passengerPhone: params.payerPhone,
            passengerEmail: params.payerEmail,
            participantId: (_b = link.participantId) !== null && _b !== void 0 ? _b : undefined,
        });
        // Marquer le lien comme utilisé
        await this.prisma.paymentLink.update({
            where: { id: link.id },
            data: { status: 'paid', usedAt: new Date() },
        });
        if (link.participantId) {
            await this.prisma.bookingParticipant.update({
                where: { id: link.participantId },
                data: { status: 'paid', acceptedAt: new Date() },
            });
        }
        return result;
    }
    /** Vérifie que tous les participants ont payé pour permettre le dispatch. */
    async allParticipantsPaid(bookingId) {
        const pending = await this.prisma.bookingParticipant.count({
            where: { bookingId, status: { not: 'paid' } },
        });
        return pending === 0;
    }
    async getParticipants(bookingId) {
        return this.prisma.bookingParticipant.findMany({
            where: { bookingId },
            orderBy: { createdAt: 'asc' },
        });
    }
    buildSplitSms(link, amount, currency, total) {
        return [
            `AeroCab — Invitation paiement fractionné`,
            `Votre part: ${amount} ${currency} (course totale: ${total} ${currency})`,
            `Payez ici: ${link}`,
            `Ce lien expire dans 60 min.`,
        ].join('\n');
    }
};
exports.SplitService = SplitService;
exports.SplitService = SplitService = SplitService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        smart_sms_router_1.SmartSmsRouter,
        settings_service_1.SettingsService,
        payment_intent_service_1.PaymentIntentService])
], SplitService);
//# sourceMappingURL=split.service.js.map