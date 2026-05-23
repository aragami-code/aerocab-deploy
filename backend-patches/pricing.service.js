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
var PricingService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PricingService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../database/prisma.service");
let PricingService = PricingService_1 = class PricingService {
    constructor(prisma) {
        this.prisma = prisma;
        this.logger = new common_1.Logger(PricingService_1.name);
    }
    /**
     * Calculate dynamic pricing based on demand (Surge Pricing)
     * Ratio: (Pending Bookings in last 15m) / (Available & Online Drivers)
     */
    async calculateEstimatedPrice(basePrice, airportCode) {
        this.logger.log(`Calculating surge price for ${airportCode} (Base: ${basePrice})`);
        try {
            const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
            // 1. Demand: Active or Pending bookings for this airport zone
            const demandCount = await this.prisma.booking.count({
                where: {
                    departureAirport: airportCode.toUpperCase(),
                    status: { in: ['pending', 'confirmed'] },
                    createdAt: { gte: fifteenMinutesAgo }
                }
            });
            // 2. Supply: Drivers online and available
            const supplyCount = await this.prisma.driverProfile.count({
                where: {
                    isAvailable: true,
                    isOnline: true,
                    status: 'approved'
                }
            });
            // Pas de chauffeurs en ligne → pas de surge (aucune offre ≠ offre rare)
            if (supplyCount === 0)
                return basePrice;
            const ratio = demandCount / supplyCount;
            let multiplier = 1.0;
            if (ratio > 2.0)
                multiplier = 1.8;
            else if (ratio > 1.5)
                multiplier = 1.5;
            else if (ratio > 1.0)
                multiplier = 1.2;
            this.logger.log(`Surge Report - Demand: ${demandCount}, Supply: ${supplyCount}, Ratio: ${ratio.toFixed(2)} -> Multiplier: ${multiplier}x`);
            return Math.round(basePrice * multiplier);
        }
        catch (err) {
            this.logger.error(`Failed to calculate surge price: ${err.message}`);
            return basePrice; // Safety fallback
        }
    }
    /**
     * Check if Surge Pricing is currently active for a zone
     */
    async isSurgeActive(airportCode) {
        const price = await this.calculateEstimatedPrice(1000, airportCode);
        return price > 1000;
    }
};
exports.PricingService = PricingService;
exports.PricingService = PricingService = PricingService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], PricingService);
//# sourceMappingURL=pricing.service.js.map