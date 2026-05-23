"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SmsModule = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const mock_sms_provider_1 = require("./providers/mock-sms.provider");
const twilio_sms_provider_1 = require("./providers/twilio-sms.provider");
const orange_cm_provider_1 = require("./providers/orange-cm.provider");
const africas_talking_provider_1 = require("./providers/africas-talking.provider");
const smart_sms_router_1 = require("./smart-sms.router");
const settings_module_1 = require("../settings/settings.module");
let SmsModule = class SmsModule {
};
exports.SmsModule = SmsModule;
exports.SmsModule = SmsModule = __decorate([
    (0, common_1.Module)({
        imports: [config_1.ConfigModule, settings_module_1.SettingsModule],
        providers: [
            mock_sms_provider_1.MockSmsProvider,
            twilio_sms_provider_1.TwilioSmsProvider,
            orange_cm_provider_1.OrangeCmProvider,
            africas_talking_provider_1.AfricasTalkingProvider,
            smart_sms_router_1.SmartSmsRouter,
        ],
        exports: [smart_sms_router_1.SmartSmsRouter],
    })
], SmsModule);
//# sourceMappingURL=sms.module.js.map