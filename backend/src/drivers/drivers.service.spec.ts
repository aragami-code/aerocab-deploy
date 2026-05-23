import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { DriversService } from './drivers.service';
import { PrismaService } from '../database/prisma.service';
import { RidesGateway } from '../bookings/rides.gateway';
import { SettingsService } from '../settings/settings.service';
import { BookingsService } from '../bookings/bookings.service';
import { NotchPayService } from '../payments/notchpay.service';
import { makeWallet, makeWithdrawalRequest, makeTransaction } from '../../test/factories';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockPrisma = {
  wallet:             { findUnique: jest.fn() },
  withdrawalRequest:  { findFirst: jest.fn(), create: jest.fn(), aggregate: jest.fn() },
  driverProfile:      { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn(), create: jest.fn() },
  booking:            { findMany: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn() },
  driverDocument:     { upsert: jest.fn() },
  driverPosition:     { create: jest.fn() },
  user:               { update: jest.fn(), findUnique: jest.fn() },
  transaction:        { findFirst: jest.fn() },
};

const mockGateway = {
  server: { to: jest.fn().mockReturnValue({ emit: jest.fn() }) },
};

const mockNotchpay = {
  initiate:     jest.fn().mockResolvedValue({ paymentUrl: 'https://pay.test' }),
  isConfigured: jest.fn().mockResolvedValue(false),
};

// Default: all security limits at standard values
const mockSettings = {
  get: jest.fn(async (key: string) => {
    const defaults: Record<string, string> = {
      withdrawal_max_daily_amount:  '200000',
      withdrawal_min_amount:        '1000',
      withdrawal_max_amount:        '100000',
      withdrawal_carence_hours:     '24',
    };
    return defaults[key] ?? 'true';
  }),
};

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('DriversService', () => {
  let service: DriversService;

  const USER_ID = 'user-1';
  const USER_PHONE = '+237699000001';

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DriversService,
        { provide: PrismaService,   useValue: mockPrisma   },
        { provide: RidesGateway,    useValue: mockGateway  },
        { provide: SettingsService, useValue: mockSettings },
        { provide: BookingsService, useValue: {}           },
        { provide: NotchPayService, useValue: mockNotchpay },
      ],
    }).compile();

    service = module.get<DriversService>(DriversService);
  });

  // ── requestWithdrawal — validation de base ───────────────────────────────────

  describe('requestWithdrawal — validation de base', () => {
    const amount = 5000;
    const method = 'orange_money';

    const setupSuccess = () => {
      const wallet = makeWallet({ userId: USER_ID, balance: 50000 });
      mockPrisma.wallet.findUnique.mockResolvedValue(wallet);
      mockPrisma.user.findUnique.mockResolvedValue({ phone: USER_PHONE });
      mockPrisma.withdrawalRequest.findFirst.mockResolvedValue(null);
      mockPrisma.withdrawalRequest.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
      mockPrisma.transaction.findFirst.mockResolvedValue(null); // pas de dépôt récent
      mockPrisma.withdrawalRequest.create.mockResolvedValue(
        makeWithdrawalRequest({ userId: USER_ID, amount, method }),
      );
    };

    it('accepte un numéro au format +237XXXXXXXXX', async () => {
      setupSuccess();
      await expect(
        service.requestWithdrawal(USER_ID, amount, method, '+237699000001'),
      ).resolves.toBeDefined();
    });

    it('accepte un numéro sans préfixe + (237XXXXXXXXX)', async () => {
      setupSuccess();
      await expect(
        service.requestWithdrawal(USER_ID, amount, method, '237699000001'),
      ).resolves.toBeDefined();
    });

    it('rejette un numéro trop court (7 chiffres)', async () => {
      await expect(
        service.requestWithdrawal(USER_ID, amount, method, '1234567'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejette un numéro contenant des lettres', async () => {
      await expect(
        service.requestWithdrawal(USER_ID, amount, method, '+23769900ABC1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejette une chaîne vide', async () => {
      await expect(
        service.requestWithdrawal(USER_ID, amount, method, ''),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejette une méthode invalide', async () => {
      await expect(
        service.requestWithdrawal(USER_ID, amount, 'paypal', '+237699000001'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejette un montant de 0', async () => {
      await expect(
        service.requestWithdrawal(USER_ID, 0, method, '+237699000001'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejette si le solde du wallet est insuffisant', async () => {
      mockPrisma.wallet.findUnique.mockResolvedValue(makeWallet({ userId: USER_ID, balance: 1000 }));
      mockPrisma.user.findUnique.mockResolvedValue({ phone: USER_PHONE });
      mockPrisma.withdrawalRequest.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
      await expect(
        service.requestWithdrawal(USER_ID, 5000, method, '+237699000001'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejette s\'il existe déjà un retrait pending', async () => {
      mockPrisma.wallet.findUnique.mockResolvedValue(makeWallet({ userId: USER_ID, balance: 50000 }));
      mockPrisma.user.findUnique.mockResolvedValue({ phone: USER_PHONE });
      mockPrisma.withdrawalRequest.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
      mockPrisma.withdrawalRequest.findFirst.mockResolvedValue(
        makeWithdrawalRequest({ userId: USER_ID, status: 'pending' }),
      );
      await expect(
        service.requestWithdrawal(USER_ID, amount, method, '+237699000001'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── requestWithdrawal — contrôles de sécurité ────────────────────────────────

  describe('requestWithdrawal — contrôles de sécurité', () => {
    const method = 'orange_money';

    const setupBase = (balance = 50000) => {
      const wallet = makeWallet({ id: 'wallet-1', userId: USER_ID, balance });
      mockPrisma.wallet.findUnique.mockResolvedValue(wallet);
      mockPrisma.user.findUnique.mockResolvedValue({ phone: USER_PHONE });
      mockPrisma.withdrawalRequest.findFirst.mockResolvedValue(null);
      mockPrisma.withdrawalRequest.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
      mockPrisma.transaction.findFirst.mockResolvedValue(null);
      mockPrisma.withdrawalRequest.create.mockResolvedValue(
        makeWithdrawalRequest({ userId: USER_ID, method }),
      );
      return wallet;
    };

    it('rejette si montant < minimum (1 000 XAF)', async () => {
      setupBase();
      await expect(
        service.requestWithdrawal(USER_ID, 500, method, '+237699000001'),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepte si montant = minimum exact (1 000 XAF)', async () => {
      setupBase(50000);
      await expect(
        service.requestWithdrawal(USER_ID, 1000, method, '+237699000001'),
      ).resolves.toBeDefined();
    });

    it('rejette si montant > maximum par demande (100 000 XAF)', async () => {
      setupBase(500000);
      await expect(
        service.requestWithdrawal(USER_ID, 110000, method, '+237699000001'),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepte si montant = maximum exact (100 000 XAF)', async () => {
      setupBase(500000);
      await expect(
        service.requestWithdrawal(USER_ID, 100000, method, '+237699000001'),
      ).resolves.toBeDefined();
    });

    it('rejette si le plafond journalier est dépassé', async () => {
      setupBase(500000);
      // Déjà 180 000 retirés aujourd'hui, on demande 30 000 → total 210 000 > 200 000
      mockPrisma.withdrawalRequest.aggregate.mockResolvedValue({ _sum: { amount: 180000 } });
      await expect(
        service.requestWithdrawal(USER_ID, 30000, method, '+237699000001'),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepte si le total journalier reste sous le plafond', async () => {
      setupBase(500000);
      // Déjà 150 000, on demande 40 000 → 190 000 < 200 000
      mockPrisma.withdrawalRequest.aggregate.mockResolvedValue({ _sum: { amount: 150000 } });
      await expect(
        service.requestWithdrawal(USER_ID, 40000, method, '+237699000001'),
      ).resolves.toBeDefined();
    });

    it('rejette si la carence n\'est pas écoulée (dépôt il y a 2h, carence 24h)', async () => {
      const wallet = setupBase();
      const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000);
      mockPrisma.transaction.findFirst.mockResolvedValue(
        makeTransaction({ walletId: wallet.id, type: 'deposit', status: 'completed', createdAt: twoHoursAgo }),
      );
      await expect(
        service.requestWithdrawal(USER_ID, 5000, method, '+237699000001'),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepte si la carence est écoulée (dépôt il y a 30h, carence 24h)', async () => {
      const wallet = setupBase();
      const thirtyHoursAgo = new Date(Date.now() - 30 * 3_600_000);
      mockPrisma.transaction.findFirst.mockResolvedValue(
        makeTransaction({ walletId: wallet.id, type: 'deposit', status: 'completed', createdAt: thirtyHoursAgo }),
      );
      await expect(
        service.requestWithdrawal(USER_ID, 5000, method, '+237699000001'),
      ).resolves.toBeDefined();
    });

    it('accepte si aucun dépôt préalable (carence non applicable)', async () => {
      setupBase();
      mockPrisma.transaction.findFirst.mockResolvedValue(null);
      await expect(
        service.requestWithdrawal(USER_ID, 5000, method, '+237699000001'),
      ).resolves.toBeDefined();
    });

    it('rejette si le numéro ne correspond pas au profil (8 derniers chiffres)', async () => {
      setupBase();
      // Profil: +237699000001, soumis: +237699000099 → tails différentes (00001 ≠ 00099)
      await expect(
        service.requestWithdrawal(USER_ID, 5000, method, '+237699000099'),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepte si les 8 derniers chiffres correspondent (même numéro, format différent)', async () => {
      setupBase();
      // Profil: +237699000001 → tail = 99000001
      // Soumis: 237699000001 → même tail
      await expect(
        service.requestWithdrawal(USER_ID, 5000, method, '237699000001'),
      ).resolves.toBeDefined();
    });
  });
});
