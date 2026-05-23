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
exports.AuthController = void 0;
const common_1 = require("@nestjs/common");
const throttler_1 = require("@nestjs/throttler");
const auth_service_1 = require("./auth.service");
const dto_1 = require("./dto");
const guards_1 = require("./guards");
const decorators_1 = require("./decorators");
let AuthController = class AuthController {
    constructor(authService) {
        this.authService = authService;
    }
    async sendOtp(dto) {
        var _a;
        return this.authService.sendOtp(dto.phone, (_a = dto.lang) !== null && _a !== void 0 ? _a : 'fr');
    }
    async verifyOtp(dto) {
        return this.authService.verifyOtp(dto.phone, dto.code, dto.intendedRole, dto.referralCode);
    }
    async sendEmailOtp(body) {
        var _a;
        return this.authService.sendEmailOtp(body.email, (_a = body.lang) !== null && _a !== void 0 ? _a : 'fr');
    }
    async verifyEmailOtp(body) {
        return this.authService.verifyEmailOtp(body.email, body.code, body.intendedRole, body.referralCode);
    }
    async getReferral(userId) {
        return this.authService.getReferralInfo(userId);
    }
    async getReferralList(userId) {
        return this.authService.getReferralList(userId);
    }
    async applyReferral(userId, body) {
        return this.authService.applyReferral(userId, body.code);
    }
    async refresh(dto) {
        return this.authService.refreshToken(dto.refreshToken);
    }
    googleLogin(body) {
        var _a;
        return this.authService.googleLogin(body.code, body.codeVerifier, body.redirectUri, (_a = body.intendedRole) !== null && _a !== void 0 ? _a : 'passenger');
    }
    googleStart(deepLink, res) {
        return this.authService.googleStart(deepLink, res);
    }
    exchangeGoogleAuthCode(body) {
        return this.authService.exchangeGoogleAuthCode(body.authCode);
    }
    googleCallback(code, state, error, res) {
        if (error || !code) {
            const deepLink = state ? Buffer.from(state, 'base64').toString('utf8') : '';
            return res.redirect(`${deepLink || 'aerogo24-passenger://'}?error=${error || 'no_code'}`);
        }
        return this.authService.googleCallback(code, state, res);
    }
    async logout(userId) {
        await this.authService.logout(userId);
        return { message: 'Déconnecté' };
    }
    async getMe(userId) {
        return this.authService.getMe(userId);
    }
    async getAuthProvidersConfig(userId) {
        return this.authService.getAuthProvidersConfig();
    }
};
exports.AuthController = AuthController;
__decorate([
    (0, common_1.Post)('otp/send'),
    (0, common_1.HttpCode)(200),
    (0, throttler_1.SkipThrottle)(),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.SendOtpDto]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "sendOtp", null);
__decorate([
    (0, common_1.Post)('otp/verify'),
    (0, common_1.HttpCode)(200),
    (0, throttler_1.SkipThrottle)(),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.VerifyOtpDto]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "verifyOtp", null);
__decorate([
    (0, common_1.Post)('otp/send-email'),
    (0, common_1.HttpCode)(200),
    (0, throttler_1.SkipThrottle)(),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "sendEmailOtp", null);
__decorate([
    (0, common_1.Post)('otp/verify-email'),
    (0, common_1.HttpCode)(200),
    (0, throttler_1.SkipThrottle)(),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "verifyEmailOtp", null);
__decorate([
    (0, common_1.Get)('referral'),
    (0, common_1.UseGuards)(guards_1.JwtAuthGuard),
    (0, throttler_1.SkipThrottle)(),
    __param(0, (0, decorators_1.CurrentUser)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "getReferral", null);
__decorate([
    (0, common_1.Get)('referral/list'),
    (0, common_1.UseGuards)(guards_1.JwtAuthGuard),
    (0, throttler_1.SkipThrottle)(),
    __param(0, (0, decorators_1.CurrentUser)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "getReferralList", null);
__decorate([
    (0, common_1.Post)('referral/apply'),
    (0, common_1.UseGuards)(guards_1.JwtAuthGuard),
    (0, common_1.HttpCode)(200),
    (0, throttler_1.Throttle)({ auth: { ttl: 60000, limit: 20 } }),
    __param(0, (0, decorators_1.CurrentUser)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "applyReferral", null);
__decorate([
    (0, common_1.Post)('refresh'),
    (0, common_1.HttpCode)(200),
    (0, throttler_1.Throttle)({ auth: { ttl: 60000, limit: 20 } }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.RefreshTokenDto]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "refresh", null);
__decorate([
    (0, common_1.Post)('google'),
    (0, common_1.HttpCode)(200),
    (0, throttler_1.Throttle)({ auth: { ttl: 60000, limit: 20 } }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "googleLogin", null);
__decorate([
    (0, common_1.Get)('google/start'),
    (0, throttler_1.SkipThrottle)(),
    __param(0, (0, common_1.Query)('deepLink')),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "googleStart", null);
__decorate([
    (0, common_1.Post)('google/exchange'),
    (0, common_1.HttpCode)(200),
    (0, throttler_1.Throttle)({ auth: { ttl: 60000, limit: 10 } }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "exchangeGoogleAuthCode", null);
__decorate([
    (0, common_1.Get)('google/callback'),
    (0, throttler_1.SkipThrottle)(),
    __param(0, (0, common_1.Query)('code')),
    __param(1, (0, common_1.Query)('state')),
    __param(2, (0, common_1.Query)('error')),
    __param(3, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, Object]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "googleCallback", null);
__decorate([
    (0, common_1.Post)('logout'),
    (0, common_1.UseGuards)(guards_1.JwtAuthGuard),
    (0, common_1.HttpCode)(200),
    (0, throttler_1.SkipThrottle)(),
    __param(0, (0, decorators_1.CurrentUser)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "logout", null);
__decorate([
    (0, common_1.Get)('me'),
    (0, common_1.UseGuards)(guards_1.JwtAuthGuard),
    (0, throttler_1.SkipThrottle)(),
    __param(0, (0, decorators_1.CurrentUser)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "getMe", null);
__decorate([
    (0, common_1.Get)('providers'),
    (0, common_1.UseGuards)(guards_1.JwtAuthGuard),
    (0, throttler_1.SkipThrottle)(),
    __param(0, (0, decorators_1.CurrentUser)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "getAuthProvidersConfig", null);
exports.AuthController = AuthController = __decorate([
    (0, common_1.Controller)('auth'),
    __metadata("design:paramtypes", [auth_service_1.AuthService])
], AuthController);
//# sourceMappingURL=auth.controller.js.map
