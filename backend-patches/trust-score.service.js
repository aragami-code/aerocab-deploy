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
exports.TrustScoreService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../database/prisma.service");
// Score on 1.0–5.0 scale
// Weights: rating 50%, completion 30%, seniority 0–0.5, volume 0–0.5, report penalty 0–2
let TrustScoreService = class TrustScoreService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async computeScore(userId) {
        var _a, _b, _c;
        const [user, bookingStats, ratingAgg, reportCount] = await Promise.all([
            this.prisma.user.findUnique({
                where: { id: userId },
                select: { createdAt: true },
            }),
            this.prisma.booking.groupBy({
                by: ['status'],
                where: { passengerId: userId },
                _count: { id: true },
            }),
            this.prisma.rating.aggregate({
                where: { toUserId: userId },
                _avg: { score: true },
                _count: { score: true },
            }),
            this.prisma.report.count({
                where: { reportedId: userId },
            }),
        ]);
        if (!user)
            return 5.0;
        // Booking stats
        const statMap = {};
        for (const s of bookingStats)
            statMap[s.status] = s._count.id;
        const completed = (_a = statMap['completed']) !== null && _a !== void 0 ? _a : 0;
        const cancelled = (_b = statMap['cancelled']) !== null && _b !== void 0 ? _b : 0;
        const totalTrips = Object.values(statMap).reduce((a, b) => a + b, 0);
        // 1. Rating factor (0–5), default 5 if no ratings yet
        const avgRating = (_c = ratingAgg._avg.score) !== null && _c !== void 0 ? _c : 5.0;
        // 2. Completion factor (0–5): 1.0 if no trips yet (benefit of the doubt)
        const completionRate = totalTrips > 0 ? completed / totalTrips : 1.0;
        const completionFactor = completionRate * 5;
        // 3. Seniority bonus (0–0.5): max after 2 years
        const accountAgeDays = (Date.now() - user.createdAt.getTime()) / (1000 * 60 * 60 * 24);
        const seniorityBonus = Math.min(0.5, accountAgeDays / 730);
        // 4. Volume bonus (0–0.5): max after 50 completed trips
        const volumeBonus = Math.min(0.5, (completed / 50) * 0.5);
        // 5. Report penalty (0–2): 0.3 per report
        const reportPenalty = Math.min(2.0, reportCount * 0.3);
        const raw = avgRating * 0.5 +
            completionFactor * 0.3 +
            seniorityBonus +
            volumeBonus -
            reportPenalty;
        return Math.min(5.0, Math.max(1.0, parseFloat(raw.toFixed(2))));
    }
    async updateScore(userId) {
        const score = await this.computeScore(userId);
        await this.prisma.user.update({
            where: { id: userId },
            data: { trustScore: score },
        });
    }
    scoreLabel(score) {
        if (score >= 4.5)
            return 'Excellent';
        if (score >= 4.0)
            return 'Très bien';
        if (score >= 3.5)
            return 'Bien';
        if (score >= 3.0)
            return 'Passable';
        return 'Faible';
    }
    scoreColor(score) {
        if (score >= 4.5)
            return '#22C55E';
        if (score >= 4.0)
            return '#84CC16';
        if (score >= 3.5)
            return '#EAB308';
        if (score >= 3.0)
            return '#F97316';
        return '#EF4444';
    }
};
exports.TrustScoreService = TrustScoreService;
exports.TrustScoreService = TrustScoreService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], TrustScoreService);
//# sourceMappingURL=trust-score.service.js.map