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
var PaypalService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PaypalService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const settings_service_1 = require("../settings/settings.service");
const PAYPAL_PROD = 'https://api-m.paypal.com';
const PAYPAL_SANDBOX = 'https://api-m.sandbox.paypal.com';
let PaypalService = PaypalService_1 = class PaypalService {
    constructor(config, settings) {
        this.config = config;
        this.settings = settings;
        this.logger = new common_1.Logger(PaypalService_1.name);
    }
    get baseUrl() {
        return this.config.get('NODE_ENV') === 'production' ? PAYPAL_PROD : PAYPAL_SANDBOX;
    }
    async cred(dbKey, envKey) {
        const fromDb = await this.settings.get(dbKey, '');
        return fromDb || this.config.get(envKey, '');
    }
    async getAccessToken() {
        const clientId = await this.cred('payment_paypal_client_id', 'PAYPAL_CLIENT_ID');
        const clientSecret = await this.cred('payment_paypal_client_secret', 'PAYPAL_CLIENT_SECRET');
        const cred = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
        const res = await fetch(`${this.baseUrl}/v1/oauth2/token`, {
            method: 'POST',
            headers: { 'Authorization': `Basic ${cred}`, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'grant_type=client_credentials',
        });
        const data = await res.json();
        if (!data.access_token)
            throw new Error('PayPal: OAuth token introuvable');
        return data.access_token;
    }
    async initiate(params) {
        var _a, _b;
        const appScheme = 'aerogo24-passenger';
        const backendUrl = await this.settings.get('backend_url', this.config.get('BACKEND_URL', 'https://aerocab-api.onrender.com'));
        const token = await this.getAccessToken();
        const body = {
            intent: 'CAPTURE',
            purchase_units: [{
                    reference_id: params.transactionId,
                    custom_id: params.transactionId,
                    description: params.description,
                    amount: { currency_code: params.currency.toUpperCase(), value: params.amount.toFixed(2) },
                }],
            application_context: {
                brand_name: 'AeroGo 24',
                shipping_preference: 'NO_SHIPPING',
                user_action: 'PAY_NOW',
                notify_url: `${backendUrl}/api/payments/webhook/paypal`,
                return_url: `${appScheme}://payment/return?ref=${encodeURIComponent(params.transactionId)}&type=wallet&status=success`,
                cancel_url: `${appScheme}://payment/return?ref=${encodeURIComponent(params.transactionId)}&type=wallet&status=cancel`,
            },
        };
        const res = await fetch(`${this.baseUrl}/v2/checkout/orders`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
                'PayPal-Request-Id': params.transactionId,
            },
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            const text = await res.text();
            this.logger.error('PayPal initiate error', text);
            throw new Error('Erreur initialisation paiement PayPal');
        }
        const data = await res.json();
        const approveLink = (_b = (_a = data.links) === null || _a === void 0 ? void 0 : _a.find((l) => l.rel === 'approve')) === null || _b === void 0 ? void 0 : _b.href;
        if (!approveLink)
            throw new Error('PayPal: lien approve introuvable');
        return { paymentUrl: approveLink, orderId: data.id };
    }
    async captureOrder(orderId) {
        var _a;
        const token = await this.getAccessToken();
        const res = await fetch(`${this.baseUrl}/v2/checkout/orders/${orderId}/capture`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        });
        if (!res.ok) {
            this.logger.error('PayPal capture error', await res.text());
            return 'REFUSED';
        }
        const data = await res.json();
        if (data.status === 'COMPLETED')
            return 'ACCEPTED';
        if (['VOIDED', 'DECLINED'].includes((_a = data.status) !== null && _a !== void 0 ? _a : ''))
            return 'REFUSED';
        return 'PENDING';
    }
    async verifyWebhookSignature(headers, rawBody) {
        var _a, _b, _c, _d, _e;
        const webhookId = await this.cred('payment_paypal_webhook_id', 'PAYPAL_WEBHOOK_ID');
        if (!webhookId)
            return true;
        try {
            const token = await this.getAccessToken();
            const res = await fetch(`${this.baseUrl}/v1/notifications/verify-webhook-signature`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({
                    transmission_id: (_a = headers['paypal-transmission-id']) !== null && _a !== void 0 ? _a : '',
                    transmission_time: (_b = headers['paypal-transmission-time']) !== null && _b !== void 0 ? _b : '',
                    cert_url: (_c = headers['paypal-cert-url']) !== null && _c !== void 0 ? _c : '',
                    auth_algo: (_d = headers['paypal-auth-algo']) !== null && _d !== void 0 ? _d : '',
                    transmission_sig: (_e = headers['paypal-transmission-sig']) !== null && _e !== void 0 ? _e : '',
                    webhook_id: webhookId,
                    webhook_event: JSON.parse(rawBody),
                }),
            });
            const data = await res.json();
            return data.verification_status === 'SUCCESS';
        }
        catch (_f) {
            return false;
        }
    }
};
exports.PaypalService = PaypalService;
exports.PaypalService = PaypalService = PaypalService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService,
        settings_service_1.SettingsService])
], PaypalService);
//# sourceMappingURL=paypal.service.js.map