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
Object.defineProperty(exports, "__esModule", { value: true });
exports.RegisterDriverDto = exports.VEHICLE_CATEGORIES = void 0;
const class_validator_1 = require("class-validator");
exports.VEHICLE_CATEGORIES = ['eco', 'eco_plus', 'standard', 'confort', 'confort_plus'];
class RegisterDriverDto {
}
exports.RegisterDriverDto = RegisterDriverDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(2),
    (0, class_validator_1.MaxLength)(50),
    __metadata("design:type", String)
], RegisterDriverDto.prototype, "name", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(1),
    (0, class_validator_1.MaxLength)(50),
    __metadata("design:type", String)
], RegisterDriverDto.prototype, "vehicleBrand", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(1),
    (0, class_validator_1.MaxLength)(50),
    __metadata("design:type", String)
], RegisterDriverDto.prototype, "vehicleModel", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(1),
    (0, class_validator_1.MaxLength)(30),
    __metadata("design:type", String)
], RegisterDriverDto.prototype, "vehicleColor", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(3),
    (0, class_validator_1.MaxLength)(20),
    __metadata("design:type", String)
], RegisterDriverDto.prototype, "vehiclePlate", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(2000),
    (0, class_validator_1.Max)(2030),
    __metadata("design:type", Number)
], RegisterDriverDto.prototype, "vehicleYear", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsIn)(exports.VEHICLE_CATEGORIES, { message: 'Catégorie de véhicule invalide' }),
    __metadata("design:type", String)
], RegisterDriverDto.prototype, "vehicleCategory", void 0);
__decorate([
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ArrayMinSize)(1, { message: 'Au moins une langue est requise' }),
    (0, class_validator_1.IsString)({ each: true }),
    __metadata("design:type", Array)
], RegisterDriverDto.prototype, "languages", void 0);
//# sourceMappingURL=register-driver.dto.js.map