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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppController = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const throttler_1 = require("@nestjs/throttler");
const prisma_service_1 = require("./database/prisma.service");
const redis_service_1 = require("./redis/redis.service");
const airports_service_1 = require("./airports/airports.service");
const settings_service_1 = require("./settings/settings.service");
const CONFIG_CACHE_KEY = 'config:cache';
const CONFIG_CACHE_TTL = 300; // 5 min
// Keys exposées publiquement via GET /config (pas les clés sensibles)
const PUBLIC_SETTING_KEYS = [
    'driver_position_interval_ms',
    'tracking_poll_2g_ms',
    'tracking_poll_3g_ms',
    'tracking_poll_4g_ms',
    'booking_passenger_timeout_ms',
    'passenger_confirm_timeout_min',
    'otp_channel',
    'google_maps_key',
    'workflow_arrival_enabled',
    'workflow_departure_enabled',
    'workflow_international_enabled',
    // Feature flags
    'feature_referral_enabled',
    'feature_cashback_enabled',
    'feature_points_purchase_enabled',
    'feature_promo_enabled',
    'feature_chat_enabled',
    'feature_sos_enabled',
    'feature_destination_change_enabled',
    'feature_rating_enabled',
    'feature_driver_withdrawal_enabled',
    'feature_consigne_enabled',
    'feature_breakdown_report_enabled',
    'driver_document_config',
    'bot_enabled',
    'test_mode_enabled',
    'tariffs_config',
];
let AppController = class AppController {
    constructor(prisma, redis, airports, settings, config) {
        this.prisma = prisma;
        this.redis = redis;
        this.airports = airports;
        this.settings = settings;
        this.config = config;
    }
    /**
     * 0.B1 — Config publique chargée au démarrage des apps mobiles.
     * Protégée par header X-App-Key pour éviter le scraping.
     * Cache Redis TTL 5min, invalidé activement par SettingsService.set() et AirportsService.
     */
    async getConfig(appKey) {
        const expectedKey = this.config.get('APP_KEY');
        if (expectedKey && appKey !== expectedKey) {
            throw new common_1.UnauthorizedException('X-App-Key invalide');
        }
        // Tenter le cache Redis
        const cached = await this.redis.get(CONFIG_CACHE_KEY);
        if (cached) {
            return JSON.parse(cached);
        }
        // Construire la réponse
        const [airportList, ...settingValues] = await Promise.all([
            this.airports.findAll(),
            ...PUBLIC_SETTING_KEYS.map((k) => this.settings.get(k)),
        ]);
        const publicSettings = {};
        PUBLIC_SETTING_KEYS.forEach((k, i) => {
            publicSettings[k] = settingValues[i];
        });
        const payload = { airports: airportList, settings: publicSettings };
        // Mettre en cache
        await this.redis.set(CONFIG_CACHE_KEY, JSON.stringify(payload), CONFIG_CACHE_TTL);
        return payload;
    }
    /**
     * 0.B25 — Health check pour Render et monitoring.
     */
    async healthCheck() {
        var _a;
        let dbStatus = 'ok';
        let redisStatus = 'ok';
        await Promise.all([
            this.prisma.$queryRaw `SELECT 1`.catch(() => { dbStatus = 'error'; }),
            this.redis.get('__health__').catch(() => { redisStatus = 'error'; }),
        ]);
        return {
            status: dbStatus === 'ok' && redisStatus === 'ok' ? 'ok' : 'degraded',
            timestamp: new Date().toISOString(),
            service: 'aerogo24-api',
            version: (_a = process.env.npm_package_version) !== null && _a !== void 0 ? _a : '0.1.0',
            database: dbStatus,
            redis: redisStatus,
        };
    }
    async metrics() {
        var _a;
        const [totalUsers, totalDrivers, activeDrivers, pendingBookings, activeBookings, completedToday, cancelledToday, totalRevenue,] = await Promise.all([
            this.prisma.user.count({ where: { role: 'passenger' } }),
            this.prisma.driverProfile.count(),
            this.prisma.driverProfile.count({ where: { isAvailable: true, status: 'approved' } }),
            this.prisma.booking.count({ where: { status: 'pending' } }),
            this.prisma.booking.count({ where: { status: { in: ['confirmed', 'in_progress'] } } }),
            this.prisma.booking.count({
                where: {
                    status: 'completed',
                    updatedAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
                },
            }),
            this.prisma.booking.count({
                where: {
                    status: 'cancelled',
                    updatedAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
                },
            }),
            this.prisma.booking.aggregate({
                _sum: { estimatedPrice: true },
                where: { status: 'completed' },
            }),
        ]);
        return {
            timestamp: new Date().toISOString(),
            uptime: Math.floor(process.uptime()),
            memory: {
                heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
                heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
                rss: Math.round(process.memoryUsage().rss / 1024 / 1024),
                unit: 'MB',
            },
            users: { total: totalUsers },
            drivers: { total: totalDrivers, active: activeDrivers },
            bookings: {
                pending: pendingBookings,
                active: activeBookings,
                completedToday,
                cancelledToday,
                totalRevenuePts: (_a = totalRevenue._sum.estimatedPrice) !== null && _a !== void 0 ? _a : 0,
            },
        };
    }
};
exports.AppController = AppController;
__decorate([
    (0, common_1.Get)('config'),
    __param(0, (0, common_1.Headers)('x-app-key')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AppController.prototype, "getConfig", null);
__decorate([
    (0, common_1.Get)('health'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AppController.prototype, "healthCheck", null);
__decorate([
    (0, common_1.Get)('metrics'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AppController.prototype, "metrics", null);
exports.AppController = AppController = __decorate([
    (0, common_1.Controller)(),
    (0, throttler_1.SkipThrottle)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        redis_service_1.RedisService,
        airports_service_1.AirportsService,
        settings_service_1.SettingsService,
        config_1.ConfigService])
], AppController);
//# sourceMappingURL=app.controller.js.map