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
var ForfaitsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ForfaitsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../database/prisma.service");
const redis_service_1 = require("../redis/redis.service");
const CACHE_TTL = 300; // 5 minutes
function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
let ForfaitsService = ForfaitsService_1 = class ForfaitsService {
    constructor(prisma, redis) {
        this.prisma = prisma;
        this.redis = redis;
        this.logger = new common_1.Logger(ForfaitsService_1.name);
    }
    async create(dto) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
        if (((_a = dto.driverPercent) !== null && _a !== void 0 ? _a : 85) + ((_b = dto.companyPercent) !== null && _b !== void 0 ? _b : 15) !== 100) {
            throw new common_1.BadRequestException('driverPercent + companyPercent doit être égal à 100');
        }
        const forfait = await this.prisma.forfait.create({
            data: {
                name: dto.name,
                airportCode: dto.airportCode.toUpperCase(),
                destinationName: dto.destinationName,
                minDistKm: (_c = dto.minDistKm) !== null && _c !== void 0 ? _c : 0,
                maxDistKm: dto.maxDistKm,
                priceAmount: dto.priceAmount,
                currency: (_d = dto.currency) !== null && _d !== void 0 ? _d : 'XAF',
                countryCode: dto.countryCode.toUpperCase(),
                vehicleTypes: (_e = dto.vehicleTypes) !== null && _e !== void 0 ? _e : [],
                bookingTypes: (_f = dto.bookingTypes) !== null && _f !== void 0 ? _f : [],
                driverPercent: (_g = dto.driverPercent) !== null && _g !== void 0 ? _g : 85,
                companyPercent: (_h = dto.companyPercent) !== null && _h !== void 0 ? _h : 15,
                nightSurgeRate: (_j = dto.nightSurgeRate) !== null && _j !== void 0 ? _j : null,
                rainSurgeRate: (_k = dto.rainSurgeRate) !== null && _k !== void 0 ? _k : null,
                rushHourSurgeRate: (_l = dto.rushHourSurgeRate) !== null && _l !== void 0 ? _l : null,
                isActive: dto.isActive !== null && dto.isActive !== void 0 ? dto.isActive : true,
            },
        });
        await this.invalidateCache(forfait.airportCode);
        return forfait;
    }
    async findAll(countryCode) {
        return this.prisma.forfait.findMany({
            where: countryCode ? { countryCode: countryCode.toUpperCase() } : undefined,
            orderBy: { createdAt: 'desc' },
        });
    }
    async findByCountry(countryCode) {
        return this.prisma.forfait.findMany({
            where: { countryCode: countryCode.toUpperCase(), isActive: true },
            orderBy: [{ airportCode: 'asc' }, { minDistKm: 'asc' }],
        });
    }
    async findOne(id) {
        const forfait = await this.prisma.forfait.findUnique({ where: { id } });
        if (!forfait)
            throw new common_1.NotFoundException('Forfait introuvable');
        return forfait;
    }
    async update(id, dto) {
        var _a, _b;
        const existing = await this.findOne(id);
        if (dto.driverPercent !== undefined || dto.companyPercent !== undefined) {
            const newDriver = (_a = dto.driverPercent) !== null && _a !== void 0 ? _a : existing.driverPercent;
            const newCompany = (_b = dto.companyPercent) !== null && _b !== void 0 ? _b : existing.companyPercent;
            if (newDriver + newCompany !== 100) {
                throw new common_1.BadRequestException('driverPercent + companyPercent doit être égal à 100');
            }
        }
        const updated = await this.prisma.forfait.update({ where: { id }, data: dto });
        await this.invalidateCache(updated.airportCode);
        return updated;
    }
    async remove(id) {
        await this.findOne(id);
        const deleted = await this.prisma.forfait.update({
            where: { id },
            data: { isActive: false },
        });
        await this.invalidateCache(deleted.airportCode);
        return { success: true };
    }
    async findByAirport(airportCode) {
        const cacheKey = `forfaits:airport:${airportCode.toUpperCase()}`;
        const cached = await this.redis.get(cacheKey);
        if (cached)
            return JSON.parse(cached);
        const forfaits = await this.prisma.forfait.findMany({
            where: { airportCode: airportCode.toUpperCase(), isActive: true },
            orderBy: { minDistKm: 'asc' },
        });
        await this.redis.set(cacheKey, JSON.stringify(forfaits), CACHE_TTL);
        return forfaits;
    }
    async match(airportCode, destLat, destLng, vehicleType, bookingType) {
        const [forfaits, airport] = await Promise.all([
            this.findByAirport(airportCode),
            this.prisma.airport.findUnique({
                where: { iataCode: airportCode.toUpperCase() },
                select: { latitude: true, longitude: true },
            }),
        ]);
        if (!airport)
            return null;
        const distFromAirport = haversineKm(airport.latitude, airport.longitude, destLat, destLng);
        // Trier par zone la plus précise (maxDistKm la plus petite en premier)
        const sorted = [...forfaits].sort((a, b) => a.maxDistKm - b.maxDistKm);
        for (const f of sorted) {
            if (distFromAirport < f.minDistKm || distFromAirport > f.maxDistKm)
                continue;
            if (vehicleType && f.vehicleTypes.length > 0 && !f.vehicleTypes.includes(vehicleType))
                continue;
            if (bookingType && f.bookingTypes.length > 0 && !f.bookingTypes.includes(bookingType))
                continue;
            return Object.assign(Object.assign({}, f), { matchedDistKm: Math.round(distFromAirport * 10) / 10 });
        }
        return null;
    }
    calculatePrice(forfait, surges) {
        let price = forfait.priceAmount;
        if (surges.night && forfait.nightSurgeRate !== null)
            price *= forfait.nightSurgeRate;
        if (surges.rain && forfait.rainSurgeRate !== null)
            price *= forfait.rainSurgeRate;
        if (surges.rushHour && forfait.rushHourSurgeRate !== null)
            price *= forfait.rushHourSurgeRate;
        return Math.round(price);
    }
    async invalidateCache(airportCode) {
        await this.redis.del(`forfaits:airport:${airportCode.toUpperCase()}`);
        this.logger.log(`[Forfaits] Cache invalidé pour ${airportCode}`);
    }
};
exports.ForfaitsService = ForfaitsService;
exports.ForfaitsService = ForfaitsService = ForfaitsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        redis_service_1.RedisService])
], ForfaitsService);
//# sourceMappingURL=forfaits.service.js.map
