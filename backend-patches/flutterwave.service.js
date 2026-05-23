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
var FlutterwaveService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.FlutterwaveService = exports.WITHDRAWAL_METHOD_TO_FLUTTERWAVE = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const settings_service_1 = require("../settings/settings.service");
const crypto = __importStar(require("crypto"));
const FLW_BASE = 'https://api.flutterwave.com/v3';
/** Mappage méthode de retrait → bank code Flutterwave (Mobile Money Cameroun) */
exports.WITHDRAWAL_METHOD_TO_FLUTTERWAVE = {
    orange_money: 'ORANGE_CM',
    mtn_momo: 'MTN_CM',
};
let FlutterwaveService = FlutterwaveService_1 = class FlutterwaveService {
    constructor(config, settings) {
        this.config = config;
        this.settings = settings;
        this.logger = new common_1.Logger(FlutterwaveService_1.name);
    }
    async cred(dbKey, envKey) {
        const fromDb = await this.settings.get(dbKey, '');
        return fromDb || this.config.get(envKey, '');
    }
    async initiate(params) {
        const secretKey = await this.cred('payment_flutterwave_secret_key', 'FLUTTERWAVE_SECRET_KEY');
        const backendUrl = await this.settings.get('backend_url', this.config.get('BACKEND_URL', 'https://aerocab-api.onrender.com'));
        const appScheme = 'aerogo24-passenger';
        const body = {
            tx_ref: params.transactionId,
            amount: params.amount,
            currency: params.currency,
            redirect_url: `${appScheme}://payment/return?ref=${encodeURIComponent(params.transactionId)}&type=wallet`,
            payment_options: 'mobilemoneycameroon,mobilemoneyrwanda,mobilemoneyzambia,mobilemoneyghana,mobilemoneytanzania,card,ussd',
            customer: {
                email: params.customerEmail || 'client@aerogo24.com',
                phone_number: params.customerPhone || '',
                name: params.customerName || 'Client',
            },
            customizations: {
                title: 'AeroGo 24',
                description: params.description,
                logo: `${backendUrl}/logo.png`,
            },
            meta: {
                source: 'wallet_recharge',
                notify_url: `${backendUrl}/api/payments/webhook/flutterwave`,
            },
        };
        const res = await fetch(`${FLW_BASE}/payments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${secretKey}` },
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            const text = await res.text();
            this.logger.error('Flutterwave initiate error', text);
            throw new Error('Erreur initialisation paiement Flutterwave');
        }
        const data = await res.json();
        if (data.status !== 'success')
            throw new Error(data.message || 'Erreur Flutterwave');
        return { paymentUrl: data.data.link };
    }
    /** Retourne le hash webhook depuis DB ou env (pour le contrôleur) */
    async getWebhookHash() {
        return this.cred('payment_flutterwave_webhook_hash', 'FLUTTERWAVE_WEBHOOK_HASH');
    }
    verifyWebhookSignature(rawBody, signature, secretKey) {
        const hash = crypto.createHmac('sha256', secretKey).update(rawBody).digest('hex');
        return hash === signature;
    }
    async transfer(params) {
        var _a, _b, _c, _d;
        const secretKey = await this.cred('payment_flutterwave_secret_key', 'FLUTTERWAVE_SECRET_KEY');
        const backendUrl = await this.settings.get('backend_url', this.config.get('BACKEND_URL', 'https://aerocab-api.onrender.com'));
        const body = {
            account_bank: params.bankCode,
            account_number: params.beneficiaryPhone,
            amount: params.amount,
            narration: params.description,
            currency: params.currency,
            reference: params.reference,
            callback_url: `${backendUrl}/api/payments/webhook/flutterwave`,
            debit_currency: params.currency,
        };
        const res = await fetch(`${FLW_BASE}/transfers`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${secretKey}` },
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            const text = await res.text();
            this.logger.error('Flutterwave transfer error', text);
            throw new Error(`Erreur disbursement Flutterwave: ${text}`);
        }
        const data = await res.json();
        if (data.status !== 'success')
            throw new Error(data.message || 'Erreur Flutterwave transfer');
        return {
            id: String((_b = (_a = data.data) === null || _a === void 0 ? void 0 : _a.id) !== null && _b !== void 0 ? _b : ''),
            status: String((_d = (_c = data.data) === null || _c === void 0 ? void 0 : _c.status) !== null && _d !== void 0 ? _d : 'pending'),
        };
    }
    async isConfigured() {
        const key = await this.cred('payment_flutterwave_secret_key', 'FLUTTERWAVE_SECRET_KEY');
        return !!key;
    }
    async verify(flwTransactionId) {
        var _a;
        const secretKey = await this.cred('payment_flutterwave_secret_key', 'FLUTTERWAVE_SECRET_KEY');
        const res = await fetch(`${FLW_BASE}/transactions/${flwTransactionId}/verify`, {
            headers: { 'Authorization': `Bearer ${secretKey}` },
        });
        const data = await res.json();
        const status = (_a = data.data) === null || _a === void 0 ? void 0 : _a.status;
        if (status === 'successful')
            return 'ACCEPTED';
        if (['failed', 'cancelled', 'error'].includes(status !== null && status !== void 0 ? status : ''))
            return 'REFUSED';
        return 'PENDING';
    }
};
exports.FlutterwaveService = FlutterwaveService;
exports.FlutterwaveService = FlutterwaveService = FlutterwaveService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService,
        settings_service_1.SettingsService])
], FlutterwaveService);
//# sourceMappingURL=flutterwave.service.js.map