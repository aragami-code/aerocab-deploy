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
var MpesaService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.MpesaService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const settings_service_1 = require("../settings/settings.service");
const DARAJA_PROD = 'https://api.safaricom.co.ke';
const DARAJA_SANDBOX = 'https://sandbox.safaricom.co.ke';
let MpesaService = MpesaService_1 = class MpesaService {
    constructor(config, settings) {
        this.config = config;
        this.settings = settings;
        this.logger = new common_1.Logger(MpesaService_1.name);
    }
    get baseUrl() {
        return this.config.get('NODE_ENV') === 'production' ? DARAJA_PROD : DARAJA_SANDBOX;
    }
    async cred(dbKey, envKey, fallback = '') {
        const fromDb = await this.settings.get(dbKey, '');
        return fromDb || this.config.get(envKey, fallback);
    }
    async getAccessToken() {
        const consumerKey = await this.cred('payment_mpesa_consumer_key', 'MPESA_CONSUMER_KEY');
        const consumerSecret = await this.cred('payment_mpesa_consumer_secret', 'MPESA_CONSUMER_SECRET');
        const cred = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
        const res = await fetch(`${this.baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
            headers: { 'Authorization': `Basic ${cred}` },
        });
        const data = await res.json();
        if (!data.access_token)
            throw new Error('M-Pesa: OAuth token introuvable');
        return data.access_token;
    }
    async buildTimestampAndPassword() {
        const shortcode = await this.cred('payment_mpesa_shortcode', 'MPESA_SHORTCODE', '174379');
        const passkey = await this.cred('payment_mpesa_passkey', 'MPESA_PASSKEY');
        const timestamp = new Date().toISOString().replace(/[-T:.Z]/g, '').slice(0, 14);
        const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');
        return { timestamp, password };
    }
    async stkPush(params) {
        const backendUrl = await this.settings.get('backend_url', this.config.get('BACKEND_URL', 'https://aerocab-api.onrender.com'));
        const shortcode = await this.cred('payment_mpesa_shortcode', 'MPESA_SHORTCODE', '174379');
        const token = await this.getAccessToken();
        const { timestamp, password } = await this.buildTimestampAndPassword();
        const body = {
            BusinessShortCode: shortcode,
            Password: password,
            Timestamp: timestamp,
            TransactionType: 'CustomerPayBillOnline',
            Amount: Math.ceil(params.amountKes),
            PartyA: params.phone,
            PartyB: shortcode,
            PhoneNumber: params.phone,
            CallBackURL: `${backendUrl}/api/payments/webhook/mpesa`,
            AccountReference: params.transactionId,
            TransactionDesc: params.description.slice(0, 13),
        };
        const res = await fetch(`${this.baseUrl}/mpesa/stkpush/v1/processrequest`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            const text = await res.text();
            this.logger.error('M-Pesa STK Push error', text);
            throw new Error('Erreur initialisation paiement M-Pesa');
        }
        const data = await res.json();
        if (data.ResponseCode !== '0')
            throw new Error(data.ResponseDescription || 'Erreur M-Pesa STK Push');
        return {
            checkoutRequestId: data.CheckoutRequestID,
            message: 'Confirmez le paiement sur votre téléphone M-Pesa',
        };
    }
    static formatPhone(phone) {
        return phone.replace(/^\+/, '').replace(/^0/, '254');
    }
};
exports.MpesaService = MpesaService;
exports.MpesaService = MpesaService = MpesaService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService,
        settings_service_1.SettingsService])
], MpesaService);
//# sourceMappingURL=mpesa.service.js.map