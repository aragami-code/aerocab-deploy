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
exports.PromosService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../database/prisma.service");
let PromosService = class PromosService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async validatePromo(code, userId) {
        const promo = await this.prisma.promoCode.findUnique({
            where: { code: code.toUpperCase() },
        });
        if (!promo)
            return null;
        if (!promo.isActive)
            return null;
        if (promo.usedCount >= promo.maxUses)
            return null;
        if (promo.expiresAt && promo.expiresAt < new Date())
            return null;
        if (promo.usagePerUser && userId) {
            const usage = await this.prisma.promoUsage.findUnique({
                where: {
                    promoCodeId_userId: {
                        promoCodeId: promo.id,
                        userId,
                    },
                },
            });
            if (usage)
                return null;
        }
        return { discount: promo.discount, promoId: promo.id };
    }
    async applyPromo(code, userId) {
        const promo = await this.prisma.promoCode.findUnique({
            where: { code: code.toUpperCase() },
        });
        if (!promo)
            return;
        await this.prisma.promoCode.update({
            where: { id: promo.id },
            data: { usedCount: { increment: 1 } },
        });
        if (promo.usagePerUser && userId) {
            await this.prisma.promoUsage.create({
                data: {
                    promoCodeId: promo.id,
                    userId,
                },
            });
        }
    }
    async createPromo(dto) {
        var _a;
        return this.prisma.promoCode.create({
            data: {
                code: dto.code.toUpperCase(),
                discount: dto.discount,
                maxUses: dto.maxUses,
                expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
                usagePerUser: (_a = dto.usagePerUser) !== null && _a !== void 0 ? _a : false,
            },
        });
    }
    async listPromos(page = 1, limit = 20) {
        const skip = (page - 1) * limit;
        const [promos, total] = await Promise.all([
            this.prisma.promoCode.findMany({
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit,
            }),
            this.prisma.promoCode.count(),
        ]);
        return {
            data: promos,
            pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
        };
    }
    async togglePromo(id) {
        const promo = await this.prisma.promoCode.findUniqueOrThrow({ where: { id } });
        return this.prisma.promoCode.update({
            where: { id },
            data: { isActive: !promo.isActive },
        });
    }
    async deletePromo(id) {
        return this.prisma.promoCode.delete({ where: { id } });
    }
};
exports.PromosService = PromosService;
exports.PromosService = PromosService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], PromosService);
//# sourceMappingURL=promos.service.js.map