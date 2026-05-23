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
var WaveService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.WaveService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const settings_service_1 = require("../settings/settings.service");
const crypto = __importStar(require("crypto"));
const WAVE_BASE = 'https://api.wave.com/v1';
let WaveService = WaveService_1 = class WaveService {
    constructor(config, settings) {
        this.config = config;
        this.settings = settings;
        this.logger = new common_1.Logger(WaveService_1.name);
    }
    async cred(dbKey, envKey) {
        const fromDb = await this.settings.get(dbKey, '');
        return fromDb || this.config.get(envKey, '');
    }
    async initiate(params) {
        const apiKey = await this.cred('payment_wave_api_key', 'WAVE_API_KEY');
        const appScheme = 'aerogo24-passenger';
        const body = {
            amount: String(Math.round(params.amount)),
            currency: 'XOF', // Wave supporte XOF — équivalent XAF 1:1
            error_url: `${appScheme}://payment/return?ref=${encodeURIComponent(params.transactionId)}&type=wallet&status=cancel`,
            success_url: `${appScheme}://payment/return?ref=${encodeURIComponent(params.transactionId)}&type=wallet&status=success`,
            client_reference: params.transactionId,
        };
        const res = await fetch(`${WAVE_BASE}/checkout/sessions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            const text = await res.text();
            this.logger.error('Wave initiate error', text);
            throw new Error('Erreur initialisation paiement Wave');
        }
        const data = await res.json();
        if (!data.wave_launch_url)
            throw new Error(data.message || 'Wave: URL introuvable');
        return { paymentUrl: data.wave_launch_url, sessionId: data.id };
    }
    async getWebhookSecret() {
        return this.cred('payment_wave_webhook_secret', 'WAVE_WEBHOOK_SECRET');
    }
    verifyWebhookSignature(rawBody, signature, secret) {
        if (!secret)
            return true;
        try {
            const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
            return expected === signature;
        }
        catch (_a) {
            return false;
        }
    }
};
exports.WaveService = WaveService;
exports.WaveService = WaveService = WaveService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService,
        settings_service_1.SettingsService])
], WaveService);
//# sourceMappingURL=wave.service.js.map