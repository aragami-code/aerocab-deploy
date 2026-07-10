# AeroGo V3 — Cœur multi-tenant (fondation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Poser l'infrastructure multi-tenant (modèle `Tenant`, colonne `tenantId`, contexte de requête, middleware Prisma d'isolation, cascade de config tenant-aware) dans V3 de façon que la prod actuelle continue de fonctionner à l'identique sous un unique « tenant zéro » (`aerogo`).

**Architecture:** Approche A (row-level). Un `AsyncLocalStorage` porte le `tenantId` de la requête (résolu depuis le JWT, défaut = tenant zéro). Un middleware Prisma `$use` injecte automatiquement `WHERE tenantId = ...` sur les modèles scopés. Il tourne d'abord en **mode WARN** (log sans bloquer) puis bascule en **mode ENFORCE** (fail-closed). La cascade de settings gagne un niveau tenant au-dessus du niveau pays existant.

**Tech Stack:** NestJS 10, Prisma (PostgreSQL, modèle de déploiement `prisma db push`), Node `AsyncLocalStorage`, Jest.

## Global Constraints

- Base de travail : `/home/aragami/aerogo24V3/aerocab-deploy/backend`. Ne jamais toucher `/home/aragami/aerogo24V2` ni `/home/aragami/aerogo`.
- Déploiement Prisma = `prisma db push` (pas de migrations SQL versionnées). Toute colonne ajoutée doit être **nullable** en Phase A.
- Tenant zéro : `slug = "aerogo"`, `id` fixe `"aerogo"` (constante `ZERO_TENANT_ID`). La base prod réelle s'appelle `aerogo24` (stack `docker-compose.yml`).
- `tsc` doit rester à 0 erreur ; la suite Jest existante doit rester verte (régression = échec).
- Isolation = composant critique : chaque tâche touchant le middleware finit par un test d'isolation vert.
- Convention DB : colonnes en `snake_case` via `@map`, tables via `@@map` (suivre le schéma existant).

---

### Task 1: Modèle `Tenant`, `TenantCountry`, enums, et constantes de tenancy

**Files:**
- Modify: `prisma/schema.prisma` (ajout des modèles en fin de fichier)
- Create: `src/tenancy/tenant.constants.ts`
- Test: `src/tenancy/tenant.constants.spec.ts`

**Interfaces:**
- Produces: `ZERO_TENANT_ID = 'aerogo'` (string) ; `TENANT_SCOPED_MODELS: ReadonlySet<string>` (noms de modèles Prisma PascalCase soumis à l'isolation).

- [ ] **Step 1: Écrire les modèles Prisma**

Ajouter à la fin de `prisma/schema.prisma` :

```prisma
enum TenantStatus { TRIAL ACTIVE SUSPENDED }
enum LicenseMode  { ENFORCED PERPETUAL DISABLED }

model Tenant {
  id                String        @id                       // ex: "aerogo" (tenant zéro)
  slug              String        @unique
  name              String
  status            TenantStatus  @default(ACTIVE)

  licenseKey        String        @unique
  licenseMode       LicenseMode   @default(ENFORCED)
  licenseExpiry     DateTime?     @map("license_expiry")

  logoUrl           String?       @map("logo_url")
  primaryColor      String?       @map("primary_color")
  appNamePassenger  String?       @map("app_name_passenger")
  appNameDriver     String?       @map("app_name_driver")
  bundleIdPassenger String?       @map("bundle_id_passenger")
  bundleIdDriver    String?       @map("bundle_id_driver")

  operatingModel    Json          @default("{}") @map("operating_model")

  countries         TenantCountry[]
  createdAt         DateTime      @default(now()) @map("created_at")
  updatedAt         DateTime      @updatedAt      @map("updated_at")

  @@map("tenants")
}

model TenantCountry {
  id          String  @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId    String  @map("tenant_id")
  countryCode String  @map("country_code")
  tenant      Tenant  @relation(fields: [tenantId], references: [id])

  @@unique([tenantId, countryCode])
  @@map("tenant_countries")
}
```

- [ ] **Step 2: Écrire le test des constantes (échoue d'abord)**

Créer `src/tenancy/tenant.constants.spec.ts` :

```typescript
import { ZERO_TENANT_ID, TENANT_SCOPED_MODELS } from './tenant.constants';

describe('tenant.constants', () => {
  it('tenant zéro = aerogo', () => {
    expect(ZERO_TENANT_ID).toBe('aerogo');
  });
  it('inclut les modèles opérationnels clés et exclut les partagés', () => {
    expect(TENANT_SCOPED_MODELS.has('Booking')).toBe(true);
    expect(TENANT_SCOPED_MODELS.has('User')).toBe(true);
    expect(TENANT_SCOPED_MODELS.has('Wallet')).toBe(true);
    expect(TENANT_SCOPED_MODELS.has('Country')).toBe(false);
    expect(TENANT_SCOPED_MODELS.has('Airport')).toBe(false);
    expect(TENANT_SCOPED_MODELS.has('AppSetting')).toBe(false); // cascade, pas filtré
    expect(TENANT_SCOPED_MODELS.has('Tenant')).toBe(false);
  });
});
```

- [ ] **Step 3: Lancer le test, vérifier qu'il échoue**

Run: `cd /home/aragami/aerogo24V3/aerocab-deploy/backend && npx jest src/tenancy/tenant.constants.spec.ts`
Expected: FAIL — `Cannot find module './tenant.constants'`.

- [ ] **Step 4: Écrire les constantes**

Créer `src/tenancy/tenant.constants.ts` :

```typescript
export const ZERO_TENANT_ID = 'aerogo';

/**
 * Modèles Prisma (PascalCase) soumis à l'isolation par tenantId.
 * NB : AppSetting est EXCLU (géré par la cascade tenant-aware, pas par le filtre).
 * Partagés plateforme exclus : Country, Airport, Permission, AdminRole, RolePermission.
 */
export const TENANT_SCOPED_MODELS: ReadonlySet<string> = new Set([
  'User', 'DriverProfile', 'DriverDocument', 'CountryChangeRequest', 'Flight',
  'Booking', 'BookingParticipant', 'BookingPayout', 'PaymentIntent', 'PaymentLink',
  'TipTransaction', 'RideReceipt', 'ReceiptJob', 'DriverRegistrationPayment',
  'DriverEarningsWallet', 'Wallet', 'Transaction', 'WithdrawalRequest', 'PromoCode',
  'PromoUsage', 'Forfait', 'PricingZone', 'DriverPosition', 'PointsTransaction',
  'Rating', 'Report', 'TicketMessage', 'Conversation', 'Message', 'Announcement',
  'AnnouncementRead', 'KycDocument', 'EmergencyContact', 'AdminNotification',
  'FavoriteDriver', 'TariffSnapshot', 'AuditLog', 'UserAdminRole', 'UserPermission',
]);
```

- [ ] **Step 5: Lancer le test, vérifier qu'il passe**

Run: `npx jest src/tenancy/tenant.constants.spec.ts`
Expected: PASS.

- [ ] **Step 6: Régénérer le client Prisma et vérifier tsc**

Run: `npx prisma generate && npx tsc --noEmit`
Expected: 0 erreur.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma src/tenancy/tenant.constants.ts src/tenancy/tenant.constants.spec.ts
git commit -m "feat(tenancy): add Tenant/TenantCountry models + tenancy constants"
```

---

### Task 2: Ajouter `tenantId` (nullable) aux modèles scopés + `AppSetting`

**Files:**
- Modify: `prisma/schema.prisma` (37 modèles scopés + `AppSetting`)
- Test: `src/tenancy/schema-tenantid.spec.ts`

**Interfaces:**
- Produces: colonne `tenant_id` (nullable) présente sur tous les modèles de `TENANT_SCOPED_MODELS` et sur `AppSetting`.

- [ ] **Step 1: Écrire le test de présence de colonne (échoue d'abord)**

Créer `src/tenancy/schema-tenantid.spec.ts` :

```typescript
import { readFileSync } from 'fs';
import { join } from 'path';
import { TENANT_SCOPED_MODELS } from './tenant.constants';

const schema = readFileSync(join(__dirname, '../../prisma/schema.prisma'), 'utf8');

/** Extrait le bloc d'un modèle Prisma par son nom. */
function modelBlock(name: string): string {
  const re = new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`, 'm');
  const m = schema.match(re);
  if (!m) throw new Error(`modèle ${name} introuvable`);
  return m[1];
}

describe('tenantId nullable sur les modèles scopés', () => {
  for (const model of TENANT_SCOPED_MODELS) {
    it(`${model} a un champ tenantId String? mappé tenant_id`, () => {
      const block = modelBlock(model);
      expect(block).toMatch(/tenantId\s+String\?\s+@map\("tenant_id"\)/);
    });
  }
  it('AppSetting a tenantId nullable', () => {
    expect(modelBlock('AppSetting')).toMatch(/tenantId\s+String\?\s+@map\("tenant_id"\)/);
  });
});
```

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `npx jest src/tenancy/schema-tenantid.spec.ts`
Expected: FAIL sur chaque modèle (champ absent).

- [ ] **Step 3: Ajouter le champ à chaque modèle**

Dans `prisma/schema.prisma`, ajouter dans **chacun** des 37 modèles listés dans `TENANT_SCOPED_MODELS` la ligne (juste après le champ `id`) :

```prisma
  tenantId  String?  @map("tenant_id")
  @@index([tenantId])
```

Et pour `AppSetting`, remplacer le bloc par :

```prisma
model AppSetting {
  key       String   @id
  value     String
  tenantId  String?  @map("tenant_id")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@map("app_settings")
}
```

> Note : `AppSetting` garde `key` en `@id` pour cette phase (compat totale). La distinction par tenant se fera par convention de clé + colonne en Task 7 ; ici on ne fait qu'ajouter la colonne.

- [ ] **Step 4: Lancer, vérifier que ça passe**

Run: `npx jest src/tenancy/schema-tenantid.spec.ts`
Expected: PASS pour les 38 assertions.

- [ ] **Step 5: Régénérer + pousser le schéma sur une base de dev + tsc**

Run:
```bash
npx prisma generate
npx prisma db push --skip-generate
npx tsc --noEmit
```
Expected: `db push` applique les colonnes nullables sans perte ; tsc 0 erreur.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma src/tenancy/schema-tenantid.spec.ts
git commit -m "feat(tenancy): add nullable tenantId to 37 scoped models + AppSetting"
```

---

### Task 3: Contexte de tenant par requête (`AsyncLocalStorage`)

**Files:**
- Create: `src/tenancy/tenant-context.ts`
- Test: `src/tenancy/tenant-context.spec.ts`

**Interfaces:**
- Produces:
  - `interface TenantContext { tenantId: string | null; platformScope: boolean }`
  - `runWithTenant<T>(ctx: TenantContext, fn: () => T): T`
  - `getTenantContext(): TenantContext | undefined`
  - `getCurrentTenantId(): string | null` (tenantId courant, ou `null` si hors contexte)

- [ ] **Step 1: Écrire le test (échoue d'abord)**

Créer `src/tenancy/tenant-context.spec.ts` :

```typescript
import { runWithTenant, getTenantContext, getCurrentTenantId } from './tenant-context';

describe('tenant-context', () => {
  it('hors contexte → undefined / null', () => {
    expect(getTenantContext()).toBeUndefined();
    expect(getCurrentTenantId()).toBeNull();
  });

  it('propage le tenantId dans le callback', () => {
    const out = runWithTenant({ tenantId: 'taxiplus', platformScope: false }, () => {
      expect(getCurrentTenantId()).toBe('taxiplus');
      return 42;
    });
    expect(out).toBe(42);
    expect(getCurrentTenantId()).toBeNull(); // restauré après
  });

  it('isole les contextes imbriqués', () => {
    runWithTenant({ tenantId: 'a', platformScope: false }, () => {
      runWithTenant({ tenantId: 'b', platformScope: false }, () => {
        expect(getCurrentTenantId()).toBe('b');
      });
      expect(getCurrentTenantId()).toBe('a');
    });
  });
});
```

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `npx jest src/tenancy/tenant-context.spec.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Implémenter le contexte**

Créer `src/tenancy/tenant-context.ts` :

```typescript
import { AsyncLocalStorage } from 'async_hooks';

export interface TenantContext {
  tenantId: string | null;
  /** true = super-admin / control plane : accès inter-tenant explicite et audité. */
  platformScope: boolean;
}

const storage = new AsyncLocalStorage<TenantContext>();

export function runWithTenant<T>(ctx: TenantContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function getTenantContext(): TenantContext | undefined {
  return storage.getStore();
}

export function getCurrentTenantId(): string | null {
  return storage.getStore()?.tenantId ?? null;
}
```

- [ ] **Step 4: Lancer, vérifier que ça passe**

Run: `npx jest src/tenancy/tenant-context.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tenancy/tenant-context.ts src/tenancy/tenant-context.spec.ts
git commit -m "feat(tenancy): request-scoped tenant context via AsyncLocalStorage"
```

---

### Task 4: Middleware Prisma d'isolation (modes WARN et ENFORCE)

**Files:**
- Create: `src/tenancy/prisma-tenant.middleware.ts`
- Test: `src/tenancy/prisma-tenant.middleware.spec.ts`

**Interfaces:**
- Consumes: `TENANT_SCOPED_MODELS` (Task 1), `getTenantContext` (Task 3).
- Produces: `createTenantMiddleware(opts: { mode: 'warn' | 'enforce'; onViolation: (msg: string) => void }): Prisma.Middleware`

Comportement (uniquement pour `params.model ∈ TENANT_SCOPED_MODELS`) :
- Hors contexte OU `platformScope === true` → laisser passer sans rien modifier (le control plane et les jobs système passent).
- Contexte avec `tenantId` non nul :
  - lectures (`findFirst`, `findMany`, `count`, `aggregate`, `groupBy`, `updateMany`, `deleteMany`) → injecter `where.tenantId`.
  - `findUnique` / `findUniqueOrThrow` → réécrire en `findFirst` avec `where.tenantId` (findUnique n'accepte pas de filtre non-unique).
  - `create` → forcer `data.tenantId`.
  - `createMany` → forcer `tenantId` sur chaque ligne.
  - `update`/`delete`/`upsert` → injecter `where.tenantId` (et `create.tenantId` pour upsert).
- Contexte avec `tenantId === null` (pas de tenant résolu) :
  - `mode: 'warn'` → appeler `onViolation(...)` et **laisser passer** (phase C).
  - `mode: 'enforce'` → **jeter** une erreur (fail-closed, phase D).

- [ ] **Step 1: Écrire le test (échoue d'abord)**

Créer `src/tenancy/prisma-tenant.middleware.spec.ts` :

```typescript
import { createTenantMiddleware } from './prisma-tenant.middleware';
import { runWithTenant } from './tenant-context';

function fakeNext() {
  const calls: any[] = [];
  const next = async (params: any) => { calls.push(params); return params; };
  return { next, calls };
}

describe('prisma tenant middleware', () => {
  it('injecte tenantId sur findMany dans un contexte tenant', async () => {
    const mw = createTenantMiddleware({ mode: 'enforce', onViolation: () => {} });
    const { next, calls } = fakeNext();
    await runWithTenant({ tenantId: 'taxiplus', platformScope: false }, () =>
      mw({ model: 'Booking', action: 'findMany', args: { where: { status: 'pending' } } } as any, next),
    );
    expect(calls[0].args.where).toEqual({ status: 'pending', tenantId: 'taxiplus' });
  });

  it('réécrit findUnique en findFirst avec tenantId', async () => {
    const mw = createTenantMiddleware({ mode: 'enforce', onViolation: () => {} });
    const { next, calls } = fakeNext();
    await runWithTenant({ tenantId: 't1', platformScope: false }, () =>
      mw({ model: 'Wallet', action: 'findUnique', args: { where: { id: 'w1' } } } as any, next),
    );
    expect(calls[0].action).toBe('findFirst');
    expect(calls[0].args.where).toEqual({ id: 'w1', tenantId: 't1' });
  });

  it('force data.tenantId sur create', async () => {
    const mw = createTenantMiddleware({ mode: 'enforce', onViolation: () => {} });
    const { next, calls } = fakeNext();
    await runWithTenant({ tenantId: 't1', platformScope: false }, () =>
      mw({ model: 'Booking', action: 'create', args: { data: { fare: 100 } } } as any, next),
    );
    expect(calls[0].args.data.tenantId).toBe('t1');
  });

  it('ne touche PAS un modèle partagé (Country)', async () => {
    const mw = createTenantMiddleware({ mode: 'enforce', onViolation: () => {} });
    const { next, calls } = fakeNext();
    await runWithTenant({ tenantId: 't1', platformScope: false }, () =>
      mw({ model: 'Country', action: 'findMany', args: {} } as any, next),
    );
    expect(calls[0].args.where).toBeUndefined();
  });

  it('platformScope → ne filtre pas', async () => {
    const mw = createTenantMiddleware({ mode: 'enforce', onViolation: () => {} });
    const { next, calls } = fakeNext();
    await runWithTenant({ tenantId: null, platformScope: true }, () =>
      mw({ model: 'Booking', action: 'findMany', args: {} } as any, next),
    );
    expect(calls[0].args.where).toBeUndefined();
  });

  it('WARN + pas de tenant → onViolation appelé, laisse passer', async () => {
    const violations: string[] = [];
    const mw = createTenantMiddleware({ mode: 'warn', onViolation: (m) => violations.push(m) });
    const { next, calls } = fakeNext();
    await mw({ model: 'Booking', action: 'findMany', args: {} } as any, next);
    expect(violations.length).toBe(1);
    expect(calls.length).toBe(1);
  });

  it('ENFORCE + pas de tenant → jette (fail-closed)', async () => {
    const mw = createTenantMiddleware({ mode: 'enforce', onViolation: () => {} });
    const { next } = fakeNext();
    await expect(
      mw({ model: 'Booking', action: 'findMany', args: {} } as any, next),
    ).rejects.toThrow(/tenant/i);
  });
});
```

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `npx jest src/tenancy/prisma-tenant.middleware.spec.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Implémenter le middleware**

Créer `src/tenancy/prisma-tenant.middleware.ts` :

```typescript
import { Prisma } from '@prisma/client';
import { TENANT_SCOPED_MODELS } from './tenant.constants';
import { getTenantContext } from './tenant-context';

export interface TenantMiddlewareOptions {
  mode: 'warn' | 'enforce';
  onViolation: (message: string) => void;
}

const READ_INJECT = new Set([
  'findFirst', 'findFirstOrThrow', 'findMany', 'count', 'aggregate', 'groupBy',
  'updateMany', 'deleteMany',
]);
const WHERE_INJECT = new Set(['update', 'delete']);

export function createTenantMiddleware(opts: TenantMiddlewareOptions): Prisma.Middleware {
  return async (params, next) => {
    if (!params.model || !TENANT_SCOPED_MODELS.has(params.model)) {
      return next(params);
    }

    const ctx = getTenantContext();

    // Control plane / jobs système : accès explicite inter-tenant.
    if (ctx?.platformScope) return next(params);

    const tenantId = ctx?.tenantId ?? null;
    if (!tenantId) {
      const msg = `[tenant-isolation] ${params.model}.${params.action} sans tenant résolu`;
      if (opts.mode === 'enforce') {
        throw new Error(msg + ' — requête bloquée (fail-closed)');
      }
      opts.onViolation(msg);
      return next(params);
    }

    params.args = params.args ?? {};

    if (READ_INJECT.has(params.action) || WHERE_INJECT.has(params.action)) {
      params.args.where = { ...(params.args.where ?? {}), tenantId };
    } else if (params.action === 'findUnique' || params.action === 'findUniqueOrThrow') {
      params.action = params.action === 'findUnique' ? 'findFirst' : 'findFirstOrThrow';
      params.args.where = { ...(params.args.where ?? {}), tenantId };
    } else if (params.action === 'create') {
      params.args.data = { ...(params.args.data ?? {}), tenantId };
    } else if (params.action === 'createMany') {
      const data = params.args.data;
      params.args.data = Array.isArray(data)
        ? data.map((d: any) => ({ ...d, tenantId }))
        : { ...data, tenantId };
    } else if (params.action === 'upsert') {
      params.args.where = { ...(params.args.where ?? {}), tenantId };
      params.args.create = { ...(params.args.create ?? {}), tenantId };
    }

    return next(params);
  };
}
```

- [ ] **Step 4: Lancer, vérifier que ça passe**

Run: `npx jest src/tenancy/prisma-tenant.middleware.spec.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/tenancy/prisma-tenant.middleware.ts src/tenancy/prisma-tenant.middleware.spec.ts
git commit -m "feat(tenancy): Prisma isolation middleware (warn/enforce modes)"
```

---

### Task 5: Brancher le middleware dans `PrismaService` (mode WARN via env)

**Files:**
- Modify: `src/database/prisma.service.ts`
- Test: `src/tenancy/prisma-service-integration.spec.ts`

**Interfaces:**
- Consumes: `createTenantMiddleware` (Task 4).
- Le mode est piloté par `process.env.TENANT_ISOLATION_MODE` (`'warn'` par défaut, `'enforce'` pour la phase D). Les violations WARN sont loguées via le `Logger` NestJS.

- [ ] **Step 1: Écrire le test d'intégration (échoue d'abord)**

Créer `src/tenancy/prisma-service-integration.spec.ts` :

```typescript
import { PrismaService } from '../database/prisma.service';

describe('PrismaService enregistre le middleware tenant', () => {
  it('appelle $use au démarrage', async () => {
    const svc = new PrismaService();
    const useSpy = jest.spyOn(svc as any, '$use').mockImplementation(() => {});
    jest.spyOn(svc as any, '$connect').mockResolvedValue(undefined);
    jest.spyOn(svc as any, 'ensureRuntimeIndexes').mockResolvedValue(undefined);
    await svc.onModuleInit();
    expect(useSpy).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `npx jest src/tenancy/prisma-service-integration.spec.ts`
Expected: FAIL — `$use` non appelé (0 fois).

- [ ] **Step 3: Modifier `PrismaService`**

Dans `src/database/prisma.service.ts`, remplacer `onModuleInit` et ajouter l'enregistrement du middleware :

```typescript
import { createTenantMiddleware } from '../tenancy/prisma-tenant.middleware';

// ... dans la classe :
  async onModuleInit() {
    this.$use(
      createTenantMiddleware({
        mode: process.env.TENANT_ISOLATION_MODE === 'enforce' ? 'enforce' : 'warn',
        onViolation: (msg) => this.logger.warn(msg),
      }),
    );
    await this.$connect();
    await this.ensureRuntimeIndexes();
  }
```

- [ ] **Step 4: Lancer, vérifier que ça passe + suite complète**

Run:
```bash
npx jest src/tenancy/prisma-service-integration.spec.ts
npx tsc --noEmit
npx jest
```
Expected: le test passe ; tsc 0 erreur ; **la suite existante reste verte** (mode WARN = aucune requête bloquée).

- [ ] **Step 5: Commit**

```bash
git add src/database/prisma.service.ts src/tenancy/prisma-service-integration.spec.ts
git commit -m "feat(tenancy): register isolation middleware in PrismaService (warn default)"
```

---

### Task 6: Résolution du tenant en requête (JWT → contexte) + interceptor global

**Files:**
- Modify: `src/auth/jwt.strategy.ts` (ajouter `tenantId` à l'objet user, défaut tenant zéro)
- Create: `src/tenancy/tenant.interceptor.ts`
- Create: `src/tenancy/tenancy.module.ts`
- Modify: `src/app.module.ts` (fournir l'interceptor en `APP_INTERCEPTOR`, importer `TenancyModule`)
- Test: `src/tenancy/tenant.interceptor.spec.ts`

**Interfaces:**
- Consumes: `runWithTenant` (Task 3), `ZERO_TENANT_ID` (Task 1).
- Le JWT `validate` renvoie désormais `{ id, phone, name, role, tenantId }`. Un token sans claim `tenantId` → `tenantId = ZERO_TENANT_ID` (compat transition).
- `TenantInterceptor` lit `req.user.tenantId` et exécute la suite de la requête dans `runWithTenant`. Requête non authentifiée → contexte `{ tenantId: ZERO_TENANT_ID, platformScope: false }` (phase de transition : tout retombe sur le tenant zéro).

- [ ] **Step 1: Écrire le test de l'interceptor (échoue d'abord)**

Créer `src/tenancy/tenant.interceptor.spec.ts` :

```typescript
import { of } from 'rxjs';
import { TenantInterceptor } from './tenant.interceptor';
import { getCurrentTenantId } from './tenant-context';
import { ZERO_TENANT_ID } from './tenant.constants';

function ctxWithUser(user: any) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as any;
}

describe('TenantInterceptor', () => {
  it('exécute le handler dans le contexte du tenant du user', (done) => {
    const it_ = new TenantInterceptor();
    let seen: string | null = null;
    const handler = { handle: () => { seen = getCurrentTenantId(); return of('ok'); } };
    it_.intercept(ctxWithUser({ id: 'u1', tenantId: 'taxiplus' }), handler as any)
       .subscribe(() => { expect(seen).toBe('taxiplus'); done(); });
  });

  it('sans user → tenant zéro', (done) => {
    const it_ = new TenantInterceptor();
    let seen: string | null = null;
    const handler = { handle: () => { seen = getCurrentTenantId(); return of('ok'); } };
    it_.intercept(ctxWithUser(undefined), handler as any)
       .subscribe(() => { expect(seen).toBe(ZERO_TENANT_ID); done(); });
  });
});
```

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `npx jest src/tenancy/tenant.interceptor.spec.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Implémenter l'interceptor**

Créer `src/tenancy/tenant.interceptor.ts` :

```typescript
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { runWithTenant } from './tenant-context';
import { ZERO_TENANT_ID } from './tenant.constants';

@Injectable()
export class TenantInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    const tenantId: string = req?.user?.tenantId ?? ZERO_TENANT_ID;
    return runWithTenant({ tenantId, platformScope: false }, () => next.handle());
  }
}
```

- [ ] **Step 4: Ajouter `tenantId` au retour de `JwtStrategy.validate`**

Dans `src/auth/jwt.strategy.ts` :
- Étendre la signature du payload : `async validate(payload: { sub: string; role: string; sv?: number; tenantId?: string })`.
- Importer `ZERO_TENANT_ID` : `import { ZERO_TENANT_ID } from '../tenancy/tenant.constants';`
- Remplacer le `return` final par :

```typescript
    return {
      id: user.id, phone: user.phone, name: user.name, role: user.role,
      tenantId: payload.tenantId ?? ZERO_TENANT_ID,
    };
```

- [ ] **Step 5: Créer `TenancyModule` et brancher l'interceptor globalement**

Créer `src/tenancy/tenancy.module.ts` :

```typescript
import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TenantInterceptor } from './tenant.interceptor';

@Module({
  providers: [{ provide: APP_INTERCEPTOR, useClass: TenantInterceptor }],
})
export class TenancyModule {}
```

Dans `src/app.module.ts`, ajouter `TenancyModule` à la liste des `imports` (à côté des autres modules importés).

- [ ] **Step 6: Lancer les tests + tsc + suite**

Run:
```bash
npx jest src/tenancy/tenant.interceptor.spec.ts
npx tsc --noEmit
npx jest
```
Expected: tests verts ; tsc 0 ; suite existante verte.

- [ ] **Step 7: Commit**

```bash
git add src/auth/jwt.strategy.ts src/tenancy/tenant.interceptor.ts src/tenancy/tenancy.module.ts src/app.module.ts src/tenancy/tenant.interceptor.spec.ts
git commit -m "feat(tenancy): resolve tenant from JWT into request context (default tenant zero)"
```

---

### Task 7: Cascade de settings tenant-aware

**Files:**
- Modify: `src/settings/settings.service.ts`
- Test: `src/settings/settings.service.tenant.spec.ts`

**Interfaces:**
- Consumes: `getCurrentTenantId` (Task 3), `ZERO_TENANT_ID` (Task 1).
- Produces: `getScoped(key: string, countryCode?: string | null, defaultValue?: string): Promise<string>` — résout dans l'ordre :
  1. `tenant:{T}:{key}:{COUNTRY}`
  2. `tenant:{T}:{key}`
  3. `{key}:{COUNTRY}` (niveau plateforme existant)
  4. `{key}` (défaut plateforme)
  5. `defaultValue`

  où `T = getCurrentTenantId()`. Si `T === ZERO_TENANT_ID` ou `null`, on saute directement aux niveaux plateforme (3-4-5) — le tenant zéro EST la plateforme, garantissant une compatibilité totale avec les clés existantes.

- [ ] **Step 1: Écrire le test (échoue d'abord)**

Créer `src/settings/settings.service.tenant.spec.ts` :

```typescript
import { SettingsService } from './settings.service';
import { runWithTenant } from '../tenancy/tenant-context';

function makeService(store: Record<string, string>) {
  const prisma = {
    appSetting: {
      findUnique: async ({ where }: any) => (store[where.key] !== undefined ? { key: where.key, value: store[where.key] } : null),
    },
  };
  const redis = { get: async () => null, del: async () => {} };
  return new SettingsService(prisma as any, redis as any);
}

describe('getScoped (cascade tenant → pays → plateforme)', () => {
  it('tenant zéro : retombe sur les clés plateforme existantes', async () => {
    const svc = makeService({ 'startup_fee': '500', 'startup_fee:GA': '2000' });
    const v = await runWithTenant({ tenantId: 'aerogo', platformScope: false }, () =>
      svc.getScoped('startup_fee', 'GA', '0'));
    expect(v).toBe('2000');
  });

  it('tenant custom : la clé tenant+pays gagne', async () => {
    const svc = makeService({
      'startup_fee': '500',
      'tenant:taxiplus:startup_fee': '1500',
      'tenant:taxiplus:startup_fee:GA': '3000',
    });
    const v = await runWithTenant({ tenantId: 'taxiplus', platformScope: false }, () =>
      svc.getScoped('startup_fee', 'GA', '0'));
    expect(v).toBe('3000');
  });

  it('tenant custom sans override pays : retombe sur tenant global', async () => {
    const svc = makeService({ 'startup_fee': '500', 'tenant:taxiplus:startup_fee': '1500' });
    const v = await runWithTenant({ tenantId: 'taxiplus', platformScope: false }, () =>
      svc.getScoped('startup_fee', 'CM', '0'));
    expect(v).toBe('1500');
  });

  it('tenant custom sans aucune clé : retombe sur plateforme', async () => {
    const svc = makeService({ 'startup_fee': '500' });
    const v = await runWithTenant({ tenantId: 'taxiplus', platformScope: false }, () =>
      svc.getScoped('startup_fee', 'CM', '0'));
    expect(v).toBe('500');
  });
});
```

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `npx jest src/settings/settings.service.tenant.spec.ts`
Expected: FAIL — `getScoped` non défini.

- [ ] **Step 3: Ajouter `getScoped`**

Dans `src/settings/settings.service.ts`, importer en tête :

```typescript
import { getCurrentTenantId } from '../tenancy/tenant-context';
import { ZERO_TENANT_ID } from '../tenancy/tenant.constants';
```

Puis ajouter la méthode dans la classe :

```typescript
  /**
   * Cascade complète : tenant+pays → tenant → pays (plateforme) → plateforme → défaut.
   * Le tenant zéro (aerogo) EST la plateforme : on saute les niveaux tenant.
   */
  async getScoped(key: string, countryCode?: string | null, defaultValue = ''): Promise<string> {
    const tenantId = getCurrentTenantId();
    const country = countryCode ? countryCode.toUpperCase() : null;
    const SENTINEL = ' ';

    if (tenantId && tenantId !== ZERO_TENANT_ID) {
      if (country) {
        const tc = await this.get(`tenant:${tenantId}:${key}:${country}`, SENTINEL);
        if (tc !== SENTINEL) return tc;
      }
      const t = await this.get(`tenant:${tenantId}:${key}`, SENTINEL);
      if (t !== SENTINEL) return t;
    }

    // Niveaux plateforme (réutilise la cascade pays existante)
    return this.getForCountry(key, country, defaultValue);
  }
```

- [ ] **Step 4: Lancer, vérifier que ça passe**

Run: `npx jest src/settings/settings.service.tenant.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: tsc + suite settings existante**

Run: `npx tsc --noEmit && npx jest src/settings`
Expected: 0 erreur, verts (aucune régression sur `getForCountry`).

- [ ] **Step 6: Commit**

```bash
git add src/settings/settings.service.ts src/settings/settings.service.tenant.spec.ts
git commit -m "feat(tenancy): tenant-aware settings cascade getScoped()"
```

---

### Task 8: Seed du tenant zéro + backfill (Phases A→B)

**Files:**
- Create: `prisma/seed-tenant-zero.ts`
- Test: `src/tenancy/backfill.spec.ts`

**Interfaces:**
- Consumes: `ZERO_TENANT_ID`, `TENANT_SCOPED_MODELS`.
- Produces: fonctions exportées `seedTenantZero(prisma)` et `backfillTenantZero(prisma)` :
  - `seedTenantZero` : upsert du `Tenant` `aerogo` (`licenseMode: 'DISABLED'`, `status: 'ACTIVE'`, `licenseKey: 'aerogo-zero'`).
  - `backfillTenantZero` : `updateMany({ where: { tenantId: null }, data: { tenantId: 'aerogo' } })` sur chaque modèle scopé + `AppSetting`, et renvoie `{ [model]: count }`.

- [ ] **Step 1: Écrire le test (échoue d'abord)**

Créer `src/tenancy/backfill.spec.ts` :

```typescript
import { seedTenantZero, backfillTenantZero } from '../../prisma/seed-tenant-zero';
import { ZERO_TENANT_ID } from './tenant.constants';

describe('seed + backfill tenant zéro', () => {
  it('seedTenantZero upsert le tenant aerogo', async () => {
    const upsert = jest.fn().mockResolvedValue({});
    const prisma: any = { tenant: { upsert } };
    await seedTenantZero(prisma);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: ZERO_TENANT_ID },
      create: expect.objectContaining({ id: ZERO_TENANT_ID, slug: 'aerogo' }),
    }));
  });

  it('backfill applique updateMany sur Booking avec tenantId null', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 3 });
    const prisma: any = new Proxy({}, {
      get: () => ({ updateMany }),
    });
    const res = await backfillTenantZero(prisma);
    expect(updateMany).toHaveBeenCalledWith({
      where: { tenantId: null }, data: { tenantId: ZERO_TENANT_ID },
    });
    expect(res.Booking).toBe(3);
  });
});
```

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `npx jest src/tenancy/backfill.spec.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Implémenter le seed + backfill**

Créer `prisma/seed-tenant-zero.ts` :

```typescript
import { PrismaClient } from '@prisma/client';
import { ZERO_TENANT_ID, TENANT_SCOPED_MODELS } from '../src/tenancy/tenant.constants';

/** Mappe un nom de modèle PascalCase vers l'accesseur Prisma camelCase. */
function accessor(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

export async function seedTenantZero(prisma: any): Promise<void> {
  await prisma.tenant.upsert({
    where: { id: ZERO_TENANT_ID },
    update: {},
    create: {
      id: ZERO_TENANT_ID,
      slug: 'aerogo',
      name: 'AeroGo',
      status: 'ACTIVE',
      licenseKey: 'aerogo-zero',
      licenseMode: 'DISABLED',
      operatingModel: {},
    },
  });
}

export async function backfillTenantZero(prisma: any): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  const models = [...TENANT_SCOPED_MODELS, 'AppSetting'];
  for (const model of models) {
    const delegate = prisma[accessor(model)];
    const { count } = await delegate.updateMany({
      where: { tenantId: null },
      data: { tenantId: ZERO_TENANT_ID },
    });
    result[model] = count;
  }
  return result;
}

// Exécution CLI : `npx ts-node prisma/seed-tenant-zero.ts`
if (require.main === module) {
  const prisma = new PrismaClient();
  (async () => {
    await seedTenantZero(prisma);
    const counts = await backfillTenantZero(prisma);
    // eslint-disable-next-line no-console
    console.log('Backfill terminé:', counts);
    await prisma.$disconnect();
  })();
}
```

> Note : le middleware d'isolation ignore `AppSetting` (pas dans `TENANT_SCOPED_MODELS`) donc le backfill de sa colonne passe sans filtre. Pour les modèles scopés, le script s'exécute **hors contexte de requête** → le middleware est en WARN (Phase C non encore activée) et laisse passer ; en Phase D il faudra envelopper l'appel dans un `platformScope`.

- [ ] **Step 4: Lancer, vérifier que ça passe**

Run: `npx jest src/tenancy/backfill.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Exécuter réellement sur une base de dev chargée d'un dump prod**

Run:
```bash
# base de dev restaurée depuis le dump prod vérifié
gunzip -c /home/aragami/vps_deployement_2/aerogo24_prod_20260703.sql.gz | psql "$DATABASE_URL"
npx prisma db push --skip-generate
npx ts-node prisma/seed-tenant-zero.ts
# vérifier 0 ligne orpheline sur un modèle clé
psql "$DATABASE_URL" -c "SELECT count(*) FROM bookings WHERE tenant_id IS NULL;"
```
Expected: le seed crée `aerogo` ; le backfill logue les counts ; la vérif renvoie `0`.

- [ ] **Step 6: Commit**

```bash
git add prisma/seed-tenant-zero.ts src/tenancy/backfill.spec.ts
git commit -m "feat(tenancy): seed tenant zero + backfill script (phases A-B)"
```

---

### Task 9: Test d'isolation bout-en-bout + procédure de bascule WARN→ENFORCE

**Files:**
- Create: `src/tenancy/isolation-e2e.spec.ts`
- Create: `docs/superpowers/runbooks/tenant-isolation-cutover.md`

**Interfaces:**
- Consumes: tout l'assemblage (middleware + contexte via `runWithTenant`).
- Prouve qu'un tenant ne peut jamais lire les données d'un autre, en simulant deux contextes sur un `next` factice partagé.

- [ ] **Step 1: Écrire le test d'isolation (échoue si le câblage régresse)**

Créer `src/tenancy/isolation-e2e.spec.ts` :

```typescript
import { createTenantMiddleware } from './prisma-tenant.middleware';
import { runWithTenant } from './tenant-context';

/** Simule une table `bookings` mémoire filtrée par le where injecté. */
function makeDb(rows: Array<{ id: string; tenantId: string }>) {
  return async (params: any) => {
    if (params.action === 'findMany') {
      const t = params.args?.where?.tenantId;
      return rows.filter((r) => r.tenantId === t);
    }
    return rows;
  };
}

describe('isolation bout-en-bout', () => {
  const mw = createTenantMiddleware({ mode: 'enforce', onViolation: () => {} });
  const rows = [
    { id: 'b1', tenantId: 'taxiplus' },
    { id: 'b2', tenantId: 'gaboncab' },
  ];

  it('taxiplus ne voit que ses bookings', async () => {
    const res = await runWithTenant({ tenantId: 'taxiplus', platformScope: false }, () =>
      mw({ model: 'Booking', action: 'findMany', args: {} } as any, makeDb(rows)));
    expect(res.map((r: any) => r.id)).toEqual(['b1']);
  });

  it('gaboncab ne voit que ses bookings', async () => {
    const res = await runWithTenant({ tenantId: 'gaboncab', platformScope: false }, () =>
      mw({ model: 'Booking', action: 'findMany', args: {} } as any, makeDb(rows)));
    expect(res.map((r: any) => r.id)).toEqual(['b2']);
  });

  it('aucun contexte + enforce → bloqué', async () => {
    await expect(
      mw({ model: 'Booking', action: 'findMany', args: {} } as any, makeDb(rows)),
    ).rejects.toThrow(/tenant/i);
  });
});
```

- [ ] **Step 2: Lancer, vérifier que ça passe**

Run: `npx jest src/tenancy/isolation-e2e.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 3: Écrire le runbook de bascule**

Créer `docs/superpowers/runbooks/tenant-isolation-cutover.md` :

```markdown
# Runbook — Bascule isolation multi-tenant (WARN → ENFORCE)

Prérequis : Tasks 1-9 déployées, `TENANT_ISOLATION_MODE=warn` en prod.

## Phase C (observation)
1. Déployer avec `TENANT_ISOLATION_MODE=warn`.
2. Exécuter le seed + backfill : `npx ts-node prisma/seed-tenant-zero.ts`.
3. Rendre `tenant_id` NOT NULL (une fois `SELECT count(*) ... WHERE tenant_id IS NULL = 0`
   sur tous les modèles scopés) : passer chaque `tenantId String?` → `String` dans le schéma,
   puis `npx prisma db push`.
4. Laisser tourner 3-7 jours. Surveiller les logs `[tenant-isolation] ... sans tenant résolu`.
5. Objectif : **zéro** ligne de warning. Chaque warning = un chemin de code (job cron,
   webhook, tâche système) qui s'exécute hors requête HTTP → l'envelopper dans
   `runWithTenant({ tenantId, platformScope: true }, ...)` ou résoudre le tenant explicitement.

## Phase D (enforcement)
6. Quand les warnings sont à zéro : passer `TENANT_ISOLATION_MODE=enforce`, redéployer.
7. Vérifier le health + un parcours passager complet sur le tenant zéro.
8. Rollback : repasser `TENANT_ISOLATION_MODE=warn` et redéployer (aucune migration à annuler).
```

- [ ] **Step 4: tsc + suite complète finale**

Run: `npx tsc --noEmit && npx jest`
Expected: 0 erreur, toute la suite verte (existante + tenancy).

- [ ] **Step 5: Commit**

```bash
git add src/tenancy/isolation-e2e.spec.ts docs/superpowers/runbooks/tenant-isolation-cutover.md
git commit -m "test(tenancy): end-to-end isolation proof + WARN->ENFORCE cutover runbook"
```

---

## Hors périmètre de ce plan (plans ultérieurs)
- **Ajout du claim `tenantId` à la signature des JWT** (11 sites dans `auth.service.ts`) : requis seulement quand des tenants réels existent. Tant qu'on est mono-tenant, le défaut `ZERO_TENANT_ID` suffit. → plan « SP1-phase-tenants-réels ».
- **Control Plane / phone-home client** (heartbeat + validation licence au boot) : sous-projet 6.
- **Branding white-label, catalogue de flags/presets, build factory, module Partenaires** : sous-projets 2 à 5.
- **`platformScope` pour les jobs système** (cron, webhooks, scheduler) : identifiés en Phase C via les warnings, corrigés au cas par cas.

## Self-Review (effectuée)
- **Couverture spec** : Section 1 (modèle + classification) → Tasks 1-2 ; Section 2 (résolution + fail-closed) → Tasks 3,4,6 ; Section 3 (cascade) → Task 7 ; Section 5 (migration 4 phases) → Tasks 8-9 + runbook. Section 4 (control plane) volontairement hors périmètre (SP6), crochets licence posés dans le modèle `Tenant` (Task 1).
- **Placeholders** : aucun — code complet à chaque étape.
- **Cohérence des types** : `TenantContext`, `getCurrentTenantId`, `createTenantMiddleware`, `getScoped`, `ZERO_TENANT_ID`, `TENANT_SCOPED_MODELS` utilisés de façon cohérente entre tâches.
