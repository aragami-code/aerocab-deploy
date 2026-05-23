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
exports.ReportsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../database/prisma.service");
const MESSAGE_INCLUDE = {
    sender: { select: { id: true, name: true } },
};
let ReportsService = class ReportsService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async createReport(reporterId, dto) {
        var _a, _b, _c;
        let reportedId = dto.reportedId;
        if (!reportedId && dto.bookingId) {
            const booking = await this.prisma.booking.findUnique({
                where: { id: dto.bookingId },
                include: { driverProfile: { select: { userId: true } } },
            });
            if ((_a = booking === null || booking === void 0 ? void 0 : booking.driverProfile) === null || _a === void 0 ? void 0 : _a.userId) {
                reportedId = booking.driverProfile.userId;
            }
        }
        const report = await this.prisma.report.create({
            data: Object.assign(Object.assign({ reporterId }, (reportedId ? { reportedId } : {})), { bookingId: (_b = dto.bookingId) !== null && _b !== void 0 ? _b : null, reason: dto.reason, conversationId: (_c = dto.conversationId) !== null && _c !== void 0 ? _c : null, status: 'open' }),
            select: { id: true, status: true },
        });
        return report;
    }
    async getMyReports(userId) {
        return this.prisma.report.findMany({
            where: { reporterId: userId },
            include: {
                messages: {
                    include: MESSAGE_INCLUDE,
                    orderBy: { createdAt: 'asc' },
                },
            },
            orderBy: { createdAt: 'desc' },
        });
    }
    async getReportById(reportId, userId) {
        const report = await this.prisma.report.findUnique({
            where: { id: reportId },
            include: {
                reporter: { select: { id: true, name: true, phone: true } },
                reported: { select: { id: true, name: true, phone: true } },
                messages: {
                    include: MESSAGE_INCLUDE,
                    orderBy: { createdAt: 'asc' },
                },
            },
        });
        if (!report)
            throw new common_1.NotFoundException('Signalement introuvable');
        if (report.reporterId !== userId) {
            throw new common_1.ForbiddenException('Accès refusé');
        }
        return report;
    }
    async getReportByIdAdmin(reportId) {
        const report = await this.prisma.report.findUnique({
            where: { id: reportId },
            include: {
                reporter: { select: { id: true, name: true, phone: true } },
                reported: { select: { id: true, name: true, phone: true } },
                messages: {
                    include: MESSAGE_INCLUDE,
                    orderBy: { createdAt: 'asc' },
                },
            },
        });
        if (!report)
            throw new common_1.NotFoundException('Signalement introuvable');
        return report;
    }
    async addMessage(reportId, senderId, senderRole, message, imageUrl) {
        const report = await this.prisma.report.findUnique({ where: { id: reportId } });
        if (!report)
            throw new common_1.NotFoundException('Signalement introuvable');
        if (report.status === 'resolved' || report.status === 'dismissed') {
            throw new common_1.ForbiddenException('Ce ticket est fermé');
        }
        if (senderRole === 'user' && report.reporterId !== senderId && report.reportedId !== senderId) {
            throw new common_1.ForbiddenException('Accès refusé');
        }
        const msg = await this.prisma.ticketMessage.create({
            data: { reportId, senderId, senderRole, message, imageUrl: imageUrl !== null && imageUrl !== void 0 ? imageUrl : null },
            include: MESSAGE_INCLUDE,
        });
        // Auto-set to investigating when admin replies
        if (senderRole === 'admin' && report.status === 'open') {
            await this.prisma.report.update({
                where: { id: reportId },
                data: { status: 'investigating' },
            });
        }
        return msg;
    }
    async getAdminReports(status, page = 1, limit = 20) {
        const where = status ? { status: status } : {};
        const skip = (page - 1) * limit;
        const [reports, total] = await Promise.all([
            this.prisma.report.findMany({
                where,
                include: {
                    reporter: { select: { id: true, name: true, phone: true } },
                    reported: { select: { id: true, name: true, phone: true } },
                    messages: {
                        include: MESSAGE_INCLUDE,
                        orderBy: { createdAt: 'asc' },
                    },
                },
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit,
            }),
            this.prisma.report.count({ where }),
        ]);
        return {
            data: reports,
            pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
        };
    }
    async reopenReport(reportId) {
        const report = await this.prisma.report.findUnique({ where: { id: reportId } });
        if (!report)
            throw new common_1.NotFoundException('Signalement introuvable');
        return this.prisma.report.update({
            where: { id: reportId },
            data: { status: 'open', resolution: null },
        });
    }
    async resolveReport(reportId, resolution, status) {
        const report = await this.prisma.report.findUnique({ where: { id: reportId } });
        if (!report)
            throw new common_1.NotFoundException('Signalement introuvable');
        return this.prisma.report.update({
            where: { id: reportId },
            data: { resolution, status },
        });
    }
};
exports.ReportsService = ReportsService;
exports.ReportsService = ReportsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], ReportsService);
//# sourceMappingURL=reports.service.js.map