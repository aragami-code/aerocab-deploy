import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MockSmsProvider } from './providers/mock-sms.provider';
import { TwilioSmsProvider } from './providers/twilio-sms.provider';
import { OrangeCmProvider } from './providers/orange-cm.provider';
import { AfricasTalkingProvider } from './providers/africas-talking.provider';
import { SmartSmsRouter } from './smart-sms.router';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [ConfigModule, SettingsModule],
  providers: [
    MockSmsProvider,
    TwilioSmsProvider,
    OrangeCmProvider,
    AfricasTalkingProvider,
    SmartSmsRouter,
  ],
  exports: [SmartSmsRouter],
})
export class SmsModule {}
