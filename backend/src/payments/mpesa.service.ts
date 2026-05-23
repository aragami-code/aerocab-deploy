import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SettingsService } from '../settings/settings.service';

const DARAJA_PROD    = 'https://api.safaricom.co.ke';
const DARAJA_SANDBOX = 'https://sandbox.safaricom.co.ke';

@Injectable()
export class MpesaService {
  private readonly logger = new Logger(MpesaService.name);

  constructor(
    private config: ConfigService,
    private settings: SettingsService,
  ) {}

  private get baseUrl(): string {
    return this.config.get<string>('NODE_ENV') === 'production' ? DARAJA_PROD : DARAJA_SANDBOX;
  }

  private async cred(dbKey: string, envKey: string, fallback = ''): Promise<string> {
    const fromDb = await this.settings.get(dbKey, '');
    return fromDb || this.config.get<string>(envKey, fallback);
  }

  private async getAccessToken(): Promise<string> {
    const consumerKey    = await this.cred('payment_mpesa_consumer_key',    'MPESA_CONSUMER_KEY');
    const consumerSecret = await this.cred('payment_mpesa_consumer_secret', 'MPESA_CONSUMER_SECRET');
    const cred = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
    const res  = await fetch(`${this.baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
      headers: { 'Authorization': `Basic ${cred}` },
    });
    const data = await res.json() as any;
    if (!data.access_token) throw new Error('M-Pesa: OAuth token introuvable');
    return data.access_token;
  }

  private async buildTimestampAndPassword(): Promise<{ timestamp: string; password: string }> {
    const shortcode = await this.cred('payment_mpesa_shortcode', 'MPESA_SHORTCODE', '174379');
    const passkey   = await this.cred('payment_mpesa_passkey',   'MPESA_PASSKEY');
    const timestamp = new Date().toISOString().replace(/[-T:.Z]/g, '').slice(0, 14);
    const password  = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');
    return { timestamp, password };
  }

  async stkPush(params: {
    transactionId: string;
    amountKes: number;
    phone: string;
    description: string;
  }): Promise<{ checkoutRequestId: string; message: string }> {
    const backendUrl = await this.settings.get('backend_url', this.config.get<string>('BACKEND_URL', 'https://aerocab-api.onrender.com'));
    const shortcode  = await this.cred('payment_mpesa_shortcode', 'MPESA_SHORTCODE', '174379');
    const token      = await this.getAccessToken();
    const { timestamp, password } = await this.buildTimestampAndPassword();

    const body = {
      BusinessShortCode: shortcode,
      Password:          password,
      Timestamp:         timestamp,
      TransactionType:   'CustomerPayBillOnline',
      Amount:            Math.ceil(params.amountKes),
      PartyA:            params.phone,
      PartyB:            shortcode,
      PhoneNumber:       params.phone,
      CallBackURL:       `${backendUrl}/api/payments/webhook/mpesa`,
      AccountReference:  params.transactionId,
      TransactionDesc:   params.description.slice(0, 13),
    };

    const res = await fetch(`${this.baseUrl}/mpesa/stkpush/v1/processrequest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      this.logger.error('M-Pesa STK Push error', text);
      throw new Error('Erreur initialisation paiement M-Pesa');
    }

    const data = await res.json() as any;
    if (data.ResponseCode !== '0') throw new Error(data.ResponseDescription || 'Erreur M-Pesa STK Push');

    return {
      checkoutRequestId: data.CheckoutRequestID,
      message: 'Confirmez le paiement sur votre téléphone M-Pesa',
    };
  }

  static formatPhone(phone: string): string {
    return phone.replace(/^\+/, '').replace(/^0/, '254');
  }
}
