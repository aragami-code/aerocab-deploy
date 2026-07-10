// src/loyalty/loyalty.service.ts
import { Injectable } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';
import { PointsService } from '../points/points.service';
import { UsersService } from '../users/users.service';
import {
  TierKey, TierMatrix, ServiceKey,
  DEFAULT_TIER_MATRIX, DEFAULT_UPGRADE_COSTS, DEFAULT_TOP_RATED_MIN_RATING,
  SETTING_TIER_MATRIX, SETTING_UPGRADE_COSTS, SETTING_TOP_RATED_MIN_RATING, TIER_ORDER, ALL_SERVICES,
} from './loyalty.constants';

export interface CategoryAvailability { key: string; unlocked: boolean; cost: number; }
export interface ServiceAvailability { key: ServiceKey; included: boolean; cost: number; }
export interface LoyaltyOptions {
  tier: TierKey; balance: number;
  categories: CategoryAvailability[]; services: ServiceAvailability[];
  meetGreetFee: number;
}

@Injectable()
export class LoyaltyService {
  constructor(
    private readonly settings: SettingsService,
    private readonly points: PointsService,
    private readonly users: UsersService,
  ) {}

  private async matrix(country: string | null): Promise<TierMatrix> {
    const raw = await this.settings.getForCountry(SETTING_TIER_MATRIX, country, '');
    if (!raw) return DEFAULT_TIER_MATRIX;
    try { return { ...DEFAULT_TIER_MATRIX, ...JSON.parse(raw) }; } catch { return DEFAULT_TIER_MATRIX; }
  }

  private async costs(country: string | null): Promise<Record<string, number>> {
    const raw = await this.settings.getForCountry(SETTING_UPGRADE_COSTS, country, '');
    if (!raw) return DEFAULT_UPGRADE_COSTS;
    try { return { ...DEFAULT_UPGRADE_COSTS, ...JSON.parse(raw) }; } catch { return DEFAULT_UPGRADE_COSTS; }
  }

  async costOf(perk: string, country: string | null): Promise<number> {
    return (await this.costs(country))[perk] ?? 0;
  }

  async topRatedMinRating(country: string | null): Promise<number> {
    const raw = await this.settings.getForCountry(SETTING_TOP_RATED_MIN_RATING, country, String(DEFAULT_TOP_RATED_MIN_RATING));
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n : DEFAULT_TOP_RATED_MIN_RATING;
  }

  // `_vehicleType` est conservé dans la signature pour le contexte appelant (l'endpoint
  // est par véhicule) et une éventuelle restriction future ; en v1 les catégories
  // proposées sont toutes celles tarifées pour le pays.
  async resolveAvailability(tier: TierKey, country: string | null, _vehicleType: string) {
    const [m, c, tariffs] = await Promise.all([
      this.matrix(country), this.costs(country), this.settings.getTariffsByCountry(country),
    ]);
    // Garde : une matrice surchargée en base peut ne pas couvrir tous les tiers.
    const entry = m[tier] ?? DEFAULT_TIER_MATRIX[tier] ?? { categories: [], services: [] };
    const unlockedCats = new Set(entry.categories);
    const allCats = Object.keys(tariffs.vehicles ?? {});
    const categories: CategoryAvailability[] = allCats.map((key) => ({
      key,
      unlocked: unlockedCats.has(key),
      cost: unlockedCats.has(key) ? 0 : (c[`category:${key}`] ?? 0),
    }));
    const includedServices = new Set(entry.services);
    const services: ServiceAvailability[] = ALL_SERVICES.map((key) => ({
      key, included: includedServices.has(key), cost: includedServices.has(key) ? 0 : (c[key] ?? 0),
    }));
    return { categories, services };
  }

  /**
   * Tier appliqué au dispatch : si le passager a acheté `priority` (perk de pool),
   * on l'élève au plus bas tier dont la matrice inclut `priority`. Les autres perks
   * (top_rated, guaranteed, category:*) ne changent pas le pool.
   */
  async effectiveTier(realTier: TierKey, perks: string[], country: string | null): Promise<TierKey> {
    if (!perks.includes('priority')) return realTier;
    const m = await this.matrix(country);
    const firstWithPriority = TIER_ORDER.find((t) => m[t].services.includes('priority')) ?? realTier;
    const idx = Math.max(TIER_ORDER.indexOf(realTier), TIER_ORDER.indexOf(firstWithPriority));
    return TIER_ORDER[idx];
  }

  /**
   * Lot 2 — Annulation flexible.
   * Retourne true si le service est actif pour ce passager : soit acheté comme perk individuel,
   * soit inclus par son niveau (via la matrice cascade pays→global).
   */
  async isServiceActive(perks: string[], tier: TierKey, country: string | null, service: ServiceKey): Promise<boolean> {
    if (perks.includes(service)) return true;
    const avail = await this.resolveAvailability(tier, country, 'standard');
    return avail.services.find((s) => s.key === service)?.included ?? false;
  }

  async getOptions(userId: string, vehicleType: string, country: string | null): Promise<LoyaltyOptions> {
    const tier = await this.users.getPassengerTier(userId);
    const [{ balance }, avail, meetGreetFeeRaw] = await Promise.all([
      this.points.getBalance(userId),
      this.resolveAvailability(tier, country, vehicleType),
      this.settings.getForCountry('meet_greet_fee', country, '0'),
    ]);
    return {
      tier, balance, categories: avail.categories, services: avail.services,
      meetGreetFee: parseInt(meetGreetFeeRaw, 10) || 0,
    };
  }
}
