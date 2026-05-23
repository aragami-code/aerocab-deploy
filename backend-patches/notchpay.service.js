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
var NotchPayService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotchPayService = exports.WITHDRAWAL_METHOD_TO_NOTCHPAY = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const settings_service_1 = require("../settings/settings.service");
const crypto = __importStar(require("crypto"));
const NOTCHPAY_BASE = 'https://api.notchpay.co';
exports.WITHDRAWAL_METHOD_TO_NOTCHPAY = {
    orange_money: 'cm.orange',
    mtn_momo: 'cm.mtn',
};
let NotchPayService = NotchPayService_1 = class NotchPayService {
    constructor(config, settings) {
        this.config = config;
        this.settings = settings;
        this.logger = new common_1.Logger(NotchPayService_1.name);
    }
    async cred(dbKey, envKey) {
        const fromDb = await this.settings.get(dbKey, '');
        return fromDb || this.config.get(envKey, '');
    }
    async initiate(params) {
        var _a, _b;
        const publicKey = await this.cred('payment_notchpay_public_key', 'NOTCHPAY_PUBLIC_KEY');
        const backendUrl = await this.settings.get('backend_url', this.config.get('BACKEND_URL', 'https://aerocab-api.onrender.com'));
        const appScheme = 'aerogo24-passenger';
        const body = {
            amount: params.amount,
            currency: params.currency,
            reference: params.transactionId,
            description: params.description,
            email: params.customerEmail || 'client@aerogo24.com',
            phone: params.customerPhone || '',
            name: params.customerName || 'Client',
            callback: `${backendUrl}/api/payments/webhook/notchpay`,
            redirect: `${appScheme}://payment/return?ref=${encodeURIComponent(params.transactionId)}&type=wallet`,
        };
        const res = await fetch(`${NOTCHPAY_BASE}/payments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': publicKey },
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            const text = await res.text();
            this.logger.error('NotchPay initiate error', text);
            throw new Error('Erreur initialisation paiement NotchPay');
        }
        const data = await res.json();
        const url = (_b = (_a = data.transaction) === null || _a === void 0 ? void 0 : _a.authorization_url) !== null && _b !== void 0 ? _b : data.authorization_url;
        if (!url)
            throw new Error(data.message || 'NotchPay: URL de paiement introuvable');
        return { paymentUrl: url };
    }
    async verify(reference) {
        var _a, _b, _c;
        const publicKey = await this.cred('payment_notchpay_public_key', 'NOTCHPAY_PUBLIC_KEY');
        const res = await fetch(`${NOTCHPAY_BASE}/payments/${encodeURIComponent(reference)}`, {
            headers: { 'Authorization': publicKey },
        });
        if (!res.ok) {
            this.logger.warn(`NotchPay verify ${reference}: HTTP ${res.status}`);
            return 'PENDING';
        }
        const data = await res.json();
        const status = ((_c = (_b = (_a = data.transaction) === null || _a === void 0 ? void 0 : _a.status) !== null && _b !== void 0 ? _b : data.status) !== null && _c !== void 0 ? _c : '').toLowerCase();
        if (status === 'complete' || status === 'completed')
            return 'ACCEPTED';
        if (['failed', 'canceled', 'cancelled', 'rejected'].includes(status))
            return 'REFUSED';
        return 'PENDING';
    }
    async transfer(params) {
        var _a, _b, _c, _d, _e, _f;
        const privateKey = await this.cred('payment_notchpay_private_key', 'NOTCHPAY_PRIVATE_KEY');
        const publicKey = await this.cred('payment_notchpay_public_key', 'NOTCHPAY_PUBLIC_KEY');
        const key = privateKey || publicKey;
        if (!key)
            throw new Error('NotchPay: clé non configurée');
        const body = {
            amount: params.amount,
            currency: params.currency,
            reference: params.reference,
            description: params.description,
            beneficiary: {
                name: params.beneficiaryName,
                phone: params.beneficiaryPhone,
                channel: params.channel,
            },
        };
        const res = await fetch(`${NOTCHPAY_BASE}/transfers`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': key },
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            const text = await res.text();
            this.logger.error('NotchPay transfer error', text);
            throw new Error(`Erreur disbursement NotchPay: ${text}`);
        }
        const data = await res.json();
        return { id: (_c = (_b = (_a = data.transfer) === null || _a === void 0 ? void 0 : _a.id) !== null && _b !== void 0 ? _b : data.id) !== null && _c !== void 0 ? _c : '', status: (_f = (_e = (_d = data.transfer) === null || _d === void 0 ? void 0 : _d.status) !== null && _e !== void 0 ? _e : data.status) !== null && _f !== void 0 ? _f : 'pending' };
    }
    async getWebhookSecret() {
        return this.cred('payment_notchpay_webhook_secret', 'NOTCHPAY_WEBHOOK_SECRET');
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
    async isConfigured() {
        const key = await this.cred('payment_notchpay_public_key', 'NOTCHPAY_PUBLIC_KEY');
        return !!key;
    }
};
exports.NotchPayService = NotchPayService;
exports.NotchPayService = NotchPayService = NotchPayService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService,
        settings_service_1.SettingsService])
], NotchPayService);
//# sourceMappingURL=notchpay.service.js.map