# AeroGo V3 — Plateforme multi-tenant white-label
## Spec de design — Sous-projet 1 : Cœur multi-tenant

- **Date** : 2026-06-25
- **Base de code** : `/home/aragami/aerogo24V3` (clone complet de V2 `/home/aragami/aerogo24V2`, hors APK)
- **Statut** : design validé, en attente de relecture avant plan d'implémentation
- **Stack** : NestJS + Prisma + PostgreSQL + Redis + Docker (backend) · React/Vite (admin) · Expo/React Native (apps passager + chauffeur)

---

## 1. Contexte et intention

AeroGo est aujourd'hui une application VTC spécialisée aéroport (mono-marque, multi-pays), en production sur `api.aerogo24.com` (V2 : 45 modèles Prisma, ~38 modules backend, 2 apps mobiles, 1 admin).

La **V3** transforme ce produit mono-marque en **plateforme white-label multi-tenant** : des **opérateurs** achètent une **licence** d'utilisation et exploitent **leur propre marque** de VTC (logo, couleurs, nom, modèle opérationnel), sur le moteur AeroGo. AeroGo (le concepteur) conserve une **vue globale** sur toutes les instances via un **control plane**, y compris sur les instances déployées « à part » (standalone) chez un client, sans accès direct.

### Relation V2 → V3
- **V2 reste en production, intacte.** Aucune modification sur `/home/aragami/aerogo24V2`.
- **V3 = copie de V2**, transformée en multi-tenant dans son propre dossier.
- V2 et V3 peuvent tourner en parallèle. Au **cutover**, les données de production V2 sont importées dans V3 en tant que **« tenant zéro » (AeroGo)**.

---

## 2. Décomposition du programme V3 (6 sous-projets)

La V3 est trop vaste pour une seule spec. Elle se décompose en 6 sous-systèmes indépendants. **Cette spec ne couvre que le sous-projet 1.** Les suivants auront chacun leur cycle spec → plan → implémentation.

| # | Sous-projet | Rôle | Statut |
|---|---|---|---|
| **1** | **Cœur multi-tenant** | Modèle `Tenant`, isolation des données, résolution du tenant, cascade de config | **CETTE SPEC** |
| 2 | Branding white-label | Logo/couleurs/nom par tenant (config backend + theming mobile) | à venir |
| 3 | Modèle opérationnel configurable | Catalogue de flags + presets (Blacklane/Uber/Yango/Gozem/Heetch) | à venir |
| 4 | Build factory mobile | Pipeline EAS générant un APK/IPA brandé par tenant (passager + chauffeur) | à venir |
| 5 | Module Partenaires B2B | Niveau 3 : hôtels/aéroports rattachés à un tenant (multi-pays) | à venir |
| 6 | Control Plane | Serveur de licences + télémétrie phone-home + dashboard global | à venir |

**Ordre de construction** : 1 → 2 → 3 → 4 → 5 → 6. Le cœur d'abord (invisible pour l'utilisateur, tout reste sur le tenant zéro), le control plane et le build factory en dernier.

---

## 3. Décisions transverses (verrouillées)

| Décision | Choix retenu |
|---|---|
| **Modèle business** | Opérateurs sous licence, white-label isolés. Hiérarchie **Plateforme → Tenant → Partenaires**. |
| **Topologie** | Hybride : majorité **partagée** (1 base, isolation par colonne) + **standalone** pour gros clients, toutes reliées au control plane par **phone-home**. |
| **Licence** | Champ `licenseMode` : `ENFORCED` / `PERPETUAL` / `DISABLED`. Cession de code source = exception contractuelle **hors produit** (renonce à la visibilité). |
| **Isolation (approche A)** | Colonne `tenantId` sur les tables opérationnelles + **middleware Prisma fail-closed**. Standalone = même code, base dédiée à un seul tenant. |
| **Cascade config** | `Tenant + Pays → Tenant → Plateforme` (sur `AppSetting`). |
| **Modèle opérationnel** | Catalogue de flags + presets. Un concurrent = une combinaison de réglages, pas un objet de code. WhatsApp = capacité du catalogue. |
| **Mobile** | Build dédié par tenant (passager + chauffeur). Branding figé au **build**, comportement au **runtime** (bundle + socket). |
| **Résolution tenant** | `tenantId` = claim du JWT signé (source de vérité). Pré-auth via slug gravé au build. Super-admin = exception auditée. |
| **Chauffeur** | ∈ un seul tenant. Les passagers d'un tenant ne voient que les chauffeurs de ce tenant. |
| **Territoires** | Concurrence ouverte autorisée (Q6=B) — sans friction car chaque opérateur a son app dédiée. |
| **Migration** | AeroGo V2 = « tenant zéro ». 4 phases réversibles. |

---

## 4. Design détaillé — Cœur multi-tenant

### Section 1 — Modèle de données

#### Nouveau modèle `Tenant` (racine de tout)

```prisma
model Tenant {
  id                String   @id @default(cuid())
  slug              String   @unique          // "taxiplus"
  name              String                    // "TaxiPlus"
  status            TenantStatus              // TRIAL | ACTIVE | SUSPENDED

  // Licence (control plane / phone-home)
  licenseKey        String   @unique
  licenseMode       LicenseMode               // ENFORCED | PERPETUAL | DISABLED
  licenseExpiry     DateTime?                 // pertinent si ENFORCED

  // Branding (lu au build mobile + admin)
  logoUrl           String?
  primaryColor      String?
  appNamePassenger  String?
  appNameDriver     String?
  bundleIdPassenger String?
  bundleIdDriver    String?

  // Modèle opérationnel = catalogue de flags (défaut tenant)
  operatingModel    Json                      // { flight_tracking, street_hail, pricing_mode, ... }

  countries         TenantCountry[]           // multi-pays
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
}

enum TenantStatus { TRIAL ACTIVE SUSPENDED }
enum LicenseMode  { ENFORCED PERPETUAL DISABLED }

model TenantCountry {
  id          String  @id @default(cuid())
  tenantId    String
  countryCode String                          // CM, GA, ...
  tenant      Tenant  @relation(fields: [tenantId], references: [id])
  @@unique([tenantId, countryCode])
}
```

#### Classification des 45 modèles V2 (3 catégories)

**Scopé tenant** (ajout `tenantId` NOT NULL + index) :
User, DriverProfile, DriverDocument, CountryChangeRequest, Flight, Booking, BookingParticipant, BookingPayout, PaymentIntent, PaymentLink, TipTransaction, RideReceipt, ReceiptJob, DriverRegistrationPayment, DriverEarningsWallet, Wallet, Transaction, WithdrawalRequest, PromoCode, PromoUsage, Forfait, PricingZone, DriverPosition, PointsTransaction, Rating, Report, TicketMessage, Conversation, Message, Announcement, AnnouncementRead, KycDocument, EmergencyContact, AdminNotification, FavoriteDriver, TariffSnapshot, AuditLog.

**Assignations RBAC scopées tenant** (chaque tenant a ses propres admins) :
UserAdminRole, UserPermission.

**Partagé plateforme** (pas de `tenantId`) :
Country, Airport (faits géographiques), Permission, AdminRole, RolePermission (catalogue RBAC commun).

**Cascade** (`tenantId` NULLABLE ; `null` = défaut plateforme) :
AppSetting.

#### Nuances
- **Aéroports** : `Airport` reste partagé. « Quels aéroports CE tenant opère » (ex-`is_operated`) devient une relation **Tenant↔Airport** (sous-projet ultérieur, prévu mais non implémenté ici).
- **Partenaires** : le modèle `Partner` (niveau 3) n'est **pas** dans ce sous-projet. Il portera `tenantId` + `countryCode` (+ localisation) et réutilisera les ancrages posés ici. Règle : `Partner.countryCode ∈ TenantCountry`.

### Section 2 — Résolution du tenant à chaque requête (sécurité)

**Principe absolu : ne jamais faire confiance au client pour décider du tenant.**

| Type de requête | Source du tenant | Risque |
|---|---|---|
| Authentifiée (99%) | `tenantId` claim du **JWT signé** | nul |
| Pré-auth (signup, OTP, login) | slug/clé **gravé dans le build mobile** | faible (crée un compte uniquement dans ce tenant) |
| Instance standalone | `tenantId` **figé dans l'env** (ignore le client) | nul |
| Super-admin / control plane | scope « plateforme » explicite et audité | audité |

**Implémentation (NestJS + Prisma)** :
1. Le guard d'auth lit le JWT → extrait `tenantId` → pose un `TenantContext` (request-scoped).
2. Un **middleware/extension Prisma** lit `TenantContext` et **injecte automatiquement** `WHERE tenantId = ctx.tenantId` sur chaque requête des tables scopées.
3. Aucun code métier n'écrit le filtre à la main → impossible à oublier.

**Règle fail-closed (non négociable)** : requête sur table scopée **sans tenant résolu** → bloque / renvoie vide. **Jamais** « toutes les données ». Seule exception : super-admin via scope plateforme explicite et audité.

**Impact existant** : le module `auth` doit embarquer `tenantId` dans le JWT à la connexion (le mécanisme `session version` reste). Aucun autre code métier à modifier — le filtre est automatique.

### Section 3 — Cascade de configuration

Résolution d'un paramètre, donné (tenant, pays), du plus précis au plus général :

```
1. Tenant + Pays      (AppSetting tenantId=T, countryCode=C)
2. Tenant (tout pays) (AppSetting tenantId=T, countryCode=null)
3. Plateforme         (AppSetting tenantId=null, countryCode=null)  ← défaut usine
```

Réutilise le helper existant `resolveScopedSetting` (déjà capable du scoping par pays) ; on ajoute le niveau tenant au sommet.

**Exemple — `startup_fee`** : défaut plateforme 1000 ; « TaxiPlus partout » 1500 ; « TaxiPlus Gabon » 2000. → Passager TaxiPlus au Gabon = 2000 ; au Cameroun (pas d'override) = 1500 ; autre tenant = 1000.

**Flags du modèle opérationnel** : suivent la même cascade. Défaut tenant dans `Tenant.operatingModel` ; surcharge possible par pays via `AppSetting`. Un tenant peut donc faire du « Blacklane » au Cameroun et du « Uber » au Gabon.

**Presets** : un preset (« Blacklane », « Uber », « Yango »…) est un **modèle JSON livré (seed)**. « Appliquer le preset » **remplit** la config du tenant ; le preset ne reste pas dans le circuit de résolution.

**Bundle mobile** : `GET /tenant/bundle` renvoie la config **déjà résolue et aplatie** (branding + operating_model + features) pour le tenant+pays courant. L'app ne voit jamais la cascade.

#### Propagation des changements vers le mobile
- **Runtime** (flags, prix, couleurs d'accent) : via le bundle → instantané. 3 niveaux : cold start, vérification de version (ETag), **push socket** `config_updated` (sockets passager/chauffeur déjà en place).
- **Build-time** (logo, nom, bundleId) : nécessite un nouveau build + MAJ store.
- **Résilience hors-ligne** : l'app garde en cache le dernier bundle valide (comme les aéroports offline).
- **Cohérence course** : le bundle (tarifs) est **figé au démarrage de la course** (réutilise `TariffSnapshot`). Les nouveaux réglages ne valent que pour les prochaines courses.

### Section 4 — Control Plane (crochets dans le cœur)

Le control plane est un **service séparé** (sous-projet 6). Mais deux crochets doivent exister **dès le cœur** :
1. Le modèle `Tenant` porte `licenseKey` / `licenseMode` / `licenseExpiry` (Section 1).
2. Chaque instance doit savoir **émettre un heartbeat + valider sa licence** au boot.

**Phone-home (sortant)** : l'instance appelle le control plane (jamais l'inverse) → traverse pare-feu/NAT du client (indispensable pour standalone). Authentifié par `licenseKey` + payload signé. Contenu : heartbeat (~10 min, version), métriques agrégées (courses, chauffeurs actifs, CA, erreurs, santé).

**Licence + période de grâce** :
- Valide → normal.
- Control plane injoignable (réseau) → continue via **token de licence signé en cache**, N jours (grâce).
- Expirée / suspendue → **dégrade** : bloque les nouvelles courses, garde la lecture seule (ne casse pas une course en cours).
- `licenseMode = PERPETUAL` → phone-home pour télémétrie, jamais bloquant. `DISABLED` → aucune vérification (télémétrie conservée tant que c'est l'image AeroGo).

**Sécurité endpoints** : les endpoints de métriques/télémétrie doivent être strictement gardés (licence + rôle). NB : corriger aussi `GET /metrics` (actuellement public en V2) → `@UseGuards(JwtAuthGuard, RolesGuard) @Roles('admin')`.

### Section 5 — Plan de migration

#### Deux migrations distinctes
- **Code** : transformer le code copié (V3) en multi-tenant (tenantId, middleware, cascade). Se fait dans `/home/aragami/aerogo24V3`.
- **Données** : au cutover, importer les données prod V2 → V3 en les rattachant au **tenant zéro (AeroGo)** + backfill `tenantId`.

> **Fait de prod confirmé (2026-07-03)** : le stack **réellement live** est `docker-compose.yml` (préfixe `aerocab_`), conteneur `aerocab_postgres`, base **`aerogo24`** (user `laravel`) — **et non** `docker-compose.v2.yml` / `aerogo24v2`. VM Proxmox 101 « aerogo » (`192.168.100.101`, jump `root@217.160.47.83`, agent QEMU `qm guest exec` — pas de SSH direct). Base = 13 Mo, 46 tables. Un dump vérifié existe : `/home/aragami/vps_deployement_2/aerogo24_prod_20260703.sql.gz`. **La base source du tenant zéro est donc `aerogo24`.**

#### 4 phases réversibles (sur V3)
```
Phase A — Schéma sans contrainte
  • Créer table Tenant + tenant "aerogo" (tenant zéro)
  • Ajouter tenantId en NULLABLE partout ; AppSetting.tenantId nullable
  • Déployer → rien ne change

Phase B — Backfill
  • UPDATE tenantId = "aerogo" sur toutes les lignes
  • Vérifier 0 ligne sans tenant

Phase C — Middleware en mode ALERTE
  • Activer le middleware d'isolation en LOG SEULEMENT (ne bloque pas)
  • Tourner quelques jours, chasser les requêtes sans tenant résolu
  • tenantId → NOT NULL une fois le backfill confirmé

Phase D — Mode FORCÉ (fail-closed)
  • Le middleware bloque pour de bon
```

Le mode alerte (phase C) est le filet : il révèle toute requête oubliée avant l'enforcement. On ne passe en D qu'avec zéro alerte.

#### JWT existants & apps installées
- Token sans `tenantId` → **défaulté à `aerogo`** pendant la fenêtre de transition.
- Nouveaux logins → claim `tenantId`. À terme, bump `session version` pour forcer le renouvellement.
- Apps mobiles déjà installées : le backend défaute tout sur `aerogo` → elles fonctionnent sans MAJ.

---

## 5. Stratégie de test

- **Isolation (critique)** : créer un 2ᵉ tenant de test ; prouver sur **chaque module scopé** qu'un tenant ne peut **jamais** lire/écrire les données d'un autre (et inversement). Tests d'intégration au niveau du middleware Prisma + par endpoint.
- **Fail-closed** : requête sans tenant résolu → vérifie le blocage (jamais de fuite « toutes données »).
- **Cascade** : tests unitaires de `resolveScopedSetting` sur les 3 niveaux (Tenant+Pays / Tenant / Plateforme).
- **Migration** : tester les 4 phases sur une copie de la base prod (backfill complet, 0 ligne orpheline, mode alerte = 0 violation avant enforce).
- **Licence** : ENFORCED expiré → dégradation ; grâce hors-ligne ; PERPETUAL/DISABLED → jamais bloquant.
- **Régression V2** : la suite de tests V2 existante doit rester verte (le tenant zéro se comporte comme V2).

---

## 6. Hors périmètre de ce sous-projet (rappel)
Branding theming mobile (SP2), catalogue de flags & presets concrets (SP3), build factory EAS (SP4), module Partenaires B2B (SP5), dashboard control plane & actions distantes (SP6). Le cœur se contente de **rendre tout cela possible** via le modèle `Tenant`, l'isolation et la cascade.

---

## 7. Risques & points d'attention
- **Le middleware d'isolation est le composant le plus critique** : un défaut = fuite inter-tenant. Traité comme tel (tests exhaustifs, fail-closed, revue de sécurité dédiée).
- **Backfill sur base prod** : opération sensible ; faite en phase B avec vérification stricte et rollback possible (tenantId nullable jusqu'en C).
- **Dérive de version** des instances standalone : tracée par le control plane (SP6).
- **Cession de code source** : exclue du produit ; si exception commerciale, acter la perte de visibilité par écrit.
- **Sécurité héritée de V2** : `GET /metrics` public à corriger ; secrets en clair dans d'anciens dumps SQL (hors V3) à faire tourner.
