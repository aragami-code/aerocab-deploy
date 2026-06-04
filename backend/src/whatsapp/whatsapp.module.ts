import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MockWhatsAppProvider } from './providers/mock-whatsapp.provider';
import { UltramsgProvider } from './providers/ultramsg.provider';
import { WhatsAppRouter } from './whatsapp.router';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [ConfigModule, SettingsModule],
  providers: [MockWhatsAppProvider, UltramsgProvider, WhatsAppRouter],
  exports: [WhatsAppRouter],
})
export class WhatsAppModule {}
