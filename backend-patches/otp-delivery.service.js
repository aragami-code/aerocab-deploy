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
var OtpDeliveryService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.OtpDeliveryService = void 0;
const common_1 = require("@nestjs/common");
const smart_sms_router_1 = require("../sms/smart-sms.router");
const email_router_service_1 = require("../email/email-router.service");
const settings_service_1 = require("../settings/settings.service");
const TEMPLATES = {
    fr: {
        otp: {
            sms: 'AeroGo 24 — Votre code de vérification : {{code}}. Valide {{expiry}} min.',
            emailSubject: 'AeroGo 24 — Code de vérification',
            emailHtml: '<p>Bonjour,</p><p>Votre code de vérification AeroGo 24 est : <strong>{{code}}</strong></p><p>Ce code expire dans {{expiry}} minutes.</p>',
        },
    },
    en: {
        otp: {
            sms: 'AeroGo 24 — Your verification code: {{code}}. Valid {{expiry}} min.',
            emailSubject: 'AeroGo 24 — Verification code',
            emailHtml: '<p>Hello,</p><p>Your AeroGo 24 verification code is: <strong>{{code}}</strong></p><p>This code expires in {{expiry}} minutes.</p>',
        },
    },
};
function renderTemplate(template, vars) {
    return Object.entries(vars).reduce((t, [key, value]) => t.split(`{{${key}}}`).join(value), template);
}
/**
 * Orchestrates OTP delivery via SMS or email based on AppSetting `otp_channel`.
 * `otp_channel`: 'sms' | 'email' | 'both' (default: 'sms')
 * `otp_expiry_minutes`: used in message templates (display only)
 */
let OtpDeliveryService = OtpDeliveryService_1 = class OtpDeliveryService {
    constructor(sms, email, settings) {
        this.sms = sms;
        this.email = email;
        this.settings = settings;
        this.logger = new common_1.Logger(OtpDeliveryService_1.name);
    }
    /**
     * Send OTP via the configured channel(s).
     * @param contact  phone number (E.164) or email address
     * @param code     6-digit OTP
     * @param lang     language for message template (default: 'fr')
     */
    async sendOtp(contact, code, lang = 'fr') {
        var _a;
        const channel = (_a = await this.settings.get('otp_channel')) !== null && _a !== void 0 ? _a : 'sms';
        const expiryRaw = await this.settings.get('otp_expiry_minutes');
        const expiry = expiryRaw || '5';
        const locale = TEMPLATES[lang] ? lang : 'fr';
        const tpl = TEMPLATES[locale].otp;
        const vars = { code, expiry };
        const isEmail = contact.includes('@');
        let sent = false;
        if (channel === 'both') {
            if (isEmail) {
                sent = await this.sendEmail(contact, tpl, vars);
            }
            else {
                const smsSent = await this.sendSms(contact, tpl, vars);
                sent = smsSent;
            }
        }
        else if (channel === 'email') {
            if (!isEmail) {
                this.logger.warn(`otp_channel=email mais contact semble être un numéro: ${contact.slice(0, 6)}***`);
                return false;
            }
            sent = await this.sendEmail(contact, tpl, vars);
        }
        else {
            // default: sms
            if (isEmail) {
                this.logger.warn(`otp_channel=sms mais contact semble être un email: ${contact.slice(0, 4)}***`);
                return false;
            }
            sent = await this.sendSms(contact, tpl, vars);
        }
        return sent;
    }
    async sendSms(phone, tpl, vars) {
        const message = renderTemplate(tpl.sms, vars);
        return this.sms.send(phone, message);
    }
    async sendEmail(emailAddr, tpl, vars) {
        const subject = renderTemplate(tpl.emailSubject, vars);
        const html = renderTemplate(tpl.emailHtml, vars);
        return this.email.send(emailAddr, subject, html);
    }
};
exports.OtpDeliveryService = OtpDeliveryService;
exports.OtpDeliveryService = OtpDeliveryService = OtpDeliveryService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [smart_sms_router_1.SmartSmsRouter,
        email_router_service_1.EmailRouterService,
        settings_service_1.SettingsService])
], OtpDeliveryService);
//# sourceMappingURL=otp-delivery.service.js.map