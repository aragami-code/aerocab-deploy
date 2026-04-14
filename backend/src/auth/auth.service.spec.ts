import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../redis/redis.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { OtpDeliveryService } from '../otp/otp-delivery.service';
import { SettingsService } from '../settings/settings.service';

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  pointsTransaction: {
    create: jest.fn(),
  },
};

const mockRedis = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  incr: jest.fn(),
  expire: jest.fn(),
  ttl: jest.fn(),
};

const mockJwt = { sign: jest.fn().mockReturnValue('token-abc') };
const mockConfig = { get: jest.fn((key: string, fallback?: any) => fallback ?? undefined) };
const mockSms = { sendOtp: jest.fn().mockResolvedValue(true) };
const mockSettings = {
  get: jest.fn((key: string, fallback?: string) => Promise.resolve(fallback ?? '')),
};

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService,     useValue: mockPrisma   },
        { provide: RedisService,      useValue: mockRedis    },
        { provide: JwtService,        useValue: mockJwt      },
        { provide: ConfigService,     useValue: mockConfig   },
        { provide: OtpDeliveryService,useValue: mockSms      },
        { provide: SettingsService,   useValue: mockSettings },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  // ── sendOtp — H6 : rate limit global ────────────────────────────────────────

  describe('sendOtp — rate limit global (H6)', () => {
    const phone = '+237600000000';

    const setupNormal = () => {
      // Global counter en dessous du seuil
      mockRedis.incr.mockResolvedValue(1);
      mockRedis.expire.mockResolvedValue(1);
      mockRedis.get.mockImplementation((key: string) => {
        if (key === 'otp_global_limit') return Promise.resolve('500');
        if (key === `otp_rate:${phone}`) return Promise.resolve(null);
        return Promise.resolve(null);
      });
      mockRedis.set.mockResolvedValue('OK');
      mockRedis.ttl.mockResolvedValue(60);
      mockSettings.get.mockImplementation((key: string, fallback?: string) =>
        Promise.resolve(key === 'test_mode_enabled' ? 'false' : (fallback ?? '')),
      );
    };

    it('envoie l\'OTP si le rate limit n\'est pas atteint', async () => {
      setupNormal();
      const result = await service.sendOtp(phone);
      expect(result).toHaveProperty('message');
      expect(mockSms.sendOtp).toHaveBeenCalledTimes(1);
    });

    it('lève BadRequestException si le compteur global dépasse le seuil', async () => {
      mockRedis.incr.mockResolvedValue(501); // dépasse 500
      mockRedis.get.mockImplementation((key: string) => {
        if (key === 'otp_global_limit') return Promise.resolve('500');
        return Promise.resolve(null);
      });
      mockRedis.expire.mockResolvedValue(1);

      await expect(service.sendOtp(phone)).rejects.toThrow(BadRequestException);
      expect(mockSms.sendOtp).not.toHaveBeenCalled();
    });

    it('initialise le TTL du compteur global à sa première incrémentation', async () => {
      setupNormal();
      mockRedis.incr.mockResolvedValue(1); // première incrémentation
      await service.sendOtp(phone);
      expect(mockRedis.expire).toHaveBeenCalledWith('otp_global_rate', 60);
    });

    it('n\'initialise pas le TTL si ce n\'est pas la première incrémentation', async () => {
      setupNormal();
      mockRedis.incr.mockResolvedValue(2); // pas la première
      await service.sendOtp(phone);
      // expire ne devrait PAS être appelé pour otp_global_rate (seulement pour otp_rate:phone)
      const expireCalls = mockRedis.expire.mock.calls;
      expect(expireCalls.some((c: string[]) => c[0] === 'otp_global_rate')).toBe(false);
    });

    it('respecte la limite configurable via otp_global_limit', async () => {
      mockRedis.incr.mockResolvedValue(11); // dépasse 10
      mockRedis.get.mockImplementation((key: string) => {
        if (key === 'otp_global_limit') return Promise.resolve('10');
        return Promise.resolve(null);
      });
      mockRedis.expire.mockResolvedValue(1);

      await expect(service.sendOtp(phone)).rejects.toThrow(BadRequestException);
    });
  });

  // ── exchangeGoogleAuthCode — C1 ─────────────────────────────────────────────

  describe('exchangeGoogleAuthCode (C1)', () => {
    const validCode = 'a'.repeat(64); // 64 chars hex valides

    it('retourne le payload si le code est valide', async () => {
      const payload = { accessToken: 'at', refreshToken: 'rt', userId: 'u1', userName: 'Test', userRole: 'passenger', isNewUser: false };
      mockRedis.get.mockResolvedValue(JSON.stringify(payload));
      mockRedis.del.mockResolvedValue(1);

      const result = await service.exchangeGoogleAuthCode(validCode);
      expect(result).toEqual(payload);
    });

    it('supprime le code après usage (usage unique)', async () => {
      const payload = { accessToken: 'at', refreshToken: 'rt', userId: 'u1', userName: 'Test', userRole: 'passenger', isNewUser: false };
      mockRedis.get.mockResolvedValue(JSON.stringify(payload));
      mockRedis.del.mockResolvedValue(1);

      await service.exchangeGoogleAuthCode(validCode);
      expect(mockRedis.del).toHaveBeenCalledWith(`google_auth_code:${validCode}`);
    });

    it('lève BadRequestException si le code est expiré ou inexistant', async () => {
      mockRedis.get.mockResolvedValue(null);

      await expect(service.exchangeGoogleAuthCode(validCode)).rejects.toThrow(BadRequestException);
      expect(mockRedis.del).not.toHaveBeenCalled();
    });

    it('lève BadRequestException si le format est invalide (trop court)', async () => {
      await expect(service.exchangeGoogleAuthCode('abc123')).rejects.toThrow(BadRequestException);
      expect(mockRedis.get).not.toHaveBeenCalled();
    });

    it('lève BadRequestException si le format contient des caractères non-hex', async () => {
      const badCode = 'z'.repeat(64); // 'z' n'est pas hex
      await expect(service.exchangeGoogleAuthCode(badCode)).rejects.toThrow(BadRequestException);
      expect(mockRedis.get).not.toHaveBeenCalled();
    });

    it('lève BadRequestException si le code fait exactement 63 chars (trop court d\'un)', async () => {
      const shortCode = 'a'.repeat(63);
      await expect(service.exchangeGoogleAuthCode(shortCode)).rejects.toThrow(BadRequestException);
    });

    it('lève BadRequestException si le code fait exactement 65 chars (trop long d\'un)', async () => {
      const longCode = 'a'.repeat(65);
      await expect(service.exchangeGoogleAuthCode(longCode)).rejects.toThrow(BadRequestException);
    });
  });

  // ── applyReferral — fix referredBy ──────────────────────────────────────────

  describe('applyReferral (fix referredBy)', () => {
    const userId = 'user-filleul';
    const referrerId = 'user-parrain';
    const referralCode = 'PARRAIN1';

    it('applique le parrainage et crédite les deux parties', async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({ referredBy: null }) // user n'a pas encore de parrain
        .mockResolvedValueOnce({ id: referrerId });   // le parrain existe
      mockPrisma.user.update.mockResolvedValue({});
      mockPrisma.pointsTransaction.create.mockResolvedValue({});

      const result = await service.applyReferral(userId, referralCode);
      expect(result.success).toBe(true);
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: userId },
        data: { referredBy: referrerId },
      });
      expect(mockPrisma.pointsTransaction.create).toHaveBeenCalledTimes(2);
    });

    it('refuse si l\'utilisateur a déjà un parrain (referredBy non null)', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({ referredBy: 'autre-parrain' });

      const result = await service.applyReferral(userId, referralCode);
      expect(result.success).toBe(false);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('refuse si le code de parrainage est invalide', async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({ referredBy: null })
        .mockResolvedValueOnce(null); // code inconnu

      const result = await service.applyReferral(userId, 'INVALID');
      expect(result.success).toBe(false);
    });

    it('refuse si l\'utilisateur essaie d\'utiliser son propre code', async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({ referredBy: null })
        .mockResolvedValueOnce({ id: userId }); // même ID que le filleul

      const result = await service.applyReferral(userId, referralCode);
      expect(result.success).toBe(false);
    });
  });
});
