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
exports.AirportsController = void 0;
const common_1 = require("@nestjs/common");
const airports_service_1 = require("./airports.service");
const guards_1 = require("../auth/guards");
const decorators_1 = require("../auth/decorators");
const client_1 = require("@prisma/client");
const airport_dto_1 = require("./dto/airport.dto");
let AirportsController = class AirportsController {
    constructor(airportsService) {
        this.airportsService = airportsService;
    }
    findAll() {
        return this.airportsService.findAll();
    }
    findAllAdmin() {
        return this.airportsService.findAllAdmin();
    }
    search(q) {
        if (!q)
            return [];
        return this.airportsService.search(q);
    }
    findClosest(lat, lng) {
        return this.airportsService.findClosest(parseFloat(lat), parseFloat(lng));
    }
    findNearby(lat, lng, radius) {
        return this.airportsService.findNearby(parseFloat(lat), parseFloat(lng), radius ? parseFloat(radius) : 80);
    }
    async detect(lat, lng) {
        const latNum = parseFloat(lat);
        const lngNum = parseFloat(lng);
        if (isNaN(latNum) || isNaN(lngNum)) {
            throw new common_1.BadRequestException('lat et lng requis et doivent être des nombres');
        }
        if (latNum < -90 || latNum > 90 || lngNum < -180 || lngNum > 180) {
            throw new common_1.BadRequestException('Coordonnées hors limites WGS-84');
        }
        const airport = await this.airportsService.detectByCoords(latNum, lngNum);
        return airport !== null && airport !== void 0 ? airport : { detected: false };
    }
    findByCode(code) {
        return this.airportsService.findByCode(code);
    }
    create(data) {
        return this.airportsService.create(data);
    }
    update(id, data) {
        return this.airportsService.update(id, data);
    }
    remove(id) {
        return this.airportsService.remove(id);
    }
};
exports.AirportsController = AirportsController;
__decorate([
    (0, common_1.Get)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AirportsController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)('admin'),
    (0, decorators_1.Roles)(client_1.UserRole.admin),
    (0, common_1.UseGuards)(guards_1.JwtAuthGuard, guards_1.RolesGuard),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AirportsController.prototype, "findAllAdmin", null);
__decorate([
    (0, common_1.Get)('search'),
    __param(0, (0, common_1.Query)('q')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], AirportsController.prototype, "search", null);
__decorate([
    (0, common_1.Get)('closest'),
    __param(0, (0, common_1.Query)('lat')),
    __param(1, (0, common_1.Query)('lng')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], AirportsController.prototype, "findClosest", null);
__decorate([
    (0, common_1.Get)('nearby'),
    __param(0, (0, common_1.Query)('lat')),
    __param(1, (0, common_1.Query)('lng')),
    __param(2, (0, common_1.Query)('radius')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String]),
    __metadata("design:returntype", void 0)
], AirportsController.prototype, "findNearby", null);
__decorate([
    (0, common_1.Get)('detect'),
    __param(0, (0, common_1.Query)('lat')),
    __param(1, (0, common_1.Query)('lng')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], AirportsController.prototype, "detect", null);
__decorate([
    (0, common_1.Get)(':code'),
    __param(0, (0, common_1.Param)('code')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], AirportsController.prototype, "findByCode", null);
__decorate([
    (0, common_1.Post)(),
    (0, decorators_1.Roles)(client_1.UserRole.admin),
    (0, common_1.UseGuards)(guards_1.JwtAuthGuard, guards_1.RolesGuard),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [airport_dto_1.CreateAirportDto]),
    __metadata("design:returntype", void 0)
], AirportsController.prototype, "create", null);
__decorate([
    (0, common_1.Patch)(':id'),
    (0, decorators_1.Roles)(client_1.UserRole.admin),
    (0, common_1.UseGuards)(guards_1.JwtAuthGuard, guards_1.RolesGuard),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, airport_dto_1.UpdateAirportDto]),
    __metadata("design:returntype", void 0)
], AirportsController.prototype, "update", null);
__decorate([
    (0, common_1.Delete)(':id'),
    (0, decorators_1.Roles)(client_1.UserRole.admin),
    (0, common_1.UseGuards)(guards_1.JwtAuthGuard, guards_1.RolesGuard),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], AirportsController.prototype, "remove", null);
exports.AirportsController = AirportsController = __decorate([
    (0, common_1.Controller)('airports'),
    __metadata("design:paramtypes", [airports_service_1.AirportsService])
], AirportsController);
//# sourceMappingURL=airports.controller.js.map