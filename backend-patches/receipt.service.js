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
var ReceiptService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReceiptService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../database/prisma.service");
const email_router_service_1 = require("../email/email-router.service");
const smart_sms_router_1 = require("../sms/smart-sms.router");
const settings_service_1 = require("../settings/settings.service");
let ReceiptService = ReceiptService_1 = class ReceiptService {
    constructor(prisma, email, sms, settings) {
        this.prisma = prisma;
        this.email = email;
        this.sms = sms;
        this.settings = settings;
        this.logger = new common_1.Logger(ReceiptService_1.name);
    }
    /**
     * Génère et envoie le reçu électronique après la fin d'une course.
     * - Email si l'utilisateur a un email
     * - SMS systématique (numéro téléphone toujours présent)
     * Idempotent : si le reçu existe déjà, retente l'envoi uniquement si les canaux sont vides.
     */
    async sendRideReceipt(bookingId) {
        const booking = await this.prisma.booking.findUnique({
            where: { id: bookingId },
            include: {
                passenger: { select: { id: true, name: true, phone: true, email: true } },
                driverProfile: { include: { user: { select: { name: true } } } },
                receipt: { select: { id: true, emailSentAt: true, smsSentAt: true } },
            },
        });
        if (!booking)
            return;
        const receiptData = this.buildReceiptData(booking);
        // Créer ou récupérer le RideReceipt
        let receipt = booking.receipt;
        if (!receipt) {
            receipt = await this.prisma.rideReceipt.create({
                data: {
                    bookingId,
                    isCash: booking.paymentMethod === 'cash',
                    data: receiptData,
                },
            });
        }
        const receiptEnabled = await this.settings.get('receipt_enabled', 'true');
        if (receiptEnabled === 'false')
            return;
        const passenger = booking.passenger;
        const emailEnabled = await this.settings.get('receipt_email_enabled', 'true');
        const smsEnabled = await this.settings.get('receipt_sms_enabled', 'true');
        // ── Email ────────────────────────────────────────────────────────────────
        if (emailEnabled === 'true' && passenger.email && !receipt.emailSentAt) {
            try {
                const html = this.buildEmailHtml(receiptData);
                const sent = await this.email.send(passenger.email, `Votre reçu AeroCab — Course #${bookingId.slice(0, 8)}`, html);
                if (sent) {
                    await this.prisma.rideReceipt.update({
                        where: { id: receipt.id },
                        data: { emailSentAt: new Date() },
                    });
                    await this.prisma.booking.update({
                        where: { id: bookingId },
                        data: { receiptSentAt: new Date() },
                    });
                    this.logger.log(`Reçu email envoyé pour booking ${bookingId}`);
                }
            }
            catch (err) {
                this.logger.warn(`Erreur envoi reçu email booking ${bookingId}: ${err.message}`);
            }
        }
        // ── SMS ──────────────────────────────────────────────────────────────────
        if (smsEnabled === 'true' && passenger.phone && !receipt.smsSentAt) {
            try {
                const smsText = this.buildSmsText(receiptData);
                await this.sms.send(passenger.phone, smsText);
                await this.prisma.rideReceipt.update({
                    where: { id: receipt.id },
                    data: { smsSentAt: new Date() },
                });
                this.logger.log(`Reçu SMS envoyé pour booking ${bookingId}`);
            }
            catch (err) {
                this.logger.warn(`Erreur envoi reçu SMS booking ${bookingId}: ${err.message}`);
            }
        }
    }
    buildReceiptData(booking) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p;
        const amount = (_a = booking.estimatedPrice) !== null && _a !== void 0 ? _a : 0;
        const discount = (_b = booking.discountFromPoints) !== null && _b !== void 0 ? _b : 0;
        const finalAmount = amount - discount;
        const isCash = booking.paymentMethod === 'cash';
        const currency = (_c = booking.currency) !== null && _c !== void 0 ? _c : 'XAF';
        return {
            bookingId: booking.id,
            reference: `AEROCAB-${booking.id.slice(0, 8).toUpperCase()}`,
            passengerName: (_e = (_d = booking.passenger) === null || _d === void 0 ? void 0 : _d.name) !== null && _e !== void 0 ? _e : 'Passager',
            passengerPhone: (_f = booking.passenger) === null || _f === void 0 ? void 0 : _f.phone,
            driverName: (_j = (_h = (_g = booking.driverProfile) === null || _g === void 0 ? void 0 : _g.user) === null || _h === void 0 ? void 0 : _h.name) !== null && _j !== void 0 ? _j : 'Chauffeur',
            vehicleType: (_k = booking.vehicleType) !== null && _k !== void 0 ? _k : 'standard',
            destination: booking.destination,
            amount,
            discount,
            finalAmount,
            currency,
            paymentMethod: booking.paymentMethod,
            isCash,
            isSplit: (_l = booking.isSplitPayment) !== null && _l !== void 0 ? _l : false,
            amountLabel: isCash ? `${amount} ${currency} (montant indicatif)` : `${finalAmount} ${currency}`,
            rideDate: (_p = (_o = (_m = booking.createdAt) === null || _m === void 0 ? void 0 : _m.toISOString) === null || _o === void 0 ? void 0 : _o.call(_m)) !== null && _p !== void 0 ? _p : new Date().toISOString(),
        };
    }
    buildEmailHtml(data) {
        return `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><title>Reçu AeroCab</title></head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f9f9f9;">
  <div style="background: #1a1a2e; color: white; padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
    <h1 style="margin: 0; font-size: 24px;">AeroCab Connect</h1>
    <p style="margin: 5px 0 0; opacity: 0.8;">Reçu de course</p>
  </div>
  <div style="background: white; padding: 24px; border-radius: 0 0 8px 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
    <p>Bonjour <strong>${data.passengerName}</strong>,</p>
    <p>Merci d'avoir utilisé AeroCab. Voici le récapitulatif de votre course.</p>
    <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
      <tr style="border-bottom: 1px solid #eee;">
        <td style="padding: 8px 0; color: #666;">Référence</td>
        <td style="padding: 8px 0; text-align: right; font-weight: bold;">${data.reference}</td>
      </tr>
      <tr style="border-bottom: 1px solid #eee;">
        <td style="padding: 8px 0; color: #666;">Destination</td>
        <td style="padding: 8px 0; text-align: right;">${data.destination}</td>
      </tr>
      <tr style="border-bottom: 1px solid #eee;">
        <td style="padding: 8px 0; color: #666;">Chauffeur</td>
        <td style="padding: 8px 0; text-align: right;">${data.driverName}</td>
      </tr>
      <tr style="border-bottom: 1px solid #eee;">
        <td style="padding: 8px 0; color: #666;">Mode de paiement</td>
        <td style="padding: 8px 0; text-align: right;">${data.paymentMethod}</td>
      </tr>
      ${data.discount > 0 ? `
      <tr style="border-bottom: 1px solid #eee;">
        <td style="padding: 8px 0; color: #666;">Tarif</td>
        <td style="padding: 8px 0; text-align: right;">${data.amount} ${data.currency}</td>
      </tr>
      <tr style="border-bottom: 1px solid #eee;">
        <td style="padding: 8px 0; color: #27ae60;">Réduction points</td>
        <td style="padding: 8px 0; text-align: right; color: #27ae60;">- ${data.discount} ${data.currency}</td>
      </tr>` : ''}
      <tr>
        <td style="padding: 12px 0; font-weight: bold; font-size: 16px;">Total payé</td>
        <td style="padding: 12px 0; text-align: right; font-weight: bold; font-size: 16px; color: #1a1a2e;">
          ${data.amountLabel}
        </td>
      </tr>
    </table>
    ${data.isCash ? '<p style="font-size: 12px; color: #888;">* Paiement en espèces — montant indicatif au tarif fixé à la réservation.</p>' : ''}
    <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
    <p style="font-size: 12px; color: #888; text-align: center;">
      AeroCab Connect — Votre partenaire aéroportuaire<br>
      support@aerocab.com
    </p>
  </div>
</body>
</html>`.trim();
    }
    buildSmsText(data) {
        const lines = [
            `AeroCab — Reçu course ${data.reference}`,
            `Destination: ${data.destination}`,
            `Montant: ${data.amountLabel}`,
            `Chauffeur: ${data.driverName}`,
            `Merci d'avoir voyagé avec AeroCab!`,
        ];
        return lines.join('\n');
    }
};
exports.ReceiptService = ReceiptService;
exports.ReceiptService = ReceiptService = ReceiptService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        email_router_service_1.EmailRouterService,
        smart_sms_router_1.SmartSmsRouter,
        settings_service_1.SettingsService])
], ReceiptService);
//# sourceMappingURL=receipt.service.js.map