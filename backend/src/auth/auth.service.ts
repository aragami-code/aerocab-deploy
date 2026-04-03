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
import { SmsService } from './sms.service';
import {
  OTP_EXPIRY_MINUTES,
  OTP_COOLDOWN_MINUTES,
  OTP_MAX_ATTEMPTS,
} from '@aerogo24/shared';

const OTP_TTL = OTP_EXPIRY_MINUTES * 60; // seconds
const OTP_RATE_LIMIT_TTL = OTP_COOLDOWN_MINUTES * 60; // seconds
const OTP_RATE_LIMIT_MAX = OTP_MAX_ATTEMPTS;
const REFRESH_TOKEN_TTL = 90 * 24 * 60 * 60; // 90 days

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private jwt: JwtService,
    private config: ConfigService,
    private sms: SmsService,
  ) {}

  async sendOtp(phone: string): Promise<{ message: string; expiresIn: number }> {
    // Check rate limit
    const rateKey = `otp_rate:${phone}`;
    const currentCount = await this.redis.get(rateKey);
    const count = currentCount ? parseInt(currentCount, 10) : 0;

    if (count >= OTP_RATE_LIMIT_MAX) {
      const ttl = await this.redis.ttl(rateKey);
      throw new BadRequestException(
        `Trop de tentatives. Reessayez dans ${Math.ceil(ttl / 60)} minute(s).`,
      );
    }

    // Generate 6-digit OTP (fixed in dev mode or when FORCE_OTP_LOG=true)
    const isDev = this.config.get('NODE_ENV', 'development') !== 'production'
      || this.config.get('FORCE_OTP_LOG') === 'true';
    const code = isDev ? '123456' : Math.floor(100000 + Math.random() * 900000).toString();

    // Store OTP in Redis
    const otpKey = `otp:${phone}`;
    await this.redis.set(otpKey, JSON.stringify({ code, attempts: 0 }), OTP_TTL);

    // Increment rate limit
    await this.redis.incr(rateKey);
    if (count === 0) {
      await this.redis.expire(rateKey, OTP_RATE_LIMIT_TTL);
    }

    // Send SMS
    const sent = await this.sms.sendOtp(phone, code);
    if (!sent) {
      throw new BadRequestException("Echec d'envoi du SMS. Reessayez.");
    }

    return { message: 'OTP envoye avec succes', expiresIn: OTP_TTL };
  }

  private generateReferralCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
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

    // Check max attempts (5 wrong tries)
    if (attempts >= 5) {
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
      }

      user = await (this.prisma.user as any).create({
        data: {
          phone,
          role,
          referralCode: newReferralCode,
          referredBy: referrer?.id ?? null,
        },
      });
      isNewUser = true;
      this.logger.log(`New user created: ${user.id} (${phone}) role=${role}`);

      // Crédite parrain + filleul (500 pts chacun)
      if (referrer) {
        const REFERRAL_BONUS = 500;
        await Promise.all([
          this.prisma.pointsTransaction.create({
            data: { userId: referrer.id, type: 'credit', points: REFERRAL_BONUS, label: `Parrainage — nouvel inscrit` },
          }),
          this.prisma.pointsTransaction.create({
            data: { userId: user.id, type: 'credit', points: REFERRAL_BONUS, label: `Bonus parrainage à l'inscription` },
          }),
        ]);
        this.logger.log(`Referral bonus: ${REFERRAL_BONUS} pts → parrain ${referrer.id} + filleul ${user.id}`);
      }
    } else {
      this.logger.log(`User logged in: ${user.id} (${phone})`);
    }

    // Check if user is suspended
    if (user.status === 'suspended') {
      throw new UnauthorizedException('Compte suspendu. Contactez le support.');
    }

    // Generate tokens
    const payload = { sub: user.id, role: user.role };
    const accessToken = this.jwt.sign(payload, { expiresIn: '30d' });
    const refreshToken = this.jwt.sign(payload, { expiresIn: '90d' });

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

      // Generate new tokens
      const newPayload = { sub: user.id, role: user.role };
      const newAccessToken = this.jwt.sign(newPayload, { expiresIn: '30d' });
      const newRefreshToken = this.jwt.sign(newPayload, { expiresIn: '90d' });

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
        data: { googleId, email, name, role: 'passenger' },
      });
      isNewUser = true;
      this.logger.log(`New user created via Google: ${user.id} (${email})`);
    } else {
      this.logger.log(`User logged in via Google: ${user.id} (${email})`);
    }

    if (user.status === 'suspended') {
      throw new UnauthorizedException('Compte suspendu. Contactez le support.');
    }

    // Generate tokens
    const payload = { sub: user.id, role: user.role };
    const newAccessToken = this.jwt.sign(payload, { expiresIn: '30d' });
    const refreshToken = this.jwt.sign(payload, { expiresIn: '90d' });

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

      // Find or create user
      let isNewUser = false;
      let user = await this.prisma.user.findUnique({ where: { googleId } });
      if (!user && email) user = await this.prisma.user.findFirst({ where: { email } });
      if (user && !user.googleId) user = await this.prisma.user.update({ where: { id: user.id }, data: { googleId } });
      if (!user) { user = await this.prisma.user.create({ data: { googleId, email, name, role: 'passenger' } }); isNewUser = true; }

      // Generate tokens
      const payload = { sub: user.id, role: user.role };
      const accessToken = this.jwt.sign(payload, { expiresIn: '30d' });
      const refreshToken = this.jwt.sign(payload, { expiresIn: '90d' });
      await this.redis.set(`refresh:${user.id}`, refreshToken, REFRESH_TOKEN_TTL);

      // Redirect back to app
      const returnUrl = `${deepLink}?accessToken=${encodeURIComponent(accessToken)}&refreshToken=${encodeURIComponent(refreshToken)}&userId=${user.id}&userName=${encodeURIComponent(user.name || '')}&userRole=${user.role}&isNewUser=${isNewUser ? '1' : '0'}`;
      res.redirect(returnUrl);
    } catch (e) {
      this.logger.error('Google callback error', e);
      res.redirect(`${deepLink}?error=google_auth_failed`);
    }
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
        createdAt: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('Utilisateur introuvable');
    }

    return user;
  }
}
