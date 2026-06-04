import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../redis/redis.service';
import { OtpDeliveryService } from '../otp/otp-delivery.service';
import { EmailRouterService } from '../email/email-router.service';
import { SettingsService } from '../settings/settings.service';
import { maskPhone } from '../common/helpers';
import { extractCountryFromPhone } from '../common/phone-country';
import { availableChannels, Channel } from '../otp/otp-channels';
import { phoneLinkAllowed } from './phone-link';
import { randomInt } from 'crypto';
import {
  OTP_EXPIRY_MINUTES,
  OTP_COOLDOWN_MINUTES,
  OTP_MAX_ATTEMPTS,
} from '@aerogo24/shared';

const OTP_TTL = OTP_EXPIRY_MINUTES * 60; // seconds
const OTP_RATE_LIMIT_TTL = OTP_COOLDOWN_MINUTES * 60; // seconds
const OTP_RATE_LIMIT_MAX = OTP_MAX_ATTEMPTS;
const REFRESH_TOKEN_TTL = 30 * 24 * 60 * 60; // 30 days
const SESSION_VERSION_KEY = (userId: string) => `session_version:${userId}`;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private jwt: JwtService,
    private config: ConfigService,
    private sms: OtpDeliveryService,
    private email: EmailRouterService,
    private settings: SettingsService,
  ) {}

  private async newSessionVersion(userId: string): Promise<number> {
    return this.redis.incr(SESSION_VERSION_KEY(userId));
  }

  private async currentSessionVersion(userId: string): Promise<number> {
    const sv = await this.redis.get(SESSION_VERSION_KEY(userId));
    return sv ? parseInt(sv, 10) : 0;
  }

  async sendOtp(phone: string, lang = 'fr', channel?: 'sms' | 'whatsapp' | 'email'): Promise<{ message: string; expiresIn: number }> {
    // H6 — Rate limit global : empêche le spam via milliers de numéros différents.
    // Compteur global glissant sur 60s, seuil configurable (défaut : 500 req/min).
    const globalKey = 'otp_global_rate';
    const globalCount = await this.redis.incr(globalKey);
    if (globalCount === 1) {
      await this.redis.expire(globalKey, 60); // fenêtre 60s
    }
    const globalMax = parseInt(await this.redis.get('otp_global_limit') ?? '500', 10) || 500;
    if (globalCount > globalMax) {
      throw new BadRequestException('Service temporairement surchargé. Veuillez réessayer dans une minute.');
    }

    // Rate limit par numéro
    const rateKey = `otp_rate:${phone}`;
    const currentCount = await this.redis.get(rateKey);
    const count = currentCount ? parseInt(currentCount, 10) : 0;

    if (count >= OTP_RATE_LIMIT_MAX) {
      const ttl = await this.redis.ttl(rateKey);
      throw new BadRequestException(
        `Trop de tentatives. Reessayez dans ${Math.ceil(ttl / 60)} minute(s).`,
      );
    }

    // Test mode: 100% piloté par AppSetting (admin dashboard)
    // FORCE_TEST_OTP et FORCE_OTP_LOG (env vars) ne sont plus utilisés
    const testModeEnabled = await this.settings.get('test_mode_enabled', 'false');
    const testOtpValue    = await this.settings.get('test_otp_value', '000000');
    const otpLogEnabled   = await this.settings.get('otp_log_enabled', 'false');
    const isTestMode      = testModeEnabled === 'true';

    const code = isTestMode
      ? testOtpValue
      : Math.floor(100000 + Math.random() * 900000).toString();

    const shouldLog = isTestMode || otpLogEnabled === 'true'
      || this.config.get('NODE_ENV', 'development') !== 'production';
    if (shouldLog) {
      this.logger.log(`[OTP]${isTestMode ? ' [TEST]' : ''} ${maskPhone(phone)} → ${code}`);
    }

    // Store OTP in Redis
    const otpKey = `otp:${phone}`;
    await this.redis.set(otpKey, JSON.stringify({ code, attempts: 0 }), OTP_TTL);

    // Increment rate limit
    await this.redis.incr(rateKey);
    if (count === 0) {
      await this.redis.expire(rateKey, OTP_RATE_LIMIT_TTL);
    }

    // Send OTP via le canal choisi (skip in test mode — code already stored in Redis)
    if (!isTestMode) {
      const country = extractCountryFromPhone(phone);
      const sent = await this.sms.sendOtp(phone, code, lang, { channel, country });
      if (!sent) {
        throw new BadRequestException("Echec d'envoi du code. Reessayez.");
      }
    }

    return { message: 'OTP envoye avec succes', expiresIn: OTP_TTL };
  }

  /**
   * Canaux OTP disponibles pour un identifiant (numéro ou email), selon les
   * contacts du compte ∩ canaux activés du pays. Anti-énumération : si aucun
   * compte, on retombe sur les contacts de l'identifiant lui-même.
   */
  async getOtpChannels(identifier: string): Promise<{ channels: string[]; default: string }> {
    const raw = (identifier ?? '').trim();
    const isEmail = raw.includes('@');
    const id = isEmail ? raw.toLowerCase() : raw;
    const country = isEmail ? null : extractCountryFromPhone(id);
    const account = isEmail
      ? await this.prisma.user.findFirst({ where: { email: id }, select: { phone: true, email: true } })
      : await this.prisma.user.findUnique({ where: { phone: id }, select: { phone: true, email: true } });

    const hasPhone = account ? !!account.phone : !isEmail;
    const hasEmail = account ? !!account.email : isEmail;

    const enabledRaw = await this.settings.getForCountry('otp_channels_enabled', country, 'sms,email');
    const enabled = enabledRaw.split(',').map((s) => s.trim()).filter(Boolean) as Channel[];

    const channels = availableChannels({ hasPhone, hasEmail, mode: 'login' }, enabled);
    const defRaw = await this.settings.getForCountry('otp_default_channel', country, '');
    const def = channels.includes(defRaw as Channel) ? defRaw : (channels[0] ?? 'sms');
    return { channels, default: def };
  }

  /**
   * Envoie un OTP pour lier un numéro à un compte (email/Google sans téléphone).
   * Canal sms/whatsapp uniquement (l'OTP doit aller au numéro pour prouver la possession).
   */
  async sendPhoneLinkOtp(userId: string, phone: string, channel: 'sms' | 'whatsapp' = 'sms'): Promise<{ message: string; expiresIn: number }> {
    const me = await this.prisma.user.findUnique({ where: { id: userId }, select: { phone: true } });
    const guard = phoneLinkAllowed(me?.phone ?? null);
    if (!guard.ok) throw new BadRequestException(guard.reason);

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
    // OTP via RNG cryptographique (anti-prédiction)
    const code = isTestMode ? testOtpValue : randomInt(100000, 1000000).toString();

    await this.redis.set(`otp:link:${userId}`, JSON.stringify({ code, attempts: 0, phone }), OTP_TTL);

    if (!isTestMode) {
      const country = extractCountryFromPhone(phone);
      const sent = await this.sms.sendOtp(phone, code, 'fr', { channel, country });
      if (!sent) throw new BadRequestException("Echec d'envoi du code. Reessayez.");
    }
    return { message: 'Code envoyé', expiresIn: OTP_TTL };
  }

  /**
   * Vérifie l'OTP de liaison et pose phone + countryCode sur le compte.
   */
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

    // Anti-race : re-vérifier l'unicité + l'absence de numéro
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

  async sendEmailOtp(emailAddr: string, lang = 'fr'): Promise<{ message: string; expiresIn: number }> {
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!EMAIL_RE.test(emailAddr)) {
      throw new BadRequestException('Adresse email invalide.');
    }

    // Rate limit par email
    const rateKey = `otp_email_rate:${emailAddr}`;
    const currentCount = await this.redis.get(rateKey);
    const count = currentCount ? parseInt(currentCount, 10) : 0;
    if (count >= OTP_RATE_LIMIT_MAX) {
      const ttl = await this.redis.ttl(rateKey);
      throw new BadRequestException(
        `Trop de tentatives. Réessayez dans ${Math.ceil(ttl / 60)} minute(s).`,
      );
    }

    const testModeEnabled = await this.settings.get('test_mode_enabled', 'false');
    const testOtpValue    = await this.settings.get('test_otp_value', '000000');
    const isTestMode      = testModeEnabled === 'true';

    const code = isTestMode
      ? testOtpValue
      : Math.floor(100000 + Math.random() * 900000).toString();

    this.logger.log(`[OTP-EMAIL]${isTestMode ? ' [TEST]' : ''} ${emailAddr} → ${isTestMode ? code : '******'}`);

    const otpKey = `otp:email:${emailAddr}`;
    await this.redis.set(otpKey, JSON.stringify({ code, attempts: 0 }), OTP_TTL);

    await this.redis.incr(rateKey);
    if (count === 0) await this.redis.expire(rateKey, OTP_RATE_LIMIT_TTL);

    const subject = 'Votre code AeroGo 24';
    const html = `
      <div style="font-family:sans-serif;max-width:400px;margin:auto;padding:24px">
        <h2 style="color:#1D2C4D">AeroGo 24</h2>
        <p>Voici votre code de vérification :</p>
        <div style="font-size:36px;font-weight:700;letter-spacing:8px;color:#1D2C4D;text-align:center;padding:16px 0">${code}</div>
        <p style="color:#64748b;font-size:13px">Ce code expire dans ${OTP_EXPIRY_MINUTES} minutes. Ne le partagez pas.</p>
      </div>
    `;

    const forceLog = this.config.get<string>('FORCE_OTP_LOG') === 'true';
    if (forceLog) {
      this.logger.log(`[OTP-EMAIL-DEV] Code pour ${emailAddr} : ${code}`);
    }

    const sent = await this.email.send(emailAddr, subject, html);
    if (!sent && !forceLog) {
      throw new BadRequestException("Échec d'envoi de l'email. Réessayez.");
    }

    return { message: 'Code envoyé par email', expiresIn: OTP_TTL };
  }

  async verifyEmailOtp(
    emailAddr: string,
    code: string,
    intendedRole?: 'passenger' | 'driver',
    referralCode?: string,
  ) {
    const otpKey = `otp:email:${emailAddr}`;
    const otpData = await this.redis.get(otpKey);

    if (!otpData) throw new UnauthorizedException('Code OTP expiré ou invalide');

    const { code: storedCode, attempts } = JSON.parse(otpData);

    if (attempts >= 3) {
      await this.redis.del(otpKey);
      throw new UnauthorizedException('Trop de tentatives. Demandez un nouveau code.');
    }

    if (storedCode !== code) {
      await this.redis.set(
        otpKey,
        JSON.stringify({ code: storedCode, attempts: attempts + 1 }),
        await this.redis.ttl(otpKey),
      );
      throw new UnauthorizedException('Code OTP incorrect');
    }

    await this.redis.del(otpKey);

    let user = await this.prisma.user.findFirst({ where: { email: emailAddr } });
    let isNewUser = false;

    if (!user) {
      const role = intendedRole ?? 'passenger';
      let newReferralCode: string | null = null;
      for (let i = 0; i < 5; i++) {
        const candidate = this.generateReferralCode();
        const exists = await (this.prisma.user as any).findUnique({ where: { referralCode: candidate } });
        if (!exists) { newReferralCode = candidate; break; }
      }

      let referrer: { id: string } | null = null;
      if (referralCode) {
        referrer = await (this.prisma.user as any).findUnique({
          where: { referralCode: referralCode.toUpperCase() },
          select: { id: true },
        });
        if (!referrer) throw new BadRequestException('Code de parrainage invalide.');
      }

      user = await (this.prisma.user as any).create({
        data: { email: emailAddr, role, referralCode: newReferralCode, referredBy: referrer?.id ?? null },
      });
      isNewUser = true;
      this.logger.log(`New user created via email: ${user.id} (${emailAddr}) role=${role}`);

      if (referrer) {
        const BONUS = 500;
        await Promise.all([
          this.prisma.pointsTransaction.create({ data: { userId: referrer.id, type: 'credit', points: BONUS, label: 'Parrainage — nouvel inscrit', source: 'referral' } }),
          this.prisma.pointsTransaction.create({ data: { userId: user.id, type: 'credit', points: BONUS, label: 'Bonus parrainage à l\'inscription', source: 'referral' } }),
        ]);
      }
    }

    const sv = await this.newSessionVersion(user.id);
    const accessToken  = this.jwt.sign({ sub: user.id, role: user.role, sv });
    const refreshToken = this.jwt.sign({ sub: user.id, type: 'refresh' }, { expiresIn: `${REFRESH_TOKEN_TTL}s` });
    await this.redis.set(`refresh:${user.id}`, refreshToken, REFRESH_TOKEN_TTL);

    return { accessToken, refreshToken, user: { id: user.id, email: user.email, name: user.name, role: user.role }, isNewUser };
  }

  private generateReferralCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  }

  async applyReferral(userId: string, referralCode: string): Promise<{ success: boolean; message: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { referredBy: true, phone: true, countryCode: true },
    });
    if (user?.referredBy) return { success: false, message: 'Vous avez déjà un parrain.' };
    const referrer = await this.prisma.user.findUnique({
      where: { referralCode: referralCode.toUpperCase() },
      select: { id: true },
    });
    if (!referrer) return { success: false, message: 'Code de parrainage invalide.' };
    if (referrer.id === userId) return { success: false, message: 'Vous ne pouvez pas utiliser votre propre code.' };
    await this.prisma.user.update({
      where: { id: userId },
      data: { referredBy: referrer.id },
    });
    // Bonus parrainage selon le pays du filleul (marché qu'il rejoint ; null = global)
    const referralCountry = user?.countryCode ?? (user?.phone ? extractCountryFromPhone(user.phone) : null);
    const tariffs = await this.settings.getTariffsByCountry(referralCountry);
    const onSignup     = tariffs.referralBonus?.onSignup    ?? 500;
    const newUserBonus = tariffs.referralBonus?.newUserBonus ?? 300;
    await Promise.all([
      onSignup > 0     ? this.prisma.pointsTransaction.create({ data: { userId: referrer.id, points: onSignup,     type: 'credit', label: 'Parrainage accepté',        source: 'referral' } })         : Promise.resolve(),
      newUserBonus > 0 ? this.prisma.pointsTransaction.create({ data: { userId,              points: newUserBonus, type: 'credit', label: 'Bonus parrainage inscription', source: 'referral' } }) : Promise.resolve(),
    ]);
    return { success: true, message: `${newUserBonus} points offerts ! Votre parrain reçoit ${onSignup} points.` };
  }

  async logout(userId: string): Promise<void> {
    await this.redis.del(`refresh:${userId}`);
  }

  async getReferralInfo(userId: string) {
    const user = await (this.prisma.user as any).findUnique({
      where: { id: userId },
      select: { referralCode: true, referrals: { select: { id: true } } },
    });
    return {
      referralCode: user?.referralCode ?? null,
      referralCount: user?.referrals?.length ?? 0,
    };
  }

  // 3.B4 — Liste des filleuls avec statut (inscrit / 1ère course effectuée)
  async getReferralList(userId: string): Promise<{
    referrals: { id: string; name: string | null; status: 'registered' | 'first_ride_done'; createdAt: string }[];
  }> {
    const referrals = await (this.prisma.user as any).findMany({
      where: { referredBy: userId },
      select: {
        id: true,
        name: true,
        createdAt: true,
        bookings: {
          where: { status: 'completed' },
          select: { id: true },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      referrals: referrals.map((r: any) => ({
        id: r.id,
        name: r.name ?? null,
        status: (r.bookings?.length ?? 0) > 0 ? 'first_ride_done' : 'registered',
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  async verifyOtp(
    phone: string,
    code: string,
    intendedRole?: 'passenger' | 'driver',
    referralCode?: string,
  ): Promise<{
    accessToken: string;
    refreshToken: string;
    user: { id: string; phone: string; name: string | null; role: string };
    isNewUser: boolean;
  }> {
    const otpKey = `otp:${phone}`;
    const otpData = await this.redis.get(otpKey);

    if (!otpData) {
      throw new UnauthorizedException('Code OTP expire ou invalide');
    }

    const { code: storedCode, attempts } = JSON.parse(otpData);

    // Check max attempts (3 wrong tries → blocked on 4th)
    if (attempts >= 3) {
      await this.redis.del(otpKey);
      throw new UnauthorizedException(
        'Trop de tentatives incorrectes. Demandez un nouveau code.',
      );
    }

    if (storedCode !== code) {
      // Increment attempts
      await this.redis.set(
        otpKey,
        JSON.stringify({ code: storedCode, attempts: attempts + 1 }),
        await this.redis.ttl(otpKey),
      );
      throw new UnauthorizedException('Code OTP incorrect');
    }

    // OTP valid - delete it
    await this.redis.del(otpKey);

    // Find or create user
    let user = await this.prisma.user.findUnique({ where: { phone } });
    let isNewUser = false;

    if (!user) {
      const role = intendedRole || 'passenger';

      // Génère un code de parrainage unique
      let newReferralCode: string | null = null;
      for (let i = 0; i < 5; i++) {
        const candidate = this.generateReferralCode();
        const exists = await (this.prisma.user as any).findUnique({ where: { referralCode: candidate } });
        if (!exists) { newReferralCode = candidate; break; }
      }

      // Cherche le parrain si un code a été fourni
      let referrer: { id: string } | null = null;
      if (referralCode) {
        referrer = await (this.prisma.user as any).findUnique({
          where: { referralCode: referralCode.toUpperCase() },
          select: { id: true },
        });
        if (!referrer) throw new BadRequestException('Code de parrainage invalide.');
      }

      user = await (this.prisma.user as any).create({
        data: {
          phone,
          role,
          referralCode: newReferralCode,
          referredBy: referrer?.id ?? null,
          countryCode: extractCountryFromPhone(phone),
        },
      });
      isNewUser = true;
      this.logger.log(`New user created: ${user.id} (${maskPhone(phone)}) role=${role}`);

      // Crédite parrain + filleul (500 pts chacun)
      if (referrer) {
        const REFERRAL_BONUS = 500;
        await Promise.all([
          this.prisma.pointsTransaction.create({
            data: { userId: referrer.id, type: 'credit', points: REFERRAL_BONUS, label: `Parrainage — nouvel inscrit`, source: 'referral' },
          }),
          this.prisma.pointsTransaction.create({
            data: { userId: user.id, type: 'credit', points: REFERRAL_BONUS, label: `Bonus parrainage à l'inscription`, source: 'referral' },
          }),
        ]);
        this.logger.log(`Referral bonus: ${REFERRAL_BONUS} pts → parrain ${referrer.id} + filleul ${user.id}`);
      }
    } else {
      this.logger.log(`User logged in: ${user.id} (${maskPhone(phone)})`);
    }

    // Check if user is suspended
    if (user.status === 'suspended') {
      throw new UnauthorizedException('Compte suspendu. Contactez le support.');
    }

    // Generate tokens — session unique (D3)
    const sv = await this.newSessionVersion(user.id);
    const payload = { sub: user.id, role: user.role, sv };
    const accessToken = this.jwt.sign(payload, { expiresIn: '30d' });
    const refreshToken = this.jwt.sign(payload, { expiresIn: '30d' });

    // Store refresh token in Redis
    await this.redis.set(
      `refresh:${user.id}`,
      refreshToken,
      REFRESH_TOKEN_TTL,
    );

    return {
      accessToken,
      refreshToken,
      user: { id: user.id, phone: user.phone, name: user.name, role: user.role },
      isNewUser,
    };
  }

  async refreshToken(
    refreshToken: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    try {
      const payload = this.jwt.verify(refreshToken);
      const userId = payload.sub;

      // Verify refresh token in Redis
      const storedToken = await this.redis.get(`refresh:${userId}`);
      if (storedToken !== refreshToken) {
        throw new UnauthorizedException('Token de rafraichissement invalide');
      }

      // Get user
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      if (!user || user.status === 'suspended') {
        throw new UnauthorizedException('Utilisateur introuvable ou suspendu');
      }

      // Refresh conserve la session version courante (pas de nouvel login)
      const sv = await this.currentSessionVersion(user.id);
      const newPayload = { sub: user.id, role: user.role, sv };
      const newAccessToken = this.jwt.sign(newPayload, { expiresIn: '30d' });
      const newRefreshToken = this.jwt.sign(newPayload, { expiresIn: '30d' });

      await this.redis.set(
        `refresh:${user.id}`,
        newRefreshToken,
        REFRESH_TOKEN_TTL,
      );

      return { accessToken: newAccessToken, refreshToken: newRefreshToken };
    } catch {
      throw new UnauthorizedException('Token invalide ou expire');
    }
  }

  async googleLogin(
    code: string,
    codeVerifier: string,
    redirectUri: string,
    intendedRole: 'passenger' | 'driver' = 'passenger',
  ): Promise<{
    accessToken: string;
    refreshToken: string;
    user: { id: string; phone: string | null; name: string | null; role: string };
    isNewUser: boolean;
  }> {
    // Exchange authorization code for tokens
    const clientId = this.config.get('GOOGLE_CLIENT_ID');
    const clientSecret = this.config.get('GOOGLE_CLIENT_SECRET');

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        code_verifier: codeVerifier,
      }).toString(),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.json();
      this.logger.error('Google token exchange failed', err);
      throw new UnauthorizedException('Echec echange code Google');
    }

    const { access_token } = await tokenRes.json() as { access_token: string };

    // Fetch user info from Google
    const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    if (!response.ok) {
      throw new UnauthorizedException('Token Google invalide');
    }

    const googleUser = await response.json() as {
      sub: string;
      email?: string;
      name?: string;
      picture?: string;
    };

    const { sub: googleId, email, name } = googleUser;

    // Look up user by googleId first, then by email
    let user = await this.prisma.user.findUnique({ where: { googleId } });
    let isNewUser = false;

    if (!user && email) {
      user = await this.prisma.user.findFirst({ where: { email } });
      if (user) {
        // Link existing email user to Google account
        user = await this.prisma.user.update({
          where: { id: user.id },
          data: { googleId },
        });
      }
    }

    if (!user) {
      user = await this.prisma.user.create({
        data: { googleId, email, name, role: intendedRole },
      });
      isNewUser = true;
      this.logger.log(`New user created via Google: ${user.id} (${email}) role=${intendedRole}`);
    } else {
      this.logger.log(`User logged in via Google: ${user.id} (${email})`);
    }

    if (user.status === 'suspended') {
      throw new UnauthorizedException('Compte suspendu. Contactez le support.');
    }

    // Generate tokens — session unique (D3)
    const svGoogle = await this.newSessionVersion(user.id);
    const payload = { sub: user.id, role: user.role, sv: svGoogle };
    const newAccessToken = this.jwt.sign(payload, { expiresIn: '30d' });
    const refreshToken = this.jwt.sign(payload, { expiresIn: '30d' });

    // Store refresh token in Redis
    await this.redis.set(
      `refresh:${user.id}`,
      refreshToken,
      REFRESH_TOKEN_TTL,
    );

    return {
      accessToken: newAccessToken,
      refreshToken,
      user: { id: user.id, phone: user.phone, name: user.name, role: user.role },
      isNewUser,
    };
  }

  googleStart(deepLink: string, res: any) {
    const clientId = this.config.get('GOOGLE_CLIENT_ID');
    const redirectUri = this.config.get('BACKEND_URL', 'https://aerocab-api.onrender.com') + '/api/auth/google/callback';
    const state = Buffer.from(deepLink || '').toString('base64');
    const url = `https://accounts.google.com/o/oauth2/v2/auth?` +
      `client_id=${encodeURIComponent(clientId)}&` +
      `redirect_uri=${encodeURIComponent(redirectUri)}&` +
      `response_type=code&` +
      `scope=openid%20profile%20email&` +
      `state=${encodeURIComponent(state)}`;
    res.redirect(url);
  }

  async googleCallback(code: string, state: string, res: any) {
    const clientId = this.config.get('GOOGLE_CLIENT_ID');
    const clientSecret = this.config.get('GOOGLE_CLIENT_SECRET');
    const redirectUri = this.config.get('BACKEND_URL', 'https://aerocab-api.onrender.com') + '/api/auth/google/callback';
    const deepLink = state ? Buffer.from(state, 'base64').toString('utf8') : '';

    try {
      // Exchange code for tokens
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }).toString(),
      });

      if (!tokenRes.ok) {
        const tokenErr = await tokenRes.json();
        this.logger.error('Google token exchange failed', JSON.stringify(tokenErr));
        res.redirect(`${deepLink}?error=google_token_failed`);
        return;
      }

      const { access_token } = await tokenRes.json() as { access_token: string };

      // Get user info
      const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${access_token}` },
      });
      const googleUser = await userRes.json() as { sub: string; email?: string; name?: string };
      const { sub: googleId, email, name } = googleUser;

      // 0.B19 — rôle déduit du schéma deepLink (aerogo24-driver:// → driver, sinon passenger)
      const roleFromDeepLink: 'passenger' | 'driver' = deepLink.startsWith('aerogo24-driver://') ? 'driver' : 'passenger';

      // Find or create user
      let isNewUser = false;
      let user = await this.prisma.user.findUnique({ where: { googleId } });
      if (!user && email) user = await this.prisma.user.findFirst({ where: { email } });
      if (user && !user.googleId) user = await this.prisma.user.update({ where: { id: user.id }, data: { googleId } });
      if (!user) { user = await this.prisma.user.create({ data: { googleId, email, name, role: roleFromDeepLink } }); isNewUser = true; }

      // Generate tokens — session unique (D3)
      const svCb = await this.newSessionVersion(user.id);
      const payload = { sub: user.id, role: user.role, sv: svCb };
      const accessToken = this.jwt.sign(payload, { expiresIn: '30d' });
      const refreshToken = this.jwt.sign(payload, { expiresIn: '30d' });
      await this.redis.set(`refresh:${user.id}`, refreshToken, REFRESH_TOKEN_TTL);

      // C1 — Sécurité : ne jamais exposer les tokens dans l'URL (logs, proxies, historique).
      // On génère un authCode éphémère (30s) stocké en Redis.
      // L'app échange ce code via POST /auth/google/exchange.
      const authCode = require('crypto').randomBytes(32).toString('hex');
      await this.redis.set(
        `google_auth_code:${authCode}`,
        JSON.stringify({ accessToken, refreshToken, userId: user.id, userName: user.name || '', userRole: user.role, isNewUser }),
        30, // 30 secondes
      );
      const returnUrl = `${deepLink}?authCode=${authCode}`;
      res.redirect(returnUrl);
    } catch (e) {
      this.logger.error('Google callback error', e);
      res.redirect(`${deepLink}?error=google_auth_failed`);
    }
  }

  /**
   * C1 — Échange un authCode éphémère (30s) contre les vrais tokens JWT.
   * Le code est à usage unique : supprimé dès la première utilisation.
   */
  async exchangeGoogleAuthCode(authCode: string) {
    // Valide le format : exactement 64 caractères hexadécimaux (randomBytes(32).toString('hex'))
    if (!/^[a-f0-9]{64}$/.test(authCode)) {
      throw new BadRequestException('Code d\'authentification invalide ou expiré');
    }
    const raw = await this.redis.get(`google_auth_code:${authCode}`);
    if (!raw) {
      throw new BadRequestException('Code d\'authentification invalide ou expiré');
    }
    await this.redis.del(`google_auth_code:${authCode}`); // usage unique
    return JSON.parse(raw) as {
      accessToken: string;
      refreshToken: string;
      userId: string;
      userName: string;
      userRole: string;
      isNewUser: boolean;
    };
  }

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        phone: true,
        name: true,
        email: true,
        role: true,
        status: true,
        avatarUrl: true,
        language: true,
        countryCode: true,
        createdAt: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('Utilisateur introuvable');
    }

    return { ...user, profileComplete: !!user.phone };
  }
}
