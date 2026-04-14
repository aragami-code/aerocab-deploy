import { Injectable, Logger } from '@nestjs/common';
import { SmartSmsRouter } from '../sms/smart-sms.router';
import { EmailRouterService } from '../email/email-router.service';
import { SettingsService } from '../settings/settings.service';

const TEMPLATES: Record<string, Record<string, { sms: string; emailSubject: string; emailHtml: string }>> = {
  fr: {
    otp: {
      sms: 'AeroGo 24 — Votre code de vérification : {{code}}. Valide {{expiry}} min.',
      emailSubject: 'AeroGo 24 — Code de vérification',
      emailHtml: '<p>Bonjour,</p><p>Votre code de vérification AeroGo 24 est : <strong>{{code}}</strong></p><p>Ce code expire dans {{expiry}} minutes.</p>',
    },
  },
  en: {
    otp: {
      sms: 'AeroGo 24 — Your verification code: {{code}}. Valid {{expiry}} min.',
      emailSubject: 'AeroGo 24 — Verification code',
      emailHtml: '<p>Hello,</p><p>Your AeroGo 24 verification code is: <strong>{{code}}</strong></p><p>This code expires in {{expiry}} minutes.</p>',
    },
  },
};

function renderTemplate(template: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce(
    (t, [key, value]) => t.split(`{{${key}}}`).join(value),
    template,
  );
}

/**
 * Orchestrates OTP delivery via SMS or email based on AppSetting `otp_channel`.
 * `otp_channel`: 'sms' | 'email' | 'both' (default: 'sms')
 * `otp_expiry_minutes`: used in message templates (display only)
 */
@Injectable()
export class OtpDeliveryService {
  private readonly logger = new Logger(OtpDeliveryService.name);

  constructor(
    private readonly sms: SmartSmsRouter,
    private readonly email: EmailRouterService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Send OTP via the configured channel(s).
   * @param contact  phone number (E.164) or email address
   * @param code     6-digit OTP
   * @param lang     language for message template (default: 'fr')
   */
  async sendOtp(contact: string, code: string, lang = 'fr'): Promise<boolean> {
    const channel = await this.settings.get('otp_channel') ?? 'sms';
    const expiryRaw = await this.settings.get('otp_expiry_minutes') ?? '5';
    const expiry = expiryRaw;

    const locale = TEMPLATES[lang] ? lang : 'fr';
    const tpl = TEMPLATES[locale].otp;
    const vars = { code, expiry };

    const isEmail = contact.includes('@');

    let sent = false;

    if (channel === 'both') {
      if (isEmail) {
        sent = await this.sendEmail(contact, tpl, vars);
      } else {
        const smsSent  = await this.sendSms(contact, tpl, vars);
        sent = smsSent;
      }
    } else if (channel === 'email') {
      if (!isEmail) {
        this.logger.warn(`otp_channel=email mais contact semble être un numéro: ${contact.slice(0, 6)}***`);
        return false;
      }
      sent = await this.sendEmail(contact, tpl, vars);
    } else {
      // default: sms
      if (isEmail) {
        this.logger.warn(`otp_channel=sms mais contact semble être un email: ${contact.slice(0, 4)}***`);
        return false;
      }
      sent = await this.sendSms(contact, tpl, vars);
    }

    return sent;
  }

  private async sendSms(phone: string, tpl: typeof TEMPLATES['fr']['otp'], vars: Record<string, string>): Promise<boolean> {
    const message = renderTemplate(tpl.sms, vars);
    return this.sms.send(phone, message);
  }

  private async sendEmail(emailAddr: string, tpl: typeof TEMPLATES['fr']['otp'], vars: Record<string, string>): Promise<boolean> {
    const subject = renderTemplate(tpl.emailSubject, vars);
    const html    = renderTemplate(tpl.emailHtml, vars);
    return this.email.send(emailAddr, subject, html);
  }
}
