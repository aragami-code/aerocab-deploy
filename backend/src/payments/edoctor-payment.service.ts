import { Injectable, Logger } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';
import { RedisService } from '../redis/redis.service';

const REDIS_TOKEN_KEY = 'edoctor:jwt:token';
const TOKEN_TTL_SEC   = 25 * 60; // 25 min (tokens Django JWT valides ~30 min)

export type EdoctorStatus = 'pending' | 'success' | 'failed' | 'cancelled';

export interface EdoctorPayment {
  id: string;
  status: EdoctorStatus;
  amount: string;
  reference?: string;
}

@Injectable()
export class EdoctorPaymentService {
  private readonly logger = new Logger(EdoctorPaymentService.name);

  constructor(
    private settings: SettingsService,
    private redis: RedisService,
  ) {}

  // ── Credentials ──────────────────────────────────────────────────────────────

  private async getBaseUrl(): Promise<string> {
    const raw = await this.settings.get('payment_edoctor_url', '');
    return (raw || '').replace(/\/$/, '');
  }

  private async cred(key: string): Promise<string> {
    return (await this.settings.get(key, '')).trim();
  }

  async isConfigured(): Promise<boolean> {
    const [url, email, pwd] = await Promise.all([
      this.cred('payment_edoctor_url'),
      this.cred('payment_edoctor_email'),
      this.cred('payment_edoctor_password'),
    ]);
    return !!(url && email && pwd);
  }

  // ── Auth (JWT avec cache Redis) ──────────────────────────────────────────────

  async getToken(): Promise<string> {
    const cached = await this.redis.get(REDIS_TOKEN_KEY);
    if (cached) return cached;

    const [baseUrl, email, password] = await Promise.all([
      this.getBaseUrl(),
      this.cred('payment_edoctor_email'),
      this.cred('payment_edoctor_password'),
    ]);

    if (!baseUrl || !email || !password) {
      throw new Error('EdoctorPay: credentials non configurés');
    }

    const res = await fetch(`${baseUrl}/api-v1/token/`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email, password }),
    });

    if (!res.ok) {
      const txt = await res.text();
      this.logger.error(`EdoctorPay auth error ${res.status}: ${txt}`);
      throw new Error('EdoctorPay: authentification échouée');
    }

    const data = await res.json() as { access?: string; token?: string };
    const token = data.access ?? data.token ?? '';
    if (!token) throw new Error('EdoctorPay: token absent de la réponse');

    await this.redis.set(REDIS_TOKEN_KEY, token, TOKEN_TTL_SEC);
    return token;
  }

  private async authHeaders(): Promise<Record<string, string>> {
    const token = await this.getToken();
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  }

  // ── Collecte (paiement passager) ─────────────────────────────────────────────

  async collect(params: {
    amount: number;
    phone: string;
    reference: string;
    currency?: string;
    description?: string;
    metadata?: Record<string, unknown>;
  }): Promise<EdoctorPayment> {
    const baseUrl = await this.getBaseUrl();
    const headers = await this.authHeaders();

    const body = {
      module_origin:      'aerocab_ride',
      amount:             String(Math.round(params.amount)),
      external_user_phone: params.phone,
      reference:          params.reference,
      description:        params.description ?? 'Course AeroCab',
      currency:           params.currency ?? 'XAF',
      metadata:           params.metadata ?? {},
    };

    const res = await fetch(`${baseUrl}/api-v1/paiement/`, {
      method:  'POST',
      headers,
      body:    JSON.stringify(body),
    });

    if (!res.ok) {
      const txt = await res.text();
      this.logger.error(`EdoctorPay collect error ${res.status}: ${txt}`);
      throw new Error(`EdoctorPay: erreur initiation paiement (${res.status})`);
    }

    const data = await res.json() as any;
    return {
      id:        String(data.id ?? data.uuid ?? ''),
      status:    this.mapStatus(data.status),
      amount:    String(data.amount ?? params.amount),
      reference: String(data.reference ?? params.reference),
    };
  }

  // ── Vérification statut ───────────────────────────────────────────────────────

  async checkStatus(paymentId: string): Promise<EdoctorStatus> {
    const baseUrl = await this.getBaseUrl();
    const headers = await this.authHeaders();

    const res = await fetch(`${baseUrl}/api-v1/paiement/${encodeURIComponent(paymentId)}/`, { headers });
    if (!res.ok) {
      this.logger.warn(`EdoctorPay checkStatus ${paymentId}: HTTP ${res.status}`);
      return 'pending';
    }

    const data = await res.json() as any;
    return this.mapStatus(data.status);
  }

  // ── Retrait chauffeur ─────────────────────────────────────────────────────────

  async withdrawMtn(params: { amount: number; phone: string; reference?: string }): Promise<{ id: string; status: string }> {
    return this.withdraw('mtn-withdraw', params);
  }

  async withdrawOrange(params: { amount: number; phone: string; reference?: string }): Promise<{ id: string; status: string }> {
    return this.withdraw('orange-withdraw', params);
  }

  private async withdraw(
    endpoint: 'mtn-withdraw' | 'orange-withdraw',
    params: { amount: number; phone: string; reference?: string },
  ): Promise<{ id: string; status: string }> {
    const baseUrl = await this.getBaseUrl();
    const headers = await this.authHeaders();

    const body = {
      amount:       String(Math.round(params.amount)),
      telephone:    params.phone,
      module_origin: 'aerocab_driver_payout',
      ...(params.reference ? { reference: params.reference } : {}),
    };

    const res = await fetch(`${baseUrl}/api-v1/paiement/${endpoint}/`, {
      method:  'POST',
      headers,
      body:    JSON.stringify(body),
    });

    if (!res.ok) {
      const txt = await res.text();
      this.logger.error(`EdoctorPay ${endpoint} error ${res.status}: ${txt}`);
      throw new Error(`EdoctorPay: erreur retrait (${res.status})`);
    }

    const data = await res.json() as any;
    return { id: String(data.id ?? ''), status: String(data.status ?? 'pending') };
  }

  // ── Test connexion (admin) ────────────────────────────────────────────────────

  async testConnection(): Promise<{ ok: boolean; message: string; providers?: any[] }> {
    try {
      // Invalider le cache pour forcer une nouvelle auth
      await this.redis.del(REDIS_TOKEN_KEY);
      await this.getToken();

      const baseUrl = await this.getBaseUrl();
      const headers = await this.authHeaders();
      const res = await fetch(`${baseUrl}/api-v1/provider/`, { headers });
      const providers: any[] = res.ok ? await res.json() as any[] : [];

      return { ok: true, message: 'Connexion réussie', providers };
    } catch (err: any) {
      return { ok: false, message: err.message ?? 'Connexion échouée' };
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  private mapStatus(raw: string): EdoctorStatus {
    const s = (raw ?? '').toLowerCase();
    if (s === 'success' || s === 'successful' || s === 'completed') return 'success';
    if (s === 'failed'  || s === 'failure'    || s === 'error')      return 'failed';
    if (s === 'cancelled' || s === 'canceled')                        return 'cancelled';
    return 'pending';
  }
}
