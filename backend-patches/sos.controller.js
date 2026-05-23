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
exports.SosController = void 0;
const common_1 = require("@nestjs/common");
const platform_express_1 = require("@nestjs/platform-express");
const multer_1 = require("multer");
const path_1 = require("path");
const jwt_auth_guard_1 = require("../auth/guards/jwt-auth.guard");
const sos_service_1 = require("./sos.service");
let SosController = class SosController {
    constructor(sos) {
        this.sos = sos;
    }
    // ── Contacts d'urgence ───────────────────────────────────────────────────────
    getContacts(req) {
        return this.sos.getContacts(req.user.id);
    }
    addContact(req, dto) {
        if (!dto.name || !dto.phone)
            throw new common_1.BadRequestException('name et phone requis');
        return this.sos.addContact(req.user.id, dto);
    }
    updateContact(req, id, dto) {
        return this.sos.updateContact(req.user.id, id, dto);
    }
    deleteContact(req, id) {
        return this.sos.deleteContact(req.user.id, id);
    }
    // ── Déclenchement SOS ────────────────────────────────────────────────────────
    triggerSos(req, body) {
        return this.sos.triggerSos(req.user.id, body);
    }
    // ── Upload audio ─────────────────────────────────────────────────────────────
    async uploadAudio(req, file, body) {
        if (!file)
            throw new common_1.BadRequestException('Aucun fichier reçu');
        const audioUrl = `/uploads/${file.filename}`;
        return this.sos.saveAudioUrl(req.user.id, body.bookingId, audioUrl);
    }
};
exports.SosController = SosController;
__decorate([
    (0, common_1.Get)('contacts'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], SosController.prototype, "getContacts", null);
__decorate([
    (0, common_1.Post)('contacts'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], SosController.prototype, "addContact", null);
__decorate([
    (0, common_1.Patch)('contacts/:id'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], SosController.prototype, "updateContact", null);
__decorate([
    (0, common_1.Delete)('contacts/:id'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], SosController.prototype, "deleteContact", null);
__decorate([
    (0, common_1.Post)('trigger'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], SosController.prototype, "triggerSos", null);
__decorate([
    (0, common_1.Post)('audio'),
    (0, common_1.UseInterceptors)((0, platform_express_1.FileInterceptor)('audio', {
        storage: (0, multer_1.diskStorage)({
            destination: '/tmp/aerogo24-uploads',
            filename: (_req, file, cb) => {
                const unique = `sos-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
                cb(null, unique + (0, path_1.extname)(file.originalname));
            },
        }),
        limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
        fileFilter: (_req, file, cb) => {
            if (file.mimetype.startsWith('audio/'))
                cb(null, true);
            else
                cb(new common_1.BadRequestException('Fichier audio requis'), false);
        },
    })),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.UploadedFile)()),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], SosController.prototype, "uploadAudio", null);
exports.SosController = SosController = __decorate([
    (0, common_1.Controller)('sos'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:paramtypes", [sos_service_1.SosService])
], SosController);
//# sourceMappingURL=sos.controller.js.map