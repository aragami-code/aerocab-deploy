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
var SosService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SosService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../database/prisma.service");
const smart_sms_router_1 = require("../sms/smart-sms.router");
const notifications_service_1 = require("../notifications/notifications.service");
const audit_service_1 = require("../audit/audit.service");
let SosService = SosService_1 = class SosService {
    constructor(prisma, sms, notifications, audit) {
        this.prisma = prisma;
        this.sms = sms;
        this.notifications = notifications;
        this.audit = audit;
        this.logger = new common_1.Logger(SosService_1.name);
    }
    // ── Contacts d'urgence ───────────────────────────────────────────────────────
    async getContacts(userId) {
        return this.prisma.emergencyContact.findMany({
            where: { userId },
            orderBy: { createdAt: 'asc' },
        });
    }
    async addContact(userId, dto) {
        const count = await this.prisma.emergencyContact.count({ where: { userId } });
        if (count >= 3)
            throw new Error('Maximum 3 contacts d\'urgence autorisés');
        return this.prisma.emergencyContact.create({
            data: { userId, name: dto.name, phone: dto.phone, relation: dto.relation },
        });
    }
    async updateContact(userId, contactId, dto) {
        const contact = await this.prisma.emergencyContact.findFirst({ where: { id: contactId, userId } });
        if (!contact)
            throw new common_1.NotFoundException('Contact introuvable');
        return this.prisma.emergencyContact.update({ where: { id: contactId }, data: dto });
    }
    async deleteContact(userId, contactId) {
        const contact = await this.prisma.emergencyContact.findFirst({ where: { id: contactId, userId } });
        if (!contact)
            throw new common_1.NotFoundException('Contact introuvable');
        await this.prisma.emergencyContact.delete({ where: { id: contactId } });
        return { success: true };
    }
    // ── Déclenchement SOS ────────────────────────────────────────────────────────
    async triggerSos(userId, payload) {
        var _a;
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, name: true, phone: true, emergencyContacts: true },
        });
        if (!user)
            throw new common_1.NotFoundException('Utilisateur introuvable');
        const mapsLink = payload.lat && payload.lng
            ? `https://maps.google.com/?q=${payload.lat},${payload.lng}`
            : null;
        // SMS à chaque contact d'urgence
        const smsPromises = user.emergencyContacts.map(contact => {
            var _a;
            const msg = [
                `🚨 ALERTE SOS — ${(_a = user.name) !== null && _a !== void 0 ? _a : user.phone}`,
                `a déclenché une alerte depuis AeroGo 24.`,
                mapsLink ? `Position GPS : ${mapsLink}` : null,
                `Appelez-le(la) immédiatement ou contactez le 117.`,
            ].filter(Boolean).join('\n');
            return this.sms.send(contact.phone, msg).catch(err => {
                this.logger.warn(`SMS SOS échoué vers ${contact.phone}: ${err.message}`);
            });
        });
        await Promise.allSettled(smsPromises);
        // Notif push admin
        this.notifications.sendToAdmins('🚨 Alerte SOS passager', `${(_a = user.name) !== null && _a !== void 0 ? _a : user.phone} a déclenché un SOS${mapsLink ? ` — ${mapsLink}` : ''}`).catch(() => { });
        // Audit
        await this.audit.log({
            action: 'sos.triggered',
            entity: 'user',
            entityId: userId,
            userId,
            meta: { bookingId: payload.bookingId, lat: payload.lat, lng: payload.lng, hasAudio: !!payload.audioUrl },
        }).catch(() => { });
        this.logger.warn(`SOS déclenché par user ${userId} — contacts notifiés: ${user.emergencyContacts.length}`);
        return {
            success: true,
            contactsNotified: user.emergencyContacts.length,
            mapsLink,
        };
    }
    // ── Upload audio SOS ─────────────────────────────────────────────────────────
    async saveAudioUrl(userId, bookingId, audioUrl) {
        this.logger.warn(`Audio SOS enregistré: user=${userId} booking=${bookingId} url=${audioUrl}`);
        await this.audit.log({
            action: 'sos.audio_uploaded',
            entity: 'user',
            entityId: userId,
            userId,
            meta: { bookingId, audioUrl },
        }).catch(() => { });
        return { success: true, audioUrl };
    }
};
exports.SosService = SosService;
exports.SosService = SosService = SosService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        smart_sms_router_1.SmartSmsRouter,
        notifications_service_1.NotificationsService,
        audit_service_1.AuditService])
], SosService);
//# sourceMappingURL=sos.service.js.map