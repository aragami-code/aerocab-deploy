import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SettingsService } from '../settings/settings.service';
import * as crypto from 'crypto';

const FLW_BASE = 'https://api.flutterwave.com/v3';

/** Mappage méthode de retrait → bank code Flutterwave (Mobile Money Cameroun) */
export const WITHDRAWAL_METHOD_TO_FLUTTERWAVE: Record<string, string> = {
  orange_money: 'ORANGE_CM',
  mtn_momo:     'MTN_CM',
};

@Injectable()
export class FlutterwaveService {
  private readonly logger = new Logger(FlutterwaveService.name);

  constructor(
    private config: ConfigService,
    private settings: SettingsService,
  ) {}

  private async cred(dbKey: string, envKey: string, country?: string | null): Promise<string> {
    const fromDb = await this.settings.getForCountry(dbKey, country ?? null, '');
    return fromDb || this.config.get<string>(envKey, '');
  }

  async initiate(params: {
    transactionId: string;
    amount: number;
    currency: string;
    description: string;
    customerName: string;
    customerPhone: string;
    customerEmail: string;
    country?: string;
  }): Promise<{ paymentUrl: string }> {
    const secretKey  = await this.cred('payment_flutterwave_secret_key', 'FLUTTERWAVE_SECRET_KEY', params.country ?? null);
    const backendUrl = await this.settings.get('backend_url', this.config.get<string>('BACKEND_URL', 'https://aerocab-api.onrender.com'));
    const appScheme  = 'aerogo24-passenger';

    const body = {
      tx_ref: params.transactionId,
      amount: params.amount,
      currency: params.currency,
      redirect_url: `${appScheme}://payment/return?ref=${encodeURIComponent(params.transactionId)}&type=wallet`,
      payment_options: 'mobilemoneycameroon,mobilemoneyrwanda,mobilemoneyzambia,mobilemoneyghana,mobilemoneytanzania,card,ussd',
      customer: {
        email: params.customerEmail || 'client@aerogo24.com',
        phone_number: params.customerPhone || '',
        name: params.customerName || 'Client',
      },
      customizations: {
        title: 'AeroGo 24',
        description: params.description,
        logo: `${backendUrl}/logo.png`,
      },
      meta: {
        source: 'wallet_recharge',
        notify_url: `${backendUrl}/api/payments/webhook/flutterwave`,
      },
    };

    const res = await fetch(`${FLW_BASE}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${secretKey}` },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      this.logger.error('Flutterwave initiate error', text);
      throw new Error('Erreur initialisation paiement Flutterwave');
    }

    const data = await res.json() as any;
    if (data.status !== 'success') throw new Error(data.message || 'Erreur Flutterwave');
    return { paymentUrl: data.data.link };
  }

  /** Retourne le hash webhook depuis DB ou env (pour le contrôleur) */
  async getWebhookHash(): Promise<string> {
    return this.cred('payment_flutterwave_webhook_hash', 'FLUTTERWAVE_WEBHOOK_HASH');
  }

  verifyWebhookSignature(rawBody: string, signature: string, secretKey: string): boolean {
    const hash = crypto.createHmac('sha256', secretKey).update(rawBody).digest('hex');
    return hash === signature;
  }

  async transfer(params: {
    reference: string;
    amount: number;
    currency: string;
    beneficiaryPhone: string;
    bankCode: string;
    description: string;
  }): Promise<{ id: string; status: string }> {
    const secretKey  = await this.cred('payment_flutterwave_secret_key', 'FLUTTERWAVE_SECRET_KEY');
    const backendUrl = await this.settings.get('backend_url', this.config.get<string>('BACKEND_URL', 'https://aerocab-api.onrender.com'));

    const body = {
      account_bank:   params.bankCode,
      account_number: params.beneficiaryPhone,
      amount:         params.amount,
      narration:      params.description,
      currency:       params.currency,
      reference:      params.reference,
      callback_url:   `${backendUrl}/api/payments/webhook/flutterwave`,
      debit_currency: params.currency,
    };

    const res = await fetch(`${FLW_BASE}/transfers`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${secretKey}` },
      body:    JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      this.logger.error('Flutterwave transfer error', text);
      throw new Error(`Erreur disbursement Flutterwave: ${text}`);
    }

    const data = await res.json() as any;
    if (data.status !== 'success') throw new Error(data.message || 'Erreur Flutterwave transfer');
    return {
      id:     String(data.data?.id ?? ''),
      status: String(data.data?.status ?? 'pending'),
    };
  }

  async isConfigured(): Promise<boolean> {
    const key = await this.cred('payment_flutterwave_secret_key', 'FLUTTERWAVE_SECRET_KEY');
    return !!key;
  }

  async verify(flwTransactionId: string): Promise<'ACCEPTED' | 'REFUSED' | 'PENDING'> {
    const secretKey = await this.cred('payment_flutterwave_secret_key', 'FLUTTERWAVE_SECRET_KEY');

    const res = await fetch(`${FLW_BASE}/transactions/${flwTransactionId}/verify`, {
      headers: { 'Authorization': `Bearer ${secretKey}` },
    });

    const data  = await res.json() as any;
    const status = data.data?.status as string | undefined;
    if (status === 'successful') return 'ACCEPTED';
    if (['failed', 'cancelled', 'error'].includes(status ?? '')) return 'REFUSED';
    return 'PENDING';
  }
}
