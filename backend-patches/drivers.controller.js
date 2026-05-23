"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DriversController = void 0;
const common_1 = require("@nestjs/common");
const platform_express_1 = require("@nestjs/platform-express");
const multer_1 = require("multer");
const fs = __importStar(require("fs"));
const drivers_service_1 = require("./drivers.service");
const dto_1 = require("./dto");
const country_change_request_dto_1 = require("./dto/country-change-request.dto");
const throttler_1 = require("@nestjs/throttler");
const guards_1 = require("../auth/guards");
const decorators_1 = require("../auth/decorators");
const UPLOAD_DIR = '/tmp/aerogo24-uploads';
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}
let DriversController = class DriversController {
    constructor(driversService) {
        this.driversService = driversService;
    }
    // ── Driver Registration ──────────────────────────────
    async register(userId, dto) {
        return this.driversService.register(userId, dto);
    }
    // ── Driver Profile (self) ────────────────────────────
    async getMyProfile(userId) {
        return this.driversService.getMyProfile(userId);
    }
    async updateProfile(userId, dto) {
        return this.driversService.updateProfile(userId, dto);
    }
    // ── Documents ────────────────────────────────────────
    async uploadDocument(userId, file, type) {
        return this.driversService.uploadDocumentFile(userId, type, file);
    }
    async getDocuments(userId) {
        return this.driversService.getDocuments(userId);
    }
    async submitForReview(userId) {
        return this.driversService.submitForReview(userId);
    }
    // ── Country Change Request ──────────────────────────────
    async requestCountryChange(userId, dto) {
        return this.driversService.requestCountryChange(userId, dto.requestedCountry, dto.reason);
    }
    async getCountryChangeRequest(userId) {
        return this.driversService.getCountryChangeRequest(userId);
    }
    // ── Location & Availability ──────────────────────────
    async updateLocation(userId, dto) {
        return this.driversService.updateLocation(userId, dto);
    }
    /** PATCH /drivers/availability — appelé par l'app mobile avec { isAvailable } */
    async setAvailability(userId, isAvailable) {
        return this.driversService.setAvailability(userId, isAvailable);
    }
    /** POST /drivers/toggle-availability — toggle (conservé pour compatibilité) */
    async toggleAvailability(userId) {
        return this.driversService.toggleAvailability(userId);
    }
    toggleConsigne(userId) {
        return this.driversService.toggleConsigne(userId);
    }
    // ── Earnings ─────────────────────────────────────────
    async getEarnings(userId) {
        return this.driversService.getEarnings(userId);
    }
    // ── Retraits ─────────────────────────────────────────
    async requestWithdrawal(userId, body) {
        return this.driversService.requestWithdrawal(userId, body.amount, body.method, body.mobileNumber);
    }
    async getWithdrawals(userId, page) {
        return this.driversService.getWithdrawals(userId, page ? parseInt(page) : 1);
    }
    // ── Public (for passengers) ──────────────────────────
    async getNearbyDrivers(latitude, longitude, radius) {
        return this.driversService.getNearbyDrivers(parseFloat(latitude), parseFloat(longitude), radius ? parseFloat(radius) : undefined);
    }
    async getDriverById(id) {
        return this.driversService.getDriverById(id);
    }
    // ── Frais d'inscription ──────────────────────────────────────────────────
    async getRegistrationFeeStatus(user) {
        return this.driversService.getRegistrationFeeStatus(user.id);
    }
    async initiateRegistrationFee(user, body) {
        return this.driversService.initiateRegistrationFee(user.id, body.provider);
    }
    async getDailyGoalsProgress(user) {
        return this.driversService.getDailyGoalsProgress(user.id);
    }
};
exports.DriversController = DriversController;
__decorate([
    (0, common_1.Post)('register'),
    (0, common_1.UseGuards)(guards_1.JwtAuthGuard),
    __param(0, (0, decorators_1.CurrentUser)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, dto_1.RegisterDriverDto]),
    __metadata("design:returntype", Promise)
], DriversController.prototype, "register", null);
__decorate([
    (0, common_1.Get)('me'),
    (0, common_1.UseGuards)(guards_1.JwtAuthGuard, guards_1.RolesGuard),
    (0, decorators_1.Roles)('driver'),
    __param(0, (0, decorators_1.CurrentUser)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], DriversController.prototype, "getMyProfile", null);
__decorate([
    (0, common_1.Patch)('me'),
    (0, common_1.UseGuards)(guards_1.JwtAuthGuard, guards_1.RolesGuard),
    (0, decorators_1.Roles)('driver'),
    __param(0, (0, decorators_1.CurrentUser)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, dto_1.UpdateDriverDto]),
    __metadata("design:returntype", Promise)
], DriversController.prototype, "updateProfile", null);
__decorate([
    (0, common_1.Post)('documents'),
    (0, common_1.UseGuards)(guards_1.JwtAuthGuard, guards_1.RolesGuard),
    (0, decorators_1.Roles)('driver'),
    (0, common_1.UseInterceptors)((0, platform_express_1.FileInterceptor)('file', {
        storage: (0, multer_1.diskStorage)({
            destination: UPLOAD_DIR,
            filename: (_req, file, cb) => {
                var _a;
                // Extension basée sur le MIME réel, pas sur le nom client
                const MIME_TO_EXT = {
                    'image/jpeg': '.jpg',
                    'image/png': '.png',
                    'application/pdf': '.pdf',
                };
                const ext = (_a = MIME_TO_EXT[file.mimetype]) !== null && _a !== void 0 ? _a : '.bin';
                cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
            },
        }),
        limits: { fileSize: 5 * 1024 * 1024 },
        fileFilter: (_req, file, cb) => {
            const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'application/pdf'];
            if (!ALLOWED_MIMES.includes(file.mimetype)) {
                return cb(new common_1.BadRequestException('Type de fichier non autorisé. Formats acceptés : JPG, PNG, PDF'), false);
            }
            cb(null, true);
        },
    })),
    __param(0, (0, decorators_1.CurrentUser)('id')),
    __param(1, (0, common_1.UploadedFile)()),
    __param(2, (0, common_1.Body)('type')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, String]),
    __metadata("design:returntype", Promise)
], DriversController.prototype, "uploadDocument", null);
__decorate([
    (0, common_1.Get)('documents'),
    (0, common_1.UseGuards)(guards_1.JwtAuthGuard, guards_1.RolesGuard),
    (0, decorators_1.Roles)('driver'),
    __param(0, (0, decorators_1.CurrentUser)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], DriversController.prototype, "getDocuments", null);
__decorate([
    (0, common_1.Post)('submit-review'),
    (0, common_1.UseGuards)(guards_1.JwtAuthGuard, guards_1.RolesGuard),
    (0, decorators_1.Roles)('driver'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, decorators_1.CurrentUser)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], DriversController.prototype, "submitForReview", null);
__decorate([
    (0, common_1.Post)('me/country-change-request'),
    (0, common_1.UseGuards)(guards_1.JwtAuthGuard, guards_1.RolesGuard),
    (0, decorators_1.Roles)('driver'),
    __param(0, (0, decorators_1.CurrentUser)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, country_change_request_dto_1.CreateCountryChangeRequestDto]),
    __metadata("design:returntype", Promise)
], DriversController.prototype, "requestCountryChange", null);
__decorate([
    (0, common_1.Get)('me/country-change-request'),
    (0, common_1.UseGuards)(guards_1.JwtAuthGuard, guards_1.RolesGuard),
    (0, decorators_1.Roles)('driver'),
    __param(0, (0, decorators_1.CurrentUser)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], DriversController.prototype, "getCountryChangeRequest", null);
__decorate([
    (0, common_1.Patch)('location'),
    (0, common_1.UseGuards)(guards_1.JwtAuthGuard, guards_1.RolesGuard),
    (0, decorators_1.Roles)('driver'),
    __param(0, (0, decorators_1.CurrentUser)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, dto_1.UpdateLocationDto]),
    __metadata("design:returntype", Promise)
], DriversController.prototype, "updateLocation", null);
__decorate([
    (0, common_1.Patch)('availability'),
    (0, common_1.UseGuards)(guards_1.JwtAuthGuard, guards_1.RolesGuard),
    (0, decorators_1.Roles)('driver'),
    __param(0, (0, decorators_1.CurrentUser)('id')),
    __param(1, (0, common_1.Body)('isAvailable')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Boolean]),
    __metadata("design:returntype", Promise)
], DriversController.prototype, "setAvailability", null);
__decorate([
    (0, common_1.Post)('toggle-availability'),
    (0, common_1.UseGuards)(guards_1.JwtAuthGuard, guards_1.RolesGuard),
    (0, decorators_1.Roles)('driver'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, decorators_1.CurrentUser)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], DriversController.prototype, "toggleAvailability", null);
__decorate([
    (0, common_1.Patch)('me/consigne-toggle'),
    (0, common_1.UseGuards)(guards_1.JwtAuthGuard, guards_1.RolesGuard),
    (0, decorators_1.Roles)('driver'),
    __param(0, (0, decorators_1.CurrentUser)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], DriversController.prototype, "toggleConsigne", null);
__decorate([
    (0, common_1.Get)('earnings'),
    (0, common_1.UseGuards)(guards_1.JwtAuthGuard, guards_1.RolesGuard),
    (0, decorators_1.Roles)('driver'),
    __param(0, (0, decorators_1.CurrentUser)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], DriversController.prototype, "getEarnings", null);
__decorate([
    (0, common_1.Post)('withdraw'),
    (0, common_1.UseGuards)(guards_1.JwtAuthGuard, guards_1.RolesGuard),
    (0, decorators_1.Roles)('driver'),
    (0, common_1.HttpCode)(201),
    __param(0, (0, decorators_1.CurrentUser)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], DriversController.prototype, "requestWithdrawal", null);
__decorate([
    (0, common_1.Get)('withdrawals'),
    (0, common_1.UseGuards)(guards_1.JwtAuthGuard, guards_1.RolesGuard),
    (0, decorators_1.Roles)('driver'),
    __param(0, (0, decorators_1.CurrentUser)('id')),
    __param(1, (0, common_1.Query)('page')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], DriversController.prototype, "getWithdrawals", null);
__decorate([
    (0, common_1.Get)('nearby'),
    (0, common_1.UseGuards)(guards_1.JwtAuthGuard),
    __param(0, (0, common_1.Query)('latitude')),
    __param(1, (0, common_1.Query)('longitude')),
    __param(2, (0, common_1.Query)('radius')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String]),
    __metadata("design:returntype", Promise)
], DriversController.prototype, "getNearbyDrivers", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, common_1.UseGuards)(guards_1.JwtAuthGuard),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], DriversController.prototype, "getDriverById", null);
__decorate([
    (0, common_1.Get)('registration-fee/status'),
    (0, common_1.UseGuards)(guards_1.JwtAuthGuard),
    __param(0, (0, decorators_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], DriversController.prototype, "getRegistrationFeeStatus", null);
__decorate([
    (0, common_1.Post)('registration-fee/initiate'),
    (0, common_1.UseGuards)(guards_1.JwtAuthGuard),
    __param(0, (0, decorators_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], DriversController.prototype, "initiateRegistrationFee", null);
__decorate([
    (0, common_1.Get)('daily-goals/progress'),
    (0, common_1.UseGuards)(guards_1.JwtAuthGuard),
    __param(0, (0, decorators_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], DriversController.prototype, "getDailyGoalsProgress", null);
exports.DriversController = DriversController = __decorate([
    (0, throttler_1.SkipThrottle)(),
    (0, common_1.Controller)('drivers'),
    __metadata("design:paramtypes", [drivers_service_1.DriversService])
], DriversController);
//# sourceMappingURL=drivers.controller.js.map