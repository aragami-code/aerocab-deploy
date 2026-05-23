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
var SendgridEmailProvider_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SendgridEmailProvider = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const settings_service_1 = require("../../settings/settings.service");
let SendgridEmailProvider = SendgridEmailProvider_1 = class SendgridEmailProvider {
    constructor(config, settings) {
        this.config = config;
        this.settings = settings;
        this.name = 'sendgrid';
        this.logger = new common_1.Logger(SendgridEmailProvider_1.name);
    }
    async send(to, subject, html) {
        // Priorité : AppSetting (admin) → env var (fallback)
        const [keyDb, fromDb] = await Promise.all([
            this.settings.get('sendgrid_api_key'),
            this.settings.get('sendgrid_from_email'),
        ]);
        const apiKey = keyDb || this.config.get('SENDGRID_API_KEY', '');
        const from = fromDb || this.config.get('SENDGRID_FROM_EMAIL', '');
        if (!apiKey || !from) {
            this.logger.error('SendGrid credentials manquants — configurez via admin > Configuration > Email');
            return false;
        }
        try {
            const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    personalizations: [{ to: [{ email: to }] }],
                    from: { email: from },
                    subject,
                    content: [{ type: 'text/html', value: html }],
                }),
            });
            if (!res.ok) {
                const body = await res.text();
                this.logger.error(`SendGrid error ${res.status}: ${body}`);
                return false;
            }
            return true;
        }
        catch (e) {
            this.logger.error(`SendGrid send failed: ${e.message}`);
            return false;
        }
    }
};
exports.SendgridEmailProvider = SendgridEmailProvider;
exports.SendgridEmailProvider = SendgridEmailProvider = SendgridEmailProvider_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService,
        settings_service_1.SettingsService])
], SendgridEmailProvider);
//# sourceMappingURL=sendgrid-email.provider.js.map