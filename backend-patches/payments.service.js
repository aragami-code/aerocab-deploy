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
var PaymentsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PaymentsService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const settings_service_1 = require("../settings/settings.service");
let PaymentsService = PaymentsService_1 = class PaymentsService {
    constructor(config, settings) {
        this.config = config;
        this.settings = settings;
        this.logger = new common_1.Logger(PaymentsService_1.name);
    }
    get cinetpayUrl() {
        return this.config.get('CINETPAY_URL', 'https://api-checkout.cinetpay.com/v2/payment');
    }
    get cinetpayCheckUrl() {
        return this.config.get('CINETPAY_CHECK_URL', 'https://api-checkout.cinetpay.com/v2/payment/check');
    }
    /** Lit une credential depuis app_settings en priorité, env var en fallback */
    async cred(dbKey, envKey) {
        const fromDb = await this.settings.get(dbKey, '');
        return fromDb || this.config.get(envKey, '');
    }
    async initiate(params) {
        var _a, _b, _c, _d;
        const apiKey = await this.cred('payment_cinetpay_api_key', 'CINETPAY_API_KEY');
        const siteId = await this.cred('payment_cinetpay_site_id', 'CINETPAY_SITE_ID');
        const backendUrl = await this.settings.get('backend_url', this.config.get('BACKEND_URL', 'https://aerocab-api.onrender.com'));
        const appScheme = this.config.get('PAYMENT_RETURN_SCHEME', 'aerogo24-passenger');
        const nameParts = (params.customerName || 'Client AeroGo 24').trim().split(' ');
        const surname = nameParts[0] || 'Client';
        const name = nameParts.slice(1).join(' ') || 'AeroGo 24';
        const returnUrl = `${appScheme}://payment/return?ref=${encodeURIComponent(params.transactionId)}&type=${(_a = params.returnPath) !== null && _a !== void 0 ? _a : 'payment'}`;
        const notifyUrl = `${backendUrl}/api/payments/webhook`;
        let res;
        if (siteId) {
            res = await fetch(this.cinetpayUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    apikey: apiKey, site_id: siteId,
                    transaction_id: params.transactionId,
                    amount: params.amount, currency: 'XAF',
                    description: params.description,
                    notify_url: notifyUrl, return_url: returnUrl,
                    customer_name: name, customer_surname: surname,
                    customer_phone_number: params.customerPhone || '',
                    channels: (_b = params.channels) !== null && _b !== void 0 ? _b : 'MOBILE_MONEY',
                }),
            });
        }
        else {
            res = await fetch(this.cinetpayUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                body: JSON.stringify({
                    transaction_id: params.transactionId,
                    amount: params.amount, currency: 'XAF',
                    description: params.description,
                    notify_url: notifyUrl, return_url: returnUrl,
                    customer_name: name, customer_surname: surname,
                    customer_phone_number: params.customerPhone || '',
                    channels: (_c = params.channels) !== null && _c !== void 0 ? _c : 'MOBILE_MONEY',
                }),
            });
        }
        if (!res.ok) {
            const text = await res.text();
            this.logger.error('CinetPay initiate HTTP error', text);
            throw new Error('Erreur initialisation paiement CinetPay');
        }
        const data = await res.json();
        if (data.code !== '201' && data.status !== 'success') {
            this.logger.error('CinetPay error response', JSON.stringify(data));
            throw new Error(data.message || 'Erreur CinetPay');
        }
        const paymentUrl = ((_d = data.data) === null || _d === void 0 ? void 0 : _d.payment_url) || data.payment_url;
        if (!paymentUrl)
            throw new Error('URL de paiement non reçue de CinetPay');
        return { paymentUrl };
    }
    async refund(transactionId, amount) {
        this.logger.warn(`Refund requested for transaction ${transactionId}, amount ${amount}`);
        return { success: false, message: 'Remboursement non disponible via CinetPay' };
    }
    async verify(transactionId) {
        var _a;
        const apiKey = await this.cred('payment_cinetpay_api_key', 'CINETPAY_API_KEY');
        const siteId = await this.cred('payment_cinetpay_site_id', 'CINETPAY_SITE_ID');
        let res;
        if (siteId) {
            res = await fetch(`${this.cinetpayCheckUrl}?apikey=${apiKey}&site_id=${siteId}&transaction_id=${encodeURIComponent(transactionId)}`);
        }
        else {
            res = await fetch(`${this.cinetpayCheckUrl}?transaction_id=${encodeURIComponent(transactionId)}`, { headers: { 'Authorization': `Bearer ${apiKey}` } });
        }
        const data = await res.json();
        const status = (_a = data.data) === null || _a === void 0 ? void 0 : _a.status;
        if (status === 'ACCEPTED')
            return 'ACCEPTED';
        if (['REFUSED', 'FAILED', 'ANNULED'].includes(status !== null && status !== void 0 ? status : ''))
            return 'REFUSED';
        return 'PENDING';
    }
};
exports.PaymentsService = PaymentsService;
exports.PaymentsService = PaymentsService = PaymentsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService,
        settings_service_1.SettingsService])
], PaymentsService);
//# sourceMappingURL=payments.service.js.map