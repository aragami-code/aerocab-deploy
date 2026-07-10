# Config par pays — Phase 2 (Admin core) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Doter l'admin du socle multi-pays — activation/readiness des pays, hub "Pays", sélecteur de pays global, RBAC scopé par pays (`countryScope`), et filtre stats par pays.

**Architecture:** S'appuie sur la Phase 1 (table `Country` enrichie, `CountriesService`, résolveur `getForCountry`). On ajoute la logique d'activation (readiness), des endpoints hub `/admin/countries`, le champ `UserAdminRole.countryScope` + helper de résolution, et le filtre `?country=` sur les stats. Côté admin React : un contexte "pays sélectionné" + une page Hub Pays.

**Tech Stack:** NestJS + Prisma, Jest (backend) ; React + Vite, Vitest (admin).

**Spec :** `docs/superpowers/specs/2026-06-03-config-par-pays-design.md` (§5.3 activation, §5.7 RBAC, §6.1 sélecteur, §6.3 hub, §6.4 stats)

**Working dir backend :** `/home/aragami/aerogo24V2/aerocab-deploy/backend` — branche `feat/config-par-pays` (déjà active).
**Working dir admin :** `/home/aragami/aerogo24V2/aerocab-admin` — branche courante (ne pas basculer sur main).

**Convention git (repos à grosses modifs non-commitées) :** `git add <chemins exacts>`, JAMAIS `-A`/`.`. Fichiers déjà modifiés hors feature (`schema.prisma`, `app.module.ts`, `seed-rbac.ts`, admin `App.tsx`/`Sidebar.tsx`/`api.ts`) → patch-stager uniquement ses hunks (méthode swap : backup worktree, `git show HEAD:<path>`, réappliquer ses lignes, stager, restaurer).

**Acquis Phase 1 :** `CountriesService` expose `list()`, `findActive()`, `getDefaultCountryCode()`, `setDefault(code)`, `backfillKnownCountries()`. Modèle `Country` : `code @unique VarChar(3)`, `status CountryStatus`, `isDefault`, `currency`, `paymentMethods` (Json), `accessPrice`, `airports` (Json), + métadonnées (`phonePrefix`, `currencySymbol`, etc.).

---

## File Structure

**Backend**
- `prisma/schema.prisma` — **Modify** : `UserAdminRole.countryScope String[]`
- `prisma/seed-rbac.ts` — **Modify** : permission `manage_countries`
- `src/countries/countries.service.ts` — **Modify** : `getReadiness`, `activate`, `suspend`
- `src/countries/countries.service.spec.ts` — **Modify** : tests readiness/activate
- `src/countries/countries.controller.ts` — **Create** : hub `/admin/countries`
- `src/countries/countries.module.ts` — **Modify** : déclarer le controller
- `src/rbac/country-scope.service.ts` — **Create** : `getAdminCountryScope(userId)`
- `src/rbac/country-scope.service.spec.ts` — **Create** : tests
- `src/admin/rbac-admin.service.ts` — **Modify** : `assignRole` accepte `countryScope`

**Admin**
- `src/contexts/CountryContext.tsx` — **Create** : contexte pays sélectionné
- `src/components/CountrySelector.tsx` — **Create** : sélecteur barre du haut
- `src/pages/PaysPage.tsx` — **Create** : hub Pays
- `src/services/api.ts` — **Modify** : méthodes countries hub
- `src/App.tsx` / `src/components/Sidebar.tsx` — **Modify** : route + nav + montage contexte/sélecteur

---

### Task 1 : `countryScope` sur UserAdminRole + permission `manage_countries`

**Files:**
- Modify: `prisma/schema.prisma`, `prisma/seed-rbac.ts`

- [ ] **Step 1 : Ajouter le champ countryScope**

Dans `prisma/schema.prisma`, modèle `UserAdminRole`, ajouter (après `roleId`) :
```prisma
  countryScope String[]  @default([]) @map("country_scope")
```
(`[]` = tous pays / admin global ; `['SN']` = scopé. Défaut `[]` → les admins actuels gardent l'accès total.)

- [ ] **Step 2 : Ajouter la permission**

Dans `prisma/seed-rbac.ts`, dans le tableau `PERMISSIONS`, ajouter :
```typescript
  { key: 'manage_countries',          group: 'countries', description: 'Créer, activer et configurer les pays opérés' },
```
Et l'ajouter à la liste de permissions du rôle `admin` dans la matrice (le `super_admin` l'obtient via le wildcard `PERMISSIONS.map(p => p.key)` — vérifier ce pattern dans le fichier).

- [ ] **Step 3 : Générer + vérifier**

Run : `npx prisma generate`
Expected : "Generated Prisma Client" sans erreur. (Pas de `db push` local.)
Run : `npx tsc --noEmit 2>&1 | grep -i "seed-rbac" || echo "OK"`
Expected : `OK`.

- [ ] **Step 4 : Commit (patch-stagé)**

Stager uniquement les hunks dans `prisma/schema.prisma` + `prisma/seed-rbac.ts`. Commit : `feat(pays): countryScope sur UserAdminRole + permission manage_countries`.

---

### Task 2 : Readiness + activation pays (TDD)

**Files:**
- Modify: `src/countries/countries.service.ts`, `src/countries/countries.service.spec.ts`

- [ ] **Step 1 : Écrire les tests (échec attendu)**

Ajouter dans `src/countries/countries.service.spec.ts` un nouveau `describe`. Le `getReadiness` vérifie : devise + ≥1 payment method + ≥1 tarif (présence `tariffs_config:<code>`) + ≥1 aéroport opéré. On mocke `prisma.country.findUnique` + `prisma.appSetting.findUnique` (tarifs) + `prisma.airport.count`.

```typescript
describe('CountriesService.getReadiness + activate', () => {
  function make(country: any, opts: { tariffs?: boolean; operatedAirports?: number } = {}) {
    const prisma = {
      country: {
        findUnique: async () => country,
        update: async ({ data }: any) => ({ ...country, ...data }),
      },
      appSetting: {
        findUnique: async ({ where: { key } }: any) =>
          (opts.tariffs && key === `tariffs_config:${country.code}`) ? { key, value: '{}' } : null,
      },
      airport: { count: async () => opts.operatedAirports ?? 0 },
    } as any;
    return new CountriesService(prisma);
  }

  it('readiness incomplet liste les manquants', async () => {
    const svc = make({ code: 'KE', currency: 'KES', paymentMethods: [] }, { tariffs: false, operatedAirports: 0 });
    const r = await svc.getReadiness('KE');
    expect(r.ready).toBe(false);
    expect(r.missing).toEqual(expect.arrayContaining(['payment_methods', 'tariffs', 'operated_airports']));
  });

  it('readiness complet → ready', async () => {
    const svc = make(
      { code: 'KE', currency: 'KES', paymentMethods: [{ id: 'mpesa' }] },
      { tariffs: true, operatedAirports: 2 },
    );
    const r = await svc.getReadiness('KE');
    expect(r.ready).toBe(true);
    expect(r.missing).toEqual([]);
  });

  it('activate refuse si non ready', async () => {
    const svc = make({ code: 'KE', currency: 'KES', paymentMethods: [] }, { tariffs: false });
    await expect(svc.activate('KE')).rejects.toThrow(/incomplet/i);
  });

  it('activate passe le statut à active si ready', async () => {
    const svc = make(
      { code: 'KE', currency: 'KES', paymentMethods: [{ id: 'mpesa' }] },
      { tariffs: true, operatedAirports: 1 },
    );
    const res = await svc.activate('KE');
    expect(res.status).toBe('active');
  });
});
```

- [ ] **Step 2 : Lancer (échec)**

Run : `npx jest src/countries/countries.service.spec.ts -t "getReadiness + activate"`
Expected : FAIL — `getReadiness is not a function`.

- [ ] **Step 3 : Implémenter**

Ajouter à `CountriesService` (importer `BadRequestException` de `@nestjs/common`) :

```typescript
  /** Vérifie la complétude config d'un pays pour activation. */
  async getReadiness(code: string): Promise<{ ready: boolean; missing: string[] }> {
    const cc = code.toUpperCase();
    const country = await this.prisma.country.findUnique({ where: { code: cc } });
    const missing: string[] = [];
    if (!country) return { ready: false, missing: ['country_not_found'] };
    if (!country.currency) missing.push('currency');
    const methods = (country.paymentMethods as any[]) ?? [];
    if (!Array.isArray(methods) || methods.length === 0) missing.push('payment_methods');
    const tariffs = await this.prisma.appSetting.findUnique({ where: { key: `tariffs_config:${cc}` } });
    if (!tariffs) missing.push('tariffs');
    const operated = await this.prisma.airport.count({ where: { countryCode: cc, isOperated: true } as any });
    if (operated < 1) missing.push('operated_airports');
    return { ready: missing.length === 0, missing };
  }

  /** Active un pays après vérification de complétude. */
  async activate(code: string) {
    const r = await this.getReadiness(code);
    if (!r.ready) {
      throw new BadRequestException(`Pays incomplet : ${r.missing.join(', ')}`);
    }
    return this.prisma.country.update({ where: { code: code.toUpperCase() }, data: { status: 'active' } });
  }

  /** Suspend un pays (les nouvelles réservations seront bloquées). */
  async suspend(code: string) {
    return this.prisma.country.update({ where: { code: code.toUpperCase() }, data: { status: 'suspended' } });
  }
```
VÉRIFIER : le champ aéroport opéré est bien `isOperated` + `countryCode` sur le modèle `Airport` (chercher dans schema.prisma `model Airport`). Adapter le `where` du `count` au vrai nom de colonne.

- [ ] **Step 4 : Lancer (succès)**

Run : `npx jest src/countries/countries.service.spec.ts`
Expected : tous PASS (3 anciens + 4 nouveaux).

- [ ] **Step 5 : Commit**

`git add src/countries/countries.service.ts src/countries/countries.service.spec.ts` → `feat(pays): readiness + activation/suspension pays (TDD)`.

---

### Task 3 : Controller hub `/admin/countries`

**Files:**
- Create: `src/countries/countries.controller.ts`
- Modify: `src/countries/countries.module.ts`

- [ ] **Step 1 : Créer le controller**

`src/countries/countries.controller.ts` :

```typescript
import { Controller, Get, Post, Patch, Param, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, RolesGuard } from '../auth/guards';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { RequirePermission } from '../rbac/require-permission.decorator';
import { CountriesService } from './countries.service';

@Controller('admin/countries')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@RequirePermission('manage_countries')
export class CountriesController {
  constructor(private readonly countries: CountriesService) {}

  @Get() list() { return this.countries.list(); }

  @Get(':code/readiness') readiness(@Param('code') code: string) {
    return this.countries.getReadiness(code);
  }

  @Post() create(@Body() dto: {
    code: string; name: string; currency: string; currencySymbol?: string;
    currencyDecimals?: number; phonePrefix?: string; flagEmoji?: string; pointFxRate?: number;
  }) {
    return this.countries.createCountry(dto);
  }

  @Patch(':code/activate') activate(@Param('code') code: string) { return this.countries.activate(code); }
  @Patch(':code/suspend')  suspend(@Param('code') code: string)  { return this.countries.suspend(code); }
  @Patch(':code/default')  setDefault(@Param('code') code: string) {
    return this.countries.setDefault(code).then(() => ({ ok: true, code: code.toUpperCase() }));
  }
}
```

- [ ] **Step 2 : Ajouter `createCountry` au service**

Dans `CountriesService` :
```typescript
  /** Crée un pays en statut draft (devra être activé après config). */
  createCountry(dto: {
    code: string; name: string; currency: string; currencySymbol?: string;
    currencyDecimals?: number; phonePrefix?: string; flagEmoji?: string; pointFxRate?: number;
  }) {
    const cc = dto.code.trim().toUpperCase();
    return this.prisma.country.upsert({
      where: { code: cc },
      update: {},
      create: {
        code: cc, name: dto.name, currency: dto.currency,
        currencySymbol: dto.currencySymbol ?? null, currencyDecimals: dto.currencyDecimals ?? 0,
        phonePrefix: dto.phonePrefix ?? null, flagEmoji: dto.flagEmoji ?? null,
        pointFxRate: dto.pointFxRate ?? 1, status: 'draft', paymentMethods: [],
      },
    });
  }
```

- [ ] **Step 3 : Déclarer le controller dans le module**

Dans `src/countries/countries.module.ts`, ajouter `controllers: [CountriesController]` (importer le controller + `RbacModule` si `PermissionsGuard` l'exige — vérifier comment `announcements.module.ts` câble `PermissionsGuard`).

- [ ] **Step 4 : Compiler**

Run : `npx tsc --noEmit 2>&1 | grep -i "countries" || echo "OK"`
Expected : `OK`.

- [ ] **Step 5 : Commit**

`git add src/countries/countries.controller.ts src/countries/countries.service.ts src/countries/countries.module.ts` → `feat(pays): hub /admin/countries (CRUD + activation)`.

---

### Task 4 : `CountryScopeService` (TDD)

**Files:**
- Create: `src/rbac/country-scope.service.ts`, `src/rbac/country-scope.service.spec.ts`
- Modify: `src/admin/rbac-admin.service.ts`

- [ ] **Step 1 : Test (échec)**

`src/rbac/country-scope.service.spec.ts` :
```typescript
import { CountryScopeService } from './country-scope.service';

describe('CountryScopeService.getAdminCountryScope', () => {
  function make(rows: any[]) {
    const prisma = { userAdminRole: { findMany: async () => rows } } as any;
    return new CountryScopeService(prisma);
  }
  it('union des scopes des rôles', async () => {
    const svc = make([{ countryScope: ['SN'] }, { countryScope: ['KE'] }]);
    expect((await svc.getAdminCountryScope('u1')).sort()).toEqual(['KE', 'SN']);
  });
  it('un rôle global ([]) → accès tous pays (scope vide)', async () => {
    const svc = make([{ countryScope: [] }, { countryScope: ['SN'] }]);
    expect(await svc.getAdminCountryScope('u1')).toEqual([]); // [] = tous pays
  });
  it('isAllowed: scope vide autorise tout', async () => {
    const svc = make([{ countryScope: [] }]);
    expect(await svc.isAllowed('u1', 'CM')).toBe(true);
  });
  it('isAllowed: scopé refuse hors périmètre', async () => {
    const svc = make([{ countryScope: ['SN'] }]);
    expect(await svc.isAllowed('u1', 'CM')).toBe(false);
    expect(await svc.isAllowed('u1', 'SN')).toBe(true);
  });
});
```

- [ ] **Step 2 : Lancer (échec)**

Run : `npx jest src/rbac/country-scope.service.spec.ts`
Expected : FAIL — module introuvable.

- [ ] **Step 3 : Implémenter**

`src/rbac/country-scope.service.ts` :
```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class CountryScopeService {
  constructor(private readonly prisma: PrismaService) {}

  /** Scope pays effectif de l'admin. [] = tous pays (au moins un rôle global). */
  async getAdminCountryScope(userId: string): Promise<string[]> {
    const roles = await this.prisma.userAdminRole.findMany({
      where: { userId }, select: { countryScope: true },
    });
    if (roles.some((r) => (r.countryScope ?? []).length === 0)) return []; // global
    const union = new Set<string>();
    for (const r of roles) for (const c of r.countryScope ?? []) union.add(c.toUpperCase());
    return [...union];
  }

  /** Vrai si l'admin peut agir sur ce pays. Scope vide = tous pays. */
  async isAllowed(userId: string, countryCode: string): Promise<boolean> {
    const scope = await this.getAdminCountryScope(userId);
    if (scope.length === 0) return true;
    return scope.includes(countryCode.toUpperCase());
  }
}
```

- [ ] **Step 4 : Lancer (succès)**

Run : `npx jest src/rbac/country-scope.service.spec.ts`
Expected : PASS (4 tests).

- [ ] **Step 5 : `assignRole` accepte countryScope**

Dans `src/admin/rbac-admin.service.ts`, méthode `assignRole(userId, roleId)` → ajouter un paramètre optionnel `countryScope: string[] = []` et le passer au `create`/`update` du `userAdminRole`. Adapter les appels existants (rétro-compat : défaut `[]`).

- [ ] **Step 6 : Déclarer `CountryScopeService`**

Dans le module RBAC (`src/rbac/rbac.module.ts`), ajouter `CountryScopeService` aux `providers` + `exports`.

- [ ] **Step 7 : Compiler + tester**

Run : `npx tsc --noEmit 2>&1 | grep -iE "country-scope|rbac-admin" || echo "OK"`
Run : `npx jest src/rbac/country-scope.service.spec.ts`
Expected : OK + 4 PASS.

- [ ] **Step 8 : Commit**

`git add src/rbac/country-scope.service.ts src/rbac/country-scope.service.spec.ts src/rbac/rbac.module.ts src/admin/rbac-admin.service.ts` → `feat(pays): CountryScopeService + assignRole scopé (TDD)`.

---

### Task 5 : Filtre stats `?country=`

**Files:**
- Modify: `src/admin/admin.service.ts` (méthodes `getStats`, `getChartData`), `src/admin/admin.controller.ts`

- [ ] **Step 1 : Lire l'existant**

Lire `getStats()` et `getChartData()` dans `src/admin/admin.service.ts` pour voir les requêtes (agrégats bookings/users/revenus).

- [ ] **Step 2 : Ajouter le filtre pays**

Modifier `getStats(country?: string)` et `getChartData(country?: string)` : quand `country` est fourni, ajouter `where: { operatingCountry: country.toUpperCase() }` sur les requêtes bookings, et `where: { countryCode: country.toUpperCase() }` sur les requêtes users/drivers. Quand absent → comportement actuel (tous pays). VÉRIFIER les noms réels des champs (`operatingCountry` sur Booking, `countryCode` sur User/DriverProfile).

- [ ] **Step 3 : Passer le query param**

Dans `src/admin/admin.controller.ts`, les routes stats/chart : ajouter `@Query('country') country?: string` et le transmettre au service.

- [ ] **Step 4 : Compiler**

Run : `npx tsc --noEmit 2>&1 | grep -i "admin.service\|admin.controller" || echo "OK"`
Expected : `OK`.

- [ ] **Step 5 : Commit**

`git add src/admin/admin.service.ts src/admin/admin.controller.ts` → `feat(pays): filtre stats par pays (?country=)`.

---

### Task 6 : Admin — contexte + sélecteur pays

**Files:**
- Create: `src/contexts/CountryContext.tsx`, `src/components/CountrySelector.tsx`
- Modify: `src/services/api.ts`, `src/App.tsx`

**Working dir : `/home/aragami/aerogo24V2/aerocab-admin`.**

- [ ] **Step 1 : Méthodes API**

Dans `src/services/api.ts`, ajouter (adapter au helper `request` réel, déjà connu : `{ method, body }`) :
```typescript
  async listOperatedCountries() { return this.request<any[]>('/admin/countries'); }
  async getCountryReadiness(code: string) { return this.request<{ ready: boolean; missing: string[] }>(`/admin/countries/${code}/readiness`); }
  async createOperatedCountry(data: any) { return this.request('/admin/countries', { method: 'POST', body: data }); }
  async activateCountry(code: string) { return this.request(`/admin/countries/${code}/activate`, { method: 'PATCH' }); }
  async suspendCountry(code: string) { return this.request(`/admin/countries/${code}/suspend`, { method: 'PATCH' }); }
  async setDefaultCountry(code: string) { return this.request(`/admin/countries/${code}/default`, { method: 'PATCH' }); }
```

- [ ] **Step 2 : Contexte pays**

`src/contexts/CountryContext.tsx` : un contexte `{ selected: string | 'GLOBAL', setSelected }`, persisté dans `localStorage['admin_country']`, défaut `'GLOBAL'`. Provider + hook `useCountry()`.

```tsx
import { createContext, useContext, useState, type ReactNode } from 'react';

type CountryCtx = { selected: string; setSelected: (c: string) => void };
const Ctx = createContext<CountryCtx>({ selected: 'GLOBAL', setSelected: () => {} });

export function CountryProvider({ children }: { children: ReactNode }) {
  const [selected, set] = useState<string>(() => localStorage.getItem('admin_country') ?? 'GLOBAL');
  const setSelected = (c: string) => { localStorage.setItem('admin_country', c); set(c); };
  return <Ctx.Provider value={{ selected, setSelected }}>{children}</Ctx.Provider>;
}
export const useCountry = () => useContext(Ctx);
```

- [ ] **Step 3 : Sélecteur**

`src/components/CountrySelector.tsx` : charge `listOperatedCountries()`, affiche un dropdown `Global` + chaque pays (drapeau + nom), met à jour `useCountry().setSelected`. Style cohérent avec la barre admin existante (lire un composant de header).

- [ ] **Step 4 : Monter le provider + le sélecteur**

Dans `src/App.tsx` : envelopper l'app avec `<CountryProvider>` et placer `<CountrySelector />` dans la barre du haut (repérer le header/layout). Patch-stager uniquement les hunks.

- [ ] **Step 5 : Build**

Run : `npx tsc --noEmit 2>&1 | grep -iE "CountryContext|CountrySelector|App.tsx" || echo "OK"` puis `npm run build`.
Expected : `OK` + build réussi.

- [ ] **Step 6 : Commit**

`git add src/contexts/CountryContext.tsx src/components/CountrySelector.tsx src/services/api.ts src/App.tsx` (App.tsx patch-stagé) → `feat(pays): sélecteur pays global admin + contexte`.

---

### Task 7 : Admin — page Hub Pays

**Files:**
- Create: `src/pages/PaysPage.tsx`
- Modify: `src/App.tsx`, `src/components/Sidebar.tsx`

- [ ] **Step 1 : Page**

`src/pages/PaysPage.tsx` (calquer la structure de `PromosPage.tsx`/`AnnoncesPage.tsx`) :
- liste `listOperatedCountries()` : drapeau, nom, devise, statut (badge draft/active/suspended), complétude (`getCountryReadiness` → ✓ ou liste des manquants).
- bouton "Nouveau pays" → formulaire (code ISO, nom, devise, symbole, décimales, préfixe, drapeau, pointFxRate) → `createOperatedCountry`.
- par ligne : bouton **Activer** (désactivé tant que `readiness.ready=false`, tooltip des manquants) → `activateCountry` ; **Suspendre** ; **Définir par défaut** → `setDefaultCountry`.

- [ ] **Step 2 : Route + sidebar**

`src/App.tsx` : `<Route path="/pays" element={<PermissionRoute permission="manage_countries"><PaysPage /></PermissionRoute>} />`.
`src/components/Sidebar.tsx` : importer `Globe` de lucide-react, ajouter `{ path: '/pays', label: 'Pays', icon: Globe, section: 'admin', permission: 'manage_countries' }`. Patch-stager.

- [ ] **Step 3 : Build**

Run : `npx tsc --noEmit 2>&1 | grep -iE "PaysPage|App.tsx|Sidebar" || echo "OK"` puis `npm run build`.
Expected : `OK` + build réussi.

- [ ] **Step 4 : Commit**

`git add src/pages/PaysPage.tsx src/App.tsx src/components/Sidebar.tsx` (patch-stagé) → `feat(pays): page hub Pays admin`.

---

### Task 8 : Déploiement + validation

- [ ] **Step 1 : Déployer backend** (méthode base64 → `qm guest exec 101`) : `schema.prisma`, `seed-rbac.ts`, `src/countries/*`, `src/rbac/country-scope.service.ts`, `src/rbac/rbac.module.ts`, `src/admin/admin.service.ts`, `src/admin/admin.controller.ts`, `src/admin/rbac-admin.service.ts`. `app.module.ts` inchangé (le controller est dans CountriesModule déjà enregistré). Rebuild + up api. `db push` ajoute `country_scope`.

- [ ] **Step 2 : Seeder la permission** `manage_countries` sur le VPS (INSERT idempotent + lien au rôle `super_admin`, comme pour `manage_announcements`).

- [ ] **Step 3 : Déployer admin** : transférer `PaysPage.tsx`, `CountryContext.tsx`, `CountrySelector.tsx`, `App.tsx`, `Sidebar.tsx`, `api.ts` ; rebuild conteneur admin.

- [ ] **Step 4 : Valider**
  - `GET /api/admin/countries` (avec token super_admin) → liste CM/SN avec statut.
  - `GET /api/admin/countries/SN/readiness` → ready/missing cohérent.
  - Colonne `country_scope` présente sur `user_admin_roles`.
  - UI admin : sélecteur pays visible, page **Pays** accessible, activation gardée par readiness.

---

## Self-Review (effectuée)

**Couverture spec Phase 2 :** activation/readiness (§5.3) → T2 ✓ ; hub Pays (§6.3) → T3,T7 ✓ ; sélecteur global (§6.1) → T6 ✓ ; RBAC countryScope (§5.7) → T1,T4 ✓ ; stats par pays (§6.4) → T5 ✓.

**Hors Phase 2 (volontaire) :** rendre chaque page domaine country-aware (Phases 3-5) ; guard transversal d'étanchéité sur TOUS les endpoints data (la fondation `CountryScopeService.isAllowed` est posée ici, l'application exhaustive viendra avec chaque domaine) ; comparatif stats "Global" (UI, Phase 3 avec le domaine Financier).

**Cohérence types :** `getReadiness(code)→{ready,missing}`, `activate/suspend(code)`, `createCountry(dto)`, `getAdminCountryScope(userId)→string[]`, `isAllowed(userId,code)→bool`, `countryScope String[]` — noms identiques entre tasks/spec.

**Placeholders :** aucun — code complet à chaque step ; les `VÉRIFIER` indiquent les noms réels à confirmer (isOperated/countryCode, operatingCountry) avec instruction d'adapter.
