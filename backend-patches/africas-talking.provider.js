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
var AfricasTalkingProvider_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AfricasTalkingProvider = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const settings_service_1 = require("../../settings/settings.service");
let AfricasTalkingProvider = AfricasTalkingProvider_1 = class AfricasTalkingProvider {
    constructor(config, settings) {
        this.config = config;
        this.settings = settings;
        this.name = 'africas-talking';
        this.logger = new common_1.Logger(AfricasTalkingProvider_1.name);
    }
    async send(to, message) {
        var _a, _b;
        // Priorité : AppSetting (admin) → env var (fallback)
        const [keyDb, userDb, senderDb] = await Promise.all([
            this.settings.get('at_api_key'),
            this.settings.get('at_username'),
            this.settings.get('at_sender_id'),
        ]);
        const apiKey = keyDb || this.config.get('AT_API_KEY', '');
        const username = userDb || this.config.get('AT_USERNAME', 'sandbox');
        const senderId = senderDb || this.config.get('AT_SENDER_ID', '');
        if (!apiKey) {
            this.logger.error('Africa\'s Talking credentials manquants — configurez via admin > Configuration > SMS');
            return false;
        }
        const baseUrl = username === 'sandbox'
            ? 'https://api.sandbox.africastalking.com'
            : 'https://api.africastalking.com';
        try {
            const params = { username, to, message };
            if (senderId)
                params['from'] = senderId;
            const res = await fetch(`${baseUrl}/version1/messaging`, {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'apiKey': apiKey,
                },
                body: new URLSearchParams(params).toString(),
            });
            if (!res.ok) {
                this.logger.error(`Africa's Talking error ${res.status}`);
                return false;
            }
            const data = await res.json();
            const recipients = (_b = (_a = data === null || data === void 0 ? void 0 : data.SMSMessageData) === null || _a === void 0 ? void 0 : _a.Recipients) !== null && _b !== void 0 ? _b : [];
            const success = recipients.some((r) => r.statusCode === 101);
            if (!success) {
                this.logger.error(`Africa's Talking delivery failed: ${JSON.stringify(recipients)}`);
                return false;
            }
            return true;
        }
        catch (e) {
            this.logger.error(`Africa's Talking send failed: ${e.message}`);
            return false;
        }
    }
};
exports.AfricasTalkingProvider = AfricasTalkingProvider;
exports.AfricasTalkingProvider = AfricasTalkingProvider = AfricasTalkingProvider_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService,
        settings_service_1.SettingsService])
], AfricasTalkingProvider);
//# sourceMappingURL=africas-talking.provider.js.map