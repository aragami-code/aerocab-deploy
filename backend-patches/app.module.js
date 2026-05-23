"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const schedule_1 = require("@nestjs/schedule");
const throttler_1 = require("@nestjs/throttler");
const core_1 = require("@nestjs/core");
const app_controller_1 = require("./app.controller");
const prisma_module_1 = require("./database/prisma.module");
const redis_module_1 = require("./redis/redis.module");
const auth_module_1 = require("./auth/auth.module");
const users_module_1 = require("./users/users.module");
const drivers_module_1 = require("./drivers/drivers.module");
const admin_module_1 = require("./admin/admin.module");
const flights_module_1 = require("./flights/flights.module");
const chat_module_1 = require("./chat/chat.module");
const ratings_module_1 = require("./ratings/ratings.module");
const bookings_module_1 = require("./bookings/bookings.module");
const points_module_1 = require("./points/points.module");
const notifications_module_1 = require("./notifications/notifications.module");
const settings_module_1 = require("./settings/settings.module");
const payments_module_1 = require("./payments/payments.module");
const airports_module_1 = require("./airports/airports.module");
const reports_module_1 = require("./reports/reports.module");
const promos_module_1 = require("./promos/promos.module");
const audit_module_1 = require("./audit/audit.module");
const uploads_module_1 = require("./uploads/uploads.module");
const cleanup_module_1 = require("./cleanup/cleanup.module");
const forfaits_module_1 = require("./forfaits/forfaits.module");
const bot_module_1 = require("./bot/bot.module");
const kyc_module_1 = require("./kyc/kyc.module");
const sos_module_1 = require("./sos/sos.module");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            config_1.ConfigModule.forRoot({
                isGlobal: true,
                envFilePath: '../../.env',
            }),
            // 0.B6 — Rate limiting différencié par type d'endpoint
            throttler_1.ThrottlerModule.forRoot([
                { name: 'otp', ttl: 60000, limit: process.env.NODE_ENV === 'production' ? 10 : 50 },
                { name: 'auth', ttl: 60000, limit: process.env.NODE_ENV === 'production' ? 120 : 200 },
                { name: 'admin', ttl: 60000, limit: process.env.NODE_ENV === 'production' ? 300 : 600 },
                { name: 'global', ttl: 60000, limit: process.env.NODE_ENV === 'production' ? 500 : 1000 },
            ]),
            schedule_1.ScheduleModule.forRoot(),
            prisma_module_1.PrismaModule,
            redis_module_1.RedisModule,
            auth_module_1.AuthModule,
            users_module_1.UsersModule,
            drivers_module_1.DriversModule,
            admin_module_1.AdminModule,
            flights_module_1.FlightsModule,
            chat_module_1.ChatModule,
            ratings_module_1.RatingsModule,
            bookings_module_1.BookingsModule,
            points_module_1.PointsModule,
            notifications_module_1.NotificationsModule,
            settings_module_1.SettingsModule,
            payments_module_1.PaymentsModule,
            airports_module_1.AirportsModule,
            reports_module_1.ReportsModule,
            promos_module_1.PromosModule,
            audit_module_1.AuditModule,
            uploads_module_1.UploadsModule,
            cleanup_module_1.CleanupModule,
            forfaits_module_1.ForfaitsModule,
            bot_module_1.BotModule,
            kyc_module_1.KycModule,
            sos_module_1.SosModule,
        ],
        controllers: [app_controller_1.AppController],
        providers: [
            { provide: core_1.APP_GUARD, useClass: throttler_1.ThrottlerGuard },
        ],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map