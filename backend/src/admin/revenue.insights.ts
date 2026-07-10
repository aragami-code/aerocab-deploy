import { CountryRevenue, DeltaMetric, Insight } from './revenue.types';

/** Variation % de cur vs prev. null si prev == 0. */
export function pctDelta(cur: number, prev: number): number | null {
  if (prev === 0) return null;
  return ((cur - prev) / prev) * 100;
}

const GROWTH_WARN_PCT = -10;

function growthInsight(type: string, label: string, m: DeltaMetric): Insight {
  if (m.deltaPct === null) return { type, level: 'info', text: `${label} : pas de période de comparaison.` };
  const sign = m.deltaPct >= 0 ? '+' : '';
  const level: Insight['level'] = m.deltaPct >= 0 ? 'good' : (m.deltaPct < GROWTH_WARN_PCT ? 'warn' : 'info');
  return { type, level, text: `${label} ${sign}${m.deltaPct.toFixed(0)}% vs période précédente.` };
}

export function buildInsights(
  byCountry: CountryRevenue[],
  comparison: { platform: DeltaMetric; rides: DeltaMetric; total: DeltaMetric },
  totalBase: number,
): Insight[] {
  const out: Insight[] = [];

  if (byCountry.length > 0 && totalBase > 0) {
    const top = [...byCountry].sort((a, b) => b.grandBase - a.grandBase)[0];
    const pct = (top.grandBase / totalBase) * 100;
    out.push({ type: 'concentration', level: 'info', text: `${top.country} représente ${pct.toFixed(0)}% du revenu total.` });
  }

  out.push(growthInsight('growth_platform', 'Revenu plateforme', comparison.platform));
  out.push(growthInsight('growth_rides', 'Revenu courses', comparison.rides));

  if (totalBase > 0) {
    const platBase = byCountry.reduce((s, c) => s + (c.platform.total / (c.grandLocal || 1)) * c.grandBase, 0);
    const mixPct = (platBase / totalBase) * 100;
    out.push({ type: 'mix', level: 'info', text: `Mix : ${mixPct.toFixed(0)}% plateforme / ${(100 - mixPct).toFixed(0)}% courses.` });
  }

  return out;
}
