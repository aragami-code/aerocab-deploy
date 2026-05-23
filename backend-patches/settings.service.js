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
exports.SettingsService = exports.DEFAULT_TARIFFS = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../database/prisma.service");
const redis_service_1 = require("../redis/redis.service");
const CONFIG_CACHE_KEY = 'config:cache';
exports.DEFAULT_TARIFFS = {
    basePricePerKm: 250,
    fcfaPerPoint: 1,
    startupFee: 500, // 500 FCFA de frais fixes à chaque prise en charge
    startupMinutes: 3, // 3 premières minutes incluses dans le startupFee
    pricePerMinute: 50, // 50 FCFA/min au-delà
    // ── Système de points (défauts Cameroun) ──────────────────────────────────
    pointValue: 1, // 1 pt = 1 FCFA
    pointRechargeRate: 1, // 1 FCFA versé = 1 pt crédité
    cashbackRate: 0.05, // 5 % du prix de la course remboursé en points
    commissionRate: 0.15, // 15 % prélevé par la plateforme (chauffeur reçoit 85%)
    referralBonus: {
        onSignup: 500, // pts offerts au parrain à l'inscription du filleul
        onFirstRide: 1000, // pts offerts au parrain à la 1re course du filleul
        newUserBonus: 300, // pts offerts au nouvel utilisateur à l'inscription
    },
    consigneEnabled: true, // true = service consigne disponible dans ce pays
    vehicles: {
        eco: { basePricePerKm: 250, minFare: 3000, coefficient: 1.0, label: 'Eco', isActive: true, maxPassengers: 4 },
        eco_plus: { basePricePerKm: 250, minFare: 3500, coefficient: 1.2, label: 'Eco+', isActive: true, maxPassengers: 4 },
        standard: { basePricePerKm: 250, minFare: 5000, coefficient: 1.4, label: 'Standard', isActive: true, maxPassengers: 5 },
        confort: { basePricePerKm: 250, minFare: 8000, coefficient: 2.0, label: 'Confort', isActive: true, maxPassengers: 5 },
        confort_plus: { basePricePerKm: 250, minFare: 12000, coefficient: 2.5, label: 'Confort Plus', isActive: true, maxPassengers: 7 },
    },
    consigne: {
        eco: { dailyRate: 5000 },
        eco_plus: { dailyRate: 6000 },
        standard: { dailyRate: 8000 },
        confort: { dailyRate: 12000 },
        confort_plus: { dailyRate: 18000 },
    },
    surge: {
        nightMultiplier: 1.3,
        rainMultiplier: 1.2,
        rushHourMultiplier: 1.25,
        rushHourStart: '07:00',
        rushHourEnd: '09:00',
        rushHourStart2: '17:00',
        rushHourEnd2: '19:00',
    },
};
let SettingsService = class SettingsService {
    constructor(prisma, redis) {
        this.prisma = prisma;
        this.redis = redis;
    }
    async get(key, defaultValue = '') {
        var _a;
        const setting = await this.prisma.appSetting.findUnique({ where: { key } });
        return (_a = setting === null || setting === void 0 ? void 0 : setting.value) !== null && _a !== void 0 ? _a : defaultValue;
    }
    async set(key, value) {
        await this.prisma.appSetting.upsert({
            where: { key },
            update: { value },
            create: { key, value },
        });
        // 0.B1 — Invalider le cache /config activement
        await this.redis.del(CONFIG_CACHE_KEY);
    }
    async getDataRetentionMonths() {
        const val = await this.get('data_retention_months', '12');
        const parsed = parseInt(val, 10);
        return isNaN(parsed) || parsed < 1 ? 12 : parsed;
    }
    async setDataRetentionMonths(months) {
        await this.set('data_retention_months', String(Math.max(1, months)));
    }
    async isProximityAssignmentEnabled() {
        const val = await this.get('proximity_assignment_enabled', 'false');
        return val === 'true';
    }
    async setProximityAssignment(enabled) {
        await this.set('proximity_assignment_enabled', String(enabled));
    }
    async getAll() {
        const rows = await this.prisma.appSetting.findMany();
        return Object.fromEntries(rows.map((r) => [r.key, r.value]));
    }
    /** Retourne la config des tarifs globaux (DB avec fallback sur les défauts) */
    async getTariffs() {
        return this.getTariffsByCountry(null);
    }
    /** Retourne les tarifs pour un pays donné (fallback global → défauts) */
    async getTariffsByCountry(countryCode) {
        // 1. Cherche tarifs spécifiques au pays
        if (countryCode) {
            const raw = await this.get(`tariffs_config:${countryCode.toUpperCase()}`, '');
            if (raw) {
                try {
                    const parsed = JSON.parse(raw);
                    return this.mergeTariffs(parsed);
                }
                catch ( /* fallback */_a) { /* fallback */ }
            }
        }
        // 2. Fallback : tarifs globaux
        const raw = await this.get('tariffs_config', '');
        if (raw) {
            try {
                const parsed = JSON.parse(raw);
                return this.mergeTariffs(parsed);
            }
            catch ( /* fallback */_b) { /* fallback */ }
        }
        // 3. Défauts hardcodés
        return exports.DEFAULT_TARIFFS;
    }
    mergeTariffs(parsed) {
        var _a, _b, _c, _d, _e;
        return Object.assign(Object.assign(Object.assign({}, exports.DEFAULT_TARIFFS), parsed), { vehicles: Object.assign(Object.assign({}, exports.DEFAULT_TARIFFS.vehicles), ((_a = parsed.vehicles) !== null && _a !== void 0 ? _a : {})), consigneEnabled: (_b = parsed.consigneEnabled) !== null && _b !== void 0 ? _b : exports.DEFAULT_TARIFFS.consigneEnabled, consigne: Object.assign(Object.assign({}, exports.DEFAULT_TARIFFS.consigne), ((_c = parsed.consigne) !== null && _c !== void 0 ? _c : {})), surge: Object.assign(Object.assign({}, exports.DEFAULT_TARIFFS.surge), ((_d = parsed.surge) !== null && _d !== void 0 ? _d : {})), referralBonus: Object.assign(Object.assign({}, exports.DEFAULT_TARIFFS.referralBonus), ((_e = parsed.referralBonus) !== null && _e !== void 0 ? _e : {})) });
    }
    /** Sauvegarde la config des tarifs globaux */
    async setTariffs(config) {
        await this.set('tariffs_config', JSON.stringify(config));
    }
    /** Sauvegarde les tarifs pour un pays donné */
    async setTariffsByCountry(countryCode, config) {
        await this.set(`tariffs_config:${countryCode.toUpperCase()}`, JSON.stringify(config));
    }
    /** Supprime les tarifs spécifiques d'un pays (retour au global) */
    async deleteTariffsByCountry(countryCode) {
        await this.prisma.appSetting.deleteMany({
            where: { key: `tariffs_config:${countryCode.toUpperCase()}` },
        });
    }
    /** Liste tous les pays ayant une config tarifaire spécifique */
    async getCountriesWithTariffs() {
        const rows = await this.prisma.appSetting.findMany({
            where: { key: { startsWith: 'tariffs_config:' } },
        });
        return rows.map(r => r.key.replace('tariffs_config:', ''));
    }
    /** Retourne le taux FCFA par point */
    async getFcfaPerPoint(countryCode) {
        const tariffs = await this.getTariffsByCountry(countryCode !== null && countryCode !== void 0 ? countryCode : null);
        return tariffs.fcfaPerPoint;
    }
};
exports.SettingsService = SettingsService;
exports.SettingsService = SettingsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        redis_service_1.RedisService])
], SettingsService);
//# sourceMappingURL=settings.service.js.map