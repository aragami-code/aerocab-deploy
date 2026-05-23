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
Object.defineProperty(exports, "__esModule", { value: true });
exports.KycService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../database/prisma.service");
const notifications_service_1 = require("../notifications/notifications.service");
const VALID_TYPES = ['cni_front', 'cni_back', 'passport', 'selfie'];
let KycService = class KycService {
    constructor(prisma, notifications) {
        this.prisma = prisma;
        this.notifications = notifications;
    }
    async getStatus(userId) {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: {
                kycStatus: true,
                kycVerifiedAt: true,
                kycDocuments: {
                    select: { id: true, type: true, status: true, fileUrl: true, rejectionReason: true, createdAt: true },
                    orderBy: { createdAt: 'desc' },
                },
            },
        });
        if (!user)
            throw new common_1.NotFoundException('Utilisateur introuvable');
        return user;
    }
    async uploadDocument(userId, type, file) {
        if (!VALID_TYPES.includes(type)) {
            throw new common_1.BadRequestException('Type invalide. Valeurs acceptées : cni_front, cni_back, passport, selfie');
        }
        if (!file)
            throw new common_1.BadRequestException('Fichier manquant');
        const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
        if (!user)
            throw new common_1.NotFoundException('Utilisateur introuvable');
        const fileUrl = `/api/uploads/${file.filename}`;
        const doc = await this.prisma.kycDocument.upsert({
            where: { userId_type: { userId, type: type } },
            update: { fileUrl, status: 'pending', rejectionReason: null, verifiedAt: null, aiVerified: false, aiScore: null },
            create: { userId, type: type, fileUrl },
            select: { id: true, type: true, status: true, fileUrl: true },
        });
        return doc;
    }
    async submitForReview(userId) {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { kycStatus: true, kycDocuments: { select: { type: true } } },
        });
        if (!user)
            throw new common_1.NotFoundException('Utilisateur introuvable');
        if (user.kycStatus === 'approved')
            throw new common_1.BadRequestException('KYC déjà approuvé');
        const uploaded = user.kycDocuments.map(d => d.type);
        const hasCni = uploaded.includes('cni_front') && uploaded.includes('cni_back');
        const hasPassport = uploaded.includes('passport');
        const hasSelfie = uploaded.includes('selfie');
        if (!hasCni && !hasPassport) {
            throw new common_1.BadRequestException('Veuillez uploader votre CNI (recto + verso) ou votre passeport');
        }
        if (!hasSelfie) {
            throw new common_1.BadRequestException('Veuillez uploader votre selfie');
        }
        await this.prisma.user.update({
            where: { id: userId },
            data: { kycStatus: 'submitted' },
        });
        return { success: true, kycStatus: 'submitted' };
    }
    // ── Admin ────────────────────────────────────────────────────────────────────
    async getPending(page = 1, limit = 20) {
        const skip = Math.max(0, (page - 1) * limit);
        const [users, total] = await Promise.all([
            this.prisma.user.findMany({
                where: { kycStatus: { in: ['submitted', 'rejected'] } },
                select: {
                    id: true, name: true, phone: true, email: true, kycStatus: true,
                    kycDocuments: { select: { id: true, type: true, status: true, fileUrl: true, rejectionReason: true, createdAt: true } },
                    createdAt: true,
                },
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit,
            }),
            this.prisma.user.count({ where: { kycStatus: { in: ['submitted', 'rejected'] } } }),
        ]);
        return { data: users, total, page, limit };
    }
    async reviewKyc(userId, action, reason) {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, kycStatus: true },
        });
        if (!user)
            throw new common_1.NotFoundException('Utilisateur introuvable');
        if (user.kycStatus !== 'submitted') {
            throw new common_1.BadRequestException('KYC non soumis ou déjà traité');
        }
        if (action === 'approve') {
            await this.prisma.user.update({
                where: { id: userId },
                data: { kycStatus: 'approved', kycVerifiedAt: new Date() },
            });
            await this.prisma.kycDocument.updateMany({
                where: { userId, status: 'pending' },
                data: { status: 'approved', verifiedAt: new Date() },
            });
            this.notifications.sendToUser(userId, 'Identité vérifiée ✅', 'Votre identité a été vérifiée avec succès. Bon voyage !').catch(() => { });
        }
        else {
            await this.prisma.user.update({
                where: { id: userId },
                data: { kycStatus: 'rejected' },
            });
            await this.prisma.kycDocument.updateMany({
                where: { userId, status: 'pending' },
                data: { status: 'rejected', rejectionReason: reason !== null && reason !== void 0 ? reason : 'Document non conforme' },
            });
            this.notifications.sendToUser(userId, 'Vérification refusée', reason !== null && reason !== void 0 ? reason : 'Vos documents n\'ont pas pu être vérifiés. Veuillez les soumettre à nouveau.').catch(() => { });
        }
        return { success: true, action };
    }
};
exports.KycService = KycService;
exports.KycService = KycService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        notifications_service_1.NotificationsService])
], KycService);
//# sourceMappingURL=kyc.service.js.map