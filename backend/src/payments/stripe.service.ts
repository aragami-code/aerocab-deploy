import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SettingsService } from '../settings/settings.service';
import * as crypto from 'crypto';

const STRIPE_BASE = 'https://api.stripe.com/v1';

function encodeStripe(obj: Record<string, any>, prefix = ''): string {
  return Object.entries(obj)
    .map(([k, v]) => {
      const key = prefix ? `${prefix}[${k}]` : k;
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) return encodeStripe(v, key);
      return `${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`;
    })
    .join('&');
}

@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);

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
    amountCents: number;
    currency: string;
    description: string;
    customerEmail: string;
    country?: string;
  }): Promise<{ paymentUrl: string; sessionId: string }> {
    const secretKey  = await this.cred('payment_stripe_secret_key', 'STRIPE_SECRET_KEY', params.country ?? null);
    const appScheme  = 'aerogo24-passenger';
    const backendUrl = await this.settings.get('backend_url', this.config.get<string>('BACKEND_URL', 'https://aerocab-api.onrender.com'));

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
      'payment_method_types[1]': 'link',
    });

    const res = await fetch(`${STRIPE_BASE}/checkout/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/x-www-form-urlencoded',
        'Authorization': `Bearer ${secretKey}`,
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

  /** Retourne le webhook secret depuis DB ou env (pour le contrôleur) */
  async getWebhookSecret(): Promise<string> {
    return this.cred('payment_stripe_webhook_secret', 'STRIPE_WEBHOOK_SECRET');
  }

  verifyWebhookSignature(rawBody: string | Buffer, signature: string, webhookSecret: string): boolean {
    try {
      const parts = signature.split(',').reduce<Record<string, string>>((acc, part) => {
        const [k, v] = part.split('=');
        acc[k] = v;
        return acc;
      }, {});
      const timestamp = parts['t'];
      const sigHash   = parts['v1'];
      const payload   = `${timestamp}.${rawBody}`;
      const expected  = crypto.createHmac('sha256', webhookSecret).update(payload).digest('hex');
      return expected === sigHash;
    } catch {
      return false;
    }
  }

  async getSessionStatus(sessionId: string): Promise<'ACCEPTED' | 'REFUSED' | 'PENDING'> {
    const secretKey = await this.cred('payment_stripe_secret_key', 'STRIPE_SECRET_KEY');
    const res = await fetch(`${STRIPE_BASE}/checkout/sessions/${sessionId}`, {
      headers: { 'Authorization': `Bearer ${secretKey}` },
    });
    const data = await res.json() as any;
    if (data.payment_status === 'paid') return 'ACCEPTED';
    if (data.status === 'expired') return 'REFUSED';
    return 'PENDING';
  }

  // ── PaymentIntent (pré-autorisation manuelle pour les courses) ─────────────

  /**
   * Crée un PaymentIntent avec capture_method=manual.
   * La carte est bloquée mais pas débitée tant que capturePaymentIntent n'est pas appelé.
   * Retourne le client_secret à envoyer au SDK mobile Stripe.
   */
  async createPaymentIntent(params: {
    reference: string;
    amountCents: number;
    currency: string;
    description: string;
    customerEmail?: string;
    bookingId: string;
    backendUrl: string;
    country?: string;
  }): Promise<{ paymentIntentId: string; clientSecret: string }> {
    const secretKey = await this.cred('payment_stripe_secret_key', 'STRIPE_SECRET_KEY', params.country ?? null);
    if (!secretKey) throw new Error('Stripe: clé secrète non configurée');

    const body = encodeStripe({
      amount:         params.amountCents,
      currency:       params.currency,
      capture_method: 'manual',
      description:    params.description,
      'metadata[booking_id]':  params.bookingId,
      'metadata[reference]':   params.reference,
      'payment_method_types[0]': 'card',
    });

    const res = await fetch(`${STRIPE_BASE}/payment_intents`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/x-www-form-urlencoded',
        'Authorization': `Bearer ${secretKey}`,
      },
      body,
    });

    if (!res.ok) {
      const text = await res.text();
      this.logger.error('Stripe createPaymentIntent error', text);
      throw new Error('Erreur création PaymentIntent Stripe');
    }

    const data = await res.json() as any;
    return { paymentIntentId: data.id, clientSecret: data.client_secret };
  }

  /** Capture les fonds après confirmation manuelle (fin de course). */
  async capturePaymentIntent(paymentIntentId: string): Promise<void> {
    const secretKey = await this.cred('payment_stripe_secret_key', 'STRIPE_SECRET_KEY');
    const res = await fetch(`${STRIPE_BASE}/payment_intents/${paymentIntentId}/capture`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${secretKey}` },
    });
    if (!res.ok) {
      const text = await res.text();
      this.logger.error(`Stripe capture ${paymentIntentId} error`, text);
      throw new Error('Erreur capture Stripe PaymentIntent');
    }
  }

  /** Annule un PaymentIntent (voiding pré-auth ou annulation avant capture). */
  async cancelPaymentIntent(paymentIntentId: string): Promise<void> {
    const secretKey = await this.cred('payment_stripe_secret_key', 'STRIPE_SECRET_KEY');
    const res = await fetch(`${STRIPE_BASE}/payment_intents/${paymentIntentId}/cancel`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${secretKey}` },
    });
    if (!res.ok) {
      const text = await res.text();
      this.logger.warn(`Stripe cancel ${paymentIntentId}: ${text}`);
    }
  }

  /** Rembourse un PaymentIntent déjà capturé (annulation post-capture). */
  async refundPaymentIntent(paymentIntentId: string, amountCents?: number): Promise<void> {
    const secretKey = await this.cred('payment_stripe_secret_key', 'STRIPE_SECRET_KEY');
    const body = amountCents
      ? encodeStripe({ payment_intent: paymentIntentId, amount: amountCents })
      : encodeStripe({ payment_intent: paymentIntentId });

    const res = await fetch(`${STRIPE_BASE}/refunds`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/x-www-form-urlencoded',
        'Authorization': `Bearer ${secretKey}`,
      },
      body,
    });
    if (!res.ok) {
      const text = await res.text();
      this.logger.error(`Stripe refund ${paymentIntentId} error`, text);
      throw new Error('Erreur remboursement Stripe');
    }
  }

  /** Vérifie le statut d'un PaymentIntent. */
  async getPaymentIntentStatus(paymentIntentId: string): Promise<'requires_capture' | 'succeeded' | 'canceled' | string> {
    const secretKey = await this.cred('payment_stripe_secret_key', 'STRIPE_SECRET_KEY');
    const res = await fetch(`${STRIPE_BASE}/payment_intents/${paymentIntentId}`, {
      headers: { 'Authorization': `Bearer ${secretKey}` },
    });
    const data = await res.json() as any;
    return data.status ?? 'unknown';
  }
}
