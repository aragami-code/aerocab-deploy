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
var SmartSmsRouter_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SmartSmsRouter = void 0;
const common_1 = require("@nestjs/common");
const libphonenumber_js_1 = require("libphonenumber-js");
const mock_sms_provider_1 = require("./providers/mock-sms.provider");
const twilio_sms_provider_1 = require("./providers/twilio-sms.provider");
const orange_cm_provider_1 = require("./providers/orange-cm.provider");
const africas_talking_provider_1 = require("./providers/africas-talking.provider");
const settings_service_1 = require("../settings/settings.service");
/**
 * AppSetting `sms_routing_rules` format (JSON):
 * {
 *   "+237": "orange-cm",      // Cameroun
 *   "+221": "africas-talking", // Sénégal
 *   "+225": "africas-talking", // Côte d'Ivoire
 *   "default": "twilio"
 * }
 */
let SmartSmsRouter = SmartSmsRouter_1 = class SmartSmsRouter {
    constructor(mock, twilio, orangeCm, africasTalking, settings) {
        this.mock = mock;
        this.twilio = twilio;
        this.orangeCm = orangeCm;
        this.africasTalking = africasTalking;
        this.settings = settings;
        this.logger = new common_1.Logger(SmartSmsRouter_1.name);
    }
    get providers() {
        return {
            mock: this.mock,
            twilio: this.twilio,
            'orange-cm': this.orangeCm,
            'africas-talking': this.africasTalking,
        };
    }
    extractCountryCode(phone) {
        try {
            const parsed = (0, libphonenumber_js_1.parsePhoneNumber)(phone);
            if (parsed === null || parsed === void 0 ? void 0 : parsed.countryCallingCode) {
                return `+${parsed.countryCallingCode}`;
            }
        }
        catch (_a) {
            // fallback to manual prefix extraction
        }
        // Fallback: try E.164 prefix heuristic
        const digits = phone.startsWith('+') ? phone : `+${phone}`;
        for (const len of [4, 3, 2, 1]) {
            const prefix = digits.slice(0, len + 1);
            if (/^\+\d+$/.test(prefix))
                return prefix;
        }
        return '';
    }
    async send(to, message) {
        const provider = await this.resolveProvider(to);
        this.logger.log(`SMS via ${provider.name} → ${to.slice(0, 6)}***`);
        return provider.send(to, message);
    }
    async resolveProvider(to) {
        var _a, _b;
        const rulesRaw = await this.settings.get('sms_routing_rules');
        let rules = { default: 'mock' };
        if (rulesRaw) {
            try {
                rules = JSON.parse(rulesRaw);
            }
            catch (_c) {
                this.logger.warn('sms_routing_rules invalide — fallback mock');
            }
        }
        const countryCode = this.extractCountryCode(to);
        // Match longest prefix first
        const prefixes = Object.keys(rules)
            .filter(k => k !== 'default')
            .sort((a, b) => b.length - a.length);
        for (const prefix of prefixes) {
            if (countryCode.startsWith(prefix)) {
                const providerName = rules[prefix];
                const provider = this.providers[providerName];
                if (provider)
                    return provider;
                this.logger.warn(`Provider inconnu '${providerName}' pour ${prefix} — fallback`);
                break;
            }
        }
        const defaultName = (_a = rules['default']) !== null && _a !== void 0 ? _a : 'mock';
        return (_b = this.providers[defaultName]) !== null && _b !== void 0 ? _b : this.mock;
    }
};
exports.SmartSmsRouter = SmartSmsRouter;
exports.SmartSmsRouter = SmartSmsRouter = SmartSmsRouter_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [mock_sms_provider_1.MockSmsProvider,
        twilio_sms_provider_1.TwilioSmsProvider,
        orange_cm_provider_1.OrangeCmProvider,
        africas_talking_provider_1.AfricasTalkingProvider,
        settings_service_1.SettingsService])
], SmartSmsRouter);
//# sourceMappingURL=smart-sms.router.js.map