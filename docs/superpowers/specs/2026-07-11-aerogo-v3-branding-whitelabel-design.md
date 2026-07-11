# AeroGo V3 — Branding white-label (runtime)
## Spec de design — Sous-projet 2

- **Date** : 2026-07-11
- **Base de code** : `/home/aragami/aerogo24V3` (backend `aerocab-deploy/backend`, admin `aerocab-admin`, apps `aerocab-native/aerocab-passenger` + `aerocab-driver`)
- **Dépend de** : SP1 (cœur multi-tenant) — modèle `Tenant`, contexte tenant par requête, cascade `/config` scopée par tenant. **Livré.**
- **Statut** : design validé, en attente de relecture avant plan d'implémentation.

---

## 1. Objectif

Permettre à chaque opérateur (tenant) de personnaliser l'apparence **runtime** de ses apps : couleurs (primary + accent), logo, et nom affiché — sans rebuild. L'app applique ce branding au lancement. Un écran admin dédié permet de régler tout ça avec un aperçu en direct.

**Hors périmètre (→ SP4 build factory)** : icône native, splash natif, `bundleId`, nom dans les stores. SP2 ne traite que le branding **runtime** (dans l'app + en base).

### Décisions verrouillées (brainstorming)
| # | Décision |
|---|---|
| Périmètre | Runtime : bundle + theming mobile + admin. Build-time = SP4. |
| Livraison au mobile | **Étendre `/config` existant** (bloc `branding`), pas de nouvel endpoint. |
| Couleurs | **2 couleurs cœur** (primary + accent) + **catalogue de 20 palettes curées** + **mode custom**. Nuances & contraste **dérivés** côté client. |
| Logo | **Un seul logo**, affiché **header + écrans d'auth**, uploadé via le module `uploads` existant. |
| Admin | **Page « Apparence » dédiée** avec **aperçu live** (faux téléphone). |

---

## 2. Modèle de données & catalogue

### Champs Tenant (ajouts)
Le modèle a déjà `logoUrl`, `primaryColor`, `appNamePassenger`, `appNameDriver`. On ajoute :
```prisma
model Tenant {
  // ... existant ...
  accentColor String? @map("accent_color")  // 2ᵉ couleur cœur
  paletteId   String? @map("palette_id")     // id de la palette choisie ; null = custom
}
```
On stocke **les couleurs résolues** (`primaryColor` + `accentColor`). `paletteId` sert uniquement à l'admin pour surligner la palette sélectionnée. « Appliquer une palette » copie ses 2 couleurs dans les champs + mémorise `paletteId`. Le mode custom écrit les couleurs et met `paletteId = null`.

### Catalogue des palettes (curé, backend)
Défini une fois côté backend, exposé via `GET /branding/palettes` :
```ts
interface Palette { id: string; name: string; primary: string; accent: string; }
export const PALETTE_CATALOG: Palette[] = [ /* 20 combos harmonieux */ ];
```
L'app n'a **pas** besoin du catalogue (elle reçoit les couleurs résolues via `/config`). Seul l'admin le consomme pour afficher les vignettes.

---

## 3. Backend `/config` enrichi

L'endpoint `/config` (déjà chargé au démarrage, déjà scopé par tenant via SP1) gagne un bloc :
```jsonc
"branding": {
  "primaryColor": "#1E3A8A",
  "accentColor":  "#38BDF8",
  "logoUrl": "https://.../uploads/tenants/<slug>/logo.png",  // ou null
  "appNamePassenger": "AeroGo",
  "appNameDriver":    "AeroGo Driver"
}
```

**Résolution** : champs du tenant courant → si null, **défaut plateforme** (palette AeroGo + noms par défaut). Le tenant `aerogo` (mono-tenant actuel) tombe sur les défauts → comportement inchangé.

**Design** :
- Les deux apps reçoivent le même bloc ; chacune lit **son** `appName` (pas de paramètre `?app=`).
- Le backend envoie les **2 couleurs brutes** ; les nuances/contraste sont **dérivés côté client** (§4) — aperçu admin instantané + mobile autonome offline.
- On greffe le bloc sur le **builder `/config` existant** (aucune nouvelle plomberie mobile).

### Endpoints
- `GET /branding/palettes` — le catalogue (20 palettes).
- `PATCH /admin/branding` — met à jour le tenant courant (`primaryColor`, `accentColor`, `paletteId`, `logoUrl`, `appNamePassenger`, `appNameDriver`). **Gardé RBAC** via nouvelle permission `manage_branding`.
- Upload logo : via le mécanisme `uploads` existant → renvoie une URL posée dans `logoUrl`.

---

## 4. Dérivation couleurs + contraste (client)

Fonction pure `deriveBrand(primary, accent)`, ~20 lignes, **dupliquée** dans le mobile (`lib/brand.ts`) et l'admin (aperçu) — le partage inter-repo (RN ↔ web) n'en vaut pas la peine ; **testée des deux côtés avec les mêmes cas**.

```ts
function deriveBrand(primary: string, accent: string) {
  return {
    primary,
    primaryLight: mix(primary, '#FFFFFF', 0.25),
    primaryDark:  mix(primary, '#000000', 0.25),
    onPrimary:    readableText(primary),
    accent,
    accentLight:  mix(accent, '#FFFFFF', 0.25),
    onAccent:     readableText(accent),
  };
}

function readableText(hex: string): string {
  const { r, g, b } = hexToRgb(hex);
  const lum = (0.299*r + 0.587*g + 0.114*b) / 255;
  return lum > 0.6 ? '#1E1E1E' : '#FFFFFF';
}

// mix(colorA, colorB, ratio) : interpolation linéaire RGB de A vers B.
```

**Filet de sécurité contraste** = `readableText` : quel que soit le choix de l'opérateur (même un jaune clair), le texte reste lisible. Se branche sur `lib/theme.ts` : `primary/primaryLight/primaryDark/accent/accentLight` reçoivent les valeurs dérivées ; on ajoute `onPrimary`/`onAccent`.

---

## 5. Intégration mobile

**Flux** : démarrage → `configStore` charge `/config` (déjà le cas, contient maintenant `branding`) → `deriveBrand` → application des couleurs dans le thème **avant le 1er paint** → écrans rendus aux couleurs du tenant → composants Header/Auth lisent `logoUrl` & `appName` depuis `configStore`.

**Thème dynamique sans réécrire les écrans** : `lib/theme.ts` est statique et importé partout. Plutôt que migrer tous les écrans vers un hook, on **peuple les couleurs de marque au lancement, avant le 1er rendu** :
- `_layout.tsx` charge déjà le config au démarrage → on **gate le 1er rendu** sur ce chargement (écran de chargement neutre le temps de la réponse `/config` ou de la lecture du cache offline).
- Une fois chargé : `applyBrand(deriveBrand(primary, accent))` remplit les couleurs de marque du thème.
- Les écrans **continuent d'importer le thème** → migration minimale (on ne touche qu'aux valeurs `primary`/`accent`).

**Compromis assumé** : branding appliqué **au lancement** ; un changement pendant que l'app est ouverte nécessite un relancement. Acceptable pour du branding (≠ flags opérationnels SP3 qui, eux, seront live).

**Résilience** :
- Offline : `configStore` cache déjà le dernier `/config` → couleurs + `logoUrl` persistent ; l'image logo est mise en cache par le composant image.
- 1er lancement sans cache : **palette AeroGo par défaut** (statique) → jamais d'écran non stylé.

---

## 6. Admin — page « Apparence » + aperçu live

Page dédiée (React/Vite, patterns existants), deux colonnes :

**Gauche (réglages)** :
- **Catalogue** : `GET /branding/palettes` → grille de 20 vignettes (primary+accent). Clic → remplit les couleurs + `paletteId`.
- **Custom** : 2 sélecteurs de couleur → écrit les couleurs, `paletteId = null`.
- **Logo** : upload via le mécanisme existant → `logoUrl`.
- **Noms** : 2 champs (passager / chauffeur).
- **Enregistrer** → `PATCH /admin/branding`.

**Droite (aperçu live)** : un « faux téléphone » (composant React) qui applique `deriveBrand(primary, accent)` + logo + nom **en temps réel** à chaque changement. Même algorithme que le mobile (dupliqué).

**RBAC** : permission `manage_branding` (réutilise le système existant), assignée aux rôles admin.

---

## 7. Stratégie de test

**Backend** :
- Résolution `/config` : tenant avec branding → ses valeurs ; tenant sans → défauts plateforme.
- `PATCH /admin/branding` : met à jour les champs ; **403** sans `manage_branding`.
- `GET /branding/palettes` : renvoie les 20 palettes.

**Mobile** :
- `deriveBrand`/`readableText` : `mix` correct ; couleur claire→texte foncé, foncée→texte clair ; cas limites (blanc, noir, jaune clair).
- `configStore` : parse le bloc `branding` ; `applyBrand` peuple le thème ; fallback défaut si absent.

**Admin** :
- `deriveBrand` dupliqué : **mêmes cas que le mobile → mêmes sorties** (parité de contrat).
- Page : clic palette remplit le formulaire ; custom ; « Enregistrer » appelle `PATCH`.

**Test le plus important** : **parité `deriveBrand` mobile ↔ admin** (table de cas partagée, mêmes entrées/sorties) → garantit que l'aperçu admin correspond exactement au rendu de l'app.

---

## 8. Hors périmètre (rappel)
Assets build-time (icône/splash/bundleId/nom store) → SP4. Flags du modèle opérationnel + presets → SP3. 3ᵉ couleur, logo clair/sombre, splash interne, branding sur reçus/notifs → extensions ultérieures (YAGNI).

## 9. Risques
- **Migration du thème mobile** : le gate au 1er paint doit être fiable (offline compris) pour ne jamais afficher d'écran non stylé. Fallback défaut obligatoire.
- **Parité de dérivation** mobile/admin : garantie par la table de tests partagée ; sinon l'aperçu ment.
- **Contraste** : `readableText` couvre le cas des couleurs claires ; à tester sur les extrêmes.
