"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PaymentsModule = void 0;
const common_1 = require("@nestjs/common");
const payments_service_1 = require("./payments.service");
const wallet_service_1 = require("./wallet.service");
const flutterwave_service_1 = require("./flutterwave.service");
const stripe_service_1 = require("./stripe.service");
const notchpay_service_1 = require("./notchpay.service");
const mpesa_service_1 = require("./mpesa.service");
const paypal_service_1 = require("./paypal.service");
const wave_service_1 = require("./wave.service");
const exchange_rate_service_1 = require("./exchange-rate.service");
const payment_intent_service_1 = require("./payment-intent.service");
const payout_service_1 = require("./payout.service");
const cash_commission_service_1 = require("./cash-commission.service");
const receipt_service_1 = require("./receipt.service");
const tip_service_1 = require("./tip.service");
const split_service_1 = require("./split.service");
const payments_controller_1 = require("./payments.controller");
const prisma_module_1 = require("../database/prisma.module");
const settings_module_1 = require("../settings/settings.module");
const sms_module_1 = require("../sms/sms.module");
const email_module_1 = require("../email/email.module");
const redis_module_1 = require("../redis/redis.module");
const users_module_1 = require("../users/users.module");
let PaymentsModule = class PaymentsModule {
};
exports.PaymentsModule = PaymentsModule;
exports.PaymentsModule = PaymentsModule = __decorate([
    (0, common_1.Module)({
        imports: [prisma_module_1.PrismaModule, settings_module_1.SettingsModule, sms_module_1.SmsModule, email_module_1.EmailModule, redis_module_1.RedisModule, users_module_1.UsersModule],
        controllers: [payments_controller_1.PaymentsController],
        providers: [
            // Providers existants
            payments_service_1.PaymentsService, wallet_service_1.WalletService,
            flutterwave_service_1.FlutterwaveService, stripe_service_1.StripeService,
            notchpay_service_1.NotchPayService, mpesa_service_1.MpesaService, paypal_service_1.PaypalService, wave_service_1.WaveService,
            // Nouveaux services F4
            exchange_rate_service_1.ExchangeRateService,
            payment_intent_service_1.PaymentIntentService,
            payout_service_1.PayoutService,
            cash_commission_service_1.CashCommissionService,
            receipt_service_1.ReceiptService,
            tip_service_1.TipService,
            split_service_1.SplitService,
        ],
        exports: [
            payments_service_1.PaymentsService, wallet_service_1.WalletService,
            flutterwave_service_1.FlutterwaveService, stripe_service_1.StripeService,
            notchpay_service_1.NotchPayService, mpesa_service_1.MpesaService, paypal_service_1.PaypalService, wave_service_1.WaveService,
            exchange_rate_service_1.ExchangeRateService,
            payment_intent_service_1.PaymentIntentService,
            payout_service_1.PayoutService,
            cash_commission_service_1.CashCommissionService,
            receipt_service_1.ReceiptService,
            tip_service_1.TipService,
            split_service_1.SplitService,
        ],
    })
], PaymentsModule);
//# sourceMappingURL=payments.module.js.map