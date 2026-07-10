# Config par pays — Phase 4 (Paiements par pays) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> ⚠️ **PHASE SENSIBLE — paiements en production (argent réel, webhooks).** Chaque changement est **rétro-compatible par construction** : `getForCountry` retombe sur le global tant qu'aucun override `key:PAYS` n'existe → comportement actuel strictement préservé. Ne JAMAIS supprimer le fallback env/global.

**Goal:** Résoudre les credentials des providers de paiement et les méthodes proposées **par pays de service**, sans changer le comportement actuel tant qu'aucun override pays n'est configuré.

**Architecture:** Le helper `cred(dbKey, envKey)` de chaque provider devient `cred(dbKey, envKey, country?)` et lit via `getForCountry(dbKey, country, '') || env`. Le pays (`operatingCountry`) est threadé depuis `payment-intent.service`. Les méthodes de paiement proposées sont résolues par le pays de service (avec repli sur le pays du téléphone hors contexte de course).

**Tech Stack:** NestJS + Prisma, Jest.

**Spec :** `docs/superpowers/specs/2026-06-03-config-par-pays-design.md` (§5.4 périmètres paiement, §3 Paiements)

**Working dir :** `/home/aragami/aerogo24V2/aerocab-deploy/backend` — branche `feat/config-par-pays`.

**Acquis :** `SettingsService.getForCountry(key, country, default)`. `Country.paymentMethods` (Json) déjà géré par pays côté admin. `payment-intent.service` porte déjà `operatingCountry`.

**Convention git :** `git add <chemins exacts>` puis `git commit` (sans pathspec si patch-stagé). JAMAIS `-A`/`.`. Safe-swap pour les fichiers à modifs pré-existantes.

---

## File Structure

- `src/payments/stripe.service.ts`, `flutterwave.service.ts`, `notchpay.service.ts`, `paypal.service.ts`, `mpesa.service.ts`, `wave.service.ts` — **Modify** : `cred(..., country?)` country-aware + param `country?` sur les méthodes publiques
- `src/payments/payment-intent.service.ts` — **Modify** : passer `operatingCountry` aux appels providers
- `src/payments/payments.controller.ts` — **Modify** : méthodes de paiement par pays de service
- `src/payments/cred-resolver.ts` — **Create** : helper pur partagé + test
- `src/payments/cred-resolver.spec.ts` — **Create**

---

### Task 1 : Helper `cred` country-aware partagé (TDD)

**Files:**
- Create: `src/payments/cred-resolver.ts`, `src/payments/cred-resolver.spec.ts`

On factorise la logique de résolution en une fonction pure testable (chaque provider la réutilisera).

- [ ] **Step 1 : Test (échec attendu)**

`src/payments/cred-resolver.spec.ts` :
```typescript
import { pickCredential } from './cred-resolver';

describe('pickCredential', () => {
  it('valeur DB pays prioritaire', () => {
    expect(pickCredential('sk_sn', 'sk_global', 'sk_env')).toBe('sk_sn');
  });
  it('valeur DB globale si pas de pays', () => {
    expect(pickCredential('', 'sk_global', 'sk_env')).toBe('sk_global');
  });
  it('env si rien en DB', () => {
    expect(pickCredential('', '', 'sk_env')).toBe('sk_env');
  });
  it('chaîne vide si tout absent', () => {
    expect(pickCredential('', '', '')).toBe('');
  });
});
```

- [ ] **Step 2 : Lancer (échec)**

Run : `npx jest src/payments/cred-resolver.spec.ts`
Expected : FAIL — module introuvable.

- [ ] **Step 3 : Implémenter**

`src/payments/cred-resolver.ts` :
```typescript
/**
 * Choisit la valeur de credential effective :
 * override pays (DB) → valeur globale (DB) → variable d'environnement → ''.
 * Les deux valeurs DB sont déjà lues par l'appelant (getForCountry gère la cascade pays→global,
 * mais on garde ce helper pur pour la lisibilité et le fallback env).
 */
export function pickCredential(dbCountryOrGlobal: string, _dbGlobalUnused: string, envValue: string): string {
  return dbCountryOrGlobal || envValue;
}
```
NOTE : `getForCountry(key, country, '')` retourne DÉJÀ la cascade `key:PAYS → key → ''`. Donc le helper reçoit en 1er argument le résultat de `getForCountry` (qui couvre pays+global) et applique le fallback env. Le 2e argument est conservé pour clarté/compat de signature mais non utilisé. Garde la signature simple : en pratique chaque provider appellera `pickCredential(await settings.getForCountry(dbKey, country, ''), '', config.get(envKey, ''))`.

- [ ] **Step 4 : Lancer (succès)**

Run : `npx jest src/payments/cred-resolver.spec.ts`
Expected : PASS (4 tests).

- [ ] **Step 5 : Commit**

`git add src/payments/cred-resolver.ts src/payments/cred-resolver.spec.ts` → `feat(pays): helper pickCredential (TDD)`.

---

### Task 2 : `cred()` country-aware dans chaque provider

**Files:** Modify `src/payments/stripe.service.ts`, `flutterwave.service.ts`, `notchpay.service.ts`, `paypal.service.ts`, `mpesa.service.ts`, `wave.service.ts`

Pour CHAQUE provider, le helper privé `cred` ressemble à :
```typescript
  private async cred(dbKey: string, envKey: string): Promise<string> {
    const fromDb = await this.settings.get(dbKey, '');
    return fromDb || this.config.get<string>(envKey, '');
  }
```

- [ ] **Step 1 : Rendre `cred` country-aware**

Dans chaque provider, remplacer le `cred` par :
```typescript
  private async cred(dbKey: string, envKey: string, country?: string | null): Promise<string> {
    const fromDb = await this.settings.getForCountry(dbKey, country ?? null, '');
    return fromDb || this.config.get<string>(envKey, '');
  }
```
(C'est rétro-compatible : `country` absent → `getForCountry(key, null, '')` = `key` global → identique à `settings.get(dbKey, '')`.)

VÉRIFIER pour chaque provider : `this.settings` est bien le `SettingsService` injecté (chercher le constructeur). Adapter le nom si différent (`this.settingsService`).

- [ ] **Step 2 : Threader `country` dans les méthodes publiques**

Dans chaque provider, les méthodes publiques (`initiate`, `createPaymentIntent`, `verify`, etc.) qui appellent `this.cred(...)` pour les credentials de CHARGE (pas le webhook secret) : ajouter un champ optionnel `country?: string` à leur objet `params` et le passer : `this.cred('payment_X_secret_key', 'X_SECRET_KEY', params.country ?? null)`.
- Pour les **webhook secrets** (`payment_X_webhook_secret`) : garder country = null pour l'instant (la vérification de signature entrante est traitée en Phase 4b — un webhook entrant n'a pas trivialement le pays avant de résoudre le booking). NE PAS changer la résolution du webhook secret dans cette tâche.

- [ ] **Step 3 : Compiler**

Run : `./node_modules/.bin/tsc --noEmit 2>&1 | grep -iE "stripe|flutterwave|notchpay|paypal|mpesa|wave" || echo "OK"`
Expected : `OK`.

- [ ] **Step 4 : Commit**

`git add src/payments/stripe.service.ts src/payments/flutterwave.service.ts src/payments/notchpay.service.ts src/payments/paypal.service.ts src/payments/mpesa.service.ts src/payments/wave.service.ts` → `feat(pays): credentials providers par pays (cred country-aware)`.

---

### Task 3 : Passer `operatingCountry` aux appels providers

**Files:** Modify `src/payments/payment-intent.service.ts`

- [ ] **Step 1 : Threader le pays**

`payment-intent.service.ts` a déjà `operatingCountry` dans son DTO/contexte (vérifier ligne ~21 + là où il construit l'intent). Repérer les appels aux méthodes providers (`stripe.createPaymentIntent(...)`, `flutterwave.initiate(...)`, etc.) et ajouter `country: <operatingCountry>` à l'objet `params` passé. La variable du pays est sur le contexte de l'intent (l'intent connaît son `operatingCountry`). Adapter au nom réel.

- [ ] **Step 2 : Compiler**

Run : `./node_modules/.bin/tsc --noEmit 2>&1 | grep -i "payment-intent" || echo "OK"`
Expected : `OK`.

- [ ] **Step 3 : Commit**

`git add src/payments/payment-intent.service.ts` → `feat(pays): payment-intent passe operatingCountry aux providers`.

---

### Task 4 : Méthodes de paiement par pays de service

**Files:** Modify `src/payments/payments.controller.ts`

Aujourd'hui (`payments.controller.ts` ~145) les méthodes sont résolues par le **pays du téléphone**. Pour le cross-border (passager étranger réservant vers un pays opéré), il faut résoudre par le **pays de service** quand un contexte de course existe.

- [ ] **Step 1 : Accepter un pays explicite**

Modifier l'endpoint qui retourne `methods` pour accepter un query param optionnel `country` (le pays de destination, transmis par l'app au moment du récap de course) :
```typescript
  @Get('methods')
  @UseGuards(JwtAuthGuard)
  async getPaymentMethods(@Request() req: any, @Query('country') country?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: req.user.id }, select: { phone: true } });
    const phoneCountry = (user?.phone ? extractCountryFromPhone(user.phone) : null) ?? 'CM';
    const countryCode = (country ?? phoneCountry).toUpperCase();
    const c = await this.prisma.country.findUnique({ where: { code: countryCode }, select: { paymentMethods: true } });
    const DEFAULT_METHODS = [
      { id: 'orange_money_cm', label: 'Orange Money', icon: 'orange_money' },
      { id: 'mtn_cm',          label: 'MTN MoMo',     icon: 'mtn_momo' },
      { id: 'cash',            label: 'Espèces',       icon: 'cash' },
    ];
    const methods = Array.isArray(c?.paymentMethods) && (c.paymentMethods as any[]).length
      ? c.paymentMethods as any[] : DEFAULT_METHODS;
    return { methods, countryCode };
  }
```
VÉRIFIER le nom réel de la route (`@Get('methods')` ou autre) et importer `Query` de `@nestjs/common` si absent. Garder la signature de réponse identique (`{ methods, countryCode }`). Le param `country` absent → repli pays téléphone = comportement actuel.

- [ ] **Step 2 : Compiler**

Run : `./node_modules/.bin/tsc --noEmit 2>&1 | grep -i "payments.controller" || echo "OK"`
Expected : `OK`.

- [ ] **Step 3 : Commit**

`git add src/payments/payments.controller.ts` → `feat(pays): méthodes de paiement par pays de service`.

---

### Task 5 : Admin — credentials providers par pays

**Files:** Modify `src/services/api.ts` (admin), `src/pages/SettingsPage.tsx` (admin) — **working dir admin**

Les credentials providers (`payment_stripe_secret_key`, etc.) sont éditables dans la page Settings via `setSetting(key, value)`. Pour les surcharger par pays, on écrit `key:PAYS` quand un pays est sélectionné.

- [ ] **Step 1 : Setting par pays côté admin**

Dans la page Settings (section Paiements / providers), quand le sélecteur global (`useCountry().selected`) est sur un pays ≠ GLOBAL, le save d'un credential écrit `key:PAYS` au lieu de `key`. Helper :
```tsx
const { selected } = useCountry();
const scopedKey = (key: string) => selected === 'GLOBAL' ? key : `${key}:${selected}`;
// au save : adminApi.setSetting(scopedKey('payment_stripe_secret_key'), value)
// au load : lire la valeur de scopedKey(...) (fallback affichage global si vide)
```
VÉRIFIER comment SettingsPage charge/sauve les credentials providers (probablement `getCredentials`/`setSetting`). Adapter de façon minimale et SÛRE : si l'intégration est complexe, se limiter au save scopé + un bandeau "édition pour <pays>" et reporter DONE_WITH_CONCERNS.

- [ ] **Step 2 : Build**

Run : `npx tsc --noEmit 2>&1 | grep -i "SettingsPage" || echo "OK"` puis `npm run build`.
Expected : `OK` + build réussi.

- [ ] **Step 3 : Commit**

`git add src/pages/SettingsPage.tsx src/services/api.ts` (patch-stagé) → `feat(pays): credentials providers éditables par pays`.

---

### Task 6 : Déploiement + validation

- [ ] **Step 1 : Déployer backend** (base64 → `qm guest exec 101`) : `cred-resolver.ts`, les 6 providers, `payment-intent.service.ts`, `payments.controller.ts`. Rebuild + up api.
- [ ] **Step 2 : Déployer admin** : `SettingsPage.tsx`, `api.ts` ; rebuild conteneur admin.
- [ ] **Step 3 : Valider**
  - API + admin `healthy`.
  - **Régression nulle** : aucun override `payment_*:PAYS` → les providers lisent le global/env comme avant. Vérifier qu'un paiement test (ou la lecture des credentials masqués) fonctionne à l'identique.
  - `GET /api/payments/methods` (token) → méthodes ; `?country=SN` → méthodes SN.
  - Test override : poser `payment_stripe_secret_key:SN` en base → confirmer que `getForCountry` le résout pour SN (lecture directe), puis le retirer.

---

## Hors-scope (différé en Phase 4b — à traiter séparément, soigneusement)

- **Split plateforme/marketplace** (`purpose ∈ {driver_registration, access_pass}` → rails locaux + comptabilité centrale + pas de commission marketplace). Touche les flux d'inscription/pass et la comptabilisation — à concevoir/implémenter avec soin.
- **Webhook secret par pays** : la vérification de signature d'un webhook entrant nécessite de résoudre le booking → pays AVANT de choisir le secret. Refactor du routage webhook, sensible. Différé.
- **Recharge wallet par pays** : `pointRechargeRate` par pays (rattaché à Phase 7 wallet/monnaie).

## Self-Review (effectuée)

**Couverture spec Phase 4 (partie sûre) :** credentials providers par pays (§5.4 marketplace) → T1,T2,T3 ✓ ; méthodes par pays de service → T4 ✓ ; admin par pays → T5 ✓. Le split plateforme/marketplace + webhook par pays (§5.4) sont explicitement **différés en Phase 4b** (risque élevé, périmètre à border).

**Rétro-compatibilité :** chaque changement retombe sur global/env sans override → comportement de prod inchangé. Sûr par construction.

**Cohérence types :** `pickCredential(dbVal, _unused, envVal)→string`, `cred(dbKey, envKey, country?)`, `params.country?: string` — cohérents.

**Placeholders :** aucun ; les `VÉRIFIER` pointent les noms réels (`this.settings`, route methods, contexte operatingCountry, intégration SettingsPage) avec instruction d'adapter.
