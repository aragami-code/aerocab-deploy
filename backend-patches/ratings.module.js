"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RatingsModule = void 0;
const common_1 = require("@nestjs/common");
const ratings_controller_1 = require("./ratings.controller");
const ratings_service_1 = require("./ratings.service");
const prisma_module_1 = require("../database/prisma.module");
const audit_module_1 = require("../audit/audit.module");
const users_module_1 = require("../users/users.module");
let RatingsModule = class RatingsModule {
};
exports.RatingsModule = RatingsModule;
exports.RatingsModule = RatingsModule = __decorate([
    (0, common_1.Module)({
        imports: [prisma_module_1.PrismaModule, audit_module_1.AuditModule, users_module_1.UsersModule],
        controllers: [ratings_controller_1.RatingsController],
        providers: [ratings_service_1.RatingsService],
        exports: [ratings_service_1.RatingsService],
    })
], RatingsModule);
//# sourceMappingURL=ratings.module.js.map