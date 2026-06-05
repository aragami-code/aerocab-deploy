# Revenue Analytics — Lot 2 (Admin UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Page admin « Revenus » consommant `GET /admin/revenue` : contrôles de période, cartes KPI, 4 graphes recharts, tableau par pays + total consolidé, panneau « Analyses & propositions » (insights), export CSV.

**Architecture :** Nouvelle page `RevenuePage.tsx` (React/Vite, recharts déjà présent), méthode `adminApi.getRevenue(...)`, route protégée `view_stats`, entrée sidebar. Lecture seule — consomme l'endpoint du Lot 1 déjà déployé.

**Tech Stack :** React + Vite + Tailwind + recharts (`^3.8.1`).

**Spec :** `docs/superpowers/specs/2026-06-05-revenue-analytics-design.md` (§5).

**Working dir :** `/home/aragami/aerogo24V2/aerocab-admin`.

**Acquis (à réutiliser) :**
- Endpoint live : `GET /admin/revenue?from=ISO&to=ISO&granularity=range|monthly` → réponse §3 du spec (`period`, `baseCurrency`, `byCountry[]`, `consolidated`, `timeseries[]`, `comparison`, `insights[]`).
- `src/services/api.ts` : client `adminApi` avec `request<T>(endpoint, { method, body })`. ⚠️ a du WIP lourd → NE PAS committer api.ts (ship via build).
- recharts utilisé dans `DashboardPage.tsx` : `import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ... } from 'recharts'`. Suivre ce style (couleurs, `ResponsiveContainer width="100%" height={...}`).
- Routing `src/App.tsx` : `<Route path="/x" element={<PermissionRoute permission="view_stats"><Page/></PermissionRoute>} />`.
- Sidebar `src/components/Sidebar.tsx` : tableau `NAV_ITEMS` `{ path, label, icon, section, permission }`, gating via `usePermission`. Entrée Analytics existe (`view_stats`).
- Couleurs thème : `primary` (≈ #1D2C4D), `accent`. Utiliser les classes Tailwind existantes des autres pages.

**Convention git :** fichiers NEUFS (RevenuePage) → commit direct. Fichiers à WIP (api.ts) → laisser en WT. App.tsx/Sidebar.tsx : vérifier `git status` → si propres, committer ; sinon WT.

---

## File Structure

- `src/services/api.ts` — **Modify** (NE PAS committer) : `getRevenue(params)` + types `RevenueResponse`
- `src/pages/RevenuePage.tsx` — **Create** : la page complète
- `src/App.tsx` — **Modify** : route `/revenue`
- `src/components/Sidebar.tsx` — **Modify** : entrée « Revenus »

---

### Task 1 : Type + méthode API

**Files:** Modify `src/services/api.ts` (ne pas committer)

- [ ] **Step 1 : Type + méthode**

READ `src/services/api.ts` (style `request`). Ajouter le type de réponse (mirror du backend) et la méthode :
```typescript
export interface RevenueResponse {
  period: { from: string; to: string; granularity: 'range' | 'monthly' };
  baseCurrency: string;
  byCountry: {
    country: string; currency: string;
    platform: { registration: number; accessPass: number; total: number };
    rides: { commission: number; total: number };
    grandLocal: number; grandBase: number;
  }[];
  consolidated: { baseCurrency: string; platform: number; rides: number; total: number };
  timeseries: { month: string; platform: number; rides: number }[];
  comparison: {
    platform: { current: number; previous: number; deltaPct: number | null };
    rides:    { current: number; previous: number; deltaPct: number | null };
    total:    { current: number; previous: number; deltaPct: number | null };
  };
  insights: { type: string; level: 'good' | 'info' | 'warn'; text: string }[];
}
```
et sur le client `adminApi` :
```typescript
  async getRevenue(params: { from?: string; to?: string; granularity?: 'range' | 'monthly' }) {
    const q = new URLSearchParams();
    if (params.from) q.set('from', params.from);
    if (params.to) q.set('to', params.to);
    if (params.granularity) q.set('granularity', params.granularity);
    const qs = q.toString();
    return this.request<RevenueResponse>(`/admin/revenue${qs ? `?${qs}` : ''}`);
  }
```
ADAPTER à la forme réelle de `request` et au style (export du type).

- [ ] **Step 2 : Compiler** : `npx tsc --noEmit 2>&1 | grep -i "services/api" || echo OK`. Expected `OK`.

- [ ] **Step 3 :** NE PAS committer api.ts (WIP). Laisser en working tree.

---

### Task 2 : Page `RevenuePage.tsx`

**Files:** Create `src/pages/RevenuePage.tsx`

- [ ] **Step 1 : Squelette + état + chargement**

READ `DashboardPage.tsx` pour les conventions (header, cartes, recharts, classes Tailwind, format des nombres). Créer `RevenuePage` avec :
- État : `data: RevenueResponse | null`, `loading`, `error`, et les contrôles de période `preset` (`'this_month'|'last_month'|'this_year'|'all'|'custom'`), `from`, `to`, `granularity`.
- Helper de calcul des dates selon `preset` (ce mois → 1er du mois→maintenant ; mois dernier ; cette année → 1er janv ; cumul → from très ancien ex `2020-01-01` ; custom → champs date).
- `useEffect` qui recharge `adminApi.getRevenue({ from, to, granularity })` quand les contrôles changent.
- Helper format montant : `fmt(n, currency)` → `n.toLocaleString('fr-FR')` + symbole/devise (afficher le code devise ; XAF→« FCFA »). Helper `fmtBase(n)` pour la devise de référence (`data.baseCurrency`).

- [ ] **Step 2 : Contrôles de période**

Barre en haut : boutons raccourcis (Ce mois / Mois dernier / Cette année / Cumul) + 2 `<input type="date">` (visibles si `custom`) + un toggle granularité (Plage / Mensuel). Styliser comme les autres filtres admin (boutons pill, état actif = fond primary).

- [ ] **Step 3 : Cartes KPI (4)**

Grille de 4 cartes :
1. **Total Plateforme** = `data.consolidated.platform` (en `baseCurrency`).
2. **Total Courses** = `data.consolidated.rides`.
3. **Grand total consolidé** = `data.consolidated.total`.
4. **Croissance** = `data.comparison.total.deltaPct` → flèche ↑ verte si ≥0, ↓ rouge si <0, « — » si `null`. Sous-texte « vs période précédente ».
Réutiliser le style de carte de DashboardPage.

- [ ] **Step 4 : Graphes recharts (4)**

Importer depuis `recharts` : `ResponsiveContainer, AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, Legend, CartesianGrid`.
1. **Tendance** (`AreaChart` sur `data.timeseries`, X=`month`, 2 aires empilées `platform` + `rides`). Hauteur ~260.
2. **Répartition** (`PieChart` donut : 2 segments Plateforme/Courses depuis `consolidated`). 2 couleurs (primary + accent).
3. **Comparaison par pays** (`BarChart` sur `data.byCountry`, X=`country`, barres `platform.total` et `rides.total` en devise locale — note : devises mixtes ; afficher en `grandBase` si on veut comparer, OU annoter « devise locale »). Choix : barres en `grandBase` (consolidé) pour comparabilité, libellé clair.
4. **Actuel vs précédent** (`BarChart` : 3 groupes Plateforme/Courses/Total, 2 barres current/previous depuis `data.comparison`).
Chaque graphe dans une carte avec titre. `ResponsiveContainer width="100%"`.

- [ ] **Step 5 : Tableau par pays + total consolidé**

Tableau : colonnes Pays · Inscription · Pass · Plateforme · Courses · Total (devise locale + code) · Total (`baseCurrency`). Une ligne par `byCountry`. Ligne finale **Total consolidé** = `consolidated` (en `baseCurrency`, autres colonnes « — » ou sommes base). Style table comme PromosPage/UsersPage.

- [ ] **Step 6 : Panneau « Analyses & propositions »**

Liste des `data.insights` : chaque item avec icône/couleur selon `level` (`good`=vert ✓, `info`=gris ℹ, `warn`=orange ⚠) + `text`. Carte titrée.

- [ ] **Step 7 : Export CSV**

Bouton « Exporter CSV » : génère un CSV client-side depuis `data.byCountry` (entêtes Pays;Inscription;Pass;Plateforme;Courses;TotalLocal;Devise;TotalBase) + ligne consolidé, et déclenche un download (Blob + lien). Pas d'appel réseau.

- [ ] **Step 8 : États vides / erreurs**

`loading` → spinner. `error` → message. Données toutes à 0 → message « Aucun revenu sur cette période » mais afficher quand même les contrôles.

- [ ] **Step 9 : Compiler** : `npx tsc --noEmit 2>&1 | grep -i "RevenuePage" || echo OK`. Expected `OK`.

- [ ] **Step 10 : Commit** (fichier neuf) : `git add src/pages/RevenuePage.tsx` → `feat(revenue): page admin Revenus (recharts + KPI + insights + CSV)`. Confirmer 1 fichier via `git show --stat HEAD`.

---

### Task 3 : Route + entrée sidebar

**Files:** Modify `src/App.tsx`, `src/components/Sidebar.tsx`

- [ ] **Step 1 : Route**

READ `src/App.tsx`. Importer `RevenuePage` et ajouter, près de la route `/analytics` :
```tsx
<Route path="/revenue" element={<PermissionRoute permission="view_stats"><RevenuePage /></PermissionRoute>} />
```

- [ ] **Step 2 : Sidebar**

READ `src/components/Sidebar.tsx`. Ajouter dans `NAV_ITEMS` (section `main`, après Analytics) :
```typescript
{ path: '/revenue', label: 'Revenus', icon: <ICÔNE>, section: 'main', permission: 'view_stats' },
```
Choisir une icône lucide pertinente déjà importée ou importer `Wallet`/`Coins`/`TrendingUp` depuis `lucide-react`.

- [ ] **Step 3 : Compiler** : `npx tsc --noEmit 2>&1 | grep -iE "App.tsx|Sidebar" || echo OK`. Expected `OK`.

- [ ] **Step 4 : Commit** (si App.tsx/Sidebar propres → committer ; sinon WT) : `feat(revenue): route + entrée sidebar Revenus`.

---

### Task 4 : Déploiement (rebuild admin)

- [ ] **Step 1 : Transférer** vers `/home/ubuntu/aerocab-admin` (base64 → VM via jump) : `src/pages/RevenuePage.tsx`, `src/services/api.ts`, `src/App.tsx`, `src/components/Sidebar.tsx`. Gérer root-owned (sudo -n chown ubuntu avant extraction, `tar xzf --overwrite`).
- [ ] **Step 2 : Build** : `docker compose build admin && docker compose up -d admin`. Vérifier conteneur `aerocab_admin` Up (le build Vite compile = validation TS).
- [ ] **Step 3 : Valider** : conteneur Up. (Vérif fonctionnelle = login admin → page Revenus affiche KPI/graphes/tableau ; à faire par l'utilisateur dans le navigateur.)

---

## Self-Review (effectuée)

**Couverture spec §5 :** contrôles période (presets+plage+granularité) → T2.2 ✓ ; 4 KPI → T2.3 ✓ ; 4 graphes → T2.4 ✓ ; tableau + consolidé → T2.5 ✓ ; insights → T2.6 ✓ ; CSV → T2.7 ✓ ; sidebar/route (§6 perm view_stats) → T3 ✓ ; api → T1 ✓.

**Cohérence types :** `RevenueResponse` (api.ts) mirror exact du backend Lot 1. `getRevenue({from,to,granularity})`.

**Placeholders :** aucun ; les choix UI (barres par pays en grandBase pour comparabilité, icône sidebar) sont explicités ; api.ts non committé (WIP).
