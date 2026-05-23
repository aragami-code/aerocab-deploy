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
exports.PointsController = void 0;
const common_1 = require("@nestjs/common");
const throttler_1 = require("@nestjs/throttler");
const points_service_1 = require("./points.service");
const guards_1 = require("../auth/guards");
let PointsController = class PointsController {
    constructor(pointsService) {
        this.pointsService = pointsService;
    }
    getBalance(req) {
        return this.pointsService.getBalance(req.user.id);
    }
    getHistory(req, page, limit, source) {
        const validSources = ['recharge', 'referral', 'loyalty', 'bonus', 'cashback', 'refund', 'payment'];
        const sourceFilter = validSources.includes(source) ? source : undefined;
        return this.pointsService.getHistory(req.user.id, page ? parseInt(page) : 1, limit ? parseInt(limit) : 20, sourceFilter);
    }
};
exports.PointsController = PointsController;
__decorate([
    (0, common_1.Get)('balance'),
    __param(0, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], PointsController.prototype, "getBalance", null);
__decorate([
    (0, common_1.Get)('history'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Query)('page')),
    __param(2, (0, common_1.Query)('limit')),
    __param(3, (0, common_1.Query)('source')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String]),
    __metadata("design:returntype", void 0)
], PointsController.prototype, "getHistory", null);
exports.PointsController = PointsController = __decorate([
    (0, throttler_1.SkipThrottle)(),
    (0, common_1.Controller)('points'),
    (0, common_1.UseGuards)(guards_1.JwtAuthGuard),
    __metadata("design:paramtypes", [points_service_1.PointsService])
], PointsController);
//# sourceMappingURL=points.controller.js.map