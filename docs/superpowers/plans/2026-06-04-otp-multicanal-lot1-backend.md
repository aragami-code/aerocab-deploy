# OTP multi-canal — Lot 1 (Backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre l'envoi de l'OTP via un canal choisi (SMS / WhatsApp / Email), avec un provider WhatsApp (Ultramsg) et une résolution des canaux disponibles par compte — config par pays en cascade, rétro-compatible.

**Architecture :** Nouveau module `whatsapp/` calqué sur `sms/` (interface + providers pluggables + router à cascade `getForCountry`). `OtpDeliveryService` étendu pour accepter un canal explicite + pays. Helper pur `availableChannels`. Deux endpoints : `/auth/otp/channels` (liste les canaux d'un identifiant) et `/auth/otp/send` (envoie via canal choisi). OTP toujours stocké par identifiant → vérif inchangée.

**Tech Stack :** NestJS + Prisma, Jest. Provider WhatsApp via `fetch` (API HTTP Ultramsg).

**Spec :** `docs/superpowers/specs/2026-06-04-otp-multicanal-design.md` (§3,4,5,7,10,11).

**Working dir :** `/home/aragami/aerogo24V2/aerocab-deploy/backend` — branche `feat/config-par-pays`.

**Acquis (à réutiliser tels quels) :**
- `OtpDeliveryService.sendOtp(contact, code, lang)` lit `otp_channel` global, route SMS/email. Templates FR/EN inline.
- `SmartSmsRouter` (modèle du router). `ISmsProvider { name; send(to,msg) }`. `TwilioSmsProvider` (modèle de provider : creds `settings.get(...) || config.get(env)`).
- `SettingsService.getForCountry(key, country, default)` (cascade pays→global→default). `get(key, default)` global.
- `extractCountryFromPhone(phone)` dans `../common/phone-country`.
- `auth.service.sendOtp(phone, lang)` : génère code, stocke `otp:${phone}`, appelle `this.sms.sendOtp(phone, code, lang)` (this.sms = OtpDeliveryService). `sendEmailOtp(email, lang)` stocke `otp:email:${email}`.
- `auth.controller` : `POST otp/send` (SendOtpDto), `POST otp/send-email`. `SendOtpDto { phone; lang? }`.

**Convention git :** `git add <chemins exacts>` puis `git commit` (bare). JAMAIS `-A`/`.`. Safe-swap pour fichiers à WIP pré-existant (auth.service, auth.controller en ont — vérifier `git status` avant ; isoler via checkout HEAD + ré-application + restore). Commits de fichiers NEUFS (module whatsapp, helpers, specs de test) directs.

---

## File Structure

**Nouveau module WhatsApp**
- `src/whatsapp/interfaces/whatsapp-provider.interface.ts` — `IWhatsAppProvider { name; send(to, message): Promise<boolean> }`
- `src/whatsapp/providers/mock-whatsapp.provider.ts` — log only, retourne true
- `src/whatsapp/providers/ultramsg.provider.ts` — Ultramsg API (instance+token via getForCountry|env)
- `src/whatsapp/whatsapp.router.ts` — `send(to, message, country?)`, résout le provider via `whatsapp_provider` (cascade)
- `src/whatsapp/whatsapp.module.ts`

**OTP**
- `src/otp/otp-channels.ts` (NEUF) — helper pur `availableChannels(...)`
- `src/otp/otp-channels.spec.ts` (NEUF) — tests
- `src/otp/otp-delivery.service.ts` (MODIF) — canal explicite + WhatsApp + pays
- `src/otp/otp.module.ts` (MODIF) — importe WhatsAppModule

**Auth**
- `src/auth/dto/send-otp.dto.ts` (MODIF) — `channel?`
- `src/auth/auth.service.ts` (MODIF) — `sendOtp` propage le canal ; `getOtpChannels(identifier)`
- `src/auth/auth.controller.ts` (MODIF) — `POST otp/channels` ; `otp/send` propage `channel`

**Config public**
- `src/app.controller.ts` (MODIF) — exposer `otp_channels_enabled`, `otp_default_channel` dans `/config`

---

### Task 1 : Interface + providers WhatsApp (mock + Ultramsg)

**Files:** Create `src/whatsapp/interfaces/whatsapp-provider.interface.ts`, `src/whatsapp/providers/mock-whatsapp.provider.ts`, `src/whatsapp/providers/ultramsg.provider.ts`

- [ ] **Step 1 : Interface**

`src/whatsapp/interfaces/whatsapp-provider.interface.ts` :
```typescript
export interface IWhatsAppProvider {
  send(to: string, message: string): Promise<boolean>;
  readonly name: string;
}
```

- [ ] **Step 2 : Mock provider**

`src/whatsapp/providers/mock-whatsapp.provider.ts` :
```typescript
import { Injectable, Logger } from '@nestjs/common';
import { IWhatsAppProvider } from '../interfaces/whatsapp-provider.interface';

@Injectable()
export class MockWhatsAppProvider implements IWhatsAppProvider {
  readonly name = 'mock';
  private readonly logger = new Logger(MockWhatsAppProvider.name);

  async send(to: string, message: string): Promise<boolean> {
    this.logger.log(`[WhatsApp MOCK] → ${to.slice(0, 6)}*** : ${message.slice(0, 40)}...`);
    return true;
  }
}
```

- [ ] **Step 3 : Ultramsg provider** (creds par pays → global → env)

`src/whatsapp/providers/ultramsg.provider.ts` :
```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IWhatsAppProvider } from '../interfaces/whatsapp-provider.interface';
import { SettingsService } from '../../settings/settings.service';

@Injectable()
export class UltramsgProvider implements IWhatsAppProvider {
  readonly name = 'ultramsg';
  private readonly logger = new Logger(UltramsgProvider.name);

  constructor(
    private config: ConfigService,
    private settings: SettingsService,
  ) {}

  /** country threadé via un setter par appel (le router le fournit). */
  async sendForCountry(to: string, message: string, country: string | null): Promise<boolean> {
    const SENTINEL = ' ';
    const instDb  = await this.settings.getForCountry('whatsapp_ultramsg_instance', country, SENTINEL);
    const tokenDb = await this.settings.getForCountry('whatsapp_ultramsg_token', country, SENTINEL);
    const instance = (instDb !== SENTINEL && instDb) ? instDb : this.config.get<string>('ULTRAMSG_INSTANCE', '');
    const token    = (tokenDb !== SENTINEL && tokenDb) ? tokenDb : this.config.get<string>('ULTRAMSG_TOKEN', '');

    if (!instance || !token) {
      this.logger.error('Ultramsg credentials manquants (whatsapp_ultramsg_instance/token ou env)');
      return false;
    }
    // Ultramsg attend le numéro sans le '+'
    const phone = to.startsWith('+') ? to.slice(1) : to;
    try {
      const res = await fetch(`https://api.ultramsg.com/${instance}/messages/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token, to: phone, body: message }).toString(),
      });
      if (!res.ok) {
        this.logger.error(`Ultramsg error ${res.status}`);
        return false;
      }
      const data = await res.json() as any;
      // Ultramsg renvoie { sent: "true" } en succès
      if (data?.sent === 'true' || data?.sent === true) return true;
      this.logger.error(`Ultramsg refus: ${JSON.stringify(data).slice(0, 200)}`);
      return false;
    } catch (e: any) {
      this.logger.error(`Ultramsg send failed: ${e.message}`);
      return false;
    }
  }

  // Conforme à l'interface (sans pays = global)
  send(to: string, message: string): Promise<boolean> {
    return this.sendForCountry(to, message, null);
  }
}
```
NOTE : on garde `send()` conforme à l'interface + une variante `sendForCountry()` utilisée par le router pour passer le pays. VÉRIFIER que `fetch` global est dispo (Node 18+ — oui, le projet l'utilise déjà dans twilio.provider).

- [ ] **Step 4 : Compiler**

Run : `./node_modules/.bin/tsc --noEmit 2>&1 | grep -i "whatsapp" || echo "OK"`
Expected : `OK` (les fichiers ne sont pas encore référencés par un module — tsc isolé OK).

- [ ] **Step 5 : Commit** (fichiers neufs, commit direct)

`git add src/whatsapp/interfaces/whatsapp-provider.interface.ts src/whatsapp/providers/mock-whatsapp.provider.ts src/whatsapp/providers/ultramsg.provider.ts`
→ `feat(otp): providers WhatsApp (mock + Ultramsg)`.

---

### Task 2 : Router WhatsApp + module

**Files:** Create `src/whatsapp/whatsapp.router.ts`, `src/whatsapp/whatsapp.module.ts`

- [ ] **Step 1 : Router** (résout le provider via `whatsapp_provider` cascade)

`src/whatsapp/whatsapp.router.ts` :
```typescript
import { Injectable, Logger } from '@nestjs/common';
import { IWhatsAppProvider } from './interfaces/whatsapp-provider.interface';
import { MockWhatsAppProvider } from './providers/mock-whatsapp.provider';
import { UltramsgProvider } from './providers/ultramsg.provider';
import { SettingsService } from '../settings/settings.service';

@Injectable()
export class WhatsAppRouter {
  private readonly logger = new Logger(WhatsAppRouter.name);

  constructor(
    private readonly mock: MockWhatsAppProvider,
    private readonly ultramsg: UltramsgProvider,
    private readonly settings: SettingsService,
  ) {}

  async send(to: string, message: string, country: string | null = null): Promise<boolean> {
    const name = await this.settings.getForCountry('whatsapp_provider', country, 'mock');
    if (name === 'ultramsg') {
      this.logger.log(`WhatsApp via ultramsg → ${to.slice(0, 6)}***`);
      return this.ultramsg.sendForCountry(to, message, country);
    }
    if (name !== 'mock') {
      this.logger.warn(`whatsapp_provider inconnu '${name}' — fallback mock`);
    }
    return this.mock.send(to, message);
  }
}
```

- [ ] **Step 2 : Module**

`src/whatsapp/whatsapp.module.ts` :
```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MockWhatsAppProvider } from './providers/mock-whatsapp.provider';
import { UltramsgProvider } from './providers/ultramsg.provider';
import { WhatsAppRouter } from './whatsapp.router';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [ConfigModule, SettingsModule],
  providers: [MockWhatsAppProvider, UltramsgProvider, WhatsAppRouter],
  exports: [WhatsAppRouter],
})
export class WhatsAppModule {}
```

- [ ] **Step 3 : Compiler**

Run : `./node_modules/.bin/tsc --noEmit 2>&1 | grep -iE "whatsapp" || echo "OK"`
Expected : `OK`.

- [ ] **Step 4 : Commit**

`git add src/whatsapp/whatsapp.router.ts src/whatsapp/whatsapp.module.ts`
→ `feat(otp): WhatsAppRouter + module (provider par pays)`.

---

### Task 3 : Helper pur `availableChannels` (TDD)

**Files:** Create `src/otp/otp-channels.ts`, `src/otp/otp-channels.spec.ts`

- [ ] **Step 1 : Test (échec attendu)**

`src/otp/otp-channels.spec.ts` :
```typescript
import { availableChannels, Channel } from './otp-channels';

describe('availableChannels', () => {
  const all: Channel[] = ['sms', 'whatsapp', 'email'];

  it('compte avec téléphone seul → sms, whatsapp', () => {
    expect(availableChannels({ hasPhone: true, hasEmail: false, mode: 'login' }, all))
      .toEqual(['sms', 'whatsapp']);
  });
  it('compte avec email seul → email', () => {
    expect(availableChannels({ hasPhone: false, hasEmail: true, mode: 'login' }, all))
      .toEqual(['email']);
  });
  it('compte tél + email → sms, whatsapp, email', () => {
    expect(availableChannels({ hasPhone: true, hasEmail: true, mode: 'login' }, all))
      .toEqual(['sms', 'whatsapp', 'email']);
  });
  it('liaison (mode=link) ignore email même si présent', () => {
    expect(availableChannels({ hasPhone: true, hasEmail: true, mode: 'link' }, all))
      .toEqual(['sms', 'whatsapp']);
  });
  it('intersecte avec les canaux activés du pays', () => {
    expect(availableChannels({ hasPhone: true, hasEmail: true, mode: 'login' }, ['sms', 'email']))
      .toEqual(['sms', 'email']);
  });
  it('aucun canal activé pertinent → tableau vide', () => {
    expect(availableChannels({ hasPhone: false, hasEmail: true, mode: 'login' }, ['sms', 'whatsapp']))
      .toEqual([]);
  });
});
```

- [ ] **Step 2 : Lancer (échec)**

Run : `npx jest src/otp/otp-channels.spec.ts`
Expected : FAIL — module introuvable.

- [ ] **Step 3 : Implémenter**

`src/otp/otp-channels.ts` :
```typescript
export type Channel = 'sms' | 'whatsapp' | 'email';

export interface ChannelContext {
  hasPhone: boolean;
  hasEmail: boolean;
  mode: 'login' | 'link';
}

/**
 * Canaux candidats selon les contacts du compte, puis intersection avec les
 * canaux activés du pays. En mode 'link' (liaison de numéro), l'email est exclu
 * car il ne prouve pas la possession du numéro.
 */
export function availableChannels(ctx: ChannelContext, enabled: Channel[]): Channel[] {
  const candidates: Channel[] = [];
  if (ctx.hasPhone) { candidates.push('sms', 'whatsapp'); }
  if (ctx.mode !== 'link' && ctx.hasEmail) { candidates.push('email'); }
  return candidates.filter((c) => enabled.includes(c));
}
```

- [ ] **Step 4 : Lancer (succès)**

Run : `npx jest src/otp/otp-channels.spec.ts`
Expected : PASS (6 tests).

- [ ] **Step 5 : Commit**

`git add src/otp/otp-channels.ts src/otp/otp-channels.spec.ts`
→ `feat(otp): helper availableChannels (TDD)`.

---

### Task 4 : OtpDeliveryService — canal explicite + WhatsApp + pays

**Files:** Modify `src/otp/otp-delivery.service.ts`, `src/otp/otp.module.ts`

- [ ] **Step 1 : Injecter WhatsAppRouter + template WhatsApp**

READ `src/otp/otp-delivery.service.ts`. Dans la constante `TEMPLATES`, chaque locale a `{ sms, emailSubject, emailHtml }`. Ajouter un champ `whatsapp` réutilisant le texte SMS (même message). Pour `fr` et `en` :
```typescript
// dans TEMPLATES.fr.otp et TEMPLATES.en.otp, ajouter :
      whatsapp: 'AeroGo 24 — Votre code de vérification : {{code}}. Valide {{expiry}} min.', // (en: 'AeroGo 24 — Your verification code: {{code}}. Valid {{expiry}} min.')
```
Adapter le type de `TEMPLATES` (la signature inline `{ sms; emailSubject; emailHtml }` devient `{ sms; whatsapp; emailSubject; emailHtml }`).

Importer + injecter le router :
```typescript
import { WhatsAppRouter } from '../whatsapp/whatsapp.router';
// constructeur :
    private readonly whatsapp: WhatsAppRouter,
```

- [ ] **Step 2 : Signature `sendOtp` avec canal + pays**

Remplacer la signature et le corps de `sendOtp`. READ la méthode actuelle (lit `otp_channel` global). Nouvelle version :
```typescript
  async sendOtp(
    contact: string,
    code: string,
    lang = 'fr',
    opts: { channel?: 'sms' | 'whatsapp' | 'email'; country?: string | null } = {},
  ): Promise<boolean> {
    const country = opts.country ?? null;
    // Canal : explicite > défaut pays > otp_channel legacy global
    const channel = opts.channel
      ?? (await this.settings.getForCountry('otp_default_channel', country, ''))
      || (await this.settings.get('otp_channel', 'sms'));

    const expiryRaw = await this.settings.get('otp_expiry_minutes');
    const expiry = expiryRaw || '5';
    const locale = TEMPLATES[lang] ? lang : 'fr';
    const tpl = TEMPLATES[locale].otp;
    const vars = { code, expiry };
    const isEmail = contact.includes('@');

    if (channel === 'whatsapp') {
      if (isEmail) { this.logger.warn('canal whatsapp mais contact email'); return false; }
      return this.whatsapp.send(contact, renderTemplate(tpl.whatsapp, vars), country);
    }
    if (channel === 'email') {
      if (!isEmail) { this.logger.warn('canal email mais contact numéro'); return false; }
      return this.sendEmail(contact, tpl, vars);
    }
    // sms (défaut) — ou 'both' legacy : email si contact email sinon sms
    if (channel === 'both') {
      return isEmail ? this.sendEmail(contact, tpl, vars) : this.sendSms(contact, tpl, vars);
    }
    if (isEmail) { this.logger.warn('canal sms mais contact email'); return false; }
    return this.sendSms(contact, tpl, vars);
  }
```
Conserver `sendSms`/`sendEmail` privés. ADAPTER le type de `tpl` (inclut maintenant `whatsapp`).

- [ ] **Step 3 : Module importe WhatsAppModule**

`src/otp/otp.module.ts` : ajouter `import { WhatsAppModule } from '../whatsapp/whatsapp.module';` et l'ajouter à `imports: [SmsModule, EmailModule, WhatsAppModule, SettingsModule]`.

- [ ] **Step 4 : Compiler**

Run : `./node_modules/.bin/tsc --noEmit 2>&1 | grep -iE "otp-delivery|otp.module" || echo "OK"`
Expected : `OK`.

- [ ] **Step 5 : Commit** (fichiers à WIP éventuel — vérifier `git status src/otp/otp-delivery.service.ts` ; si WIP, safe-swap ; sinon direct)

`git add src/otp/otp-delivery.service.ts src/otp/otp.module.ts`
→ `feat(otp): OtpDeliveryService canal explicite + WhatsApp + pays`.

---

### Task 5 : auth.service — propager le canal + `getOtpChannels`

**Files:** Modify `src/auth/auth.service.ts`

- [ ] **Step 1 : `sendOtp` propage canal + pays**

READ `auth.service.sendOtp(phone, lang)` (vérifie l'appel `this.sms.sendOtp(phone, code, lang)`). Ajouter un param `channel?` et dériver le pays du numéro :
```typescript
  async sendOtp(phone: string, lang = 'fr', channel?: 'sms' | 'whatsapp' | 'email'): Promise<{ message: string; expiresIn: number }> {
    // ... (logique existante inchangée jusqu'à l'envoi) ...
    if (!isTestMode) {
      const country = extractCountryFromPhone(phone);
      const sent = await this.sms.sendOtp(phone, code, lang, { channel, country });
      if (!sent) throw new BadRequestException("Echec d'envoi du code. Reessayez.");
    }
    return { message: 'OTP envoye avec succes', expiresIn: OTP_TTL };
  }
```
VÉRIFIER : `extractCountryFromPhone` déjà importé (oui). NE PAS toucher au rate-limit / test mode. ADAPTER au code réel (le message d'erreur existant peut différer).

- [ ] **Step 2 : `sendEmailOtp` propage le canal**

Dans `sendEmailOtp(email, lang)`, l'envoi se fait via `this.email.send(...)` directement (pas OtpDeliveryService). Le laisser tel quel pour le canal email (déjà email). MAIS pour permettre l'envoi d'un OTP-email avec choix (cas login email → canal email), aucun changement requis ici. (Le cas « login email mais l'utilisateur choisit sms/whatsapp vers son numéro » est géré côté `getOtpChannels` + l'app appellera `otp/send` avec l'identifiant numéro — hors scope de cette méthode.) Documenter : pas de changement.

- [ ] **Step 3 : `getOtpChannels(identifier)`**

Ajouter une méthode qui calcule les canaux pour un identifiant (numéro ou email) :
```typescript
  async getOtpChannels(identifier: string): Promise<{ channels: string[]; default: string }> {
    const isEmail = identifier.includes('@');
    const country = isEmail ? null : extractCountryFromPhone(identifier);
    // Compte existant ?
    const account = isEmail
      ? await this.prisma.user.findFirst({ where: { email: identifier }, select: { phone: true, email: true } })
      : await this.prisma.user.findUnique({ where: { phone: identifier }, select: { phone: true, email: true } });

    // Anti-énumération : si pas de compte, on retombe sur les contacts de l'identifiant lui-même.
    const hasPhone = account ? !!account.phone : !isEmail;
    const hasEmail = account ? !!account.email : isEmail;

    const enabledRaw = await this.settingsService.getForCountry('otp_channels_enabled', country, 'sms,email');
    const enabled = enabledRaw.split(',').map((s) => s.trim()).filter(Boolean) as any[];

    const channels = availableChannels({ hasPhone, hasEmail, mode: 'login' }, enabled);
    const defRaw = await this.settingsService.getForCountry('otp_default_channel', country, '');
    const def = channels.includes(defRaw as any) ? defRaw : (channels[0] ?? 'sms');
    return { channels, default: def };
  }
```
VÉRIFIER : le nom du service settings injecté dans auth.service (`this.settings` — d'après le constructeur ; ADAPTER `this.settingsService`→`this.settings` selon le code réel). Importer `availableChannels` de `../otp/otp-channels`. Le `Channel`/`any` cast est acceptable ici.

- [ ] **Step 4 : Compiler**

Run : `./node_modules/.bin/tsc --noEmit 2>&1 | grep -i "auth.service" || echo "OK"`
Expected : `OK`.

- [ ] **Step 5 : Commit** (auth.service A du WIP → safe-swap obligatoire : checkout HEAD, ré-appliquer ces 2 changements, commit, restore WIP+changement)

→ `feat(otp): auth.service propage canal + getOtpChannels`.

---

### Task 6 : DTO + endpoints controller (`otp/channels`, `otp/send` canal)

**Files:** Modify `src/auth/dto/send-otp.dto.ts`, `src/auth/auth.controller.ts`

- [ ] **Step 1 : DTO `channel?`**

`src/auth/dto/send-otp.dto.ts` : ajouter
```typescript
  @IsOptional()
  @IsString()
  @IsIn(['sms', 'whatsapp', 'email'])
  channel?: 'sms' | 'whatsapp' | 'email';
```
(`IsIn`, `IsOptional`, `IsString` déjà importés).

- [ ] **Step 2 : Endpoint `otp/channels` + `otp/send` propage canal**

READ `auth.controller.ts`. Ajouter l'endpoint et propager le canal :
```typescript
  @Post('otp/channels')
  @HttpCode(200)
  @SkipThrottle()
  async otpChannels(@Body() body: { identifier: string }) {
    return this.authService.getOtpChannels(body.identifier);
  }
```
Et modifier `sendOtp` :
```typescript
  async sendOtp(@Body() dto: SendOtpDto) {
    return this.authService.sendOtp(dto.phone, dto.lang ?? 'fr', dto.channel);
  }
```
VÉRIFIER que `Post`, `HttpCode`, `SkipThrottle`, `Body` sont importés (oui).

- [ ] **Step 3 : Compiler**

Run : `./node_modules/.bin/tsc --noEmit 2>&1 | grep -iE "auth.controller|send-otp" || echo "OK"`
Expected : `OK`.

- [ ] **Step 4 : Commit** (auth.controller : vérifier WIP → safe-swap si besoin ; send-otp.dto probablement propre)

→ `feat(otp): endpoint otp/channels + canal sur otp/send`.

---

### Task 7 : Exposer la config OTP publique

**Files:** Modify `src/app.controller.ts`

- [ ] **Step 1 : Ajouter les clés publiques**

READ `app.controller.ts` `PUBLIC_SETTING_KEYS` (contient déjà `otp_channel`). Ajouter `'otp_channels_enabled'` et `'otp_default_channel'` à la liste. NE PAS exposer les creds Ultramsg.

- [ ] **Step 2 : Compiler**

Run : `./node_modules/.bin/tsc --noEmit 2>&1 | grep -i "app.controller" || echo "OK"`
Expected : `OK`.

- [ ] **Step 3 : Commit** (app.controller a du WIP éventuel → safe-swap si besoin)

→ `feat(otp): expose otp_channels_enabled + otp_default_channel dans /config`.

---

### Task 8 : Build, déploiement, validation

- [ ] **Step 1 : Suite Jest ciblée**

Run : `npx jest src/otp/otp-channels.spec.ts`
Expected : 6 PASS.

- [ ] **Step 2 : Déployer** (base64 → `qm guest exec`, VM `192.168.100.101` via jump `root@217.160.47.83`, projet `/home/ubuntu/aerocab-deploy`) : tout le dossier `src/whatsapp/`, `src/otp/otp-delivery.service.ts`, `src/otp/otp-channels.ts`, `src/otp/otp.module.ts`, `src/auth/auth.service.ts`, `src/auth/auth.controller.ts`, `src/auth/dto/send-otp.dto.ts`, `src/app.controller.ts`. Déployer les **versions working-tree** (WIP+changements). `docker compose build api && docker compose up -d api`.

- [ ] **Step 3 : Valider**
  - API `healthy` (`curl http://217.160.47.83:3000/api/health`).
  - `POST /api/auth/otp/channels {"identifier":"+237600000000"}` → `{ channels:[...], default:... }` (sans override pays : `otp_channels_enabled` global défaut `sms,email` → renvoie `["sms"]` pour un numéro sans email ; cohérent).
  - **Rétro-compat** : `POST /api/auth/otp/send {"phone":"+237...","lang":"fr"}` (sans `channel`) fonctionne comme avant (test mode si activé).
  - `whatsapp_provider` non configuré → reste `mock` (aucun envoi réel). Aucune régression sur l'OTP existant.

---

## Hors-scope (Lots 2 & 3)

- **Lot 2** : `/auth/phone/link/{send,verify}`, garde `PROFILE_INCOMPLETE` (createBooking), `/auth/me` étendu.
- **Lot 3** : mobile (sélecteur de canal + écran vérif, rebuild APK), admin (section « Canaux OTP » par pays).

## Self-Review (effectuée)

**Couverture spec Lot 1 :** module WhatsApp/Ultramsg (§3) → T1,T2 ✓ ; résolution canaux (§4) → T3 (helper) + T5 (getOtpChannels) ✓ ; endpoints `/auth/otp/channels` + `/auth/otp/send` canal (§5) → T5,T6 ✓ ; OtpDeliveryService canal+pays (§3) → T4 ✓ ; clés cascade + exposition (§7) → T4 (lecture), T7 (exposition) ✓ ; mock par défaut/tests (§11) → T3,T8 ✓. Lot 1 = backend seul, déployable, rétro-compatible.

**Rétro-compatibilité :** `sendOtp` sans `channel` → `otp_default_channel` (vide par défaut) → `otp_channel` legacy global → comportement actuel. `whatsapp_provider` défaut `mock`. Aucun override pays → tout global.

**Cohérence types :** `Channel='sms'|'whatsapp'|'email'`, `availableChannels(ctx, enabled)`, `WhatsAppRouter.send(to,msg,country?)`, `UltramsgProvider.sendForCountry`, `OtpDeliveryService.sendOtp(contact,code,lang,opts)`, `getOtpChannels(identifier)→{channels,default}` — cohérents entre tâches.

**Placeholders :** aucun ; les `VÉRIFIER`/`ADAPTER` pointent les noms réels (service settings dans auth, WIP/safe-swap, type TEMPLATES) avec instruction d'adapter.
