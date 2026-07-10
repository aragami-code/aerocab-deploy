import { pctDelta, buildInsights } from './revenue.insights';
import { CountryRevenue, DeltaMetric } from './revenue.types';

const mk = (country: string, plat: number, rides: number): CountryRevenue => ({
  country, currency: 'XAF',
  platform: { registration: plat, accessPass: 0, total: plat },
  rides: { commission: rides, total: rides },
  grandLocal: plat + rides, grandBase: plat + rides,
});

describe('pctDelta', () => {
  it('calcule la variation %', () => { expect(pctDelta(110, 100)).toBeCloseTo(10); });
  it('previous=0 → null', () => { expect(pctDelta(50, 0)).toBeNull(); });
});

describe('buildInsights', () => {
  const cmp = (cur: number, prev: number): DeltaMetric => ({ current: cur, previous: prev, deltaPct: pctDelta(cur, prev) });

  it('concentration : pays dominant et sa part', () => {
    const rows = [mk('CM', 80, 240), mk('SN', 10, 30)];
    const out = buildInsights(rows, { platform: cmp(90,90), rides: cmp(270,270), total: cmp(360,360) }, 360);
    const conc = out.find(i => i.type === 'concentration');
    expect(conc).toBeDefined();
    expect(conc!.text).toMatch(/CM/);
    expect(conc!.text).toMatch(/8[89]/);
  });

  it('croissance plateforme positive → good', () => {
    const rows = [mk('CM', 120, 300)];
    const out = buildInsights(rows, { platform: cmp(120,100), rides: cmp(300,300), total: cmp(420,400) }, 420);
    const g = out.find(i => i.type === 'growth_platform');
    expect(g?.level).toBe('good');
  });

  it('baisse courses >10% → warn', () => {
    const rows = [mk('CM', 100, 250)];
    const out = buildInsights(rows, { platform: cmp(100,100), rides: cmp(250,300), total: cmp(350,400) }, 350);
    const w = out.find(i => i.type === 'growth_rides');
    expect(w?.level).toBe('warn');
  });
});
