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
exports.TicketImagesController = exports.UploadsController = void 0;
const common_1 = require("@nestjs/common");
const platform_express_1 = require("@nestjs/platform-express");
const multer_1 = require("multer");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const jwt_auth_guard_1 = require("../auth/guards/jwt-auth.guard");
const throttler_1 = require("@nestjs/throttler");
const UPLOAD_DIR = '/tmp/aerogo24-uploads';
/** KYC documents — JWT protected */
let UploadsController = class UploadsController {
    serveFile(filename, res) {
        const safe = path.basename(filename);
        const filePath = path.join(UPLOAD_DIR, safe);
        if (!fs.existsSync(filePath))
            throw new common_1.NotFoundException('Fichier introuvable');
        res.sendFile(filePath);
    }
    uploadTicketImage(file) {
        if (!file)
            throw new common_1.BadRequestException('Aucun fichier reçu');
        return { url: `/api/ticket-images/${file.filename}` };
    }
};
exports.UploadsController = UploadsController;
__decorate([
    (0, common_1.Get)(':filename'),
    __param(0, (0, common_1.Param)('filename')),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], UploadsController.prototype, "serveFile", null);
__decorate([
    (0, common_1.Post)('ticket-image'),
    (0, common_1.UseInterceptors)((0, platform_express_1.FileInterceptor)('file', {
        storage: (0, multer_1.diskStorage)({
            destination: UPLOAD_DIR,
            filename: (_req, file, cb) => {
                var _a;
                const MIME_TO_EXT = {
                    'image/jpeg': '.jpg',
                    'image/png': '.png',
                    'image/webp': '.webp',
                };
                const ext = (_a = MIME_TO_EXT[file.mimetype]) !== null && _a !== void 0 ? _a : '.jpg';
                cb(null, `ticket-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
            },
        }),
        limits: { fileSize: 5 * 1024 * 1024 },
        fileFilter: (_req, file, cb) => {
            const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];
            if (!ALLOWED.includes(file.mimetype)) {
                return cb(new common_1.BadRequestException('Formats acceptés : JPG, PNG, WebP'), false);
            }
            cb(null, true);
        },
    })),
    __param(0, (0, common_1.UploadedFile)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], UploadsController.prototype, "uploadTicketImage", null);
exports.UploadsController = UploadsController = __decorate([
    (0, common_1.Controller)('uploads'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, throttler_1.SkipThrottle)()
], UploadsController);
/** Ticket images — public access (no JWT), only ticket- prefixed files */
let TicketImagesController = class TicketImagesController {
    serveTicketImage(filename, res) {
        const safe = path.basename(filename);
        if (!safe.startsWith('ticket-'))
            throw new common_1.ForbiddenException('Accès refusé');
        const filePath = path.join(UPLOAD_DIR, safe);
        if (!fs.existsSync(filePath))
            throw new common_1.NotFoundException('Fichier introuvable');
        res.sendFile(filePath);
    }
};
exports.TicketImagesController = TicketImagesController;
__decorate([
    (0, common_1.Get)(':filename'),
    __param(0, (0, common_1.Param)('filename')),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], TicketImagesController.prototype, "serveTicketImage", null);
exports.TicketImagesController = TicketImagesController = __decorate([
    (0, common_1.Controller)('ticket-images'),
    (0, throttler_1.SkipThrottle)()
], TicketImagesController);
//# sourceMappingURL=uploads.controller.js.map