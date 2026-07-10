// src/loyalty/loyalty.constants.ts
export type TierKey = 'bronze' | 'silver' | 'gold' | 'platinum';
export type ServiceKey = 'priority' | 'top_rated' | 'guaranteed' | 'flex_cancel' | 'scheduled';
export type PerkKey = `category:${string}` | ServiceKey;

export interface TierEntry { categories: string[]; services: ServiceKey[]; }
export type TierMatrix = Record<TierKey, TierEntry>;

export const TIER_ORDER: TierKey[] = ['bronze', 'silver', 'gold', 'platinum'];

export const ALL_SERVICES: ServiceKey[] = ['priority', 'top_rated', 'guaranteed', 'flex_cancel', 'scheduled'];

export const DEFAULT_TIER_MATRIX: TierMatrix = {
  bronze:   { categories: ['eco', 'standard'],                                      services: [] },
  silver:   { categories: ['eco', 'standard', 'eco_plus'],                          services: ['scheduled'] },
  gold:     { categories: ['eco', 'standard', 'eco_plus', 'confort'],               services: ['priority', 'scheduled'] },
  platinum: { categories: ['eco', 'standard', 'eco_plus', 'confort', 'confort_plus'], services: ['priority', 'top_rated', 'guaranteed', 'flex_cancel', 'scheduled'] },
};

export const DEFAULT_UPGRADE_COSTS: Record<string, number> = {
  'category:confort': 120,
  'category:confort_plus': 200,
  priority: 50,
  top_rated: 150,
  guaranteed: 200,
  flex_cancel: 75,
  scheduled: 100,
};

export const DEFAULT_TOP_RATED_MIN_RATING = 4.8;

export const SETTING_TIER_MATRIX = 'tier_matrix';
export const SETTING_UPGRADE_COSTS = 'upgrade_costs';
export const SETTING_TOP_RATED_MIN_RATING = 'top_rated_min_rating';
