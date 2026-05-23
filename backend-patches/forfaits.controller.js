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
exports.ForfaitsController = void 0;
const common_1 = require("@nestjs/common");
const throttler_1 = require("@nestjs/throttler");
const guards_1 = require("../auth/guards");
const decorators_1 = require("../auth/decorators");
const forfaits_service_1 = require("./forfaits.service");
const create_forfait_dto_1 = require("./dto/create-forfait.dto");
const update_forfait_dto_1 = require("./dto/update-forfait.dto");
const match_forfait_dto_1 = require("./dto/match-forfait.dto");
let ForfaitsController = class ForfaitsController {
    constructor(forfaitsService) {
        this.forfaitsService = forfaitsService;
    }
    // ── Public ────────────────────────────────────────────────────────────────────
    async findByAirport(code) {
        return this.forfaitsService.findByAirport(code);
    }
    async findByCountry(code) {
        return this.forfaitsService.findByCountry(code);
    }
    async match(dto) {
        return this.forfaitsService.match(dto.airportCode, dto.destLat, dto.destLng, dto.vehicleType, dto.bookingType);
    }
    // ── Admin ─────────────────────────────────────────────────────────────────────
    async findAll(countryCode) {
        return this.forfaitsService.findAll(countryCode);
    }
    async create(dto) {
        return this.forfaitsService.create(dto);
    }
    async update(id, dto) {
        return this.forfaitsService.update(id, dto);
    }
    async remove(id) {
        return this.forfaitsService.remove(id);
    }
};
exports.ForfaitsController = ForfaitsController;
__decorate([
    (0, common_1.Get)('airport/:code'),
    __param(0, (0, common_1.Param)('code')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], ForfaitsController.prototype, "findByAirport", null);
__decorate([
    (0, common_1.Get)('country/:code'),
    __param(0, (0, common_1.Param)('code')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], ForfaitsController.prototype, "findByCountry", null);
__decorate([
    (0, common_1.Get)('match'),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [match_forfait_dto_1.MatchForfaitDto]),
    __metadata("design:returntype", Promise)
], ForfaitsController.prototype, "match", null);
__decorate([
    (0, throttler_1.SkipThrottle)(),
    (0, common_1.UseGuards)(guards_1.JwtAuthGuard, guards_1.RolesGuard),
    (0, decorators_1.Roles)('super_admin', 'admin', 'operator'),
    (0, common_1.Get)('admin'),
    __param(0, (0, common_1.Query)('countryCode')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], ForfaitsController.prototype, "findAll", null);
__decorate([
    (0, throttler_1.SkipThrottle)(),
    (0, common_1.UseGuards)(guards_1.JwtAuthGuard, guards_1.RolesGuard),
    (0, decorators_1.Roles)('super_admin', 'admin'),
    (0, common_1.Post)('admin'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_forfait_dto_1.CreateForfaitDto]),
    __metadata("design:returntype", Promise)
], ForfaitsController.prototype, "create", null);
__decorate([
    (0, throttler_1.SkipThrottle)(),
    (0, common_1.UseGuards)(guards_1.JwtAuthGuard, guards_1.RolesGuard),
    (0, decorators_1.Roles)('super_admin', 'admin'),
    (0, common_1.Patch)('admin/:id'),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, update_forfait_dto_1.UpdateForfaitDto]),
    __metadata("design:returntype", Promise)
], ForfaitsController.prototype, "update", null);
__decorate([
    (0, throttler_1.SkipThrottle)(),
    (0, common_1.UseGuards)(guards_1.JwtAuthGuard, guards_1.RolesGuard),
    (0, decorators_1.Roles)('super_admin', 'admin'),
    (0, common_1.Delete)('admin/:id'),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], ForfaitsController.prototype, "remove", null);
exports.ForfaitsController = ForfaitsController = __decorate([
    (0, common_1.Controller)('forfaits'),
    __metadata("design:paramtypes", [forfaits_service_1.ForfaitsService])
], ForfaitsController);
//# sourceMappingURL=forfaits.controller.js.map