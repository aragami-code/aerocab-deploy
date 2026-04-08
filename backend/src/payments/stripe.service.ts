import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

const STRIPE_BASE = 'https://api.stripe.com/v1';

/** Encode un objet en application/x-www-form-urlencoded (API Stripe) */
function encodeStripe(obj: Record<string, any>, prefix = ''): string {
  return Object.entries(obj)
    .map(([k, v]) => {
      const key = prefix ? `${prefix}[${k}]` : k;
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
        return encodeStripe(v, key);
      }
      return `${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`;
    })
    .join('&');
}

@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);

  constructor(private config: ConfigService) {}

  private get secretKey(): string {
    return this.config.get<string>('STRIPE_SECRET_KEY', '');
  }

  private get webhookSecret(): string {
    return this.config.get<string>('STRIPE_WEBHOOK_SECRET', '');
  }

  /**
   * Crée une Stripe Checkout Session.
   * Retourne { paymentUrl } — ouvert dans WebBrowser côté app.
   */
  async initiate(params: {
    transactionId: string;
    amountCents: number;   // montant en centimes (ex: 500 FCFA = 50000 XOF centimes pas standard → utiliser USD/EUR)
    currency: string;       // 'eur', 'usd', 'gbp' (en minuscules)
    description: string;
    customerEmail: string;
  }): Promise<{ paymentUrl: string; sessionId: string }> {
    const appScheme = 'aerogo24-passenger';
    const backendUrl = this.config.get<string>('BACKEND_URL', 'https://aerocab-api.onrender.com');

    const body = encodeStripe({
      mode: 'payment',
      'line_items[0][price_data][currency]': params.currency,
      'line_items[0][price_data][unit_amount]': params.amountCents,
      'line_items[0][price_data][product_data][name]': params.description,
      'line_items[0][quantity]': 1,
      success_url: `${appScheme}://payment/return?ref=${encodeURIComponent(params.transactionId)}&type=wallet&status=success`,
      cancel_url:  `${appScheme}://payment/return?ref=${encodeURIComponent(params.transactionId)}&type=wallet&status=cancel`,
      'customer_email': params.customerEmail || undefined,
      'metadata[transaction_id]': params.transactionId,
      'payment_method_types[0]': 'card',
    });

    const res = await fetch(`${STRIPE_BASE}/checkout/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Bearer ${this.secretKey}`,
      },
      body,
    });

    if (!res.ok) {
      const text = await res.text();
      this.logger.error('Stripe initiate error', text);
      throw new Error('Erreur initialisation paiement Stripe');
    }

    const data = await res.json() as any;
    return { paymentUrl: data.url, sessionId: data.id };
  }

  /** Vérifie la signature d'un webhook Stripe */
  verifyWebhookSignature(rawBody: string | Buffer, signature: string): boolean {
    try {
      const parts = signature.split(',').reduce<Record<string, string>>((acc, part) => {
        const [k, v] = part.split('=');
        acc[k] = v;
        return acc;
      }, {});
      const timestamp = parts['t'];
      const sigHash   = parts['v1'];
      const payload   = `${timestamp}.${rawBody}`;
      const expected  = crypto
        .createHmac('sha256', this.webhookSecret)
        .update(payload)
        .digest('hex');
      return expected === sigHash;
    } catch {
      return false;
    }
  }

  /** Récupère une Checkout Session par son ID pour vérifier le statut */
  async getSessionStatus(sessionId: string): Promise<'ACCEPTED' | 'REFUSED' | 'PENDING'> {
    const res = await fetch(`${STRIPE_BASE}/checkout/sessions/${sessionId}`, {
      headers: { 'Authorization': `Bearer ${this.secretKey}` },
    });
    const data = await res.json() as any;
    if (data.payment_status === 'paid') return 'ACCEPTED';
    if (data.status === 'expired') return 'REFUSED';
    return 'PENDING';
  }
}
