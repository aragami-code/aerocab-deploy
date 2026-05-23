"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ForfaitsModule = void 0;
const common_1 = require("@nestjs/common");
const forfaits_service_1 = require("./forfaits.service");
const forfaits_controller_1 = require("./forfaits.controller");
const prisma_module_1 = require("../database/prisma.module");
const redis_module_1 = require("../redis/redis.module");
let ForfaitsModule = class ForfaitsModule {
};
exports.ForfaitsModule = ForfaitsModule;
exports.ForfaitsModule = ForfaitsModule = __decorate([
    (0, common_1.Module)({
        imports: [prisma_module_1.PrismaModule, redis_module_1.RedisModule],
        controllers: [forfaits_controller_1.ForfaitsController],
        providers: [forfaits_service_1.ForfaitsService],
        exports: [forfaits_service_1.ForfaitsService],
    })
], ForfaitsModule);
//# sourceMappingURL=forfaits.module.js.map