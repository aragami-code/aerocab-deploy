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
exports.UsersController = void 0;
const common_1 = require("@nestjs/common");
const users_service_1 = require("./users.service");
const trust_score_service_1 = require("./trust-score.service");
const update_profile_dto_1 = require("./dto/update-profile.dto");
const guards_1 = require("../auth/guards");
const decorators_1 = require("../auth/decorators");
const throttler_1 = require("@nestjs/throttler");
let UsersController = class UsersController {
    constructor(usersService, trustScore) {
        this.usersService = usersService;
        this.trustScore = trustScore;
    }
    async getProfile(userId) {
        return this.usersService.getProfile(userId);
    }
    async updateProfile(userId, dto) {
        return this.usersService.updateProfile(userId, dto);
    }
    async deleteAccount(userId) {
        return this.usersService.deleteAccount(userId);
    }
    async getLoyaltyStatus(userId) {
        return this.usersService.getLoyaltyStatus(userId);
    }
    async getTrustScore(userId) {
        const score = await this.trustScore.computeScore(userId);
        return {
            score,
            label: this.trustScore.scoreLabel(score),
            color: this.trustScore.scoreColor(score),
        };
    }
    async getPassStatus(userId) {
        return this.usersService.getPassStatus(userId);
    }
};
exports.UsersController = UsersController;
__decorate([
    (0, common_1.Get)('me'),
    __param(0, (0, decorators_1.CurrentUser)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "getProfile", null);
__decorate([
    (0, common_1.Patch)('me'),
    __param(0, (0, decorators_1.CurrentUser)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, update_profile_dto_1.UpdateProfileDto]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "updateProfile", null);
__decorate([
    (0, common_1.Delete)('me'),
    __param(0, (0, decorators_1.CurrentUser)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "deleteAccount", null);
__decorate([
    (0, common_1.Get)('me/loyalty'),
    __param(0, (0, decorators_1.CurrentUser)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "getLoyaltyStatus", null);
__decorate([
    (0, common_1.Get)('me/trust-score'),
    __param(0, (0, decorators_1.CurrentUser)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "getTrustScore", null);
__decorate([
    (0, common_1.Get)('me/pass-status'),
    __param(0, (0, decorators_1.CurrentUser)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "getPassStatus", null);
exports.UsersController = UsersController = __decorate([
    (0, throttler_1.SkipThrottle)(),
    (0, common_1.Controller)('users'),
    (0, common_1.UseGuards)(guards_1.JwtAuthGuard),
    __metadata("design:paramtypes", [users_service_1.UsersService,
        trust_score_service_1.TrustScoreService])
], UsersController);
//# sourceMappingURL=users.controller.js.map