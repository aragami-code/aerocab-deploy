# Design — Configuration par pays (multi-pays)

**Date :** 2026-06-03
**Statut :** Validé (brainstorming) — prêt pour plan d'implémentation
**Portée :** backend (`aerocab-deploy`), admin (`aerocab-admin`), mobile (`aerocab-passenger`, `aerocab-driver`)

## 1. Objectif

Faire d'AeroGo une plateforme **réellement multi-pays** : quand AeroGo s'implante dans un pays, l'admin y configure tout l'opérationnel (paiements, financier, workflows, features, dispatch, KYC, tarifs/zones/aéroports). Les paramètres d'infrastructure restent globaux. À la connexion, l'app active les services du pays **de service** de l'utilisateur. Un admin peut être global ou scopé à un/des pays.

## 2. Principe directeur

> **La config suit le pays de SERVICE, jamais le pays du téléphone seul.**
> - Passager ARRIVAL/DEPARTURE → pays **GPS / pickup**
> - Passager INTERNATIONAL → pays **destination** (`booking.operatingCountry`)
> - Chauffeur → **`driverProfile.countryCode`** (pays d'opération approuvé)
> - Affichage général sans contexte de course → pays **d'origine** (téléphone) ou `defaultCountry`

Résolution en **cascade** : `key:PAYS` → `key` (global) → défaut codé. Tant qu'aucun override `key:PAYS` n'existe, le comportement est identique à aujourd'hui (migration sûre par construction).

## 3. Décisions (issues du brainstorming)

| Sujet | Décision |
|---|---|
| Stockage | Convention `key:PAYS` dans `app_settings` (étend le pattern `tariffs_config:CM`) + table `Country` |
| Domaines par pays | Paiements, Financier, Workflows/Features, Dispatch, KYC (`driver_document_config`), `vehicle_capacity` (+ tarifs/zones/aéroports déjà OK) |
| Restent globaux | `google_maps_key`, `bot_*`, `jwt_*`, APIs vol, infra SMS/email (`twilio_*`, `sendgrid_*`, `otp_*`, `sms_routing_rules`), `test_mode_*`, `backend_url` |
| Onboarding pays | Nouveau pays = `draft`, activable seulement quand la checklist est complète |
| Admin | Hub "Pays" (onboarding/activation) + sélecteur global (édition quotidienne) + stats par pays |
| Admins | 2 groupes : globaux (`countryScope=[]`) et scopés (`countryScope=['SN']`) |
| Détection pays | Préfixe téléphonique + **sélecteur pays explicite** à l'inscription (téléphone obligatoire) |
| Wallet points | **Universel ancré** à une devise de référence ; `pointValue:pays` = taux de change |
| Changement pays chauffeur | **Retrait complet obligatoire** avant approbation |
| Pass/adhésion | **Rails locaux + destination centrale** (`purpose=platform_fee`) |
| Commission | **Gelée au booking** (`booking.commissionRate`) |

## 4. Modèle de données

### Table `Country` (nouvelle)

| Champ | Type | Rôle |
|---|---|---|
| `code` | string PK | ISO-2 (`CM`, `SN`, `KE`) |
| `name` | string | "Cameroun" |
| `flagEmoji` | string? | 🇨🇲 |
| `phonePrefix` | string | `+237` |
| `currency` | string | `XAF`, `KES` |
| `currencySymbol` | string | `FCFA` |
| `currencyDecimals` | int | 0 (XAF/XOF), 2 (USD/KES) |
| `pointFxRate` | float | unités locales par point (= ancien `pointValue`, devenu taux de change) |
| `defaultLanguage` | string | fallback messages serveur (`fr`/`en`) |
| `status` | enum `draft`\|`active`\|`suspended` | `draft`/`suspended` = non servi |
| `isDefault` | bool | repli comptes sans pays (un seul `true`, invariant service) |
| `createdAt`/`updatedAt` | datetime | |

### Devise de référence (global)
`reference_currency` (ex: `XAF`) en `app_settings` global. Un point = 1 unité de référence. `Country.pointFxRate` convertit local ↔ points.

### Overrides par pays
Convention `app_settings["<key>:<COUNTRY>"]`. Constante backend `PER_COUNTRY_KEYS` (liste blanche) : seules ces clés sont surchargeables par pays. Voir §3 pour la liste des domaines.

### Champs ajoutés à des modèles existants
- `Booking.commissionRate` (float) — taux gelé à la création.
- `Promo.countryCode` (string?, nullable = global).
- `UserAdminRole.countryScope` (string[], `[]` = tous pays).

### Détection pays
`User.countryCode` reste rempli, mais devient **confirmé par sélecteur explicite** à l'inscription (le préfixe ne fait que pré-remplir). Résout l'ambiguïté +1 (US/CA) et autres préfixes partagés.

## 5. Backend — résolution & règles

### 5.1 Résolveur central (`SettingsService`)
```ts
getForCountry(key, countryCode?) : key:PAYS → key → défaut
```
- `countryCode` résolu selon le contexte (voir §2). Repli : `Country.isDefault` puis constante `FALLBACK_COUNTRY='CM'`.
- Migration domaine par domaine : remplacer `settings.get(key)` par `getForCountry(key, paysService)` dans : `bookings.service` (commission, dispatch, features), `payments`, `dispatch.service`, KYC.

### 5.2 Bundle de config app
```
GET /config/bundle   (authentifié)
→ { configVersion, country:{code,currency,symbol,decimals}, payments:[...],
    features:{...}, workflows:{...}, financial:{...} }
```
Résolu pour le pays pertinent. Fetch au login + retour 1er plan (cache 5 min). Consommé par le `configStore` mobile existant.

### 5.3 Activation pays (readiness)
`Country.status: draft → active` gardé par `canActivate(country)` :
- `currency` + `pointFxRate` définis
- ≥1 `payment_method` actif
- ≥1 zone tarifaire
- ≥1 aéroport opéré
→ sinon `400 "Pays incomplet : <manquants>"`. `isCountrySupported(code)` devient `Country.status === 'active'`.

### 5.4 Périmètres de paiement
- **Marketplace (par pays)** : courses, recharge wallet → providers `payment_*:<paysService>`. Le webhook entrant résout les credentials via `booking.operatingCountry`.
- **Plateforme (rails locaux + destination centrale)** : `purpose ∈ {driver_registration, access_pass}` → moyen de paiement **local** (pays du payeur, pour qu'il puisse payer) mais **comptabilisé sur le ledger central AeroGo**, **sans** commission marketplace. Montant en cascade (global + override pays).
- **Provider de retrait** : par pays (le payout chauffeur résout le provider du pays du chauffeur).

### 5.5 Wallet & monnaie
- **Points** = unité universelle ancrée à `reference_currency`. Prix de zone en points. Payer une course par wallet = **débit de points** (interne, zéro FX).
- **Recharge** = achat de points via provider du pays de service : `points = montantLocal / pointFxRate`.
- **Cash** = devise du pays de service, payée au chauffeur en main propre ; commission = dette chauffeur (`cash-commission.service`) au taux gelé du booking.
- **Wallet gains chauffeur** (argent réel) : au **changement de pays**, retrait complet obligatoire (wallet→0) avant approbation ; les nouveaux gains s'accumulent dans la devise du nouveau pays.

### 5.6 Commission gelée
À la création du booking : `booking.commissionRate = getForCountry('commission_rate', operatingCountry)`. La finalisation utilise ce taux gelé (audit/litiges).

### 5.7 RBAC
- Permission `manage_countries` (créer/activer/suspendre un pays).
- `UserAdminRole.countryScope` : `[]` = tous pays (global) ; `['SN']` = scopé.
- **Guard transversal** (intercepteur) : filtre toute lecture/écriture par `countryScope`. Checklist de test par endpoint de données (users, bookings, drivers, reports, stats) pour l'étanchéité PII.

## 6. Admin

### 6.1 Sélecteur global (barre du haut)
Contexte React + persistance localStorage. Choix : `Global` (infra + défauts) ou un pays. Admins scopés : verrouillés sur leur(s) pays. Toutes les pages "par pays" lisent/écrivent la config du pays choisi.

### 6.2 Pages existantes country-aware
Tarifs, Zones, Aéroports, Paiements, Financier, Features/Workflows, Dispatch, KYC docs :
- chargent `getForCountry(domaine, paysSélectionné)`
- bandeau **"Hérite du global"** + bouton **"Surcharger pour ce pays"** / **"Réinitialiser au global"**
- save → écrit `key:PAYS` (ou supprime l'override).

### 6.3 Hub "Pays" (nouvelle page, permission `manage_countries`)
- Liste des pays + statut + complétude config.
- Créer un pays (code ISO, nom, préfixe, devise, décimales, `pointFxRate`, drapeau) → `draft`.
- Checklist d'activation → bouton **Activer** débloqué quand tout ✓.
- Toggle `isDefault`. Action `suspendre`.

### 6.4 Stats par pays
Endpoints stats acceptent `?country=PAYS` (filtre `operatingCountry` / `countryCode`), piloté par le sélecteur :
- Pays sélectionné → KPIs/graphes du pays.
- **Global** → total agrégé **+ bloc comparatif par pays** (CA, courses, chauffeurs côte à côte).
Pages : Dashboard, Analytics, Monitoring.

### 6.5 Codes promo
Champ pays sur la page Promo (`Promo.countryCode`, vide = global).

## 7. App mobile

### 7.1 Inscription : téléphone obligatoire + sélecteur pays
Après vérif (SMS ou email), si profil incomplet → écran **"Finaliser l'inscription"** : téléphone (OTP) **+ sélecteur pays** pré-rempli depuis le préfixe, confirmé par l'utilisateur. Backend : guard `requireCompleteProfile` sur les routes booking → `PROFILE_INCOMPLETE` tant que le téléphone manque.

### 7.2 Accès par workflow (cross-border)
- ARRIVAL/DEPARTURE : exigent un pays opéré **physique** (aéroport GPS opéré).
- INTERNATIONAL : **ouvert à tous**, seule la **destination** doit être un pays opéré.
- Pays non opéré / `draft`/`suspended` → écran "service indisponible" (comportement `isCountrySupported` existant).

### 7.3 Bundle & affichage
`configStore` consomme `/config/bundle` : masque les paiements non dispo, cache les features off, applique devise + décimales locales. Langue de l'app = préférence **user** (inchangée) ; `Country.defaultLanguage` = fallback messages serveur.

### 7.4 Comptes legacy `null`
`countryCode = null` → repli `defaultCountry`. Prompt de finalisation au prochain lancement fixe le vrai pays.

## 8. Cas limites résolus

| # | Résolution |
|---|---|
| Suspension pays | Bookings `pending/scheduled/in_progress` finissent ; nouvelles réservations bloquées |
| Fraîcheur bundle | Backend re-valide à la réservation (source de vérité) ; `configVersion` → refetch au 1er plan |
| Format devise | `Country.currencyDecimals` + `Intl.NumberFormat` ; points entiers = unité de vérité |
| Garde defaultCountry | Invariant 1 seul `isDefault` + `FALLBACK_COUNTRY='CM'` + alerte si aucun pays actif |
| Dispatch cohérence | Le pool dispatch d'un aéroport ∈ `operatingCountry` ; chauffeur servant ≠ pays = exclu |

## 9. Migration (sûre par construction)

1. **Backfill `Country`** : `CM`/`CA`/`US` (ceux avec `tariffs_config:*`) → `active`, devise/`pointFxRate` depuis tariffs. `CM` `isDefault`.
2. **Cascade** : zéro override `key:PAYS` au départ → comportement actuel identique.
3. **Domaine par domaine** (1 PR/domaine) : Financier → Paiements → Workflows/Features → Dispatch → KYC + `vehicle_capacity`.
4. **`operatingCountry`** : déjà gelé sur les nouveaux ; anciens sans valeur → `defaultCountry` (historique RO).
5. **`commissionRate`** : nouveau champ, gelé sur les nouveaux bookings ; anciens → lecture depuis config (historique).
6. **Comptes `null`** (5 passagers / 8 chauffeurs) → `defaultCountry` jusqu'au prompt finalisation.
7. **RBAC** : `countryScope` défaut `[]` → admins actuels gardent l'accès total. Permission `manage_countries`.
8. **Téléphone obligatoire** : nouveaux signups ; comptes email existants sans téléphone → prompt au prochain lancement.

## 10. Hors scope (YAGNI / futur)

- Synchronisation automatique des taux de change (`pointFxRate` maintenu manuellement pour l'instant).
- TVA / facturation réglementaire / résidence des données par pays.
- "Cloner la config d'un pays existant" à l'onboarding (amélioration future).
- Wallet multi-soldes par pays (écarté au profit de l'ancrage universel).
- Régie publicitaire, etc. (hors sujet).

## 11. Découpage en sous-projets (ordre d'implémentation)

Le design est volumineux ; il s'implémente en **phases livrables indépendamment** :
1. **Fondation** : table `Country`, résolveur `getForCountry`, backfill, `reference_currency`. (zéro changement de comportement)
2. **Admin core** : sélecteur global + hub Pays + activation + RBAC `countryScope`.
3. **Domaine Financier** (commission gelée, cashback, frais, retraits) par pays + stats par pays.
4. **Domaine Paiements** (providers par pays, scopes marketplace/plateforme, recharge).
5. **Workflows/Features + Dispatch + KYC** par pays.
6. **App** : finalisation inscription (téléphone + sélecteur pays), bundle, accès par workflow.
7. **Wallet/monnaie** : points ancrés, décimales, changement pays chauffeur.

Chaque phase produit un logiciel fonctionnel ; chacune aura son propre plan → cycle spec→plan→implémentation.
