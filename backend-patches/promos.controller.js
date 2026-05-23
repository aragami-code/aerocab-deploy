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
exports.PromosController = void 0;
const common_1 = require("@nestjs/common");
const throttler_1 = require("@nestjs/throttler");
const promos_service_1 = require("./promos.service");
const create_promo_dto_1 = require("./dto/create-promo.dto");
const guards_1 = require("../auth/guards");
const decorators_1 = require("../auth/decorators");
let PromosController = class PromosController {
    constructor(promosService) {
        this.promosService = promosService;
    }
    create(dto) {
        return this.promosService.createPromo(dto);
    }
    list(page, limit) {
        return this.promosService.listPromos(page ? parseInt(page) : 1, limit ? parseInt(limit) : 20);
    }
    async validate(code) {
        const result = await this.promosService.validatePromo(code);
        if (!result)
            return { valid: false, discount: 0 };
        return { valid: true, discount: result.discount };
    }
    toggle(id) {
        return this.promosService.togglePromo(id);
    }
    remove(id) {
        return this.promosService.deletePromo(id);
    }
};
exports.PromosController = PromosController;
__decorate([
    (0, common_1.Post)(),
    (0, common_1.UseGuards)(guards_1.RolesGuard),
    (0, decorators_1.Roles)('admin'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_promo_dto_1.CreatePromoDto]),
    __metadata("design:returntype", void 0)
], PromosController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(),
    (0, common_1.UseGuards)(guards_1.RolesGuard),
    (0, decorators_1.Roles)('admin'),
    __param(0, (0, common_1.Query)('page')),
    __param(1, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], PromosController.prototype, "list", null);
__decorate([
    (0, common_1.Get)('validate/:code'),
    __param(0, (0, common_1.Param)('code')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], PromosController.prototype, "validate", null);
__decorate([
    (0, common_1.Patch)(':id/toggle'),
    (0, common_1.UseGuards)(guards_1.RolesGuard),
    (0, decorators_1.Roles)('admin'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], PromosController.prototype, "toggle", null);
__decorate([
    (0, common_1.Delete)(':id'),
    (0, common_1.UseGuards)(guards_1.RolesGuard),
    (0, decorators_1.Roles)('admin'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], PromosController.prototype, "remove", null);
exports.PromosController = PromosController = __decorate([
    (0, throttler_1.SkipThrottle)(),
    (0, common_1.Controller)('promos'),
    (0, common_1.UseGuards)(guards_1.JwtAuthGuard),
    __metadata("design:paramtypes", [promos_service_1.PromosService])
], PromosController);
//# sourceMappingURL=promos.controller.js.map