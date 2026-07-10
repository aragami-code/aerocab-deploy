# Revenue Analytics — Lot 1 (Backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exposer `GET /admin/revenue` qui agrège le revenu plateforme (inscription + pass) et le revenu courses (commission) par pays, avec consolidation multi-devise, série temporelle mensuelle, comparaison à la période précédente et insights déterministes.

**Architecture :** Nouveau `RevenueService` (module admin) qui exécute des requêtes Prisma agrégées sur 3 sources, attribue chaque montant à un pays, consolide en devise de référence via `ExchangeRateService.toBase`, et produit des fonctions PURES testables (`buildInsights`, `buildTimeseries`, `aggregateByCountry`). Endpoint dans `admin.controller.ts` (`@RequirePermission('view_stats')`).

**Tech Stack :** NestJS + Prisma, Jest.

**Spec :** `docs/superpowers/specs/2026-06-05-revenue-analytics-design.md`.

**Working dir :** `/home/aragami/aerogo24V2/aerocab-deploy/backend` — branche `feat/config-par-pays`.

**Acquis :**
- `admin.controller.ts` : `@Controller('admin')`, `@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)`, `@Roles('admin')`, pattern `@Get('stats') @RequirePermission('view_stats')`. `admin.service.ts` injecté. Module `admin.module.ts`.
- `ExchangeRateService` (`src/payments/exchange-rate.service.ts`) : `BASE_CURRENCY='XAF'`, `toBase(amount, from): Promise<number>`, `getRate(from,to)`. Exporté par `PaymentsModule`.
- `DriverRegistrationPayment { driverProfileId, totalAmount, revenueAmount, depositAmount, status('pending'|'paid'|'failed'), createdAt }` ; relation `driverProfile.countryCode`.
- `Transaction { walletId, amount, type, status, reference, metadata(Json), createdAt }` ; pass d'accès = `metadata.type='access_pass'` ET `status='completed'` ; relation `wallet.user.countryCode`.
- `Booking { estimatedPrice, commissionRate(Float?), status, operatingCountry, updatedAt }`. Commission = `estimatedPrice × (commissionRate ?? défaut)`. Défaut = `getForCountry('commission_rate', operatingCountry, '0.15')`.
- `Country { code, currency }`.
- `SettingsService.getForCountry`.

**Convention git :** `git add <chemins exacts>` + commit bare. JAMAIS `-A`/`.`. Fichiers NEUFS (revenue.service, specs) → commit direct. `admin.controller.ts` / `admin.module.ts` : vérifier WIP (`git status`) → si WIP, safe-swap ; sinon direct.

---

## File Structure

- `src/admin/revenue.types.ts` — **Create** : types partagés (`RevenueResponse`, `CountryRevenue`, `Insight`, etc.)
- `src/admin/revenue.insights.ts` — **Create** : fonctions pures `buildInsights`, `buildTimeseries`, `pctDelta` + tests
- `src/admin/revenue.insights.spec.ts` — **Create**
- `src/admin/revenue.service.ts` — **Create** : agrégation Prisma + consolidation + orchestration
- `src/admin/admin.controller.ts` — **Modify** : `@Get('revenue')`
- `src/admin/admin.module.ts` — **Modify** : déclarer `RevenueService`, importer `PaymentsModule` (pour `ExchangeRateService`) si pas déjà

---

### Task 1 : Types partagés

**Files:** Create `src/admin/revenue.types.ts`

- [ ] **Step 1 : Définir les types**

`src/admin/revenue.types.ts` :
```typescript
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

// Agrégat brut par pays AVANT conversion (devise locale), une entrée par pays.
export interface RawCountryAgg {
  country: string;
  currency: string;
  registration: number;
  accessPass: number;
  commission: number;
}
```

- [ ] **Step 2 : Commit** (fichier neuf) → `git add src/admin/revenue.types.ts` → `feat(revenue): types reporting revenus`.

---

### Task 2 : Fonctions pures insights + timeseries (TDD)

**Files:** Create `src/admin/revenue.insights.ts`, `src/admin/revenue.insights.spec.ts`

- [ ] **Step 1 : Test (échec attendu)**

`src/admin/revenue.insights.spec.ts` :
```typescript
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
    const rows = [mk('CM', 80, 240), mk('SN', 10, 30)];   // CM = 320/360 ≈ 88.9%
    const out = buildInsights(rows, { platform: cmp(90,90), rides: cmp(270,270), total: cmp(360,360) }, 360);
    const conc = out.find(i => i.type === 'concentration');
    expect(conc).toBeDefined();
    expect(conc!.text).toMatch(/CM/);
    expect(conc!.text).toMatch(/8[89]/); // ~88-89%
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
```

- [ ] **Step 2 : Lancer (échec)** : `npx jest src/admin/revenue.insights.spec.ts` → FAIL (module introuvable).

- [ ] **Step 3 : Implémenter**

`src/admin/revenue.insights.ts` :
```typescript
import { CountryRevenue, DeltaMetric, Insight } from './revenue.types';

/** Variation % de cur vs prev. null si prev == 0 (pas de base de comparaison). */
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

/**
 * Insights déterministes : concentration pays, croissances (plateforme/courses/total),
 * mix plateforme/courses, top/bottom pays. Aucun appel externe, pure.
 */
export function buildInsights(
  byCountry: CountryRevenue[],
  comparison: { platform: DeltaMetric; rides: DeltaMetric; total: DeltaMetric },
  totalBase: number,
): Insight[] {
  const out: Insight[] = [];

  // Concentration : pays au plus gros grandBase
  if (byCountry.length > 0 && totalBase > 0) {
    const top = [...byCountry].sort((a, b) => b.grandBase - a.grandBase)[0];
    const pct = (top.grandBase / totalBase) * 100;
    out.push({ type: 'concentration', level: 'info', text: `${top.country} représente ${pct.toFixed(0)}% du revenu total.` });
  }

  // Croissances
  out.push(growthInsight('growth_platform', 'Revenu plateforme', comparison.platform));
  out.push(growthInsight('growth_rides', 'Revenu courses', comparison.rides));

  // Mix plateforme vs courses
  if (totalBase > 0) {
    const platBase = byCountry.reduce((s, c) => s + (c.platform.total / (c.grandLocal || 1)) * c.grandBase, 0);
    const mixPct = (platBase / totalBase) * 100;
    out.push({ type: 'mix', level: 'info', text: `Mix : ${mixPct.toFixed(0)}% plateforme / ${(100 - mixPct).toFixed(0)}% courses.` });
  }

  return out;
}
```
NOTE : le calcul du mix utilise la part plateforme de chaque pays pondérée en base — acceptable (approximation cohérente). Si l'implémenteur préfère, passer les totaux plateforme/courses consolidés directement en argument plutôt que recalculer (plus exact) — ADAPTER en ajoutant un param `consolidated` et l'utiliser ; garder les tests verts.

- [ ] **Step 4 : Lancer (succès)** : `npx jest src/admin/revenue.insights.spec.ts` → PASS.

- [ ] **Step 5 : Commit** → `git add src/admin/revenue.insights.ts src/admin/revenue.insights.spec.ts` → `feat(revenue): insights déterministes (TDD)`.

---

### Task 3 : RevenueService — agrégation + consolidation

**Files:** Create `src/admin/revenue.service.ts`

- [ ] **Step 1 : Implémenter le service**

READ `admin.service.ts` pour le style (injection `PrismaService`). READ `exchange-rate.service.ts` pour `toBase`. Créer :
```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { ExchangeRateService } from '../payments/exchange-rate.service';
import { buildInsights, pctDelta } from './revenue.insights';
import { Granularity, RevenueResponse, RawCountryAgg, CountryRevenue, DeltaMetric } from './revenue.types';

@Injectable()
export class RevenueService {
  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
    private fx: ExchangeRateService,
  ) {}

  /** Agrège les 3 sources sur [from,to) → map country → RawCountryAgg (devise locale). */
  private async aggregateRaw(from: Date, to: Date): Promise<Map<string, RawCountryAgg>> {
    const acc = new Map<string, RawCountryAgg>();
    const ensure = (country: string) => {
      const c = country || 'UNKNOWN';
      if (!acc.has(c)) acc.set(c, { country: c, currency: 'XAF', registration: 0, accessPass: 0, commission: 0 });
      return acc.get(c)!;
    };

    // 1. Inscription : revenueAmount, status=paid, pays via driverProfile.countryCode
    const regs = await this.prisma.driverRegistrationPayment.findMany({
      where: { status: 'paid', createdAt: { gte: from, lt: to } },
      select: { revenueAmount: true, driverProfile: { select: { countryCode: true } } },
    });
    for (const r of regs) ensure(r.driverProfile?.countryCode ?? 'UNKNOWN').registration += r.revenueAmount ?? 0;

    // 2. Pass d'accès : Transaction metadata.type='access_pass', status=completed, pays via wallet.user.countryCode
    const passes = await this.prisma.transaction.findMany({
      where: { status: 'completed', createdAt: { gte: from, lt: to }, metadata: { path: ['type'], equals: 'access_pass' } } as any,
      select: { amount: true, wallet: { select: { user: { select: { countryCode: true } } } } },
    });
    for (const p of passes) ensure(p.wallet?.user?.countryCode ?? 'UNKNOWN').accessPass += p.amount ?? 0;

    // 3. Commission courses : estimatedPrice × commissionRate(défaut), status=completed, pays via operatingCountry
    const bookings = await this.prisma.booking.findMany({
      where: { status: 'completed', updatedAt: { gte: from, lt: to } },
      select: { estimatedPrice: true, commissionRate: true, operatingCountry: true },
    });
    for (const b of bookings) {
      const country = b.operatingCountry || 'UNKNOWN';
      let rate = b.commissionRate;
      if (rate == null) {
        const raw = await this.settings.getForCountry('commission_rate', country === 'UNKNOWN' ? null : country, '0.15');
        rate = parseFloat(raw) || 0.15;
      }
      ensure(country).commission += (b.estimatedPrice ?? 0) * rate;
    }
    return acc;
  }

  /** Devise d'un pays (Country.currency), fallback XAF. */
  private async currencyOf(country: string): Promise<string> {
    if (country === 'UNKNOWN') return 'XAF';
    const row = await this.prisma.country.findUnique({ where: { code: country }, select: { currency: true } });
    return row?.currency ?? 'XAF';
  }

  async getRevenue(from: Date, to: Date, granularity: Granularity): Promise<RevenueResponse> {
    const baseCurrency = 'XAF';
    const raw = await this.aggregateRaw(from, to);

    // Construire byCountry (devise locale + conversion base)
    const byCountry: CountryRevenue[] = [];
    for (const agg of raw.values()) {
      const currency = await this.currencyOf(agg.country);
      const platformTotal = agg.registration + agg.accessPass;
      const ridesTotal = agg.commission;
      const grandLocal = platformTotal + ridesTotal;
      const grandBase = await this.fx.toBase(grandLocal, currency).catch(() => grandLocal);
      byCountry.push({
        country: agg.country, currency,
        platform: { registration: agg.registration, accessPass: agg.accessPass, total: platformTotal },
        rides: { commission: ridesTotal, total: ridesTotal },
        grandLocal, grandBase,
      });
    }
    byCountry.sort((a, b) => b.grandBase - a.grandBase);

    // Consolidé (base) : convertir plateforme et courses séparément
    let platBase = 0, ridesBase = 0;
    for (const c of byCountry) {
      platBase  += await this.fx.toBase(c.platform.total, c.currency).catch(() => c.platform.total);
      ridesBase += await this.fx.toBase(c.rides.total, c.currency).catch(() => c.rides.total);
    }
    const totalBase = platBase + ridesBase;

    // Comparaison période précédente (même durée, juste avant from)
    const durationMs = to.getTime() - from.getTime();
    const prevFrom = new Date(from.getTime() - durationMs);
    const prevTo = from;
    const prevRaw = await this.aggregateRaw(prevFrom, prevTo);
    let prevPlat = 0, prevRides = 0;
    for (const agg of prevRaw.values()) {
      const currency = await this.currencyOf(agg.country);
      prevPlat  += await this.fx.toBase(agg.registration + agg.accessPass, currency).catch(() => agg.registration + agg.accessPass);
      prevRides += await this.fx.toBase(agg.commission, currency).catch(() => agg.commission);
    }
    const mkDelta = (cur: number, prev: number): DeltaMetric => ({ current: Math.round(cur), previous: Math.round(prev), deltaPct: pctDelta(cur, prev) });
    const comparison = {
      platform: mkDelta(platBase, prevPlat),
      rides: mkDelta(ridesBase, prevRides),
      total: mkDelta(totalBase, prevPlat + prevRides),
    };

    // Timeseries mensuelle (consolidée base) sur [from,to]
    const timeseries = await this.buildMonthlySeries(from, to);

    const insights = buildInsights(byCountry, comparison, totalBase);

    return {
      period: { from: from.toISOString(), to: to.toISOString(), granularity },
      baseCurrency,
      byCountry: byCountry.map(c => ({
        ...c,
        platform: { ...c.platform, registration: Math.round(c.platform.registration), accessPass: Math.round(c.platform.accessPass), total: Math.round(c.platform.total) },
        rides: { commission: Math.round(c.rides.commission), total: Math.round(c.rides.total) },
        grandLocal: Math.round(c.grandLocal), grandBase: Math.round(c.grandBase),
      })),
      consolidated: { baseCurrency, platform: Math.round(platBase), rides: Math.round(ridesBase), total: Math.round(totalBase) },
      timeseries,
      comparison,
      insights,
    };
  }

  /** Série mensuelle consolidée (base) : un point par mois de la période. */
  private async buildMonthlySeries(from: Date, to: Date): Promise<{ month: string; platform: number; rides: number }[]> {
    const points: { month: string; platform: number; rides: number }[] = [];
    const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
    const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));
    while (cursor <= end) {
      const mStart = new Date(cursor);
      const mEnd = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
      const raw = await this.aggregateRaw(mStart, mEnd);
      let plat = 0, rides = 0;
      for (const agg of raw.values()) {
        const currency = await this.currencyOf(agg.country);
        plat  += await this.fx.toBase(agg.registration + agg.accessPass, currency).catch(() => agg.registration + agg.accessPass);
        rides += await this.fx.toBase(agg.commission, currency).catch(() => agg.commission);
      }
      points.push({ month: `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`, platform: Math.round(plat), rides: Math.round(rides) });
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    return points;
  }
}
```
VÉRIFIER : que le filtre Prisma `metadata: { path: ['type'], equals: 'access_pass' }` est supporté par la version Prisma du projet (JSON filtering). Si la version ne le supporte pas proprement, fallback : filtrer par `reference: { startsWith: 'PASS-' }` (les pass utilisent `reference = 'PASS-...'`). ADAPTER selon ce qui compile/fonctionne. VÉRIFIER les noms d'accesseurs Prisma (`driverRegistrationPayment`, `transaction`, `booking`, `country`) et les relations (`wallet.user`, `driverProfile`).

- [ ] **Step 2 : Compiler**

Run : `./node_modules/.bin/tsc --noEmit 2>&1 | grep -i "revenue.service" || echo OK`
Expected : `OK`.

- [ ] **Step 3 : Commit** → `git add src/admin/revenue.service.ts` → `feat(revenue): service agrégation + consolidation multi-devise`.

---

### Task 4 : Endpoint `GET /admin/revenue` + module

**Files:** Modify `src/admin/admin.controller.ts`, `src/admin/admin.module.ts`

- [ ] **Step 1 : Endpoint**

READ `admin.controller.ts` (le bloc des `@Get` avec `@RequirePermission('view_stats')`). Injecter `RevenueService` dans le constructeur et ajouter :
```typescript
import { BadRequestException } from '@nestjs/common';
import { RevenueService } from './revenue.service';
import { Granularity } from './revenue.types';
// constructeur : ajouter `private readonly revenue: RevenueService,`

  @Get('revenue')
  @RequirePermission('view_stats')
  async getRevenue(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('granularity') granularity?: string,
  ) {
    const now = new Date();
    const defFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const fromD = from ? new Date(from) : defFrom;
    const toD = to ? new Date(to) : now;
    if (isNaN(fromD.getTime()) || isNaN(toD.getTime())) throw new BadRequestException('Dates invalides');
    if (fromD > toD) throw new BadRequestException('from doit être antérieur à to');
    const g: Granularity = granularity === 'monthly' ? 'monthly' : 'range';
    return this.revenue.getRevenue(fromD, toD, g);
  }
```
VÉRIFIER les imports existants (`Get`, `Query`, `RequirePermission` déjà importés). ADAPTER si `BadRequestException` déjà importé.

- [ ] **Step 2 : Module**

READ `admin.module.ts`. Ajouter `RevenueService` aux `providers`. Importer le module qui exporte `ExchangeRateService` (probablement `PaymentsModule`) dans les `imports` si pas déjà présent — VÉRIFIER pour éviter une dépendance circulaire (si PaymentsModule importe AdminModule, utiliser `forwardRef`). Si circularité, alternative : déplacer `ExchangeRateService` vers un module partagé, ou l'instancier directement. Choisir la solution minimale ; documenter.

- [ ] **Step 3 : Compiler + démarrage**

Run : `./node_modules/.bin/tsc --noEmit 2>&1 | grep -iE "admin.controller|admin.module|revenue" || echo OK`
Expected : `OK`.

- [ ] **Step 4 : Commit** (safe-swap si admin.controller/module ont du WIP) → `feat(revenue): endpoint GET /admin/revenue`.

---

### Task 5 : Déploiement + validation

- [ ] **Step 1 : Déployer** (base64 → VM `192.168.100.101` via `root@217.160.47.83`, `/home/ubuntu/aerocab-deploy`) : tout `src/admin/revenue.*.ts`, `admin.controller.ts`, `admin.module.ts`. Gérer le cas root-owned (sudo -n chown ubuntu avant extraction). `docker compose build api && up -d api`.
- [ ] **Step 2 : Valider**
  - API `healthy`.
  - `GET /api/admin/revenue` sans token → 401.
  - Avec un token admin (ou vérifier que la route est mappée dans les logs `Mapped {/api/admin/revenue, GET}`).
  - Cohérence : sur une période connue, `consolidated.total` == somme des `byCountry[].grandBase` (à l'arrondi près).
  - Régression : `/admin/stats` répond toujours.

---

## Hors-scope (Lot 2)

- Page admin `RevenuePage.tsx` (contrôles période, KPI, 4 graphes recharts, tableau, insights, CSV) + entrée sidebar + `api.ts` — Lot 2.

## Self-Review (effectuée)

**Couverture spec Lot 1 :** sources §1 → `aggregateRaw` (T3) ✓ ; consolidation multi-devise §2 → `toBase` (T3) ✓ ; endpoint §3 → T4 ✓ ; insights §4 → T2 (pur, TDD) ✓ ; timeseries → `buildMonthlySeries` (T3) ✓ ; comparaison période précédente → T3 ✓ ; tests §8 → T2 (insights) + T5 (cohérence) ✓ ; erreurs §7 (from>to 400, FX indispo fallback, UNKNOWN) → T4 + T3 ✓.

**Cohérence types :** `RevenueResponse`/`CountryRevenue`/`DeltaMetric`/`Insight` définis en T1, consommés en T2/T3 ; `buildInsights(byCountry, comparison, totalBase)`, `pctDelta(cur,prev)`, `getRevenue(from,to,granularity)` cohérents.

**Placeholders :** aucun ; les `VÉRIFIER`/`ADAPTER` pointent les inconnues réelles (filtre JSON Prisma vs reference startsWith, dépendance circulaire PaymentsModule, WIP admin.controller) avec instruction d'adapter.

**Note perf :** `buildMonthlySeries` ré-agrège par mois (N requêtes × mois). Acceptable pour un usage admin/reporting (volumes modérés, pas de hot path). Si lenteur, optimiser en une seule requête `GROUP BY date_trunc('month', ...)` en SQL brut — noté, non requis pour le Lot 1.
