# Config par pays — Phase 3 (Financier) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendre le domaine financier configurable par pays — geler le taux de commission au booking, résoudre commission/bonus/frais/retraits via la cascade pays, et brancher les stats admin sur le sélecteur de pays.

**Architecture:** S'appuie sur la Phase 1 (`getForCountry(key, pays)`) et Phase 2 (sélecteur admin, hub Pays). Le pays de service vient de `booking.operatingCountry` (courses) ou `driverProfile.countryCode` (chauffeur). On ajoute `Booking.commissionRate` (gelé à la création), un résolveur de commission country-aware, et on passe `?country=` du sélecteur aux pages stats.

**Tech Stack:** NestJS + Prisma, Jest (backend) ; React + Vite (admin).

**Spec :** `docs/superpowers/specs/2026-06-03-config-par-pays-design.md` (§3 Financier, §5.6 commission gelée, §6.4 stats)

**Working dir backend :** `/home/aragami/aerogo24V2/aerocab-deploy/backend` — branche `feat/config-par-pays`.
**Working dir admin :** `/home/aragami/aerogo24V2/aerocab-admin` — branche courante.

**Acquis :** `SettingsService.getForCountry(key, countryCode, default)`. `CountriesService`. Côté admin : `useCountry()` (contexte `selected`), `adminApi.getStats(country)`/`getChartData(country)` acceptent déjà `?country=`.

**Convention git :** `git add <chemins exacts>`, JAMAIS `-A`/`.`. Fichiers déjà modifiés hors feature → patch-stager via safe-swap.

---

## File Structure

**Backend**
- `prisma/schema.prisma` — **Modify** : `Booking.commissionRate Float?`
- `src/bookings/bookings.service.ts` — **Modify** : résolveur commission country-aware, gel à la création, usage au finalize, reads financiers country-aware
- `src/bookings/commission-resolver.spec.ts` — **Create** : tests du résolveur (logique pure extraite)
- `src/payments/payout.service.ts` — **Modify** : commission + withdrawal par pays chauffeur
- `src/payments/cash-commission.service.ts` — **Modify** : seuils par pays chauffeur

**Admin**
- `src/pages/DashboardPage.tsx` — **Modify** : passer `useCountry().selected` à `getStats/getChartData`
- `src/pages/AnalyticsPage.tsx` — **Modify** : idem

---

### Task 1 : Champ `Booking.commissionRate`

**Files:** Modify `prisma/schema.prisma`

- [ ] **Step 1 : Ajouter le champ**

Dans `model Booking`, ajouter (après `estimatedPrice` ou près des champs financiers) :
```prisma
  commissionRate Float?  @map("commission_rate")
```
Nullable (les anciens bookings n'en ont pas → fallback cascade au finalize).

- [ ] **Step 2 : Générer**

Run : `npx prisma generate` → succès. (Pas de `db push` local.)

- [ ] **Step 3 : Commit (patch-stagé)**

Stager uniquement le hunk dans `prisma/schema.prisma`. Commit : `feat(pays): Booking.commissionRate (gel du taux)`.

---

### Task 2 : Résolveur de commission country-aware (TDD)

**Files:**
- Modify: `src/bookings/bookings.service.ts`
- Create: `src/bookings/commission-resolver.ts`, `src/bookings/commission-resolver.spec.ts`

On extrait la logique de cascade en une **fonction pure testable** (le résolveur reçoit les valeurs déjà lues, ne touche pas la DB).

- [ ] **Step 1 : Test (échec attendu)**

`src/bookings/commission-resolver.spec.ts` :
```typescript
import { resolveCommissionRate } from './commission-resolver';

describe('resolveCommissionRate (cascade)', () => {
  it('priorité au forfait', () => {
    expect(resolveCommissionRate({ forfaitPercent: 20, vehicleRate: 0.12, settingRate: 0.18, tariffsRate: 0.15 })).toBeCloseTo(0.20);
  });
  it('puis taux véhicule', () => {
    expect(resolveCommissionRate({ forfaitPercent: null, vehicleRate: 0.12, settingRate: 0.18, tariffsRate: 0.15 })).toBeCloseTo(0.12);
  });
  it('puis setting pays', () => {
    expect(resolveCommissionRate({ forfaitPercent: null, vehicleRate: null, settingRate: 0.18, tariffsRate: 0.15 })).toBeCloseTo(0.18);
  });
  it('puis tariffs', () => {
    expect(resolveCommissionRate({ forfaitPercent: null, vehicleRate: null, settingRate: null, tariffsRate: 0.15 })).toBeCloseTo(0.15);
  });
  it('défaut 0.15 si tout absent', () => {
    expect(resolveCommissionRate({ forfaitPercent: null, vehicleRate: null, settingRate: null, tariffsRate: null })).toBeCloseTo(0.15);
  });
});
```

- [ ] **Step 2 : Lancer (échec)**

Run : `npx jest src/bookings/commission-resolver.spec.ts`
Expected : FAIL — module introuvable.

- [ ] **Step 3 : Implémenter le résolveur pur**

`src/bookings/commission-resolver.ts` :
```typescript
/**
 * Cascade de résolution du taux de commission (0–1) :
 * forfait → taux véhicule → setting pays → tariffs pays → 0.15.
 * Fonction pure : reçoit les valeurs déjà lues (forfaitPercent en %, le reste en fraction).
 */
export function resolveCommissionRate(input: {
  forfaitPercent: number | null;
  vehicleRate: number | null;
  settingRate: number | null;
  tariffsRate: number | null;
}): number {
  if (input.forfaitPercent != null) return input.forfaitPercent / 100;
  if (input.vehicleRate != null) return input.vehicleRate;
  if (input.settingRate != null) return input.settingRate;
  if (input.tariffsRate != null) return input.tariffsRate;
  return 0.15;
}
```

- [ ] **Step 4 : Lancer (succès)**

Run : `npx jest src/bookings/commission-resolver.spec.ts`
Expected : PASS (5 tests).

- [ ] **Step 5 : Câbler dans `computeCommissionAmount`**

Dans `src/bookings/bookings.service.ts`, refactorer `computeCommissionAmount` pour : (a) accepter un `operatingCountry`, (b) lire `commission_rate_pct` via `getForCountry`, (c) utiliser `resolveCommissionRate`. Remplacer le corps actuel (lignes ~306-319) par :
```typescript
  private async computeCommissionAmount(
    grossAmount: number,
    vehicleType: string,
    forfaitId: string | null,
    operatingCountry: string | null,
  ): Promise<number> {
    let forfaitPercent: number | null = null;
    if (forfaitId) {
      const forfait = await this.forfaitsService.findOne(forfaitId).catch(() => null);
      forfaitPercent = forfait?.companyPercent ?? null;
    }
    const rideTariffs = await this.settingsService.getTariffsByCountry(operatingCountry);
    const vehicleRate = rideTariffs.vehicles?.[vehicleType]?.commissionRate ?? null;
    const settingRaw = await this.settingsService.getForCountry('commission_rate_pct', operatingCountry, '');
    const settingRate = settingRaw ? parseFloat(settingRaw) / 100 : null;
    const tariffsRate = rideTariffs.commissionRate ?? null;
    const rate = resolveCommissionRate({ forfaitPercent, vehicleRate, settingRate, tariffsRate });
    return Math.round(grossAmount * rate * 100) / 100;
  }
```
Ajouter l'import : `import { resolveCommissionRate } from './commission-resolver';`. Adapter l'appel existant de `computeCommissionAmount` (chercher `computeCommissionAmount(`) pour passer `booking.operatingCountry`.

- [ ] **Step 6 : Compiler + tester**

Run : `./node_modules/.bin/tsc --noEmit 2>&1 | grep -iE "commission|bookings.service" || echo "OK"`
Run : `npx jest src/bookings/commission-resolver.spec.ts`
Expected : `OK` + 5 PASS.

- [ ] **Step 7 : Commit**

`git add src/bookings/commission-resolver.ts src/bookings/commission-resolver.spec.ts src/bookings/bookings.service.ts` → `feat(pays): résolveur commission country-aware (TDD)`.

---

### Task 3 : Geler `commissionRate` à la création + l'utiliser au finalize

**Files:** Modify `src/bookings/bookings.service.ts`

- [ ] **Step 1 : Geler à la création**

Repérer la création du booking (`tx.booking.create({ data: { ... } })`, vers ligne 818). Avant le `create`, calculer le taux effectif (country-aware) et l'ajouter au `data`. Ajouter une méthode privée `resolveBookingCommissionRate` :
```typescript
  private async resolveBookingCommissionRate(
    vehicleType: string, forfaitId: string | null, operatingCountry: string | null,
  ): Promise<number> {
    let forfaitPercent: number | null = null;
    if (forfaitId) {
      const forfait = await this.forfaitsService.findOne(forfaitId).catch(() => null);
      forfaitPercent = forfait?.companyPercent ?? null;
    }
    const rideTariffs = await this.settingsService.getTariffsByCountry(operatingCountry);
    const vehicleRate = rideTariffs.vehicles?.[vehicleType]?.commissionRate ?? null;
    const settingRaw = await this.settingsService.getForCountry('commission_rate_pct', operatingCountry, '');
    const settingRate = settingRaw ? parseFloat(settingRaw) / 100 : null;
    return resolveCommissionRate({ forfaitPercent, vehicleRate, settingRate, tariffsRate: rideTariffs.commissionRate ?? null });
  }
```
Puis dans le `create.data`, ajouter :
```typescript
          commissionRate: await this.resolveBookingCommissionRate(dto.vehicleType, null, bookingCountryCode),
```
(`bookingCountryCode` est déjà calculé plus haut dans `createBooking` — vérifier le nom exact de la variable du pays.)

- [ ] **Step 2 : Utiliser le taux gelé au finalize**

Dans `finalizeRide` (et tout endroit appelant `computeCommissionAmount` pour le cash), si `booking.commissionRate != null`, l'utiliser directement plutôt que recalculer :
```typescript
  // remplacer l'appel cash commission par :
  const commissionAmount = booking.commissionRate != null
    ? Math.round(grossAmount * booking.commissionRate * 100) / 100
    : await this.computeCommissionAmount(grossAmount, booking.vehicleType, booking.forfaitId ?? null, booking.operatingCountry ?? null);
```
(Chercher `computeCommissionAmount(` dans `finalizeRide` / `recordDebt` et appliquer ce pattern.)

- [ ] **Step 3 : Compiler**

Run : `./node_modules/.bin/tsc --noEmit 2>&1 | grep -i "bookings.service" || echo "OK"`
Expected : `OK`.

- [ ] **Step 4 : Commit**

`git add src/bookings/bookings.service.ts` → `feat(pays): gel commissionRate au booking + usage au finalize`.

---

### Task 4 : Reads financiers booking country-aware

**Files:** Modify `src/bookings/bookings.service.ts`

- [ ] **Step 1 : Rendre les lectures country-aware**

Remplacer ces `settingsService.get(...)` par `getForCountry(..., <pays>, default)` :
- ligne ~931 `first_ride_bonus_points` → pays = `bookingCountryCode` (création)
- ligne ~1356 `late_cancel_refund_rate` → pays = `booking.operatingCountry`
- lignes ~2452 `loyalty_bonus_every_n_rides` et ~2465 `loyalty_bonus_points` → pays = `booking.operatingCountry`

Exemple :
```typescript
  const lateCancelRate = parseFloat(
    await this.settingsService.getForCountry('late_cancel_refund_rate', booking.operatingCountry ?? null, '0.5')
  ) || 0.5;
```
VÉRIFIER pour chaque ligne le nom de la variable pays disponible dans le scope (`bookingCountryCode` à la création, `booking.operatingCountry` après chargement du booking). Adapter.

- [ ] **Step 2 : Compiler**

Run : `./node_modules/.bin/tsc --noEmit 2>&1 | grep -i "bookings.service" || echo "OK"`
Expected : `OK`.

- [ ] **Step 3 : Commit**

`git add src/bookings/bookings.service.ts` → `feat(pays): bonus/cashback/late-cancel par pays`.

---

### Task 5 : Reads financiers chauffeur country-aware

**Files:** Modify `src/payments/payout.service.ts`, `src/payments/cash-commission.service.ts`

- [ ] **Step 1 : Payout — commission + retrait par pays chauffeur**

Dans `src/payments/payout.service.ts`, les lectures (lignes ~47-48 `commission_rate_pct`/`commission_rate_vip_pct`, ~161 `min_withdrawal_amount`) → résoudre par le pays du chauffeur. Charger `driverProfile.countryCode` (le service a accès au driverProfile via `bookingId`/`driverProfileId` — vérifier comment il récupère le driver) et utiliser :
```typescript
  const commissionRaw = await this.settings.getForCountry('commission_rate_pct', driverCountry, '15');
  const minWithdrawal = parseFloat(await this.settings.getForCountry('min_withdrawal_amount', driverCountry, '5000'));
```
Si le `driverCountry` n'est pas trivialement disponible dans une méthode, le charger via `prisma.driverProfile.findUnique({ where:{id}, select:{countryCode:true} })`. VÉRIFIER la structure réelle du service avant d'adapter.

- [ ] **Step 2 : Cash-commission — seuils par pays**

Dans `src/payments/cash-commission.service.ts`, `cash_commission_block_threshold` (lignes ~48/87/128) + `registration_fee_deposit_pct` (~106) → `getForCountry(key, driverCountry, default)`. Charger le `driverCountry` depuis le `driverProfileId` passé aux méthodes.

- [ ] **Step 3 : Compiler**

Run : `./node_modules/.bin/tsc --noEmit 2>&1 | grep -iE "payout|cash-commission" || echo "OK"`
Expected : `OK`.

- [ ] **Step 4 : Commit**

`git add src/payments/payout.service.ts src/payments/cash-commission.service.ts` → `feat(pays): commission/retrait/seuils chauffeur par pays`.

---

### Task 6 : Admin — stats branchées sur le sélecteur

**Files:** Modify `src/pages/DashboardPage.tsx`, `src/pages/AnalyticsPage.tsx` (working dir admin)

- [ ] **Step 1 : Brancher le pays sélectionné**

Dans `DashboardPage.tsx` et `AnalyticsPage.tsx` : importer `useCountry` (`../contexts/CountryContext`), récupérer `selected`, et passer `selected === 'GLOBAL' ? undefined : selected` aux appels `adminApi.getStats(...)` / `adminApi.getChartData(...)`. Ajouter `selected` aux dépendances du `useEffect`/`useQuery` qui charge les stats → rechargement automatique au changement de pays.

Exemple :
```tsx
import { useCountry } from '../contexts/CountryContext';
// ...
const { selected } = useCountry();
const countryParam = selected === 'GLOBAL' ? undefined : selected;
// dans le chargement :
const stats = await adminApi.getStats(countryParam);
// dépendances : [..., selected]
```
VÉRIFIER la signature réelle de `getStats`/`getChartData` dans `services/api.ts` (un param optionnel `country?` a été ajouté en Phase 2) et la façon dont la page charge ses données (useEffect, react-query…). Adapter.

- [ ] **Step 2 : Build**

Run : `npx tsc --noEmit 2>&1 | grep -iE "DashboardPage|AnalyticsPage" || echo "OK"` puis `npm run build`.
Expected : `OK` + build réussi.

- [ ] **Step 3 : Commit**

`git add src/pages/DashboardPage.tsx src/pages/AnalyticsPage.tsx` (patch-stagé si modifs pré-existantes) → `feat(pays): dashboard + analytics filtrés par le sélecteur pays`.

---

### Task 7 : Déploiement + validation

- [ ] **Step 1 : Déployer backend** (base64 → `qm guest exec 101`) : `schema.prisma`, `src/bookings/commission-resolver.ts`, `src/bookings/bookings.service.ts`, `src/payments/payout.service.ts`, `src/payments/cash-commission.service.ts`. Rebuild + up api. `db push` ajoute `commission_rate`.

- [ ] **Step 2 : Déployer admin** : `DashboardPage.tsx`, `AnalyticsPage.tsx` ; rebuild conteneur admin.

- [ ] **Step 3 : Valider**
  - Colonne `commission_rate` présente sur `bookings`.
  - Créer un override test : `commission_rate_pct:SN = 12` dans `app_settings` → une course SN gèlerait 0.12 (vérifier via une réservation simulée ou lecture directe).
  - Une course CM sans override → taux global inchangé (régression nulle).
  - Admin : changer le sélecteur de pays → le dashboard recharge les KPIs du pays.
  - API + admin `healthy`.

---

## Self-Review (effectuée)

**Couverture spec Phase 3 :** commission gelée (§5.6) → T1,T2,T3 ✓ ; financier par pays (§3) → T2,T4,T5 ✓ ; stats par pays branchées (§6.4) → T6 ✓. Cashback : déjà country-aware (`getTariffsByCountry`) — confirmé, pas de tâche nécessaire.

**Hors Phase 3 (volontaire) :** comparatif "Global" multi-pays sur le dashboard (UI enrichie — peut suivre) ; montants pass/registration (rattachés au domaine Paiements/Plateforme, Phase 4) ; devise d'affichage par pays (Phase 7 wallet/monnaie).

**Cohérence types :** `resolveCommissionRate({forfaitPercent,vehicleRate,settingRate,tariffsRate})→number`, `computeCommissionAmount(gross,vehicleType,forfaitId,operatingCountry)`, `resolveBookingCommissionRate(vehicleType,forfaitId,country)`, `Booking.commissionRate Float?` — cohérents entre tasks.

**Placeholders :** aucun — code complet ; les `VÉRIFIER` pointent les noms réels à confirmer (variable pays dans createBooking, structure payout/cash-commission, signature stats admin) avec instruction d'adapter.
