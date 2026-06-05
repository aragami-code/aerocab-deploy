# Assistant de configuration pays (wizard) + Feature Flags par pays — Design

**Date :** 2026-06-05
**Statut :** validé (design), à transformer en plan
**Contexte :** activer un pays exige 4 critères (`getReadiness` : currency, payment_methods, tariffs, operated_airports). Aujourd'hui chaque critère se configure dans une page séparée et l'admin ne sait pas où aller (ex. Sénégal bloqué « Manque : tariffs, operated_airports »). Objectif : un **assistant pas-à-pas** (tab-slide) qui guide l'admin de la création à l'activation, + rendre les **workflows et feature flags configurables par pays** (trou identifié : aucune UI per-country pour les workflows).

**Portée :** **UI admin uniquement**. Zéro changement backend — orchestration d'endpoints existants + écriture de clés scopées `key:CC` via `setKey` (pattern déjà éprouvé : canaux OTP, codes promo).

---

## 1. Briques backend réutilisées (toutes existantes)

| Besoin | Méthode admin API |
|---|---|
| Créer / lister pays | `createOperatedCountry(data)`, `listOperatedCountries()` |
| Complétude | `getCountryReadiness(code)` → `{ ready, missing[] }` |
| Activer | `activateCountry(code)` |
| Méthodes de paiement | `getCountryPaymentMethods(code)`, `setCountryPaymentMethods(code, methods)` |
| Tarifs | `getTariffsByCountry(code)`, `setTariffsByCountry(code, config)` |
| Aéroports | `getAirportsAdmin({ country })`, `setAirportOperated(id, isOperated)` |
| Clé scopée pays (workflows + avancé) | `setKey(key, value)` (`PATCH /admin/settings/key`, accepte `key:CC`), `getSettings()` (lecture) |

`getReadiness` (rappel) : `currency` (Country.currency), `payment_methods` (Country.paymentMethods ≥1), `tariffs` (`app_settings['tariffs_config:CC']` existe), `operated_airports` (≥1 airport `countryCode=CC, isOperated=true`).

## 2. Wizard — composant `CountryWizard.tsx`

Overlay plein écran. **Stepper** horizontal (numéros + ✓ quand l'étape est satisfaite, cliquable). **Slides** une par étape. Boutons Précédent / Suivant + Fermer.

### Mode
- **Création** : lancé par « Nouveau pays » → démarre à l'étape 1, `countryCode` connu après l'étape 1.
- **Complétion** : lancé par « Compléter » sur une ligne incomplète → charge l'état (pays, paiements, tarifs, aéroports, settings), calcule la complétude, marque ✓ les étapes satisfaites, **ouvre à la 1ère étape manquante**.

### Étapes

| # | Étape | Bloquante ? | Sauvegarde | Critère readiness |
|---|---|---|---|---|
| 1 | **Infos pays** : code (2 lettres), nom, devise, symbole, décimales, préfixe tél, drapeau | oui | `createOperatedCountry` (création) — édition pays existant : champs en lecture si déjà créé | currency |
| 2 | **Paiements** : éditeur de méthodes (id, label, icône), ≥1 | oui | `setCountryPaymentMethods(code, methods)` | payment_methods |
| 3 | **Tarification** : grille tarifaire (réutilise l'éditeur de TariffsPage) | oui | `setTariffsByCountry(code, config)` | tariffs |
| 4 | **Workflows** : cases Arrivée / Départ / International (défaut cochées) | non | `setKey('workflow_arrival_enabled:CC', 'true'|'false')` (×3) | — |
| 5 | **Aéroports opérés** : recherche des aéroports du pays, toggle « opéré » (≥1) | oui | `setAirportOperated(id, true)` | operated_airports |
| 6 | **Avancé (optionnel)** : sections repliables (voir §4). Vide = hérite du global, rempli = override `key:CC` | non | `setKey('<key>:CC', value)` par champ modifié | — |
| 7 | **Récap & Activation** : tableau des 4 critères (✓/✗ via `getCountryReadiness`), bouton **Activer** actif si `ready` | — | `activateCountry(code)` | → statut Actif |

### Logique d'avancement
- Après chaque sauvegarde réussie d'une étape : re-`getCountryReadiness(code)` → mettre à jour les ✓, puis **slide automatique** vers l'étape suivante.
- « Suivant » désactivé tant que le critère d'une étape **bloquante** (1,2,3,5) n'est pas satisfait. Étapes 4 et 6 toujours franchissables.
- Stepper : cliquer une étape = y aller (si l'étape précédente bloquante est satisfaite ; sinon désactivée).
- Fermeture en cours → l'état est déjà persisté étape par étape (pas de « brouillon » volatile). Réouvrir « Compléter » reprend où on en était.

### Lancement (depuis `PaysPage`)
- Bouton « Nouveau pays » → ouvre le wizard en mode création.
- Sur chaque ligne **non `active` / incomplète** : bouton **« Compléter »** → wizard en mode complétion sur ce pays.
- À la fermeture/activation → rafraîchir la liste + readiness.

## 3. Feature Flags par pays — `FeatureFlagsPage.tsx` (mise à niveau)

- Ajouter un **sélecteur de pays** (réutiliser `CountryContext`/`useCountry` ; valeur `'GLOBAL'` ou code). Bandeau indiquant le scope.
- Lecture : pour chaque flag, valeur résolue = `settings['key:CC'] ?? settings['key'] ?? défaut` (depuis `getSettings()`), recalculée au changement de pays.
- Écriture : `setKey('key:CC', value)` si pays sélectionné, sinon `setKey('key', value)`.
- Nouvelle **catégorie « Workflows »** : `workflow_arrival_enabled`, `workflow_departure_enabled`, `workflow_international_enabled` (en plus des `feature_*` existants).
- Indicateur visuel « override pays » vs « hérité du global ».

## 4. Étape « Avancé » — champs (chaque champ : placeholder = valeur globale actuelle ; vide = hérite ; rempli = override `key:CC`)

| Section | Clés |
|---|---|
| **Commission & frais** | `commission_rate_pct`, `commission_rate_vip_pct`, `cash_commission_block_threshold`, `registration_fee_deposit_pct` |
| **Dispatch** | `proximity_radius_km`, `min_driver_score`, `avg_driver_speed_kmh`, `dispatch_prelanding_limit`, `delayed_dispatch_default_wait_min`, `driver_pickup_buffer_min` |
| **Fidélité & bonus** | `first_ride_bonus_points`, `loyalty_bonus_points`, `loyalty_bonus_every_n_rides`, `late_cancel_refund_rate` |
| **KYC chauffeur** | `driver_document_config` (JSON — textarea, défaut = global, validation JSON avant save) |
| **Capacité véhicule** | `vehicle_capacity` (JSON — textarea, défaut = global) |
| **Retrait** | `min_withdrawal_amount` |

Sauvegarde : seuls les champs **modifiés/remplis** déclenchent un `setKey('<key>:CC', value)`. Un champ vidé qui avait un override → proposer un « réinitialiser au global » (optionnel : supprimer l'override = écrire la valeur globale, ou laisser tel quel — choix : bouton « réinitialiser » réécrit la valeur globale courante dans `key:CC`, simple et sans endpoint de suppression).

## 5. Réutilisation / composants

- `CountryWizard.tsx` (orchestrateur + stepper + état).
- Sous-composants d'étape : `StepInfos`, `StepPayments`, `StepTariffs`, `StepWorkflows`, `StepAirports`, `StepAdvanced`, `StepReview`.
- **Réutiliser** les éditeurs existants quand ils existent (méthodes de paiement de `PaysPage`, grille tarifaire de `TariffsPage`) — extraire en composant partagé si nécessaire, sans réécrire la logique.
- `setKey` admin API existe déjà (ajouté pour les canaux OTP).

## 6. Erreurs & cas limites

- Code pays déjà existant à l'étape 1 → message « pays déjà créé », passer en mode complétion.
- Échec d'une sauvegarde → toast d'erreur, rester sur l'étape (pas d'avancement).
- `activateCountry` renvoie 400 si incomplet (le backend re-vérifie) → afficher le `missing`, renvoyer l'admin à l'étape concernée.
- JSON invalide (KYC/capacité) → bloquer le save de la section avec message.
- Aéroports : si le pays n'a aucun aéroport en base → message « aucun aéroport pour ce pays » + lien vers la création d'aéroport (hors scope wizard) ; l'étape reste bloquante.
- Permissions : wizard + flags réservés à la permission de gestion pays/settings (`manage_countries` / `edit_settings` selon la page) via les guards existants.

## 7. Tests

- **Unit (logique pure)** : `resolveScopedSetting(settings, key, country, default)` (résolution `key:CC`→global→défaut) ; `firstMissingStep(readiness)` (mappe `missing[]` → index d'étape) ; `stepReady(step, readiness)`.
- **Composant** (si infra de test admin) : le stepper avance après une sauvegarde simulée ; « Suivant » bloqué si critère manquant.
- Manuel : créer un pays de zéro → activer ; compléter le Sénégal (ouvre à Tarification).

## 8. Hors-scope (volontaire)

- Aucune modification backend (tout existe).
- Création d'aéroports depuis le wizard (on se contente de toggler « opéré » sur des aéroports existants ; la création d'aéroport reste sa page).
- Éditeur visuel riche pour `driver_document_config` / `vehicle_capacity` (textarea JSON suffit pour l'instant).
- Suppression d'override (`DELETE key:CC`) — on réécrit la valeur globale à la place.

## 9. Découpage en lots

1. **Lot 1 — Feature Flags par pays** : sélecteur pays + catégorie Workflows + résolution/écriture `key:CC` dans `FeatureFlagsPage`. Petit, autonome, déployable (rebuild admin). Fournit aussi le helper `resolveScopedSetting` réutilisé par le wizard.
2. **Lot 2 — Wizard** : `CountryWizard.tsx` + étapes 1-7 + intégration `PaysPage` (boutons Nouveau/Compléter). Déployable (rebuild admin).

Chaque lot a son propre plan.
