import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ISmsProvider } from '../interfaces/sms-provider.interface';

@Injectable()
export class AfricasTalkingProvider implements ISmsProvider {
  readonly name = 'africas-talking';
  private readonly logger = new Logger(AfricasTalkingProvider.name);

  constructor(private config: ConfigService) {}

  async send(to: string, message: string): Promise<boolean> {
    const apiKey   = this.config.get<string>('AT_API_KEY');
    const username = this.config.get<string>('AT_USERNAME') ?? 'sandbox';
    const senderId = this.config.get<string>('AT_SENDER_ID');

    if (!apiKey) {
      this.logger.error('Africa\'s Talking credentials manquants (AT_API_KEY)');
      return false;
    }

    const baseUrl = username === 'sandbox'
      ? 'https://api.sandbox.africastalking.com'
      : 'https://api.africastalking.com';

    try {
      const params: Record<string, string> = {
        username,
        to,
        message,
      };
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
