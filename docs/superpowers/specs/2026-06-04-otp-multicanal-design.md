# OTP multi-canal (SMS / WhatsApp / Email) + téléphone obligatoire — Design

**Date :** 2026-06-04
**Statut :** validé (design), à découper en plans d'implémentation
**Contexte :** suite de la config par pays. Comble le gap « comptes email → countryCode null » (Phase 6b) et ajoute le choix du canal d'envoi de l'OTP par l'utilisateur.

---

## 1. Objectif

1. **OTP multi-canal avec choix utilisateur** : l'OTP (login ET liaison de numéro) peut être envoyé par **SMS**, **WhatsApp** ou **Email**, l'utilisateur choisit.
2. **Téléphone obligatoire pour les comptes email** : un compte créé par email (ou Google) a `phone = null` / `countryCode = null`. On force la **vérification par OTP** d'un numéro avant de pouvoir **réserver** (blocage `PROFILE_INCOMPLETE`), ce qui renseigne aussi le pays.
3. **Config par pays (cascade)** : canaux activés, canal par défaut, provider WhatsApp et credentials sont résolus via `getForCountry(key, country, default)` — valeur globale de base + override par pays.

## 2. Existant (réutilisé)

- `OtpDeliveryService.sendOtp(contact, code, lang)` — choisit le canal selon l'AppSetting **global** `otp_channel` (`sms|email|both`). À étendre pour accepter un canal explicite + pays.
- `SmartSmsRouter` — providers SMS pluggables (mock, twilio, orange-cm, africas-talking), routage par préfixe via `sms_routing_rules` + `sms_default_provider`.
- `EmailRouterService` — providers email (mock, sendgrid, smtp) via `email_provider`.
- `PAS de WhatsApp`. Le canal n'est PAS choisi par l'utilisateur.
- OTP stocké dans Redis **par identifiant** : `otp:${phone}` (login tél), `otp:email:${email}` (login email). La vérification est donc **indépendante du canal de livraison**.
- `auth.service` : `sendOtp(phone)`, `verifyOtp(phone, code, role, referral)`, `sendEmailOtp(email)`, `verifyEmailOtp(...)`. Inscription **téléphone** pose `countryCode` ; inscription **email/Google** ne le pose pas.
- `users.service.updateProfile` pose déjà `phone` + `countryCode: extractCountryFromPhone(phone)` + vérifie l'unicité du numéro.

## 3. Architecture

Étendre l'existant (PAS de refonte). Nouveau module `whatsapp/` calqué sur `sms/`.

```
backend/src/
  whatsapp/                          (NOUVEAU)
    interfaces/whatsapp-provider.interface.ts   IWhatsAppProvider { name; send(to, message): Promise<boolean> }
    providers/ultramsg.provider.ts              Ultramsg API (instance + token)
    providers/mock-whatsapp.provider.ts         log only
    whatsapp.router.ts                          résout provider + creds via getForCountry, send(to, msg, country?)
    whatsapp.module.ts
  otp/
    otp-delivery.service.ts          (ÉTENDU) sendOtp(contact, code, lang, opts?: { channel?, country? })
    otp-channels.ts                  (NOUVEAU helper pur) availableChannels(account, enabledChannels) → Channel[]
```

`Channel = 'sms' | 'whatsapp' | 'email'`.

## 4. Résolution des canaux disponibles (cœur)

Au moment de l'envoi, on cherche le compte par l'identifiant saisi et on propose les canaux correspondant à **ses contacts connus**, intersectés avec les **canaux activés du pays**.

| Contact présent sur le compte | Canaux candidats |
|---|---|
| `phone` | `sms`, `whatsapp` |
| `email` | `email` |

Règles :
- **Login** par identifiant `X` : on charge le compte (par phone ou email = X). `candidats = union(contacts)`. Si X est un téléphone, `phone` existe forcément → sms/whatsapp ; si le compte a aussi un email → +email. Symétrique pour X = email.
- **Nouvelle inscription** (aucun compte) : identifiant téléphone → `[sms, whatsapp]` ; identifiant email → `[email]`.
- **Liaison de numéro** (compte authentifié, nouveau `phone`) : canaux = `[sms, whatsapp]` **uniquement** (l'OTP doit aller au NUMÉRO pour prouver la possession ; l'email ne le prouverait pas).
- Intersection finale avec `otp_channels_enabled` (du pays). Le `default` retourné = `otp_default_channel` (du pays) s'il est dans la liste, sinon le 1er disponible.
- Anti-énumération : pour un login, si aucun compte n'est trouvé, renvoyer le canal « naturel » de l'identifiant (tél→sms/whatsapp, email→email) sans révéler l'absence de compte.

Helper pur testable `availableChannels({ hasPhone, hasEmail, mode }, enabledChannels)`.

## 5. Endpoints (backend)

- `POST /auth/otp/channels` `{ identifier }` → `{ channels: Channel[], default: Channel }`. Public (pré-login). Résout le pays via préfixe du téléphone, sinon le pays par défaut.
- `POST /auth/otp/send` `{ identifier, channel? }` → envoie l'OTP via `channel` (ou défaut). Réutilise `sendOtp/sendEmailOtp` existants en passant le canal à `OtpDeliveryService`. Rétro-compatible : `channel` absent → comportement actuel (`otp_channel`).
- `POST /auth/phone/link/send` `{ phone, channel }` (auth JWT) → OTP stocké `otp:link:${userId}` (lié au userId + phone visé), envoyé au `phone` via sms/whatsapp.
- `POST /auth/phone/link/verify` `{ phone, code }` (auth JWT) → vérifie ; pose `phone` + `countryCode` (via la logique d'unicité de `updateProfile`). Renvoie le user mis à jour.
- `GET /auth/me` (ÉTENDU) → ajoute `countryCode` et un booléen `profileComplete` (= `phone != null`).

Verify de login inchangé (`/auth/otp/verify`, `/auth/otp/verify-email`) : la vérif reste par identifiant.

## 6. Blocage réservation (PROFILE_INCOMPLETE)

`bookings.service.createBooking` : au début, si le passager a `phone == null` → `throw new ForbiddenException({ code: 'PROFILE_INCOMPLETE', message: 'Vérifiez votre numéro de téléphone avant de réserver.' })`. L'app intercepte le code et ouvre l'écran de vérification.

## 7. Config par pays (cascade) + Admin

Clés (toutes via `getForCountry`, override `key:PAYS` → global → défaut) :

| Clé | Défaut | Sens |
|---|---|---|
| `otp_channels_enabled` | `sms,email` | canaux proposés (csv) |
| `otp_default_channel` | `sms` | canal pré-sélectionné |
| `whatsapp_provider` | `mock` | provider WhatsApp actif |
| `whatsapp_ultramsg_instance` | `''` | instance Ultramsg |
| `whatsapp_ultramsg_token` | `''` | token Ultramsg |

Credentials résolus comme les paiements (Phase 4) : `getForCountry(key, country) || env`. Webhook/secret non concernés (Ultramsg = envoi sortant simple).

Admin : section « Canaux OTP » (peut étendre la page providers SMS), avec le **sélecteur de pays** existant : cases canaux activés, canal par défaut, provider WhatsApp + creds. Écrit les clés scellées `key:PAYS` (ou globales si « Global » sélectionné).

## 8. Mobile (passager + chauffeur)

- **Écran OTP (login)** : après saisie de l'identifiant, appel `/auth/otp/channels` → afficher un **sélecteur de canal** (icônes SMS / WhatsApp / Email) limité aux canaux dispo, pré-sélection = `default` → `/auth/otp/send { identifier, channel }`. Un seul canal → pas de sélecteur (envoi direct).
- **Écran « Vérifiez votre numéro »** : déclenché par `PROFILE_INCOMPLETE` (ou accessible depuis le profil). Saisie numéro (sélecteur d'indicatif) → choix canal (sms/whatsapp) → `/auth/phone/link/send` → saisie code → `/auth/phone/link/verify` → numéro lié, pays renseigné.
- Le driver suit le même schéma (souvent tél-first, mais l'écran de liaison sert si compte email).
- Les changements mobiles sont livrés via **rebuild APK** (pas via commit, repos mobiles WIP).

## 9. Découpage en lots (implémentation)

1. **Lot 1 — Backend multi-canal** : module `whatsapp/` (Ultramsg + mock + router), `OtpDeliveryService` étendu (canal + pays), helper `availableChannels`, endpoints `/auth/otp/channels` et `/auth/otp/send` (canal), clés cascade. Déployable et rétro-compatible seul.
2. **Lot 2 — Liaison téléphone + blocage** : endpoints `/auth/phone/link/*`, garde `PROFILE_INCOMPLETE` dans `createBooking`, `/auth/me` étendu. Déployable seul.
3. **Lot 3 — Mobile + Admin** : sélecteur de canal + écran vérif (2 apps, rebuild APK) ; section admin « Canaux OTP » par pays.

Chaque lot a son propre plan d'implémentation.

## 10. Erreurs & cas limites

- Canal choisi non activé pour le pays → 400 (ou fallback silencieux au défaut — choisir : **400 explicite**).
- WhatsApp provider en échec → l'envoi renvoie `false` ; l'app affiche « échec d'envoi, essayez un autre canal ».
- Email login + canal sms/whatsapp mais compte sans téléphone → le canal n'aurait pas été proposé (résolution §4), donc ne devrait pas arriver ; si forcé → 400.
- Liaison : numéro déjà utilisé par un autre compte → 400 (logique `updateProfile` existante).
- Liaison : on n'écrase un `phone` existant que s'il est null (un compte avec téléphone vérifié ne le change pas via ce flux — passer par le support / un flux dédié).
- Rétro-compatibilité : sans `channel` ni override pays, tout retombe sur `otp_channel` global actuel → comportement inchangé.

## 11. Tests

- **Unit** : `availableChannels` (matrice contacts × canaux activés) ; `WhatsAppRouter.resolveProvider` (cascade pays→global→env) ; `OtpDeliveryService.sendOtp` route vers le bon canal.
- **E2E** : liaison téléphone (send→verify→phone+country posés) ; `PROFILE_INCOMPLETE` bloque la réservation puis passe après liaison.
- **Mock** par défaut (whatsapp_provider=mock) → tests sans appel externe.

## 12. Sécurité

- Téléphone = identifiant de login → la liaison **doit** être OTP-vérifiée (acquis).
- `/auth/otp/channels` ne doit pas révéler l'existence d'un compte (anti-énumération, §4).
- Rate-limit : réutiliser les limites OTP existantes (par numéro, par email, global) ; ajouter une limite sur `/auth/phone/link/send` par userId.
- Credentials WhatsApp jamais exposés à l'app ni renvoyés par l'API.
