export type Granularity = 'range' | 'monthly';
export type InsightLevel = 'good' | 'info' | 'warn';

export interface Insight { type: string; level: InsightLevel; text: string; }

export interface CountryRevenue {
  country: string;          // code pays ou 'UNKNOWN'
  currency: string;
  platform: { registration: number; accessPass: number; total: number };
  rides: { commission: number; total: number };
  grandLocal: number;       // platform.total + rides.total (devise locale)
  grandBase: number;        // grandLocal converti en baseCurrency
}

export interface DeltaMetric { current: number; previous: number; deltaPct: number | null; }

export interface RevenueResponse {
  period: { from: string; to: string; granularity: Granularity };
  baseCurrency: string;
  byCountry: CountryRevenue[];
  consolidated: { baseCurrency: string; platform: number; rides: number; total: number };
  timeseries: { month: string; platform: number; rides: number }[];
  comparison: { platform: DeltaMetric; rides: DeltaMetric; total: DeltaMetric };
  insights: Insight[];
}

export interface RawCountryAgg {
  country: string;
  currency: string;
  registration: number;
  accessPass: number;
  commission: number;
}
