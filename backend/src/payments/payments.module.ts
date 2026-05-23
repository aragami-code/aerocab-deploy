import { Module } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { WalletService } from './wallet.service';
import { FlutterwaveService } from './flutterwave.service';
import { StripeService } from './stripe.service';
import { NotchPayService } from './notchpay.service';
import { MpesaService } from './mpesa.service';
import { PaypalService } from './paypal.service';
import { WaveService } from './wave.service';
import { ExchangeRateService } from './exchange-rate.service';
import { PaymentIntentService } from './payment-intent.service';
import { PayoutService } from './payout.service';
import { CashCommissionService } from './cash-commission.service';
import { ReceiptService } from './receipt.service';
import { TipService } from './tip.service';
import { SplitService } from './split.service';
import { EdoctorPaymentService } from './edoctor-payment.service';
import { PaymentsController } from './payments.controller';
import { PrismaModule } from '../database/prisma.module';
import { SettingsModule } from '../settings/settings.module';
import { SmsModule } from '../sms/sms.module';
import { EmailModule } from '../email/email.module';
import { RedisModule } from '../redis/redis.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [PrismaModule, SettingsModule, SmsModule, EmailModule, RedisModule, UsersModule],
  controllers: [PaymentsController],
  providers: [
    // Providers existants
    PaymentsService, WalletService,
    FlutterwaveService, StripeService,
    NotchPayService, MpesaService, PaypalService, WaveService,
    // Nouveaux services F4
    ExchangeRateService,
    PaymentIntentService,
    PayoutService,
    CashCommissionService,
    ReceiptService,
    TipService,
    SplitService,
    EdoctorPaymentService,
  ],
  exports: [
    PaymentsService, WalletService,
    FlutterwaveService, StripeService,
    NotchPayService, MpesaService, PaypalService, WaveService,
    ExchangeRateService,
    PaymentIntentService,
    PayoutService,
    CashCommissionService,
    ReceiptService,
    TipService,
    SplitService,
    EdoctorPaymentService,
  ],
})
export class PaymentsModule {}
