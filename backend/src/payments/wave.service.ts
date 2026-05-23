import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SettingsService } from '../settings/settings.service';
import * as crypto from 'crypto';

const WAVE_BASE = 'https://api.wave.com/v1';

@Injectable()
export class WaveService {
  private readonly logger = new Logger(WaveService.name);

  constructor(
    private config: ConfigService,
    private settings: SettingsService,
  ) {}

  private async cred(dbKey: string, envKey: string): Promise<string> {
    const fromDb = await this.settings.get(dbKey, '');
    return fromDb || this.config.get<string>(envKey, '');
  }

  async initiate(params: {
    transactionId: string;
    amount: number;
    description: string;
  }): Promise<{ paymentUrl: string; sessionId: string }> {
    const apiKey    = await this.cred('payment_wave_api_key', 'WAVE_API_KEY');
    const appScheme = 'aerogo24-passenger';

    const body = {
      amount:           String(Math.round(params.amount)),
      currency:         'XOF', // Wave supporte XOF — équivalent XAF 1:1
      error_url:        `${appScheme}://payment/return?ref=${encodeURIComponent(params.transactionId)}&type=wallet&status=cancel`,
      success_url:      `${appScheme}://payment/return?ref=${encodeURIComponent(params.transactionId)}&type=wallet&status=success`,
      client_reference: params.transactionId,
    };

    const res = await fetch(`${WAVE_BASE}/checkout/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      this.logger.error('Wave initiate error', text);
      throw new Error('Erreur initialisation paiement Wave');
    }

    const data = await res.json() as any;
    if (!data.wave_launch_url) throw new Error(data.message || 'Wave: URL introuvable');
    return { paymentUrl: data.wave_launch_url, sessionId: data.id };
  }

  async getWebhookSecret(): Promise<string> {
    return this.cred('payment_wave_webhook_secret', 'WAVE_WEBHOOK_SECRET');
  }

  verifyWebhookSignature(rawBody: string | Buffer, signature: string, secret: string): boolean {
    if (!secret) return true;
    try {
      const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
      return expected === signature;
    } catch { return false; }
  }
}
