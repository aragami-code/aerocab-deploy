"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FlightsModule = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const flights_controller_1 = require("./flights.controller");
const flights_service_1 = require("./flights.service");
const flights_scheduler_1 = require("./flights.scheduler");
const prisma_module_1 = require("../database/prisma.module");
const settings_module_1 = require("../settings/settings.module");
const notifications_module_1 = require("../notifications/notifications.module");
const bookings_module_1 = require("../bookings/bookings.module");
let FlightsModule = class FlightsModule {
};
exports.FlightsModule = FlightsModule;
exports.FlightsModule = FlightsModule = __decorate([
    (0, common_1.Module)({
        imports: [prisma_module_1.PrismaModule, config_1.ConfigModule, settings_module_1.SettingsModule, notifications_module_1.NotificationsModule, (0, common_1.forwardRef)(() => bookings_module_1.BookingsModule)],
        controllers: [flights_controller_1.FlightsController],
        providers: [flights_service_1.FlightsService, flights_scheduler_1.FlightsScheduler],
        exports: [flights_service_1.FlightsService],
    })
], FlightsModule);
//# sourceMappingURL=flights.module.js.map