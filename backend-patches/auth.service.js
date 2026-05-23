"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var AuthService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = void 0;
const common_1 = require("@nestjs/common");
const jwt_1 = require("@nestjs/jwt");
const config_1 = require("@nestjs/config");
const prisma_service_1 = require("../database/prisma.service");
const redis_service_1 = require("../redis/redis.service");
const otp_delivery_service_1 = require("../otp/otp-delivery.service");
const settings_service_1 = require("../settings/settings.service");
const email_router_service_1 = require("../email/email-router.service");
const helpers_1 = require("../common/helpers");
const shared_1 = require("@aerogo24/shared");
const OTP_TTL = shared_1.OTP_EXPIRY_MINUTES * 60;
const OTP_RATE_LIMIT_TTL = shared_1.OTP_COOLDOWN_MINUTES * 60;
const OTP_RATE_LIMIT_MAX = shared_1.OTP_MAX_ATTEMPTS;
const REFRESH_TOKEN_TTL = 30 * 24 * 60 * 60; // 30 days
const SESSION_VERSION_KEY = (userId) => `session_version:${userId}`;
let AuthService = AuthService_1 = class AuthService {
    constructor(prisma, redis, jwt, config, sms, settings, email) {
        this.prisma = prisma;
        this.redis = redis;
        this.jwt = jwt;
        this.config = config;
        this.sms = sms;
        this.settings = settings;
        this.email = email;
        this.logger = new common_1.Logger(AuthService_1.name);
    }
    async newSessionVersion(userId) {
        return this.redis.incr(SESSION_VERSION_KEY(userId));
    }
    async currentSessionVersion(userId) {
        const sv = await this.redis.get(SESSION_VERSION_KEY(userId));
        return sv ? parseInt(sv, 10) : 0;
    }
    async sendOtp(phone, lang = 'fr') {
        var _a;
        const globalKey = 'otp_global_rate';
        const globalCount = await this.redis.incr(globalKey);
        if (globalCount === 1) {
            await this.redis.expire(globalKey, 60);
        }
        const globalMax = parseInt((_a = await this.redis.get('otp_global_limit')) !== null && _a !== void 0 ? _a : '500', 10) || 500;
        if (globalCount > globalMax) {
            throw new common_1.BadRequestException('Service temporairement surchargé. Veuillez réessayer dans une minute.');
        }
        const rateKey = `otp_rate:${phone}`;
        const currentCount = await this.redis.get(rateKey);
        const count = currentCount ? parseInt(currentCount, 10) : 0;
        if (count >= OTP_RATE_LIMIT_MAX) {
            const ttl = await this.redis.ttl(rateKey);
            throw new common_1.BadRequestException(`Trop de tentatives. Reessayez dans ${Math.ceil(ttl / 60)} minute(s).`);
        }
        const testModeEnabled = await this.settings.get('test_mode_enabled', 'false');
        const testOtpValue = await this.settings.get('test_otp_value', '000000');
        const otpLogEnabled = await this.settings.get('otp_log_enabled', 'false');
        const isTestMode = testModeEnabled === 'true';
        const code = isTestMode
            ? testOtpValue
            : Math.floor(100000 + Math.random() * 900000).toString();
        const shouldLog = isTestMode || otpLogEnabled === 'true'
            || this.config.get('NODE_ENV', 'development') !== 'production';
        if (shouldLog) {
            this.logger.log(`[OTP]${isTestMode ? ' [TEST]' : ''} ${(0, helpers_1.maskPhone)(phone)} → ${code}`);
        }
        const otpKey = `otp:${phone}`;
        await this.redis.set(otpKey, JSON.stringify({ code, attempts: 0 }), OTP_TTL);
        await this.redis.incr(rateKey);
        if (count === 0) {
            await this.redis.expire(rateKey, OTP_RATE_LIMIT_TTL);
        }
        const sent = await this.sms.sendOtp(phone, code, lang);
        if (!sent) {
            throw new common_1.BadRequestException("Echec d'envoi du SMS. Reessayez.");
        }
        return { message: 'OTP envoye avec succes', expiresIn: OTP_TTL };
    }

    // ── Email OTP ─────────────────────────────────────────────────────────────
    async sendEmailOtp(emailAddr, lang = 'fr') {
        var _a;
        // Check feature flag
        const enabled = await this.settings.get('auth_email_otp_enabled', 'true');
        if (enabled === 'false') {
            throw new common_1.BadRequestException('La connexion par email est désactivée.');
        }

        // E1: Global rate limit (same as phone OTP)
        const globalKey = 'otp_global_rate';
        const globalCount = await this.redis.incr(globalKey);
        if (globalCount === 1) {
            await this.redis.expire(globalKey, 60);
        }
        const globalMax = parseInt((_a = await this.redis.get('otp_global_limit')) !== null && _a !== void 0 ? _a : '500', 10) || 500;
        if (globalCount > globalMax) {
            throw new common_1.BadRequestException('Service temporairement surchargé. Veuillez réessayer dans une minute.');
        }

        // Rate limit per email
        const rateKey = `otp_rate:email:${emailAddr}`;
        const currentCount = await this.redis.get(rateKey);
        const count = currentCount ? parseInt(currentCount, 10) : 0;
        if (count >= OTP_RATE_LIMIT_MAX) {
            const ttl = await this.redis.ttl(rateKey);
            throw new common_1.BadRequestException(`Trop de tentatives. Reessayez dans ${Math.ceil(ttl / 60)} minute(s).`);
        }

        const testModeEnabled = await this.settings.get('test_mode_enabled', 'false');
        const testOtpValue = await this.settings.get('test_otp_value', '000000');
        // E2: respect otp_log_enabled comme le phone OTP
        const otpLogEnabled = await this.settings.get('otp_log_enabled', 'false');
        const isTestMode = testModeEnabled === 'true';
        const code = isTestMode
            ? testOtpValue
            : Math.floor(100000 + Math.random() * 900000).toString();

        const shouldLog = isTestMode || otpLogEnabled === 'true'
            || this.config.get('NODE_ENV', 'development') !== 'production';
        if (shouldLog) {
            this.logger.log(`[EMAIL-OTP]${isTestMode ? ' [TEST]' : ''} ${emailAddr} → ${code}`);
        }

        const otpKey = `otp:email:${emailAddr}`;
        await this.redis.set(otpKey, JSON.stringify({ code, attempts: 0 }), OTP_TTL);
        await this.redis.incr(rateKey);
        if (count === 0) {
            await this.redis.expire(rateKey, OTP_RATE_LIMIT_TTL);
        }

        const appName = await this.settings.get('app_name', 'AeroCab');
        const html = `
            <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:32px;background:#f8f9ff;border-radius:16px">
                <h2 style="color:#1D2C4D;margin-bottom:8px">${appName}</h2>
                <p style="color:#4B5563;margin-bottom:24px">Votre code de vérification est :</p>
                <div style="font-size:40px;font-weight:900;letter-spacing:12px;color:#1D2C4D;text-align:center;padding:16px;background:#fff;border-radius:12px;border:2px solid #e5e7eb">
                    ${code}
                </div>
                <p style="color:#9CA3AF;font-size:13px;margin-top:16px;text-align:center">
                    Ce code expire dans 5 minutes. Ne le partagez pas.
                </p>
            </div>`;

        if (this.email) {
            await this.email.send(emailAddr, `Votre code ${appName}`, html);
        } else {
            this.logger.warn('[EMAIL-OTP] EmailRouterService non disponible — code logué seulement');
        }

        return { message: 'Code envoyé par email', expiresIn: OTP_TTL };
    }

    async verifyEmailOtp(emailAddr, code, intendedRole, referralCode) {
        var _a;
        // Check feature flag
        const enabled = await this.settings.get('auth_email_otp_enabled', 'true');
        if (enabled === 'false') {
            throw new common_1.BadRequestException('La connexion par email est désactivée.');
        }

        const otpKey = `otp:email:${emailAddr}`;
        const otpData = await this.redis.get(otpKey);
        if (!otpData) {
            throw new common_1.UnauthorizedException('Code OTP expiré ou invalide');
        }
        const { code: storedCode, attempts } = JSON.parse(otpData);
        if (attempts >= 3) {
            await this.redis.del(otpKey);
            throw new common_1.UnauthorizedException('Trop de tentatives incorrectes. Demandez un nouveau code.');
        }
        if (storedCode !== code) {
            await this.redis.set(otpKey, JSON.stringify({ code: storedCode, attempts: attempts + 1 }), await this.redis.ttl(otpKey));
            throw new common_1.UnauthorizedException('Code OTP incorrect');
        }
        await this.redis.del(otpKey);

        // Find or create user by email
        let user = await this.prisma.user.findFirst({ where: { email: emailAddr } });
        let isNewUser = false;
        if (!user) {
            const role = intendedRole || 'passenger';
            let newReferralCode = null;
            for (let i = 0; i < 5; i++) {
                const candidate = this.generateReferralCode();
                const exists = await this.prisma.user.findUnique({ where: { referralCode: candidate } });
                if (!exists) { newReferralCode = candidate; break; }
            }
            let referrer = null;
            if (referralCode) {
                referrer = await this.prisma.user.findUnique({
                    where: { referralCode: referralCode.toUpperCase() },
                    select: { id: true },
                });
                if (!referrer) throw new common_1.BadRequestException('Code de parrainage invalide.');
            }
            user = await this.prisma.user.create({
                data: {
                    email: emailAddr,
                    role,
                    referralCode: newReferralCode,
                    referredBy: (_a = referrer === null || referrer === void 0 ? void 0 : referrer.id) !== null && _a !== void 0 ? _a : null,
                },
            });
            isNewUser = true;
            this.logger.log(`New user created via email OTP: ${user.id} (${emailAddr}) role=${role}`);
            if (referrer) {
                const tariffs = await this.settings.getTariffs();
                const referrerBonus = tariffs?.referralBonus?.onSignup ?? 500;
                const newUserBonus = tariffs?.referralBonus?.newUserBonus ?? 300;
                await Promise.all([
                    this.prisma.pointsTransaction.create({ data: { userId: referrer.id, type: 'credit', points: referrerBonus, label: 'Parrainage — nouvel inscrit', source: 'referral' } }),
                    this.prisma.pointsTransaction.create({ data: { userId: user.id, type: 'credit', points: newUserBonus, label: 'Bonus parrainage à l\'inscription', source: 'referral' } }),
                ]);
                this.logger.log(`Referral bonus: ${referrerBonus} pts → parrain ${referrer.id} + ${newUserBonus} pts → filleul ${user.id}`);
            }
        } else {
            this.logger.log(`User logged in via email OTP: ${user.id} (${emailAddr})`);
        }

        if (user.status === 'suspended') {
            throw new common_1.UnauthorizedException('Compte suspendu. Contactez le support.');
        }

        const sv = await this.newSessionVersion(user.id);
        const payload = { sub: user.id, role: user.role, sv };
        const accessToken = this.jwt.sign(payload, { expiresIn: '30d' });
        const refreshToken = this.jwt.sign(payload, { expiresIn: '30d' });
        await this.redis.set(`refresh:${user.id}`, refreshToken, REFRESH_TOKEN_TTL);
        return {
            accessToken,
            refreshToken,
            user: { id: user.id, phone: user.phone, email: user.email, name: user.name, role: user.role },
            isNewUser,
        };
    }

    generateReferralCode() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    }
    async applyReferral(userId, referralCode) {
        var _a, _b, _c, _d;
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { referredBy: true },
        });
        if (user === null || user === void 0 ? void 0 : user.referredBy)
            return { success: false, message: 'Vous avez déjà un parrain.' };
        const referrer = await this.prisma.user.findUnique({
            where: { referralCode: referralCode.toUpperCase() },
            select: { id: true },
        });
        if (!referrer)
            return { success: false, message: 'Code de parrainage invalide.' };
        if (referrer.id === userId)
            return { success: false, message: 'Vous ne pouvez pas utiliser votre propre code.' };
        await this.prisma.user.update({
            where: { id: userId },
            data: { referredBy: referrer.id },
        });
        const tariffs = await this.settings.getTariffs();
        const onSignup = (_b = (_a = tariffs.referralBonus) === null || _a === void 0 ? void 0 : _a.onSignup) !== null && _b !== void 0 ? _b : 500;
        const newUserBonus = (_d = (_c = tariffs.referralBonus) === null || _c === void 0 ? void 0 : _c.newUserBonus) !== null && _d !== void 0 ? _d : 300;
        await Promise.all([
            onSignup > 0 ? this.prisma.pointsTransaction.create({ data: { userId: referrer.id, points: onSignup, type: 'credit', label: 'Parrainage accepté', source: 'referral' } }) : Promise.resolve(),
            newUserBonus > 0 ? this.prisma.pointsTransaction.create({ data: { userId, points: newUserBonus, type: 'credit', label: 'Bonus parrainage inscription', source: 'referral' } }) : Promise.resolve(),
        ]);
        return { success: true, message: `${newUserBonus} points offerts ! Votre parrain reçoit ${onSignup} points.` };
    }
    async logout(userId) {
        await this.redis.del(`refresh:${userId}`);
    }
    async getReferralInfo(userId) {
        var _a, _b, _c;
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { referralCode: true, referrals: { select: { id: true } } },
        });
        return {
            referralCode: (_a = user === null || user === void 0 ? void 0 : user.referralCode) !== null && _a !== void 0 ? _a : null,
            referralCount: (_c = (_b = user === null || user === void 0 ? void 0 : user.referrals) === null || _b === void 0 ? void 0 : _b.length) !== null && _c !== void 0 ? _c : 0,
        };
    }
    async getReferralList(userId) {
        const referrals = await this.prisma.user.findMany({
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
            referrals: referrals.map((r) => {
                var _a, _b, _c;
                return ({
                    id: r.id,
                    name: (_a = r.name) !== null && _a !== void 0 ? _a : null,
                    status: ((_c = (_b = r.bookings) === null || _b === void 0 ? void 0 : _b.length) !== null && _c !== void 0 ? _c : 0) > 0 ? 'first_ride_done' : 'registered',
                    createdAt: r.createdAt.toISOString(),
                });
            }),
        };
    }
    async verifyOtp(phone, code, intendedRole, referralCode) {
        var _a;
        const otpKey = `otp:${phone}`;
        const otpData = await this.redis.get(otpKey);
        if (!otpData) {
            throw new common_1.UnauthorizedException('Code OTP expire ou invalide');
        }
        const { code: storedCode, attempts } = JSON.parse(otpData);
        if (attempts >= 3) {
            await this.redis.del(otpKey);
            throw new common_1.UnauthorizedException('Trop de tentatives incorrectes. Demandez un nouveau code.');
        }
        if (storedCode !== code) {
            await this.redis.set(otpKey, JSON.stringify({ code: storedCode, attempts: attempts + 1 }), await this.redis.ttl(otpKey));
            throw new common_1.UnauthorizedException('Code OTP incorrect');
        }
        await this.redis.del(otpKey);
        let user = await this.prisma.user.findUnique({ where: { phone } });
        let isNewUser = false;
        if (!user) {
            const role = intendedRole || 'passenger';
            let newReferralCode = null;
            for (let i = 0; i < 5; i++) {
                const candidate = this.generateReferralCode();
                const exists = await this.prisma.user.findUnique({ where: { referralCode: candidate } });
                if (!exists) {
                    newReferralCode = candidate;
                    break;
                }
            }
            let referrer = null;
            if (referralCode) {
                referrer = await this.prisma.user.findUnique({
                    where: { referralCode: referralCode.toUpperCase() },
                    select: { id: true },
                });
                if (!referrer)
                    throw new common_1.BadRequestException('Code de parrainage invalide.');
            }
            user = await this.prisma.user.create({
                data: {
                    phone,
                    role,
                    referralCode: newReferralCode,
                    referredBy: (_a = referrer === null || referrer === void 0 ? void 0 : referrer.id) !== null && _a !== void 0 ? _a : null,
                },
            });
            isNewUser = true;
            this.logger.log(`New user created: ${user.id} (${(0, helpers_1.maskPhone)(phone)}) role=${role}`);
            if (referrer) {
                const tariffs = await this.settings.getTariffs();
                const referrerBonus = tariffs?.referralBonus?.onSignup ?? 500;
                const newUserBonus = tariffs?.referralBonus?.newUserBonus ?? 300;
                await Promise.all([
                    this.prisma.pointsTransaction.create({
                        data: { userId: referrer.id, type: 'credit', points: referrerBonus, label: `Parrainage — nouvel inscrit`, source: 'referral' },
                    }),
                    this.prisma.pointsTransaction.create({
                        data: { userId: user.id, type: 'credit', points: newUserBonus, label: `Bonus parrainage à l'inscription`, source: 'referral' },
                    }),
                ]);
                this.logger.log(`Referral bonus: ${referrerBonus} pts → parrain ${referrer.id} + ${newUserBonus} pts → filleul ${user.id}`);
            }
        }
        else {
            this.logger.log(`User logged in: ${user.id} (${(0, helpers_1.maskPhone)(phone)})`);
        }
        if (user.status === 'suspended') {
            throw new common_1.UnauthorizedException('Compte suspendu. Contactez le support.');
        }
        const sv = await this.newSessionVersion(user.id);
        const payload = { sub: user.id, role: user.role, sv };
        const accessToken = this.jwt.sign(payload, { expiresIn: '30d' });
        const refreshToken = this.jwt.sign(payload, { expiresIn: '30d' });
        await this.redis.set(`refresh:${user.id}`, refreshToken, REFRESH_TOKEN_TTL);
        return {
            accessToken,
            refreshToken,
            user: { id: user.id, phone: user.phone, name: user.name, role: user.role },
            isNewUser,
        };
    }
    async refreshToken(refreshToken) {
        try {
            const payload = this.jwt.verify(refreshToken);
            const userId = payload.sub;
            const storedToken = await this.redis.get(`refresh:${userId}`);
            if (storedToken !== refreshToken) {
                throw new common_1.UnauthorizedException('Token de rafraichissement invalide');
            }
            const user = await this.prisma.user.findUnique({ where: { id: userId } });
            if (!user || user.status === 'suspended') {
                throw new common_1.UnauthorizedException('Utilisateur introuvable ou suspendu');
            }
            const sv = await this.currentSessionVersion(user.id);
            const newPayload = { sub: user.id, role: user.role, sv };
            const newAccessToken = this.jwt.sign(newPayload, { expiresIn: '30d' });
            const newRefreshToken = this.jwt.sign(newPayload, { expiresIn: '30d' });
            await this.redis.set(`refresh:${user.id}`, newRefreshToken, REFRESH_TOKEN_TTL);
            return { accessToken: newAccessToken, refreshToken: newRefreshToken };
        }
        catch (_a) {
            throw new common_1.UnauthorizedException('Token invalide ou expire');
        }
    }
    async googleLogin(code, codeVerifier, redirectUri, intendedRole = 'passenger') {
        // Check feature flag
        const googleEnabled = await this.settings.get('auth_google_enabled', 'true');
        if (googleEnabled === 'false') {
            throw new common_1.BadRequestException('La connexion Google est désactivée.');
        }
        // Use DB credentials if configured, fall back to env vars
        const clientId = (await this.settings.get('auth_google_client_id', '')) || this.config.get('GOOGLE_CLIENT_ID', '');
        const clientSecret = (await this.settings.get('auth_google_client_secret', '')) || this.config.get('GOOGLE_CLIENT_SECRET', '');

        if (!clientId || !clientSecret) {
            throw new common_1.BadRequestException('Google OAuth non configuré. Contactez l\'administrateur.');
        }

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
            throw new common_1.UnauthorizedException('Echec echange code Google');
        }
        const { access_token } = await tokenRes.json();
        const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { Authorization: `Bearer ${access_token}` },
        });
        if (!response.ok) {
            throw new common_1.UnauthorizedException('Token Google invalide');
        }
        const googleUser = await response.json();
        const { sub: googleId, email, name } = googleUser;
        let user = await this.prisma.user.findUnique({ where: { googleId } });
        let isNewUser = false;
        if (!user && email) {
            user = await this.prisma.user.findFirst({ where: { email } });
            if (user) {
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
        }
        else {
            this.logger.log(`User logged in via Google: ${user.id} (${email})`);
        }
        if (user.status === 'suspended') {
            throw new common_1.UnauthorizedException('Compte suspendu. Contactez le support.');
        }
        const svGoogle = await this.newSessionVersion(user.id);
        const payload = { sub: user.id, role: user.role, sv: svGoogle };
        const newAccessToken = this.jwt.sign(payload, { expiresIn: '30d' });
        const refreshToken = this.jwt.sign(payload, { expiresIn: '30d' });
        await this.redis.set(`refresh:${user.id}`, refreshToken, REFRESH_TOKEN_TTL);
        return {
            accessToken: newAccessToken,
            refreshToken,
            user: { id: user.id, phone: user.phone, name: user.name, role: user.role },
            isNewUser,
        };
    }
    async googleStart(deepLink, res) {
        // Check feature flag
        const googleEnabled = await this.settings.get('auth_google_enabled', 'true');
        if (googleEnabled === 'false') {
            throw new common_1.BadRequestException('La connexion Google est désactivée.');
        }
        const clientId = (await this.settings.get('auth_google_client_id', '')) || this.config.get('GOOGLE_CLIENT_ID', '');
        if (!clientId) {
            res.status(400).json({ message: 'Google OAuth non configuré.' });
            return;
        }
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
    async googleCallback(code, state, res) {
        const clientId = (await this.settings.get('auth_google_client_id', '')) || this.config.get('GOOGLE_CLIENT_ID', '');
        const clientSecret = (await this.settings.get('auth_google_client_secret', '')) || this.config.get('GOOGLE_CLIENT_SECRET', '');
        const redirectUri = this.config.get('BACKEND_URL', 'https://aerocab-api.onrender.com') + '/api/auth/google/callback';
        const deepLink = state ? Buffer.from(state, 'base64').toString('utf8') : '';
        try {
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
            const { access_token } = await tokenRes.json();
            const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                headers: { Authorization: `Bearer ${access_token}` },
            });
            const googleUser = await userRes.json();
            const { sub: googleId, email, name } = googleUser;
            const roleFromDeepLink = deepLink.startsWith('aerogo24-driver://') ? 'driver' : 'passenger';
            let isNewUser = false;
            let user = await this.prisma.user.findUnique({ where: { googleId } });
            if (!user && email)
                user = await this.prisma.user.findFirst({ where: { email } });
            if (user && !user.googleId)
                user = await this.prisma.user.update({ where: { id: user.id }, data: { googleId } });
            if (!user) {
                user = await this.prisma.user.create({ data: { googleId, email, name, role: roleFromDeepLink } });
                isNewUser = true;
            }
            const svCb = await this.newSessionVersion(user.id);
            const payload = { sub: user.id, role: user.role, sv: svCb };
            const accessToken = this.jwt.sign(payload, { expiresIn: '30d' });
            const refreshToken = this.jwt.sign(payload, { expiresIn: '30d' });
            await this.redis.set(`refresh:${user.id}`, refreshToken, REFRESH_TOKEN_TTL);
            const authCode = require('crypto').randomBytes(32).toString('hex');
            await this.redis.set(`google_auth_code:${authCode}`, JSON.stringify({ accessToken, refreshToken, userId: user.id, userName: user.name || '', userRole: user.role, isNewUser }), 30);
            const returnUrl = `${deepLink}?authCode=${authCode}`;
            res.redirect(returnUrl);
        }
        catch (e) {
            this.logger.error('Google callback error', e);
            res.redirect(`${deepLink}?error=google_auth_failed`);
        }
    }
    async exchangeGoogleAuthCode(authCode) {
        if (!/^[a-f0-9]{64}$/.test(authCode)) {
            throw new common_1.BadRequestException('Code d\'authentification invalide ou expiré');
        }
        const raw = await this.redis.get(`google_auth_code:${authCode}`);
        if (!raw) {
            throw new common_1.BadRequestException('Code d\'authentification invalide ou expiré');
        }
        await this.redis.del(`google_auth_code:${authCode}`);
        return JSON.parse(raw);
    }
    async getMe(userId) {
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
            throw new common_1.UnauthorizedException('Utilisateur introuvable');
        }
        return user;
    }

    // ── Auth providers config (for admin) ─────────────────────────────────────
    async getAuthProvidersConfig() {
        const [emailOtpEnabled, googleEnabled, googleClientId] = await Promise.all([
            this.settings.get('auth_email_otp_enabled', 'true'),
            this.settings.get('auth_google_enabled', 'true'),
            this.settings.get('auth_google_client_id', ''),
        ]);
        return {
            emailOtpEnabled: emailOtpEnabled !== 'false',
            googleEnabled: googleEnabled !== 'false',
            googleClientId: googleClientId || '',
            // Never expose secret
        };
    }
};
exports.AuthService = AuthService;
exports.AuthService = AuthService = AuthService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        redis_service_1.RedisService,
        jwt_1.JwtService,
        config_1.ConfigService,
        otp_delivery_service_1.OtpDeliveryService,
        settings_service_1.SettingsService,
        email_router_service_1.EmailRouterService])
], AuthService);
//# sourceMappingURL=auth.service.js.map
