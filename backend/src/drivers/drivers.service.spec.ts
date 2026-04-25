import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { DriversService } from './drivers.service';
import { PrismaService } from '../database/prisma.service';
import { RidesGateway } from '../bookings/rides.gateway';
import { makeWallet, makeWithdrawalRequest } from '../../test/factories';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockPrisma = {
  wallet:             { findUnique: jest.fn() },
  withdrawalRequest:  { findFirst: jest.fn(), create: jest.fn() },
  driverProfile:      { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn(), create: jest.fn() },
  booking:            { findMany: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn() },
  driverDocument:     { upsert: jest.fn() },
  driverPosition:     { create: jest.fn() },
  user:               { update: jest.fn() },
};

const mockGateway = {
  server: { to: jest.fn().mockReturnValue({ emit: jest.fn() }) },
};

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('DriversService', () => {
  let service: DriversService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DriversService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: RidesGateway,  useValue: mockGateway },
      ],
    }).compile();

    service = module.get<DriversService>(DriversService);
  });

  // ── requestWithdrawal ────────────────────────────────────────────────────────

  describe('requestWithdrawal', () => {
    const userId  = 'user-1';
    const amount  = 5000;
    const method  = 'orange_money';

    const setupSuccess = () => {
      mockPrisma.wallet.findUnique.mockResolvedValue(makeWallet({ userId, balance: 10000 }));
      mockPrisma.withdrawalRequest.findFirst.mockResolvedValue(null);
      mockPrisma.withdrawalRequest.create.mockResolvedValue(
        makeWithdrawalRequest({ userId, amount, method }),
      );
    };

    it('accepte un numéro au format +237XXXXXXXXX', async () => {
      setupSuccess();
      await expect(
        service.requestWithdrawal(userId, amount, method, '+237699000001'),
      ).resolves.toBeDefined();
    });

    it('accepte un numéro sans préfixe + (237XXXXXXXXX)', async () => {
      setupSuccess();
      await expect(
        service.requestWithdrawal(userId, amount, method, '237699000001'),
      ).resolves.toBeDefined();
    });

    it('rejette un numéro trop court (7 chiffres)', async () => {
      await expect(
        service.requestWithdrawal(userId, amount, method, '1234567'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejette un numéro contenant des lettres', async () => {
      await expect(
        service.requestWithdrawal(userId, amount, method, '+23769900ABC1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejette une chaîne vide', async () => {
      await expect(
        service.requestWithdrawal(userId, amount, method, ''),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejette une méthode invalide (non dans l\'enum)', async () => {
      await expect(
        service.requestWithdrawal(userId, amount, 'paypal', '+237699000001'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejette si le solde du wallet est insuffisant', async () => {
      mockPrisma.wallet.findUnique.mockResolvedValue(makeWallet({ userId, balance: 1000 }));
      await expect(
        service.requestWithdrawal(userId, 5000, method, '+237699000001'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejette s\'il existe déjà un retrait pending', async () => {
      mockPrisma.wallet.findUnique.mockResolvedValue(makeWallet({ userId, balance: 10000 }));
      mockPrisma.withdrawalRequest.findFirst.mockResolvedValue(
        makeWithdrawalRequest({ userId, status: 'pending' }),
      );
      await expect(
        service.requestWithdrawal(userId, amount, method, '+237699000001'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejette un montant de 0', async () => {
      await expect(
        service.requestWithdrawal(userId, 0, method, '+237699000001'),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
