import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../redis/redis.service';

const CONFIG_CACHE_KEY = 'config:cache';

export interface VehicleTariff {
  basePricePerKm: number;
  minFare: number;
  coefficient: number;
  label?: string;       // Nom affiché (ex: "Berline Confort")
  isActive?: boolean;   // false = masqué dans l'app passager
  maxPassengers?: number; // Capacité max (optionnel)
  commissionRate?: number; // 0.0–1.0 ; si absent → taux global (commission_rate setting)
}

export interface ReferralBonus {
  onSignup: number;      // Points offerts au parrain quand le filleul crée son compte
  onFirstRide: number;   // Points offerts au parrain à la 1ère course du filleul
  newUserBonus: number;  // Points offerts au nouvel utilisateur à l'inscription
}

export interface TariffsConfig {
  basePricePerKm: number;
  fcfaPerPoint: number;      // Ancien champ — conservé pour compatibilité
  startupFee: number;
  startupMinutes: number;
  pricePerMinute: number;
  currency?: string;
  currencySymbol?: string;
  vehicles: Record<string, VehicleTariff>;

  // ── Système de points ─────────────────────────────────────────────────────
  pointValue: number;         // Valeur d'1 point en monnaie locale (ex: 1 FCFA, 0.01 EUR)
  pointRechargeRate: number;  // 1 unité de monnaie locale = X points crédités (recharge)
  cashbackRate: number;       // % du prix de la course crédité en points après trajet (0.05 = 5%)
  commissionRate: number;     // % prélevé par la plateforme sur le prix de la course (0.15 = 15%)
  referralBonus: ReferralBonus;
}

export const DEFAULT_TARIFFS: TariffsConfig = {
  basePricePerKm: 250,
  fcfaPerPoint: 1,
  startupFee: 500,           // 500 FCFA de frais fixes à chaque prise en charge
  startupMinutes: 3,         // 3 premières minutes incluses dans le startupFee
  pricePerMinute: 50,        // 50 FCFA/min au-delà

  // ── Système de points (défauts Cameroun) ──────────────────────────────────
  pointValue: 1,             // 1 pt = 1 FCFA
  pointRechargeRate: 1,      // 1 FCFA versé = 1 pt crédité
  cashbackRate: 0.05,        // 5 % du prix de la course remboursé en points
  commissionRate: 0.15,      // 15 % prélevé par la plateforme (chauffeur reçoit 85%)
  referralBonus: {
    onSignup: 500,           // pts offerts au parrain à l'inscription du filleul
    onFirstRide: 1000,       // pts offerts au parrain à la 1re course du filleul
    newUserBonus: 300,       // pts offerts au nouvel utilisateur à l'inscription
  },

  vehicles: {
    eco:          { basePricePerKm: 250, minFare: 3000,  coefficient: 1.0, label: 'Eco',          isActive: true, maxPassengers: 4 },
    eco_plus:     { basePricePerKm: 250, minFare: 3500,  coefficient: 1.2, label: 'Eco+',         isActive: true, maxPassengers: 4 },
    standard:     { basePricePerKm: 250, minFare: 5000,  coefficient: 1.4, label: 'Standard',     isActive: true, maxPassengers: 5 },
    confort:      { basePricePerKm: 250, minFare: 8000,  coefficient: 2.0, label: 'Confort',      isActive: true, maxPassengers: 5 },
    confort_plus: { basePricePerKm: 250, minFare: 12000, coefficient: 2.5, label: 'Confort Plus', isActive: true, maxPassengers: 7 },
  },
};

@Injectable()
export class SettingsService {
  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
  ) {}

  async get(key: string, defaultValue = ''): Promise<string> {
    const setting = await this.prisma.appSetting.findUnique({ where: { key } });
    return setting?.value ?? defaultValue;
  }

  /**
   * Résolution en cascade d'un réglage par pays :
   *   app_settings["key:PAYS"] → app_settings["key"] → defaultValue
   * countryCode null/absent → comportement global pur.
   */
  async getForCountry(key: string, countryCode: string | null | undefined, defaultValue = ''): Promise<string> {
    if (countryCode) {
      const scoped = await this.get(`${key}:${countryCode.toUpperCase()}`, ' ');
      if (scoped !== ' ') return scoped;
    }
    return this.get(key, defaultValue);
  }

  async set(key: string, value: string): Promise<void> {
    await this.prisma.appSetting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
    // 0.B1 — Invalider le cache /config activement
    await this.redis.del(CONFIG_CACHE_KEY);
  }

  async getDataRetentionMonths(): Promise<number> {
    const val = await this.get('data_retention_months', '12');
    const parsed = parseInt(val, 10);
    return isNaN(parsed) || parsed < 1 ? 12 : parsed;
  }

  async setDataRetentionMonths(months: number): Promise<void> {
    await this.set('data_retention_months', String(Math.max(1, months)));
  }

  async isProximityAssignmentEnabled(): Promise<boolean> {
    const val = await this.get('proximity_assignment_enabled', 'false');
    return val === 'true';
  }

  async setProximityAssignment(enabled: boolean): Promise<void> {
    await this.set('proximity_assignment_enabled', String(enabled));
  }

  async getAll(): Promise<Record<string, string>> {
    const rows = await this.prisma.appSetting.findMany();
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  /** Retourne la config des tarifs globaux (DB avec fallback sur les défauts) */
  async getTariffs(): Promise<TariffsConfig> {
    return this.getTariffsByCountry(null);
  }

  /** Retourne les tarifs pour un pays donné (fallback global → défauts) */
  async getTariffsByCountry(countryCode: string | null): Promise<TariffsConfig> {
    // 1. Cherche tarifs spécifiques au pays
    if (countryCode) {
      const raw = await this.get(`tariffs_config:${countryCode.toUpperCase()}`, '');
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as TariffsConfig;
          return this.mergeTariffs(parsed);
        } catch { /* fallback */ }
      }
    }
    // 2. Fallback : tarifs globaux
    const raw = await this.get('tariffs_config', '');
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as TariffsConfig;
        return this.mergeTariffs(parsed);
      } catch { /* fallback */ }
    }
    // 3. Défauts hardcodés
    return DEFAULT_TARIFFS;
  }

  /**
   * Vérifie si un pays est supporté (config tarifaire définie en DB).
   * CM (Cameroun) est toujours supporté car c'est le pays par défaut.
   * null = pas de pays détecté → on laisse passer sans bloquer.
   */
  async isCountrySupported(countryCode: string | null): Promise<boolean> {
    if (!countryCode) return true;
    const upper = countryCode.toUpperCase();
    if (upper === 'CM') return true; // pays par défaut, toujours supporté
    const raw = await this.get(`tariffs_config:${upper}`, '');
    return !!raw;
  }

  private mergeTariffs(parsed: Partial<TariffsConfig>): TariffsConfig {
    return {
      ...DEFAULT_TARIFFS,
      ...parsed,
      vehicles:      { ...DEFAULT_TARIFFS.vehicles,      ...(parsed.vehicles      ?? {}) },
      referralBonus: { ...DEFAULT_TARIFFS.referralBonus, ...(parsed.referralBonus ?? {}) },
    };
  }

  /** Sauvegarde la config des tarifs globaux */
  async setTariffs(config: TariffsConfig): Promise<void> {
    await this.set('tariffs_config', JSON.stringify(config));
  }

  /** Sauvegarde les tarifs pour un pays donné */
  async setTariffsByCountry(countryCode: string, config: TariffsConfig): Promise<void> {
    await this.set(`tariffs_config:${countryCode.toUpperCase()}`, JSON.stringify(config));
  }

  /** Supprime les tarifs spécifiques d'un pays (retour au global) */
  async deleteTariffsByCountry(countryCode: string): Promise<void> {
    await this.prisma.appSetting.deleteMany({
      where: { key: `tariffs_config:${countryCode.toUpperCase()}` },
    });
  }

  /** Liste tous les pays ayant une config tarifaire spécifique */
  async getCountriesWithTariffs(): Promise<string[]> {
    const rows = await this.prisma.appSetting.findMany({
      where: { key: { startsWith: 'tariffs_config:' } },
    });
    return rows.map(r => r.key.replace('tariffs_config:', ''));
  }

  /** Retourne le taux FCFA par point */
  async getFcfaPerPoint(countryCode?: string): Promise<number> {
    const tariffs = await this.getTariffsByCountry(countryCode ?? null);
    return tariffs.fcfaPerPoint;
  }
}
