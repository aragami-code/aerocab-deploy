# Fidélité progressive AeroGo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Le niveau de fidélité du passager (bronze→platinum, calculé sur ses points gagnés à vie) débloque progressivement catégories de véhicules et services premium, avec achat ponctuel possible via les points dépensables.

**Architecture:** Config par pays en `app_settings` (`tier_matrix`, `upgrade_costs`, `top_rated_min_rating`, cascade `clé:CC > global > défaut`). Un nouveau module backend `loyalty` calcule la disponibilité (`resolveAvailability`) et le tier effectif (`effectiveTier`). Le gating + la dépense de points s'insèrent dans `createBooking` (transaction atomique). Les services réutilisent le dispatch tier-aware existant (F8) via `effectiveTier`, un filtre top-rated, et un remboursement « garanti » dans le scheduler.

**Tech Stack:** NestJS, Prisma (PostgreSQL), Jest/ts-jest (backend) ; Expo / React Native (app passager).

**Conventions de test :** `cd /home/aragami/aerogo24V2/aerocab-deploy/backend && npx jest <chemin> -t "<nom>"`. Les fichiers `*.spec.ts` existent déjà (ex: `src/bookings/bookings.service.spec.ts`).

**Deux compteurs (existant, ne pas recoder) :** statut/niveau = `Σ PointsTransaction.points WHERE type='credit'` (jamais réduit par une dépense) ; solde dépensable = `pointsService.getBalance()`. Dépenser crée un débit qui n'affecte pas le niveau.

**Signatures réutilisées (vérifiées) :**
- `pointsService.deductPointsTx(tx, userId, points, label)` — débit dans une transaction Prisma fournie ; lève `BadRequestException` si solde insuffisant.
- `pointsService.addPoints(userId, points, label, source)` — crédit ; `source='refund'` pour un remboursement.
- `pointsService.getBalance(userId): Promise<number>`.
- `settingsService.getForCountry(key, countryCode, defaultValue): Promise<string>` — cascade pays.
- `settingsService.getTariffsByCountry(countryCode): Promise<TariffsConfig>` — `.vehicles` = catégories tarifées.
- `usersService.getPassengerTier(userId): Promise<TierKey>` (`'bronze'|'silver'|'gold'|'platinum'`).
- `dispatchService.findEligibleDrivers(booking, isPreLanding, customCoords?, passengerTier?)`.
- `GET /users/me/loyalty` → `usersService.getLoyaltyStatus(userId)` (déjà exposé).

---

## File Structure

**Backend — nouveau module `src/loyalty/`**
- `loyalty.constants.ts` — défauts `DEFAULT_TIER_MATRIX`, `DEFAULT_UPGRADE_COSTS`, `DEFAULT_TOP_RATED_MIN_RATING`, types `TierMatrix`, `PerkKey`, `CategoryAvailability`.
- `loyalty.service.ts` — `resolveAvailability(tier, country, vehicleType)`, `getOptions(userId, vehicleType, country)`, `effectiveTier(realTier, perks)`, `serviceIncluded(tier, service, country)`, `costOf(perk, country)`.
- `loyalty.controller.ts` — `GET /loyalty/options`.
- `loyalty.module.ts` — wiring (importe SettingsModule, PointsModule/UsersModule selon besoin).
- Tests : `loyalty.service.spec.ts`.

**Backend — modifications**
- `prisma/schema.prisma` — `Booking.purchasedPerks String[]`, `Booking.effectiveTier String?`, `Booking.guaranteedRefunded Boolean`.
- `src/bookings/dto/create-booking.dto.ts` — `purchasedPerks?: string[]`.
- `src/bookings/bookings.service.ts` — gating + `deductPointsTx` + `effectiveTier` dans `createBooking`.
- `src/bookings/dispatch.service.ts` — filtre `top_rated`.
- `src/bookings/bookings.scheduler.ts` — remboursement « garanti » idempotent.
- `src/app.module.ts` — importer `LoyaltyModule`.

**Mobile — app passager**
- `app/(tabs)/loyalty.tsx` (nouveau) — écran « Mon niveau ».
- `app/(booking)/vehicle.tsx` — catégories verrouillées/débloquées + CTA déblocage.
- `app/(booking)/summary.tsx` — récap perks achetés.
- `services/api.ts` — `getLoyaltyOptions(vehicleType, country)`.

---

## LOT 1 — Socle config + calcul de disponibilité + écran niveau

### Task 1 : Constantes & types du module loyalty

**Files:**
- Create: `aerocab-deploy/backend/src/loyalty/loyalty.constants.ts`

- [ ] **Step 1 : Écrire les constantes et types**

```typescript
// src/loyalty/loyalty.constants.ts
export type TierKey = 'bronze' | 'silver' | 'gold' | 'platinum';
export type ServiceKey = 'priority' | 'top_rated' | 'guaranteed';
export type PerkKey = `category:${string}` | ServiceKey;

export interface TierEntry { categories: string[]; services: ServiceKey[]; }
export type TierMatrix = Record<TierKey, TierEntry>;

export const TIER_ORDER: TierKey[] = ['bronze', 'silver', 'gold', 'platinum'];

export const DEFAULT_TIER_MATRIX: TierMatrix = {
  bronze:   { categories: ['eco', 'standard'],                                      services: [] },
  silver:   { categories: ['eco', 'standard', 'eco_plus'],                          services: [] },
  gold:     { categories: ['eco', 'standard', 'eco_plus', 'confort'],               services: ['priority'] },
  platinum: { categories: ['eco', 'standard', 'eco_plus', 'confort', 'confort_plus'], services: ['priority', 'top_rated', 'guaranteed'] },
};

export const DEFAULT_UPGRADE_COSTS: Record<string, number> = {
  'category:confort': 120,
  'category:confort_plus': 200,
  priority: 50,
  top_rated: 150,
  guaranteed: 200,
};

export const DEFAULT_TOP_RATED_MIN_RATING = 4.8;

export const SETTING_TIER_MATRIX = 'tier_matrix';
export const SETTING_UPGRADE_COSTS = 'upgrade_costs';
export const SETTING_TOP_RATED_MIN_RATING = 'top_rated_min_rating';
```

- [ ] **Step 2 : Commit**

```bash
cd /home/aragami/aerogo24V2/aerocab-deploy
git add backend/src/loyalty/loyalty.constants.ts
git commit -m "feat(loyalty): constantes et types (tier matrix, perks, défauts)"
```

---

### Task 2 : `resolveAvailability` (TDD)

**Files:**
- Create: `aerocab-deploy/backend/src/loyalty/loyalty.service.ts`
- Test: `aerocab-deploy/backend/src/loyalty/loyalty.service.spec.ts`

- [ ] **Step 1 : Écrire le test qui échoue**

```typescript
// src/loyalty/loyalty.service.spec.ts
import { LoyaltyService } from './loyalty.service';

function makeSettings(overrides: Record<string, string> = {}) {
  return {
    getForCountry: jest.fn(async (key: string, _c: string | null, def: string) => overrides[key] ?? def),
    getTariffsByCountry: jest.fn(async () => ({
      vehicles: { eco: {}, eco_plus: {}, standard: {}, confort: {}, confort_plus: {} },
    })),
  } as any;
}

describe('LoyaltyService.resolveAvailability', () => {
  it('marque débloquées les catégories du tier et verrouillées+coût les autres', async () => {
    const svc = new LoyaltyService(makeSettings(), {} as any, {} as any);
    const res = await svc.resolveAvailability('silver', 'CM', 'standard');
    const byKey = Object.fromEntries(res.categories.map(c => [c.key, c]));
    expect(byKey['eco_plus'].unlocked).toBe(true);
    expect(byKey['eco_plus'].cost).toBe(0);
    expect(byKey['confort'].unlocked).toBe(false);
    expect(byKey['confort'].cost).toBe(120);
  });

  it('platinum débloque tout', async () => {
    const svc = new LoyaltyService(makeSettings(), {} as any, {} as any);
    const res = await svc.resolveAvailability('platinum', 'CM', 'standard');
    expect(res.categories.every(c => c.unlocked)).toBe(true);
  });
});
```

- [ ] **Step 2 : Lancer le test → échec**

Run: `cd /home/aragami/aerogo24V2/aerocab-deploy/backend && npx jest src/loyalty/loyalty.service.spec.ts -t resolveAvailability`
Expected: FAIL — `Cannot find module './loyalty.service'`.

- [ ] **Step 3 : Implémentation minimale**

```typescript
// src/loyalty/loyalty.service.ts
import { Injectable } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';
import { PointsService } from '../points/points.service';
import { UsersService } from '../users/users.service';
import {
  TierKey, TierMatrix, ServiceKey,
  DEFAULT_TIER_MATRIX, DEFAULT_UPGRADE_COSTS, DEFAULT_TOP_RATED_MIN_RATING,
  SETTING_TIER_MATRIX, SETTING_UPGRADE_COSTS, SETTING_TOP_RATED_MIN_RATING, TIER_ORDER,
} from './loyalty.constants';

export interface CategoryAvailability { key: string; unlocked: boolean; cost: number; }
export interface ServiceAvailability { key: ServiceKey; included: boolean; cost: number; }
export interface LoyaltyOptions {
  tier: TierKey; balance: number;
  categories: CategoryAvailability[]; services: ServiceAvailability[];
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

  async resolveAvailability(tier: TierKey, country: string | null, _vehicleType: string) {
    const [matrix, costs, tariffs] = await Promise.all([
      this.matrix(country), this.costs(country), this.settings.getTariffsByCountry(country),
    ]);
    const unlockedCats = new Set(matrix[tier].categories);
    const allCats = Object.keys(tariffs.vehicles ?? {});
    const categories: CategoryAvailability[] = allCats.map((key) => ({
      key,
      unlocked: unlockedCats.has(key),
      cost: unlockedCats.has(key) ? 0 : (costs[`category:${key}`] ?? 0),
    }));
    const includedServices = new Set(matrix[tier].services);
    const allServices: ServiceKey[] = ['priority', 'top_rated', 'guaranteed'];
    const services: ServiceAvailability[] = allServices.map((key) => ({
      key, included: includedServices.has(key), cost: includedServices.has(key) ? 0 : (costs[key] ?? 0),
    }));
    return { categories, services };
  }
}
```

- [ ] **Step 4 : Lancer le test → succès**

Run: `cd /home/aragami/aerogo24V2/aerocab-deploy/backend && npx jest src/loyalty/loyalty.service.spec.ts -t resolveAvailability`
Expected: PASS (2 tests).

- [ ] **Step 5 : Commit**

```bash
cd /home/aragami/aerogo24V2/aerocab-deploy
git add backend/src/loyalty/loyalty.service.ts backend/src/loyalty/loyalty.service.spec.ts
git commit -m "feat(loyalty): resolveAvailability (catégories/services débloqués par niveau, cascade pays)"
```

---

### Task 3 : `effectiveTier` (TDD)

**Files:**
- Modify: `aerocab-deploy/backend/src/loyalty/loyalty.service.ts`
- Test: `aerocab-deploy/backend/src/loyalty/loyalty.service.spec.ts`

- [ ] **Step 1 : Ajouter le test qui échoue**

```typescript
// ajouter dans loyalty.service.spec.ts
describe('LoyaltyService.effectiveTier', () => {
  it('un bronze qui achète priority est traité au moins gold (tier qui inclut priority)', async () => {
    const svc = new LoyaltyService(makeSettings(), {} as any, {} as any);
    const eff = await svc.effectiveTier('bronze', ['priority'], 'CM');
    expect(eff).toBe('gold');
  });

  it('sans perk de dispatch, le tier reste inchangé', async () => {
    const svc = new LoyaltyService(makeSettings(), {} as any, {} as any);
    const eff = await svc.effectiveTier('silver', ['category:confort'], 'CM');
    expect(eff).toBe('silver');
  });
});
```

- [ ] **Step 2 : Lancer → échec**

Run: `cd /home/aragami/aerogo24V2/aerocab-deploy/backend && npx jest src/loyalty/loyalty.service.spec.ts -t effectiveTier`
Expected: FAIL — `svc.effectiveTier is not a function`.

- [ ] **Step 3 : Implémenter**

```typescript
// ajouter dans LoyaltyService
/**
 * Tier appliqué au dispatch : si le passager a acheté `priority` (perk de pool),
 * on l'élève au plus bas tier dont la matrice inclut `priority`. Les autres perks
 * (top_rated, guaranteed, category:*) ne changent pas le pool.
 */
async effectiveTier(realTier: TierKey, perks: string[], country: string | null): Promise<TierKey> {
  if (!perks.includes('priority')) return realTier;
  const matrix = await this.matrix(country);
  const firstWithPriority = TIER_ORDER.find((t) => matrix[t].services.includes('priority')) ?? realTier;
  const idx = Math.max(TIER_ORDER.indexOf(realTier), TIER_ORDER.indexOf(firstWithPriority));
  return TIER_ORDER[idx];
}
```

- [ ] **Step 4 : Lancer → succès**

Run: `cd /home/aragami/aerogo24V2/aerocab-deploy/backend && npx jest src/loyalty/loyalty.service.spec.ts -t effectiveTier`
Expected: PASS (2 tests).

- [ ] **Step 5 : Commit**

```bash
cd /home/aragami/aerogo24V2/aerocab-deploy
git add backend/src/loyalty/loyalty.service.ts backend/src/loyalty/loyalty.service.spec.ts
git commit -m "feat(loyalty): effectiveTier (priority acheté = élévation pool vers tier inclusif)"
```

---

### Task 4 : `getOptions` + endpoint `GET /loyalty/options`

**Files:**
- Modify: `aerocab-deploy/backend/src/loyalty/loyalty.service.ts`
- Create: `aerocab-deploy/backend/src/loyalty/loyalty.controller.ts`
- Create: `aerocab-deploy/backend/src/loyalty/loyalty.module.ts`
- Modify: `aerocab-deploy/backend/src/app.module.ts`
- Test: `aerocab-deploy/backend/src/loyalty/loyalty.service.spec.ts`

- [ ] **Step 1 : Test `getOptions` qui échoue**

```typescript
// ajouter dans loyalty.service.spec.ts
describe('LoyaltyService.getOptions', () => {
  it('assemble tier, balance et disponibilité', async () => {
    const users = { getPassengerTier: jest.fn(async () => 'silver') } as any;
    const points = { getBalance: jest.fn(async () => 730) } as any;
    const svc = new LoyaltyService(makeSettings(), points, users);
    const out = await svc.getOptions('u-1', 'standard', 'CM');
    expect(out.tier).toBe('silver');
    expect(out.balance).toBe(730);
    expect(out.categories.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2 : Lancer → échec**

Run: `cd /home/aragami/aerogo24V2/aerocab-deploy/backend && npx jest src/loyalty/loyalty.service.spec.ts -t getOptions`
Expected: FAIL — `svc.getOptions is not a function`.

- [ ] **Step 3 : Implémenter `getOptions`**

```typescript
// ajouter dans LoyaltyService
async getOptions(userId: string, vehicleType: string, country: string | null): Promise<LoyaltyOptions> {
  const tier = await this.users.getPassengerTier(userId);
  const [balance, avail] = await Promise.all([
    this.points.getBalance(userId),
    this.resolveAvailability(tier, country, vehicleType),
  ]);
  return { tier, balance, categories: avail.categories, services: avail.services };
}
```

- [ ] **Step 4 : Lancer → succès**

Run: `cd /home/aragami/aerogo24V2/aerocab-deploy/backend && npx jest src/loyalty/loyalty.service.spec.ts -t getOptions`
Expected: PASS.

- [ ] **Step 5 : Écrire le contrôleur + module**

```typescript
// src/loyalty/loyalty.controller.ts
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { LoyaltyService } from './loyalty.service';

@Controller('loyalty')
@UseGuards(JwtAuthGuard)
export class LoyaltyController {
  constructor(private readonly loyalty: LoyaltyService) {}

  @Get('options')
  async options(
    @CurrentUser('id') userId: string,
    @Query('vehicleType') vehicleType: string,
    @Query('country') country?: string,
  ) {
    return this.loyalty.getOptions(userId, vehicleType ?? 'standard', country ?? null);
  }
}
```

```typescript
// src/loyalty/loyalty.module.ts
import { Module } from '@nestjs/common';
import { LoyaltyService } from './loyalty.service';
import { LoyaltyController } from './loyalty.controller';
import { SettingsModule } from '../settings/settings.module';
import { PointsModule } from '../points/points.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [SettingsModule, PointsModule, UsersModule],
  controllers: [LoyaltyController],
  providers: [LoyaltyService],
  exports: [LoyaltyService],
})
export class LoyaltyModule {}
```

Vérifier que `JwtAuthGuard` et `CurrentUser` existent aux chemins indiqués (sinon adapter l'import : `grep -rn "class JwtAuthGuard" src/auth`). Si `PointsModule`/`UsersModule` n'exportent pas leurs services, ajouter `exports: [PointsService]` / `exports: [UsersService]` dans ces modules.

- [ ] **Step 6 : Brancher dans app.module.ts**

Ajouter `LoyaltyModule` à la liste des `imports` de `src/app.module.ts` (à côté des autres modules métier).

- [ ] **Step 7 : Vérifier compilation + tous les tests loyalty**

Run: `cd /home/aragami/aerogo24V2/aerocab-deploy/backend && npx tsc --noEmit && npx jest src/loyalty/`
Expected: tsc 0 erreur ; tous les tests loyalty PASS.

- [ ] **Step 8 : Commit**

```bash
cd /home/aragami/aerogo24V2/aerocab-deploy
git add backend/src/loyalty/ backend/src/app.module.ts
git commit -m "feat(loyalty): endpoint GET /loyalty/options + module wiring"
```

---

### Task 5 : Mobile — écran « Mon niveau »

**Files:**
- Create: `aerocab-native/aerocab-passenger/app/(tabs)/loyalty.tsx`
- Modify: `aerocab-native/aerocab-passenger/services/api.ts` (ajouter `getLoyaltyStatus` si absent)

> Pas de test unitaire RN ici : vérification manuelle. L'écran consomme `GET /users/me/loyalty` (déjà exposé) qui renvoie `{ tier, tierLabel, tierColor, tierEmoji, pointsTotal, currentThreshold, nextTier, nextThreshold, progressPct, benefits }`.

- [ ] **Step 1 : Ajouter l'appel API (si absent)**

```typescript
// services/api.ts — ajouter dans l'objet api
getLoyaltyStatus: (token: string) =>
  request('/users/me/loyalty', { token }),
```
(Adapter à la forme exacte du helper `request`/`get` du fichier : `grep -n "getConversations" services/api.ts` pour copier le motif.)

- [ ] **Step 2 : Créer l'écran**

```tsx
// app/(tabs)/loyalty.tsx
import { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useAuthStore } from '../../stores/authStore';
import { api } from '../../services/api';
import { ScreenHeader } from '../../lib/mobile-ui';

type Loyalty = {
  tier: string; tierLabel: string; tierColor: string; tierEmoji: string;
  pointsTotal: number; nextTier: string | null; nextThreshold: number | null;
  progressPct: number; benefits: string[];
};

export default function LoyaltyScreen() {
  const token = useAuthStore(s => s.token);
  const [d, setD] = useState<Loyalty | null>(null);

  useEffect(() => {
    if (!token) return;
    api.getLoyaltyStatus(token).then(setD).catch(() => {});
  }, [token]);

  if (!d) return <View style={styles.center}><Text>Chargement…</Text></View>;

  return (
    <ScrollView style={{ flex: 1 }}>
      <ScreenHeader title="Mon niveau" />
      <View style={[styles.card, { borderColor: d.tierColor }]}>
        <Text style={styles.emoji}>{d.tierEmoji}</Text>
        <Text style={[styles.tier, { color: d.tierColor }]}>{d.tierLabel}</Text>
        <Text style={styles.pts}>{d.pointsTotal} points cumulés</Text>
        <View style={styles.barBg}>
          <View style={[styles.barFill, { width: `${d.progressPct}%`, backgroundColor: d.tierColor }]} />
        </View>
        {d.nextTier
          ? <Text style={styles.next}>Plus que {Math.max(0, (d.nextThreshold ?? 0) - d.pointsTotal)} pts pour {d.nextTier}</Text>
          : <Text style={styles.next}>Niveau maximum atteint 🎉</Text>}
      </View>
      <View style={styles.benefits}>
        <Text style={styles.bTitle}>Vos avantages</Text>
        {d.benefits.map((b, i) => <Text key={i} style={styles.bItem}>• {b}</Text>)}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: { margin: 16, padding: 20, borderRadius: 16, borderWidth: 2, alignItems: 'center', backgroundColor: '#fff' },
  emoji: { fontSize: 44 },
  tier: { fontSize: 22, fontWeight: '800', marginTop: 6 },
  pts: { color: '#64748b', marginTop: 4 },
  barBg: { width: '100%', height: 8, borderRadius: 4, backgroundColor: '#E2E8F0', marginTop: 16, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 4 },
  next: { color: '#64748b', fontSize: 13, marginTop: 8 },
  benefits: { marginHorizontal: 16, padding: 16, backgroundColor: '#fff', borderRadius: 16 },
  bTitle: { fontWeight: '800', fontSize: 15, marginBottom: 8 },
  bItem: { color: '#475569', lineHeight: 22 },
});
```

- [ ] **Step 3 : Vérifier le typecheck**

Run: `cd /home/aragami/aerogo24V2/aerocab-native/aerocab-passenger && npx tsc --noEmit -p tsconfig.json`
Expected: exit 0.

- [ ] **Step 4 : Commit**

```bash
cd /home/aragami/aerogo24V2/aerocab-native/aerocab-passenger
git add "app/(tabs)/loyalty.tsx" services/api.ts
git commit -m "feat(loyalty): écran Mon niveau (branche /users/me/loyalty)"
```

---

## LOT 2 — Catégories (gating + achat à la carte)

### Task 6 : Schéma Booking (`purchasedPerks`, `effectiveTier`, `guaranteedRefunded`)

**Files:**
- Modify: `aerocab-deploy/backend/prisma/schema.prisma` (model `Booking`, vers la ligne 184)

- [ ] **Step 1 : Ajouter les champs au model Booking**

> `purchasedPerks` = **perks réellement payés** (achetés et débités) — c'est la vérité de facturation, utilisée pour le **remboursement** (Task 13). Les perks **actifs** pour le dispatch = `purchasedPerks` **∪** services inclus par le niveau, dérivés à la volée via `resolveAvailability(effectiveTier, …)` (Tasks 12/13) — pas besoin de les stocker.

```prisma
  purchasedPerks      String[]      @default([])  @map("purchased_perks")
  effectiveTier       String?                     @map("effective_tier")
  guaranteedRefunded  Boolean       @default(false) @map("guaranteed_refunded")
```

- [ ] **Step 2 : Générer le client + pousser le schéma**

Run: `cd /home/aragami/aerogo24V2/aerocab-deploy/backend && npx prisma generate && npx prisma db push`
Expected: client régénéré, colonnes ajoutées sans perte (champs optionnels / défaut).

- [ ] **Step 3 : Commit**

```bash
cd /home/aragami/aerogo24V2/aerocab-deploy
git add backend/prisma/schema.prisma
git commit -m "feat(loyalty): champs Booking purchasedPerks/effectiveTier/guaranteedRefunded"
```

---

### Task 7 : DTO `purchasedPerks`

**Files:**
- Modify: `aerocab-deploy/backend/src/bookings/dto/create-booking.dto.ts`

- [ ] **Step 1 : Ajouter le champ optionnel**

```typescript
// dans CreateBookingDto
@IsOptional()
@IsArray()
@IsString({ each: true })
purchasedPerks?: string[];   // ex: ["category:confort","top_rated"]
```
Ajouter `IsArray` aux imports `class-validator` si absent.

- [ ] **Step 2 : Vérifier compilation**

Run: `cd /home/aragami/aerogo24V2/aerocab-deploy/backend && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3 : Commit**

```bash
cd /home/aragami/aerogo24V2/aerocab-deploy
git add backend/src/bookings/dto/create-booking.dto.ts
git commit -m "feat(loyalty): CreateBookingDto.purchasedPerks"
```

---

### Task 8 : Gating + dépense de points dans `createBooking` (TDD)

**Files:**
- Modify: `aerocab-deploy/backend/src/bookings/bookings.service.ts` (méthode `createBooking`)
- Modify: `aerocab-deploy/backend/src/bookings/bookings.service.spec.ts`

**Logique à insérer** (au début de `createBooking`, après résolution du `country` et avant la création du booking) : revalidation serveur de la catégorie choisie.

- [ ] **Step 1 : Écrire le test qui échoue**

```typescript
// dans bookings.service.spec.ts — nouveau describe
describe('createBooking — gating catégories', () => {
  it('refuse une catégorie verrouillée non payée', async () => {
    // bronze, vehicleType=confort, purchasedPerks=[]  → doit throw
    mockUsers.getPassengerTier.mockResolvedValue('bronze');
    await expect(service.createBooking('u-1', {
      ...baseDto, vehicleType: 'confort', purchasedPerks: [],
    } as any)).rejects.toThrow(/non débloquée|verrouillée|forbidden/i);
  });

  it('accepte une catégorie verrouillée payée et débite les points', async () => {
    mockUsers.getPassengerTier.mockResolvedValue('bronze');
    await service.createBooking('u-1', {
      ...baseDto, vehicleType: 'confort', purchasedPerks: ['category:confort'],
    } as any);
    expect(mockPoints.deductPointsTx).toHaveBeenCalledWith(
      expect.anything(), 'u-1', 120, expect.stringContaining('confort'),
    );
  });
});
```

Adapter `baseDto`, `mockUsers`, `mockPoints`, `mockLoyalty` aux mocks existants du fichier (s'inspirer de `mockDispatch`). Ajouter au besoin un `mockLoyalty = { resolveAvailability: jest.fn(), effectiveTier: jest.fn(), costOf: jest.fn(async () => 120) }` et l'injecter.

- [ ] **Step 2 : Lancer → échec**

Run: `cd /home/aragami/aerogo24V2/aerocab-deploy/backend && npx jest src/bookings/bookings.service.spec.ts -t "gating catégories"`
Expected: FAIL (pas de validation → la catégorie verrouillée passe).

- [ ] **Step 3 : Implémenter le gating**

Injecter `LoyaltyService` et `PointsService` dans le constructeur de `BookingsService` (s'ils n'y sont pas déjà). Dans `createBooking`, juste avant la transaction/création :

```typescript
// Gating fidélité — revalidation SERVEUR (ne jamais faire confiance au front)
const perks: string[] = Array.isArray(dto.purchasedPerks) ? dto.purchasedPerks : [];
const passengerTier = await this.usersService.getPassengerTier(passengerId).catch(() => 'bronze');
const avail = await this.loyaltyService.resolveAvailability(passengerTier as any, bookingCountryCode, dto.vehicleType);
const cat = avail.categories.find(c => c.key === dto.vehicleType);
if (cat && !cat.unlocked) {
  // catégorie verrouillée → doit être explicitement achetée
  if (!perks.includes(`category:${dto.vehicleType}`)) {
    throw new ForbiddenException(`Catégorie ${dto.vehicleType} non débloquée pour votre niveau`);
  }
}
const effTier = await this.loyaltyService.effectiveTier(passengerTier as any, perks, bookingCountryCode);
```

Ne débiter (et donc ne stocker dans `purchasedPerks`) QUE les perks réellement payés — jamais un perk déjà inclus par le niveau :

```typescript
const includedServices = avail.services.filter(s => s.included).map(s => s.key);
const isIncludedFree = (perk: string): boolean => {
  if (perk.startsWith('category:')) {
    const key = perk.slice('category:'.length);
    return !!avail.categories.find(c => c.key === key && c.unlocked);
  }
  return includedServices.includes(perk);
};
// perks réellement à facturer = demandés ET non déjà inclus
const paidPerks = perks.filter(p => !isIncludedFree(p));
```

Puis, dans la **transaction Prisma** qui crée le booking, débiter les perks payants et persister la vérité de facturation :

```typescript
return this.prisma.$transaction(async (tx) => {
  for (const perk of paidPerks) {
    const cost = await this.loyaltyService.costOf(perk, bookingCountryCode);
    if (cost > 0) {
      await this.pointsService.deductPointsTx(tx, passengerId, cost, `Upgrade fidélité: ${perk}`);
    }
  }
  const booking = await tx.booking.create({
    data: { /* …champs existants… */, purchasedPerks: paidPerks, effectiveTier: effTier },
  });
  return booking;
});
```

Adapter à la structure réelle de `createBooking` (si la création n'est pas déjà dans une `$transaction`, l'y envelopper pour garantir l'atomicité points↔booking). Importer `ForbiddenException` depuis `@nestjs/common`.

- [ ] **Step 4 : Lancer → succès**

Run: `cd /home/aragami/aerogo24V2/aerocab-deploy/backend && npx jest src/bookings/bookings.service.spec.ts -t "gating catégories"`
Expected: PASS (2 tests).

- [ ] **Step 5 : Lancer toute la suite bookings (non-régression)**

Run: `cd /home/aragami/aerogo24V2/aerocab-deploy/backend && npx jest src/bookings/bookings.service.spec.ts`
Expected: tous PASS (mettre à jour les mocks si de nouveaux appels cassent d'anciens tests).

- [ ] **Step 6 : Commit**

```bash
cd /home/aragami/aerogo24V2/aerocab-deploy
git add backend/src/bookings/bookings.service.ts backend/src/bookings/bookings.service.spec.ts
git commit -m "feat(loyalty): gating catégories + dépense points atomique dans createBooking"
```

---

### Task 9 : Mobile — `vehicle.tsx` catégories verrouillées/débloquées

**Files:**
- Modify: `aerocab-native/aerocab-passenger/app/(booking)/vehicle.tsx`
- Modify: `aerocab-native/aerocab-passenger/services/api.ts`

- [ ] **Step 1 : Ajouter l'appel API options**

```typescript
// services/api.ts
getLoyaltyOptions: (token: string, vehicleType: string, country?: string) =>
  request(`/loyalty/options?vehicleType=${encodeURIComponent(vehicleType)}${country ? `&country=${country}` : ''}`, { token }),
```

- [ ] **Step 2 : Afficher l'état (dé)verrouillé sur chaque catégorie**

Au chargement de l'écran véhicule, appeler `api.getLoyaltyOptions(token, selectedVehicleType, country)` et indexer le résultat par `key`. Pour chaque carte catégorie :
- si `unlocked` → sélectionnable normalement ;
- si verrouillée → style grisé + badge **« 🔒 Débloquer · {cost} pts »** ; au tap, demander confirmation puis marquer la catégorie pour envoi avec `purchasedPerks: ['category:<key>']` au moment de réserver.

```tsx
// extrait — adapter au rendu existant des catégories
const [opts, setOpts] = useState<Record<string, { unlocked: boolean; cost: number }>>({});
useEffect(() => {
  if (!token) return;
  api.getLoyaltyOptions(token, vehicleType, country)
    .then((r: any) => setOpts(Object.fromEntries(r.categories.map((c: any) => [c.key, c]))))
    .catch(() => {});
}, [token, vehicleType, country]);

const meta = opts[cat.key];
const locked = meta && !meta.unlocked;
// rendu: {locked && <Text style={styles.lockBadge}>🔒 Débloquer · {meta.cost} pts</Text>}
```

Stocker le(s) perk(s) catégorie choisi(s) dans le state de réservation pour les transmettre à `createBooking`.

- [ ] **Step 3 : Vérifier le typecheck**

Run: `cd /home/aragami/aerogo24V2/aerocab-native/aerocab-passenger && npx tsc --noEmit -p tsconfig.json`
Expected: exit 0.

- [ ] **Step 4 : Commit**

```bash
cd /home/aragami/aerogo24V2/aerocab-native/aerocab-passenger
git add "app/(booking)/vehicle.tsx" services/api.ts
git commit -m "feat(loyalty): vehicle.tsx catégories verrouillées + déblocage points"
```

---

### Task 10 : Mobile — `summary.tsx` récap perks

**Files:**
- Modify: `aerocab-native/aerocab-passenger/app/(booking)/summary.tsx`

- [ ] **Step 1 : Afficher les perks achetés + total points, séparé du prix cash**

Ajouter un bloc (au-dessus du bandeau « espèces » existant) listant les perks choisis et le total de points qui sera débité :

```tsx
{purchasedPerks.length > 0 && (
  <View style={styles.perksBox}>
    <Text style={styles.perksTitle}>Avantages activés</Text>
    {purchasedPerks.map((p) => <Text key={p} style={styles.perkItem}>• {labelOfPerk(p)}</Text>)}
    <Text style={styles.perksTotal}>− {totalPerkPoints} pts</Text>
    <Text style={styles.cashNote}>Le prix de la course reste payé en espèces au chauffeur.</Text>
  </View>
)}
```

Transmettre `purchasedPerks` dans l'appel `createBooking` existant.

- [ ] **Step 2 : Vérifier le typecheck**

Run: `cd /home/aragami/aerogo24V2/aerocab-native/aerocab-passenger && npx tsc --noEmit -p tsconfig.json`
Expected: exit 0.

- [ ] **Step 3 : Commit**

```bash
cd /home/aragami/aerogo24V2/aerocab-native/aerocab-passenger
git add "app/(booking)/summary.tsx"
git commit -m "feat(loyalty): summary.tsx récap perks + points (séparé du prix cash)"
```

---

## LOT 3 — Services (dispatch prioritaire / top-rated / garanti)

### Task 11 : Brancher `effectiveTier` sur le dispatch

**Files:**
- Modify: `aerocab-deploy/backend/src/bookings/bookings.service.ts` (zone dispatch ~722)

- [ ] **Step 1 : Utiliser le tier effectif du booking au lieu du tier réel**

Là où le code calcule actuellement `passengerTierForDispatch = await this.usersService.getPassengerTier(passengerId)`, utiliser le tier effectif calculé/persisté (`effTier` de Task 8) :

```typescript
const passengerTierForDispatch = booking.effectiveTier
  ?? await this.usersService.getPassengerTier(passengerId).catch(() => 'bronze');
```

- [ ] **Step 2 : Vérifier compilation + non-régression dispatch**

Run: `cd /home/aragami/aerogo24V2/aerocab-deploy/backend && npx tsc --noEmit && npx jest src/bookings/`
Expected: tsc 0 erreur, tests PASS.

- [ ] **Step 3 : Commit**

```bash
cd /home/aragami/aerogo24V2/aerocab-deploy
git add backend/src/bookings/bookings.service.ts
git commit -m "feat(loyalty): dispatch utilise effectiveTier (priority acheté = pool élargi)"
```

---

### Task 12 : Filtre `top_rated` dans le dispatch (TDD)

**Files:**
- Modify: `aerocab-deploy/backend/src/bookings/dispatch.service.ts`
- Create/Modify: `aerocab-deploy/backend/src/bookings/dispatch.service.spec.ts`

- [ ] **Step 1 : Test qui échoue**

```typescript
// dispatch.service.spec.ts
it('filtre les chauffeurs sous le seuil top-rated quand le perk est actif', async () => {
  // injecter un settings mock renvoyant top_rated_min_rating=4.8
  // booking.purchasedPerks inclut 'top_rated' (ou tier l'inclut)
  // findEligibleDrivers ne doit retourner que ratingAvg >= 4.8
  const drivers = await service.findEligibleDrivers(
    { purchasedPerks: ['top_rated'], operatingCountry: 'CM' } as any, false, undefined, 'platinum',
  );
  expect(drivers.every((d: any) => (d.ratingAvg ?? 0) >= 4.8)).toBe(true);
});
```

Adapter aux mocks Prisma/settings du fichier (s'il n'existe pas, créer un harnais minimal mockant `prisma.driver.findMany`).

- [ ] **Step 2 : Lancer → échec**

Run: `cd /home/aragami/aerogo24V2/aerocab-deploy/backend && npx jest src/bookings/dispatch.service.spec.ts -t top-rated`
Expected: FAIL.

- [ ] **Step 3 : Implémenter le filtre**

Dans `findEligibleDrivers`, après récupération des chauffeurs candidats et avant le tri/`take`, si le booking porte `top_rated` (via `booking.purchasedPerks` ou la matrice du tier), appliquer :

Perk **actif** = payé (`purchasedPerks`) **OU** inclus par le niveau (via `resolveAvailability` sur le tier effectif) :

```typescript
const perks: string[] = (booking as any)?.purchasedPerks ?? [];
const country = (booking as any)?.operatingCountry ?? null;
const tier = (booking as any)?.effectiveTier ?? passengerTier ?? 'bronze';
const avail = await this.loyaltyService.resolveAvailability(tier, country, (booking as any)?.vehicleType ?? 'standard');
const includedTopRated = avail.services.find(s => s.key === 'top_rated')?.included ?? false;
const wantsTopRated = perks.includes('top_rated') || includedTopRated;
if (wantsTopRated) {
  const minRating = await this.loyaltyService.topRatedMinRating(country);
  const filtered = candidates.filter(d => (d.ratingAvg ?? 0) >= minRating);
  if (filtered.length > 0) candidates = filtered; // repli : si vide, on n'abandonne pas la course
}
```

Injecter `LoyaltyService` dans `DispatchService` (constructeur + imports du module). Le booking transmis par `bookings.service.ts`/`scheduler` doit inclure `purchasedPerks`, `effectiveTier`, `vehicleType` — les ajouter au `select` Prisma si l'objet est restreint.

- [ ] **Step 4 : Lancer → succès**

Run: `cd /home/aragami/aerogo24V2/aerocab-deploy/backend && npx jest src/bookings/dispatch.service.spec.ts -t top-rated`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
cd /home/aragami/aerogo24V2/aerocab-deploy
git add backend/src/bookings/dispatch.service.ts backend/src/bookings/dispatch.service.spec.ts
git commit -m "feat(loyalty): filtre chauffeur top-rated (seuil configurable, repli si vide)"
```

---

### Task 13 : Remboursement « course garantie » idempotent (TDD)

**Files:**
- Modify: `aerocab-deploy/backend/src/bookings/bookings.scheduler.ts`
- Modify/Create: `aerocab-deploy/backend/src/bookings/bookings.scheduler.spec.ts`

- [ ] **Step 1 : Test qui échoue**

```typescript
// bookings.scheduler.spec.ts
it('rembourse les points garanti une seule fois quand aucun chauffeur', async () => {
  const booking = { id: 'b1', passengerId: 'u1', purchasedPerks: ['guaranteed'],
                    operatingCountry: 'CM', guaranteedRefunded: false } as any;
  await scheduler.refundGuaranteedIfUnmatched(booking);   // 1er passage → rembourse
  await scheduler.refundGuaranteedIfUnmatched({ ...booking, guaranteedRefunded: true }); // 2e → non
  expect(mockPoints.addPoints).toHaveBeenCalledTimes(1);
  expect(mockPoints.addPoints).toHaveBeenCalledWith('u1', 200, expect.any(String), 'refund');
});
```

Adapter aux mocks du fichier (créer `mockPoints`, `mockLoyalty.costOf -> 200`, `mockPrisma.booking.update`).

- [ ] **Step 2 : Lancer → échec**

Run: `cd /home/aragami/aerogo24V2/aerocab-deploy/backend && npx jest src/bookings/bookings.scheduler.spec.ts -t garanti`
Expected: FAIL — `scheduler.refundGuaranteedIfUnmatched is not a function`.

- [ ] **Step 3 : Implémenter**

```typescript
// bookings.scheduler.ts — nouvelle méthode, appelée là où le re-dispatch conclut "aucun chauffeur"
async refundGuaranteedIfUnmatched(booking: any): Promise<void> {
  const perks: string[] = booking?.purchasedPerks ?? [];
  if (!perks.includes('guaranteed') || booking.guaranteedRefunded) return;
  const cost = await this.loyaltyService.costOf('guaranteed', booking.operatingCountry ?? null);
  if (cost <= 0) return;
  await this.prisma.booking.update({ where: { id: booking.id }, data: { guaranteedRefunded: true } });
  await this.pointsService.addPoints(booking.passengerId, cost, 'Remboursement course garantie', 'refund');
  await this.notifications.sendToUser(
    booking.passengerId, 'Course garantie',
    'Aucun chauffeur trouvé : vos points ont été remboursés.',
  ).catch(() => {});
}
```

Appeler `await this.refundGuaranteedIfUnmatched(booking)` au point exact où le scheduler marque une course `no_driver_available` (chercher `no_driver_available` dans le fichier). Injecter `LoyaltyService` + `PointsService` si absents.

- [ ] **Step 4 : Lancer → succès**

Run: `cd /home/aragami/aerogo24V2/aerocab-deploy/backend && npx jest src/bookings/bookings.scheduler.spec.ts -t garanti`
Expected: PASS.

- [ ] **Step 5 : Vérifier compilation globale + suite bookings**

Run: `cd /home/aragami/aerogo24V2/aerocab-deploy/backend && npx tsc --noEmit && npx jest src/bookings/ src/loyalty/`
Expected: tsc 0 erreur, tous PASS.

- [ ] **Step 6 : Commit**

```bash
cd /home/aragami/aerogo24V2/aerocab-deploy
git add backend/src/bookings/bookings.scheduler.ts backend/src/bookings/bookings.scheduler.spec.ts
git commit -m "feat(loyalty): remboursement course garantie idempotent"
```

---

## Notes d'intégration & déploiement

- **Config initiale (optionnelle)** : les défauts (`DEFAULT_TIER_MATRIX`, etc.) suffisent pour démarrer. Pour personnaliser, insérer les clés `tier_matrix` / `upgrade_costs` / `top_rated_min_rating` (ou `:CC`) dans `app_settings` via l'admin.
- **Sécurité** : toute validation de perk est refaite côté serveur (Task 8) ; le front est purement indicatif.
- **Cash inchangé** : aucun calcul de prix course n'est modifié — les points sont un droit d'accès, pas une remise.
- **Déploiement backend** : `db push` (Task 6) avant de déployer l'image. Mobile : nouvel APK passager (bump version) pour les écrans.
- **Lot 2 (futur)** : annulation flexible, réservation programmée (`scheduledAt` existe déjà), Meet & Greet — non couverts ici.
