# Design — Système d'annonces & gestion de version APK

**Date :** 2026-06-02
**Statut :** Validé (brainstorming) — prêt pour plan d'implémentation
**Portée :** backend (`aerocab-deploy`), admin (`aerocab-admin`), mobile (`aerocab-passenger`, `aerocab-driver`)

## 1. Objectif

Permettre à l'admin de gérer des **annonces** (promotions, infos produit, publicité interne) et la **version des apps** (mise à jour forcée ou suggérée), diffusées dans les apps mobiles via trois surfaces : **modal au lancement**, **centre de notifications** (fusionné avec l'existant), et **gate de version** avec téléchargement/installation APK in-app.

## 2. Décisions produit (issues du brainstorming)

| Sujet | Décision |
|---|---|
| Surfaces | Modal au lancement · Centre de notifications · Mise à jour APK forcée |
| Ciblage | App (passager/chauffeur) + Pays + Tier fidélité — **filtres optionnels combinés en ET** (vide = pas de restriction) |
| Pays | **Dynamique** via `GET /zones/admin/countries` — jamais hardcodé |
| Version | Deux seuils : `min` (blocage total) + `latest` (bandeau suggéré, fermable) |
| Publicité | **Interne uniquement** (image + titre + texte + action) — pas de régie tierce |
| Actions CTA | `écran in-app` · `copier code promo` · `aucune` (pas de lien externe) |
| Rythme de fetch | Au lancement + retour au 1er plan, cache local ~5 min |
| Téléchargement APK | **In-app** : barre de progression → installation auto (Android) |
| Centre de notifs | **Option 1 — fusionné** : annonces affichées dans le centre existant, aux côtés des push FCM |

## 3. Architecture (Approche A — Poll au lancement)

Le mobile appelle un endpoint unique au démarrage et au retour au premier plan. Le backend filtre côté serveur selon le profil de l'utilisateur (app/pays/tier) et renvoie les annonces actives + la politique de version. Pas de dépendance temps réel (les surfaces ne l'exigent pas). Un push FCM optionnel par annonce pourra être ajouté plus tard (hors scope — YAGNI).

## 4. Modèle de données

### Table `Announcement`

| Champ | Type | Rôle |
|---|---|---|
| `id` | uuid | — |
| `type` | enum `promo`\|`info`\|`ad` | icône/couleur d'affichage |
| `title` | string | titre |
| `body` | text | contenu |
| `imageUrl` | string? | image optionnelle |
| `priority` | enum `high`\|`normal` | `high` = modal au lancement · `normal` = centre uniquement |
| `ctaType` | enum `none`\|`screen`\|`promo_code` | type d'action |
| `ctaLabel` | string? | texte du bouton |
| `ctaValue` | string? | route in-app **ou** code promo selon `ctaType` |
| `targetApps` | string[] | `passenger`,`driver` — vide = les deux |
| `targetCountries` | string[] | codes pays — vide = tous |
| `targetTiers` | string[] | `bronze`..`platinum` — vide = tous |
| `startsAt` / `endsAt` | datetime? | fenêtre de planification |
| `isActive` | bool | interrupteur manuel |
| `createdBy` | uuid | admin auteur |
| `createdAt` / `updatedAt` | datetime | — |

### Table `AnnouncementRead`

| Champ | Type | Rôle |
|---|---|---|
| `id` | uuid | — |
| `announcementId` | uuid | → Announcement (FK) |
| `userId` | uuid | → User (FK) |
| `seenAt` | datetime | affichage/fermeture du modal |
| | | **unique(announcementId, userId)** |

### Gestion de version → `app_settings` (clés)

`min_version_passenger`, `latest_version_passenger`, `apk_url_passenger`,
`min_version_driver`, `latest_version_driver`, `apk_url_driver`.

### Règle "annonce active pour un utilisateur"

`isActive = true` **ET** `now ∈ [startsAt, endsAt]` (bornes nulles = ouvertes) **ET** l'app/pays/tier de l'utilisateur ∈ filtres (filtre vide = pas de restriction).

**Précisions de filtrage :**
- Le filtre **tier** ne s'applique qu'à l'app **passager** ; il est ignoré pour le feed chauffeur (les chauffeurs n'ont pas de tier fidélité). Une annonce avec `targetTiers` non vide ne sera donc jamais servie à l'app chauffeur.
- Le CTA `screen` référence une **route spécifique à une app** (passager ≠ chauffeur). Si l'annonce cible les deux apps, l'admin doit choisir une route commune ou `ctaType: none` ; l'éditeur propose les routes selon les apps ciblées.

## 5. Backend (API + RBAC)

### Endpoints mobile (authentifié)

| Méthode | Route | Rôle |
|---|---|---|
| `GET` | `/announcements/feed` | `{ announcements: [...], version: {min, latest, apkUrl} }` filtré côté serveur. App déduite du token, pays/tier du profil. Chaque annonce porte un flag `seen`. |
| `POST` | `/announcements/:id/seen` | Upsert `AnnouncementRead` (le modal ne réapparaît plus). |

### Endpoints admin (RBAC `manage_announcements`)

| Méthode | Route | Rôle |
|---|---|---|
| `GET` | `/admin/announcements` | liste + filtres |
| `POST` | `/admin/announcements` | créer |
| `PATCH` | `/admin/announcements/:id` | éditer / activer-désactiver |
| `DELETE` | `/admin/announcements/:id` | supprimer |
| `GET` | `/admin/announcements/:id/stats` | destinataires estimés + nb vues |
| `GET` / `PUT` | `/admin/app-version` | lire/écrire les 6 clés de version |

- **RBAC** : nouvelle permission `manage_announcements` ajoutée à la matrice + seed + hook `Can`. Attribuée par défaut aux rôles admin/super-admin.
- **Upload image** : réutilise le module `uploads` existant.
- **Pays** : le multi-select admin consomme `GET /zones/admin/countries`.

## 6. Interface admin (`AnnoncesPage`)

Nouvelle page (icône Megaphone, permission `manage_announcements`), structure CRUD calquée sur `PromosPage`.

- **Onglet Annonces** : liste filtrable (type/app/statut) avec vues + fenêtre d'expiration ; bouton "Nouvelle".
- **Éditeur** : type · titre · corps · upload image · priorité · action (aucune / écran in-app via liste de routes / code promo) · ciblage (multi-select apps/pays/tiers) · planification (début/fin + toggle actif) · **aperçu live** du modal.
- **Onglet Version** : pour chaque app, `version min` / `dernière version` / `URL APK` → écrit les 6 clés `app_settings`.

## 7. Intégration mobile

### a) Modal au lancement
Composant `<AnnouncementGate>` enveloppant l'app. Au démarrage + retour 1er plan : fetch `/announcements/feed` (cache 5 min). Affiche en modal la 1ʳᵉ annonce `priority: high` **non-vue** → clic/fermeture → `POST /:id/seen`.

### b) Centre de notifications (fusionné — Option 1)
L'écran `notifications.tsx` existant rend une **liste fusionnée** : items locaux (push FCM via `notificationInboxStore`) + annonces du `/feed`, triés par date. Chaque source garde sa source de vérité pour l'état lu (push = local AsyncStorage ; annonce = serveur via `AnnouncementRead`). Le badge 🔔 compte les deux.

### c) Gate de version + téléchargement in-app
- `version < min` → écran **bloquant** (pas de fermeture).
- `version < latest` (≥ min) → **bandeau fermable** "Mise à jour disponible".
- Clic "Mettre à jour" → **modal de téléchargement in-app** :
  - `expo-file-system` `createDownloadResumable` → barre de progression (%, Mo) vers le cache app.
  - À 100 % → `expo-intent-launcher` ouvre l'APK → installateur système Android.
- Source de l'APK = réglage admin `apk_url_<app>`.
- **Permission** `REQUEST_INSTALL_PACKAGES` ajoutée à `app.config.js` des 2 apps.
- **Limite connue** : Android 8+ demande une fois l'autorisation "installer des apps inconnues" (inévitable hors Play Store, 2 taps).

### Nouvelles dépendances mobile
`expo-file-system`, `expo-intent-launcher` (officielles Expo).

## 8. Hors scope (YAGNI)

- Push FCM par annonce (ajout futur possible, réutilisera `sendToUser`).
- Régie publicitaire tierce (AdMob).
- Bannière sur l'accueil (non retenue).
- Lien CTA externe (non retenu).
- iOS sideload (apps distribuées en APK Android).

## 9. Comportement Android-only assumé

Le téléchargement/installation in-app est Android uniquement, ce qui correspond à la distribution APK actuelle. Aucun équivalent iOS n'est prévu.
