import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SettingsService } from '../settings/settings.service';
import * as crypto from 'crypto';

const NOTCHPAY_BASE = 'https://api.notchpay.co';

export const WITHDRAWAL_METHOD_TO_NOTCHPAY: Record<string, 'cm.orange' | 'cm.mtn'> = {
  orange_money: 'cm.orange',
  mtn_momo:     'cm.mtn',
};

@Injectable()
export class NotchPayService {
  private readonly logger = new Logger(NotchPayService.name);

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
    const publicKey  = await this.cred('payment_notchpay_public_key', 'NOTCHPAY_PUBLIC_KEY', params.country ?? null);
    const backendUrl = await this.settings.get('backend_url', this.config.get<string>('BACKEND_URL', 'https://aerocab-api.onrender.com'));
    const appScheme  = 'aerogo24-passenger';

    const body = {
      amount:      params.amount,
      currency:    params.currency,
      reference:   params.transactionId,
      description: params.description,
      email:       params.customerEmail || 'client@aerogo24.com',
      phone:       params.customerPhone || '',
      name:        params.customerName  || 'Client',
      callback:    `${backendUrl}/api/payments/webhook/notchpay`,
      redirect:    `${appScheme}://payment/return?ref=${encodeURIComponent(params.transactionId)}&type=wallet`,
    };

    const res = await fetch(`${NOTCHPAY_BASE}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': publicKey },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      this.logger.error('NotchPay initiate error', text);
      throw new Error('Erreur initialisation paiement NotchPay');
    }

    const data = await res.json() as any;
    const url  = data.transaction?.authorization_url ?? data.authorization_url;
    if (!url) throw new Error(data.message || 'NotchPay: URL de paiement introuvable');
    return { paymentUrl: url };
  }

  async verify(reference: string): Promise<'ACCEPTED' | 'REFUSED' | 'PENDING'> {
    const publicKey = await this.cred('payment_notchpay_public_key', 'NOTCHPAY_PUBLIC_KEY');
    const res = await fetch(`${NOTCHPAY_BASE}/payments/${encodeURIComponent(reference)}`, {
      headers: { 'Authorization': publicKey },
    });

    if (!res.ok) {
      this.logger.warn(`NotchPay verify ${reference}: HTTP ${res.status}`);
      return 'PENDING';
    }
    const data   = await res.json() as any;
    const status = (data.transaction?.status ?? data.status ?? '').toLowerCase();
    if (status === 'complete' || status === 'completed') return 'ACCEPTED';
    if (['failed', 'canceled', 'cancelled', 'rejected'].includes(status)) return 'REFUSED';
    return 'PENDING';
  }

  async transfer(params: {
    reference: string;
    amount: number;
    currency: string;
    beneficiaryName: string;
    beneficiaryPhone: string;
    channel: 'cm.orange' | 'cm.mtn';
    description: string;
  }): Promise<{ id: string; status: string }> {
    const privateKey = await this.cred('payment_notchpay_private_key', 'NOTCHPAY_PRIVATE_KEY');
    const publicKey  = await this.cred('payment_notchpay_public_key', 'NOTCHPAY_PUBLIC_KEY');
    const key = privateKey || publicKey;
    if (!key) throw new Error('NotchPay: clé non configurée');

    const body = {
      amount:      params.amount,
      currency:    params.currency,
      reference:   params.reference,
      description: params.description,
      beneficiary: {
        name:    params.beneficiaryName,
        phone:   params.beneficiaryPhone,
        channel: params.channel,
      },
    };

    const res = await fetch(`${NOTCHPAY_BASE}/transfers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': key },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      this.logger.error('NotchPay transfer error', text);
      throw new Error(`Erreur disbursement NotchPay: ${text}`);
    }

    const data = await res.json() as any;
    return { id: data.transfer?.id ?? data.id ?? '', status: data.transfer?.status ?? data.status ?? 'pending' };
  }

  async getWebhookSecret(): Promise<string> {
    return this.cred('payment_notchpay_webhook_secret', 'NOTCHPAY_WEBHOOK_SECRET');
  }

  verifyWebhookSignature(rawBody: string | Buffer, signature: string, secret: string): boolean {
    if (!secret) return true;
    try {
      const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
      return expected === signature;
    } catch {
      return false;
    }
  }

  async isConfigured(): Promise<boolean> {
    const key = await this.cred('payment_notchpay_public_key', 'NOTCHPAY_PUBLIC_KEY');
    return !!key;
  }
}
