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
var TwilioSmsProvider_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.TwilioSmsProvider = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const settings_service_1 = require("../../settings/settings.service");
let TwilioSmsProvider = TwilioSmsProvider_1 = class TwilioSmsProvider {
    constructor(config, settings) {
        this.config = config;
        this.settings = settings;
        this.name = 'twilio';
        this.logger = new common_1.Logger(TwilioSmsProvider_1.name);
    }
    async send(to, message) {
        // Priorité : AppSetting (admin) → env var (fallback)
        const [sidDb, tokenDb, fromDb] = await Promise.all([
            this.settings.get('twilio_account_sid'),
            this.settings.get('twilio_auth_token'),
            this.settings.get('twilio_phone_number'),
        ]);
        const accountSid = sidDb || this.config.get('TWILIO_ACCOUNT_SID', '');
        const authToken = tokenDb || this.config.get('TWILIO_AUTH_TOKEN', '');
        const from = fromDb || this.config.get('TWILIO_PHONE_NUMBER', '');
        if (!accountSid || !authToken || !from) {
            this.logger.error('Twilio credentials manquants — configurez via admin > Configuration > SMS');
            return false;
        }
        try {
            const credentials = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
            const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
                method: 'POST',
                headers: {
                    'Authorization': `Basic ${credentials}`,
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: new URLSearchParams({ From: from, To: to, Body: message }).toString(),
            });
            if (!res.ok) {
                const err = await res.json();
                this.logger.error(`Twilio error ${res.status}: ${err === null || err === void 0 ? void 0 : err.message}`);
                return false;
            }
            return true;
        }
        catch (e) {
            this.logger.error(`Twilio send failed: ${e.message}`);
            return false;
        }
    }
};
exports.TwilioSmsProvider = TwilioSmsProvider;
exports.TwilioSmsProvider = TwilioSmsProvider = TwilioSmsProvider_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService,
        settings_service_1.SettingsService])
], TwilioSmsProvider);
//# sourceMappingURL=twilio-sms.provider.js.map