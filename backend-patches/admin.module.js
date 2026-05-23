"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdminModule = void 0;
const common_1 = require("@nestjs/common");
const admin_controller_1 = require("./admin.controller");
const admin_service_1 = require("./admin.service");
const export_service_1 = require("./export.service");
const rbac_admin_controller_1 = require("./rbac-admin.controller");
const rbac_admin_service_1 = require("./rbac-admin.service");
const settings_module_1 = require("../settings/settings.module");
const rbac_module_1 = require("../rbac/rbac.module");
const prisma_module_1 = require("../database/prisma.module");
const notifications_module_1 = require("../notifications/notifications.module");
const redis_module_1 = require("../redis/redis.module");
const payments_module_1 = require("../payments/payments.module");
const drivers_module_1 = require("../drivers/drivers.module");
let AdminModule = class AdminModule {
};
exports.AdminModule = AdminModule;
exports.AdminModule = AdminModule = __decorate([
    (0, common_1.Module)({
        imports: [settings_module_1.SettingsModule, rbac_module_1.RbacModule, prisma_module_1.PrismaModule, notifications_module_1.NotificationsModule, redis_module_1.RedisModule, payments_module_1.PaymentsModule, drivers_module_1.DriversModule],
        controllers: [admin_controller_1.AdminController, rbac_admin_controller_1.RbacAdminController],
        providers: [admin_service_1.AdminService, rbac_admin_service_1.RbacAdminService, export_service_1.ExportService],
        exports: [admin_service_1.AdminService],
    })
], AdminModule);
//# sourceMappingURL=admin.module.js.map