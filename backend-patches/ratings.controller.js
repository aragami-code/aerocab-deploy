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
exports.RatingsController = void 0;
const common_1 = require("@nestjs/common");
const passport_1 = require("@nestjs/passport");
const ratings_service_1 = require("./ratings.service");
const throttler_1 = require("@nestjs/throttler");
let RatingsController = class RatingsController {
    constructor(ratingsService) {
        this.ratingsService = ratingsService;
    }
    async create(req, body) {
        return this.ratingsService.createRating(req.user.id, body);
    }
    async getDriverRatings(driverId, page, limit) {
        return this.ratingsService.getDriverRatings(driverId, page ? parseInt(page) : 1, limit ? parseInt(limit) : 20);
    }
    async checkIfRated(req, conversationId) {
        const hasRated = await this.ratingsService.hasRated(req.user.id, conversationId);
        return { hasRated };
    }
    async getUserSummary(userId) {
        return this.ratingsService.getUserRatingsSummary(userId);
    }
};
exports.RatingsController = RatingsController;
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], RatingsController.prototype, "create", null);
__decorate([
    (0, common_1.Get)('driver/:driverId'),
    __param(0, (0, common_1.Param)('driverId')),
    __param(1, (0, common_1.Query)('page')),
    __param(2, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String]),
    __metadata("design:returntype", Promise)
], RatingsController.prototype, "getDriverRatings", null);
__decorate([
    (0, common_1.Get)('check/:conversationId'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('conversationId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], RatingsController.prototype, "checkIfRated", null);
__decorate([
    (0, common_1.Get)('summary/:userId'),
    __param(0, (0, common_1.Param)('userId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], RatingsController.prototype, "getUserSummary", null);
exports.RatingsController = RatingsController = __decorate([
    (0, throttler_1.SkipThrottle)(),
    (0, common_1.Controller)('ratings'),
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    __metadata("design:paramtypes", [ratings_service_1.RatingsService])
], RatingsController);
//# sourceMappingURL=ratings.controller.js.map