import { Module } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { WalletService } from './wallet.service';
import { PaymentsController } from './payments.controller';
import { PrismaModule } from '../database/prisma.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [PrismaModule, SettingsModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, WalletService],
  exports: [PaymentsService, WalletService],
})
export class PaymentsModule {}
