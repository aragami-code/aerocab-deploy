# OTP multi-canal — Lot 3 (Mobile + Admin) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exposer le multi-canal OTP à l'utilisateur (sélecteur de canal au login) et finaliser le téléphone obligatoire (écran vérifié par OTP déclenché par `PROFILE_INCOMPLETE`), + configurer les canaux OTP par pays côté admin (canaux activés, défaut, provider WhatsApp/Ultramsg).

**Architecture :** Étend l'existant. **Admin** : section « Canaux OTP » dans `SettingsPage` (scopée par le sélecteur de pays existant) écrivant les clés `otp_channels_enabled`, `otp_default_channel`, `whatsapp_provider`, `whatsapp_ultramsg_instance`, `whatsapp_ultramsg_token` (globales ou `key:PAYS`). **Mobile** (passager + chauffeur) : `login`→`verify-otp` appellent `/auth/otp/channels` et affichent un sélecteur de canal ; `complete-profile.tsx` bascule de `updateProfile` (non vérifié) vers le flux `/auth/phone/link/{send,verify}` (OTP vérifié) ; l'erreur `PROFILE_INCOMPLETE` à la réservation route vers cet écran.

**Tech Stack :** React/Vite + Tailwind (admin), Expo/React Native + Zustand (mobile), NestJS (backend déjà livré Lots 1-2).

**Spec :** `docs/superpowers/specs/2026-06-03/2026-06-04-otp-multicanal-design.md` (§5,7,8).

**Working dirs :** admin `/home/aragami/aerogo24V2/aerocab-admin` ; mobile `/home/aragami/aerogo24V2/aerocab-native/aerocab-{passenger,driver}`. Backend déjà déployé (endpoints `/auth/otp/channels`, `/auth/otp/send {channel}`, `/auth/phone/link/{send,verify}`, `/auth/me.profileComplete`).

**Acquis backend (à consommer) :**
- `POST /auth/otp/channels { identifier }` → `{ channels: ('sms'|'whatsapp'|'email')[], default }`.
- `POST /auth/otp/send { phone, lang?, channel? }`.
- `POST /auth/phone/link/send { phone, channel('sms'|'whatsapp') }` (JWT) → `{ message, expiresIn }`.
- `POST /auth/phone/link/verify { phone, code }` (JWT) → user mis à jour (phone+countryCode).
- `GET /auth/me` → `{ ..., countryCode, profileComplete }`.
- Clés config par pays : `otp_channels_enabled` (csv défaut `sms,email`), `otp_default_channel`, `whatsapp_provider` (`mock`|`ultramsg`), `whatsapp_ultramsg_instance`, `whatsapp_ultramsg_token`.

**Convention git :** `git add <chemins exacts>` + commit bare. JAMAIS `-A`/`.`. Mobile : repos à WIP lourd → si un fichier modifié a du WIP non lié, NE PAS le committer entièrement ; laisser en working tree (ship via APK) OU safe-swap. Fichiers NEUFS : commit direct. ADMIN api.ts a du WIP (getAllCountries etc.) → laisser en working tree, ship via build.

> ⚠️ Mobile : effets visibles seulement après **rebuild APK** (T7). Pas de device connecté → installation à faire par l'utilisateur.

---

## File Structure

**Admin**
- `src/pages/SettingsPage.tsx` — **Modify** : section « Canaux OTP » (canaux activés, défaut, provider WhatsApp + creds Ultramsg) scopée pays
- `src/services/api.ts` — **Modify** (si besoin) : helpers de lecture/écriture des clés OTP scopées

**Mobile passager + chauffeur (mêmes changements dans les 2 apps)**
- `services/api.ts` — **Modify** : `getOtpChannels(identifier)`, `sendOtp(phone, channel?)`, `linkPhoneSend(token, phone, channel)`, `linkPhoneVerify(token, phone, code)`
- `components/ChannelPicker.tsx` — **Create** : sélecteur de canal (sms/whatsapp/email)
- `app/(auth)/login.tsx` — **Modify** : récupère les canaux, affiche le picker, passe le canal à sendOtp
- `app/(auth)/complete-profile.tsx` — **Modify** : flux OTP-vérifié (link send/verify) au lieu de updateProfile
- point d'interception `PROFILE_INCOMPLETE` (booking) → route vers `complete-profile`

---

### Task 1 : Admin — section « Canaux OTP » par pays

**Files:** Modify `src/pages/SettingsPage.tsx` (+ `src/services/api.ts` si besoin)

- [ ] **Step 1 : Lire l'existant**

READ `SettingsPage.tsx` : repérer (a) comment le pays courant est obtenu (`useCountry()` du `CountryContext`, valeur `'GLOBAL'` ou code), (b) comment les settings sont chargés/sauvés (il y a déjà `otpChannel`, providers twilio, règles SMS par pays — voir la fonction de save ~ligne 400), (c) le pattern d'écriture d'un setting scopé pays (clé `key:PAYS`). READ aussi `src/services/api.ts` pour les méthodes de get/set settings (ex: `getSettings`, `setSettings`, ou un endpoint `/admin/settings`).

- [ ] **Step 2 : État + UI de la section**

Ajouter dans le state du composant un bloc `otpConfig` :
```typescript
const [otpConfig, setOtpConfig] = useState({
  channelsEnabled: { sms: true, whatsapp: false, email: true },
  defaultChannel: 'sms',
  whatsappProvider: 'mock',
  ultramsgInstance: '',
  ultramsgToken: '',
});
```
Charger ces valeurs au montage depuis les settings résolus pour le pays courant (clés `otp_channels_enabled` csv → cases, `otp_default_channel`, `whatsapp_provider`, `whatsapp_ultramsg_instance`, `whatsapp_ultramsg_token`). Afficher une carte « Canaux OTP » : 3 cases à cocher (SMS / WhatsApp / Email), un select « Canal par défaut » (parmi les activés), un select « Provider WhatsApp » (mock/ultramsg) et 2 champs (instance, token) visibles si provider=ultramsg. Indiquer le pays scopé (réutiliser le bandeau pays existant de la page).

- [ ] **Step 3 : Sauvegarde scopée pays**

Au save, écrire les 5 clés via le même mécanisme que les autres settings de la page, en respectant le scope pays : si le sélecteur = un pays → écrire `otp_channels_enabled:CC` etc. ; si `GLOBAL` → écrire les clés globales. `otp_channels_enabled` = csv des cases cochées (ex: `sms,whatsapp,email`). VÉRIFIER que l'allowlist backend de l'endpoint de save autorise ces clés (cf. `settings.controller.ts` `setPaymentProviders`/`setSettings` — si une allowlist bloque les nouvelles clés, l'étendre côté backend : ajouter `otp_channels_enabled`, `otp_default_channel`, `whatsapp_provider`, `whatsapp_ultramsg_instance`, `whatsapp_ultramsg_token` à la liste autorisée, en respectant le scope `:PAYS`). Si modif backend nécessaire, la faire dans `backend/src/settings/settings.controller.ts` et la noter pour le déploiement T7.

- [ ] **Step 4 : Compiler**

Run (admin) : `npx tsc --noEmit 2>&1 | grep -iE "SettingsPage|services/api" || echo OK`
Expected : `OK`.

- [ ] **Step 5 : Commit**

`git add src/pages/SettingsPage.tsx` (+ api.ts seulement si propre ; sinon laisser en WT). Si backend modifié : commit séparé `feat(otp): allowlist clés canaux OTP par pays (settings)`. → `feat(otp): admin section Canaux OTP par pays`.

---

### Task 2 : Mobile passager — méthodes API

**Files:** Modify `aerocab-passenger/services/api.ts`

- [ ] **Step 1 : Ajouter les méthodes**

READ `services/api.ts` (passager) : le helper `request`/`sendOtp` existant (login l'appelle via `api.sendOtp(fullPhone)`). Ajouter/adapter :
```typescript
  async getOtpChannels(identifier: string) {
    return this.request<{ channels: ('sms'|'whatsapp'|'email')[]; default: string }>(
      `/auth/otp/channels`, { method: 'POST', body: { identifier } });
  },
  // étendre sendOtp pour accepter un canal optionnel
  async sendOtp(phone: string, channel?: 'sms'|'whatsapp'|'email') {
    return this.request(`/auth/otp/send`, { method: 'POST', body: { phone, ...(channel ? { channel } : {}) } });
  },
  async linkPhoneSend(token: string, phone: string, channel: 'sms'|'whatsapp') {
    return this.request(`/auth/phone/link/send`, { method: 'POST', token, body: { phone, channel } });
  },
  async linkPhoneVerify(token: string, phone: string, code: string) {
    return this.request(`/auth/phone/link/verify`, { method: 'POST', token, body: { phone, code } });
  },
```
ADAPTER à la signature réelle de `request` (forme `{ method, body, token }`) et au style (objet `api` vs classe). Préserver la rétro-compat de `sendOtp` (canal optionnel).

- [ ] **Step 2 : Compiler**

Run : `npx tsc --noEmit 2>&1 | grep -i "services/api" || echo OK`
Expected : `OK`.

- [ ] **Step 3 : Commit**

`git add services/api.ts` (si propre ; sinon WT). → `feat(otp): API client canaux + liaison téléphone (passager)`.

---

### Task 3 : Mobile passager — composant `ChannelPicker`

**Files:** Create `aerocab-passenger/components/ChannelPicker.tsx`

- [ ] **Step 1 : Composant**

READ un composant existant simple (ex: un bouton/segment) pour matcher le style. Créer un sélecteur contrôlé :
```tsx
import { View, Text, Pressable, StyleSheet } from 'react-native';

type Channel = 'sms' | 'whatsapp' | 'email';
const META: Record<Channel, { label: string; icon: string }> = {
  sms:      { label: 'SMS',      icon: '💬' },
  whatsapp: { label: 'WhatsApp', icon: '🟢' },
  email:    { label: 'Email',    icon: '✉️' },
};

export function ChannelPicker({ channels, value, onChange }: {
  channels: Channel[]; value: Channel; onChange: (c: Channel) => void;
}) {
  if (channels.length <= 1) return null; // un seul canal → pas de choix
  return (
    <View style={styles.row}>
      {channels.map((c) => (
        <Pressable key={c} onPress={() => onChange(c)}
          style={[styles.chip, value === c && styles.chipActive]}>
          <Text style={styles.icon}>{META[c].icon}</Text>
          <Text style={[styles.label, value === c && styles.labelActive]}>{META[c].label}</Text>
        </Pressable>
      ))}
    </View>
  );
}
const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8, marginVertical: 12 },
  chip: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0' },
  chipActive: { borderColor: '#1D2C4D', backgroundColor: '#1D2C4D10' },
  icon: { fontSize: 20 }, label: { fontSize: 12, color: '#64748b', marginTop: 4 },
  labelActive: { color: '#1D2C4D', fontWeight: '700' },
});
```
ADAPTER les couleurs au thème (réutiliser `COLORS` de `lib/shared` si présent).

- [ ] **Step 2 : Commit** (fichier neuf) → `git add components/ChannelPicker.tsx` → `feat(otp): composant ChannelPicker (passager)`.

---

### Task 4 : Mobile passager — login avec sélecteur de canal

**Files:** Modify `aerocab-passenger/app/(auth)/login.tsx`, `app/(auth)/verify-otp.tsx`

- [ ] **Step 1 : login → canaux + picker**

READ `login.tsx` autour de l'appel `await api.sendOtp(fullPhone)` (~ligne 361). Avant l'envoi : récupérer les canaux (`const { channels, default: def } = await api.getOtpChannels(fullPhone)`), stocker dans un state `channels`/`channel` (init `def`), afficher `<ChannelPicker channels={channels} value={channel} onChange={setChannel} />` près du bouton d'envoi, et envoyer avec le canal : `await api.sendOtp(fullPhone, channel)`. Passer le `channel` choisi à l'écran `verify-otp` (param de navigation) pour un éventuel renvoi. Gérer l'échec de `getOtpChannels` (fallback : ne pas bloquer, envoyer sans canal). VÉRIFIER le flux email s'il existe (login email) — si présent, même logique avec l'identifiant email.

- [ ] **Step 2 : verify-otp → renvoi sur le bon canal**

READ `verify-otp.tsx` : si un bouton « renvoyer le code » existe, le faire renvoyer via `api.sendOtp(phone, channel)` (canal reçu en param). Sinon, pas de changement.

- [ ] **Step 3 : Compiler** : `npx tsc --noEmit 2>&1 | grep -iE "login|verify-otp" || echo OK`. Expected `OK` (ignorer erreurs pré-existantes non liées).

- [ ] **Step 4 : Commit** (si propres ; sinon WT) → `feat(otp): sélecteur de canal au login (passager)`.

---

### Task 5 : Mobile passager — complete-profile OTP-vérifié + PROFILE_INCOMPLETE

**Files:** Modify `aerocab-passenger/app/(auth)/complete-profile.tsx` (+ le point d'appel booking)

- [ ] **Step 1 : Basculer complete-profile sur le flux vérifié**

READ `complete-profile.tsx` : il pose aujourd'hui le téléphone via `api.updateProfile(token, { phone })` (non vérifié), avec `loginViaEmail = !!email && !phone`. Le transformer en flux 2 étapes pour le cas `loginViaEmail` (téléphone obligatoire) :
1. saisie numéro + `<ChannelPicker channels={['sms','whatsapp']} ...>` → `api.linkPhoneSend(token, phone, channel)`.
2. saisie code → `api.linkPhoneVerify(token, phone, code)` → met à jour le user store avec le user renvoyé (phone+countryCode), puis navigue.
Conserver le reste de l'étape profil (nom, etc.) inchangé. Si le numéro n'est PAS obligatoire (compte téléphone classique), garder le comportement existant.

- [ ] **Step 2 : Interception PROFILE_INCOMPLETE à la réservation**

READ le code qui appelle la création de booking (probablement `summary.tsx` ou un store). Repérer le `catch` de l'appel `createBooking`. Si la réponse d'erreur contient `code === 'PROFILE_INCOMPLETE'` (le backend renvoie `{ code, message }` dans le body 403), router vers `complete-profile` (ex: `router.push('/(auth)/complete-profile')`) au lieu d'afficher une erreur générique. VÉRIFIER la forme de l'erreur remontée par le helper `request` (le body JSON 403 doit être accessible ; adapter l'extraction du `code`).

- [ ] **Step 3 : Compiler** : `npx tsc --noEmit 2>&1 | grep -iE "complete-profile|summary" || echo OK`. Expected `OK`.

- [ ] **Step 4 : Commit** (si propres ; sinon WT) → `feat(otp): liaison téléphone vérifiée + PROFILE_INCOMPLETE (passager)`.

---

### Task 6 : Mobile chauffeur — répliquer Tasks 2-5

**Files:** `aerocab-driver/services/api.ts`, `components/ChannelPicker.tsx`, `app/(auth)/login.tsx` (ou équivalent), `complete-profile`/équivalent, point booking.

- [ ] **Step 1 : Répliquer**

Reproduire Tasks 2-5 dans l'app chauffeur. VÉRIFIER les chemins réels (le driver peut avoir une structure d'auth différente — `app/(auth)/` ou `app/login.tsx`). Le driver est souvent tél-first : le sélecteur de canal au login s'applique pareil ; l'écran de liaison sert si un chauffeur s'est inscrit par email. ADAPTER aux conventions du driver. Si un écran n'existe pas (ex: pas de complete-profile chauffeur), créer un écran minimal de vérification numéro réutilisant le même flux link send/verify, déclenché par `PROFILE_INCOMPLETE`.

- [ ] **Step 2 : Compiler** (dans aerocab-driver) : `npx tsc --noEmit 2>&1 | grep -iE "api|login|profile|ChannelPicker" || echo OK`. Expected `OK`.

- [ ] **Step 3 : Commit** (fichiers neufs en direct ; modifs WIP en WT) → `feat(otp): canaux + liaison téléphone (chauffeur)`.

---

### Task 7 : Déploiement admin + backend (si modifié) + rebuild APK

- [ ] **Step 1 : Backend (si T1 a étendu l'allowlist)** : déployer `settings.controller.ts` (base64 → VM `192.168.100.101` via `root@217.160.47.83`, `/home/ubuntu/aerocab-deploy`), `docker compose build api && up -d api`. Valider health.
- [ ] **Step 2 : Admin** : transférer `src/pages/SettingsPage.tsx` (+ api.ts WT) vers `/home/ubuntu/aerocab-admin`, `docker compose build admin && up -d admin`. Vérifier le conteneur `aerocab_admin` Up.
- [ ] **Step 3 : Valider admin** : ouvrir Settings, sélectionner un pays, activer WhatsApp + défaut, saisir creds Ultramsg, sauver. Vérifier en DB : `SELECT key FROM app_settings WHERE key LIKE 'otp_channels_enabled%' OR key LIKE 'whatsapp_%';`. Puis `POST /auth/otp/channels {identifier:"+<num du pays>"}` doit refléter les canaux activés.
- [ ] **Step 4 : Rebuild APK** : `cd <app>/android && ./gradlew assembleRelease --no-daemon` (PAS clean), passager puis chauffeur. Installer via `adb install -r` si un device est connecté (sinon livrer les APK à l'utilisateur — pas de device attendu).

---

## Hors-scope (volontaire)

- **Affichage cross-border de INTERNATIONAL** (Phase 6b résiduel) — indépendant.
- **Durcissement `crypto.randomInt` des OTP legacy** (sendOtp/sendEmailOtp) — passe séparée recommandée.
- **Webhook/statut Ultramsg entrant** — non nécessaire (envoi sortant simple).

## Self-Review (effectuée)

**Couverture spec Lot 3 :** sélecteur de canal mobile (§8) → T3,T4,T6 ✓ ; écran liaison vérifiée + PROFILE_INCOMPLETE (§6,§8) → T5,T6 ✓ ; admin canaux OTP par pays + WhatsApp/Ultramsg (§7) → T1 ✓ ; consommation endpoints Lots 1-2 (§5) → T2,T6 ✓.

**Rétro-compatibilité :** `sendOtp(phone)` sans canal inchangé ; un seul canal dispo → `ChannelPicker` masqué (envoi direct) ; admin sans activer WhatsApp → `otp_channels_enabled` reste `sms,email`.

**Cohérence types :** `Channel='sms'|'whatsapp'|'email'`, `getOtpChannels(identifier)→{channels,default}`, `linkPhoneSend(token,phone,channel)`, `linkPhoneVerify(token,phone,code)`, `<ChannelPicker channels value onChange>` — cohérents avec le backend Lots 1-2.

**Placeholders :** aucun ; les `VÉRIFIER`/`ADAPTER` pointent les inconnues réelles (signature `request`, allowlist settings backend, structure auth du driver, forme de l'erreur PROFILE_INCOMPLETE) avec instruction d'adapter et de basculer en WT si WIP.
