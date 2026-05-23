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
exports.CreateFlightDto = exports.ArrivalAirportEnum = void 0;
const class_validator_1 = require("class-validator");
var ArrivalAirportEnum;
(function (ArrivalAirportEnum) {
    ArrivalAirportEnum["DOUALA"] = "DLA";
    ArrivalAirportEnum["YAOUNDE"] = "NSI";
})(ArrivalAirportEnum || (exports.ArrivalAirportEnum = ArrivalAirportEnum = {}));
class CreateFlightDto {
}
exports.CreateFlightDto = CreateFlightDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(10),
    __metadata("design:type", String)
], CreateFlightDto.prototype, "flightNumber", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(100),
    __metadata("design:type", String)
], CreateFlightDto.prototype, "airline", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(100),
    __metadata("design:type", String)
], CreateFlightDto.prototype, "origin", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(100),
    __metadata("design:type", String)
], CreateFlightDto.prototype, "destination", void 0);
__decorate([
    (0, class_validator_1.IsEnum)(ArrivalAirportEnum, {
        message: 'Aeroport invalide. Valeurs acceptees: DLA (Douala), NSI (Yaounde)',
    }),
    __metadata("design:type", String)
], CreateFlightDto.prototype, "arrivalAirport", void 0);
__decorate([
    (0, class_validator_1.IsDateString)({}, { message: "Format de date invalide. Utilisez ISO 8601 (ex: 2026-03-15T14:30:00Z)" }),
    __metadata("design:type", String)
], CreateFlightDto.prototype, "scheduledArrival", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(['api', 'manual']),
    __metadata("design:type", String)
], CreateFlightDto.prototype, "source", void 0);
//# sourceMappingURL=create-flight.dto.js.map