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
exports.KycController = void 0;
const common_1 = require("@nestjs/common");
const platform_express_1 = require("@nestjs/platform-express");
const multer_1 = require("multer");
const throttler_1 = require("@nestjs/throttler");
const kyc_service_1 = require("./kyc.service");
const guards_1 = require("../auth/guards");
const decorators_1 = require("../auth/decorators");
const KYC_UPLOAD_DIR = '/tmp/aerogo24-uploads';
const kycStorage = (0, multer_1.diskStorage)({
    destination: KYC_UPLOAD_DIR,
    filename: (_req, file, cb) => {
        var _a;
        const MIME_TO_EXT = {
            'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp',
        };
        const ext = (_a = MIME_TO_EXT[file.mimetype]) !== null && _a !== void 0 ? _a : '.jpg';
        cb(null, `kyc-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    },
});
const kycFileFilter = (_req, file, cb) => {
    const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];
    if (!ALLOWED.includes(file.mimetype)) {
        return cb(new common_1.BadRequestException('Formats acceptés : JPG, PNG, WebP'), false);
    }
    cb(null, true);
};
let KycController = class KycController {
    constructor(kycService) {
        this.kycService = kycService;
    }
    getStatus(userId) {
        return this.kycService.getStatus(userId);
    }
    uploadDocument(userId, type, file) {
        return this.kycService.uploadDocument(userId, type, file);
    }
    submitForReview(userId) {
        return this.kycService.submitForReview(userId);
    }
    // ── Admin ────────────────────────────────────────────────────────────────────
    getKycPending(page) {
        return this.kycService.getPending(page ? parseInt(page) : 1);
    }
    reviewKyc(userId, body) {
        return this.kycService.reviewKyc(userId, body.action, body.reason);
    }
};
exports.KycController = KycController;
__decorate([
    (0, common_1.Get)('status'),
    __param(0, (0, decorators_1.CurrentUser)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], KycController.prototype, "getStatus", null);
__decorate([
    (0, common_1.Post)('upload/:type'),
    (0, common_1.UseInterceptors)((0, platform_express_1.FileInterceptor)('file', {
        storage: kycStorage,
        limits: { fileSize: 8 * 1024 * 1024 },
        fileFilter: kycFileFilter,
    })),
    __param(0, (0, decorators_1.CurrentUser)('id')),
    __param(1, (0, common_1.Param)('type')),
    __param(2, (0, common_1.UploadedFile)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object]),
    __metadata("design:returntype", void 0)
], KycController.prototype, "uploadDocument", null);
__decorate([
    (0, common_1.Post)('submit'),
    __param(0, (0, decorators_1.CurrentUser)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], KycController.prototype, "submitForReview", null);
__decorate([
    (0, common_1.Get)('admin/pending'),
    (0, common_1.UseGuards)(guards_1.RolesGuard),
    (0, decorators_1.Roles)('admin', 'superadmin'),
    __param(0, (0, common_1.Query)('page')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], KycController.prototype, "getKycPending", null);
__decorate([
    (0, common_1.Post)('admin/:userId/review'),
    (0, common_1.UseGuards)(guards_1.RolesGuard),
    (0, decorators_1.Roles)('admin', 'superadmin'),
    __param(0, (0, common_1.Param)('userId')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], KycController.prototype, "reviewKyc", null);
exports.KycController = KycController = __decorate([
    (0, throttler_1.SkipThrottle)(),
    (0, common_1.Controller)('kyc'),
    (0, common_1.UseGuards)(guards_1.JwtAuthGuard),
    __metadata("design:paramtypes", [kyc_service_1.KycService])
], KycController);
//# sourceMappingURL=kyc.controller.js.map