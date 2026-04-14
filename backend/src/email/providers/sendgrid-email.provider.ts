import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IEmailProvider } from '../interfaces/email-provider.interface';

@Injectable()
export class SendgridEmailProvider implements IEmailProvider {
  readonly name = 'sendgrid';
  private readonly logger = new Logger(SendgridEmailProvider.name);

  constructor(private config: ConfigService) {}

  async send(to: string, subject: string, html: string): Promise<boolean> {
    const apiKey = this.config.get<string>('SENDGRID_API_KEY');
    const from   = this.config.get<string>('SENDGRID_FROM_EMAIL');

    if (!apiKey || !from) {
      this.logger.error('SendGrid credentials manquants (SENDGRID_API_KEY, SENDGRID_FROM_EMAIL)');
      return false;
    }

    try {
      const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: to }] }],
          from: { email: from },
          subject,
          content: [{ type: 'text/html', value: html }],
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        this.logger.error(`SendGrid error ${res.status}: ${body}`);
        return false;
      }

      return true;
    } catch (e) {
      this.logger.error(`SendGrid send failed: ${e.message}`);
      return false;
    }
  }
}
