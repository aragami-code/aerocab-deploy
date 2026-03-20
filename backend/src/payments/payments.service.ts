import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const CINETPAY_URL = 'https://api-checkout.cinetpay.com/v2/payment';
const CINETPAY_CHECK_URL = 'https://api-checkout.cinetpay.com/v2/payment/check';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(private config: ConfigService) {}

  async initiate(params: {
    transactionId: string;
    amount: number;
    description: string;
    customerName: string;
    customerPhone: string;
    channels?: 'MOBILE_MONEY' | 'CREDIT_CARD' | 'ALL';
    returnPath?: string;
  }): Promise<{ paymentUrl: string }> {
    const apiKey = this.config.get<string>('CINETPAY_API_KEY');
    const siteId = this.config.get<string>('CINETPAY_SITE_ID');
    const backendUrl = this.config.get<string>('BACKEND_URL', 'https://aerocab-api.onrender.com');
    const appScheme = 'landingride-passenger';

    const nameParts = (params.customerName || 'Client AeroCab').trim().split(' ');
    const surname = nameParts[0] || 'Client';
    const name = nameParts.slice(1).join(' ') || 'AeroCab';

    const body = {
      apikey: apiKey,
      site_id: siteId,
      transaction_id: params.transactionId,
      amount: params.amount,
      currency: 'XAF',
      description: params.description,
      notify_url: `${backendUrl}/api/payments/webhook`,
      return_url: `${appScheme}://payment/return?ref=${encodeURIComponent(params.transactionId)}&type=${params.returnPath ?? 'payment'}`,
      customer_name: name,
      customer_surname: surname,
      customer_phone_number: params.customerPhone || '',
      channels: params.channels ?? 'MOBILE_MONEY',
    };

    const res = await fetch(CINETPAY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      this.logger.error('CinetPay initiate HTTP error', text);
      throw new Error('Erreur initialisation paiement CinetPay');
    }

    const data = await res.json() as any;
    if (data.code !== '201') {
      this.logger.error('CinetPay error response', JSON.stringify(data));
      throw new Error(data.message || 'Erreur CinetPay');
    }

    return { paymentUrl: data.data.payment_url };
  }

  // Remboursement — CinetPay Mobile Money Africa ne supporte pas les remboursements automatiques
  async refund(
    transactionId: string,
    amount: number,
  ): Promise<{ success: boolean; message: string }> {
    this.logger.warn(`Refund requested for transaction ${transactionId}, amount ${amount}`);
    // CinetPay ne supporte pas les remboursements via API pour Mobile Money (Afrique)
    return { success: false, message: 'Remboursement non disponible via CinetPay' };
  }

  // Vérifie le statut d'une transaction auprès de CinetPay
  async verify(transactionId: string): Promise<'ACCEPTED' | 'REFUSED' | 'PENDING'> {
    const apiKey = this.config.get<string>('CINETPAY_API_KEY');
    const siteId = this.config.get<string>('CINETPAY_SITE_ID');

    const res = await fetch(
      `${CINETPAY_CHECK_URL}?apikey=${apiKey}&site_id=${siteId}&transaction_id=${encodeURIComponent(transactionId)}`,
    );

    const data = await res.json() as any;
    const status = data.data?.status as string | undefined;

    if (status === 'ACCEPTED') return 'ACCEPTED';
    if (['REFUSED', 'FAILED', 'ANNULED'].includes(status ?? '')) return 'REFUSED';
    return 'PENDING';
  }
}
