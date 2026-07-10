# Config par pays — Phase 7 (Wallet / monnaie) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Intégrité monétaire multi-pays — le changement de pays d'un chauffeur exige un wallet de gains vidé (puis bascule la devise), et la recharge wallet crédite les points au taux de change du pays de l'utilisateur.

**Architecture:** Le wallet passager est en **points** (universel) ; la recharge convertit `montant_local → points` via le `pointRechargeRate` du pays (`getTariffsByCountry`). Le wallet de gains chauffeur (`DriverEarningsWallet`, argent réel) doit être à 0 avant d'approuver un changement de pays, puis sa `currency` bascule sur la devise du nouveau pays. Rétro-compatible : sans override pays, `getTariffsByCountry(null)` == config globale.

**Tech Stack:** NestJS + Prisma, Jest.

**Spec :** `docs/superpowers/specs/2026-06-03-config-par-pays-design.md` (§5.5 wallet/monnaie ; décisions #1 points ancrés, #2 wallet chauffeur)

**Working dir :** `/home/aragami/aerogo24V2/aerocab-deploy/backend` — branche `feat/config-par-pays`.

**Acquis :** `getTariffsByCountry(country)` (déjà per-country, renvoie `pointRechargeRate`/`fcfaPerPoint`/`currency`). `Country.currency` + `currencyDecimals`. `DriverEarningsWallet { balance, currency }`.

**Convention git :** `git add <chemins exacts>` puis `git commit`. JAMAIS `-A`/`.`. Safe-swap pour fichiers à modifs pré-existantes ; commit bare (jamais `git commit -- <path>`).

---

## File Structure

- `src/drivers/wallet-guard.ts` — **Create** : helper pur `canChangeCountry` + test
- `src/drivers/wallet-guard.spec.ts` — **Create**
- `src/drivers/drivers.service.ts` — **Modify** : `adminReviewCountryChangeRequest` exige wallet vide + bascule devise
- `src/payments/payments.controller.ts` — **Modify** : recharge crédit points par pays
- `src/bookings/bookings.scheduler.ts` — **Modify** : retry recharge Flutterwave par pays

---

### Task 1 : Helper pur `canChangeCountry` (TDD)

**Files:** Create `src/drivers/wallet-guard.ts`, `src/drivers/wallet-guard.spec.ts`

- [ ] **Step 1 : Test (échec attendu)**

`src/drivers/wallet-guard.spec.ts` :
```typescript
import { canChangeCountry } from './wallet-guard';

describe('canChangeCountry', () => {
  it('autorise si solde nul', () => {
    expect(canChangeCountry(0)).toEqual({ ok: true });
  });
  it('autorise si solde négatif/0 (tolérance flottante)', () => {
    expect(canChangeCountry(0.004).ok).toBe(true); // < 0.01 = considéré vide
  });
  it('refuse si solde positif', () => {
    const r = canChangeCountry(1500);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/retrait/i);
  });
});
```

- [ ] **Step 2 : Lancer (échec)**

Run : `npx jest src/drivers/wallet-guard.spec.ts`
Expected : FAIL — module introuvable.

- [ ] **Step 3 : Implémenter**

`src/drivers/wallet-guard.ts` :
```typescript
/**
 * Un chauffeur ne peut changer de pays d'opération que si son wallet de gains
 * (argent réel) est vidé — sinon il faudrait convertir/transférer des fonds entre devises.
 * Tolérance < 0.01 pour absorber les arrondis flottants.
 */
export function canChangeCountry(earningsBalance: number): { ok: boolean; reason?: string } {
  if (earningsBalance < 0.01) return { ok: true };
  return { ok: false, reason: `Retrait requis : videz votre portefeuille (${earningsBalance}) avant de changer de pays.` };
}
```

- [ ] **Step 4 : Lancer (succès)**

Run : `npx jest src/drivers/wallet-guard.spec.ts`
Expected : PASS (3 tests).

- [ ] **Step 5 : Commit**

`git add src/drivers/wallet-guard.ts src/drivers/wallet-guard.spec.ts` → `feat(pays): helper canChangeCountry (TDD)`.

---

### Task 2 : Changement pays chauffeur — exige wallet vide + bascule devise

**Files:** Modify `src/drivers/drivers.service.ts`

Méthode actuelle `adminReviewCountryChangeRequest` (~ligne 290) : à l'approbation, met juste à jour `driverProfile.countryCode`.

- [ ] **Step 1 : Garder l'approbation par le solde + basculer la devise**

READ `adminReviewCountryChangeRequest` (lignes ~290-310). Importer le helper : `import { canChangeCountry } from './wallet-guard';`. Modifier le bloc `if (status === 'approved')` :
```typescript
    if (status === 'approved') {
      // Le wallet de gains (argent réel) doit être vidé avant de basculer de pays.
      const wallet = await this.prisma.driverEarningsWallet.findUnique({
        where: { driverProfileId: req.driverProfileId },
        select: { balance: true },
      });
      const guard = canChangeCountry(wallet?.balance ?? 0);
      if (!guard.ok) {
        throw new BadRequestException(guard.reason);
      }
      const newCountry = req.requestedCountry.toUpperCase();
      // Devise du nouveau pays
      const newCurrency = (await this.prisma.country.findUnique({
        where: { code: newCountry }, select: { currency: true },
      }))?.currency ?? null;
      await this.prisma.driverProfile.update({
        where: { id: req.driverProfileId },
        data: { countryCode: newCountry },
      });
      if (newCurrency) {
        await this.prisma.driverEarningsWallet.updateMany({
          where: { driverProfileId: req.driverProfileId },
          data: { currency: newCurrency },
        });
      }
      this.logger.log(`Country change approved: driverProfile ${req.driverProfileId} → ${newCountry} (currency ${newCurrency})`);
    }
```
IMPORTANT : le statut de la demande a déjà été mis à `approved` PLUS HAUT dans la méthode (l'`update` du `countryChangeRequest`). Si le guard throw APRÈS ce passage à `approved`, la demande resterait marquée approuvée sans le changement effectif. VÉRIFIER l'ordre : si le `countryChangeRequest.update({ status })` précède ce bloc, DÉPLACER le check du solde AVANT cet update (faire le guard tout en haut du `if (status === 'approved')` logique, c.-à-d. avant de marquer la demande approuvée). Réorganiser pour que : (1) on lit le solde, (2) si non-ok → throw (demande reste `pending`), (3) sinon on marque approved + applique le changement. Adapter proprement.

VÉRIFIER le nom du modèle Prisma : `driverEarningsWallet` (mappé `driver_earnings_wallets`). Adapter si l'accès Prisma diffère.

- [ ] **Step 2 : Compiler**

Run : `./node_modules/.bin/tsc --noEmit 2>&1 | grep -i "drivers.service" || echo "OK"`
Expected : `OK`.

- [ ] **Step 3 : Commit**

`git add src/drivers/drivers.service.ts` (patch-stagé, bare commit) → `feat(pays): changement pays chauffeur exige wallet vide + bascule devise`.

---

### Task 3 : Recharge wallet — crédit points par pays

**Files:** Modify `src/payments/payments.controller.ts`, `src/bookings/bookings.scheduler.ts`

Aujourd'hui (`payments.controller.ts` ~804) :
```typescript
    const pointsToCredit: number = meta?.points ?? Math.floor(dbTx.amount / (tariffs.pointRechargeRate ?? tariffs.fcfaPerPoint ?? 1));
```
où `tariffs` vient d'un `getTariffs()` global. On résout par le pays de l'utilisateur du wallet.

- [ ] **Step 1 : payments.controller — tariffs par pays**

READ le contexte autour de la ligne 804 (comment `tariffs` est obtenu, et comment accéder à l'utilisateur du wallet `dbTx.walletId`). Résoudre le pays :
```typescript
    // Pays de l'utilisateur du wallet → taux de recharge local
    const walletOwner = await this.prisma.wallet.findUnique({
      where: { id: dbTx.walletId }, select: { user: { select: { phone: true, countryCode: true } } },
    });
    const rechargeCountry = walletOwner?.user?.countryCode
      ?? (walletOwner?.user?.phone ? extractCountryFromPhone(walletOwner.user.phone) : null);
    const tariffs = await this.settingsService.getTariffsByCountry(rechargeCountry);
```
puis garder la ligne `pointsToCredit` inchangée (elle lit `tariffs.pointRechargeRate`). VÉRIFIER : le nom du service settings injecté, que `wallet` a une relation `user`, et importer `extractCountryFromPhone` de `../common/phone-country` si absent. ADAPTER : si `tariffs` était déjà chargé via `getTariffs()` plus haut, remplacer cet appel par `getTariffsByCountry(rechargeCountry)`.

- [ ] **Step 2 : bookings.scheduler — retry recharge par pays**

READ `bookings.scheduler.ts` ~626 (`retryStuckFlutterwaveTransactions`). Même transformation : résoudre le pays via le wallet de la transaction et utiliser `getTariffsByCountry(rechargeCountry)` au lieu du `getTariffs()` global. Si le pays n'est pas trivialement accessible dans ce scope, le charger via `prisma.wallet.findUnique(...user...)`. ADAPTER.

- [ ] **Step 3 : Compiler**

Run : `./node_modules/.bin/tsc --noEmit 2>&1 | grep -iE "payments.controller|bookings.scheduler" || echo "OK"`
Expected : `OK`.

- [ ] **Step 4 : Commit**

`git add src/payments/payments.controller.ts src/bookings/bookings.scheduler.ts` (patch-stagé) → `feat(pays): recharge wallet crédit points par pays`.

---

### Task 4 : Déploiement + validation

- [ ] **Step 1 : Déployer** (base64 → `qm guest exec 101`, chunké pour bookings.scheduler si besoin) : `wallet-guard.ts`, `drivers.service.ts`, `payments.controller.ts`, `bookings.scheduler.ts`. Rebuild + up api.
- [ ] **Step 2 : Valider**
  - API `healthy`.
  - **Régression nulle** : aucun override `tariffs_config:PAYS` au-delà de l'existant → recharge inchangée ; un chauffeur sans solde change de pays comme avant.
  - Test guard : poser un solde > 0 sur un `driver_earnings_wallets` de test → l'approbation d'un changement de pays renvoie 400 "Retrait requis" ; remettre 0 → approbation OK + `currency` basculée.

---

## Hors-scope (différé)

- **Format devise à l'affichage mobile** (`currencyDecimals`/`currencySymbol` du bundle Phase 6) — refinement UI passager/chauffeur ; les données sont déjà exposées par `/config/bundle`.
- **`Country.pointFxRate`** comme source unique d'ancrage : la recharge utilise `tariffs.pointRechargeRate` par pays (déjà l'unité de conversion locale↔points). Unifier `pointFxRate`/`pointRechargeRate` est une simplification future, non requise pour la fonction.

## Self-Review (effectuée)

**Couverture spec Phase 7 :** wallet chauffeur au changement de pays (#2) → T1,T2 ✓ ; recharge/points par pays (#1 ancrage via taux local) → T3 ✓. Format devise affichage → différé (données déjà dans le bundle).

**Rétro-compatibilité :** `getTariffsByCountry(null)` == global ; un chauffeur à solde 0 (cas normal) change de pays sans friction.

**Cohérence types :** `canChangeCountry(balance)→{ok,reason?}`, `getTariffsByCountry(country)`, `driverEarningsWallet`, `extractCountryFromPhone` — cohérents.

**Placeholders :** aucun ; les `VÉRIFIER`/`ADAPTER` pointent l'ordre du statut approved, le nom du modèle wallet, la relation wallet→user, le service settings, avec instruction d'adapter.
