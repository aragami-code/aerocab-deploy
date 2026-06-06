# Système de fidélité progressif AeroGo — Design

**Date :** 2026-06-06
**Statut :** validé (brainstorming)
**Périmètre v1 :** catégories de véhicules + 3 services clés (dispatch prioritaire, chauffeur top-rated, course garantie)

---

## Objectif

Faire du niveau de fidélité du passager (bronze → silver → gold → platinum, calculé sur ses points
cumulés) un levier qui **débloque progressivement des services et des catégories de véhicules plus
premium**, tout en lui permettant **d'acheter ponctuellement** un upgrade avec ses points cumulés.

En une phrase : *plus le passager accumule de points, plus son service de base monte en gamme — et il
peut payer des points pour un boost à la demande même en dessous du niveau requis.*

## Décisions cadrées (brainstorming)

| # | Décision | Choix retenu |
|---|----------|--------------|
| 1 | Modèle d'accès | **Hybride** : le niveau débloque un socle premium permanent **ET** les points achètent un upgrade ponctuel sous le niveau requis |
| 2 | Points & niveau | **Deux compteurs** : statut = points *gagnés à vie* (jamais réduit) ; solde dépensable = balance courante, sert aux upgrades |
| 3 | Périmètre v1 | Catégories véhicules + dispatch prioritaire + chauffeur top-rated + course garantie |
| 4 | Architecture | **Config par pays** (`app_settings`, cascade `clé:CC > global > défaut`) + pont `effectiveTier` vers le dispatch existant |
| 5 | Tarif d'un upgrade | Les points débloquent **l'accès** ; le **tarif cash reste celui de la catégorie choisie** (le chauffeur est payé normalement). Pas de remise. |

**Hors périmètre v1 (lot 2) :** annulation flexible, réservation programmée, Meet & Greet, cashback majoré
(déjà existant), choix libre du chauffeur (type inDrive — non retenu, casse le positionnement premium).

---

## Existant réutilisé (ne pas reconstruire)

- **Niveaux** : `User.loyaltyTier` (enum `bronze|silver|gold|platinum`), recalculé après chaque course
  via `usersService.updateLoyaltyTier()` (déclenché dans `bookings.service.ts`). Seuils configurables
  (`loyalty_silver_threshold=500`, `gold=2000`, `platinum=5000`). Tier = **somme des `PointsTransaction`
  de type `credit`** → déjà "points gagnés à vie", insensible aux dépenses ⇒ le modèle deux compteurs
  est déjà respecté.
- **Statut fidélité passager** : `usersService.getLoyaltyStatus()` renvoie tier, label, couleur, emoji,
  progression %, prochain seuil, avantages — **prêt pour l'écran mobile**.
- **Points dépensables** : `pointsService.getBalance()`, `deductPoints()`, `deductPointsTx()`
  (transactionnel, lève une erreur si solde insuffisant), `addPoints()` (pour le remboursement garanti).
- **Dispatch tier-aware (F8)** : `dispatch.service.ts → findEligibleDrivers(booking, isPreLanding,
  customCoords?, passengerTier?)` applique un multiplicateur de pool (bronze ×1.0 → platinum ×1.5) et un
  boost d'accès aux meilleurs chauffeurs pour gold/platinum. Appelé depuis `bookings.service.ts` avec
  `passengerTierForDispatch = getPassengerTier(passengerId)`.
- **Score chauffeur** : `driver.ratingAvg` + `score` (réputation) → tri `orderBy [{score},{ratingAvg}]`.
- **Catégories véhicules** : `eco | eco_plus | standard | confort | confort_plus`, pilotées par
  `tariffs_config.vehicles` (prix par catégorie). `vehicleType` (string) passé à `createBooking`, **aucun
  gating aujourd'hui** = point d'insertion libre.

---

## 1. Données & configuration

### 1.1 Deux compteurs (déjà en place — à documenter, pas à coder)

- **Statut (niveau)** : `Σ PointsTransaction.points WHERE type='credit'` → `loyaltyTier`. Une dépense crée
  un débit qui **n'entre pas** dans ce calcul ⇒ dépenser ne fait jamais redescendre de niveau.
- **Solde dépensable** : `pointsService.getBalance()` (crédits − débits). Source des upgrades.

### 1.2 Nouvelles clés `app_settings` (cascade par pays)

```jsonc
// tier_matrix — ce que chaque niveau débloque/inclut
{
  "bronze":   { "categories": ["eco", "standard"],                          "services": [] },
  "silver":   { "categories": ["eco", "standard", "eco_plus"],              "services": [] },
  "gold":     { "categories": ["eco", "standard", "eco_plus", "confort"],   "services": ["priority"] },
  "platinum": { "categories": ["eco", "standard", "eco_plus", "confort", "confort_plus"],
                "services": ["priority", "top_rated", "guaranteed"] }
}

// upgrade_costs — coût en points d'un déblocage à la carte
{
  "category:confort": 120,
  "category:confort_plus": 200,
  "priority": 50,
  "top_rated": 150,
  "guaranteed": 200
}

// top_rated_min_rating — seuil pour le filtre chauffeur top-rated
"4.8"
```

Lecture via le helper de cascade existant (`getForCountry(key, country, default)`), édition via
`PATCH /admin/settings/key` (accepte déjà les clés suffixées `clé:CC`).

### 1.3 Champs ajoutés au modèle `Booking` (Prisma)

```prisma
purchasedPerks  String[]  @default([])  @map("purchased_perks")   // ex: ["category:confort","top_rated"]
effectiveTier   String?                  @map("effective_tier")    // tier appliqué au dispatch
```

Migration additive, aucune donnée existante impactée.

---

## 2. Flux catégories (gating + achat ponctuel)

### 2.1 Lecture des options — `GET /loyalty/options?vehicleType&country`

Renvoie, pour le passager authentifié :

```jsonc
{
  "tier": "silver",
  "balance": 730,
  "categories": [
    { "key": "eco",          "unlocked": true,  "cost": 0 },
    { "key": "standard",     "unlocked": true,  "cost": 0 },
    { "key": "eco_plus",     "unlocked": true,  "cost": 0 },
    { "key": "confort",      "unlocked": false, "cost": 120 },   // verrouillé → achetable
    { "key": "confort_plus", "unlocked": false, "cost": 200 }
  ],
  "services": [
    { "key": "priority",   "included": false, "cost": 50 },
    { "key": "top_rated",  "included": false, "cost": 150 },
    { "key": "guaranteed", "included": false, "cost": 200 }
  ]
}
```

Logique : `resolveAvailability(tier, country, vehicleType)` croise `tier_matrix` (cascade pays) avec la
liste des catégories réellement tarifées pour ce pays/véhicule.

### 2.2 Création de la course — `createBooking`

1. Le passager choisit une catégorie. Si **débloquée par son tier** → rien à payer.
2. Si **verrouillée** et qu'il accepte de la débloquer → le DTO porte `purchasedPerks: ["category:confort"]`.
3. **Revalidation serveur obligatoire** : recalcul `resolveAvailability` côté backend ; on ne fait jamais
   confiance au front. Un perk non couvert par le tier doit figurer dans `purchasedPerks` ET être payé.
4. `deductPointsTx()` **dans la même transaction Prisma** que la création du booking (atomicité : pas de
   débit sans booking, pas de booking premium sans débit).
5. **Tarif cash inchangé** : le prix de la course reste celui de la catégorie choisie (`tariffs.vehicles[
   vehicleType]`). Les points sont un **droit d'accès**, pas une remise.

---

## 3. Flux services (dispatch prioritaire / top-rated / garanti)

### 3.1 `effectiveTier`

```
effectiveTier = max(tierRéel, tierConféréParLesPerks)
```

Si le passager a acheté `priority` (ou que son tier l'inclut), on calcule un tier effectif au moins égal
à celui qui débloque `priority` dans `tier_matrix`. On passe `effectiveTier` à `findEligibleDrivers(...)`
à la place de `passengerTierForDispatch`. **Le dispatch prioritaire réutilise F8 tel quel** (pool élargi,
meilleurs chauffeurs).

### 3.2 Chauffeur top-rated

Si `top_rated` actif (tier ou acheté) → `findEligibleDrivers` ajoute un filtre
`ratingAvg >= top_rated_min_rating` (configurable, défaut 4.8). Repli : si aucun chauffeur top-rated, on
journalise et on élargit (ne jamais laisser la course sans chauffeur à cause du filtre — voir garanti).

### 3.3 Course garantie

Si `guaranteed` actif et qu'après le timeout + re-dispatch (`bookings.scheduler.ts`) aucun chauffeur n'a
été trouvé → **rembourser les points dépensés** pour ce perk via `addPoints()` + notification passager.
Remboursement **idempotent** (marqueur sur le booking pour éviter le double crédit).

---

## 4. Surface backend

| Fichier / module | Changement |
|---|---|
| **nouveau** `src/loyalty/` | `resolveAvailability(tier, country, vehicleType)` ; contrôleur `GET /loyalty/options` ; helper `effectiveTier(realTier, perks, matrix)` |
| `src/bookings/bookings.service.ts` | hook gating + `deductPointsTx` (transaction) + calcul `effectiveTier` ; persistance `purchasedPerks` |
| `src/bookings/dispatch.service.ts` | filtre `top_rated` (ratingAvg ≥ seuil) ; consomme `effectiveTier` |
| `src/bookings/bookings.scheduler.ts` | remboursement « garanti » idempotent |
| `prisma/schema.prisma` | `Booking.purchasedPerks`, `Booking.effectiveTier` (+ migration) |
| `app_settings` | `tier_matrix`, `upgrade_costs`, `top_rated_min_rating` (cascade pays) |

---

## 5. Mobile (app passager)

| Écran | Changement |
|---|---|
| **nouveau** `Mon niveau` | Branche `getLoyaltyStatus` (déjà prêt) : tier + barre de progression + prochain palier + avantages + **solde de points** |
| `vehicle.tsx` | Catégories débloquées sélectionnables ; verrouillées grisées avec **« 🔒 Débloquer · 120 pts »** ; appel `GET /loyalty/options` |
| `summary.tsx` | Récap des perks achetés + total points dépensés, **affiché séparément du prix cash** |

Aucune sélection de moyen de paiement (la course reste payée en espèces au chauffeur — modèle inchangé).

---

## 6. Admin

Édition de `tier_matrix` / `upgrade_costs` / `top_rated_min_rating` via la page settings existante
(cascade pays). Permet l'A/B test des paliers et des prix en points **sans redéploiement**.

---

## 7. Cas limites & tests

**Cas limites :**
- Solde de points insuffisant → erreur claire, course non créée (la transaction échoue proprement).
- Anti double-débit → `deductPointsTx` dans la transaction du booking.
- Sécurité : revalidation serveur de chaque perk (un bronze ne peut pas forcer `confort` via une requête
  trafiquée sans `purchasedPerks` payé).
- Filtre top-rated sans chauffeur dispo → on n'abandonne pas la course (élargissement + garanti si acheté).
- Remboursement garanti idempotent (un seul crédit même si le scheduler repasse).

**Tests :**
- `resolveAvailability` : matrice par tier × pays × véhicule (débloqué/verrouillé/coût).
- `createBooking` : gating (catégorie verrouillée refusée sans paiement ; acceptée avec `deductPointsTx`).
- `effectiveTier` : mapping perks → tier effectif (ex: bronze + `priority` → tier effectif ≥ gold).
- `dispatch` : filtre `top_rated` (ratingAvg ≥ seuil).
- `scheduler` : remboursement garanti déclenché + idempotent.

---

## 8. Découpage indicatif en lots (pour le plan)

1. **Lot 1 — Socle config + niveaux** : clés `app_settings`, `resolveAvailability`, endpoint
   `/loyalty/options`, écran mobile « Mon niveau ».
2. **Lot 2 — Catégories** : gating + achat à la carte dans `createBooking`, UI `vehicle.tsx` / `summary.tsx`.
3. **Lot 3 — Services** : `effectiveTier` + dispatch prioritaire, filtre top-rated, remboursement garanti.

Chaque lot est livrable et testable indépendamment.
