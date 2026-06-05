# Country Config — Lot 2 (Wizard) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** `CountryWizard.tsx` — assistant overlay 7 étapes (tab-slide) qui guide l'admin de la création d'un pays à son activation, avec avancement auto après chaque étape réussie, ouverture à la 1ère étape manquante pour un pays existant, lancé depuis `PaysPage` (« Nouveau pays » + « Compléter »).

**Architecture :** Composant orchestrateur `CountryWizard` (stepper + état + mode create/complete + logique readiness) + 7 formulaires d'étape **simplifiés** qui appellent les endpoints existants (PAS d'extraction des grosses pages TariffsPage/PaysPage). UI admin seule, zéro backend. Réutilise `scopedKey`/`resolveScopedSetting` (Lot 1).

**Tech Stack :** React + Vite + Tailwind + lucide-react ; tests vitest pour la logique pure.

**Spec :** `docs/superpowers/specs/2026-06-05-country-setup-wizard-design.md` (§2,4,6).

**Working dir :** `/home/aragami/aerogo24V2/aerocab-admin`.

**Endpoints & shapes (existants) :**
- `adminApi.createOperatedCountry({ code, name, currency, currencySymbol?, currencyDecimals, phonePrefix?, flagEmoji? })`
- `adminApi.listOperatedCountries()`, `adminApi.getCountryReadiness(code) → { ready, missing[] }`, `adminApi.activateCountry(code)`
- `adminApi.getCountryPaymentMethods(code)`, `adminApi.setCountryPaymentMethods(code, methods: { id, label, icon }[])`
- `adminApi.getTariffsByCountry(code)`, `adminApi.setTariffsByCountry(code, config)` — config `{ basePricePerKm, fcfaPerPoint, vehicles: Record<string,{ basePricePerKm, minFare, coefficient }>, ... }`
- `adminApi.getAirportsAdmin({ country }) → { data: Airport[] }`, `adminApi.setAirportOperated(id, isOperated)` ; `Airport = { id, iataCode, name, city, countryCode, isOperated, ... }`
- `adminApi.getSettings() → Record<string,string>`, `adminApi.setSetting(key, value)` (accepte `key:CC`)
- `scopedKey`, `resolveScopedSetting` (`../lib/scopedSetting`)
- `useCountry()` (`../contexts/CountryContext`) — non requis ici (le wizard a son propre `code`).

**Convention git :** `CountryWizard.tsx` + helpers/test = NEUFS → commit direct. `PaysPage.tsx` a du WIP → ne PAS committer (ship via build). api.ts a du WIP → ne pas committer.

---

## File Structure

- `src/components/wizard/wizardLogic.ts` — **Create** : helpers purs (`firstMissingStep`, `stepBlockingSatisfied`) + test
- `src/components/wizard/wizardLogic.test.ts` — **Create**
- `src/components/wizard/CountryWizard.tsx` — **Create** : orchestrateur (stepper, état, navigation, readiness)
- `src/components/wizard/steps/StepInfos.tsx`, `StepPayments.tsx`, `StepTariffs.tsx`, `StepWorkflows.tsx`, `StepAirports.tsx`, `StepAdvanced.tsx`, `StepReview.tsx` — **Create**
- `src/pages/PaysPage.tsx` — **Modify** (ne pas committer) : boutons « Nouveau pays » (wizard) + « Compléter »

---

### Task 1 : Logique pure du stepper (TDD)

**Files:** Create `src/components/wizard/wizardLogic.ts`, `wizardLogic.test.ts`

- [ ] **Step 1 : Test (vitest)**

`wizardLogic.test.ts` :
```typescript
import { describe, it, expect } from 'vitest';
import { firstMissingStep, STEP_CRITERION } from './wizardLogic';

describe('firstMissingStep', () => {
  it('tout manquant → étape 1 (infos/currency)', () => {
    expect(firstMissingStep(['currency','payment_methods','tariffs','operated_airports'])).toBe(0);
  });
  it('manque tariffs + airports → étape Tarification (index 2)', () => {
    expect(firstMissingStep(['tariffs','operated_airports'])).toBe(2);
  });
  it('manque seulement operated_airports → étape Aéroports (index 4)', () => {
    expect(firstMissingStep(['operated_airports'])).toBe(4);
  });
  it('rien manquant → étape Récap (dernière, index 6)', () => {
    expect(firstMissingStep([])).toBe(6);
  });
});
```

- [ ] **Step 2 : Lancer (échec)** : `npx vitest run src/components/wizard/wizardLogic.test.ts` → FAIL.

- [ ] **Step 3 : Implémenter**

`wizardLogic.ts` :
```typescript
// Index des 7 étapes : 0 Infos, 1 Paiements, 2 Tarification, 3 Workflows, 4 Aéroports, 5 Avancé, 6 Récap.
export const STEPS = ['infos', 'payments', 'tariffs', 'workflows', 'airports', 'advanced', 'review'] as const;
export type StepId = typeof STEPS[number];

/** Critère readiness gardant chaque étape bloquante (null = non bloquante). */
export const STEP_CRITERION: Record<number, string | null> = {
  0: 'currency', 1: 'payment_methods', 2: 'tariffs', 3: null, 4: 'operated_airports', 5: null, 6: null,
};

/** 1ère étape dont le critère readiness est dans `missing`. Si rien → dernière étape (Récap). */
export function firstMissingStep(missing: string[]): number {
  for (let i = 0; i < STEPS.length; i++) {
    const crit = STEP_CRITERION[i];
    if (crit && missing.includes(crit)) return i;
  }
  return STEPS.length - 1;
}

/** Une étape bloquante est satisfaite si son critère n'est PAS dans missing (ou non bloquante). */
export function stepBlockingSatisfied(stepIndex: number, missing: string[]): boolean {
  const crit = STEP_CRITERION[stepIndex];
  return !crit || !missing.includes(crit);
}
```

- [ ] **Step 4 : Lancer (succès)** : PASS (4 tests).
- [ ] **Step 5 : Commit** : `git add src/components/wizard/wizardLogic.ts src/components/wizard/wizardLogic.test.ts` → `feat(pays): logique stepper wizard (TDD)`.

---

### Task 2 : Composants d'étape (formulaires simplifiés)

**Files:** Create les 7 `src/components/wizard/steps/Step*.tsx`

Chaque step est un composant contrôlé : reçoit `{ code, onSaved, onDirty }` (et des props spécifiques), gère son propre form/loading/erreur, appelle son endpoint au clic « Enregistrer », puis `onSaved()` (le parent re-check readiness + avance). Style : cartes/inputs Tailwind comme les autres pages.

- [ ] **Step 1 : StepInfos** — champs `code` (2 lettres, disabled si pays existant), `name`, `currency`, `currencySymbol`, `currencyDecimals`, `phonePrefix`, `flagEmoji`. En mode création : `createOperatedCountry(...)` puis `onSaved(createdCode)`. En mode complétion : champs pré-remplis (lecture), bouton « Suivant » direct (pays déjà créé). VÉRIFIER : `createOperatedCountry` échoue si le code existe déjà → message « pays déjà créé », basculer en complétion.

- [ ] **Step 2 : StepPayments** — éditeur de lignes `{ id, label, icon }` (ajout/suppression), pré-rempli via `getCountryPaymentMethods(code)`. Au save : `setCountryPaymentMethods(code, methods)` (≥1 requis, sinon erreur). `onSaved()`.

- [ ] **Step 3 : StepTariffs** — form simplifié : `basePricePerKm`, `fcfaPerPoint`, et une grille `vehicles` (eco/confort/van… : `basePricePerKm`, `minFare`, `coefficient`). Pré-remplir via `getTariffsByCountry(code)` (qui renvoie le résolu, possiblement global) ; au save `setTariffsByCountry(code, config)` (crée `tariffs_config:CC`). Garder la structure attendue par le backend (cf. TariffsPage `DEFAULT` pour le shape). `onSaved()`.

- [ ] **Step 4 : StepWorkflows** — 3 toggles Arrivée/Départ/International, init via `resolveScopedSetting(settings, 'workflow_<t>_enabled', code, 'true')`. Au save : `setSetting(scopedKey('workflow_<t>_enabled', code), value)` pour chacun. Non bloquant. `onSaved()`.

- [ ] **Step 5 : StepAirports** — `getAirportsAdmin({ country: code })` → liste ; toggle « opéré » par ligne → `setAirportOperated(id, bool)`. Compteur d'aéroports opérés ; ≥1 requis. Si aucun aéroport en base pour le pays → message + (étape reste bloquante). `onSaved()` après chaque toggle (re-check readiness).

- [ ] **Step 6 : StepAdvanced** — sections repliables (commission, dispatch, fidélité, KYC, capacité, retrait — clés du spec §4). Chaque champ : placeholder = valeur globale (de `getSettings()`), vide = hérite, rempli = `setSetting(scopedKey(key, code), value)`. KYC/capacité = `<textarea>` JSON avec validation (`JSON.parse` avant save). Bouton « Enregistrer les overrides » écrit seulement les champs remplis/modifiés. Non bloquant. `onSaved()`.

- [ ] **Step 7 : StepReview** — affiche les 4 critères (✓/✗) depuis `getCountryReadiness(code)` ; bouton **« Activer le pays »** actif si `ready`. Au clic : `activateCountry(code)` → toast succès + `onActivated()` (ferme le wizard, rafraîchit la liste). Si 400 (incomplet) → afficher `missing` + lien vers l'étape concernée.

- [ ] **Compiler après chaque step** : `npx tsc --noEmit 2>&1 | grep -i "Step" || echo OK`.
- [ ] **Commit** (composants neufs) : `git add src/components/wizard/steps/*.tsx` → `feat(pays): composants d'étape du wizard`.

---

### Task 3 : Orchestrateur `CountryWizard.tsx`

**Files:** Create `src/components/wizard/CountryWizard.tsx`

- [ ] **Step 1 : Implémenter l'orchestrateur**

Props : `{ mode: 'create' | 'complete'; initialCode?: string; onClose: () => void; onChanged: () => void }`.
État : `code` (`initialCode` ou défini après StepInfos), `current` (index étape), `missing: string[]`, `settings: Record<string,string>` (chargé une fois pour les steps Workflows/Advanced), `loading`.
- Overlay plein écran (fixed inset-0, fond semi-opaque, panneau centré scrollable). Bouton fermer.
- **Stepper** horizontal : 7 pastilles (numéro + ✓ si `stepBlockingSatisfied(i, missing)` pour les bloquantes, ou si déjà visité pour les non-bloquantes). Cliquable si l'étape précédente bloquante est satisfaite.
- Au montage : si `mode==='complete'` → charger `getCountryReadiness(initialCode)` + `getSettings()`, `setCurrent(firstMissingStep(missing))`. Si `create` → `current=0`.
- Rendu de l'étape courante (switch sur `STEPS[current]`) en passant `code`, `settings`, et un callback `handleSaved` qui : re-`getCountryReadiness(code)` → `setMissing`, puis avance (`setCurrent(c => Math.min(c+1, 6))`) — sauf à l'étape Récap. Recharger `getSettings()` après les steps Workflows/Advanced.
- Boutons Précédent / Suivant en bas : « Suivant » désactivé si l'étape courante est bloquante et `!stepBlockingSatisfied(current, missing)`.
- À l'activation (StepReview) → `onChanged()` + `onClose()`.

- [ ] **Step 2 : Compiler** : `npx tsc --noEmit 2>&1 | grep -i "CountryWizard" || echo OK`.
- [ ] **Step 3 : Commit** : `git add src/components/wizard/CountryWizard.tsx` → `feat(pays): orchestrateur CountryWizard (stepper + readiness)`.

---

### Task 4 : Intégration PaysPage

**Files:** Modify `src/pages/PaysPage.tsx` (NE PAS committer — WIP)

- [ ] **Step 1 : Brancher le wizard**

READ `PaysPage.tsx`. Importer `CountryWizard`. Ajouter un état `wizard: { mode, code? } | null`.
- Le bouton « Nouveau pays » (actuel `setShowForm`) → ouvrir le wizard en mode `create` (`setWizard({ mode: 'create' })`) au lieu (ou en plus) du form inline. Choix : remplacer l'ouverture du form simple par le wizard.
- Sur chaque ligne de pays **non active / incomplète** (readiness non `ready`) : ajouter un bouton **« Compléter »** → `setWizard({ mode: 'complete', code: c.code })`.
- Rendre `{wizard && <CountryWizard mode={wizard.mode} initialCode={wizard.code} onClose={() => setWizard(null)} onChanged={() => { setWizard(null); reload(); }} />}` (adapter au nom réel de la fonction de rechargement de la liste/readiness).

- [ ] **Step 2 : Compiler** : `npx tsc --noEmit 2>&1 | grep -i "PaysPage" || echo OK`.
- [ ] **Step 3 :** NE PAS committer PaysPage (WIP). Laisser en WT.

---

### Task 5 : Déploiement (rebuild admin)

- [ ] **Step 1 : Transférer** vers `/home/ubuntu/aerocab-admin` (base64 → VM) : tout `src/components/wizard/**`, `src/pages/PaysPage.tsx`, `src/services/api.ts` (si modifié), `src/lib/scopedSetting.ts` (déjà déployé Lot 1 mais re-inclure ne nuit pas). Gérer root-owned (`test -w || sudo -n chown ubuntu:ubuntu`), `tar xzf --overwrite`, créer les dossiers (`mkdir -p src/components/wizard/steps`).
- [ ] **Step 2 : Build** : `docker compose build admin && docker compose up -d admin`. Conteneur Up (build Vite = validation TS).
- [ ] **Step 3 : Valider** : conteneur Up. Fonctionnel (par l'utilisateur) : Pays → « Compléter » sur Sénégal → wizard ouvre à Tarification → renseigner tarifs → aéroport opéré → activer → Sénégal passe Actif.

---

## Self-Review (effectuée)

**Couverture spec §2/§4/§6 :** 7 étapes (§2) → T2 ✓ ; étape Avancé clés (§4) → T2.6 ✓ ; logique avancement/1ère étape manquante (§2) → T1 (TDD) + T3 ✓ ; lancement PaysPage (§2) → T4 ✓ ; erreurs (§6 : code existant, activate 400, JSON invalide, pas d'aéroport) → T2/T3 ✓.

**Cohérence types :** `STEPS`/`STEP_CRITERION`/`firstMissingStep`/`stepBlockingSatisfied` (T1) consommés par CountryWizard (T3) ; chaque Step reçoit `{ code, settings?, onSaved }`. `scopedKey`/`resolveScopedSetting` du Lot 1.

**Placeholders :** aucun ; les `VÉRIFIER`/`ADAPTER` pointent : shape exact `setTariffsByCountry` (cf. TariffsPage DEFAULT), nom de la fonction de reload de PaysPage, comportement de `createOperatedCountry` sur code existant, WIP de PaysPage. Formulaires d'étape volontairement **simplifiés** (pas d'extraction des pages géantes) — YAGNI.
