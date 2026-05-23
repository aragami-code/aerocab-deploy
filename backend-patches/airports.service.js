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
var AirportsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AirportsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../database/prisma.service");
const redis_service_1 = require("../redis/redis.service");
const CONFIG_CACHE_KEY = 'config:cache';
let AirportsService = AirportsService_1 = class AirportsService {
    constructor(prisma, redis) {
        this.prisma = prisma;
        this.redis = redis;
        this.logger = new common_1.Logger(AirportsService_1.name);
    }
    async findAll() {
        return this.prisma.airport.findMany({
            where: { isActive: true },
            orderBy: { name: 'asc' },
        });
    }
    async findAllAdmin() {
        return this.prisma.airport.findMany({
            orderBy: { name: 'asc' },
        });
    }
    async create(data) {
        var _a;
        return this.prisma.airport.create({
            data: Object.assign(Object.assign({}, data), { iataCode: data.iataCode.toUpperCase(), icaoCode: (_a = data.icaoCode) === null || _a === void 0 ? void 0 : _a.toUpperCase(), countryCode: data.countryCode.toUpperCase() }),
        });
    }
    async update(id, data) {
        var _a, _b, _c;
        const result = await this.prisma.airport.update({
            where: { id },
            data: Object.assign(Object.assign({}, data), { iataCode: (_a = data.iataCode) === null || _a === void 0 ? void 0 : _a.toUpperCase(), icaoCode: (_b = data.icaoCode) === null || _b === void 0 ? void 0 : _b.toUpperCase(), countryCode: (_c = data.countryCode) === null || _c === void 0 ? void 0 : _c.toUpperCase() }),
        });
        await this.redis.del(CONFIG_CACHE_KEY);
        return result;
    }
    async remove(id) {
        const result = await this.prisma.airport.delete({ where: { id } });
        await this.redis.del(CONFIG_CACHE_KEY);
        return result;
    }
    async findByCode(iataCode) {
        return this.prisma.airport.findUnique({
            where: { iataCode: iataCode.toUpperCase() },
        });
    }
    async search(query) {
        return this.prisma.airport.findMany({
            where: {
                isActive: true,
                OR: [
                    { iataCode: { contains: query, mode: 'insensitive' } },
                    { name: { contains: query, mode: 'insensitive' } },
                    { city: { contains: query, mode: 'insensitive' } },
                ],
            },
            take: 10,
        });
    }
    async findNearby(lat, lng, radiusKm = 80) {
        try {
            // Haversine formula with safe bounds for acos - using direct template literal
            const nearby = await this.prisma.$queryRaw `
        WITH distances AS (
          SELECT *,
            (6371 * acos(
              GREATEST(-1.0, LEAST(1.0,
                cos(radians(${lat})) * cos(radians(latitude))
                * cos(radians(longitude) - radians(${lng}))
                + sin(radians(${lat})) * sin(radians(latitude))
              ))
            )) AS distance_km
          FROM airports
          WHERE is_active = true
        )
        SELECT 
          id, 
          iata_code AS "iataCode", 
          icao_code AS "icaoCode", 
          name, 
          city, 
          country, 
          country_code AS "countryCode", 
          latitude, 
          longitude, 
          is_active AS "isActive",
          distance_km
        FROM distances
        WHERE distance_km <= ${radiusKm}
        ORDER BY distance_km ASC
        LIMIT 5
      `;
            if (nearby && nearby.length > 0) {
                return nearby;
            }
            // Aucun aéroport dans le rayon → retourne liste vide (pas de fallback global)
            return [];
        }
        catch (e) {
            console.error('[AirportsService] Nearby search failed:', e);
        }
        return [];
    }
    async detectByCoords(lat, lng) {
        try {
            const airports = await this.prisma.airport.findMany({
                where: { isActive: true },
                select: { id: true, iataCode: true, name: true, city: true, countryCode: true, latitude: true, longitude: true, detectionRadius: true },
            });
            for (const airport of airports) {
                const R = 6371;
                const dLat = ((airport.latitude - lat) * Math.PI) / 180;
                const dLng = ((airport.longitude - lng) * Math.PI) / 180;
                const a = Math.sin(dLat / 2) ** 2 +
                    Math.cos((lat * Math.PI) / 180) *
                        Math.cos((airport.latitude * Math.PI) / 180) *
                        Math.sin(dLng / 2) ** 2;
                const distKm = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                if (distKm <= airport.detectionRadius) {
                    return airport;
                }
            }
            return null;
        }
        catch (e) {
            this.logger.error('[AirportsService] detectByCoords failed:', e);
            return null;
        }
    }
    /**
     * Retourne l'aéroport actif le plus proche des coordonnées données,
     * sans contrainte de rayon — utilisé comme suggestion quand aucun
     * aéroport n'est trouvé dans les 80km.
     */
    async findClosest(lat, lng) {
        var _a;
        try {
            const result = await this.prisma.$queryRaw `
        WITH distances AS (
          SELECT *,
            (6371 * acos(
              GREATEST(-1.0, LEAST(1.0,
                cos(radians(${lat})) * cos(radians(latitude))
                * cos(radians(longitude) - radians(${lng}))
                + sin(radians(${lat})) * sin(radians(latitude))
              ))
            )) AS distance_km
          FROM airports
          WHERE is_active = true
        )
        SELECT
          id, iata_code AS "iataCode", icao_code AS "icaoCode",
          name, city, country, country_code AS "countryCode",
          latitude, longitude, is_active AS "isActive", distance_km
        FROM distances
        ORDER BY distance_km ASC
        LIMIT 1
      `;
            return (_a = result[0]) !== null && _a !== void 0 ? _a : null;
        }
        catch (e) {
            console.error('[AirportsService] findClosest failed:', e);
            return null;
        }
    }
};
exports.AirportsService = AirportsService;
exports.AirportsService = AirportsService = AirportsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        redis_service_1.RedisService])
], AirportsService);
//# sourceMappingURL=airports.service.js.map