import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IEmailProvider } from '../interfaces/email-provider.interface';
import { SettingsService } from '../../settings/settings.service';
import * as nodemailer from 'nodemailer';

@Injectable()
export class SmtpEmailProvider implements IEmailProvider {
  readonly name = 'smtp';
  private readonly logger = new Logger(SmtpEmailProvider.name);

  constructor(
    private config: ConfigService,
    private settings: SettingsService,
  ) {}

  async send(to: string, subject: string, html: string): Promise<boolean> {
    // Priorité : AppSetting (admin) → env var (fallback)
    const [hostDb, portDb, userDb, passDb, fromDb] = await Promise.all([
      this.settings.get('smtp_host', ''),
      this.settings.get('smtp_port', ''),
      this.settings.get('smtp_user', ''),
      this.settings.get('smtp_pass', ''),
      this.settings.get('smtp_from_email', ''),
    ]);

    const host = hostDb || this.config.get<string>('SMTP_HOST', '');
    const port = parseInt(portDb || this.config.get<string>('SMTP_PORT', '587'), 10);
    const user = userDb || this.config.get<string>('SMTP_USER', '');
    const pass = passDb || this.config.get<string>('SMTP_PASS', '');
    const from = fromDb || this.config.get<string>('SMTP_FROM_EMAIL', '') || user;

    if (!host || !user || !pass || !from) {
      this.logger.error('SMTP credentials manquants — configurez via Admin > Configuration > Email');
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
      this.logger.log(`[SMTP] Email envoyé → ${to}`);
      return true;
    } catch (e) {
      this.logger.error(`SMTP send failed: ${e.message}`);
      return false;
    }
  }
}
