import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ISmsProvider } from '../interfaces/sms-provider.interface';
import { SettingsService } from '../../settings/settings.service';

@Injectable()
export class AfricasTalkingProvider implements ISmsProvider {
  readonly name = 'africas-talking';
  private readonly logger = new Logger(AfricasTalkingProvider.name);

  constructor(
    private config: ConfigService,
    private settings: SettingsService,
  ) {}

  async send(to: string, message: string): Promise<boolean> {
    // Priorité : AppSetting (admin) → env var (fallback)
    const [keyDb, userDb, senderDb] = await Promise.all([
      this.settings.get('at_api_key'),
      this.settings.get('at_username'),
      this.settings.get('at_sender_id'),
    ]);
    const apiKey   = keyDb    || this.config.get<string>('AT_API_KEY', '');
    const username = userDb   || this.config.get<string>('AT_USERNAME', 'sandbox');
    const senderId = senderDb || this.config.get<string>('AT_SENDER_ID', '');

    if (!apiKey) {
      this.logger.error('Africa\'s Talking credentials manquants — configurez via admin > Configuration > SMS');
      return false;
    }

    const baseUrl = username === 'sandbox'
      ? 'https://api.sandbox.africastalking.com'
      : 'https://api.africastalking.com';

    try {
      const params: Record<string, string> = { username, to, message };
      if (senderId) params['from'] = senderId;

      const res = await fetch(`${baseUrl}/version1/messaging`, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
          'apiKey': apiKey,
        },
        body: new URLSearchParams(params).toString(),
      });

      if (!res.ok) {
        this.logger.error(`Africa's Talking error ${res.status}`);
        return false;
      }

      const data = await res.json() as any;
      const recipients: any[] = data?.SMSMessageData?.Recipients ?? [];
      const success = recipients.some((r: any) => r.statusCode === 101);

      if (!success) {
        this.logger.error(`Africa's Talking delivery failed: ${JSON.stringify(recipients)}`);
        return false;
      }

      return true;
    } catch (e) {
      this.logger.error(`Africa's Talking send failed: ${e.message}`);
      return false;
    }
  }
}
