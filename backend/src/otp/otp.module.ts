import { Module } from '@nestjs/common';
import { OtpDeliveryService } from './otp-delivery.service';
import { SmsModule } from '../sms/sms.module';
import { EmailModule } from '../email/email.module';
import { SettingsModule } from '../settings/settings.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';

@Module({
  imports: [SmsModule, EmailModule, SettingsModule, WhatsAppModule],
  providers: [OtpDeliveryService],
  exports: [OtpDeliveryService],
})
export class OtpModule {}
