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
exports.VerifyOtpDto = void 0;
const class_validator_1 = require("class-validator");
class VerifyOtpDto {
}
exports.VerifyOtpDto = VerifyOtpDto;
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.Matches)(/^\+[1-9]\d{6,14}$/, {
        message: 'Phone must be in international format (e.g. +237612345678)',
    }),
    __metadata("design:type", String)
], VerifyOtpDto.prototype, "phone", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.Length)(6, 6, { message: 'OTP must be exactly 6 digits' }),
    (0, class_validator_1.Matches)(/^\d{6}$/, { message: 'OTP must contain only digits' }),
    __metadata("design:type", String)
], VerifyOtpDto.prototype, "code", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsIn)(['passenger', 'driver'], {
        message: 'intendedRole must be "passenger" or "driver"',
    }),
    __metadata("design:type", String)
], VerifyOtpDto.prototype, "intendedRole", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], VerifyOtpDto.prototype, "referralCode", void 0);
//# sourceMappingURL=verify-otp.dto.js.map