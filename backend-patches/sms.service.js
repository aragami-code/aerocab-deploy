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
var SmsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SmsService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
let SmsService = SmsService_1 = class SmsService {
    constructor(configService) {
        this.configService = configService;
        this.logger = new common_1.Logger(SmsService_1.name);
        this.isDev = configService.get('NODE_ENV', 'development') !== 'production'
            || configService.get('FORCE_OTP_LOG') === 'true';
    }
    async sendOtp(phone, code) {
        if (this.isDev) {
            this.logger.log(`[DEV] OTP for ${phone}: ${code}`);
            return true;
        }
        // Production: Twilio integration
        try {
            const accountSid = this.configService.get('TWILIO_ACCOUNT_SID');
            const authToken = this.configService.get('TWILIO_AUTH_TOKEN');
            const fromNumber = this.configService.get('TWILIO_PHONE_NUMBER');
            if (!accountSid || !authToken || !fromNumber) {
                this.logger.error('Twilio credentials not configured');
                return false;
            }
            // TODO: Install twilio package in production
            // const twilio = require('twilio');
            // const client = twilio(accountSid, authToken);
            // await client.messages.create({
            //   body: `AeroGo 24 Connect - Votre code de verification: ${code}`,
            //   from: fromNumber,
            //   to: phone,
            // });
            this.logger.warn('Twilio not configured - OTP not sent in production');
            return false;
        }
        catch (error) {
            this.logger.error(`Failed to send OTP to ${phone}`, error);
            return false;
        }
    }
};
exports.SmsService = SmsService;
exports.SmsService = SmsService = SmsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], SmsService);
//# sourceMappingURL=sms.service.js.map