# Fidélité progressive — Lot 2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter 4 services premium (annulation flexible, gating réservation programmée, Meet & Greet cash, chauffeur favori) par-dessus le framework de fidélité du Lot 1.

**Architecture:** Réutilise le Lot 1 — services dans `tier_matrix`/`upgrade_costs` (cascade pays), `Booking.purchasedPerks`, `effectiveTier`, `deductPointsTx`, `LoyaltyService.resolveAvailability`. Nouveau helper DRY `isServiceActive`. Meet & Greet = supplément cash hors points. Chauffeur favori = table `FavoriteDriver` + dispatch attente courte, universel.

**Tech Stack:** NestJS, Prisma, Jest/ts-jest (backend) ; Expo/React Native (apps passager + chauffeur).

**Conventions tests :** `cd /home/aragami/aerogo24V2/aerocab-deploy/backend && ./node_modules/.bin/jest <chemin> -t "<nom>"`. tsc : `./node_modules/.bin/tsc --noEmit`. Mobile : `./node_modules/.bin/tsc --noEmit -p tsconfig.json` dans chaque app.

**Contraintes environnement :** AUCUN `git commit` (serveur Git injoignable + WIP non lié) — laisser les fichiers modifiés. `prisma generate` OUI, `prisma db push` NON (prod). Ne pas sweeper le WIP des fichiers modifiés.

**Hooks vérifiés :**
- `cancelBooking` (bookings.service.ts) : `const refundRate = isLateCancel ? lateCancelRate : 1.0;` (~ligne 1418).
- `createBooking` : prix en points `bookingPricePoints` (~615) → `pointsAfterDiscount` (~646) → `estimatedPrice`. `rawScheduledAt = dto.scheduledAt ? new Date(...) : null` (~501). ⚠️ INTERNATIONAL définit `scheduledAt` AUTOMATIQUEMENT (heure du vol) → le gating `scheduled` ne vise QUE la programmation choisie par l'utilisateur (`dto.type !== 'INTERNATIONAL'`).
- Driver : `aerocab-driver/app/(tabs)/ride-request.tsx` (affiche déjà `passengerName`).
- Passager : `aerocab-passenger/app/(tabs)/rate-driver.tsx`.

---

## File Structure

**Backend**
- `src/loyalty/loyalty.constants.ts` — ajouter `flex_cancel`, `scheduled` à `ServiceKey`/`ALL_SERVICES` ; défauts matrice/coûts.
- `src/loyalty/loyalty.service.ts` — helper `isServiceActive`.
- `src/bookings/bookings.service.ts` — hook `cancelBooking` (flex), gating `scheduled` + fee M&G dans `createBooking`.
- `src/bookings/dto/create-booking.dto.ts` — `meetAndGreet?`, `preferFavorite?`.
- `prisma/schema.prisma` — `Booking.meetAndGreet`, `model FavoriteDriver`.
- `src/favorites/` (nouveau) — `favorites.service.ts`, `favorites.controller.ts`, `favorites.module.ts`.
- `src/bookings/dispatch.service.ts` — biais favori (attente courte).

**Mobile passager** — `app/(booking)/summary.tsx` (toggles services + M&G), `app/(tabs)/rate-driver.tsx` (ajout favori), `app/(tabs)/favorites.tsx` (nouveau, liste), `services/api.ts`.

**Mobile chauffeur** — `app/(tabs)/ride-request.tsx` (pancarte M&G + badge fidèle), `services/api.ts`.

---

## GROUPE 1 — Annulation flexible

### Task 1.1 : Constantes + helper `isServiceActive` (TDD)

**Files:**
- Modify: `src/loyalty/loyalty.constants.ts`
- Modify: `src/loyalty/loyalty.service.ts`
- Test: `src/loyalty/loyalty.service.spec.ts`

- [ ] **Step 1 : Étendre ServiceKey + ALL_SERVICES**

```typescript
// loyalty.constants.ts
export type ServiceKey = 'priority' | 'top_rated' | 'guaranteed' | 'flex_cancel' | 'scheduled';
export const ALL_SERVICES: ServiceKey[] = ['priority', 'top_rated', 'guaranteed', 'flex_cancel', 'scheduled'];
```
Et ajouter aux défauts : `DEFAULT_TIER_MATRIX.platinum.services` inclut `'flex_cancel'` ; `DEFAULT_TIER_MATRIX.silver/gold/platinum.services` incluent `'scheduled'` ; `DEFAULT_UPGRADE_COSTS` : `flex_cancel: 75, scheduled: 100`.

- [ ] **Step 2 : Test isServiceActive (rouge)**

```typescript
// loyalty.service.spec.ts
describe('LoyaltyService.isServiceActive', () => {
  it('vrai si le perk est payé', async () => {
    const svc = new LoyaltyService(makeSettings(), {} as any, {} as any);
    expect(await svc.isServiceActive(['flex_cancel'], 'bronze', 'CM', 'flex_cancel')).toBe(true);
  });
  it('vrai si inclus par le niveau', async () => {
    const svc = new LoyaltyService(makeSettings(), {} as any, {} as any);
    expect(await svc.isServiceActive([], 'platinum', 'CM', 'flex_cancel')).toBe(true);
  });
  it('faux sinon', async () => {
    const svc = new LoyaltyService(makeSettings(), {} as any, {} as any);
    expect(await svc.isServiceActive([], 'bronze', 'CM', 'flex_cancel')).toBe(false);
  });
});
```

- [ ] **Step 3 : Lancer (rouge)**

Run: `cd /home/aragami/aerogo24V2/aerocab-deploy/backend && ./node_modules/.bin/jest src/loyalty/loyalty.service.spec.ts -t isServiceActive`
Expected: FAIL — `isServiceActive is not a function`.

- [ ] **Step 4 : Implémenter**

```typescript
// loyalty.service.ts
async isServiceActive(perks: string[], tier: TierKey, country: string | null, service: ServiceKey): Promise<boolean> {
  if (perks.includes(service)) return true;
  const avail = await this.resolveAvailability(tier, country, 'standard');
  return avail.services.find((s) => s.key === service)?.included ?? false;
}
```

- [ ] **Step 5 : Lancer (vert) + non-régression loyalty**

Run: `./node_modules/.bin/jest src/loyalty/`
Expected: tous PASS.

- [ ] **Step 6 : Commit** — `git add src/loyalty/ ; git commit -m "feat(loyalty): isServiceActive + services flex_cancel/scheduled"` → **NE PAS COMMITTER** (contrainte env). Laisser modifié.

### Task 1.2 : Hook flex_cancel dans `cancelBooking` (TDD)

**Files:**
- Modify: `src/bookings/bookings.service.ts` (~ligne 1418)
- Modify: `src/bookings/bookings.service.spec.ts`

- [ ] **Step 1 : Test (rouge)**

```typescript
// bookings.service.spec.ts — nouveau describe
describe('cancelBooking — annulation flexible', () => {
  it('annulation tardive AVEC flex_cancel actif → aucune pénalité (refund 100%)', async () => {
    mockLoyalty.isServiceActive.mockResolvedValue(true);
    // booking late (arrived_at_airport), purchasedPerks ['flex_cancel']
    const res = await service.cancelBooking('u-1', 'bk-late-flex');
    // pointsToRefund == price (refundRate 1.0), penaltyPoints == 0
    expect(res /* selon retour */).toBeDefined();
    // vérifier via spy sur addPoints/refund que le montant remboursé = price total
  });
  it('annulation tardive SANS flex_cancel → pénalité appliquée', async () => {
    mockLoyalty.isServiceActive.mockResolvedValue(false);
    // refundRate == lateCancelRate (0.5)
  });
});
```
Adapter aux mocks/retours réels de `cancelBooking` (s'inspirer des tests d'annulation existants ; mocker `mockLoyalty.isServiceActive`).

- [ ] **Step 2 : Lancer (rouge)**

Run: `./node_modules/.bin/jest src/bookings/bookings.service.spec.ts -t "annulation flexible"`
Expected: FAIL.

- [ ] **Step 3 : Implémenter le hook**

Remplacer (~ligne 1418) :
```typescript
const isLateCancel = booking.status === 'arrived_at_airport' || isLateCancelBy48h;
const price = Number(booking.estimatedPrice) || 0;
const lateCancelRate = parseFloat(await this.settingsService.getForCountry('late_cancel_refund_rate', booking.operatingCountry ?? null, '0.5')) || 0.5;
// Lot 2 — annulation flexible : perk actif (payé ou inclus) → aucune pénalité
const flexActive = await this.loyaltyService.isServiceActive(
  (booking.purchasedPerks as string[]) ?? [],
  (booking.effectiveTier as any) ?? (await this.usersService.getPassengerTier(passengerId).catch(() => 'bronze')),
  booking.operatingCountry ?? null,
  'flex_cancel',
);
const refundRate = (isLateCancel && !flexActive) ? lateCancelRate : 1.0;
```
(`loyaltyService` est déjà injecté depuis le Lot 1.)

- [ ] **Step 4 : Lancer (vert) + suite bookings**

Run: `./node_modules/.bin/jest src/bookings/bookings.service.spec.ts`
Expected: tous PASS.

- [ ] **Step 5 : tsc** — `./node_modules/.bin/tsc --noEmit` → 0 erreur. (Pas de commit.)

### Task 1.3 : UI passager — toggles services premium (dont flex_cancel)

**Files:**
- Modify: `aerocab-native/aerocab-passenger/app/(booking)/summary.tsx`
- Modify: `aerocab-native/aerocab-passenger/services/api.ts`

> `GET /loyalty/options` renvoie déjà `services:[{key,included,cost}]` (inclut désormais flex_cancel/scheduled). Ajouter une section « Options premium » avec un toggle par service NON inclus (affiche le coût) ; un toggle activé ajoute `<key>` à `purchasedPerks`.

- [ ] **Step 1 : Charger les options** — appeler `api.getLoyaltyOptions(token, vehicleType, country)` dans `summary.tsx` (méthode déjà ajoutée au Lot 1) ; stocker `services`.
- [ ] **Step 2 : Section toggles** — pour chaque `service` où `!included`, afficher une ligne « {label} · {cost} pts » avec un `Switch` ; à l'activation, `setPurchasedPerks(prev => [...prev, key])` (et retirer à la désactivation). Mapper les libellés (`flex_cancel`→« Annulation flexible », etc.). Les services `included` peuvent s'afficher en « inclus ✓ » non togglables.
- [ ] **Step 3 : tsc** — `./node_modules/.bin/tsc --noEmit -p tsconfig.json` → 0. (Pas de commit.)

---

## GROUPE 2 — Réservation programmée (gating)

### Task 2.1 : Gating `scheduled` dans `createBooking` (TDD)

**Files:**
- Modify: `src/bookings/bookings.service.ts` (~ligne 501, après lecture de `rawScheduledAt`)
- Modify: `src/bookings/bookings.service.spec.ts`

- [ ] **Step 1 : Test (rouge)**

```typescript
describe('createBooking — gating réservation programmée', () => {
  it('refuse une programmation choisie sans perk scheduled', async () => {
    mockUsers.getPassengerTier.mockResolvedValue('bronze');
    mockLoyalty.resolveAvailability.mockResolvedValue({ categories: [{key:'standard',unlocked:true,cost:0}], services: [{key:'scheduled',included:false,cost:100}] });
    await expect(service.createBooking('u-1', {
      ...baseDto, type: 'DEPARTURE', scheduledAt: new Date(Date.now()+3*3600e3).toISOString(), purchasedPerks: [],
    } as any)).rejects.toThrow(/programmée non débloquée|scheduled/i);
  });
  it('accepte si scheduled inclus par le niveau', async () => {
    mockUsers.getPassengerTier.mockResolvedValue('silver');
    mockLoyalty.resolveAvailability.mockResolvedValue({ categories: [{key:'standard',unlocked:true,cost:0}], services: [{key:'scheduled',included:true,cost:0}] });
    await expect(service.createBooking('u-1', { ...baseDto, type: 'DEPARTURE', scheduledAt: new Date(Date.now()+3*3600e3).toISOString() } as any)).resolves.toBeDefined();
  });
});
```

- [ ] **Step 2 : Lancer (rouge)**

Run: `./node_modules/.bin/jest src/bookings/bookings.service.spec.ts -t "gating réservation programmée"`
Expected: FAIL.

- [ ] **Step 3 : Implémenter le gating** (dans le bloc gating Lot 1, après calcul de `loyaltyAvail`/`perks`/`passengerTier`)

```typescript
// Lot 2 — gating réservation programmée (uniquement programmation CHOISIE, pas INTERNATIONAL auto)
if (rawScheduledAt && dto.type !== 'INTERNATIONAL') {
  const schedActive = perks.includes('scheduled')
    || (loyaltyAvail.services.find((s) => s.key === 'scheduled')?.included ?? false);
  if (!schedActive) {
    throw new ForbiddenException('Réservation programmée non débloquée pour votre niveau');
  }
}
```
⚠️ Placer ce bloc APRÈS que `rawScheduledAt`, `perks` et `loyaltyAvail` sont tous disponibles (réordonner si besoin — `rawScheduledAt` est calculé ~501, le bloc gating Lot 1 ~784 : mettre ce test dans le bloc gating, il a accès à `rawScheduledAt`). Si `scheduled` est dans `perks` (acheté), il sera débité par la boucle `paidPerks` existante du Lot 1.

- [ ] **Step 4 : Lancer (vert) + suite** — `./node_modules/.bin/jest src/bookings/bookings.service.spec.ts` → PASS. tsc 0. (Pas de commit.)

### Task 2.2 : UI passager — option « programmer » verrouillée

**Files:**
- Modify: l'écran où le passager choisit l'heure de course (chercher `scheduledAt`/DateTimePicker : `grep -rn "scheduledAt\|DateTimePicker\|programmer" aerocab-native/aerocab-passenger/app`)

- [ ] **Step 1 :** Si `services['scheduled'].included === false`, afficher l'option « Programmer » avec un badge « 🔒 {cost} pts » ; à la sélection, ajouter `'scheduled'` à `purchasedPerks` (confirmation). Si `included`, comportement normal.
- [ ] **Step 2 : tsc** → 0. (Pas de commit.)

---

## GROUPE 3 — Meet & Greet (supplément cash)

### Task 3.1 : Schéma + DTO

**Files:**
- Modify: `prisma/schema.prisma` (model Booking)
- Modify: `src/bookings/dto/create-booking.dto.ts`

- [ ] **Step 1 :** Ajouter au model Booking : `meetAndGreet Boolean @default(false) @map("meet_and_greet")`. (N'ajouter QUE cette ligne — WIP non lié.)
- [ ] **Step 2 :** `./node_modules/.bin/prisma generate` (PAS db push).
- [ ] **Step 3 :** DTO : `@IsOptional() @IsBoolean() meetAndGreet?: boolean;` (+ import `IsBoolean` si absent).
- [ ] **Step 4 : tsc** → 0. (Pas de commit.)

### Task 3.2 : Fee M&G dans `createBooking` (TDD)

**Files:**
- Modify: `src/bookings/bookings.service.ts` (~ligne 615, après `bookingPricePoints = finalPricePoints`)
- Modify: `src/bookings/bookings.service.spec.ts`

- [ ] **Step 1 : Test (rouge)**

```typescript
describe('createBooking — Meet & Greet', () => {
  it('ajoute meet_greet_fee au prix quand meetAndGreet=true', async () => {
    mockSettings.getForCountry.mockImplementation(async (k:string,_c:any,d:string) => k==='meet_greet_fee' ? '2000' : d);
    const b = await service.createBooking('u-1', { ...baseDto, meetAndGreet: true } as any);
    const bWithout = await service.createBooking('u-1', { ...baseDto, meetAndGreet: false } as any);
    expect(Number(b.estimatedPrice) - Number(bWithout.estimatedPrice)).toBe(2000);
  });
});
```
Adapter au retour réel (vérifier `estimatedPrice` du booking créé, ou spyer la valeur écrite).

- [ ] **Step 2 : Lancer (rouge)** — `./node_modules/.bin/jest ... -t "Meet & Greet"` → FAIL.

- [ ] **Step 3 : Implémenter** (après `let bookingPricePoints = finalPricePoints;` ~615)

```typescript
// Lot 2 — Meet & Greet : supplément cash (en points-unité, 1 pt = 1 unité de prix) ajouté au prix course
let meetGreetFee = 0;
if (dto.meetAndGreet) {
  meetGreetFee = parseInt(await this.settingsService.getForCountry('meet_greet_fee', bookingCountryCode, '0'), 10) || 0;
  bookingPricePoints += meetGreetFee;
}
```
Et persister `meetAndGreet: !!dto.meetAndGreet` dans le `booking.create` data.

- [ ] **Step 4 : Lancer (vert) + suite** → PASS. tsc 0. (Pas de commit.)

### Task 3.3 : UI passager toggle + UI chauffeur pancarte

**Files:**
- Modify: `aerocab-native/aerocab-passenger/app/(booking)/summary.tsx`
- Modify: `aerocab-native/aerocab-driver/app/(tabs)/ride-request.tsx`

- [ ] **Step 1 (passager) :** toggle « Meet & Greet (+{meet_greet_fee}) » ; à l'activation, passer `meetAndGreet: true` dans `createBooking` et ajouter le montant au récap prix affiché. Récupérer le montant via une nouvelle clé exposée (ajouter `meetGreetFee` à la réponse `/loyalty/options` OU lire depuis le bundle settings public si déjà exposé — vérifier `PUBLIC_SETTING_KEYS`).
- [ ] **Step 2 (chauffeur) :** dans `ride-request.tsx`, si `booking.meetAndGreet`, afficher un bloc bien visible « 🪧 Meet & Greet — {passengerName} » (passengerName déjà disponible). Vérifier que `meetAndGreet` est inclus dans le payload de la course envoyé au chauffeur (sinon l'ajouter au `select`/DTO de dispatch côté backend).
- [ ] **Step 3 : tsc** des 2 apps → 0. (Pas de commit.)

---

## GROUPE 4 — Chauffeur favori (universel, attente courte)

### Task 4.1 : Table FavoriteDriver + module favorites (TDD)

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `src/favorites/favorites.service.ts`, `favorites.controller.ts`, `favorites.module.ts`, `favorites.service.spec.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1 : Schéma**

```prisma
model FavoriteDriver {
  id           String         @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  passengerId  String         @map("passenger_id") @db.Uuid
  driverId     String         @map("driver_id") @db.Uuid
  createdAt    DateTime       @default(now()) @map("created_at")
  passenger    User           @relation("PassengerFavorites", fields: [passengerId], references: [id], onDelete: Cascade)
  driver       DriverProfile  @relation(fields: [driverId], references: [id], onDelete: Cascade)
  @@unique([passengerId, driverId])
  @@map("favorite_drivers")
}
```
Ajouter les relations inverses sur `User` (`favoriteDrivers FavoriteDriver[] @relation("PassengerFavorites")`) et `DriverProfile` (`favoritedBy FavoriteDriver[]`). Puis `./node_modules/.bin/prisma generate` (PAS db push). Vérifier les noms exacts des modèles `User`/`DriverProfile` dans le schéma.

- [ ] **Step 2 : Test service (rouge)**

```typescript
// favorites.service.spec.ts
describe('FavoritesService', () => {
  it('toggle ajoute puis retire (idempotent unique)', async () => {
    const prisma = { favoriteDriver: {
      findUnique: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'f1' }),
      create: jest.fn().mockResolvedValue({ id: 'f1' }),
      delete: jest.fn().mockResolvedValue({}),
    } } as any;
    const svc = new FavoritesService(prisma);
    expect(await svc.toggle('p1', 'd1')).toEqual({ favorited: true });
    expect(await svc.toggle('p1', 'd1')).toEqual({ favorited: false });
  });
});
```

- [ ] **Step 3 : Lancer (rouge)** → FAIL (module absent).

- [ ] **Step 4 : Implémenter service + controller + module**

```typescript
// favorites.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class FavoritesService {
  constructor(private readonly prisma: PrismaService) {}

  async toggle(passengerId: string, driverId: string): Promise<{ favorited: boolean }> {
    const existing = await this.prisma.favoriteDriver.findUnique({
      where: { passengerId_driverId: { passengerId, driverId } },
    });
    if (existing) {
      await this.prisma.favoriteDriver.delete({ where: { id: existing.id } });
      return { favorited: false };
    }
    await this.prisma.favoriteDriver.create({ data: { passengerId, driverId } });
    return { favorited: true };
  }

  async list(passengerId: string) {
    return this.prisma.favoriteDriver.findMany({
      where: { passengerId },
      include: { driver: { select: { id: true, userId: true, ratingAvg: true, vehicleBrand: true, vehicleModel: true } } },
    });
  }

  async driverIds(passengerId: string): Promise<string[]> {
    const rows = await this.prisma.favoriteDriver.findMany({ where: { passengerId }, select: { driverId: true } });
    return rows.map((r) => r.driverId);
  }

  async isFavorite(passengerId: string, driverId: string): Promise<boolean> {
    const row = await this.prisma.favoriteDriver.findUnique({ where: { passengerId_driverId: { passengerId, driverId } } });
    return !!row;
  }
}
```
Vérifier le nom exact du client Prisma pour la clé composée (`passengerId_driverId`) après `prisma generate`. Adapter `vehicleBrand/vehicleModel/ratingAvg` aux champs réels de `DriverProfile`.

```typescript
// favorites.controller.ts
import { Controller, Post, Get, Param, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards';
import { CurrentUser } from '../auth/decorators';
import { FavoritesService } from './favorites.service';

@Controller()
@SkipThrottle()
@UseGuards(JwtAuthGuard)
export class FavoritesController {
  constructor(private readonly favorites: FavoritesService) {}

  @Post('drivers/:driverId/favorite')
  toggle(@CurrentUser('id') userId: string, @Param('driverId') driverId: string) {
    return this.favorites.toggle(userId, driverId);
  }

  @Get('me/favorites')
  list(@CurrentUser('id') userId: string) {
    return this.favorites.list(userId);
  }
}
```

```typescript
// favorites.module.ts
import { Module } from '@nestjs/common';
import { FavoritesService } from './favorites.service';
import { FavoritesController } from './favorites.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({ imports: [PrismaModule], controllers: [FavoritesController], providers: [FavoritesService], exports: [FavoritesService] })
export class FavoritesModule {}
```
Vérifier le chemin réel de `PrismaModule`/`PrismaService` (`grep -rn "class PrismaService" src`). Brancher `FavoritesModule` dans `app.module.ts`.

- [ ] **Step 5 : Lancer (vert)** → `./node_modules/.bin/jest src/favorites/` PASS ; tsc 0. (Pas de commit.)

### Task 4.2 : DTO preferFavorite + biais dispatch attente courte (TDD)

**Files:**
- Modify: `src/bookings/dto/create-booking.dto.ts` — `@IsOptional() @IsBoolean() preferFavorite?: boolean;`
- Modify: `src/bookings/dispatch.service.ts` (injecter `FavoritesService`, importer `FavoritesModule` dans le module)
- Modify: `src/bookings/dispatch.service.spec.ts`

> **Attente courte** : à l'entrée de `findEligibleDrivers`, si le booking porte `preferFavorite` et que le passager a des favoris présents dans les candidats éligibles, **restreindre** d'abord aux favoris (le re-dispatch après timeout/`favorite_wait_seconds` élargira naturellement via la machinerie existante de re-dispatch, qui rappelle `findEligibleDrivers` — on s'appuie sur un flag transitoire). Repli : si aucun favori éligible, dispatch normal immédiat.

- [ ] **Step 1 : Test (rouge)**

```typescript
it('preferFavorite : restreint aux chauffeurs favoris éligibles si présents', async () => {
  mockFavorites.driverIds.mockResolvedValue(['d-fav']);
  // nearbyDrivers contient d-fav et d-other → doit ne garder que d-fav
  const drivers = await service.findEligibleDrivers(
    { passengerId: 'p1', preferFavorite: true, operatingCountry: 'CM' } as any, false, undefined, 'bronze',
  );
  expect(drivers.map((d:any)=>d.id)).toEqual(['d-fav']);
});
it('preferFavorite : aucun favori éligible → dispatch normal (repli)', async () => {
  mockFavorites.driverIds.mockResolvedValue(['d-absent']);
  const drivers = await service.findEligibleDrivers({ passengerId:'p1', preferFavorite:true, operatingCountry:'CM' } as any, false, undefined, 'bronze');
  expect(drivers.length).toBeGreaterThan(0);
});
```

- [ ] **Step 2 : Lancer (rouge)** → FAIL.

- [ ] **Step 3 : Implémenter** (dans `findEligibleDrivers`, après constitution de `nearbyDrivers`, avant le `return`)

```typescript
// Lot 2 — chauffeur favori (attente courte) : si demandé et favoris éligibles présents, restreindre
if ((booking as any)?.preferFavorite && (booking as any)?.passengerId) {
  const favIds = await this.favoritesService.driverIds((booking as any).passengerId);
  if (favIds.length > 0) {
    const favs = nearbyDrivers.filter((d: any) => favIds.includes(d.id));
    if (favs.length > 0) nearbyDrivers = favs; // repli : si aucun favori dispo, on garde la liste complète
  }
}
```
Le booking transmis au dispatch doit inclure `passengerId` + `preferFavorite` (les ajouter à l'objet passé / `select`). La fenêtre `favorite_wait_seconds` est portée par la machinerie de re-dispatch existante : après le timeout d'acceptation, le re-dispatch est rappelé SANS `preferFavorite` (ou le flag est consommé) → élargissement. Documenter ce point ; si le re-dispatch ne permet pas de désactiver le flag proprement, le noter en DONE_WITH_CONCERNS.

- [ ] **Step 4 : Lancer (vert) + suite dispatch** → PASS ; tsc 0. (Pas de commit.)

### Task 4.3 : UI passager (favori) + UI chauffeur (badge)

**Files:**
- Modify: `aerocab-native/aerocab-passenger/app/(tabs)/rate-driver.tsx`, `services/api.ts`
- Create: `aerocab-native/aerocab-passenger/app/(tabs)/favorites.tsx` (+ enregistrement `href:null` + entrée réglages, comme l'écran « Mon niveau » du Lot 1)
- Modify: `aerocab-native/aerocab-driver/app/(tabs)/ride-request.tsx`, `services/api.ts`

- [ ] **Step 1 (passager api) :** `toggleFavorite(token, driverId)` → `POST /drivers/:driverId/favorite` ; `getFavorites(token)` → `GET /me/favorites`. Copier le motif `request` existant.
- [ ] **Step 2 (passager rate-driver) :** bouton « ⭐ Ajouter aux favoris » qui appelle `toggleFavorite(driverId)` (driverId dispo sur l'écran de notation).
- [ ] **Step 3 (passager favorites.tsx) :** écran liste des favoris (`getFavorites`), accessible depuis les réglages ; enregistrer `<Tabs.Screen name="favorites" options={{ href: null }} />` + entrée menu réglages.
- [ ] **Step 4 (réservation) :** toggle « Privilégier un chauffeur favori » → `preferFavorite: true` dans `createBooking`.
- [ ] **Step 5 (chauffeur badge) :** dans `ride-request.tsx`, si le payload de course indique que ce passager a mis ce chauffeur en favori (ajouter un champ `isFavoritePassenger` au payload de dispatch côté backend via `favoritesService.isFavorite(passengerId, driverId)`), afficher un badge « ⭐ Client fidèle ».
- [ ] **Step 6 : tsc** des 2 apps → 0. (Pas de commit.)

---

## Self-review & notes

- **Couverture spec** : flex_cancel (G1), scheduled gating (G2), Meet & Greet cash + driver (G3), favori universel + attente courte + driver badge (G4), helper isServiceActive (T1.1), config keys (constantes + getForCountry). ✅
- **Sécurité** : gating scheduled revalidé serveur ; flex_cancel calculé serveur (jamais front).
- **Cash M&G** : ajouté en unité de prix (points = FCFA), va au chauffeur via estimatedPrice.
- **db push** différé (prod) — colonnes `meet_and_greet` + table `favorite_drivers` à pousser au déploiement.
- **Re-dispatch favori** : la fenêtre `favorite_wait_seconds` s'appuie sur le re-dispatch existant ; valider le comportement de consommation du flag à l'exécution.
