"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var SmtpEmailProvider_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SmtpEmailProvider = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const settings_service_1 = require("../../settings/settings.service");
const nodemailer = __importStar(require("nodemailer"));

let SmtpEmailProvider = SmtpEmailProvider_1 = class SmtpEmailProvider {
    constructor(config, settings) {
        this.config = config;
        this.settings = settings;
        this.name = 'smtp';
        this.logger = new common_1.Logger(SmtpEmailProvider_1.name);
    }

    async send(to, subject, html) {
        var _a, _b;
        // Priorité : AppSetting (admin) → env var (fallback)
        const [hostDb, portDb, userDb, passDb, fromDb] = await Promise.all([
            this.settings.get('smtp_host', ''),
            this.settings.get('smtp_port', ''),
            this.settings.get('smtp_user', ''),
            this.settings.get('smtp_pass', ''),
            this.settings.get('smtp_from_email', ''),
        ]);

        const host = hostDb || this.config.get('SMTP_HOST', '');
        const portRaw = portDb || ((_a = this.config.get('SMTP_PORT')) !== null && _a !== void 0 ? _a : '587');
        const port = parseInt(portRaw, 10);
        const user = userDb || this.config.get('SMTP_USER', '');
        const pass = passDb || this.config.get('SMTP_PASS', '');
        const from = fromDb || ((_b = this.config.get('SMTP_FROM_EMAIL')) !== null && _b !== void 0 ? _b : user);

        if (!host || !user || !pass || !from) {
            this.logger.error('SMTP credentials manquants — configurez via Admin > Configuration > Email');
            return false;
        }

        try {
            const transporter = nodemailer.createTransport({
                host,
                port,
                secure: port === 465,
                auth: { user, pass },
            });
            await transporter.sendMail({ from, to, subject, html });
            this.logger.log(`[SMTP] Email envoyé → ${to}`);
            return true;
        }
        catch (e) {
            this.logger.error(`SMTP send failed: ${e.message}`);
            return false;
        }
    }
};
exports.SmtpEmailProvider = SmtpEmailProvider;
exports.SmtpEmailProvider = SmtpEmailProvider = SmtpEmailProvider_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService, settings_service_1.SettingsService])
], SmtpEmailProvider);
//# sourceMappingURL=smtp-email.provider.js.map
