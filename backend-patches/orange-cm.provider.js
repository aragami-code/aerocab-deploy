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
var OrangeCmProvider_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.OrangeCmProvider = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const settings_service_1 = require("../../settings/settings.service");
let OrangeCmProvider = OrangeCmProvider_1 = class OrangeCmProvider {
    constructor(config, settings) {
        this.config = config;
        this.settings = settings;
        this.name = 'orange-cm';
        this.logger = new common_1.Logger(OrangeCmProvider_1.name);
    }
    async send(to, message) {
        // Priorité : AppSetting (admin) → env var (fallback)
        const [idDb, secretDb, senderDb] = await Promise.all([
            this.settings.get('orange_cm_client_id'),
            this.settings.get('orange_cm_client_secret'),
            this.settings.get('orange_cm_sender_address'),
        ]);
        const clientId = idDb || this.config.get('ORANGE_CM_CLIENT_ID', '');
        const clientSecret = secretDb || this.config.get('ORANGE_CM_CLIENT_SECRET', '');
        const senderAddr = senderDb || this.config.get('ORANGE_CM_SENDER_ADDRESS', '');
        if (!clientId || !clientSecret || !senderAddr) {
            this.logger.error('Orange CM credentials manquants — configurez via admin > Configuration > SMS');
            return false;
        }
        try {
            // Step 1: Get OAuth2 token
            const tokenRes = await fetch('https://api.orange.com/oauth/v3/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    grant_type: 'client_credentials',
                    client_id: clientId,
                    client_secret: clientSecret,
                }).toString(),
            });
            if (!tokenRes.ok) {
                this.logger.error(`Orange CM token error: ${tokenRes.status}`);
                return false;
            }
            const { access_token } = await tokenRes.json();
            // Step 2: Send SMS
            const smsRes = await fetch(`https://api.orange.com/smsmessaging/v1/outbound/${encodeURIComponent(senderAddr)}/requests`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${access_token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    outboundSMSMessageRequest: {
                        address: `tel:${to}`,
                        senderAddress: senderAddr,
                        outboundSMSTextMessage: { message },
                    },
                }),
            });
            if (!smsRes.ok) {
                const err = await smsRes.json();
                this.logger.error(`Orange CM SMS error ${smsRes.status}: ${JSON.stringify(err)}`);
                return false;
            }
            return true;
        }
        catch (e) {
            this.logger.error(`Orange CM send failed: ${e.message}`);
            return false;
        }
    }
};
exports.OrangeCmProvider = OrangeCmProvider;
exports.OrangeCmProvider = OrangeCmProvider = OrangeCmProvider_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService,
        settings_service_1.SettingsService])
], OrangeCmProvider);
//# sourceMappingURL=orange-cm.provider.js.map