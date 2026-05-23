import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SettingsService } from '../settings/settings.service';

const PAYPAL_PROD    = 'https://api-m.paypal.com';
const PAYPAL_SANDBOX = 'https://api-m.sandbox.paypal.com';

@Injectable()
export class PaypalService {
  private readonly logger = new Logger(PaypalService.name);

  constructor(
    private config: ConfigService,
    private settings: SettingsService,
  ) {}

  private get baseUrl(): string {
    return this.config.get<string>('NODE_ENV') === 'production' ? PAYPAL_PROD : PAYPAL_SANDBOX;
  }

  private async cred(dbKey: string, envKey: string): Promise<string> {
    const fromDb = await this.settings.get(dbKey, '');
    return fromDb || this.config.get<string>(envKey, '');
  }

  private async getAccessToken(): Promise<string> {
    const clientId     = await this.cred('payment_paypal_client_id',     'PAYPAL_CLIENT_ID');
    const clientSecret = await this.cred('payment_paypal_client_secret', 'PAYPAL_CLIENT_SECRET');
    const cred = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const res  = await fetch(`${this.baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: { 'Authorization': `Basic ${cred}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    });
    const data = await res.json() as any;
    if (!data.access_token) throw new Error('PayPal: OAuth token introuvable');
    return data.access_token;
  }

  async initiate(params: {
    transactionId: string;
    amount: number;
    currency: string;
    description: string;
    customerEmail?: string;
  }): Promise<{ paymentUrl: string; orderId: string }> {
    const appScheme  = 'aerogo24-passenger';
    const backendUrl = await this.settings.get('backend_url', this.config.get<string>('BACKEND_URL', 'https://aerocab-api.onrender.com'));
    const token      = await this.getAccessToken();

    const body = {
      intent: 'CAPTURE',
      purchase_units: [{
        reference_id: params.transactionId,
        custom_id:    params.transactionId,
        description:  params.description,
        amount: { currency_code: params.currency.toUpperCase(), value: params.amount.toFixed(2) },
      }],
      application_context: {
        brand_name:          'AeroGo 24',
        shipping_preference: 'NO_SHIPPING',
        user_action:         'PAY_NOW',
        notify_url:          `${backendUrl}/api/payments/webhook/paypal`,
        return_url:          `${appScheme}://payment/return?ref=${encodeURIComponent(params.transactionId)}&type=wallet&status=success`,
        cancel_url:          `${appScheme}://payment/return?ref=${encodeURIComponent(params.transactionId)}&type=wallet&status=cancel`,
      },
    };

    const res = await fetch(`${this.baseUrl}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'Authorization':     `Bearer ${token}`,
        'PayPal-Request-Id': params.transactionId,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      this.logger.error('PayPal initiate error', text);
      throw new Error('Erreur initialisation paiement PayPal');
    }

    const data        = await res.json() as any;
    const approveLink = (data.links as any[])?.find((l: any) => l.rel === 'approve')?.href;
    if (!approveLink) throw new Error('PayPal: lien approve introuvable');
    return { paymentUrl: approveLink, orderId: data.id };
  }

  async captureOrder(orderId: string): Promise<'ACCEPTED' | 'REFUSED' | 'PENDING'> {
    const token = await this.getAccessToken();
    const res   = await fetch(`${this.baseUrl}/v2/checkout/orders/${orderId}/capture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    });

    if (!res.ok) { this.logger.error('PayPal capture error', await res.text()); return 'REFUSED'; }
    const data = await res.json() as any;
    if (data.status === 'COMPLETED') return 'ACCEPTED';
    if (['VOIDED', 'DECLINED'].includes(data.status ?? '')) return 'REFUSED';
    return 'PENDING';
  }

  async verifyWebhookSignature(headers: Record<string, string>, rawBody: string): Promise<boolean> {
    const webhookId = await this.cred('payment_paypal_webhook_id', 'PAYPAL_WEBHOOK_ID');
    if (!webhookId) return true;
    try {
      const token = await this.getAccessToken();
      const res   = await fetch(`${this.baseUrl}/v1/notifications/verify-webhook-signature`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          transmission_id:   headers['paypal-transmission-id'] ?? '',
          transmission_time: headers['paypal-transmission-time'] ?? '',
          cert_url:          headers['paypal-cert-url'] ?? '',
          auth_algo:         headers['paypal-auth-algo'] ?? '',
          transmission_sig:  headers['paypal-transmission-sig'] ?? '',
          webhook_id:        webhookId,
          webhook_event:     JSON.parse(rawBody),
        }),
      });
      const data = await res.json() as any;
      return data.verification_status === 'SUCCESS';
    } catch { return false; }
  }
}
