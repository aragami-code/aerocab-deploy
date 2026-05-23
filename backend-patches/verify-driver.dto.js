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
exports.VerifyDriverDto = exports.VerificationAction = void 0;
const class_validator_1 = require("class-validator");
const register_driver_dto_1 = require("../../drivers/dto/register-driver.dto");
var VerificationAction;
(function (VerificationAction) {
    VerificationAction["APPROVE"] = "approve";
    VerificationAction["REJECT"] = "reject";
    VerificationAction["SUSPEND"] = "suspend";
})(VerificationAction || (exports.VerificationAction = VerificationAction = {}));
class VerifyDriverDto {
}
exports.VerifyDriverDto = VerifyDriverDto;
__decorate([
    (0, class_validator_1.IsEnum)(VerificationAction),
    __metadata("design:type", String)
], VerifyDriverDto.prototype, "action", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(5, { message: 'Le motif doit faire au moins 5 caracteres' }),
    __metadata("design:type", String)
], VerifyDriverDto.prototype, "reason", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsIn)(register_driver_dto_1.VEHICLE_CATEGORIES, { message: 'Catégorie de véhicule invalide' }),
    __metadata("design:type", String)
], VerifyDriverDto.prototype, "vehicleCategory", void 0);
//# sourceMappingURL=verify-driver.dto.js.map