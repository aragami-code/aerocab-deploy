# Config par pays — Phase 5 (Workflows / Dispatch / KYC) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendre l'enforcement backend country-aware — guard d'activation des workflows, réglages de dispatch, config documents KYC et capacité véhicule résolus par le pays de service, sans changer le comportement actuel tant qu'aucun override pays n'existe.

**Architecture:** S'appuie sur `getForCountry(key, country, default)` (Phase 1). Le pays de service vient de `booking.operatingCountry` (courses/dispatch) ou du pays du chauffeur (`driverProfile.countryCode`, KYC). Chaque lecture `settings.get(...)` ciblée devient `getForCountry(..., <pays>, default)`. Rétro-compatible par construction. L'endpoint public `/config` (bootstrap pré-login, sans token user) reste global ; le bundle par pays authentifié est en Phase 6.

**Tech Stack:** NestJS + Prisma, Jest.

**Spec :** `docs/superpowers/specs/2026-06-03-config-par-pays-design.md` (§3 Workflows/Features/Dispatch, §5.3)

**Working dir :** `/home/aragami/aerogo24V2/aerocab-deploy/backend` — branche `feat/config-par-pays`.

**Convention git :** `git add <chemins exacts>` puis `git commit` (sans pathspec si patch-stagé). JAMAIS `-A`/`.`. Safe-swap pour fichiers à modifs pré-existantes.

---

## File Structure

- `src/bookings/bookings.service.ts` — **Modify** : guard `workflow_<type>_enabled` + `getVehicleSeats` par pays
- `src/bookings/dispatch.service.ts` — **Modify** : `proximity_radius_km`, `min_driver_score`, limites, vitesse, buffers par pays
- `src/drivers/drivers.service.ts` — **Modify** : `driver_document_config` par pays

---

### Task 1 : Guard workflow d'activation par pays

**Files:** Modify `src/bookings/bookings.service.ts`

Aujourd'hui (`bookings.service.ts` ~446) :
```typescript
    const workflowKey = dto.type === 'ARRIVAL' ? 'workflow_arrival_enabled'
      : dto.type === 'DEPARTURE' ? 'workflow_departure_enabled'
      : 'workflow_international_enabled';
    // ... puis une lecture du type : await this.settingsService.get(workflowKey, 'true') / === 'false'
```

- [ ] **Step 1 : Rendre la lecture country-aware**

READ le bloc autour de la ligne 446 pour voir comment `workflowKey` est ensuite lu (probablement `await this.settingsService.get(workflowKey, ...)` puis comparaison `=== 'false'` ou `!== 'false'`). Le pays de service à ce stade de `createBooking` est `bookingCountryCode` (calculé plus haut, utilisé pour tarifs/cashback). Remplacer la lecture :
```typescript
    // avant : await this.settingsService.get(workflowKey, 'true')
    const workflowEnabled = await this.settingsService.getForCountry(workflowKey, bookingCountryCode, 'true');
```
et conserver la logique de comparaison existante (ex: `if (workflowEnabled === 'false') throw new BadRequestException(...)`). ADAPTER au code réel : repérer la lecture exacte de `workflowKey` et y substituer `getForCountry(workflowKey, bookingCountryCode, '<defaut existant>')`. Si `bookingCountryCode` n'est pas encore calculé à cette ligne (le guard est peut-être AVANT la résolution du pays), VÉRIFIER l'ordre : si le guard précède le calcul du pays, utiliser `dto.countryCode ?? null` ou déplacer la lecture après le calcul du pays — choisir la solution minimale qui garde le pays correct. Documenter le choix.

- [ ] **Step 2 : Compiler**

Run : `./node_modules/.bin/tsc --noEmit 2>&1 | grep -i "bookings.service" || echo "OK"`
Expected : `OK`.

- [ ] **Step 3 : Commit**

`git add src/bookings/bookings.service.ts` (patch-stagé, bare commit) → `feat(pays): guard workflow d'activation par pays`.

---

### Task 2 : Réglages dispatch par pays

**Files:** Modify `src/bookings/dispatch.service.ts`

Lectures globales actuelles (`settingsService.get`) :
- `min_driver_score` ('4.0'), `dispatch_prelanding_limit` ('50') — ~lignes 27-28
- `proximity_radius_km` ('25') — ~ligne 118
- `avg_driver_speed_kmh` ('30') — ~ligne 218
- `delayed_dispatch_default_wait_min` ('45') — ~ligne 222
- `driver_pickup_buffer_min` ('5') — ~ligne 248

- [ ] **Step 1 : Résoudre le pays de dispatch**

READ `dispatch.service.ts`. Les méthodes (`findEligibleDrivers`, `findNearbyDrivers`, `estimateDelayedDispatch`) reçoivent un `booking` et/ou des coords. Le pays de service est `booking.operatingCountry`. Pour chaque méthode qui lit un de ces settings, dériver `const country = (booking as any)?.operatingCountry ?? null;` (ou le passer en param si la méthode n'a pas le booking). Si une méthode (ex: `estimateDelayedDispatch(vehicleType, coords)`) n'a pas le booking, ajouter un param optionnel `country?: string | null` et le passer depuis l'appelant (`createBooking` a `bookingCountryCode`).

- [ ] **Step 2 : Country-aware sur chaque lecture**

Remplacer chaque `await this.settingsService.get(key, default)` de la liste ci-dessus par `await this.settingsService.getForCountry(key, country, default)` avec le `country` résolu à l'étape 1. Préserver les valeurs par défaut exactes. NE PAS toucher aux lectures non listées (ex: `accept_timeout_seconds` si présent ailleurs — hors scope, ou l'inclure si trivial avec le même pays).

- [ ] **Step 3 : Compiler**

Run : `./node_modules/.bin/tsc --noEmit 2>&1 | grep -i "dispatch.service" || echo "OK"`
Expected : `OK`. (Si une méthode n'a pas accès au booking/coords et que threader le pays est risqué, laisser cette lecture globale et le noter — DONE_WITH_CONCERNS.)

- [ ] **Step 4 : Commit**

`git add src/bookings/dispatch.service.ts` (patch-stagé) → `feat(pays): réglages dispatch par pays`.

---

### Task 3 : KYC `driver_document_config` + `vehicle_capacity` par pays

**Files:** Modify `src/drivers/drivers.service.ts`, `src/bookings/bookings.service.ts`

- [ ] **Step 1 : driver_document_config par pays (drivers.service)**

READ `src/drivers/drivers.service.ts`, repérer la lecture de `driver_document_config` (probablement `await this.settings.get('driver_document_config', ...)`). Le pays = celui du chauffeur. Si la méthode a accès au `driverProfile`/`userId`, résoudre `driverCountry` (charger `driverProfile.countryCode` si nécessaire, ou via `extractCountryFromPhone(user.phone)` si seul le user est en scope). Remplacer par :
```typescript
    const docConfigRaw = await this.settings.getForCountry('driver_document_config', driverCountry, '<defaut existant>');
```
ADAPTER au nom du service settings injecté + au défaut existant. Si le pays du chauffeur n'est pas trivialement disponible (ex: endpoint public de config docs), laisser global et le noter.

- [ ] **Step 2 : vehicle_capacity par pays (bookings.service)**

READ `getVehicleSeats` (ou la méthode qui lit `vehicle_capacity`) dans `bookings.service.ts`. Elle lit probablement `await this.settingsService.get('vehicle_capacity', ...)`. Si appelée dans un contexte avec un `booking`/`operatingCountry`, rendre country-aware : `getForCountry('vehicle_capacity', booking.operatingCountry ?? null, '<defaut>')`. Si `getVehicleSeats` n'a que `vehicleType` (pas de pays), ajouter un param optionnel `country?: string | null` et le passer depuis les appelants qui ont le booking. Si trop d'appelants sans pays, laisser global et noter (DONE_WITH_CONCERNS) — `vehicle_capacity` global est acceptable (spec : « global ET configurable par pays », donc le global reste valide).

- [ ] **Step 3 : Compiler**

Run : `./node_modules/.bin/tsc --noEmit 2>&1 | grep -iE "drivers.service|bookings.service" || echo "OK"`
Expected : `OK`.

- [ ] **Step 4 : Commit**

`git add src/drivers/drivers.service.ts src/bookings/bookings.service.ts` (patch-stagé) → `feat(pays): KYC docs + capacité véhicule par pays`.

---

### Task 4 : Déploiement + validation

- [ ] **Step 1 : Déployer** (base64 → `qm guest exec 101`, chunké pour bookings.service ~190KB) : `bookings.service.ts`, `dispatch.service.ts`, `drivers.service.ts`. Rebuild + up api.
- [ ] **Step 2 : Valider**
  - API `healthy`.
  - **Régression nulle** : aucun override `workflow_*:PAYS` / `proximity_radius_km:PAYS` / `driver_document_config:PAYS` → tout retombe sur le global. Vérifier `SELECT COUNT(*) FROM app_settings WHERE key ~ ':(CM|SN)$' AND key !~ 'tariffs_config'` ≈ inchangé.
  - Test override : poser `workflow_international_enabled:SN = false` → une course INTERNATIONAL vers SN serait refusée (lecture directe pour confirmer la résolution), puis retirer.
  - Endpoints booking/dispatch répondent comme avant.

---

## Hors-scope (volontaire)

- **Bundle de config par pays pour l'app** (`/config/bundle` authentifié exposant workflows/features/KYC résolus pour le pays de l'utilisateur) → Phase 6 (App). L'endpoint public `/config` (pré-login) reste global ici.
- **Feature flags par pays exposés à l'app** : l'enforcement backend (ce qui bloque réellement) est traité ici ; l'affichage conditionnel dans l'app vient avec le bundle (Phase 6).

## Self-Review (effectuée)

**Couverture spec Phase 5 :** workflows par pays (enforcement) → T1 ✓ ; dispatch par pays (§3) → T2 ✓ ; KYC `driver_document_config` + `vehicle_capacity` (§3) → T3 ✓. L'exposition app des features/workflows est explicitement en Phase 6 (bundle).

**Rétro-compatibilité :** chaque lecture retombe sur global sans override → comportement de prod inchangé.

**Cohérence types :** `getForCountry(key, country, default)`, `country = booking.operatingCountry ?? null` / `bookingCountryCode` / `driverCountry` — cohérents.

**Placeholders :** aucun ; les `VÉRIFIER`/`ADAPTER` pointent les noms réels (lecture exacte du workflowKey, méthodes dispatch, settings service dans drivers, défauts existants) avec instruction d'adapter, et autorisent explicitement de laisser une lecture globale + DONE_WITH_CONCERNS si le pays n'est pas en scope.
