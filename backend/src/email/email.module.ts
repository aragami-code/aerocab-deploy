import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MockEmailProvider } from './providers/mock-email.provider';
import { SendgridEmailProvider } from './providers/sendgrid-email.provider';
import { SmtpEmailProvider } from './providers/smtp-email.provider';
import { EmailRouterService } from './email-router.service';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [ConfigModule, SettingsModule],
  providers: [
    MockEmailProvider,
    SendgridEmailProvider,
    SmtpEmailProvider,
    EmailRouterService,
  ],
  exports: [EmailRouterService],
})
export class EmailModule {}
