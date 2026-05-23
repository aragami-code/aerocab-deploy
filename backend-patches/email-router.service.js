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
var EmailRouterService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmailRouterService = void 0;
const common_1 = require("@nestjs/common");
const mock_email_provider_1 = require("./providers/mock-email.provider");
const sendgrid_email_provider_1 = require("./providers/sendgrid-email.provider");
const smtp_email_provider_1 = require("./providers/smtp-email.provider");
const settings_service_1 = require("../settings/settings.service");
/**
 * AppSetting `email_provider`: 'sendgrid' | 'smtp' | 'mock' (default: 'mock')
 */
let EmailRouterService = EmailRouterService_1 = class EmailRouterService {
    constructor(mock, sendgrid, smtp, settings) {
        this.mock = mock;
        this.sendgrid = sendgrid;
        this.smtp = smtp;
        this.settings = settings;
        this.logger = new common_1.Logger(EmailRouterService_1.name);
    }
    async send(to, subject, html) {
        const provider = await this.resolveProvider();
        this.logger.log(`Email via ${provider.name} → ${to}`);
        return provider.send(to, subject, html);
    }
    async resolveProvider() {
        var _a;
        const name = (_a = await this.settings.get('email_provider')) !== null && _a !== void 0 ? _a : 'mock';
        const map = {
            sendgrid: this.sendgrid,
            smtp: this.smtp,
            mock: this.mock,
        };
        const provider = map[name];
        if (!provider) {
            this.logger.warn(`Provider email inconnu '${name}' — fallback mock`);
            return this.mock;
        }
        return provider;
    }
};
exports.EmailRouterService = EmailRouterService;
exports.EmailRouterService = EmailRouterService = EmailRouterService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [mock_email_provider_1.MockEmailProvider,
        sendgrid_email_provider_1.SendgridEmailProvider,
        smtp_email_provider_1.SmtpEmailProvider,
        settings_service_1.SettingsService])
], EmailRouterService);
//# sourceMappingURL=email-router.service.js.map