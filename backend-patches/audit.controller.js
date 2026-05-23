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
exports.AuditController = void 0;
const common_1 = require("@nestjs/common");
const audit_service_1 = require("./audit.service");
const guards_1 = require("../auth/guards");
const decorators_1 = require("../auth/decorators");
const throttler_1 = require("@nestjs/throttler");
let AuditController = class AuditController {
    constructor(audit) {
        this.audit = audit;
    }
    findAll(entity, entityId, userId, adminId, limit, offset) {
        return this.audit.findAll({
            entity,
            entityId,
            userId,
            adminId,
            limit: limit ? parseInt(limit, 10) : undefined,
            offset: offset ? parseInt(offset, 10) : undefined,
        });
    }
};
exports.AuditController = AuditController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, common_1.Query)('entity')),
    __param(1, (0, common_1.Query)('entityId')),
    __param(2, (0, common_1.Query)('userId')),
    __param(3, (0, common_1.Query)('adminId')),
    __param(4, (0, common_1.Query)('limit')),
    __param(5, (0, common_1.Query)('offset')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String, String, String]),
    __metadata("design:returntype", void 0)
], AuditController.prototype, "findAll", null);
exports.AuditController = AuditController = __decorate([
    (0, throttler_1.SkipThrottle)(),
    (0, common_1.Controller)('admin/audit-logs'),
    (0, common_1.UseGuards)(guards_1.JwtAuthGuard, guards_1.RolesGuard),
    (0, decorators_1.Roles)('admin'),
    __metadata("design:paramtypes", [audit_service_1.AuditService])
], AuditController);
//# sourceMappingURL=audit.controller.js.map