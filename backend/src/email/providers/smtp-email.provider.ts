import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IEmailProvider } from '../interfaces/email-provider.interface';
import * as nodemailer from 'nodemailer';

@Injectable()
export class SmtpEmailProvider implements IEmailProvider {
  readonly name = 'smtp';
  private readonly logger = new Logger(SmtpEmailProvider.name);

  constructor(private config: ConfigService) {}

  async send(to: string, subject: string, html: string): Promise<boolean> {
    const host = this.config.get<string>('SMTP_HOST');
    const port = parseInt(this.config.get<string>('SMTP_PORT') ?? '587', 10);
    const user = this.config.get<string>('SMTP_USER');
    const pass = this.config.get<string>('SMTP_PASS');
    const from = this.config.get<string>('SMTP_FROM_EMAIL') ?? user;

    if (!host || !user || !pass || !from) {
      this.logger.error('SMTP credentials manquants (SMTP_HOST, SMTP_USER, SMTP_PASS, SMTP_FROM_EMAIL)');
      return false;
    }

    try {
      const transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
      });

      await transporter.sendMail({ from, to, subject, html });
      return true;
    } catch (e) {
      this.logger.error(`SMTP send failed: ${e.message}`);
      return false;
    }
  }
}
