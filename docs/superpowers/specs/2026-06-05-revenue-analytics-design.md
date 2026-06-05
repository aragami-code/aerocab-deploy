# Phase 4b — Dashboard Revenus / Compta centrale — Design

**Date :** 2026-06-05
**Statut :** validé (design), à transformer en plan d'implémentation
**Contexte :** dernier différé de la config par pays. Phase 4b initiale (paiements sensibles) réduite : #3 taux recharge par pays déjà fait (Phase 7), #1 « pas de commission marketplace » déjà le cas (aucun modèle Connect/marketplace ; frais plateforme = simples charges taguées), #2 webhook secrets par pays écarté (compte provider global). **Reste : le reporting de compta centrale** demandé par l'utilisateur — un dashboard admin qui distingue le revenu plateforme du revenu courses, par pays, avec graphes + analyses comparatives + insights.

**Portée :** pur **reporting/lecture**. Aucun changement de flux d'argent, de schéma transactionnel, ni de commission.

---

## 1. Sources de revenu (agrégation)

| Source | Catégorie | Donnée | Filtre | Pays via | Date via |
|---|---|---|---|---|---|
| Inscription chauffeur | Plateforme | `DriverRegistrationPayment.revenueAmount` | `status = 'paid'` | `driverProfile.countryCode` | `createdAt` |
| Pass d'accès | Plateforme | `Transaction.amount` | `metadata.type = 'access_pass'` ET `status = 'completed'` | `wallet.user.countryCode` | `Transaction.createdAt` |
| Commission courses | Courses | `Booking.estimatedPrice × COALESCE(commissionRate, taux par défaut)` | `status = 'completed'` | `Booking.operatingCountry` | `Booking.updatedAt` (fin de course) |

**Pays inconnu** (countryCode null) → regroupé sous une clé `UNKNOWN` (visible mais distinct).
**Taux commission par défaut** : si `Booking.commissionRate` est null (anciennes courses), utiliser `getForCountry('commission_rate', operatingCountry, '0.15')` (le défaut existant). Documenté pour cohérence historique.

## 2. Devises & consolidation

- Chaque pays a sa devise (`Country.currency`, fallback `XAF`). Les montants agrégés sont **en devise locale**.
- **Total consolidé** : convertir chaque pays vers la devise de référence via `ExchangeRateService.toBase(amount, fromCurrency)` (BASE_CURRENCY existant). Le taux utilisé est mentionné dans la réponse (`baseCurrency` + `ratesUsed`).
- Affichage : tableau par pays en devise locale + ligne/carte « total consolidé » en devise de référence avec mention du taux.

## 3. Backend — endpoint

`GET /admin/revenue` (gardé `@RequirePermission('view_analytics')` ou la permission analytics existante ; sinon `@Roles('admin')`).

**Query params :** `from` (ISO date, défaut début du mois courant), `to` (ISO, défaut maintenant), `granularity` (`range` | `monthly`, défaut `range`).

**Réponse :**
```jsonc
{
  "period": { "from": "...", "to": "...", "granularity": "range" },
  "baseCurrency": "XAF",
  "byCountry": [
    { "country": "CM", "currency": "XAF",
      "platform": { "registration": 120000, "accessPass": 30000, "total": 150000 },
      "rides":    { "commission": 340000, "total": 340000 },
      "grandLocal": 490000,
      "grandBase": 490000 }            // converti en baseCurrency
  ],
  "consolidated": { "baseCurrency": "XAF", "platform": 150000, "rides": 340000, "total": 490000 },
  "timeseries": [ { "month": "2026-05", "platform": 130000, "rides": 300000 } ],  // en baseCurrency
  "comparison": {                       // période précédente de même durée
    "platform": { "current": 150000, "previous": 134000, "deltaPct": 11.9 },
    "rides":    { "current": 340000, "previous": 360000, "deltaPct": -5.6 },
    "total":    { "current": 490000, "previous": 494000, "deltaPct": -0.8 }
  },
  "insights": [
    { "type": "concentration", "level": "info", "text": "CM représente 78% du revenu total." },
    { "type": "growth_platform", "level": "good", "text": "Revenu plateforme +12% vs période précédente." },
    { "type": "drop_rides", "level": "warn", "text": "Courses −15% au CM vs période précédente." }
  ]
}
```

**Module backend :** nouveau `src/analytics/revenue.service.ts` + `revenue.controller.ts` (ou étendre un module admin/analytics existant si présent). Le service expose :
- `getRevenue(from, to, granularity)` — orchestration.
- Méthodes pures testables : agrégation par source, `buildInsights(byCountry, comparison)` (règles déterministes), `buildTimeseries(rows)`.

**Performances :** requêtes SQL agrégées (`groupBy` Prisma ou `$queryRaw`) — PAS de boucle N+1. 3 requêtes (registration, pass, commission) × 2 (période courante + précédente) + timeseries. Index existants suffisent (`Booking.status`, etc.).

## 4. Insights (règles déterministes — PAS d'IA)

Calculés depuis les agrégats :
1. **Concentration** : pays au plus gros revenu et sa part % du total consolidé.
2. **Croissance plateforme / courses / total** : `deltaPct` vs période précédente → `good` si >0, `warn` si <−10%.
3. **Mix** : part plateforme vs courses (`platform/total %`).
4. **Alerte baisse** : tout pays dont les courses ou la plateforme baissent >15% vs période précédente.
5. **Top / bottom** : pays le plus et le moins performant sur la période.
Chaque insight = `{ type, level: 'good'|'info'|'warn', text }`. Seuils configurables en constantes.

## 5. Admin — page `RevenuePage.tsx` (recharts, déjà dans le projet)

Entrée sidebar « Revenus ». Composée de :
- **Contrôles période** : raccourcis (Ce mois / Mois dernier / Cette année / Cumul) + plage perso (2 date inputs) + bascule granularité (Plage / Mensuel).
- **Cartes KPI** (4) : Total Plateforme · Total Courses · **Grand total consolidé** (devise réf.) · Croissance % vs période précédente (flèche ↑/↓ colorée).
- **Graphes recharts** :
  1. **Tendance** (AreaChart mensuel empilé : Plateforme vs Courses) — visible surtout en granularité mensuelle / cumul.
  2. **Répartition** (PieChart/donut : Plateforme vs Courses).
  3. **Comparaison par pays** (BarChart : un groupe par pays, barres plateforme+courses).
  4. **Actuel vs précédent** (BarChart comparatif : période courante vs précédente, par catégorie).
- **Tableau par pays** : colonnes Pays · Plateforme (inscription / pass) · Courses · Total (devise locale) · Total (devise réf.). Ligne finale **Total consolidé**.
- **Panneau « Analyses & propositions »** : liste des `insights` avec icône selon `level`.
- **Export CSV** : bouton qui exporte `byCountry` + consolidated (client-side, depuis les données déjà chargées).

**Sélecteur pays global** (`CountryContext`) : cette page est **multi-pays par nature** ; elle **ignore** le sélecteur global (affiche tous les pays) OU propose son propre filtre pays optionnel. Choix : ignorer le sélecteur global, ajouter un filtre pays local optionnel (multi-select) au-dessus du tableau.

**api.ts admin :** `getRevenue({ from, to, granularity })`.

## 6. Permissions / RBAC

Endpoint réservé aux admins ayant la permission analytics (réutiliser `view_analytics` / `view_metrics` existante via `@RequirePermission`). Entrée sidebar visible selon la même permission (hook `Can` existant).

## 7. Erreurs & cas limites

- Aucune donnée sur la période → tableau vide + KPI à 0 + message « Aucun revenu sur cette période » (pas d'erreur).
- Période précédente inexistante (avant lancement) → `previous = 0`, `deltaPct = null` (afficher « — » au lieu d'un %).
- Devise d'un pays absente de la table FX → fallback : exclure du consolidé + insight `warn` « taux indisponible pour {devise} ».
- `from > to` → 400.
- Montants : arrondis à l'entier pour XAF/devises 0-décimale, 2 décimales sinon (réutiliser `currencyDecimals` du pays).

## 8. Tests

- **Unit (backend)** : `buildInsights` (matrice de cas : concentration, croissances, baisses, mix) ; agrégation par source (mock Prisma) ; `buildTimeseries` (buckets mensuels corrects, mois vides à 0).
- **Unit** : consolidation multi-devise (mock ExchangeRateService) — somme correcte, taux indisponible géré.
- **E2E léger** : `GET /admin/revenue` sur données seedées → structure de réponse correcte, total = somme des sources.

## 9. Hors-scope (volontaire)

- Modification de flux d'argent / commission / schéma (pur reporting).
- Webhook secrets par pays (#2 écarté — compte provider global).
- Export comptable formaté (PDF facture, intégration logiciel compta) — CSV suffit pour l'instant.
- Prévisions / ML — les insights sont des règles déterministes.

## 10. Découpage en lots

1. **Lot 1 — Backend** : module revenue (service agrégation + insights + timeseries + consolidation), endpoint `GET /admin/revenue`, tests unitaires, déploiement. Vérifiable via curl.
2. **Lot 2 — Admin UI** : page RevenuePage (contrôles, KPI, 4 graphes, tableau, insights, CSV), entrée sidebar, api.ts, déploiement (rebuild admin).

Chaque lot a son propre plan.
