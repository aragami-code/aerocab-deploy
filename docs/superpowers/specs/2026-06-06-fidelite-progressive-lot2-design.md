# Fidélité progressive — Lot 2 (services premium) — Design

**Date :** 2026-06-06
**Statut :** validé (brainstorming)
**Pré-requis :** Lot 1 livré (module `loyalty`, `purchasedPerks`, `effectiveTier`, gating `createBooking`, dispatch tier-aware). Voir [2026-06-06-fidelite-progressive-design.md](./2026-06-06-fidelite-progressive-design.md).

## Objectif

Ajouter 4 services premium qui s'enfichent dans l'architecture du Lot 1 :
1. **Annulation flexible** (`flex_cancel`) — perk : annuler sans pénalité même tardivement.
2. **Réservation programmée** (`scheduled`) — gating : la feature existe déjà, on la débloque par niveau/achat.
3. **Meet & Greet** — supplément **cash** (hors points) : le chauffeur attend avec pancarte au nom.
4. **Chauffeur favori** — **universel** (tous niveaux) : re-privilégier un chauffeur, dispatch à **attente courte**.

## Décisions cadrées

| # | Décision | Choix |
|---|----------|-------|
| 1 | flex_cancel & scheduled | Services-perks configurables (tier inclus OU achat points), comme le Lot 1 |
| 2 | Meet & Greet | **Supplément cash** ajouté au prix de la course (payé au chauffeur), PAS un perk points |
| 3 | Chauffeur favori — accès | **Universel** (pas un perk de niveau) |
| 4 | Chauffeur favori — dispatch | **Attente courte** : favori éligible notifié en premier, fenêtre `favorite_wait_seconds` (déf 30s), puis dispatch élargi |
| 5 | App chauffeur | **Dans le périmètre** : pancarte Meet & Greet (nom passager) + badge « client fidèle » |

## Existant réutilisé (vérifié)

- **flex_cancel** : `cancelBooking` (bookings.service.ts ~1324) calcule `isLateCancel` (statut `arrived_at_airport` OU vol <48h) → `lateCancelRate` (`late_cancel_refund_rate`, déf 0.5) → `refundRate` → `penaltyPoints = price*(1-refundRate)`. Hook ~ligne 1415-1420.
- **scheduled** : déjà implémenté — `Booking.scheduledAt` + statut `scheduled` + cron `dispatchScheduledBookings()` (scheduler ~693) qui dispatche `dispatch_scheduled_advance_min` (déf 60) min avant, en utilisant déjà `effectiveTier`. On ajoute seulement le gating à la création.
- **Meet & Greet** : aucun champ — net.
- **favori** : aucun champ — net.
- **LoyaltyService** : `resolveAvailability`, `effectiveTier`, `costOf`, `topRatedMinRating`, `ALL_SERVICES`.

## 0. Helper réutilisable `isServiceActive` (LoyaltyService)

Le Lot 1 calculait « service actif = payé OU inclus par le niveau » en ligne (top_rated dans le dispatch). On le DRY :

```typescript
// loyalty.service.ts
async isServiceActive(perks: string[], tier: TierKey, country: string | null, service: ServiceKey): Promise<boolean> {
  if (perks.includes(service)) return true;
  const avail = await this.resolveAvailability(tier, country, 'standard');
  return avail.services.find(s => s.key === service)?.included ?? false;
}
```

Ajouter `flex_cancel` et `scheduled` à `ServiceKey` / `ALL_SERVICES` (loyalty.constants.ts). Refactor optionnel : le filtre top_rated du dispatch peut réutiliser ce helper.

## 1. Annulation flexible (`flex_cancel`)

- **Config** : ajouter `flex_cancel` dans `tier_matrix` (ex: platinum inclus) + `upgrade_costs` (ex: 75).
- **Achat** : à la réservation (`purchasedPerks: ['flex_cancel']`), via le même flux Lot 1 (deductPointsTx atomique). Persisté dans `booking.purchasedPerks`.
- **Hook cancelBooking** : avant le calcul de la pénalité, si `await loyalty.isServiceActive(booking.purchasedPerks, booking.effectiveTier ?? tierRéel, country, 'flex_cancel')` → forcer `refundRate = 1.0` (annulation sans pénalité), et journaliser.
- **Mobile passager** : toggle « Annulation flexible » à la réservation (affiché verrouillé/coût via `/loyalty/options`).

## 2. Réservation programmée gating (`scheduled`)

- **Config** : `scheduled` dans `tier_matrix` (ex: silver+ inclus) + `upgrade_costs` (ex: 100).
- **Hook createBooking** : si `dto.scheduledAt` fourni → exiger `scheduled` actif (payé via `purchasedPerks:['scheduled']` OU inclus par le niveau), sinon `ForbiddenException('Réservation programmée non débloquée pour votre niveau')`. Réutilise la revalidation serveur + débit du Lot 1.
- **Mobile passager** : l'option « Programmer la course » montre cadenas/coût si indisponible.

## 3. Meet & Greet (supplément cash)

- **Schéma** : `Booking.meetAndGreet Boolean @default(false) @map("meet_and_greet")`.
- **DTO** : `meetAndGreet?: boolean`.
- **Config** : `meet_greet_fee` (cash, par pays, ex: 2000).
- **Hook createBooking** : si `dto.meetAndGreet`, ajouter `meet_greet_fee` (résolu `getForCountry`) au prix de la course (le cash payé au chauffeur). Persister `meetAndGreet: true`. **Indépendant des points** (n'entre pas dans `purchasedPerks`).
- **Mobile passager** : toggle « Meet & Greet (+ {fee}) » à la réservation ; le supplément apparaît dans le récap prix.
- **App chauffeur** : sur l'écran de course (ride-request / course active), si `booking.meetAndGreet`, afficher « 🪧 Meet & Greet — {nom passager} » bien visible.

## 4. Chauffeur favori (universel, attente courte)

- **Schéma** : `model FavoriteDriver { id, passengerId, driverId, createdAt, @@unique([passengerId, driverId]) }` (+ relations).
- **Ajout/suppression** : `POST /drivers/:driverId/favorite` (toggle), `GET /me/favorites`. Auth passager.
- **Mobile passager** : bouton « ⭐ Ajouter aux favoris » sur l'écran de **notation** (rate-driver) et/ou **reçu** ; écran liste des favoris (depuis réglages). Toggle réservation « Privilégier un chauffeur favori si disponible » (`dto.preferFavorite?: boolean`).
- **Dispatch attente courte** (`findEligibleDrivers` / flux dispatch) : si `dto.preferFavorite` ET le passager a des favoris éligibles/en ligne → notifier le(s) favori(s) **en premier** ; fenêtre `favorite_wait_seconds` (config, déf 30) ; sans acceptation → dispatch élargi normal. Réutilise la machinerie timeout/re-dispatch (`bookings.scheduler` / lock Redis). **Repli garanti** : ne jamais laisser la course sans chauffeur.
- **App chauffeur** : badge « ⭐ Client fidèle » sur la demande de course quand `FavoriteDriver(passengerId, ceChauffeur)` existe.

## Config (toutes `app_settings`, cascade pays)

`tier_matrix` (+ `flex_cancel`, `scheduled`), `upgrade_costs` (+ `flex_cancel`, `scheduled`), `meet_greet_fee`, `favorite_wait_seconds`.

## Tests

- `isServiceActive` : payé OU inclus → true ; sinon false.
- `flex_cancel` : `cancelBooking` tardif AVEC perk → `refundRate=1.0` (pénalité 0) ; SANS perk → pénalité appliquée.
- `scheduled` gating : `createBooking` avec `scheduledAt` SANS perk → `ForbiddenException` ; AVEC → OK + débit si acheté.
- `meet_greet` : prix course = prix base + `meet_greet_fee` quand `meetAndGreet=true` ; inchangé sinon. `meetAndGreet` persisté.
- `favorite` : unicité (re-POST ne duplique pas) ; dispatch priorise un favori éligible, puis élargit après fenêtre ; repli si aucun favori dispo.

## Découpage (un plan, 4 groupes)

1. **G1 — flex_cancel** : helper `isServiceActive` + constantes + hook `cancelBooking` + toggle passager.
2. **G2 — scheduled gating** : constantes + hook `createBooking` + UI passager.
3. **G3 — Meet & Greet** : schéma + DTO + fee dans `createBooking` + toggle passager + affichage app chauffeur.
4. **G4 — Chauffeur favori** : table + endpoints + dispatch attente courte + UI passager (favoris) + badge app chauffeur.

Chaque groupe est livrable et testable indépendamment.

## Hors périmètre

Choix libre du chauffeur type inDrive (non retenu — casse le premium). Paliers de fidélité visuels avancés. Ancillaires (lounge, bagages).
