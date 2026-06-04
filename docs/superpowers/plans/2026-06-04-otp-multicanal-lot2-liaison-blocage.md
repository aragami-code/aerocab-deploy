# OTP multi-canal — Lot 2 (Liaison téléphone + blocage réservation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre à un compte (email/Google sans téléphone) de **lier un numéro vérifié par OTP** (sms/whatsapp), et **bloquer la réservation** tant que le numéro n'est pas renseigné (`PROFILE_INCOMPLETE`). Expose `profileComplete` dans `/auth/me`.

**Architecture :** Deux endpoints authentifiés `/auth/phone/link/{send,verify}` réutilisant `OtpDeliveryService` (Lot 1, canal sms/whatsapp). L'OTP est stocké `otp:link:${userId}` lié au numéro visé ; à la vérif on pose `phone` + `countryCode` (unicité). Garde dans `createBooking` : passager sans `phone` → 403 `PROFILE_INCOMPLETE`.

**Tech Stack :** NestJS + Prisma, Redis, Jest.

**Spec :** `docs/superpowers/specs/2026-06-04-otp-multicanal-design.md` (§5 link, §6 blocage, §10 cas limites, §12 sécurité).

**Working dir :** `/home/aragami/aerogo24V2/aerocab-deploy/backend` — branche `feat/config-par-pays`.

**Acquis (Lot 1 + existant) :**
- `OtpDeliveryService.sendOtp(contact, code, lang, { channel, country })` (Lot 1).
- `auth.service` : pattern `verifyOtp` (clé Redis `otp:${phone}`, `{ code, attempts }`, max 3 essais), `getMe(userId)` (select { id, phone, name, email, role, status, avatarUrl, language, createdAt }). Champs : `this.redis`, `this.prisma`, `this.settings`, `this.sms` (=OtpDeliveryService). `extractCountryFromPhone` importé. `OTP_TTL`, `OTP_RATE_LIMIT_MAX` constantes.
- `users.service.updateProfile` : logique d'unicité du numéro + `countryCode: extractCountryFromPhone(phone)`.
- `auth.controller` : endpoints authentifiés via `@UseGuards(JwtAuthGuard)` + `@CurrentUser('id') userId`. `ChannelsLookupDto` ajouté (Lot 1).
- `bookings.service.createBooking(passengerId, dto)` : `ForbiddenException` importé ; début = validations vehicleType/paymentMethod (~ligne 424).

**Convention git :** `git add <chemins exacts>` puis `git commit` bare. JAMAIS `-A`/`.`. **auth.service.ts ET bookings.service.ts ont du WIP** → safe-swap obligatoire (checkout HEAD, ré-appliquer, commit isolé, restore WIP). DTOs + auth.controller = fichiers neufs/propres → commit direct (vérifier `git status`).

**Sécurité (intégrée, pour éviter les findings de revue) :** verify = max 3 essais (comme verifyOtp). send = rate-limit Redis par userId + `@Throttle`. Unicité numéro (pas déjà pris). On ne lie un numéro que si `user.phone` est actuellement `null` (un compte avec numéro vérifié ne le change pas ici). Canal limité à sms/whatsapp.

---

## File Structure

- `src/auth/dto/link-phone.dto.ts` (NEUF) — `LinkPhoneSendDto { phone; channel? }`, `LinkPhoneVerifyDto { phone; code }`
- `src/auth/dto/index.ts` (MODIF) — exporte les 2 DTOs
- `src/auth/phone-link.ts` (NEUF) + `.spec.ts` — helper pur `phoneLinkAllowed(currentPhone)` (TDD)
- `src/auth/auth.service.ts` (MODIF, WIP→safe-swap) — `sendPhoneLinkOtp`, `verifyPhoneLink`, `getMe` étendu
- `src/auth/auth.controller.ts` (MODIF, propre) — 2 endpoints
- `src/bookings/bookings.service.ts` (MODIF, WIP→safe-swap) — garde `PROFILE_INCOMPLETE`

---

### Task 1 : Helper pur `phoneLinkAllowed` (TDD)

**Files:** Create `src/auth/phone-link.ts`, `src/auth/phone-link.spec.ts`

- [ ] **Step 1 : Test (échec)**

`src/auth/phone-link.spec.ts` :
```typescript
import { phoneLinkAllowed } from './phone-link';

describe('phoneLinkAllowed', () => {
  it('autorise si aucun numéro actuel', () => {
    expect(phoneLinkAllowed(null)).toEqual({ ok: true });
  });
  it('refuse si un numéro est déjà lié', () => {
    const r = phoneLinkAllowed('+237600000000');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/déjà/i);
  });
});
```

- [ ] **Step 2 : Lancer (échec)** — `npx jest src/auth/phone-link.spec.ts` → FAIL (module introuvable).

- [ ] **Step 3 : Implémenter**

`src/auth/phone-link.ts` :
```typescript
/**
 * La liaison d'un numéro n'est permise que si le compte n'a PAS déjà un numéro.
 * Changer un numéro déjà vérifié passe par un flux dédié (hors scope).
 */
export function phoneLinkAllowed(currentPhone: string | null): { ok: boolean; reason?: string } {
  if (!currentPhone) return { ok: true };
  return { ok: false, reason: 'Un numéro est déjà associé à ce compte.' };
}
```

- [ ] **Step 4 : Lancer (succès)** — `npx jest src/auth/phone-link.spec.ts` → PASS (2 tests).

- [ ] **Step 5 : Commit** — `git add src/auth/phone-link.ts src/auth/phone-link.spec.ts` → `feat(otp): helper phoneLinkAllowed (TDD)`.

---

### Task 2 : DTOs de liaison

**Files:** Create `src/auth/dto/link-phone.dto.ts` ; Modify `src/auth/dto/index.ts`

- [ ] **Step 1 : DTOs**

`src/auth/dto/link-phone.dto.ts` :
```typescript
import { IsString, IsNotEmpty, IsOptional, IsIn, Matches, Length } from 'class-validator';

const E164 = /^\+[1-9]\d{6,14}$/;

export class LinkPhoneSendDto {
  @IsString()
  @Matches(E164, { message: 'Numéro au format international requis (+237…)' })
  phone!: string;

  // Liaison : sms ou whatsapp uniquement (l'email ne prouve pas la possession du numéro).
  @IsOptional()
  @IsString()
  @IsIn(['sms', 'whatsapp'])
  channel?: 'sms' | 'whatsapp';
}

export class LinkPhoneVerifyDto {
  @IsString()
  @Matches(E164, { message: 'Numéro au format international requis (+237…)' })
  phone!: string;

  @IsString()
  @IsNotEmpty()
  @Length(4, 8)
  code!: string;
}
```

- [ ] **Step 2 : Barrel**

`src/auth/dto/index.ts` : ajouter
```typescript
export { LinkPhoneSendDto, LinkPhoneVerifyDto } from './link-phone.dto';
```

- [ ] **Step 3 : Compiler** — `./node_modules/.bin/tsc --noEmit 2>&1 | grep -iE "link-phone|dto/index" || echo "OK"` → `OK`.

- [ ] **Step 4 : Commit** — `git add src/auth/dto/link-phone.dto.ts src/auth/dto/index.ts` → `feat(otp): DTOs liaison téléphone`.

---

### Task 3 : auth.service — `sendPhoneLinkOtp`, `verifyPhoneLink`, `getMe` étendu

**Files:** Modify `src/auth/auth.service.ts` (WIP → safe-swap au commit)

- [ ] **Step 1 : Ajouter l'import du helper**

`import { phoneLinkAllowed } from './phone-link';`

- [ ] **Step 2 : `sendPhoneLinkOtp`** (insérer après `getOtpChannels`)
```typescript
  async sendPhoneLinkOtp(userId: string, phone: string, channel: 'sms' | 'whatsapp' = 'sms'): Promise<{ message: string; expiresIn: number }> {
    // Le compte ne doit pas déjà avoir un numéro
    const me = await this.prisma.user.findUnique({ where: { id: userId }, select: { phone: true } });
    const guard = phoneLinkAllowed(me?.phone ?? null);
    if (!guard.ok) throw new BadRequestException(guard.reason);

    // Numéro non déjà utilisé par un autre compte
    const taken = await this.prisma.user.findUnique({ where: { phone }, select: { id: true } });
    if (taken && taken.id !== userId) {
      throw new BadRequestException('Ce numéro est déjà utilisé par un autre compte.');
    }

    // Rate-limit par userId (5 envois / 10 min)
    const rlKey = `phone_link_rate:${userId}`;
    const n = await this.redis.incr(rlKey);
    if (n === 1) await this.redis.expire(rlKey, 600);
    if (n > 5) throw new BadRequestException('Trop de tentatives. Réessayez plus tard.');

    const testModeEnabled = await this.settings.get('test_mode_enabled', 'false');
    const testOtpValue    = await this.settings.get('test_otp_value', '000000');
    const isTestMode      = testModeEnabled === 'true';
    const code = isTestMode ? testOtpValue : Math.floor(100000 + Math.random() * 900000).toString();

    // OTP lié au userId + numéro visé
    await this.redis.set(`otp:link:${userId}`, JSON.stringify({ code, attempts: 0, phone }), OTP_TTL);

    if (!isTestMode) {
      const country = extractCountryFromPhone(phone);
      const sent = await this.sms.sendOtp(phone, code, 'fr', { channel, country });
      if (!sent) throw new BadRequestException("Echec d'envoi du code. Reessayez.");
    }
    return { message: 'Code envoyé', expiresIn: OTP_TTL };
  }
```

- [ ] **Step 3 : `verifyPhoneLink`**
```typescript
  async verifyPhoneLink(userId: string, phone: string, code: string): Promise<{ id: string; phone: string; countryCode: string | null; profileComplete: boolean }> {
    const key = `otp:link:${userId}`;
    const raw = await this.redis.get(key);
    if (!raw) throw new UnauthorizedException('Code expiré ou invalide.');
    const { code: storedCode, attempts, phone: storedPhone } = JSON.parse(raw);

    if (attempts >= 3) { await this.redis.del(key); throw new UnauthorizedException('Trop de tentatives. Demandez un nouveau code.'); }
    if (storedPhone !== phone) throw new UnauthorizedException('Numéro non concordant.');
    if (storedCode !== code) {
      await this.redis.set(key, JSON.stringify({ code: storedCode, attempts: attempts + 1, phone: storedPhone }), await this.redis.ttl(key));
      throw new UnauthorizedException('Code incorrect.');
    }
    await this.redis.del(key);

    // Re-vérifier l'unicité + que le compte n'a toujours pas de numéro (anti-race)
    const me = await this.prisma.user.findUnique({ where: { id: userId }, select: { phone: true } });
    if (me?.phone) throw new BadRequestException('Un numéro est déjà associé à ce compte.');
    const taken = await this.prisma.user.findUnique({ where: { phone }, select: { id: true } });
    if (taken && taken.id !== userId) throw new BadRequestException('Ce numéro est déjà utilisé par un autre compte.');

    const countryCode = extractCountryFromPhone(phone);
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { phone, countryCode },
      select: { id: true, phone: true, countryCode: true },
    });
    return { id: updated.id, phone: updated.phone!, countryCode: updated.countryCode, profileComplete: true };
  }
```

- [ ] **Step 4 : `getMe` étendu**

READ `getMe`. Ajouter `countryCode: true` au `select`, et retourner `profileComplete`. Remplacer le `return user;` final par :
```typescript
    return { ...user, profileComplete: !!user.phone };
```
et ajouter `countryCode: true,` dans le `select`.

- [ ] **Step 5 : Compiler** — `./node_modules/.bin/tsc --noEmit 2>&1 | grep -i "auth.service" || echo "OK"` → `OK`.

- [ ] **Step 6 : Commit (safe-swap)** — auth.service a du WIP. Sauver WT, `git checkout -- src/auth/auth.service.ts`, ré-appliquer les Steps 1-4 sur le HEAD propre, `git add src/auth/auth.service.ts`, vérifier `git diff --cached` = uniquement ces ajouts, commit `feat(otp): liaison téléphone (send/verify) + getMe profileComplete`, puis restaurer la version WT. (Procédure safe-swap standard du repo.)

---

### Task 4 : auth.controller — endpoints liaison

**Files:** Modify `src/auth/auth.controller.ts` (propre)

- [ ] **Step 1 : Endpoints authentifiés + throttle**

Importer les DTOs : `import { SendOtpDto, VerifyOtpDto, RefreshTokenDto, ChannelsLookupDto, LinkPhoneSendDto, LinkPhoneVerifyDto } from './dto';` (ajouter les 2). Ajouter (près des autres endpoints) :
```typescript
  @Post('phone/link/send')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async linkPhoneSend(@CurrentUser('id') userId: string, @Body() dto: LinkPhoneSendDto) {
    return this.authService.sendPhoneLinkOtp(userId, dto.phone, dto.channel ?? 'sms');
  }

  @Post('phone/link/verify')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async linkPhoneVerify(@CurrentUser('id') userId: string, @Body() dto: LinkPhoneVerifyDto) {
    return this.authService.verifyPhoneLink(userId, dto.phone, dto.code);
  }
```
VÉRIFIER que `UseGuards`, `JwtAuthGuard`, `CurrentUser`, `Throttle`, `Post`, `Body`, `HttpCode` sont importés (la plupart le sont ; `Throttle` est importé depuis Lot 1).

- [ ] **Step 2 : Compiler** — `./node_modules/.bin/tsc --noEmit 2>&1 | grep -i "auth.controller" || echo "OK"` → `OK`.

- [ ] **Step 3 : Commit** — `git add src/auth/auth.controller.ts` → `feat(otp): endpoints /auth/phone/link/{send,verify}`.

---

### Task 5 : Garde `PROFILE_INCOMPLETE` à la réservation

**Files:** Modify `src/bookings/bookings.service.ts` (WIP → safe-swap au commit)

- [ ] **Step 1 : Ajouter la garde tôt dans `createBooking`**

READ le début de `createBooking(passengerId, dto)` (~ligne 424, après `try {`). Insérer la garde AVANT les validations vehicleType (au tout début du `try`) :
```typescript
    // Garde profil : un passager sans numéro vérifié ne peut pas réserver.
    const passenger = await this.prisma.user.findUnique({ where: { id: passengerId }, select: { phone: true } });
    if (!passenger?.phone) {
      throw new ForbiddenException({ code: 'PROFILE_INCOMPLETE', message: 'Vérifiez votre numéro de téléphone avant de réserver.' });
    }
```
`ForbiddenException` est déjà importé. NOTE : passer un objet à `ForbiddenException` met `{ code, message }` dans le corps de la réponse → l'app lit `error.code === 'PROFILE_INCOMPLETE'`.

- [ ] **Step 2 : Compiler** — `./node_modules/.bin/tsc --noEmit 2>&1 | grep -i "bookings.service" || echo "OK"` → `OK`.

- [ ] **Step 3 : Commit (safe-swap)** — bookings.service a du WIP. Safe-swap : sauver WT, checkout HEAD, ré-appliquer la garde, `git add`, vérifier diff isolé, commit `feat(otp): blocage réservation si profil incomplet (PROFILE_INCOMPLETE)`, restaurer WT.

---

### Task 6 : Build, déploiement, validation

- [ ] **Step 1 : Tests** — `npx jest src/auth/phone-link.spec.ts` → 2 PASS.

- [ ] **Step 2 : Déployer** (base64 → `qm guest exec`, VM `192.168.100.101` via jump `root@217.160.47.83`, `/home/ubuntu/aerocab-deploy`) — versions **working-tree** : `src/auth/phone-link.ts`, `src/auth/dto/link-phone.dto.ts`, `src/auth/dto/index.ts`, `src/auth/auth.service.ts`, `src/auth/auth.controller.ts`, `src/bookings/bookings.service.ts`. `docker compose build api && docker compose up -d api`.

- [ ] **Step 3 : Valider**
  - API `healthy`.
  - `/auth/phone/link/send` sans token → **401** (auth-gated, enregistré).
  - `/auth/phone/link/send` avec `{ phone: "garbage" }` (token valide ou non) → **400/401** (DTO/auth).
  - `/auth/me` (avec token) → contient `countryCode` + `profileComplete`.
  - **Blocage** : un passager **sans numéro** qui tente une réservation → **403** `PROFILE_INCOMPLETE`. (Si pas de compte de test sans numéro sous la main, vérifier la garde par lecture du code déployé + log — ne pas muter la prod inutilement.)
  - **Rétro-compat** : un passager **avec** numéro réserve normalement (flux inchangé).

---

## Hors-scope (Lot 3)

- Mobile : écran « Vérifiez votre numéro » (déclenché par `PROFILE_INCOMPLETE`) + sélecteur de canal ; rebuild APK.
- Admin : section « Canaux OTP » par pays.

## Self-Review (effectuée)

**Couverture spec Lot 2 :** `/auth/phone/link/send|verify` (§5) → T2,T3,T4 ✓ ; OTP sms/whatsapp vers le numéro, pas email (§5) → DTO `channel ∈ {sms,whatsapp}` + send ✓ ; pose phone+countryCode + unicité (§5) → T3 ✓ ; garde `PROFILE_INCOMPLETE` (§6) → T5 ✓ ; `/auth/me` `profileComplete` (§5) → T3 ✓ ; cas limites unicité / phone déjà lié (§10) → `phoneLinkAllowed` + checks ✓ ; sécurité rate-limit/attempts (§12) → send rate-limit + verify max 3 + `@Throttle` ✓.

**Rétro-compatibilité :** endpoints neufs ; la garde ne bloque que les passagers sans `phone` (les inscriptions téléphone ont toujours un numéro → inchangé). `getMe` ajoute des champs sans en retirer.

**Cohérence types :** `phoneLinkAllowed(currentPhone)→{ok,reason?}`, `sendPhoneLinkOtp(userId,phone,channel)`, `verifyPhoneLink(userId,phone,code)→{id,phone,countryCode,profileComplete}`, `LinkPhoneSendDto/LinkPhoneVerifyDto` — cohérents.

**Placeholders :** aucun ; les `VÉRIFIER`/safe-swap pointent les WIP et imports réels avec instruction d'adapter.
