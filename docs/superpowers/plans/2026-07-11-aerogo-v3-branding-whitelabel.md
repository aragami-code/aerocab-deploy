# AeroGo V3 — Branding white-label (runtime) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chaque tenant personnalise l'apparence runtime de ses apps (2 couleurs, logo, nom) via `/config` + une page admin, sans rebuild.

**Architecture:** Le backend ajoute un bloc `branding` résolu au `/config` existant (scopé par tenant, SP1). Le mobile dérive une palette complète (nuances + contraste) d'une fonction pure et l'applique au thème avant le 1er paint. L'admin édite le branding avec un aperçu live utilisant le même algorithme de dérivation.

**Tech Stack:** NestJS + Prisma (backend), Expo/React Native + zustand (mobile), React/Vite (admin), Jest.

## Global Constraints

- Base : `/home/aragami/aerogo24V3`. Backend `aerocab-deploy/backend`, admin `aerocab-admin`, apps `aerocab-native/aerocab-passenger` + `aerocab-native/aerocab-driver`.
- Déploiement Prisma = `prisma db push` ; colonnes ajoutées **nullables**.
- 2 couleurs cœur : `primaryColor` + `accentColor` (hex `#RRGGBB`). Dérivés = `primaryLight/Dark`, `accentLight`, `onPrimary`, `onAccent`.
- `deriveBrand` : `primaryLight = mix(primary,'#FFFFFF',0.25)`, `primaryDark = mix(primary,'#000000',0.25)`, `accentLight = mix(accent,'#FFFFFF',0.25)`. `readableText` : luminance `(0.299r+0.587g+0.114b)/255 > 0.6 ? '#1E1E1E' : '#FFFFFF'`.
- La table de cas de test `deriveBrand` DOIT être identique mobile ↔ admin (parité).
- Défaut plateforme (fallback) : `primaryColor='#C0102E'`, `accentColor='#1E1E1E'`, `appNamePassenger='AeroGo'`, `appNameDriver='AeroGo Driver'`.
- Permission RBAC nouvelle : `manage_branding`.
- `tsc` à 0 erreur, suites Jest vertes (aucune régression).

---

### Task 1: Schéma — `accentColor` + `paletteId` sur Tenant

**Files:**
- Modify: `aerocab-deploy/backend/prisma/schema.prisma` (modèle `Tenant`)
- Test: `aerocab-deploy/backend/src/branding/schema-branding.spec.ts`

**Interfaces:**
- Produces: colonnes `accent_color` et `palette_id` (nullables) sur la table `tenants`.

- [ ] **Step 1: Écrire le test (échoue d'abord)**

Créer `aerocab-deploy/backend/src/branding/schema-branding.spec.ts` :
```typescript
import { readFileSync } from 'fs';
import { join } from 'path';
const schema = readFileSync(join(__dirname, '../../prisma/schema.prisma'), 'utf8');
const tenant = schema.match(/model Tenant \{([\s\S]*?)\n\}/)![1];
describe('Tenant branding fields', () => {
  it('a accentColor nullable', () => {
    expect(tenant).toMatch(/accentColor\s+String\?\s+@map\("accent_color"\)/);
  });
  it('a paletteId nullable', () => {
    expect(tenant).toMatch(/paletteId\s+String\?\s+@map\("palette_id"\)/);
  });
});
```

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `cd aerocab-deploy/backend && npx jest src/branding/schema-branding.spec.ts`
Expected: FAIL (champs absents).

- [ ] **Step 3: Ajouter les champs**

Dans `prisma/schema.prisma`, modèle `Tenant`, après la ligne `primaryColor String? @map("primary_color")` ajouter :
```prisma
  accentColor       String?       @map("accent_color")
  paletteId         String?       @map("palette_id")
```

- [ ] **Step 4: Lancer + générer + push**

Run:
```bash
cd aerocab-deploy/backend
npx jest src/branding/schema-branding.spec.ts
npx prisma validate && npx prisma generate && npx prisma db push --skip-generate
```
Expected: test PASS ; schéma valide ; db push en sync.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma src/branding/schema-branding.spec.ts
git commit -m "feat(branding): add accentColor + paletteId to Tenant"
```

---

### Task 2: Catalogue de palettes + `GET /branding/palettes`

**Files:**
- Create: `aerocab-deploy/backend/src/branding/palette-catalog.ts`
- Create: `aerocab-deploy/backend/src/branding/branding.controller.ts`
- Create: `aerocab-deploy/backend/src/branding/branding.module.ts`
- Modify: `aerocab-deploy/backend/src/app.module.ts` (importer `BrandingModule`)
- Test: `aerocab-deploy/backend/src/branding/palette-catalog.spec.ts`

**Interfaces:**
- Produces: `interface Palette { id: string; name: string; primary: string; accent: string }` ; `PALETTE_CATALOG: Palette[]` (20 entrées) ; `GET /branding/palettes` → `Palette[]`.

- [ ] **Step 1: Écrire le test (échoue d'abord)**

Créer `src/branding/palette-catalog.spec.ts` :
```typescript
import { PALETTE_CATALOG } from './palette-catalog';
describe('PALETTE_CATALOG', () => {
  it('contient 20 palettes', () => {
    expect(PALETTE_CATALOG.length).toBe(20);
  });
  it('chaque palette a id/name/primary/accent en hex valide', () => {
    const hex = /^#[0-9A-Fa-f]{6}$/;
    for (const p of PALETTE_CATALOG) {
      expect(p.id).toBeTruthy();
      expect(p.name).toBeTruthy();
      expect(p.primary).toMatch(hex);
      expect(p.accent).toMatch(hex);
    }
  });
  it('les ids sont uniques', () => {
    expect(new Set(PALETTE_CATALOG.map(p => p.id)).size).toBe(20);
  });
});
```

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `npx jest src/branding/palette-catalog.spec.ts`
Expected: FAIL (module introuvable).

- [ ] **Step 3: Créer le catalogue (20 palettes)**

Créer `src/branding/palette-catalog.ts` :
```typescript
export interface Palette { id: string; name: string; primary: string; accent: string; }

export const PALETTE_CATALOG: Palette[] = [
  { id: 'aerogo',    name: 'AeroGo',        primary: '#C0102E', accent: '#1E1E1E' },
  { id: 'midnight',  name: 'Minuit',        primary: '#1E3A8A', accent: '#38BDF8' },
  { id: 'sunset',    name: 'Coucher',       primary: '#C2410C', accent: '#FDBA74' },
  { id: 'forest',    name: 'Forêt',         primary: '#166534', accent: '#86EFAC' },
  { id: 'royal',     name: 'Royal',         primary: '#6D28D9', accent: '#C4B5FD' },
  { id: 'ocean',     name: 'Océan',         primary: '#0E7490', accent: '#67E8F9' },
  { id: 'rose',      name: 'Rose',          primary: '#BE185D', accent: '#F9A8D4' },
  { id: 'amber',     name: 'Ambre',         primary: '#B45309', accent: '#FCD34D' },
  { id: 'slate',     name: 'Ardoise',       primary: '#334155', accent: '#94A3B8' },
  { id: 'emerald',   name: 'Émeraude',      primary: '#047857', accent: '#6EE7B7' },
  { id: 'indigo',    name: 'Indigo',        primary: '#4338CA', accent: '#A5B4FC' },
  { id: 'crimson',   name: 'Cramoisi',      primary: '#9F1239', accent: '#FDA4AF' },
  { id: 'teal',      name: 'Sarcelle',      primary: '#0F766E', accent: '#5EEAD4' },
  { id: 'violet',    name: 'Violet',        primary: '#7C3AED', accent: '#DDD6FE' },
  { id: 'sky',       name: 'Ciel',          primary: '#0369A1', accent: '#7DD3FC' },
  { id: 'lime',      name: 'Citron vert',   primary: '#4D7C0F', accent: '#BEF264' },
  { id: 'fuchsia',   name: 'Fuchsia',       primary: '#A21CAF', accent: '#F0ABFC' },
  { id: 'graphite',  name: 'Graphite',      primary: '#18181B', accent: '#D4D4D8' },
  { id: 'coral',     name: 'Corail',        primary: '#E11D48', accent: '#FECDD3' },
  { id: 'gold',      name: 'Or',            primary: '#92400E', accent: '#FBBF24' },
];
```

- [ ] **Step 4: Créer le controller + module**

Créer `src/branding/branding.controller.ts` :
```typescript
import { Controller, Get } from '@nestjs/common';
import { PALETTE_CATALOG, Palette } from './palette-catalog';

@Controller('branding')
export class BrandingController {
  @Get('palettes')
  getPalettes(): Palette[] {
    return PALETTE_CATALOG;
  }
}
```

Créer `src/branding/branding.module.ts` :
```typescript
import { Module } from '@nestjs/common';
import { BrandingController } from './branding.controller';

@Module({ controllers: [BrandingController] })
export class BrandingModule {}
```

Dans `src/app.module.ts` : importer `BrandingModule` (ligne d'import) et l'ajouter à la liste `imports`.

- [ ] **Step 5: Lancer + build**

Run: `npx jest src/branding/palette-catalog.spec.ts && npx nest build 2>&1 | grep -i "error TS" ; echo done`
Expected: 3 tests PASS ; build sans erreur.

- [ ] **Step 6: Commit**

```bash
git add src/branding/ src/app.module.ts
git commit -m "feat(branding): palette catalog + GET /branding/palettes"
```

---

### Task 3: Résolution branding + bloc `branding` dans `/config`

**Files:**
- Create: `aerocab-deploy/backend/src/branding/branding.service.ts`
- Modify: `aerocab-deploy/backend/src/app.controller.ts` (méthode `getConfig`, ~ligne 81) + son module fournit `BrandingService`
- Modify: `aerocab-deploy/backend/src/branding/branding.module.ts` (exporter `BrandingService`)
- Test: `aerocab-deploy/backend/src/branding/branding.service.spec.ts`

**Interfaces:**
- Consumes: `PrismaService`, contexte tenant SP1 (`getCurrentTenantId`).
- Produces: `BrandingService.resolve(): Promise<BrandingBlock>` où
  `interface BrandingBlock { primaryColor: string; accentColor: string; logoUrl: string | null; appNamePassenger: string; appNameDriver: string }`.
  Le `/config` renvoie ce bloc sous la clé `branding`.

- [ ] **Step 1: Écrire le test (échoue d'abord)**

Créer `src/branding/branding.service.spec.ts` :
```typescript
import { BrandingService } from './branding.service';

function svc(tenant: any) {
  const prisma = { tenant: { findUnique: async () => tenant } };
  return new BrandingService(prisma as any);
}

describe('BrandingService.resolve', () => {
  it('tenant avec branding → ses valeurs', async () => {
    const b = await svc({
      primaryColor: '#111111', accentColor: '#222222', logoUrl: 'u',
      appNamePassenger: 'TaxiPlus', appNameDriver: 'TaxiPlus Pro',
    }).resolve('taxiplus');
    expect(b).toEqual({
      primaryColor: '#111111', accentColor: '#222222', logoUrl: 'u',
      appNamePassenger: 'TaxiPlus', appNameDriver: 'TaxiPlus Pro',
    });
  });

  it('champs null → défauts plateforme', async () => {
    const b = await svc({
      primaryColor: null, accentColor: null, logoUrl: null,
      appNamePassenger: null, appNameDriver: null,
    }).resolve('aerogo');
    expect(b).toEqual({
      primaryColor: '#C0102E', accentColor: '#1E1E1E', logoUrl: null,
      appNamePassenger: 'AeroGo', appNameDriver: 'AeroGo Driver',
    });
  });

  it('tenant introuvable → défauts', async () => {
    const b = await svc(null).resolve('inconnu');
    expect(b.primaryColor).toBe('#C0102E');
    expect(b.appNamePassenger).toBe('AeroGo');
  });
});
```

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `npx jest src/branding/branding.service.spec.ts`
Expected: FAIL (module introuvable).

- [ ] **Step 3: Implémenter le service**

Créer `src/branding/branding.service.ts` :
```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { getCurrentTenantId } from '../tenancy/tenant-context';
import { ZERO_TENANT_ID } from '../tenancy/tenant.constants';

export interface BrandingBlock {
  primaryColor: string;
  accentColor: string;
  logoUrl: string | null;
  appNamePassenger: string;
  appNameDriver: string;
}

const DEFAULTS: BrandingBlock = {
  primaryColor: '#C0102E',
  accentColor: '#1E1E1E',
  logoUrl: null,
  appNamePassenger: 'AeroGo',
  appNameDriver: 'AeroGo Driver',
};

@Injectable()
export class BrandingService {
  constructor(private prisma: PrismaService) {}

  async resolve(tenantId?: string): Promise<BrandingBlock> {
    const id = tenantId ?? getCurrentTenantId() ?? ZERO_TENANT_ID;
    const t = await this.prisma.tenant.findUnique({ where: { id } });
    if (!t) return { ...DEFAULTS };
    return {
      primaryColor: t.primaryColor ?? DEFAULTS.primaryColor,
      accentColor: t.accentColor ?? DEFAULTS.accentColor,
      logoUrl: t.logoUrl ?? null,
      appNamePassenger: t.appNamePassenger ?? DEFAULTS.appNamePassenger,
      appNameDriver: t.appNameDriver ?? DEFAULTS.appNameDriver,
    };
  }
}
```

Dans `src/branding/branding.module.ts` : ajouter `BrandingService` aux `providers` et aux `exports` :
```typescript
import { Module } from '@nestjs/common';
import { BrandingController } from './branding.controller';
import { BrandingService } from './branding.service';

@Module({
  controllers: [BrandingController],
  providers: [BrandingService],
  exports: [BrandingService],
})
export class BrandingModule {}
```

- [ ] **Step 4: Brancher dans `/config`**

Dans `src/app.controller.ts` : injecter `BrandingService` dans le constructeur du controller, et dans `getConfig` ajouter la clé `branding` à l'objet retourné :
```typescript
// dans le constructeur du AppController :
constructor(/* ...existant..., */ private readonly branding: BrandingService) {}

// dans getConfig(), avant le return, résoudre :
const branding = await this.branding.resolve();
// puis inclure `branding` dans l'objet de réponse : { ...existant, branding }
```
S'assurer que le module de `AppController` importe `BrandingModule` (déjà importé dans `app.module.ts` en Task 2 ; si `AppController` est déclaré dans `app.module.ts`, l'injection fonctionne).

- [ ] **Step 5: Lancer + build**

Run: `npx jest src/branding/branding.service.spec.ts && npx nest build 2>&1 | grep -i "error TS"; echo done`
Expected: 3 tests PASS ; build sans erreur.

- [ ] **Step 6: Commit**

```bash
git add src/branding/ src/app.controller.ts
git commit -m "feat(branding): resolve branding block into /config"
```

---

### Task 4: `PATCH /admin/branding` + permission `manage_branding`

**Files:**
- Modify: `aerocab-deploy/backend/src/branding/branding.controller.ts` (ajout endpoint PATCH)
- Modify: `aerocab-deploy/backend/src/branding/branding.service.ts` (méthode `update`)
- Create: `aerocab-deploy/backend/src/branding/dto/update-branding.dto.ts`
- Test: `aerocab-deploy/backend/src/branding/branding.update.spec.ts`

**Interfaces:**
- Consumes: le guard RBAC existant + décorateur de permission (suivre le pattern des autres routes admin, ex. `@RequirePermission('...')` ou `@Roles('admin')` selon l'existant).
- Produces: `BrandingService.update(tenantId, dto): Promise<BrandingBlock>` ; `PATCH /admin/branding` (body = champs partiels), gardé par la permission `manage_branding`.

- [ ] **Step 1: Écrire le test service (échoue d'abord)**

Créer `src/branding/branding.update.spec.ts` :
```typescript
import { BrandingService } from './branding.service';

describe('BrandingService.update', () => {
  it('met à jour les champs fournis et renvoie le bloc résolu', async () => {
    const update = jest.fn().mockResolvedValue({
      primaryColor: '#333333', accentColor: '#444444', logoUrl: null,
      appNamePassenger: 'X', appNameDriver: 'X Pro', paletteId: 'ocean',
    });
    const prisma: any = { tenant: { update, findUnique: async () => null } };
    const svc = new BrandingService(prisma);
    const out = await svc.update('taxiplus', { primaryColor: '#333333', paletteId: 'ocean' } as any);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'taxiplus' },
      data: expect.objectContaining({ primaryColor: '#333333', paletteId: 'ocean' }),
    }));
    expect(out.primaryColor).toBe('#333333');
  });
});
```

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `npx jest src/branding/branding.update.spec.ts`
Expected: FAIL (`update` non défini).

- [ ] **Step 3: DTO + méthode update**

Créer `src/branding/dto/update-branding.dto.ts` :
```typescript
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const HEX = /^#[0-9A-Fa-f]{6}$/;

export class UpdateBrandingDto {
  @IsOptional() @IsString() @Matches(HEX, { message: 'primaryColor doit être #RRGGBB' })
  primaryColor?: string;

  @IsOptional() @IsString() @Matches(HEX, { message: 'accentColor doit être #RRGGBB' })
  accentColor?: string;

  @IsOptional() @IsString() paletteId?: string | null;

  @IsOptional() @IsString() logoUrl?: string | null;

  @IsOptional() @IsString() @MaxLength(40) appNamePassenger?: string;

  @IsOptional() @IsString() @MaxLength(40) appNameDriver?: string;
}
```

Dans `branding.service.ts`, ajouter :
```typescript
import { UpdateBrandingDto } from './dto/update-branding.dto';
// ...
  async update(tenantId: string, dto: UpdateBrandingDto): Promise<BrandingBlock> {
    await this.prisma.tenant.update({ where: { id: tenantId }, data: { ...dto } });
    return this.resolve(tenantId);
  }
```

- [ ] **Step 4: Endpoint PATCH gardé**

Dans `branding.controller.ts`, ajouter (adapter le décorateur de garde au pattern admin existant du repo) :
```typescript
import { Body, Patch, UseGuards, Request } from '@nestjs/common';
import { BrandingService } from './branding.service';
import { UpdateBrandingDto } from './dto/update-branding.dto';
// Réutiliser le même guard + décorateur de permission que les autres routes admin.
// Exemple (à aligner sur l'existant) : @UseGuards(JwtAuthGuard, PermissionsGuard) @RequirePermission('manage_branding')

  constructor(private readonly branding: BrandingService) {}

  @Patch('/admin/branding')
  // @UseGuards(...) @RequirePermission('manage_branding')  ← selon le pattern du repo
  async updateBranding(@Request() req: any, @Body() dto: UpdateBrandingDto) {
    const tenantId = req.user.tenantId;
    return this.branding.update(tenantId, dto);
  }
```
Ajouter la permission `manage_branding` à la liste des permissions RBAC (fichier de seed/constantes des permissions) et l'assigner aux rôles admin, en suivant le mécanisme existant.

- [ ] **Step 5: Lancer + build**

Run: `npx jest src/branding && npx nest build 2>&1 | grep -i "error TS"; echo done`
Expected: tests PASS ; build sans erreur.

- [ ] **Step 6: Commit**

```bash
git add src/branding/ prisma/  # + fichier permissions si modifié
git commit -m "feat(branding): PATCH /admin/branding guarded by manage_branding"
```

---

### Task 5: Mobile passager — `lib/brand.ts` (deriveBrand pur)

**Files:**
- Create: `aerocab-native/aerocab-passenger/lib/brand.ts`
- Test: `aerocab-native/aerocab-passenger/__tests__/brand.test.ts`

**Interfaces:**
- Produces (identique côté admin en Task 9) :
  - `mix(a: string, b: string, ratio: number): string`
  - `readableText(hex: string): string`
  - `deriveBrand(primary: string, accent: string): { primary; primaryLight; primaryDark; onPrimary; accent; accentLight; onAccent }`
  - `activeBrand` (objet mutable, init = défauts) + `applyBrand(primary: string, accent: string): void`

- [ ] **Step 1: Écrire le test (échoue d'abord)** — c'est la TABLE DE PARITÉ (répliquée en Task 9)

Créer `__tests__/brand.test.ts` :
```typescript
import { mix, readableText, deriveBrand } from '../lib/brand';

describe('brand derivation (table de parité)', () => {
  it('mix interpole vers blanc/noir', () => {
    expect(mix('#000000', '#FFFFFF', 0.5)).toBe('#808080');
    expect(mix('#C0102E', '#FFFFFF', 0)).toBe('#C0102E');
    expect(mix('#C0102E', '#000000', 1)).toBe('#000000');
  });

  it('readableText : clair → texte foncé, foncé → texte clair', () => {
    expect(readableText('#FFFFFF')).toBe('#1E1E1E');
    expect(readableText('#FDE047')).toBe('#1E1E1E'); // jaune clair
    expect(readableText('#000000')).toBe('#FFFFFF');
    expect(readableText('#1E3A8A')).toBe('#FFFFFF'); // bleu foncé
  });

  it('deriveBrand produit la palette complète', () => {
    const b = deriveBrand('#1E3A8A', '#38BDF8');
    expect(b.primary).toBe('#1E3A8A');
    expect(b.primaryLight).toBe(mix('#1E3A8A', '#FFFFFF', 0.25));
    expect(b.primaryDark).toBe(mix('#1E3A8A', '#000000', 0.25));
    expect(b.onPrimary).toBe('#FFFFFF');
    expect(b.accent).toBe('#38BDF8');
    expect(b.accentLight).toBe(mix('#38BDF8', '#FFFFFF', 0.25));
    expect(b.onAccent).toBe('#1E1E1E');
  });
});
```

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `cd aerocab-native/aerocab-passenger && npx jest __tests__/brand.test.ts`
Expected: FAIL (module introuvable).

- [ ] **Step 3: Implémenter `lib/brand.ts`**

```typescript
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function toHex(n: number): string {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
}

export function mix(a: string, b: string, ratio: number): string {
  const A = hexToRgb(a), B = hexToRgb(b);
  const r = A.r + (B.r - A.r) * ratio;
  const g = A.g + (B.g - A.g) * ratio;
  const bl = A.b + (B.b - A.b) * ratio;
  return `#${toHex(r)}${toHex(g)}${toHex(bl)}`.toUpperCase();
}

export function readableText(hex: string): string {
  const { r, g, b } = hexToRgb(hex);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? '#1E1E1E' : '#FFFFFF';
}

export interface DerivedBrand {
  primary: string; primaryLight: string; primaryDark: string; onPrimary: string;
  accent: string; accentLight: string; onAccent: string;
}

export function deriveBrand(primary: string, accent: string): DerivedBrand {
  return {
    primary,
    primaryLight: mix(primary, '#FFFFFF', 0.25),
    primaryDark: mix(primary, '#000000', 0.25),
    onPrimary: readableText(primary),
    accent,
    accentLight: mix(accent, '#FFFFFF', 0.25),
    onAccent: readableText(accent),
  };
}

// Marque active (mutable), init = défauts AeroGo. Peuplée au lancement (Task 6).
export const activeBrand: DerivedBrand = deriveBrand('#C0102E', '#1E1E1E');

export function applyBrand(primary: string, accent: string): void {
  Object.assign(activeBrand, deriveBrand(primary, accent));
}
```

- [ ] **Step 4: Lancer, vérifier PASS**

Run: `npx jest __tests__/brand.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/brand.ts __tests__/brand.test.ts
git commit -m "feat(branding): mobile deriveBrand + activeBrand + applyBrand"
```

---

### Task 6: Mobile passager — brancher branding (configStore + thème + gate)

**Files:**
- Modify: `aerocab-native/aerocab-passenger/stores/configStore.ts` (champ `branding` + parse dans `loadConfig` + appel `applyBrand`)
- Modify: `aerocab-native/aerocab-passenger/lib/theme.ts` (couleurs de marque en getters lisant `activeBrand`)
- Test: `aerocab-native/aerocab-passenger/__tests__/configStore.branding.test.ts`

**Interfaces:**
- Consumes: `applyBrand`, `activeBrand` (Task 5).
- Produces: `configStore.branding: BrandingBlock | null` ; `getBranding(): BrandingBlock | null`. Après `loadConfig`, `activeBrand` reflète les couleurs du tenant ; `theme.colors.primary` renvoie `activeBrand.primary`.

- [ ] **Step 1: Écrire le test (échoue d'abord)**

Créer `__tests__/configStore.branding.test.ts` :
```typescript
import { activeBrand, applyBrand } from '../lib/brand';

describe('applyBrand met à jour activeBrand (consommé par le thème)', () => {
  it('applyBrand change primary/onPrimary', () => {
    applyBrand('#1E3A8A', '#38BDF8');
    expect(activeBrand.primary).toBe('#1E3A8A');
    expect(activeBrand.onPrimary).toBe('#FFFFFF');
    // restaurer défaut pour les autres tests
    applyBrand('#C0102E', '#1E1E1E');
    expect(activeBrand.primary).toBe('#C0102E');
  });
});
```

- [ ] **Step 2: Lancer, vérifier l'échec/erreur**

Run: `npx jest __tests__/configStore.branding.test.ts`
Expected: PASS déjà possible (teste Task 5) — sert de garde de non-régression. Si import KO → corriger le chemin. Continuer.

- [ ] **Step 3: Étendre `configStore.ts`**

Ajouter en tête : `import { applyBrand } from '../lib/brand';`

Ajouter le type et le champ dans `ConfigState` :
```typescript
  branding: {
    primaryColor: string; accentColor: string; logoUrl: string | null;
    appNamePassenger: string; appNameDriver: string;
  } | null;
  getBranding: () => ConfigState['branding'];
```
Dans l'objet initial du store : `branding: null,` et
`getBranding: () => get().branding,`

Dans `loadConfig`, après avoir récupéré la réponse `/config` (objet `data`), ajouter :
```typescript
      if (data?.branding) {
        set({ branding: data.branding });
        applyBrand(data.branding.primaryColor, data.branding.accentColor);
      }
```
(Placer avant le `set({ configLoaded: true })` final.)

- [ ] **Step 4: Thème dynamique via getters**

Dans `lib/theme.ts`, ajouter en tête : `import { activeBrand } from './brand';`
Remplacer les valeurs statiques de marque par des getters dans `theme.colors` ET `darkTheme.colors` :
```typescript
    get primary() { return activeBrand.primary; },
    get primaryLight() { return activeBrand.primaryLight; },
    get primaryDark() { return activeBrand.primaryDark; },
    get accent() { return activeBrand.accent; },
    get accentLight() { return activeBrand.accentLight; },
    get onPrimary() { return activeBrand.onPrimary; },
    get onAccent() { return activeBrand.onAccent; },
```
(Laisser les autres couleurs — black, background, success… — inchangées.)

- [ ] **Step 5: Lancer tests + typecheck**

Run: `npx jest __tests__/configStore.branding.test.ts __tests__/brand.test.ts && npx tsc --noEmit 2>&1 | grep -i "error TS" | head; echo done`
Expected: tests PASS ; pas d'erreur TS sur les fichiers modifiés.

- [ ] **Step 6: Commit**

```bash
git add stores/configStore.ts lib/theme.ts __tests__/configStore.branding.test.ts
git commit -m "feat(branding): apply tenant colors into theme via configStore"
```

---

### Task 7: Mobile passager — logo + nom (header/auth) + gate 1er paint

**Files:**
- Modify: `aerocab-native/aerocab-passenger/app/_layout.tsx` (gate le rendu sur `configLoaded`)
- Modify: le composant d'en-tête + l'écran d'auth pour afficher `logoUrl` / `appName` (chemins à repérer : `components/` header, `app/(auth)/`)
- Test: manuel (rendu) + non-régression suite existante

**Interfaces:**
- Consumes: `configStore.getBranding()`, `configStore.configLoaded`.

- [ ] **Step 1: Gate le 1er paint**

Dans `app/_layout.tsx`, là où `loadConfig` est appelé : ne rendre l'app principale qu'une fois `configLoaded === true` ; sinon afficher un écran neutre (spinner sur fond `theme.colors.background`). Récupérer `const configLoaded = useConfigStore(s => s.configLoaded);` et :
```tsx
  if (!configLoaded) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }
```
(Imports `View`, `ActivityIndicator` depuis `react-native`.)

- [ ] **Step 2: Afficher le logo + nom**

Repérer le composant d'en-tête et l'écran d'accueil/auth. Y afficher :
```tsx
const branding = useConfigStore(s => s.getBranding());
// logo :
{branding?.logoUrl
  ? <Image source={{ uri: branding.logoUrl }} style={{ height: 32, width: 120, resizeMode: 'contain' }} />
  : <Text style={{ color: theme.colors.onPrimary, fontWeight: '700' }}>{branding?.appNamePassenger ?? 'AeroGo'}</Text>}
```
Remplacer le nom d'app affiché en dur (« AeroGo ») par `branding?.appNamePassenger ?? 'AeroGo'` aux endroits d'auth/accueil.

- [ ] **Step 3: Typecheck + suite existante**

Run: `npx tsc --noEmit 2>&1 | grep -i "error TS" | head && npx jest 2>&1 | grep -E "Tests:|failed" | tail -3; echo done`
Expected: pas d'erreur TS introduite ; suite existante verte.

- [ ] **Step 4: Commit**

```bash
git add app/_layout.tsx components/ app/
git commit -m "feat(branding): gate first paint + show tenant logo/name (passenger)"
```

---

### Task 8: Répliquer le branding mobile sur l'app CHAUFFEUR

**Files:**
- Create: `aerocab-native/aerocab-driver/lib/brand.ts` (identique à Task 5)
- Create: `aerocab-native/aerocab-driver/__tests__/brand.test.ts` (identique)
- Modify: `aerocab-native/aerocab-driver/stores/configStore.ts`, `lib/theme.ts`, `app/_layout.tsx`, en-tête/auth — même logique que Tasks 6-7, mais `appNameDriver` au lieu de `appNamePassenger`.

**Interfaces:**
- Miroir des Tasks 5-7 sur l'app chauffeur.

- [ ] **Step 1: Copier `lib/brand.ts` + test**

Copier le contenu exact de `lib/brand.ts` (Task 5, Step 3) et `__tests__/brand.test.ts` (Task 5, Step 1) dans l'app driver. Lancer :
Run: `cd aerocab-native/aerocab-driver && npx jest __tests__/brand.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 2: configStore + thème (comme Task 6)**

Appliquer à `aerocab-native/aerocab-driver/stores/configStore.ts` et `lib/theme.ts` les mêmes changements qu'en Task 6 (champ `branding`, `applyBrand` dans `loadConfig`, getters de thème). Vérifier que la structure du store driver correspond ; adapter si besoin.

- [ ] **Step 3: Gate + logo/nom (comme Task 7)**

Appliquer à `app/_layout.tsx` + en-tête/auth de l'app driver le gate + l'affichage `logoUrl`/`appNameDriver`.

- [ ] **Step 4: Typecheck + suite**

Run: `npx tsc --noEmit 2>&1 | grep -i "error TS" | head && npx jest 2>&1 | grep -E "Tests:|failed" | tail -3; echo done`
Expected: pas d'erreur TS ; suite existante verte.

- [ ] **Step 5: Commit**

```bash
git add lib/brand.ts __tests__/brand.test.ts stores/configStore.ts lib/theme.ts app/_layout.tsx components/ app/
git commit -m "feat(branding): mirror tenant branding on driver app"
```

---

### Task 9: Admin — deriveBrand (parité) + page « Apparence » + aperçu live

**Files:**
- Create: `aerocab-admin/src/lib/brand.ts` (COPIE de la logique Task 5)
- Create: `aerocab-admin/src/lib/brand.test.ts` (MÊME table de parité que Task 5, Step 1)
- Create: `aerocab-admin/src/pages/BrandingPage.tsx`
- Create: `aerocab-admin/src/components/BrandPreview.tsx`
- Modify: `aerocab-admin/src/services/api.ts` (appels `getPalettes`, `updateBranding`)
- Modify: routing admin (ajouter la route/entrée menu « Apparence ») + garde `manage_branding`

**Interfaces:**
- Consumes: `GET /branding/palettes`, `PATCH /admin/branding`, `deriveBrand` (copie).
- Produces: la page admin d'édition du branding avec aperçu.

- [ ] **Step 1: Écrire le test de parité (échoue d'abord)**

Créer `aerocab-admin/src/lib/brand.test.ts` avec **exactement** les mêmes assertions que `aerocab-native/aerocab-passenger/__tests__/brand.test.ts` (Task 5, Step 1) — importées depuis `./brand`.

Run: `cd aerocab-admin && npx jest src/lib/brand.test.ts` → Expected: FAIL (module introuvable).

- [ ] **Step 2: Copier `lib/brand.ts`**

Copier le contenu exact de `lib/brand.ts` (Task 5, Step 3) dans `aerocab-admin/src/lib/brand.ts` (mêmes exports `mix`, `readableText`, `deriveBrand`). Lancer :
Run: `npx jest src/lib/brand.test.ts` → Expected: PASS (parité garantie).

- [ ] **Step 3: API service**

Dans `aerocab-admin/src/services/api.ts`, ajouter (suivre le pattern axios/fetch existant) :
```typescript
export const getPalettes = () => api.get('/branding/palettes').then(r => r.data);
export const updateBranding = (dto: any) => api.patch('/admin/branding', dto).then(r => r.data);
```

- [ ] **Step 4: Composant aperçu**

Créer `aerocab-admin/src/components/BrandPreview.tsx` : un cadre « téléphone » (div stylée ~320×640) qui reçoit `{ primary, accent, logoUrl, appName }`, calcule `deriveBrand(primary, accent)` et rend un mock : en-tête à `primary` avec texte `onPrimary` + logo/nom, un bouton « Réserver » à `accent` avec texte `onAccent`, quelques blocs. Se met à jour à chaque changement de prop.

- [ ] **Step 5: Page Branding**

Créer `aerocab-admin/src/pages/BrandingPage.tsx` : état local `{ primaryColor, accentColor, paletteId, logoUrl, appNamePassenger, appNameDriver }`, chargé au montage depuis `/config` (ou un GET dédié) ; grille des palettes (`getPalettes`) → clic remplit les couleurs + `paletteId` ; deux `<input type="color">` (custom → `paletteId=null`) ; upload logo (réutiliser le composant/appel d'upload existant) ; deux champs de nom ; `<BrandPreview>` à droite lié à l'état ; bouton « Enregistrer » → `updateBranding(state)`. Ajouter la route + entrée de menu, gardées par `manage_branding` (pattern `Can`/permission existant).

- [ ] **Step 6: Build + tests admin**

Run: `npx jest src/lib/brand.test.ts && npm run build 2>&1 | grep -iE "error" | head; echo done`
Expected: parité PASS ; build admin sans erreur.

- [ ] **Step 7: Commit**

```bash
git add src/lib/brand.ts src/lib/brand.test.ts src/pages/BrandingPage.tsx src/components/BrandPreview.tsx src/services/api.ts src/App.tsx src/components/Sidebar.tsx
git commit -m "feat(branding): admin Apparence page + live preview (parity with mobile)"
```

---

## Self-Review (effectuée)
- **Couverture spec** : §2 modèle+catalogue → Tasks 1-2 ; §3 /config → Task 3 ; §3 endpoints/PATCH+RBAC → Tasks 2,4 ; §4 dérivation → Task 5 (+parité Task 9) ; §5 mobile → Tasks 6-8 ; §6 admin → Task 9 ; §7 tests → répartis, parité en Tasks 5+9.
- **Placeholders** : les 20 palettes sont concrètes (Task 2). Les décorateurs RBAC exacts (`@RequirePermission` vs `@Roles`) et les chemins précis d'en-tête/auth mobile sont à aligner sur l'existant du repo (indiqué explicitement, pas un TODO de logique).
- **Cohérence des types** : `BrandingBlock`, `deriveBrand`, `mix`, `readableText`, `activeBrand`, `applyBrand`, `PALETTE_CATALOG`, `manage_branding` cohérents entre tâches. Table de parité `deriveBrand` identique Task 5 ↔ Task 9.

## Hors périmètre (rappel)
Assets build-time (icône/splash/bundleId) = SP4. Flags opérationnels + presets = SP3.
