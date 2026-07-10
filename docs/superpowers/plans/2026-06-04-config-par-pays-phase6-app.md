# Config par pays — Phase 6 (App : bundle de config par pays) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exposer la config par pays aux apps mobiles — un endpoint authentifié `/config/bundle` résout les réglages publics pour le pays de l'utilisateur, et les apps le mergent dans leur `configStore` après login (workflows masqués, features, devise par pays).

**Architecture:** L'endpoint public `/config` (pré-login) reste global. Un nouvel endpoint AUTHENTIFIÉ `/config/bundle` résout les mêmes clés via `getForCountry(key, userCountry)` (pays = `extractCountryFromPhone(user.phone)` côté passager, `driverProfile.countryCode` côté chauffeur). Les apps fetchent ce bundle après login et MERGENT ses valeurs par-dessus les `settings` globaux du configStore → `settings[key]` reflète le pays.

**Tech Stack:** NestJS + Prisma (backend), Expo/React Native + Zustand (mobile).

**Spec :** `docs/superpowers/specs/2026-06-03-config-par-pays-design.md` (§5.2 bundle, §7.3 app)

**Working dirs :** backend `/home/aragami/aerogo24V2/aerocab-deploy/backend` (branche `feat/config-par-pays`) ; mobile `aerocab-native/aerocab-passenger` + `aerocab-native/aerocab-driver`.

**Acquis :** `SettingsService.getForCountry(key, country, default)`. `app.controller.ts` a `PUBLIC_SETTING_KEYS` + `/config` (global, cache Redis). configStore mobile charge `/config` dans un `settings: Record<string,string>` plat et lit `settings[key]`.

**Convention git :** `git add <chemins exacts>` puis `git commit`. JAMAIS `-A`/`.`. Safe-swap pour fichiers à modifs pré-existantes.

> ⚠️ Les changements MOBILE ne prennent effet qu'après **rebuild des APK** (T5).

---

## File Structure

**Backend**
- `src/app.controller.ts` — **Modify** : endpoint `GET /config/bundle` (authentifié, par pays)

**Mobile (passager + chauffeur)**
- `stores/configStore.ts` — **Modify** : `fetchCountryBundle(token)` qui merge les overrides pays
- `services/api.ts` — **Modify** : méthode `getConfigBundle(token)`
- `app/_layout.tsx` (ou le point post-login) — **Modify** : déclencher `fetchCountryBundle` après login

---

### Task 1 : Backend — endpoint `/config/bundle` authentifié

**Files:** Modify `src/app.controller.ts`

- [ ] **Step 1 : Ajouter l'endpoint**

READ `src/app.controller.ts` : la constante `PUBLIC_SETTING_KEYS`, le constructeur (services injectés : `settings`, `prisma`, etc.), et l'endpoint `/config` existant. Repérer les clés "par pays" parmi `PUBLIC_SETTING_KEYS` (workflows, features, `driver_document_config`, `vehicle_capacity`, `tariffs_config`).

Ajouter une constante des clés résolues par pays + l'endpoint :
```typescript
import { UseGuards, Request } from '@nestjs/common';
import { JwtAuthGuard } from './auth/guards';
import { extractCountryFromPhone } from './common/phone-country';

// Clés de PUBLIC_SETTING_KEYS qui se résolvent par pays
const PER_COUNTRY_PUBLIC_KEYS = [
  'workflow_arrival_enabled', 'workflow_departure_enabled', 'workflow_international_enabled',
  'feature_referral_enabled', 'feature_cashback_enabled', 'feature_points_purchase_enabled',
  'feature_promo_enabled', 'feature_chat_enabled', 'feature_sos_enabled',
  'feature_destination_change_enabled', 'feature_rating_enabled',
  'feature_driver_withdrawal_enabled', 'feature_breakdown_report_enabled',
  'driver_document_config', 'vehicle_capacity', 'tariffs_config',
];
```
Et la méthode (dans la classe `AppController`) :
```typescript
  /**
   * Config par pays pour l'utilisateur connecté. Résout les clés PER_COUNTRY_PUBLIC_KEYS
   * via getForCountry selon le pays de l'utilisateur (téléphone → pays, sinon defaultCountry).
   * Les apps mergent ces overrides par-dessus le /config global.
   */
  @Get('config/bundle')
  @UseGuards(JwtAuthGuard)
  async getConfigBundle(@Request() req: any) {
    const user = await this.prisma.user.findUnique({
      where: { id: req.user.id },
      select: { phone: true, countryCode: true, role: true },
    });
    let country: string | null = user?.countryCode ?? (user?.phone ? extractCountryFromPhone(user.phone) : null);
    // Chauffeur : le pays d'opération prime
    if (user?.role === 'driver') {
      const dp = await this.prisma.driverProfile.findFirst({
        where: { userId: req.user.id }, select: { countryCode: true },
      });
      if (dp?.countryCode) country = dp.countryCode;
    }
    const cc = country ? country.toUpperCase() : null;

    const entries = await Promise.all(
      PER_COUNTRY_PUBLIC_KEYS.map(async (k) => [k, await this.settings.getForCountry(k, cc, '')] as const),
    );
    const settings: Record<string, string> = {};
    for (const [k, v] of entries) if (v !== '') settings[k] = v;

    const countryRow = cc
      ? await this.prisma.country.findUnique({
          where: { code: cc },
          select: { code: true, currency: true, currencySymbol: true, currencyDecimals: true },
        })
      : null;

    return { countryCode: cc, country: countryRow, settings };
  }
```
VÉRIFIER : le nom du service settings injecté (`this.settings`), le chemin du guard `JwtAuthGuard` (`./auth/guards`), et que `extractCountryFromPhone` est bien dans `./common/phone-country`. Adapter. NE PAS toucher l'endpoint `/config` existant.

- [ ] **Step 2 : Compiler**

Run : `./node_modules/.bin/tsc --noEmit 2>&1 | grep -i "app.controller" || echo "OK"`
Expected : `OK`.

- [ ] **Step 3 : Commit**

`git add src/app.controller.ts` (patch-stagé) → `feat(pays): endpoint /config/bundle par pays`.

---

### Task 2 : Mobile passager — merge du bundle dans configStore

**Files:** Modify `aerocab-native/aerocab-passenger/services/api.ts`, `stores/configStore.ts`, et le point post-login

- [ ] **Step 1 : Méthode API**

Dans `services/api.ts` (passager), ajouter (adapter au helper `request` réel : `{ token }`) :
```typescript
  async getConfigBundle(token: string) {
    return this.request<{
      countryCode: string | null;
      country: { code: string; currency: string; currencySymbol: string | null; currencyDecimals: number } | null;
      settings: Record<string, string>;
    }>(`/config/bundle`, { token });
  }
```

- [ ] **Step 2 : Action de merge dans configStore**

READ `stores/configStore.ts`. Il a `settings: Record<string,string>` + une action de chargement de `/config`. Ajouter une action :
```typescript
  fetchCountryBundle: async (token: string) => {
    try {
      const res = await api.getConfigBundle(token);
      // merge : les overrides pays remplacent les valeurs globales
      set((s) => ({ settings: { ...s.settings, ...res.settings }, countryBundle: res.country ?? null }));
    } catch { /* garder la config globale en cas d'échec */ }
  },
```
Ajouter `countryBundle` à l'état + son type (`{ code; currency; currencySymbol; currencyDecimals } | null`, défaut `null`). Adapter l'import `api` au style réel (named/default).

- [ ] **Step 3 : Déclencher après login**

Repérer où l'app sait que l'utilisateur est connecté (token présent) — soit `app/_layout.tsx`, soit le succès du login. Y appeler `useConfigStore.getState().fetchCountryBundle(token)` une fois le token disponible (et au retour au 1er plan si pertinent). VÉRIFIER la structure ; ajouter l'appel de façon minimale.

- [ ] **Step 4 : Compiler**

Run : `npx tsc --noEmit 2>&1 | grep -iE "configStore|services/api|_layout" || echo "OK"`
Expected : `OK`. (Ignorer toute erreur pré-existante non liée.)

- [ ] **Step 5 : Commit**

`git add stores/configStore.ts services/api.ts <fichier post-login>` (patch-stagé). Commit : `feat(pays): merge du bundle config par pays (passager)`.

---

### Task 3 : Mobile chauffeur — merge du bundle

**Files:** Modify `aerocab-native/aerocab-driver/services/api.ts`, `stores/configStore.ts`, point post-login

- [ ] **Step 1 : Répliquer**

Reproduire Task 2 à l'identique dans l'app chauffeur (`getConfigBundle`, `fetchCountryBundle`, déclenchement post-login). Le backend résout déjà le pays d'opération du chauffeur (`driverProfile.countryCode`). VÉRIFIER si le driver a un `configStore` équivalent (il devrait — il a `useConfigStore`). Adapter aux conventions du driver (export `api`, structure du store).

- [ ] **Step 2 : Compiler**

Run (dans aerocab-driver) : `npx tsc --noEmit 2>&1 | grep -iE "configStore|services/api|_layout" || echo "OK"`
Expected : `OK`.

- [ ] **Step 3 : Commit**

`git add ...` (les fichiers driver, patch-stagés) → `feat(pays): merge du bundle config par pays (chauffeur)`.

---

### Task 4 : Déploiement backend + rebuild APK

- [ ] **Step 1 : Déployer backend** : transférer `src/app.controller.ts` (base64 → `qm guest exec 101`). Rebuild + up api.
- [ ] **Step 2 : Valider backend** : `GET /api/config/bundle` sans token → 401 ; avec token → `{ countryCode, country, settings }`. API `healthy`.
- [ ] **Step 3 : Rebuild APK** : `cd <app>/android && ./gradlew assembleRelease --no-daemon` (PAS `clean` — bug RN bare), pour passager puis chauffeur. Installer via `adb install -r` si un téléphone est connecté.
- [ ] **Step 4 : Valider** : connecté en tant que passager CM → le bundle renvoie la config CM ; un override `feature_chat_enabled:CM=false` masquerait le chat (test override + retrait).

---

## Hors-scope (différé en Phase 6b)

- **Finalisation inscription : téléphone obligatoire + sélecteur pays** (les inscriptions email créent un compte sans téléphone → pays null jusqu'à ajout). Flux UI + guard backend `PROFILE_INCOMPLETE`. À traiter séparément (UI-lourd ; les inscriptions par téléphone ont déjà le pays).
- **Affichage cross-border de INTERNATIONAL** (toujours visible quel que soit le pays d'origine) — affinement UI du trip-mode, suit le bundle.
- **Format devise / décimales à l'affichage** (utiliser `country.currencyDecimals` du bundle) — itération UI.

## Self-Review (effectuée)

**Couverture spec Phase 6 (partie bundle) :** bundle de config par pays (§5.2) → T1 ✓ ; consommation app + configStore (§7.3) → T2,T3 ✓. La finalisation téléphone (§7.1) et l'affichage cross-border (§7.2) sont explicitement **différés en Phase 6b** (UI-lourd).

**Rétro-compatibilité :** `/config` global inchangé ; le bundle ne fait que MERGER des overrides pays (vide si aucun override → settings globaux préservés). Échec du fetch → config globale conservée.

**Cohérence types :** `getConfigBundle(token)→{countryCode,country,settings}`, `fetchCountryBundle(token)`, `getForCountry(key, cc, '')` — cohérents backend/mobile.

**Placeholders :** aucun ; les `VÉRIFIER` pointent les noms réels (settings service, guard, helper phone, export api, point post-login, store driver) avec instruction d'adapter.
