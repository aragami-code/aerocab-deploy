import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ISmsProvider } from '../interfaces/sms-provider.interface';
import { SettingsService } from '../../settings/settings.service';

@Injectable()
export class TwilioSmsProvider implements ISmsProvider {
  readonly name = 'twilio';
  private readonly logger = new Logger(TwilioSmsProvider.name);

  constructor(
    private config: ConfigService,
    private settings: SettingsService,
  ) {}

  async send(to: string, message: string): Promise<boolean> {
    // Priorité : AppSetting (admin) → env var (fallback)
    const [sidDb, tokenDb, fromDb] = await Promise.all([
      this.settings.get('twilio_account_sid'),
      this.settings.get('twilio_auth_token'),
      this.settings.get('twilio_phone_number'),
    ]);
    const accountSid = sidDb   || this.config.get<string>('TWILIO_ACCOUNT_SID', '');
    const authToken  = tokenDb || this.config.get<string>('TWILIO_AUTH_TOKEN', '');
    const from       = fromDb  || this.config.get<string>('TWILIO_PHONE_NUMBER', '');

    if (!accountSid || !authToken || !from) {
      this.logger.error('Twilio credentials manquants — configurez via admin > Configuration > SMS');
      return false;
    }

    try {
      const credentials = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
      const res = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${credentials}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({ From: from, To: to, Body: message }).toString(),
        },
      );
      if (!res.ok) {
        const err = await res.json() as any;
        this.logger.error(`Twilio error ${res.status}: ${err?.message}`);
        return false;
      }
      return true;
    } catch (e) {
      this.logger.error(`Twilio send failed: ${e.message}`);
      return false;
    }
  }
}
