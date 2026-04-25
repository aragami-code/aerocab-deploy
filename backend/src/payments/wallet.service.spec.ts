import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { PrismaService } from '../database/prisma.service';
import { makeWallet, makeTransaction } from '../../test/factories';

const mockTx = {
  wallet: { findUnique: jest.fn(), update: jest.fn() },
  transaction: { create: jest.fn() },
};

const mockPrisma = {
  wallet: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  $transaction: jest.fn((fn: (tx: typeof mockTx) => Promise<any>) => fn(mockTx)),
};

describe('WalletService', () => {
  let service: WalletService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WalletService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<WalletService>(WalletService);
  });

  describe('getOrCreateWallet', () => {
    it('retourne le wallet existant si présent', async () => {
      const wallet = makeWallet({ userId: 'u-1', balance: 5000 });
      mockPrisma.wallet.findUnique.mockResolvedValue(wallet);
      const result = await service.getOrCreateWallet('u-1');
      expect(result.balance).toBe(5000);
      expect(mockPrisma.wallet.create).not.toHaveBeenCalled();
    });

    it('crée un wallet à 0 si absent', async () => {
      mockPrisma.wallet.findUnique.mockResolvedValue(null);
      const newWallet = makeWallet({ userId: 'u-2', balance: 0 });
      mockPrisma.wallet.create.mockResolvedValue(newWallet);
      const result = await service.getOrCreateWallet('u-2');
      expect(result.balance).toBe(0);
    });
  });

  describe('hasSufficientFunds', () => {
    it('retourne true si solde suffisant', async () => {
      mockPrisma.wallet.findUnique.mockResolvedValue(makeWallet({ balance: 10000 }));
      expect(await service.hasSufficientFunds('u-1', 5000)).toBe(true);
    });

    it('retourne true si solde exactement égal', async () => {
      mockPrisma.wallet.findUnique.mockResolvedValue(makeWallet({ balance: 5000 }));
      expect(await service.hasSufficientFunds('u-1', 5000)).toBe(true);
    });

    it('retourne false si solde insuffisant', async () => {
      mockPrisma.wallet.findUnique.mockResolvedValue(makeWallet({ balance: 2000 }));
      expect(await service.hasSufficientFunds('u-1', 5000)).toBe(false);
    });

    it('retourne false pour wallet absent et montant > 0', async () => {
      mockPrisma.wallet.findUnique.mockResolvedValue(null);
      mockPrisma.wallet.create.mockResolvedValue(makeWallet({ balance: 0 }));
      expect(await service.hasSufficientFunds('u-new', 1000)).toBe(false);
    });
  });

  describe('createTransaction', () => {
    it('crédite le wallet pour un dépôt', async () => {
      const wallet = makeWallet({ id: 'w-1', balance: 5000 });
      mockTx.wallet.findUnique.mockResolvedValue(wallet);
      mockTx.transaction.create.mockResolvedValue(makeTransaction({ walletId: 'w-1', amount: 3000, type: 'deposit' }));
      mockTx.wallet.update.mockResolvedValue({});
      await service.createTransaction('w-1', 3000, 'deposit' as any);
      expect(mockTx.wallet.update).toHaveBeenCalledWith({
        where: { id: 'w-1' },
        data: { balance: { increment: 3000 } },
      });
    });

    it('débite le wallet pour un paiement', async () => {
      const wallet = makeWallet({ id: 'w-1', balance: 10000 });
      mockTx.wallet.findUnique.mockResolvedValue(wallet);
      mockTx.transaction.create.mockResolvedValue(makeTransaction({ walletId: 'w-1', amount: 4000, type: 'payment' }));
      mockTx.wallet.update.mockResolvedValue({});
      await service.createTransaction('w-1', 4000, 'payment' as any);
      expect(mockTx.wallet.update).toHaveBeenCalledWith({
        where: { id: 'w-1' },
        data: { balance: { increment: -4000 } },
      });
    });

    it('lance BadRequestException si solde insuffisant pour paiement', async () => {
      mockTx.wallet.findUnique.mockResolvedValue(makeWallet({ id: 'w-1', balance: 1000 }));
      await expect(service.createTransaction('w-1', 5000, 'payment' as any)).rejects.toThrow(BadRequestException);
    });

    it('lance BadRequestException si solde insuffisant pour retrait', async () => {
      mockTx.wallet.findUnique.mockResolvedValue(makeWallet({ id: 'w-1', balance: 500 }));
      await expect(service.createTransaction('w-1', 1000, 'withdrawal' as any)).rejects.toThrow(BadRequestException);
    });

    it('lance BadRequestException si wallet introuvable', async () => {
      mockTx.wallet.findUnique.mockResolvedValue(null);
      await expect(service.createTransaction('w-inexistant', 100, 'deposit' as any)).rejects.toThrow(BadRequestException);
    });

    it('accepte un dépôt même si solde est 0', async () => {
      mockTx.wallet.findUnique.mockResolvedValue(makeWallet({ id: 'w-1', balance: 0 }));
      mockTx.transaction.create.mockResolvedValue(makeTransaction());
      mockTx.wallet.update.mockResolvedValue({});
      await expect(service.createTransaction('w-1', 5000, 'deposit' as any)).resolves.not.toThrow();
    });
  });
});
