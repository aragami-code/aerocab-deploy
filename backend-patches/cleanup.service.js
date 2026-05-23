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
var CleanupService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.CleanupService = void 0;
const common_1 = require("@nestjs/common");
const schedule_1 = require("@nestjs/schedule");
const prisma_service_1 = require("../database/prisma.service");
const settings_service_1 = require("../settings/settings.service");
let CleanupService = CleanupService_1 = class CleanupService {
    constructor(prisma, settings) {
        this.prisma = prisma;
        this.settings = settings;
        this.logger = new common_1.Logger(CleanupService_1.name);
    }
    // D4 — RGPD : purge quotidienne des données GPS au-delà de la période de rétention
    async purgeOldGpsData() {
        const retentionMonths = await this.settings.getDataRetentionMonths();
        const cutoff = new Date();
        cutoff.setMonth(cutoff.getMonth() - retentionMonths);
        try {
            // 1. Supprimer les positions GPS détaillées (DriverPosition)
            const { count: positionsDeleted } = await this.prisma.driverPosition.deleteMany({
                where: { recordedAt: { lt: cutoff } },
            });
            // 2. Anonymiser les données de localisation des bookings terminés (coords + adresses texte)
            const { count: bookingsAnonymized } = await this.prisma.booking.updateMany({
                where: {
                    status: { in: ['completed', 'cancelled'] },
                    createdAt: { lt: cutoff },
                    OR: [
                        { pickupLat: { not: null } },
                        { pickupLng: { not: null } },
                        { destLat: { not: null } },
                        { destLng: { not: null } },
                        { pickupAddress: { not: null } },
                        { destination: { not: null } },
                    ],
                },
                data: {
                    pickupLat: null,
                    pickupLng: null,
                    destLat: null,
                    destLng: null,
                    pickupAddress: null,
                    destination: null,
                },
            });
            this.logger.log(`[RGPD] Purge terminée — positions supprimées: ${positionsDeleted}, bookings anonymisés: ${bookingsAnonymized} (rétention: ${retentionMonths} mois, cutoff: ${cutoff.toISOString()})`);
        }
        catch (err) {
            this.logger.error('[RGPD] Échec de la purge GPS', err);
        }
    }
};
exports.CleanupService = CleanupService;
__decorate([
    (0, schedule_1.Cron)(schedule_1.CronExpression.EVERY_DAY_AT_3AM),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], CleanupService.prototype, "purgeOldGpsData", null);
exports.CleanupService = CleanupService = CleanupService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        settings_service_1.SettingsService])
], CleanupService);
//# sourceMappingURL=cleanup.service.js.map