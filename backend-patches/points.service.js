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
exports.PointsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../database/prisma.service");
let PointsService = class PointsService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async getBalance(userId) {
        var _a, _b, _c, _d, _e, _f, _g;
        const rows = await this.prisma.pointsTransaction.groupBy({
            by: ['source'],
            where: { userId },
            _sum: { points: true },
        });
        const map = {};
        for (const r of rows) {
            map[r.source] = (_a = r._sum.points) !== null && _a !== void 0 ? _a : 0;
        }
        const breakdown = {
            total: 0,
            recharge: (_b = map['recharge']) !== null && _b !== void 0 ? _b : 0,
            referral: (_c = map['referral']) !== null && _c !== void 0 ? _c : 0,
            loyalty: (_d = map['loyalty']) !== null && _d !== void 0 ? _d : 0,
            bonus: (_e = map['bonus']) !== null && _e !== void 0 ? _e : 0,
            cashback: (_f = map['cashback']) !== null && _f !== void 0 ? _f : 0,
            refund: (_g = map['refund']) !== null && _g !== void 0 ? _g : 0,
        };
        breakdown.total = rows.reduce((acc, r) => { var _a; return acc + ((_a = r._sum.points) !== null && _a !== void 0 ? _a : 0); }, 0);
        return { balance: breakdown.total, breakdown };
    }
    async getHistory(userId, page = 1, limit = 20, source) {
        const skip = Math.max(0, (page - 1) * limit);
        const where = source ? { userId, source } : { userId };
        const [transactions, total] = await Promise.all([
            this.prisma.pointsTransaction.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit,
            }),
            this.prisma.pointsTransaction.count({ where }),
        ]);
        return { data: transactions, total, page, limit };
    }
    async addPoints(userId, points, label, source = 'bonus') {
        // Validation: non-debit sources must have positive points
        if (source !== 'payment' && source !== 'refund' && points <= 0) {
            throw new common_1.BadRequestException('addPoints requires positive points for non-debit sources');
        }
        return this.prisma.pointsTransaction.create({
            data: {
                userId,
                type: points >= 0 ? 'credit' : 'debit',
                source,
                points,
                label,
            },
        });
    }
    async deductPoints(userId, points, label) {
        await this.prisma.$transaction(async (tx) => {
            var _a;
            const result = await tx.pointsTransaction.aggregate({
                where: { userId },
                _sum: { points: true },
            });
            const balance = (_a = result._sum.points) !== null && _a !== void 0 ? _a : 0;
            if (balance < points) {
                throw new common_1.BadRequestException(`Solde de points insuffisant : ${balance} pts disponibles, ${points} pts requis`);
            }
            await tx.pointsTransaction.create({
                data: { userId, type: 'debit', source: 'payment', points: -points, label },
            });
        });
    }
    async deductPointsTx(tx, userId, points, label) {
        var _a;
        const result = await tx.pointsTransaction.aggregate({
            where: { userId },
            _sum: { points: true },
        });
        const balance = (_a = result._sum.points) !== null && _a !== void 0 ? _a : 0;
        if (balance < points) {
            throw new common_1.BadRequestException(`Solde de points insuffisant : ${balance} pts disponibles, ${points} pts requis`);
        }
        await tx.pointsTransaction.create({
            data: { userId, type: 'debit', source: 'payment', points: -points, label },
        });
    }
};
exports.PointsService = PointsService;
exports.PointsService = PointsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], PointsService);
//# sourceMappingURL=points.service.js.map