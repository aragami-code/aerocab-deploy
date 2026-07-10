# Country Config — Lot 1 (Feature Flags par pays) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rendre la page Feature Flags éditable **par pays** (sélecteur pays + résolution/écriture `key:CC` avec fallback global) et y ajouter la catégorie **Workflows** (Arrivée/Départ/International). Fournir le helper pur `resolveScopedSetting` réutilisé ensuite par le wizard (Lot 2).

**Architecture :** UI admin seule. Lecture via `getSettings()` (renvoie tout `app_settings` clé→valeur, scoped inclus), écriture via `setSetting`/`setKey` (`PATCH /admin/settings/key`, accepte `key:CC` pour les clés non-dédiées — `feature_*` et `workflow_*` le sont). Scope pays via `CountryContext` (`useCountry().selected` = `'GLOBAL'` ou code). Zéro backend.

**Tech Stack :** React + Vite + Tailwind ; tests (infra présente : `src/test/*.test.tsx`).

**Spec :** `docs/superpowers/specs/2026-06-05-country-setup-wizard-design.md` (§3, §7).

**Working dir :** `/home/aragami/aerogo24V2/aerocab-admin`.

**Acquis :**
- `FeatureFlagsPage.tsx` : `FLAG_DEFS: { key, label, description, category }[]`, state `flags` (+`enabled`,`saving`), `load()` via `adminApi.getSettings()`, `toggle(key, value)` via `adminApi.setSetting(key, String(value))`. `export function FeatureFlagsPage()`. Catégories `passenger|driver|shared`.
- `adminApi.getSettings()` → `Record<string,string>` (toutes les clés, scoped incluses). `adminApi.setSetting(key, value)` et `adminApi.setKey(key, value)` (ajouté pour OTP) écrivent via `PATCH /admin/settings/key`.
- `CountryContext` : `import { useCountry } from '../contexts/CountryContext'` → `const { selected } = useCountry()` (`'GLOBAL'` ou code 2 lettres). Déjà utilisé par SettingsPage.
- Backend : `workflow_<type>_enabled` lus par `getForCountry(..., 'true')` (défaut activé). `feature_*` idem défaut activé.

**Convention git :** `FeatureFlagsPage.tsx` : vérifier WIP (`git status`) → si propre, committer ; sinon WT. Helper neuf + test → commit direct. api.ts a du WIP → ne pas committer.

---

## File Structure

- `src/lib/scopedSetting.ts` — **Create** : helper pur `resolveScopedSetting` + `scopedKey`
- `src/lib/scopedSetting.test.ts` — **Create** : tests
- `src/pages/FeatureFlagsPage.tsx` — **Modify** : sélecteur pays + catégorie Workflows + lecture/écriture scopée

---

### Task 1 : Helper pur `resolveScopedSetting` (TDD)

**Files:** Create `src/lib/scopedSetting.ts`, `src/lib/scopedSetting.test.ts`

- [ ] **Step 1 : Test (échec attendu)**

READ un test existant (`src/test/SettingsPage.test.tsx`) pour confirmer le runner (vitest ou jest) et la convention d'import. Créer `src/lib/scopedSetting.test.ts` :
```typescript
import { describe, it, expect } from 'vitest'; // ADAPTER si jest (retirer cet import)
import { scopedKey, resolveScopedSetting } from './scopedSetting';

describe('scopedKey', () => {
  it('GLOBAL → clé nue', () => { expect(scopedKey('feature_x', 'GLOBAL')).toBe('feature_x'); });
  it('pays → clé suffixée', () => { expect(scopedKey('feature_x', 'CM')).toBe('feature_x:CM'); });
});

describe('resolveScopedSetting', () => {
  const s = { 'feature_x': 'true', 'feature_x:CM': 'false', 'feature_y': 'true' };
  it('override pays prioritaire', () => {
    expect(resolveScopedSetting(s, 'feature_x', 'CM', 'true')).toEqual({ value: 'false', overridden: true });
  });
  it('fallback global si pas d’override', () => {
    expect(resolveScopedSetting(s, 'feature_y', 'CM', 'true')).toEqual({ value: 'true', overridden: false });
  });
  it('GLOBAL lit la clé nue', () => {
    expect(resolveScopedSetting(s, 'feature_x', 'GLOBAL', 'true')).toEqual({ value: 'true', overridden: false });
  });
  it('défaut si absent', () => {
    expect(resolveScopedSetting(s, 'feature_z', 'CM', 'true')).toEqual({ value: 'true', overridden: false });
  });
});
```

- [ ] **Step 2 : Lancer (échec)** : `npx vitest run src/lib/scopedSetting.test.ts` (ou `npx jest ...`) → FAIL module introuvable. ADAPTER la commande au runner réel.

- [ ] **Step 3 : Implémenter**

`src/lib/scopedSetting.ts` :
```typescript
/** Clé scopée pays : 'GLOBAL' → clé nue ; sinon 'key:CC'. */
export function scopedKey(key: string, country: string): string {
  return !country || country === 'GLOBAL' ? key : `${key}:${country.toUpperCase()}`;
}

/**
 * Résout une valeur de setting pour un pays : override 'key:CC' > global 'key' > défaut.
 * `overridden` = vrai si un override pays explicite existe (utile pour l'UI).
 */
export function resolveScopedSetting(
  settings: Record<string, string>,
  key: string,
  country: string,
  def: string,
): { value: string; overridden: boolean } {
  if (country && country !== 'GLOBAL') {
    const scoped = settings[`${key}:${country.toUpperCase()}`];
    if (scoped !== undefined) return { value: scoped, overridden: true };
  }
  const global = settings[key];
  if (global !== undefined) return { value: global, overridden: false };
  return { value: def, overridden: false };
}
```

- [ ] **Step 4 : Lancer (succès)** : runner → PASS (6 tests).

- [ ] **Step 5 : Commit** (fichiers neufs) : `git add src/lib/scopedSetting.ts src/lib/scopedSetting.test.ts` → `feat(pays): helper resolveScopedSetting (TDD)`. Confirmer 2 fichiers.

---

### Task 2 : FeatureFlagsPage par pays + Workflows

**Files:** Modify `src/pages/FeatureFlagsPage.tsx`

- [ ] **Step 1 : Catégorie Workflows + type étendu**

READ `FeatureFlagsPage.tsx`. Étendre le type `category` à `'passenger'|'driver'|'shared'|'workflow'`. Ajouter à `FLAG_DEFS` :
```typescript
  { key: 'workflow_arrival_enabled',       label: 'Workflow Arrivée',       description: 'Réservations ARRIVAL (passager arrive à l’aéroport)',  category: 'workflow' },
  { key: 'workflow_departure_enabled',     label: 'Workflow Départ',        description: 'Réservations DEPARTURE (passager part vers l’aéroport)', category: 'workflow' },
  { key: 'workflow_international_enabled',  label: 'Workflow International',  description: 'Réservations INTERNATIONAL (vol entrant). NB : l’affichage app est global ; ceci gate par pays de destination côté backend.', category: 'workflow' },
```
Ajouter le rendu de la catégorie `workflow` (icône lucide ex. `Plane`/`Globe`, titre « Workflows ») là où les autres catégories sont affichées (la boucle `['passenger','driver','shared'].map(...)` → ajouter `'workflow'`).

- [ ] **Step 2 : Sélecteur pays + scope**

Importer `useCountry` (`../contexts/CountryContext`) et `resolveScopedSetting`, `scopedKey` (`../lib/scopedSetting`). Ajouter `const { selected } = useCountry();`. Afficher un bandeau de scope : `selected === 'GLOBAL' ? 'Global (tous pays)' : selected`. (Si la page a déjà un header, y intégrer ; sinon une barre en haut.)

- [ ] **Step 3 : Lecture scopée + rechargement au changement de pays**

Dans `load()` : après `const settings = await adminApi.getSettings();`, pour chaque flag, `enabled = resolveScopedSetting(settings, flag.key, selected, 'true').value === 'true'` (défaut « true » = activé ; VÉRIFIER le défaut actuel utilisé par la page et le conserver). Optionnel : exposer `overridden` pour un badge « override pays ». Ajouter `selected` aux dépendances qui déclenchent `load()` (le `useEffect`/`useCallback`) pour recharger au changement de pays. VÉRIFIER que `load` est un `useCallback([... , selected])` et que l'`useEffect` dépend de `load`/`selected`.

- [ ] **Step 4 : Écriture scopée**

Dans `toggle(key, value)` : écrire la clé scopée → `await adminApi.setSetting(scopedKey(key, selected), String(value));` (ou `setKey`). Conserver la gestion `saving`/toast existante. Quand `selected !== 'GLOBAL'`, l'écriture crée/maj `key:CC` ; en GLOBAL, la clé nue (comportement actuel préservé).

- [ ] **Step 5 : Compiler** : `npx tsc --noEmit 2>&1 | grep -i "FeatureFlagsPage" || echo OK`. Expected `OK`.

- [ ] **Step 6 : Commit** (si FeatureFlagsPage propre → committer ; sinon WT) → `feat(pays): Feature Flags + Workflows éditables par pays`.

---

### Task 3 : Déploiement (rebuild admin)

- [ ] **Step 1 : Transférer** vers `/home/ubuntu/aerocab-admin` (base64 → VM `192.168.100.101` via `root@217.160.47.83`) : `src/lib/scopedSetting.ts`, `src/pages/FeatureFlagsPage.tsx` (+ api.ts si modifié, en WT). Gérer root-owned (`test -w || sudo -n chown ubuntu:ubuntu`), `tar xzf --overwrite`.
- [ ] **Step 2 : Build** : `docker compose build admin && docker compose up -d admin`. Conteneur `aerocab_admin` Up (build Vite = validation TS).
- [ ] **Step 3 : Valider** : conteneur Up. (Fonctionnel : login admin → Feature Flags → changer le sélecteur pays sur SN → toggler un workflow → vérifier en DB `SELECT value FROM app_settings WHERE key='workflow_arrival_enabled:SN';` — à faire par l'utilisateur, ou vérifier la clé scopée via getSettings.)

---

## Hors-scope (Lot 2)

- Le wizard `CountryWizard.tsx` (7 étapes) — Lot 2 (réutilise `resolveScopedSetting` et `scopedKey` de ce lot).

## Self-Review (effectuée)

**Couverture spec Lot 1 :** sélecteur pays + scope `key:CC` (§3) → T2 ✓ ; catégorie Workflows (§3) → T2 ✓ ; helper `resolveScopedSetting` réutilisable (§7) → T1 (TDD) ✓ ; déploiement → T3 ✓.

**Cohérence types :** `scopedKey(key, country)`, `resolveScopedSetting(settings, key, country, def) → { value, overridden }` — définis en T1, consommés en T2.

**Placeholders :** aucun ; les `VÉRIFIER`/`ADAPTER` pointent le runner de test (vitest/jest), le défaut actuel des flags, la structure du `useEffect`/`load`, et le WIP de FeatureFlagsPage — avec instruction d'adapter.
