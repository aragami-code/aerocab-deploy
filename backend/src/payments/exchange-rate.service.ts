import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import { SettingsService } from '../settings/settings.service';

const FALLBACK_RATES: Record<string, number> = {
  XAF: 1,
  USD: 606.45,
  EUR: 655.96,
  GBP: 769.23,
  CAD: 446.43,
  CHF: 656.56,
  NGN: 0.40,
  GHS: 50.0,
  MAD: 60.40,
  EGP: 12.13,
  KES: 7.53,
  DZD: 4.46,
  CNY: 83.56,
  GNF: 0.07,
  XOF: 1.0,
};

// Devise de référence de la plateforme
const BASE_CURRENCY = 'XAF';
const CACHE_PREFIX  = 'exchange_rate:';

@Injectable()
export class ExchangeRateService {
  private readonly logger = new Logger(ExchangeRateService.name);

  constructor(
    private redis: RedisService,
    private settings: SettingsService,
  ) {}

  // Retourne combien de `to` vaut 1 `from`
  async getRate(from: string, to: string): Promise<number> {
    if (from === to) return 1;

    const cacheKey = `${CACHE_PREFIX}${from}_${to}`;
    const cached   = await this.redis.get(cacheKey);
    if (cached) return parseFloat(cached);

    try {
      const rate = await this.fetchFromApi(from, to);
      const ttlMin = parseInt(await this.settings.get('exchange_rate_cache_ttl_min', '60'));
      await this.redis.set(cacheKey, String(rate), ttlMin * 60);
      await this.alertIfNeeded(from, to, rate);
      return rate;
    } catch (err) {
      this.logger.warn(`Exchange rate API failed (${from}→${to}), using fallback`);
      return this.getFallbackRate(from, to);
    }
  }

  // Convertit un montant de `from` vers `to`
  async convert(amount: number, from: string, to: string): Promise<number> {
    const rate = await this.getRate(from, to);
    return Math.round(amount * rate * 100) / 100;
  }

  // Convertit vers XAF (devise plateforme)
  async toBase(amount: number, from: string): Promise<number> {
    return this.convert(amount, from, BASE_CURRENCY);
  }

  private async fetchFromApi(from: string, to: string): Promise<number> {
    // API gratuite exchangerate-api.com — remplacer par clé pro en production
    const res = await fetch(
      `https://open.er-api.com/v6/latest/${from}`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (!res.ok) throw new Error(`API HTTP ${res.status}`);
    const data = await res.json() as { rates: Record<string, number> };
    const rate  = data.rates?.[to];
    if (!rate) throw new Error(`Rate ${from}→${to} not found`);
    return rate;
  }

  private getFallbackRate(from: string, to: string): number {
    const fromXaf = FALLBACK_RATES[from] ?? 1;
    const toXaf   = FALLBACK_RATES[to]   ?? 1;
    // from → XAF → to
    return toXaf / fromXaf;
  }

  private async alertIfNeeded(from: string, to: string, newRate: number): Promise<void> {
    const alertPct  = parseFloat(await this.settings.get('exchange_rate_alert_pct', '5'));
    const prevKey   = `${CACHE_PREFIX}prev_${from}_${to}`;
    const prevRaw   = await this.redis.get(prevKey);
    if (prevRaw) {
      const prev   = parseFloat(prevRaw);
      const change = Math.abs((newRate - prev) / prev) * 100;
      if (change >= alertPct) {
        this.logger.warn(`Taux ${from}→${to} a varié de ${change.toFixed(1)}% (${prev}→${newRate})`);
      }
    }
    await this.redis.set(prevKey, String(newRate), 86400);
  }
}
