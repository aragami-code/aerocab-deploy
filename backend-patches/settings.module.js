"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SettingsModule = void 0;
const common_1 = require("@nestjs/common");
const settings_service_1 = require("./settings.service");
const settings_controller_1 = require("./settings.controller");
const prisma_module_1 = require("../database/prisma.module");
const redis_module_1 = require("../redis/redis.module");
const audit_module_1 = require("../audit/audit.module");
const rbac_module_1 = require("../rbac/rbac.module");
let SettingsModule = class SettingsModule {
};
exports.SettingsModule = SettingsModule;
exports.SettingsModule = SettingsModule = __decorate([
    (0, common_1.Module)({
        imports: [prisma_module_1.PrismaModule, redis_module_1.RedisModule, audit_module_1.AuditModule, rbac_module_1.RbacModule],
        controllers: [settings_controller_1.SettingsController],
        providers: [settings_service_1.SettingsService],
        exports: [settings_service_1.SettingsService],
    })
], SettingsModule);
//# sourceMappingURL=settings.module.js.map