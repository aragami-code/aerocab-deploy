import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SettingsService } from '../settings/settings.service';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private config: ConfigService,
    private settings: SettingsService,
  ) {}

  private get cinetpayUrl(): string {
    return this.config.get('CINETPAY_URL', 'https://api-checkout.cinetpay.com/v2/payment');
  }
  private get cinetpayCheckUrl(): string {
    return this.config.get('CINETPAY_CHECK_URL', 'https://api-checkout.cinetpay.com/v2/payment/check');
  }

  /** Lit une credential depuis app_settings en priorité, env var en fallback */
  private async cred(dbKey: string, envKey: string): Promise<string> {
    const fromDb = await this.settings.get(dbKey, '');
    return fromDb || this.config.get<string>(envKey, '');
  }

  async initiate(params: {
    transactionId: string;
    amount: number;
    description: string;
    customerName: string;
    customerPhone: string;
    channels?: 'MOBILE_MONEY' | 'CREDIT_CARD' | 'ALL';
    returnPath?: string;
  }): Promise<{ paymentUrl: string }> {
    const apiKey     = await this.cred('payment_cinetpay_api_key', 'CINETPAY_API_KEY');
    const siteId     = await this.cred('payment_cinetpay_site_id', 'CINETPAY_SITE_ID');
    const backendUrl = await this.settings.get('backend_url', this.config.get<string>('BACKEND_URL', 'https://aerocab-api.onrender.com'));
    const appScheme  = this.config.get('PAYMENT_RETURN_SCHEME', 'aerogo24-passenger');

    const nameParts = (params.customerName || 'Client AeroGo 24').trim().split(' ');
    const surname   = nameParts[0] || 'Client';
    const name      = nameParts.slice(1).join(' ') || 'AeroGo 24';

    const returnUrl = `${appScheme}://payment/return?ref=${encodeURIComponent(params.transactionId)}&type=${params.returnPath ?? 'payment'}`;
    const notifyUrl = `${backendUrl}/api/payments/webhook`;

    let res: Response;
    if (siteId) {
      res = await fetch(this.cinetpayUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apikey: apiKey, site_id: siteId,
          transaction_id: params.transactionId,
          amount: params.amount, currency: 'XAF',
          description: params.description,
          notify_url: notifyUrl, return_url: returnUrl,
          customer_name: name, customer_surname: surname,
          customer_phone_number: params.customerPhone || '',
          channels: params.channels ?? 'MOBILE_MONEY',
        }),
      });
    } else {
      res = await fetch(this.cinetpayUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          transaction_id: params.transactionId,
          amount: params.amount, currency: 'XAF',
          description: params.description,
          notify_url: notifyUrl, return_url: returnUrl,
          customer_name: name, customer_surname: surname,
          customer_phone_number: params.customerPhone || '',
          channels: params.channels ?? 'MOBILE_MONEY',
        }),
      });
    }

    if (!res.ok) {
      const text = await res.text();
      this.logger.error('CinetPay initiate HTTP error', text);
      throw new Error('Erreur initialisation paiement CinetPay');
    }

    const data = await res.json() as any;
    if (data.code !== '201' && data.status !== 'success') {
      this.logger.error('CinetPay error response', JSON.stringify(data));
      throw new Error(data.message || 'Erreur CinetPay');
    }

    const paymentUrl = data.data?.payment_url || data.payment_url;
    if (!paymentUrl) throw new Error('URL de paiement non reçue de CinetPay');

    return { paymentUrl };
  }

  async refund(transactionId: string, amount: number): Promise<{ success: boolean; message: string }> {
    this.logger.warn(`Refund requested for transaction ${transactionId}, amount ${amount}`);
    return { success: false, message: 'Remboursement non disponible via CinetPay' };
  }

  async verify(transactionId: string): Promise<'ACCEPTED' | 'REFUSED' | 'PENDING'> {
    const apiKey = await this.cred('payment_cinetpay_api_key', 'CINETPAY_API_KEY');
    const siteId = await this.cred('payment_cinetpay_site_id', 'CINETPAY_SITE_ID');

    let res: Response;
    if (siteId) {
      res = await fetch(
        `${this.cinetpayCheckUrl}?apikey=${apiKey}&site_id=${siteId}&transaction_id=${encodeURIComponent(transactionId)}`,
      );
    } else {
      res = await fetch(
        `${this.cinetpayCheckUrl}?transaction_id=${encodeURIComponent(transactionId)}`,
        { headers: { 'Authorization': `Bearer ${apiKey}` } },
      );
    }

    const data = await res.json() as any;
    const status = data.data?.status as string | undefined;
    if (status === 'ACCEPTED') return 'ACCEPTED';
    if (['REFUSED', 'FAILED', 'ANNULED'].includes(status ?? '')) return 'REFUSED';
    return 'PENDING';
  }
}
