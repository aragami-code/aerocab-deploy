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
var DispatchService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.DispatchService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../database/prisma.service");
const client_1 = require("@prisma/client");
const airports_service_1 = require("../airports/airports.service");
const settings_service_1 = require("../settings/settings.service");
let DispatchService = DispatchService_1 = class DispatchService {
    constructor(prisma, airportsService, settingsService) {
        this.prisma = prisma;
        this.airportsService = airportsService;
        this.settingsService = settingsService;
        this.logger = new common_1.Logger(DispatchService_1.name);
    }
    /**
     * Find eligible drivers based on flight status (Pre-landing vs Post-landing)
     * and driver reputation (Blacklane principle).
     */
    async findEligibleDrivers(booking, isPreLanding, customCoords, withConsigne, passengerTier) {
        var _a, _b;
        this.logger.log(`Finding drivers for booking ${booking.id} (Pre-landing: ${isPreLanding}, tier: ${passengerTier !== null && passengerTier !== void 0 ? passengerTier : 'bronze'})`);
        // Consigne filter: if withConsigne, only drivers with consigneEnabled OR driverType='internal'
        const consigneFilter = withConsigne
            ? { OR: [{ consigneEnabled: true }, { driverType: 'internal' }] }
            : {};
        let nearbyDrivers = [];
        // 0.B15 — score min + limits depuis AppSettings
        const [minScoreRaw, preLandingLimitRaw] = await Promise.all([
            this.settingsService.get('min_driver_score', '4.0'),
            this.settingsService.get('dispatch_prelanding_limit', '50'),
        ]);
        const minScore = parseFloat(minScoreRaw) || 4.0;
        const basePrelanding = parseInt(preLandingLimitRaw, 10) || 50;
        // F8 — Multiplicateur de pool selon tier fidélité passager
        const tierMultiplier = { bronze: 1.0, silver: 1.1, gold: 1.3, platinum: 1.5 };
        const tierMult = (_a = tierMultiplier[passengerTier !== null && passengerTier !== void 0 ? passengerTier : 'bronze']) !== null && _a !== void 0 ? _a : 1.0;
        const preLandingLimit = Math.ceil(basePrelanding * tierMult);
        // F8 — Or/Platine : score minimum abaissé pour garantir un meilleur chauffeur disponible
        const tierMinScoreBoost = { gold: -0.2, platinum: -0.3 };
        const boostedMinScore = Math.max(3.5, minScore + ((_b = tierMinScoreBoost[passengerTier !== null && passengerTier !== void 0 ? passengerTier : '']) !== null && _b !== void 0 ? _b : 0));
        if (isPreLanding) {
            // PRINCIPLE 1: All available drivers (regardless of location)
            nearbyDrivers = await this.prisma.driverProfile.findMany({
                where: Object.assign({ isAvailable: true, isOnline: true, status: 'approved', score: { gte: boostedMinScore } }, consigneFilter),
                include: { user: { select: { name: true, phone: true } } },
                orderBy: [{ score: 'desc' }, { ratingAvg: 'desc' }],
                take: preLandingLimit,
            });
        }
        else {
            // PRINCIPLE 2: Passenger already at airport OR departing from home -> Proximity Priority
            nearbyDrivers = await this.findNearbyDrivers(booking.departureAirport, customCoords, withConsigne);
            // F8 — Gold/Platinum : si pool insuffisant, élargir rayon via fetch global
            if ((passengerTier === 'gold' || passengerTier === 'platinum') && nearbyDrivers.length < 3) {
                const extra = await this.prisma.driverProfile.findMany({
                    where: Object.assign({ isAvailable: true, isOnline: true, status: 'approved', score: { gte: boostedMinScore } }, consigneFilter),
                    include: { user: { select: { name: true, phone: true } } },
                    orderBy: [{ score: 'desc' }],
                    take: Math.ceil(10 * tierMult),
                });
                const existingIds = new Set(nearbyDrivers.map((d) => d.id));
                for (const d of extra) {
                    if (!existingIds.has(d.id))
                        nearbyDrivers.push(d);
                }
            }
        }
        return nearbyDrivers;
    }
    /**
     * Find drivers near an airport or custom coordinates using Haversine formula via SQL query raw.
     * 0.B3 — Coords lues depuis la table airports DB (plus de constante hardcodée).
     * 0.B4 — Rayon lu depuis AppSetting proximity_radius_km.
     */
    async findNearbyDrivers(airportCode, customCoords, withConsigne) {
        let coords = customCoords;
        if (!coords && airportCode) {
            const airport = await this.airportsService.findByCode(airportCode.toUpperCase());
            if ((airport === null || airport === void 0 ? void 0 : airport.latitude) && (airport === null || airport === void 0 ? void 0 : airport.longitude)) {
                coords = { lat: Number(airport.latitude), lng: Number(airport.longitude) };
            }
        }
        const consigneClause = withConsigne
            ? client_1.Prisma.sql `AND (consigne_enabled = true OR driver_type = 'internal')`
            : client_1.Prisma.sql ``;
        if (!coords) {
            this.logger.warn(`Airport coordinates not found for ${airportCode}, falling back to score-based fetch.`);
            return this.prisma.driverProfile.findMany({
                where: Object.assign({ isAvailable: true, isOnline: true, status: 'approved' }, (withConsigne ? { OR: [{ consigneEnabled: true }, { driverType: 'internal' }] } : {})),
                include: { user: { select: { name: true, phone: true } } },
                orderBy: { score: 'desc' },
                take: 20,
            });
        }
        const radiusRaw = await this.settingsService.get('proximity_radius_km', '25');
        const proximityRadiusKm = parseFloat(radiusRaw) || 25;
        // Haversine formula in RAW SQL
        const nearby = await this.prisma.$queryRaw(client_1.Prisma.sql `
        SELECT id, distance_km FROM (
          SELECT id,
            6371 * acos(
              LEAST(1.0,
                cos(radians(${coords.lat})) * cos(radians(latitude))
                * cos(radians(longitude) - radians(${coords.lng}))
                + sin(radians(${coords.lat})) * sin(radians(latitude))
              )
            ) AS distance_km
          FROM driver_profiles
          WHERE status = 'approved'
            AND is_available = true
            AND is_online = true
            AND latitude IS NOT NULL
            AND longitude IS NOT NULL
            ${consigneClause}
        ) AS drivers
        WHERE distance_km <= ${proximityRadiusKm}
        ORDER BY distance_km ASC
        LIMIT 20
      `);
        if (nearby.length === 0)
            return [];
        // Hydrate the raw results with full profile and user data
        return this.prisma.driverProfile.findMany({
            where: { id: { in: nearby.map(n => n.id) } },
            include: { user: { select: { name: true, phone: true } } },
        });
    }
    /**
     * Check if there are ANY eligible drivers globally for a specific vehicle type.
     * Useful when no drivers are found nearby.
     */
    async findGlobalEligibleDrivers(vehicleType) {
        return this.prisma.driverProfile.findMany({
            where: {
                isAvailable: true,
                isOnline: true,
                status: 'approved',
                // Note: Filter by vehicle type if needed, but here we just check availability
            },
            include: { user: { select: { name: true } } },
            take: 5,
        });
    }
    /**
     * Calculate a priority score for a driver for a specific booking
     */
    calculateDriverPriority(driver, booking) {
        // 70% Score (Reputation) + 30% App Rating
        return (driver.score || 5.0) * 0.7 + (driver.ratingAvg || 5.0) * 0.3;
    }
};
exports.DispatchService = DispatchService;
exports.DispatchService = DispatchService = DispatchService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        airports_service_1.AirportsService,
        settings_service_1.SettingsService])
], DispatchService);
//# sourceMappingURL=dispatch.service.js.map