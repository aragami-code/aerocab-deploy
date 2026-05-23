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
var ExchangeRateService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExchangeRateService = void 0;
const common_1 = require("@nestjs/common");
const redis_service_1 = require("../redis/redis.service");
const settings_service_1 = require("../settings/settings.service");
const FALLBACK_RATES = {
    XAF: 1,
    USD: 606.45,
    EUR: 655.96,
    GBP: 769.23,
    CAD: 446.43,
    CHF: 656.56,
    NGN: 0.40,
    GHS: 50.0,
    MAD: 60.40,
    EGP: 12.13,
    KES: 7.53,
    DZD: 4.46,
    CNY: 83.56,
    GNF: 0.07,
    XOF: 1.0,
};
// Devise de référence de la plateforme
const BASE_CURRENCY = 'XAF';
const CACHE_PREFIX = 'exchange_rate:';
let ExchangeRateService = ExchangeRateService_1 = class ExchangeRateService {
    constructor(redis, settings) {
        this.redis = redis;
        this.settings = settings;
        this.logger = new common_1.Logger(ExchangeRateService_1.name);
    }
    // Retourne combien de `to` vaut 1 `from`
    async getRate(from, to) {
        if (from === to)
            return 1;
        const cacheKey = `${CACHE_PREFIX}${from}_${to}`;
        const cached = await this.redis.get(cacheKey);
        if (cached)
            return parseFloat(cached);
        try {
            const rate = await this.fetchFromApi(from, to);
            const ttlMin = parseInt(await this.settings.get('exchange_rate_cache_ttl_min', '60'));
            await this.redis.set(cacheKey, String(rate), ttlMin * 60);
            await this.alertIfNeeded(from, to, rate);
            return rate;
        }
        catch (err) {
            this.logger.warn(`Exchange rate API failed (${from}→${to}), using fallback`);
            return this.getFallbackRate(from, to);
        }
    }
    // Convertit un montant de `from` vers `to`
    async convert(amount, from, to) {
        const rate = await this.getRate(from, to);
        return Math.round(amount * rate * 100) / 100;
    }
    // Convertit vers XAF (devise plateforme)
    async toBase(amount, from) {
        return this.convert(amount, from, BASE_CURRENCY);
    }
    async fetchFromApi(from, to) {
        var _a;
        // API gratuite exchangerate-api.com — remplacer par clé pro en production
        const res = await fetch(`https://open.er-api.com/v6/latest/${from}`, { signal: AbortSignal.timeout(5000) });
        if (!res.ok)
            throw new Error(`API HTTP ${res.status}`);
        const data = await res.json();
        const rate = (_a = data.rates) === null || _a === void 0 ? void 0 : _a[to];
        if (!rate)
            throw new Error(`Rate ${from}→${to} not found`);
        return rate;
    }
    getFallbackRate(from, to) {
        var _a, _b;
        const fromXaf = (_a = FALLBACK_RATES[from]) !== null && _a !== void 0 ? _a : 1;
        const toXaf = (_b = FALLBACK_RATES[to]) !== null && _b !== void 0 ? _b : 1;
        // from → XAF → to
        return toXaf / fromXaf;
    }
    async alertIfNeeded(from, to, newRate) {
        const alertPct = parseFloat(await this.settings.get('exchange_rate_alert_pct', '5'));
        const prevKey = `${CACHE_PREFIX}prev_${from}_${to}`;
        const prevRaw = await this.redis.get(prevKey);
        if (prevRaw) {
            const prev = parseFloat(prevRaw);
            const change = Math.abs((newRate - prev) / prev) * 100;
            if (change >= alertPct) {
                this.logger.warn(`Taux ${from}→${to} a varié de ${change.toFixed(1)}% (${prev}→${newRate})`);
            }
        }
        await this.redis.set(prevKey, String(newRate), 86400);
    }
};
exports.ExchangeRateService = ExchangeRateService;
exports.ExchangeRateService = ExchangeRateService = ExchangeRateService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [redis_service_1.RedisService,
        settings_service_1.SettingsService])
], ExchangeRateService);
//# sourceMappingURL=exchange-rate.service.js.map