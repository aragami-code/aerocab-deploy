import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ISmsProvider } from '../interfaces/sms-provider.interface';

@Injectable()
export class OrangeCmProvider implements ISmsProvider {
  readonly name = 'orange-cm';
  private readonly logger = new Logger(OrangeCmProvider.name);

  constructor(private config: ConfigService) {}

  async send(to: string, message: string): Promise<boolean> {
    const clientId     = this.config.get<string>('ORANGE_CM_CLIENT_ID');
    const clientSecret = this.config.get<string>('ORANGE_CM_CLIENT_SECRET');
    const senderAddr   = this.config.get<string>('ORANGE_CM_SENDER_ADDRESS');

    if (!clientId || !clientSecret || !senderAddr) {
      this.logger.error('Orange CM credentials manquants (ORANGE_CM_CLIENT_ID, ORANGE_CM_CLIENT_SECRET, ORANGE_CM_SENDER_ADDRESS)');
      return false;
    }

    try {
      // Step 1: Get OAuth2 token
      const tokenRes = await fetch('https://api.orange.com/oauth/v3/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: clientId,
          client_secret: clientSecret,
        }).toString(),
      });

      if (!tokenRes.ok) {
        this.logger.error(`Orange CM token error: ${tokenRes.status}`);
        return false;
      }

      const { access_token } = await tokenRes.json() as { access_token: string };

      // Step 2: Send SMS
      const smsRes = await fetch(`https://api.orange.com/smsmessaging/v1/outbound/${encodeURIComponent(senderAddr)}/requests`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          outboundSMSMessageRequest: {
            address: `tel:${to}`,
            senderAddress: senderAddr,
            outboundSMSTextMessage: { message },
          },
        }),
      });

      if (!smsRes.ok) {
        const err = await smsRes.json() as any;
        this.logger.error(`Orange CM SMS error ${smsRes.status}: ${JSON.stringify(err)}`);
        return false;
      }

      return true;
    } catch (e) {
      this.logger.error(`Orange CM send failed: ${e.message}`);
      return false;
    }
  }
}
