import { Injectable, Logger } from '@nestjs/common';
import { IEmailProvider } from './interfaces/email-provider.interface';
import { MockEmailProvider } from './providers/mock-email.provider';
import { SendgridEmailProvider } from './providers/sendgrid-email.provider';
import { SmtpEmailProvider } from './providers/smtp-email.provider';
import { SettingsService } from '../settings/settings.service';

/**
 * AppSetting `email_provider`: 'sendgrid' | 'smtp' | 'mock' (default: 'mock')
 */
@Injectable()
export class EmailRouterService {
  private readonly logger = new Logger(EmailRouterService.name);

  constructor(
    private readonly mock: MockEmailProvider,
    private readonly sendgrid: SendgridEmailProvider,
    private readonly smtp: SmtpEmailProvider,
    private readonly settings: SettingsService,
  ) {}

  async send(to: string, subject: string, html: string): Promise<boolean> {
    const provider = await this.resolveProvider();
    this.logger.log(`Email via ${provider.name} → ${to}`);
    return provider.send(to, subject, html);
  }

  private async resolveProvider(): Promise<IEmailProvider> {
    const name = await this.settings.get('email_provider') ?? 'mock';
    const map: Record<string, IEmailProvider> = {
      sendgrid: this.sendgrid,
      smtp: this.smtp,
      mock: this.mock,
    };
    const provider = map[name];
    if (!provider) {
      this.logger.warn(`Provider email inconnu '${name}' — fallback mock`);
      return this.mock;
    }
    return provider;
  }
}
