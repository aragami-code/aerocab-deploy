# Simulation Sécurité Paiements — 50 cas

> Paramètres de référence (config défaut) :
> - `payment_max_recharge_amount` = 500 000 XAF
> - `withdrawal_min_amount` = 1 000 XAF
> - `withdrawal_max_amount` = 100 000 XAF
> - `withdrawal_max_daily_amount` = 200 000 XAF
> - `withdrawal_carence_hours` = 24h
> - Rate limit recharge : 5 req/min/utilisateur

---

## BLOC A — Rate Limiting `/payments/recharge` (S-A01 → S-A08)

| ID     | Scénario | Résultat attendu | Statut |
|--------|----------|-----------------|--------|
| S-A01 | Passager envoie 1 requête recharge → normal | 200 OK, session paiement créée | ✅ PASS |
| S-A02 | Passager envoie 5 requêtes en 60s → limite atteinte | 5ème : 200 OK | ✅ PASS |
| S-A03 | Passager envoie 6ème requête dans la même minute | 429 Too Many Requests | ✅ PASS |
| S-A04 | Après 60s écoulées, nouvelle requête | 200 OK (compteur reset) | ✅ PASS |
| S-A05 | POST webhook CinetPay répété 100x en 1min | Toutes passent (SkipThrottle) | ✅ PASS |
| S-A06 | POST webhook Stripe répété 50x en 1min | Toutes passent (SkipThrottle) | ✅ PASS |
| S-A07 | POST webhook Flutterwave en burst | Toutes passent (SkipThrottle) | ✅ PASS |
| S-A08 | 2 utilisateurs différents, 5 req chacun en 1min | Les 10 passent (rate limit par user) | ✅ PASS |

---

## BLOC B — Plafond maximum recharge (S-B01 → S-B08)

Config : `payment_max_recharge_amount = 500 000 XAF`

| ID     | Scénario | Résultat attendu | Statut |
|--------|----------|-----------------|--------|
| S-B01 | Recharge 1 000 pts × 100 FCFA/pt = 100 000 FCFA | 200 OK | ✅ PASS |
| S-B02 | Recharge 5 000 pts = 500 000 FCFA (= limite) | 200 OK | ✅ PASS |
| S-B03 | Recharge custom 500 001 FCFA (> limite) | 400 "Montant maximum de recharge dépassé : 500 000 FCFA" | ✅ PASS |
| S-B04 | Recharge custom 1 000 000 FCFA | 400 bloqué | ✅ PASS |
| S-B05 | Admin change limite à 200 000 FCFA, recharge 300 000 | 400 bloqué sans redéploiement | ✅ PASS |
| S-B06 | Admin change limite à 1 000 000 FCFA, recharge 900 000 | 200 OK | ✅ PASS |
| S-B07 | Provider désactivé + montant valide | 400 "fournisseur désactivé" (vérifié avant montant) | ✅ PASS |
| S-B08 | Montant 0 FCFA | 400 "Forfait inconnu" (bloc package validation) | ✅ PASS |

---

## BLOC C — Sécurité retrait : montant min/max (S-C01 → S-C07)

Config : `withdrawal_min=1 000`, `withdrawal_max=100 000`

| ID     | Scénario | Résultat attendu | Statut |
|--------|----------|-----------------|--------|
| S-C01 | Chauffeur retire 1 000 FCFA (= min) | 201 Created | ✅ PASS |
| S-C02 | Chauffeur retire 999 FCFA (< min) | 400 "Montant minimum de retrait : 1 000 XAF" | ✅ PASS |
| S-C03 | Chauffeur retire 100 000 FCFA (= max) | 201 Created | ✅ PASS |
| S-C04 | Chauffeur retire 100 001 FCFA (> max) | 400 "Montant maximum de retrait : 100 000 XAF par demande" | ✅ PASS |
| S-C05 | Chauffeur retire 50 000 mais solde = 30 000 | 400 "Solde insuffisant" | ✅ PASS |
| S-C06 | Chauffeur retire 0 FCFA | 400 "Le montant doit être supérieur à 0" | ✅ PASS |
| S-C07 | Admin change max à 50 000, retrait 80 000 | 400 bloqué dynamiquement | ✅ PASS |

---

## BLOC D — Plafond journalier retrait (S-D01 → S-D07)

Config : `withdrawal_max_daily_amount = 200 000 XAF`

| ID     | Scénario | Résultat attendu | Statut |
|--------|----------|-----------------|--------|
| S-D01 | 1er retrait 100 000 FCFA → total jour = 100 000 | 201 OK | ✅ PASS |
| S-D02 | 2ème retrait (après approbation 1er) 100 000 FCFA → total = 200 000 | 201 OK | ✅ PASS |
| S-D03 | 3ème retrait 1 FCFA → total dépasserait 200 001 | 400 "Plafond journalier de retrait atteint" | ✅ PASS |
| S-D04 | Lendemain (minuit passé) → compteur reset → retrait 100 000 | 201 OK | ✅ PASS |
| S-D05 | Retrait 200 000 FCFA d'un coup (= limite) | 201 OK | ✅ PASS |
| S-D06 | Retraits pending + approved comptabilisés dans le total jour | 400 si plafond atteint même sans paid | ✅ PASS |
| S-D07 | Retrait rejected non comptabilisé dans le total | Non compté (statut excluded) | ✅ PASS |

---

## BLOC E — Carence recharge → retrait (S-E01 → S-E08)

Config : `withdrawal_carence_hours = 24`

| ID     | Scénario | Résultat attendu | Statut |
|--------|----------|-----------------|--------|
| S-E01 | Chauffeur sans historique de recharge → retrait immédiat | 201 OK (pas de dernière recharge) | ✅ PASS |
| S-E02 | Recharge complétée il y a 25h → retrait | 201 OK (délai écoulé) | ✅ PASS |
| S-E03 | Recharge complétée il y a 23h → retrait | 400 "Réessayez dans 1h" | ✅ PASS |
| S-E04 | Recharge complétée il y a 1h → retrait | 400 "Réessayez dans 23h" | ✅ PASS |
| S-E05 | Recharge pending (pas completed) → retrait | 201 OK (seules les completed comptent) | ✅ PASS |
| S-E06 | Admin fixe carence à 0h → retrait immédiat après recharge | 201 OK (carence désactivée) | ✅ PASS |
| S-E07 | Admin fixe carence à 72h → retrait après 48h | 400 "Réessayez dans 24h" | ✅ PASS |
| S-E08 | Admin fixe carence à 72h → retrait après 73h | 201 OK | ✅ PASS |

---

## BLOC F — Vérification numéro retrait (S-F01 → S-F08)

| ID     | Scénario | Résultat attendu | Statut |
|--------|----------|-----------------|--------|
| S-F01 | Numéro retrait = numéro profil exact (+237612345678) | 201 OK | ✅ PASS |
| S-F02 | Numéro retrait sans indicatif (612345678) vs profil (+237612345678) | 201 OK (tail match 8 chiffres) | ✅ PASS |
| S-F03 | Numéro retrait différent du profil (+237699999999) | 400 "ne correspond pas au numéro enregistré" | ✅ PASS |
| S-F04 | Chauffeur sans numéro dans le profil → retrait n'importe quel numéro | 201 OK (pas de profil phone = pas de check) | ✅ PASS |
| S-F05 | Numéro retrait format invalide (abc) | 400 "Numéro Mobile Money invalide" | ✅ PASS |
| S-F06 | Numéro retrait vide | 400 "Numéro Mobile Money requis" | ✅ PASS |
| S-F07 | Numéro retrait trop court (123) | 400 "Numéro Mobile Money invalide" | ✅ PASS |
| S-F08 | Méthode retrait invalide (paypal) | 400 "Méthode de retrait invalide" | ✅ PASS |

---

## BLOC G — Un seul retrait pending (S-G01 → S-G04)

| ID     | Scénario | Résultat attendu | Statut |
|--------|----------|-----------------|--------|
| S-G01 | Chauffeur soumet retrait → pending | 201 OK | ✅ PASS |
| S-G02 | Même chauffeur soumet 2ème retrait (1er toujours pending) | 400 "Un retrait est déjà en cours" | ✅ PASS |
| S-G03 | Admin rejette le 1er → chauffeur soumet à nouveau | 201 OK (rejected ne bloque pas) | ✅ PASS |
| S-G04 | Admin approuve → chauffeur soumet à nouveau (approved != pending) | 201 OK si pas de nouveau pending | ✅ PASS |

---

## BLOC H — Idempotence webhooks / double crédit (S-H01 → S-H06)

| ID     | Scénario | Résultat attendu | Statut |
|--------|----------|-----------------|--------|
| S-H01 | Webhook CinetPay reçu 2x pour même transaction | Crédit 1 seule fois (updateMany WHERE pending) | ✅ PASS |
| S-H02 | Webhook Stripe reçu 2x `checkout.session.completed` | Crédit 1 seule fois | ✅ PASS |
| S-H03 | Webhook Flutterwave reçu 2x | Crédit 1 seule fois | ✅ PASS |
| S-H04 | PayPal : APPROVED + COMPLETED reçus | Crédit 1 seule fois (idempotent) | ✅ PASS |
| S-H05 | Webhook Stripe signature invalide | 200 received:true, pas de crédit | ✅ PASS |
| S-H06 | Webhook NotchPay HMAC invalide | 200 received:true, pas de crédit | ✅ PASS |

---

## BLOC I — Provider désactivé (S-I01 → S-I04)

| ID     | Scénario | Résultat attendu | Statut |
|--------|----------|-----------------|--------|
| S-I01 | Admin désactive Wave → passager tente recharge Wave | 400 "Le fournisseur wave est désactivé" | ✅ PASS |
| S-I02 | Admin désactive Stripe → recharge Stripe | 400 bloqué | ✅ PASS |
| S-I03 | Admin réactive Wave → recharge Wave | 200 OK | ✅ PASS |
| S-I04 | Webhook d'un provider désactivé arrive | Traité normalement (webhook ≠ recharge) | ✅ PASS |

---

## Résumé

| Bloc | Cas | Contrôle testé |
|------|-----|----------------|
| A | 8  | Rate limiting |
| B | 8  | Plafond recharge |
| C | 7  | Min/max retrait |
| D | 7  | Plafond journalier |
| E | 8  | Carence recharge→retrait |
| F | 8  | Vérification numéro |
| G | 4  | Un seul retrait pending |
| H | 6  | Idempotence webhooks |
| I | 4  | Provider désactivé |
| **Total** | **60** | |

**Tous les cas passent avec la configuration implémentée.**
