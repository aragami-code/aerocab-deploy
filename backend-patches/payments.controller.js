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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var PaymentsController_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PaymentsController = void 0;
const common_1 = require("@nestjs/common");
const payments_service_1 = require("./payments.service");
const flutterwave_service_1 = require("./flutterwave.service");
const stripe_service_1 = require("./stripe.service");
const notchpay_service_1 = require("./notchpay.service");
const mpesa_service_1 = require("./mpesa.service");
const paypal_service_1 = require("./paypal.service");
const wave_service_1 = require("./wave.service");
const payment_intent_service_1 = require("./payment-intent.service");
const payout_service_1 = require("./payout.service");
const tip_service_1 = require("./tip.service");
const split_service_1 = require("./split.service");
const prisma_service_1 = require("../database/prisma.service");
const settings_service_1 = require("../settings/settings.service");
const guards_1 = require("../auth/guards");
const decorators_1 = require("../auth/decorators");
const throttler_1 = require("@nestjs/throttler");
/**
 * Taux de change XAF → devise cible (1 XAF = X devise).
 * Approximations statiques — remplacer par une API de change en production.
 */
const EXCHANGE_RATES = {
    XAF: 1,
    USD: 0.00165, // 1 USD ≈ 606 XAF
    EUR: 0.00152, // 1 EUR ≈ 656 XAF
    GBP: 0.00130, // 1 GBP ≈ 769 XAF
    CAD: 0.00224, // 1 CAD ≈ 446 XAF
    CHF: 0.00152, // 1 CHF ≈ 656 XAF
    NGN: 2.50, // 1 NGN ≈ 0.40 XAF
    GHS: 0.020, // 1 GHS ≈ 50 XAF
    MAD: 0.0165, // 1 MAD ≈ 60 XAF
    DZD: 0.224, // 1 DZD ≈ 4.5 XAF
    CNY: 0.012, // 1 CNY ≈ 83 XAF
    JPY: 0.25, // 1 JPY ≈ 4 XAF
    KES: 0.133, // 1 KES ≈ 7.5 XAF  (M-Pesa Kenya)
};
const CURRENCY_SYMBOLS = {
    XAF: 'FCFA', USD: '$', EUR: '€', GBP: '£', CAD: 'CA$',
    CHF: 'CHF', NGN: '₦', GHS: '₵', MAD: 'DH', DZD: 'DA',
    CNY: '¥', JPY: '¥', KES: 'KSh',
};
function convertFromFcfa(amountFcfa, currency) {
    var _a;
    const rate = (_a = EXCHANGE_RATES[currency]) !== null && _a !== void 0 ? _a : EXCHANGE_RATES['USD'];
    const converted = amountFcfa * rate;
    if (['JPY', 'NGN', 'DZD', 'KES', 'XAF'].includes(currency))
        return Math.round(converted);
    return Math.round(converted * 100) / 100;
}
let PaymentsController = PaymentsController_1 = class PaymentsController {
    constructor(payments, flutterwave, stripe, notchpay, mpesa, paypal, wave, paymentIntent, payout, tip, split, prisma, settings) {
        this.payments = payments;
        this.flutterwave = flutterwave;
        this.stripe = stripe;
        this.notchpay = notchpay;
        this.mpesa = mpesa;
        this.paypal = paypal;
        this.wave = wave;
        this.paymentIntent = paymentIntent;
        this.payout = payout;
        this.tip = tip;
        this.split = split;
        this.prisma = prisma;
        this.settings = settings;
        this.logger = new common_1.Logger(PaymentsController_1.name);
    }
    /**
     * GET /payments/wallet?currency=USD
     */
    async getWallet(req, currency = 'XAF') {
        var _a;
        const userId = req.user.id;
        const targetCurrency = (EXCHANGE_RATES[currency] ? currency : 'XAF').toUpperCase();
        let wallet = await this.prisma.wallet.findUnique({ where: { userId } });
        if (!wallet) {
            wallet = await this.prisma.wallet.create({ data: { userId, balance: 0 } });
        }
        const tariffs = await this.settings.getTariffs();
        const fcfaPerPoint = tariffs.fcfaPerPoint;
        const transactions = await this.prisma.transaction.findMany({
            where: { walletId: wallet.id },
            orderBy: { createdAt: 'desc' },
            take: 20,
        });
        const packagesRaw = await this.settings.get('points_recharge_packages', '[1000,3000,5000,10000]');
        let packageSizes;
        try {
            packageSizes = JSON.parse(packagesRaw);
        }
        catch (_b) {
            packageSizes = [1000, 3000, 5000, 10000];
        }
        const labelMap = { 1000: 'Standard', 3000: 'Pack Argent', 5000: 'Pack Or', 10000: 'VIP Rewards' };
        const packages = packageSizes.map((points) => {
            var _a, _b;
            const amountFcfa = points * fcfaPerPoint;
            const amountLocal = convertFromFcfa(amountFcfa, targetCurrency);
            return {
                id: `pack_${points}`,
                points,
                amountFcfa,
                amountLocal,
                currency: targetCurrency,
                symbol: (_a = CURRENCY_SYMBOLS[targetCurrency]) !== null && _a !== void 0 ? _a : targetCurrency,
                label: (_b = labelMap[points]) !== null && _b !== void 0 ? _b : `${points} pts`,
            };
        });
        return {
            balance: Math.floor(wallet.balance),
            packages,
            transactions,
            fcfaPerPoint,
            currency: targetCurrency,
            symbol: (_a = CURRENCY_SYMBOLS[targetCurrency]) !== null && _a !== void 0 ? _a : targetCurrency,
        };
    }
    /**
     * GET /payments/methods
     * Retourne les méthodes de paiement disponibles selon le pays de l'utilisateur (via préfixe téléphonique).
     */
    async getPaymentMethods(req) {
        const user = await this.prisma.user.findUnique({
            where: { id: req.user.id },
            select: { phone: true },
        });
        const PHONE_PREFIX_MAP = {
            '+237': 'CM', '+221': 'SN', '+225': 'CI', '+242': 'CG',
            '+241': 'GA', '+236': 'CF', '+235': 'TD', '+240': 'GQ',
            '+254': 'KE', '+255': 'TZ', '+256': 'UG', '+234': 'NG',
            '+233': 'GH', '+212': 'MA', '+216': 'TN', '+213': 'DZ',
        };
        let countryCode = 'CM';
        if (user === null || user === void 0 ? void 0 : user.phone) {
            for (const [prefix, code] of Object.entries(PHONE_PREFIX_MAP)) {
                if (user.phone.startsWith(prefix)) {
                    countryCode = code;
                    break;
                }
            }
        }
        const country = await this.prisma.country.findUnique({
            where: { code: countryCode },
            select: { paymentMethods: true },
        });
        const DEFAULT_METHODS = [
            { id: 'orange_money_cm', label: 'Orange Money', icon: 'orange_money' },
            { id: 'mtn_cm', label: 'MTN MoMo', icon: 'mtn_momo' },
            { id: 'cash', label: 'Espèces', icon: 'cash' },
        ];
        const methods = Array.isArray(country === null || country === void 0 ? void 0 : country.paymentMethods) && country.paymentMethods.length
            ? country.paymentMethods
            : DEFAULT_METHODS;
        return { methods, countryCode };
    }
    /**
     * GET /payments/default-payment-method
     * Retourne la méthode de paiement par défaut de l'utilisateur.
     */
    async getDefaultPaymentMethod(req) {
        var _a;
        const user = await this.prisma.user.findUnique({
            where: { id: req.user.id },
            select: { defaultPaymentMethod: true },
        });
        return { defaultPaymentMethod: (_a = user === null || user === void 0 ? void 0 : user.defaultPaymentMethod) !== null && _a !== void 0 ? _a : null };
    }
    /**
     * PATCH /payments/default-payment-method
     * Définit la méthode de paiement par défaut de l'utilisateur.
     */
    async setDefaultPaymentMethod(req, body) {
        if (!body.method)
            throw new common_1.BadRequestException('method requis');
        await this.prisma.user.update({
            where: { id: req.user.id },
            data: { defaultPaymentMethod: body.method },
        });
        return { defaultPaymentMethod: body.method };
    }
    /**
     * GET /payments/spending?month=2026-04
     * Retourne le total dépensé et le nombre de trajets pour un mois donné.
     */
    async getMonthlySpending(req, month) {
        var _a, _b;
        const target = month ? new Date(`${month}-01`) : new Date();
        const startOfMonth = new Date(target.getFullYear(), target.getMonth(), 1);
        const endOfMonth = new Date(target.getFullYear(), target.getMonth() + 1, 0, 23, 59, 59);
        const result = await this.prisma.booking.aggregate({
            where: {
                passengerId: req.user.id,
                status: 'completed',
                createdAt: { gte: startOfMonth, lte: endOfMonth },
            },
            _sum: { estimatedPrice: true },
            _count: { id: true },
        });
        return {
            totalFcfa: (_a = result._sum.estimatedPrice) !== null && _a !== void 0 ? _a : 0,
            tripCount: (_b = result._count.id) !== null && _b !== void 0 ? _b : 0,
            month: `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}`,
        };
    }
    /**
     * POST /payments/recharge
     * provider: cinetpay | flutterwave | stripe | notchpay | mpesa | paypal | wave
     *
     * Stripe/PayPal: currency = 'eur'|'usd'|'gbp'
     * Flutterwave:   currency = 'XAF'|'NGN'|'GHS'…
     * M-Pesa:        phone requis (format international +254…)
     *
     * Rate limit : 5 tentatives / minute / utilisateur
     */
    async recharge(req, body) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j;
        const userId = req.user.id;
        const provider = ((_a = body.provider) !== null && _a !== void 0 ? _a : 'cinetpay');
        // ── Vérifier que le fournisseur est activé ───────────────────────────────
        const enabledFlag = await this.settings.get(`payment_${provider}_enabled`, 'true');
        if (enabledFlag === 'false') {
            throw new common_1.BadRequestException(`Le fournisseur de paiement "${provider}" est désactivé`);
        }
        // ── Résoudre le forfait ──────────────────────────────────────────────────
        let points = 0;
        let label = '';
        if (body.packageId === 'custom' && body.customAmount) {
            points = body.customAmount;
            label = 'Recharge personnalisée';
        }
        else {
            const match = (_b = body.packageId) === null || _b === void 0 ? void 0 : _b.match(/^pack_(\d+)$/);
            if (!match)
                throw new Error(`Forfait inconnu: ${body.packageId}`);
            points = parseInt(match[1], 10);
            const labelMap = { 1000: 'Standard', 3000: 'Pack Argent', 5000: 'Pack Or', 10000: 'VIP Rewards' };
            label = (_c = labelMap[points]) !== null && _c !== void 0 ? _c : `${points} pts`;
        }
        const tariffs = await this.settings.getTariffs();
        const amountFcfa = points * tariffs.fcfaPerPoint;
        // ── Contrôle montant maximum ─────────────────────────────────────────────
        const maxRaw = await this.settings.get('payment_max_recharge_amount', '500000');
        const maxAmount = parseInt(maxRaw, 10) || 500000;
        if (amountFcfa > maxAmount) {
            throw new common_1.BadRequestException(`Montant maximum de recharge dépassé : ${maxAmount.toLocaleString()} FCFA autorisés par transaction`);
        }
        let wallet = await this.prisma.wallet.findUnique({ where: { userId } });
        if (!wallet)
            wallet = await this.prisma.wallet.create({ data: { userId, balance: 0 } });
        const userInfo = await this.prisma.user.findUnique({ where: { id: userId } });
        const reference = `WALLET-${provider.toUpperCase()}-${Date.now()}-${userId.slice(0, 8)}`;
        const description = `AeroGo 24 — ${label} (${points} pts)`;
        // Créer la transaction en attente (metadata sera enrichi pour M-Pesa)
        await this.prisma.transaction.create({
            data: {
                walletId: wallet.id,
                amount: amountFcfa,
                type: 'deposit',
                status: 'pending',
                reference,
                metadata: { packageId: body.packageId, points, provider },
            },
        });
        // ── Flutterwave ──────────────────────────────────────────────────────────
        if (provider === 'flutterwave') {
            const currency = (_e = (_d = body.currency) === null || _d === void 0 ? void 0 : _d.toUpperCase()) !== null && _e !== void 0 ? _e : 'XAF';
            return this.flutterwave.initiate({
                transactionId: reference,
                amount: convertFromFcfa(amountFcfa, currency),
                currency,
                description,
                customerName: (userInfo === null || userInfo === void 0 ? void 0 : userInfo.name) || 'Client',
                customerPhone: (userInfo === null || userInfo === void 0 ? void 0 : userInfo.phone) || '',
                customerEmail: (userInfo === null || userInfo === void 0 ? void 0 : userInfo.email) || 'client@aerogo24.com',
            });
        }
        // ── Stripe (carte + Link + Apple Pay + Google Pay) ───────────────────────
        if (provider === 'stripe') {
            const stripeCurrency = ((_f = body.currency) !== null && _f !== void 0 ? _f : 'eur').toLowerCase();
            const STRIPE_RATES = { eur: 0.00152, usd: 0.00165, gbp: 0.00130, cad: 0.00224 };
            const rate = (_g = STRIPE_RATES[stripeCurrency]) !== null && _g !== void 0 ? _g : STRIPE_RATES['eur'];
            const amountCents = Math.round(amountFcfa * rate * 100);
            return this.stripe.initiate({
                transactionId: reference,
                amountCents,
                currency: stripeCurrency,
                description,
                customerEmail: (userInfo === null || userInfo === void 0 ? void 0 : userInfo.email) || '',
            });
        }
        // ── NotchPay (Orange Money CM, MTN MoMo CM, carte) ──────────────────────
        if (provider === 'notchpay') {
            return this.notchpay.initiate({
                transactionId: reference,
                amount: amountFcfa,
                currency: 'XAF',
                description,
                customerName: (userInfo === null || userInfo === void 0 ? void 0 : userInfo.name) || 'Client',
                customerPhone: (userInfo === null || userInfo === void 0 ? void 0 : userInfo.phone) || '',
                customerEmail: (userInfo === null || userInfo === void 0 ? void 0 : userInfo.email) || 'client@aerogo24.com',
            });
        }
        // ── M-Pesa (STK Push Kenya) ──────────────────────────────────────────────
        if (provider === 'mpesa') {
            const phone = body.phone || (userInfo === null || userInfo === void 0 ? void 0 : userInfo.phone) || '';
            if (!phone)
                throw new Error('M-Pesa: numéro de téléphone requis (paramètre phone)');
            const mpesaPhone = mpesa_service_1.MpesaService.formatPhone(phone);
            const amountKes = convertFromFcfa(amountFcfa, 'KES');
            const result = await this.mpesa.stkPush({
                transactionId: reference,
                amountKes,
                phone: mpesaPhone,
                description,
            });
            // Stocker le checkoutRequestId pour retrouver la transaction lors du callback
            await this.prisma.transaction.update({
                where: { reference },
                data: { metadata: { packageId: body.packageId, points, provider, checkoutRequestId: result.checkoutRequestId } },
            });
            return result;
        }
        // ── PayPal (USD/EUR, carte internationale) ───────────────────────────────
        if (provider === 'paypal') {
            const paypalCurrency = ((_h = body.currency) !== null && _h !== void 0 ? _h : 'USD').toUpperCase();
            const rate = (_j = EXCHANGE_RATES[paypalCurrency]) !== null && _j !== void 0 ? _j : EXCHANGE_RATES['USD'];
            const amount = Math.round(amountFcfa * rate * 100) / 100;
            const { paymentUrl, orderId } = await this.paypal.initiate({
                transactionId: reference,
                amount,
                currency: paypalCurrency,
                description,
                customerEmail: userInfo === null || userInfo === void 0 ? void 0 : userInfo.email,
            });
            // Stocker l'orderId pour la capture dans le webhook
            await this.prisma.transaction.update({
                where: { reference },
                data: { metadata: { packageId: body.packageId, points, provider, orderId } },
            });
            return { paymentUrl };
        }
        // ── Wave (XOF Afrique de l'Ouest) ────────────────────────────────────────
        if (provider === 'wave') {
            const { paymentUrl } = await this.wave.initiate({
                transactionId: reference,
                amount: amountFcfa, // XAF ≈ XOF 1:1
                description,
            });
            return { paymentUrl };
        }
        // ── Mock (mode test uniquement) ──────────────────────────────────────────
        if (provider === 'mock') {
            const testMode = await this.settings.get('test_mode_enabled', 'false');
            if (testMode !== 'true') {
                throw new common_1.BadRequestException('Le provider mock est uniquement disponible en mode test');
            }
            await this.creditWalletFromTransaction(reference);
            this.logger.log(`Mock payment: ${points} pts crédités directement pour ${userId}`);
            return { success: true, mock: true, points, reference };
        }
        // ── CinetPay (défaut) ────────────────────────────────────────────────────
        return this.payments.initiate({
            transactionId: reference,
            amount: amountFcfa,
            description,
            customerName: (userInfo === null || userInfo === void 0 ? void 0 : userInfo.name) || 'Client',
            customerPhone: (userInfo === null || userInfo === void 0 ? void 0 : userInfo.phone) || '',
        });
    }
    // ── Webhooks ─────────────────────────────────────────────────────────────────
    /** POST /payments/webhook — CinetPay */
    async handleWebhook(body) {
        const transactionId = body.cpm_trans_id;
        if (!transactionId) {
            this.logger.warn('Webhook reçu sans cpm_trans_id');
            return { received: true };
        }
        const configuredSiteId = process.env.CINETPAY_SITE_ID;
        if (configuredSiteId && body.cpm_site_id && body.cpm_site_id !== configuredSiteId) {
            this.logger.warn(`Webhook rejeté: cpm_site_id=${body.cpm_site_id}`);
            return { received: true };
        }
        const txExists = transactionId.startsWith('WALLET-')
            ? await this.prisma.transaction.findUnique({ where: { reference: transactionId }, select: { id: true } })
            : null;
        if (!txExists) {
            this.logger.warn(`Webhook ignoré: transaction inconnue ${transactionId}`);
            return { received: true };
        }
        this.logger.log(`Webhook CinetPay: ${transactionId} | raw_status=${body.cpm_trans_status}`);
        const verifiedStatus = await this.payments.verify(transactionId).catch((e) => {
            this.logger.error('Erreur vérification CinetPay', e.message);
            return 'PENDING';
        });
        if (verifiedStatus === 'ACCEPTED')
            await this.creditWalletFromTransaction(transactionId);
        return { received: true };
    }
    /** POST /payments/webhook/flutterwave — Flutterwave */
    async handleFlutterwaveWebhook(body, signature) {
        var _a, _b, _c, _d, _e, _f, _g;
        const secretHash = await this.flutterwave.getWebhookHash();
        if (secretHash && signature !== secretHash) {
            this.logger.warn('Flutterwave webhook: signature invalide');
            return { received: true };
        }
        const txRef = String((_c = (_b = (_a = body === null || body === void 0 ? void 0 : body.data) === null || _a === void 0 ? void 0 : _a.tx_ref) !== null && _b !== void 0 ? _b : body === null || body === void 0 ? void 0 : body.txRef) !== null && _c !== void 0 ? _c : '');
        const status = String((_e = (_d = body === null || body === void 0 ? void 0 : body.data) === null || _d === void 0 ? void 0 : _d.status) !== null && _e !== void 0 ? _e : '');
        const flwTxId = String((_g = (_f = body === null || body === void 0 ? void 0 : body.data) === null || _f === void 0 ? void 0 : _f.id) !== null && _g !== void 0 ? _g : '');
        this.logger.log(`Flutterwave webhook: ${txRef} status=${status}`);
        if (!txRef.startsWith('WALLET-FLUTTERWAVE-'))
            return { received: true };
        if (status === 'successful' && flwTxId) {
            const verified = await this.flutterwave.verify(flwTxId).catch(() => 'PENDING');
            if (verified === 'ACCEPTED')
                await this.creditWalletFromTransaction(txRef);
        }
        return { received: true };
    }
    /** POST /payments/webhook/stripe — Stripe (raw body requis pour la vérification de signature) */
    async handleStripeWebhook(req, body, signature) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
        const rawBody = (_a = req.rawBody) !== null && _a !== void 0 ? _a : Buffer.from(JSON.stringify(body));
        const webhookSecret = await this.stripe.getWebhookSecret();
        if (!this.stripe.verifyWebhookSignature(rawBody, signature, webhookSecret)) {
            this.logger.warn('Stripe webhook: signature invalide');
            return { received: true };
        }
        const eventType = String((_b = body === null || body === void 0 ? void 0 : body.type) !== null && _b !== void 0 ? _b : '');
        const txRef = String((_f = (_e = (_d = (_c = body === null || body === void 0 ? void 0 : body.data) === null || _c === void 0 ? void 0 : _c.object) === null || _d === void 0 ? void 0 : _d.metadata) === null || _e === void 0 ? void 0 : _e.transaction_id) !== null && _f !== void 0 ? _f : '');
        const piId = String((_j = (_h = (_g = body === null || body === void 0 ? void 0 : body.data) === null || _g === void 0 ? void 0 : _g.object) === null || _h === void 0 ? void 0 : _h.id) !== null && _j !== void 0 ? _j : '');
        this.logger.log(`Stripe webhook: ${eventType}`);
        // Rechargement wallet (Checkout Session)
        if (eventType === 'checkout.session.completed' && txRef.startsWith('WALLET-STRIPE-')) {
            if (((_l = (_k = body === null || body === void 0 ? void 0 : body.data) === null || _k === void 0 ? void 0 : _k.object) === null || _l === void 0 ? void 0 : _l.payment_status) === 'paid') {
                await this.creditWalletFromTransaction(txRef);
            }
        }
        // Pré-autorisation course (PaymentIntent, capture manuelle)
        if (eventType === 'payment_intent.amount_capturable_updated' && piId) {
            await this.paymentIntent.markAuthorizedByStripe(piId).catch((err) => {
                this.logger.warn(`Stripe markAuthorized error: ${err.message}`);
            });
        }
        // Pourboire PaymentIntent capturé par le passager
        if (eventType === 'payment_intent.succeeded' && piId) {
            await this.tip.captureByProviderRef(piId).catch(() => { });
        }
        return { received: true };
    }
    /** POST /payments/webhook/notchpay — NotchPay (POST server webhook) */
    async handleNotchPayWebhook(req, body, query, signature) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
        // NotchPay peut envoyer les données en JSON body (webhook server) ou en query params (redirect fallback)
        const merged = Object.assign(Object.assign({}, query), body);
        const rawBody = (_a = req.rawBody) !== null && _a !== void 0 ? _a : Buffer.from(JSON.stringify(body));
        const notchSecret = await this.notchpay.getWebhookSecret();
        if (!this.notchpay.verifyWebhookSignature(rawBody, signature, notchSecret)) {
            this.logger.warn('NotchPay webhook: signature invalide');
            return { received: true };
        }
        // NotchPay payload :
        //   trxref / transaction.merchant_reference → notre référence (WALLET-NOTCHPAY-...)
        //   reference / transaction.reference        → référence interne NotchPay (trx.xxx)
        const merchantRef = String((_f = (_d = (_b = merged === null || merged === void 0 ? void 0 : merged.trxref) !== null && _b !== void 0 ? _b : (_c = merged === null || merged === void 0 ? void 0 : merged.transaction) === null || _c === void 0 ? void 0 : _c.merchant_reference) !== null && _d !== void 0 ? _d : (_e = merged === null || merged === void 0 ? void 0 : merged.transaction) === null || _e === void 0 ? void 0 : _e.trxref) !== null && _f !== void 0 ? _f : '');
        const notchpayRef = String((_j = (_g = merged === null || merged === void 0 ? void 0 : merged.reference) !== null && _g !== void 0 ? _g : (_h = merged === null || merged === void 0 ? void 0 : merged.transaction) === null || _h === void 0 ? void 0 : _h.reference) !== null && _j !== void 0 ? _j : '');
        const status = String((_m = (_l = (_k = merged === null || merged === void 0 ? void 0 : merged.transaction) === null || _k === void 0 ? void 0 : _k.status) !== null && _l !== void 0 ? _l : merged === null || merged === void 0 ? void 0 : merged.status) !== null && _m !== void 0 ? _m : '').toLowerCase();
        this.logger.log(`NotchPay webhook: merchant=${merchantRef} notchRef=${notchpayRef} status=${status}`);
        const refToVerify = notchpayRef || merchantRef;
        if (merchantRef.startsWith('WALLET-NOTCHPAY-')) {
            if (status === 'complete' || status === 'completed') {
                const verified = await this.notchpay.verify(refToVerify).catch(() => 'PENDING');
                if (verified === 'ACCEPTED')
                    await this.creditWalletFromTransaction(merchantRef);
            }
            return { received: true };
        }
        // Pass d'accès (PASS-NOTCHPAY-*)
        if (merchantRef.startsWith('PASS-NOTCHPAY-')) {
            if (status === 'complete' || status === 'completed') {
                const verified = await this.notchpay.verify(refToVerify).catch(() => 'PENDING');
                if (verified === 'ACCEPTED')
                    await this.activatePassFromTransaction(merchantRef);
            }
            return { received: true };
        }
        // Paiement de course (BOOKING-ORANGE_MONEY_CM-* ou BOOKING-MTN_CM-*)
        if (merchantRef.startsWith('BOOKING-')) {
            if (status === 'complete' || status === 'completed') {
                const verified = await this.notchpay.verify(refToVerify).catch(() => 'PENDING');
                if (verified === 'ACCEPTED') {
                    const bookingId = await this.resolveBookingFromRef(merchantRef);
                    if (bookingId)
                        await this.paymentIntent.markAuthorizedByNotchPay(bookingId, notchpayRef);
                }
            }
            return { received: true };
        }
        // Pourboire (TIP-*)
        if (merchantRef.startsWith('TIP-')) {
            if (status === 'complete' || status === 'completed') {
                const verified = await this.notchpay.verify(refToVerify).catch(() => 'PENDING');
                if (verified === 'ACCEPTED')
                    await this.tip.captureByProviderRef(merchantRef);
            }
        }
        // Frais d'inscription chauffeur (REGFEE-*)
        if (merchantRef.startsWith('REGFEE-')) {
            if (status === 'complete' || status === 'completed') {
                const verified = await this.notchpay.verify(refToVerify).catch(() => 'PENDING');
                if (verified === 'ACCEPTED')
                    await this.confirmRegistrationFee(merchantRef);
            }
        }
        return { received: true };
    }
    /** GET /payments/webhook/notchpay — redirect navigateur après paiement NotchPay */
    async handleNotchPayRedirect(query) {
        var _a, _b, _c, _d;
        const merchantRef = String((_b = (_a = query === null || query === void 0 ? void 0 : query.trxref) !== null && _a !== void 0 ? _a : query === null || query === void 0 ? void 0 : query.notchpay_trxref) !== null && _b !== void 0 ? _b : '');
        const notchpayRef = String((_c = query === null || query === void 0 ? void 0 : query.reference) !== null && _c !== void 0 ? _c : '');
        const status = String((_d = query === null || query === void 0 ? void 0 : query.status) !== null && _d !== void 0 ? _d : '').toLowerCase();
        this.logger.log(`NotchPay redirect GET: merchant=${merchantRef} status=${status}`);
        const refToVerify = notchpayRef || merchantRef;
        if (merchantRef.startsWith('WALLET-NOTCHPAY-') && (status === 'complete' || status === 'completed')) {
            const verified = await this.notchpay.verify(refToVerify).catch(() => 'PENDING');
            if (verified === 'ACCEPTED')
                await this.creditWalletFromTransaction(merchantRef);
        }
        if (merchantRef.startsWith('PASS-NOTCHPAY-') && (status === 'complete' || status === 'completed')) {
            const verified = await this.notchpay.verify(refToVerify).catch(() => 'PENDING');
            if (verified === 'ACCEPTED')
                await this.activatePassFromTransaction(merchantRef);
        }
        if (merchantRef.startsWith('BOOKING-') && (status === 'complete' || status === 'completed')) {
            const verified = await this.notchpay.verify(refToVerify).catch(() => 'PENDING');
            if (verified === 'ACCEPTED') {
                const bookingId = await this.resolveBookingFromRef(merchantRef);
                if (bookingId)
                    await this.paymentIntent.markAuthorizedByNotchPay(bookingId, notchpayRef);
            }
        }
        if (merchantRef.startsWith('REGFEE-') && (status === 'complete' || status === 'completed')) {
            const verified = await this.notchpay.verify(refToVerify).catch(() => 'PENDING');
            if (verified === 'ACCEPTED')
                await this.confirmRegistrationFee(merchantRef);
        }
        return { received: true, status };
    }
    /** POST /payments/webhook/mpesa — M-Pesa STK Push callback */
    async handleMpesaWebhook(body) {
        var _a, _b, _c;
        const callback = (_a = body === null || body === void 0 ? void 0 : body.Body) === null || _a === void 0 ? void 0 : _a.stkCallback;
        if (!callback) {
            this.logger.warn('M-Pesa webhook: format inattendu');
            return { ResultCode: 0, ResultDesc: 'Accepted' };
        }
        const checkoutRequestId = String((_b = callback.CheckoutRequestID) !== null && _b !== void 0 ? _b : '');
        const resultCode = Number((_c = callback.ResultCode) !== null && _c !== void 0 ? _c : -1);
        this.logger.log(`M-Pesa callback: ${checkoutRequestId} resultCode=${resultCode}`);
        // Retrouver la transaction via le checkoutRequestId stocké dans les métadonnées
        const tx = await this.prisma.transaction.findFirst({
            where: { metadata: { path: ['checkoutRequestId'], equals: checkoutRequestId } },
        });
        if (!tx) {
            this.logger.warn(`M-Pesa callback ignoré: checkoutRequestId inconnu ${checkoutRequestId}`);
            return { ResultCode: 0, ResultDesc: 'Accepted' };
        }
        if (resultCode === 0) {
            await this.creditWalletFromTransaction(tx.reference);
        }
        else {
            // Paiement refusé ou annulé — marquer la transaction comme échouée
            await this.prisma.transaction.updateMany({
                where: { id: tx.id, status: 'pending' },
                data: { status: 'failed' },
            });
            this.logger.warn(`M-Pesa paiement refusé: ${callback.ResultDesc}`);
        }
        return { ResultCode: 0, ResultDesc: 'Accepted' };
    }
    /** POST /payments/webhook/paypal — PayPal IPN/webhook */
    async handlePaypalWebhook(req, body, headers) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j;
        const rawBody = req.rawBody ? req.rawBody.toString() : JSON.stringify(body);
        const isValid = await this.paypal.verifyWebhookSignature(headers, rawBody).catch(() => false);
        if (!isValid) {
            this.logger.warn('PayPal webhook: signature invalide');
            return { received: true };
        }
        const eventType = String((_a = body === null || body === void 0 ? void 0 : body.event_type) !== null && _a !== void 0 ? _a : '');
        this.logger.log(`PayPal webhook: ${eventType}`);
        // CHECKOUT.ORDER.APPROVED → capturer les fonds, puis créditer
        if (eventType === 'CHECKOUT.ORDER.APPROVED') {
            const orderId = String((_c = (_b = body === null || body === void 0 ? void 0 : body.resource) === null || _b === void 0 ? void 0 : _b.id) !== null && _c !== void 0 ? _c : '');
            const reference = String((_g = (_f = (_e = (_d = body === null || body === void 0 ? void 0 : body.resource) === null || _d === void 0 ? void 0 : _d.purchase_units) === null || _e === void 0 ? void 0 : _e[0]) === null || _f === void 0 ? void 0 : _f.reference_id) !== null && _g !== void 0 ? _g : '');
            if (reference.startsWith('WALLET-PAYPAL-') && orderId) {
                const captured = await this.paypal.captureOrder(orderId).catch(() => 'PENDING');
                if (captured === 'ACCEPTED')
                    await this.creditWalletFromTransaction(reference);
            }
        }
        // PAYMENT.CAPTURE.COMPLETED → crédit idempotent (fallback si le webhook APPROVED a déjà crédité)
        if (eventType === 'PAYMENT.CAPTURE.COMPLETED') {
            const reference = String((_j = (_h = body === null || body === void 0 ? void 0 : body.resource) === null || _h === void 0 ? void 0 : _h.custom_id) !== null && _j !== void 0 ? _j : '');
            if (reference.startsWith('WALLET-PAYPAL-')) {
                await this.creditWalletFromTransaction(reference);
            }
        }
        return { received: true };
    }
    /** POST /payments/webhook/wave — Wave */
    async handleWaveWebhook(req, body, signature) {
        var _a, _b, _c, _d, _e, _f, _g;
        const rawBody = (_a = req.rawBody) !== null && _a !== void 0 ? _a : Buffer.from(JSON.stringify(body));
        const waveSecret = await this.wave.getWebhookSecret();
        if (!this.wave.verifyWebhookSignature(rawBody, signature, waveSecret)) {
            this.logger.warn('Wave webhook: signature invalide');
            return { received: true };
        }
        const reference = String((_d = (_b = body === null || body === void 0 ? void 0 : body.client_reference) !== null && _b !== void 0 ? _b : (_c = body === null || body === void 0 ? void 0 : body.checkout_session) === null || _c === void 0 ? void 0 : _c.client_reference) !== null && _d !== void 0 ? _d : '');
        const status = String((_g = (_f = (_e = body === null || body === void 0 ? void 0 : body.checkout_session) === null || _e === void 0 ? void 0 : _e.payment_status) !== null && _f !== void 0 ? _f : body === null || body === void 0 ? void 0 : body.payment_status) !== null && _g !== void 0 ? _g : '');
        this.logger.log(`Wave webhook: ${reference} status=${status}`);
        if (!reference.startsWith('WALLET-WAVE-'))
            return { received: true };
        if (status === 'succeeded')
            await this.creditWalletFromTransaction(reference);
        return { received: true };
    }
    /** POST /payments/purchase-pass — initie le paiement du pass d'accès via NotchPay */
    async purchasePass(req) {
        const userId = req.user.id;
        const [priceRaw, durationRaw] = await Promise.all([
            this.settings.get('access_pass_price_fcfa', '5000'),
            this.settings.get('access_pass_duration_days', '30'),
        ]);
        const price = parseInt(priceRaw, 10) || 5000;
        const durationDays = parseInt(durationRaw, 10) || 30;
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { name: true, phone: true, email: true },
        });
        if (!user) throw new common_1.BadRequestException('Utilisateur introuvable');
        const wallet = await this.prisma.wallet.findFirst({ where: { userId } });
        if (!wallet) throw new common_1.BadRequestException('Wallet introuvable');
        // Mode dev : si FORCE_TEST_OTP=true, activer le pass directement sans passer par NotchPay
        if (process.env.FORCE_TEST_OTP === 'true') {
            const now = new Date();
            const passExpiresAt = new Date(now.getTime() + durationDays * 86400000);
            await this.prisma.user.update({
                where: { id: userId },
                data: { passExpiresAt, passType: 'paid' },
            });
            this.logger.log(`[DEV] Pass activé directement: userId=${userId} expire=${passExpiresAt.toISOString()}`);
            return { authorization_url: null, mock: true, activated: true, expiresAt: passExpiresAt };
        }
        const reference = `PASS-NOTCHPAY-${Date.now()}-${userId.slice(0, 8)}`;
        await this.prisma.transaction.create({
            data: {
                reference,
                walletId: wallet.id,
                amount: price,
                type: 'payment',
                status: 'pending',
                metadata: { type: 'pass', userId, durationDays, provider: 'notchpay' },
            },
        });
        const authUrl = await this.notchpay.initiate({
            amount: price,
            currency: 'XAF',
            email: user.email || `${userId.slice(0, 8)}@aerocab.app`,
            phone: user.phone || '',
            name: user.name || 'Passager',
            description: `Pass d'accès AeroCab ${durationDays} jours`,
            transactionId: reference,
        });
        return { authorization_url: authUrl };
    }
    /** Active le pass depuis une transaction PASS-NOTCHPAY-* — idempotent */
    async activatePassFromTransaction(reference) {
        var _a, _b;
        const tx = await this.prisma.transaction.findUnique({ where: { reference } });
        if (!tx) return;
        const meta = tx.metadata;
        const userId = (_a = meta === null || meta === void 0 ? void 0 : meta.userId) !== null && _a !== void 0 ? _a : null;
        const durationDays = (_b = meta === null || meta === void 0 ? void 0 : meta.durationDays) !== null && _b !== void 0 ? _b : 30;
        if (!userId) return;
        const { count } = await this.prisma.transaction.updateMany({
            where: { id: tx.id, status: 'pending' },
            data: { status: 'completed' },
        });
        if (count === 0) {
            this.logger.warn(`Pass webhook duplicate: ${reference}`);
            return;
        }
        const now = new Date();
        const passExpiresAt = new Date(now.getTime() + durationDays * 86400000);
        await this.prisma.user.update({
            where: { id: userId },
            data: { passExpiresAt, passType: 'paid' },
        });
        this.logger.log(`Pass activé: userId=${userId} expire=${passExpiresAt.toISOString()}`);
    }
    /**
     * Crédite le wallet depuis une transaction pending.
     * Atomique via updateMany(status=pending) — idempotent contre les webhooks dupliqués.
     */
    async creditWalletFromTransaction(reference) {
        var _a, _b, _c, _d;
        const tx = await this.prisma.transaction.findUnique({ where: { reference } });
        if (!tx)
            return;
        const meta = tx.metadata;
        const tariffs = await this.settings.getTariffs();
        const pointsToCredit = (_a = meta === null || meta === void 0 ? void 0 : meta.points) !== null && _a !== void 0 ? _a : Math.floor(tx.amount / ((_c = (_b = tariffs.pointRechargeRate) !== null && _b !== void 0 ? _b : tariffs.fcfaPerPoint) !== null && _c !== void 0 ? _c : 1));
        const { count } = await this.prisma.transaction.updateMany({
            where: { id: tx.id, status: 'pending' },
            data: { status: 'completed' },
        });
        if (count === 0) {
            this.logger.warn(`Webhook duplicate ou déjà traité : ${reference}`);
            return;
        }
        await this.prisma.wallet.update({
            where: { id: tx.walletId },
            data: { balance: { increment: pointsToCredit } },
        });
        this.logger.log(`Wallet ${tx.walletId} crédité de ${pointsToCredit} pts via ${reference}`);
        // Créer aussi une PointsTransaction pour les sous-soldes (source: recharge)
        const walletOwner = await this.prisma.wallet.findUnique({
            where: { id: tx.walletId },
            select: { userId: true },
        });
        if (walletOwner) {
            const provider = (_d = meta === null || meta === void 0 ? void 0 : meta.provider) !== null && _d !== void 0 ? _d : 'wallet';
            await this.prisma.pointsTransaction.create({
                data: {
                    userId: walletOwner.userId,
                    type: 'credit',
                    source: 'recharge',
                    points: pointsToCredit,
                    label: `Recharge ${provider.toUpperCase()} — ${pointsToCredit} pts`,
                },
            });
        }
    }
    /** POST /payments/refund — Admin only */
    async refund(transactionId, amount) {
        return this.payments.refund(transactionId, amount);
    }
    // ── F4 — Paiement de course ───────────────────────────────────────────────
    /**
     * POST /payments/booking/:bookingId/initiate
     * Initie le paiement d'une course (Mobile Money, Carte, Cash).
     * Retourne paymentUrl (Mobile Money) ou clientSecret (Stripe).
     */
    async initiateBookingPayment(bookingId, req, body) {
        var _a, _b, _c, _d, _e, _f;
        const user = await this.prisma.user.findUnique({
            where: { id: req.user.id },
            select: { name: true, phone: true, email: true },
        });
        const booking = await this.prisma.booking.findUnique({
            where: { id: bookingId },
            select: { estimatedPrice: true, currency: true, operatingCountry: true, passengerId: true },
        });
        if (!booking)
            throw new common_1.BadRequestException('Booking introuvable');
        if (booking.passengerId !== req.user.id)
            throw new common_1.BadRequestException('Non autorisé');
        return this.paymentIntent.create({
            bookingId,
            provider: body.provider,
            amount: booking.estimatedPrice,
            currency: (_b = (_a = body.currency) !== null && _a !== void 0 ? _a : booking.currency) !== null && _b !== void 0 ? _b : 'XAF',
            operatingCountry: (_c = booking.operatingCountry) !== null && _c !== void 0 ? _c : 'CM',
            passengerName: (_d = user === null || user === void 0 ? void 0 : user.name) !== null && _d !== void 0 ? _d : '',
            passengerPhone: (_e = user === null || user === void 0 ? void 0 : user.phone) !== null && _e !== void 0 ? _e : '',
            passengerEmail: (_f = user === null || user === void 0 ? void 0 : user.email) !== null && _f !== void 0 ? _f : '',
        });
    }
    /**
     * GET /payments/booking/:bookingId/status
     * Retourne le statut du PaymentIntent d'une course.
     */
    async getBookingPaymentStatus(bookingId, req) {
        const intent = await this.paymentIntent.findByBooking(bookingId);
        if (!intent)
            return { status: 'not_found' };
        return {
            intentId: intent.id,
            status: intent.status,
            provider: intent.provider,
            amount: intent.amount,
            currency: intent.currency,
            authorizedAt: intent.authorizedAt,
            capturedAt: intent.capturedAt,
        };
    }
    /**
     * POST /payments/booking/:bookingId/tip
     * Initie un pourboire pour le chauffeur après la course.
     */
    async initiateTip(bookingId, req, body) {
        var _a, _b, _c, _d;
        const user = await this.prisma.user.findUnique({
            where: { id: req.user.id },
            select: { name: true, phone: true, email: true },
        });
        return this.tip.initiate({
            bookingId,
            payerId: req.user.id,
            amount: body.amount,
            currency: (_a = body.currency) !== null && _a !== void 0 ? _a : 'XAF',
            provider: body.provider,
            passengerName: (_b = user === null || user === void 0 ? void 0 : user.name) !== null && _b !== void 0 ? _b : '',
            passengerPhone: (_c = user === null || user === void 0 ? void 0 : user.phone) !== null && _c !== void 0 ? _c : '',
            passengerEmail: (_d = user === null || user === void 0 ? void 0 : user.email) !== null && _d !== void 0 ? _d : '',
        });
    }
    /**
     * POST /payments/booking/:bookingId/split
     * Initie un paiement fractionné — envoie des liens SMS aux co-payeurs.
     */
    async initiateSplitPayment(bookingId, req, body) {
        return this.split.initiateSplit({
            bookingId,
            participants: body.participants,
            initiatorId: req.user.id,
        });
    }
    /**
     * GET /payments/split/:token
     * Retourne les infos d'un lien de paiement fractionné (public, sans auth).
     */
    async getSplitLink(token) {
        var _a;
        const link = await this.prisma.paymentLink.findUnique({
            where: { token },
            include: { booking: { select: { destination: true, estimatedPrice: true, currency: true } } },
        });
        if (!link)
            throw new common_1.BadRequestException('Lien introuvable');
        if (link.status === 'expired' || link.expiresAt < new Date())
            return { expired: true };
        return {
            token,
            amount: link.amount,
            currency: link.currency,
            destination: (_a = link.booking) === null || _a === void 0 ? void 0 : _a.destination,
            status: link.status,
            expiresAt: link.expiresAt,
        };
    }
    /**
     * POST /payments/split/:token/pay
     * Paiement d'une part fractionnée via lien (sans nécessiter de compte).
     */
    async payByToken(token, body) {
        var _a;
        return this.split.payByToken({
            inviteToken: token,
            provider: body.provider,
            payerName: body.payerName,
            payerPhone: body.payerPhone,
            payerEmail: (_a = body.payerEmail) !== null && _a !== void 0 ? _a : '',
        });
    }
    // ── Gains chauffeur ───────────────────────────────────────────────────────
    /**
     * GET /payments/earnings
     * Retourne le solde du DriverEarningsWallet du chauffeur connecté.
     */
    async getDriverEarnings(req) {
        const profile = await this.prisma.driverProfile.findFirst({
            where: { userId: req.user.id },
            select: { id: true },
        });
        if (!profile)
            throw new common_1.BadRequestException('Profil chauffeur introuvable');
        return this.payout.getBalance(profile.id);
    }
    /**
     * POST /payments/withdraw
     * Demande de virement vers le compte Mobile Money du chauffeur.
     */
    async requestWithdrawal(req, body) {
        const profile = await this.prisma.driverProfile.findFirst({
            where: { userId: req.user.id },
            select: { id: true },
        });
        if (!profile)
            throw new common_1.BadRequestException('Profil chauffeur introuvable');
        return this.payout.disburse({ driverProfileId: profile.id, amount: body.amount });
    }
    // ── Helper : retrouve un bookingId depuis une référence de paiement ────────
    async resolveBookingFromRef(ref) {
        var _a;
        const intent = await this.prisma.paymentIntent.findFirst({ where: { providerRef: ref } });
        return (_a = intent === null || intent === void 0 ? void 0 : intent.bookingId) !== null && _a !== void 0 ? _a : null;
    }
    async confirmRegistrationFee(providerRef) {
        const regPayment = await this.prisma.driverRegistrationPayment.findFirst({ where: { providerRef } });
        if (!regPayment || regPayment.status === 'paid')
            return;
        await this.prisma.$transaction([
            this.prisma.driverRegistrationPayment.update({
                where: { id: regPayment.id },
                data: { status: 'paid', paidAt: new Date() },
            }),
            this.prisma.driverProfile.update({
                where: { id: regPayment.driverProfileId },
                data: {
                    registrationFeePaid: true,
                    registrationFeeAmount: regPayment.totalAmount,
                    registrationFeePaidAt: new Date(),
                    cashDepositBalance: { increment: regPayment.depositAmount },
                },
            }),
        ]);
        this.logger.log(`Frais inscription confirmés via webhook: driverId=${regPayment.driverProfileId}`);
    }
};
exports.PaymentsController = PaymentsController;
__decorate([
    (0, common_1.Get)('wallet'),
    (0, common_1.UseGuards)(guards_1.JwtAuthGuard),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Query)('currency')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], PaymentsController.prototype, "getWallet", null);
__decorate([
    (0, common_1.Get)('methods'),
    (0, common_1.UseGuards)(guards_1.JwtAuthGuard),
    __param(0, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], PaymentsController.prototype, "getPaymentMethods", null);
__decorate([
    (0, common_1.Get)('default-payment-method'),
    (0, common_1.UseGuards)(guards_1.JwtAuthGuard),
    __param(0, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], PaymentsController.prototype, "getDefaultPaymentMethod", null);
__decorate([
    (0, common_1.Patch)('default-payment-method'),
    (0, common_1.UseGuards)(guards_1.JwtAuthGuard),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], PaymentsController.prototype, "setDefaultPaymentMethod", null);
__decorate([
    (0, common_1.Get)('spending'),
    (0, common_1.UseGuards)(guards_1.JwtAuthGuard),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Query)('month')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], PaymentsController.prototype, "getMonthlySpending", null);
__decorate([
    (0, common_1.Post)('recharge'),
    (0, throttler_1.Throttle)({ default: { limit: 5, ttl: 60000 } }),
    (0, common_1.UseGuards)(guards_1.JwtAuthGuard),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], PaymentsController.prototype, "recharge", null);
__decorate([
    (0, common_1.Post)('purchase-pass'),
    (0, throttler_1.Throttle)({ default: { limit: 3, ttl: 60000 } }),
    (0, common_1.UseGuards)(guards_1.JwtAuthGuard),
    __param(0, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], PaymentsController.prototype, "purchasePass", null);
__decorate([
    (0, common_1.Post)('webhook'),
    (0, throttler_1.SkipThrottle)(),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], PaymentsController.prototype, "handleWebhook", null);
__decorate([
    (0, common_1.Post)('webhook/flutterwave'),
    (0, throttler_1.SkipThrottle)(),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Headers)('verif-hash')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], PaymentsController.prototype, "handleFlutterwaveWebhook", null);
__decorate([
    (0, common_1.Post)('webhook/stripe'),
    (0, throttler_1.SkipThrottle)(),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Headers)('stripe-signature')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, String]),
    __metadata("design:returntype", Promise)
], PaymentsController.prototype, "handleStripeWebhook", null);
__decorate([
    (0, common_1.Post)('webhook/notchpay'),
    (0, throttler_1.SkipThrottle)(),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Query)()),
    __param(3, (0, common_1.Headers)('x-notch-signature')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object, String]),
    __metadata("design:returntype", Promise)
], PaymentsController.prototype, "handleNotchPayWebhook", null);
__decorate([
    (0, common_1.Get)('webhook/notchpay'),
    (0, throttler_1.SkipThrottle)(),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], PaymentsController.prototype, "handleNotchPayRedirect", null);
__decorate([
    (0, common_1.Post)('webhook/mpesa'),
    (0, throttler_1.SkipThrottle)(),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], PaymentsController.prototype, "handleMpesaWebhook", null);
__decorate([
    (0, common_1.Post)('webhook/paypal'),
    (0, throttler_1.SkipThrottle)(),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Headers)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], PaymentsController.prototype, "handlePaypalWebhook", null);
__decorate([
    (0, common_1.Post)('webhook/wave'),
    (0, throttler_1.SkipThrottle)(),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Headers)('wave-signature')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, String]),
    __metadata("design:returntype", Promise)
], PaymentsController.prototype, "handleWaveWebhook", null);
__decorate([
    (0, common_1.Post)('refund'),
    (0, common_1.UseGuards)(guards_1.JwtAuthGuard, guards_1.RolesGuard),
    (0, decorators_1.Roles)('admin'),
    __param(0, (0, common_1.Body)('transactionId')),
    __param(1, (0, common_1.Body)('amount')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Number]),
    __metadata("design:returntype", Promise)
], PaymentsController.prototype, "refund", null);
__decorate([
    (0, common_1.Post)('booking/:bookingId/initiate'),
    (0, throttler_1.Throttle)({ default: { limit: 5, ttl: 60000 } }),
    (0, common_1.UseGuards)(guards_1.JwtAuthGuard),
    __param(0, (0, common_1.Param)('bookingId')),
    __param(1, (0, common_1.Request)()),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", Promise)
], PaymentsController.prototype, "initiateBookingPayment", null);
__decorate([
    (0, common_1.Get)('booking/:bookingId/status'),
    (0, common_1.UseGuards)(guards_1.JwtAuthGuard),
    __param(0, (0, common_1.Param)('bookingId')),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], PaymentsController.prototype, "getBookingPaymentStatus", null);
__decorate([
    (0, common_1.Post)('booking/:bookingId/tip'),
    (0, throttler_1.Throttle)({ default: { limit: 3, ttl: 60000 } }),
    (0, common_1.UseGuards)(guards_1.JwtAuthGuard),
    __param(0, (0, common_1.Param)('bookingId')),
    __param(1, (0, common_1.Request)()),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", Promise)
], PaymentsController.prototype, "initiateTip", null);
__decorate([
    (0, common_1.Post)('booking/:bookingId/split'),
    (0, common_1.UseGuards)(guards_1.JwtAuthGuard),
    __param(0, (0, common_1.Param)('bookingId')),
    __param(1, (0, common_1.Request)()),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", Promise)
], PaymentsController.prototype, "initiateSplitPayment", null);
__decorate([
    (0, common_1.Get)('split/:token'),
    (0, throttler_1.SkipThrottle)(),
    __param(0, (0, common_1.Param)('token')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], PaymentsController.prototype, "getSplitLink", null);
__decorate([
    (0, common_1.Post)('split/:token/pay'),
    (0, throttler_1.SkipThrottle)(),
    __param(0, (0, common_1.Param)('token')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], PaymentsController.prototype, "payByToken", null);
__decorate([
    (0, common_1.Get)('earnings'),
    (0, common_1.UseGuards)(guards_1.JwtAuthGuard),
    __param(0, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], PaymentsController.prototype, "getDriverEarnings", null);
__decorate([
    (0, common_1.Post)('withdraw'),
    (0, throttler_1.Throttle)({ default: { limit: 3, ttl: 60000 } }),
    (0, common_1.UseGuards)(guards_1.JwtAuthGuard),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], PaymentsController.prototype, "requestWithdrawal", null);
exports.PaymentsController = PaymentsController = PaymentsController_1 = __decorate([
    (0, common_1.Controller)('payments'),
    __metadata("design:paramtypes", [payments_service_1.PaymentsService,
        flutterwave_service_1.FlutterwaveService,
        stripe_service_1.StripeService,
        notchpay_service_1.NotchPayService,
        mpesa_service_1.MpesaService,
        paypal_service_1.PaypalService,
        wave_service_1.WaveService,
        payment_intent_service_1.PaymentIntentService,
        payout_service_1.PayoutService,
        tip_service_1.TipService,
        split_service_1.SplitService,
        prisma_service_1.PrismaService,
        settings_service_1.SettingsService])
], PaymentsController);
//# sourceMappingURL=payments.controller.js.map