"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OtpModule = void 0;
const common_1 = require("@nestjs/common");
const otp_delivery_service_1 = require("./otp-delivery.service");
const sms_module_1 = require("../sms/sms.module");
const email_module_1 = require("../email/email.module");
const settings_module_1 = require("../settings/settings.module");
let OtpModule = class OtpModule {
};
exports.OtpModule = OtpModule;
exports.OtpModule = OtpModule = __decorate([
    (0, common_1.Module)({
        imports: [sms_module_1.SmsModule, email_module_1.EmailModule, settings_module_1.SettingsModule],
        providers: [otp_delivery_service_1.OtpDeliveryService],
        exports: [otp_delivery_service_1.OtpDeliveryService],
    })
], OtpModule);
//# sourceMappingURL=otp.module.js.map