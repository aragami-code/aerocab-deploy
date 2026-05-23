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
exports.ReviewCountryChangeRequestDto = exports.CreateCountryChangeRequestDto = void 0;
const class_validator_1 = require("class-validator");
const phone_country_1 = require("../../common/phone-country");
const VALID_COUNTRY_CODES = Object.values(phone_country_1.PHONE_PREFIX_MAP);
class CreateCountryChangeRequestDto {
}
exports.CreateCountryChangeRequestDto = CreateCountryChangeRequestDto;
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.Length)(2, 2, { message: 'Le code pays doit faire exactement 2 caractères (ex: FR, CM)' }),
    __metadata("design:type", String)
], CreateCountryChangeRequestDto.prototype, "requestedCountry", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(20, { message: 'Veuillez expliquer la raison du changement (min 20 caractères)' }),
    (0, class_validator_1.MaxLength)(500),
    __metadata("design:type", String)
], CreateCountryChangeRequestDto.prototype, "reason", void 0);
class ReviewCountryChangeRequestDto {
}
exports.ReviewCountryChangeRequestDto = ReviewCountryChangeRequestDto;
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ReviewCountryChangeRequestDto.prototype, "status", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(500),
    __metadata("design:type", String)
], ReviewCountryChangeRequestDto.prototype, "adminNote", void 0);
//# sourceMappingURL=country-change-request.dto.js.map