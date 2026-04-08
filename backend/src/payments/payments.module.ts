import { Module } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { WalletService } from './wallet.service';
import { FlutterwaveService } from './flutterwave.service';
import { StripeService } from './stripe.service';
import { PaymentsController } from './payments.controller';
import { PrismaModule } from '../database/prisma.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [PrismaModule, SettingsModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, WalletService, FlutterwaveService, StripeService],
  exports: [PaymentsService, WalletService, FlutterwaveService, StripeService],
})
export class PaymentsModule {}
