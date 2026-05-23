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
var StripeService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.StripeService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const settings_service_1 = require("../settings/settings.service");
const crypto = __importStar(require("crypto"));
const STRIPE_BASE = 'https://api.stripe.com/v1';
function encodeStripe(obj, prefix = '') {
    return Object.entries(obj)
        .map(([k, v]) => {
        const key = prefix ? `${prefix}[${k}]` : k;
        if (v !== null && typeof v === 'object' && !Array.isArray(v))
            return encodeStripe(v, key);
        return `${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`;
    })
        .join('&');
}
let StripeService = StripeService_1 = class StripeService {
    constructor(config, settings) {
        this.config = config;
        this.settings = settings;
        this.logger = new common_1.Logger(StripeService_1.name);
    }
    async cred(dbKey, envKey) {
        const fromDb = await this.settings.get(dbKey, '');
        return fromDb || this.config.get(envKey, '');
    }
    async initiate(params) {
        const secretKey = await this.cred('payment_stripe_secret_key', 'STRIPE_SECRET_KEY');
        const appScheme = 'aerogo24-passenger';
        const backendUrl = await this.settings.get('backend_url', this.config.get('BACKEND_URL', 'https://aerocab-api.onrender.com'));
        const body = encodeStripe({
            mode: 'payment',
            'line_items[0][price_data][currency]': params.currency,
            'line_items[0][price_data][unit_amount]': params.amountCents,
            'line_items[0][price_data][product_data][name]': params.description,
            'line_items[0][quantity]': 1,
            success_url: `${appScheme}://payment/return?ref=${encodeURIComponent(params.transactionId)}&type=wallet&status=success`,
            cancel_url: `${appScheme}://payment/return?ref=${encodeURIComponent(params.transactionId)}&type=wallet&status=cancel`,
            'customer_email': params.customerEmail || undefined,
            'metadata[transaction_id]': params.transactionId,
            'payment_method_types[0]': 'card',
            'payment_method_types[1]': 'link',
        });
        const res = await fetch(`${STRIPE_BASE}/checkout/sessions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': `Bearer ${secretKey}`,
            },
            body,
        });
        if (!res.ok) {
            const text = await res.text();
            this.logger.error('Stripe initiate error', text);
            throw new Error('Erreur initialisation paiement Stripe');
        }
        const data = await res.json();
        return { paymentUrl: data.url, sessionId: data.id };
    }
    /** Retourne le webhook secret depuis DB ou env (pour le contrôleur) */
    async getWebhookSecret() {
        return this.cred('payment_stripe_webhook_secret', 'STRIPE_WEBHOOK_SECRET');
    }
    verifyWebhookSignature(rawBody, signature, webhookSecret) {
        try {
            const parts = signature.split(',').reduce((acc, part) => {
                const [k, v] = part.split('=');
                acc[k] = v;
                return acc;
            }, {});
            const timestamp = parts['t'];
            const sigHash = parts['v1'];
            const payload = `${timestamp}.${rawBody}`;
            const expected = crypto.createHmac('sha256', webhookSecret).update(payload).digest('hex');
            return expected === sigHash;
        }
        catch (_a) {
            return false;
        }
    }
    async getSessionStatus(sessionId) {
        const secretKey = await this.cred('payment_stripe_secret_key', 'STRIPE_SECRET_KEY');
        const res = await fetch(`${STRIPE_BASE}/checkout/sessions/${sessionId}`, {
            headers: { 'Authorization': `Bearer ${secretKey}` },
        });
        const data = await res.json();
        if (data.payment_status === 'paid')
            return 'ACCEPTED';
        if (data.status === 'expired')
            return 'REFUSED';
        return 'PENDING';
    }
    // ── PaymentIntent (pré-autorisation manuelle pour les courses) ─────────────
    /**
     * Crée un PaymentIntent avec capture_method=manual.
     * La carte est bloquée mais pas débitée tant que capturePaymentIntent n'est pas appelé.
     * Retourne le client_secret à envoyer au SDK mobile Stripe.
     */
    async createPaymentIntent(params) {
        const secretKey = await this.cred('payment_stripe_secret_key', 'STRIPE_SECRET_KEY');
        if (!secretKey)
            throw new Error('Stripe: clé secrète non configurée');
        const body = encodeStripe({
            amount: params.amountCents,
            currency: params.currency,
            capture_method: 'manual',
            description: params.description,
            'metadata[booking_id]': params.bookingId,
            'metadata[reference]': params.reference,
            'payment_method_types[0]': 'card',
        });
        const res = await fetch(`${STRIPE_BASE}/payment_intents`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': `Bearer ${secretKey}`,
            },
            body,
        });
        if (!res.ok) {
            const text = await res.text();
            this.logger.error('Stripe createPaymentIntent error', text);
            throw new Error('Erreur création PaymentIntent Stripe');
        }
        const data = await res.json();
        return { paymentIntentId: data.id, clientSecret: data.client_secret };
    }
    /** Capture les fonds après confirmation manuelle (fin de course). */
    async capturePaymentIntent(paymentIntentId) {
        const secretKey = await this.cred('payment_stripe_secret_key', 'STRIPE_SECRET_KEY');
        const res = await fetch(`${STRIPE_BASE}/payment_intents/${paymentIntentId}/capture`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${secretKey}` },
        });
        if (!res.ok) {
            const text = await res.text();
            this.logger.error(`Stripe capture ${paymentIntentId} error`, text);
            throw new Error('Erreur capture Stripe PaymentIntent');
        }
    }
    /** Annule un PaymentIntent (voiding pré-auth ou annulation avant capture). */
    async cancelPaymentIntent(paymentIntentId) {
        const secretKey = await this.cred('payment_stripe_secret_key', 'STRIPE_SECRET_KEY');
        const res = await fetch(`${STRIPE_BASE}/payment_intents/${paymentIntentId}/cancel`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${secretKey}` },
        });
        if (!res.ok) {
            const text = await res.text();
            this.logger.warn(`Stripe cancel ${paymentIntentId}: ${text}`);
        }
    }
    /** Rembourse un PaymentIntent déjà capturé (annulation post-capture). */
    async refundPaymentIntent(paymentIntentId, amountCents) {
        const secretKey = await this.cred('payment_stripe_secret_key', 'STRIPE_SECRET_KEY');
        const body = amountCents
            ? encodeStripe({ payment_intent: paymentIntentId, amount: amountCents })
            : encodeStripe({ payment_intent: paymentIntentId });
        const res = await fetch(`${STRIPE_BASE}/refunds`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': `Bearer ${secretKey}`,
            },
            body,
        });
        if (!res.ok) {
            const text = await res.text();
            this.logger.error(`Stripe refund ${paymentIntentId} error`, text);
            throw new Error('Erreur remboursement Stripe');
        }
    }
    /** Vérifie le statut d'un PaymentIntent. */
    async getPaymentIntentStatus(paymentIntentId) {
        var _a;
        const secretKey = await this.cred('payment_stripe_secret_key', 'STRIPE_SECRET_KEY');
        const res = await fetch(`${STRIPE_BASE}/payment_intents/${paymentIntentId}`, {
            headers: { 'Authorization': `Bearer ${secretKey}` },
        });
        const data = await res.json();
        return (_a = data.status) !== null && _a !== void 0 ? _a : 'unknown';
    }
};
exports.StripeService = StripeService;
exports.StripeService = StripeService = StripeService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService,
        settings_service_1.SettingsService])
], StripeService);
//# sourceMappingURL=stripe.service.js.map