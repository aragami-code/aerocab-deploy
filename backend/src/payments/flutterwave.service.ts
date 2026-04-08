import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

const FLW_BASE = 'https://api.flutterwave.com/v3';

@Injectable()
export class FlutterwaveService {
  private readonly logger = new Logger(FlutterwaveService.name);

  constructor(private config: ConfigService) {}

  private get secretKey(): string {
    return this.config.get<string>('FLUTTERWAVE_SECRET_KEY', '');
  }

  /**
   * Crée un lien de paiement Flutterwave Standard.
   * Retourne { paymentUrl } — ouvert dans WebBrowser côté app.
   */
  async initiate(params: {
    transactionId: string;
    amount: number;
    currency: string;
    description: string;
    customerName: string;
    customerPhone: string;
    customerEmail: string;
  }): Promise<{ paymentUrl: string }> {
    const backendUrl = this.config.get<string>('BACKEND_URL', 'https://aerocab-api.onrender.com');
    const appScheme = 'aerogo24-passenger';

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
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.secretKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      this.logger.error('Flutterwave initiate error', text);
      throw new Error('Erreur initialisation paiement Flutterwave');
    }

    const data = await res.json() as any;
    if (data.status !== 'success') {
      throw new Error(data.message || 'Erreur Flutterwave');
    }

    return { paymentUrl: data.data.link };
  }

  /** Vérifie l'authenticité du webhook via hmac-sha256 */
  verifyWebhookSignature(rawBody: string, signature: string): boolean {
    const hash = crypto
      .createHmac('sha256', this.secretKey)
      .update(rawBody)
      .digest('hex');
    return hash === signature;
  }

  /** Vérifie une transaction par son ID Flutterwave */
  async verify(flwTransactionId: string): Promise<'ACCEPTED' | 'REFUSED' | 'PENDING'> {
    const res = await fetch(`${FLW_BASE}/transactions/${flwTransactionId}/verify`, {
      headers: { 'Authorization': `Bearer ${this.secretKey}` },
    });

    const data = await res.json() as any;
    const status = data.data?.status as string | undefined;

    if (status === 'successful') return 'ACCEPTED';
    if (['failed', 'cancelled', 'error'].includes(status ?? '')) return 'REFUSED';
    return 'PENDING';
  }
}
