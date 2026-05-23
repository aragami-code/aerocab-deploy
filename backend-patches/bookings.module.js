"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BookingsModule = void 0;
const common_1 = require("@nestjs/common");
const jwt_1 = require("@nestjs/jwt");
const config_1 = require("@nestjs/config");
const dispatch_service_1 = require("./dispatch.service");
const pricing_service_1 = require("./pricing.service");
const bookings_controller_1 = require("./bookings.controller");
const tracking_public_controller_1 = require("./tracking-public.controller");
const bookings_service_1 = require("./bookings.service");
const bookings_scheduler_1 = require("./bookings.scheduler");
const rides_gateway_1 = require("./rides.gateway");
const prisma_module_1 = require("../database/prisma.module");
const notifications_module_1 = require("../notifications/notifications.module");
const points_module_1 = require("../points/points.module");
const settings_module_1 = require("../settings/settings.module");
const promos_module_1 = require("../promos/promos.module");
const flights_module_1 = require("../flights/flights.module");
const airports_module_1 = require("../airports/airports.module");
const audit_module_1 = require("../audit/audit.module");
const forfaits_module_1 = require("../forfaits/forfaits.module");
const payments_module_1 = require("../payments/payments.module");
const users_module_1 = require("../users/users.module");
let BookingsModule = class BookingsModule {
};
exports.BookingsModule = BookingsModule;
exports.BookingsModule = BookingsModule = __decorate([
    (0, common_1.Module)({
        imports: [
            config_1.ConfigModule,
            prisma_module_1.PrismaModule,
            notifications_module_1.NotificationsModule,
            points_module_1.PointsModule,
            settings_module_1.SettingsModule,
            promos_module_1.PromosModule,
            flights_module_1.FlightsModule,
            airports_module_1.AirportsModule,
            audit_module_1.AuditModule,
            forfaits_module_1.ForfaitsModule,
            payments_module_1.PaymentsModule,
            users_module_1.UsersModule,
            jwt_1.JwtModule.registerAsync({
                inject: [config_1.ConfigService],
                useFactory: (config) => ({
                    secret: config.get('JWT_SECRET'),
                }),
            }),
        ],
        controllers: [bookings_controller_1.BookingsController, tracking_public_controller_1.TrackingPublicController],
        providers: [bookings_service_1.BookingsService, rides_gateway_1.RidesGateway, dispatch_service_1.DispatchService, pricing_service_1.PricingService, bookings_scheduler_1.BookingsScheduler],
        exports: [bookings_service_1.BookingsService, dispatch_service_1.DispatchService, pricing_service_1.PricingService, rides_gateway_1.RidesGateway],
    })
], BookingsModule);
//# sourceMappingURL=bookings.module.js.map