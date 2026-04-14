import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PointsService } from './points.service';
import { PrismaService } from '../database/prisma.service';

const mockTx = {
  pointsTransaction: {
    aggregate: jest.fn(),
    create: jest.fn(),
  },
};

const mockPrisma = {
  pointsTransaction: {
    aggregate: jest.fn(),
    create: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  },
  $transaction: jest.fn((fn: (tx: typeof mockTx) => Promise<any>) => fn(mockTx)),
};

describe('PointsService', () => {
  let service: PointsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PointsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<PointsService>(PointsService);
  });

  // ── getBalance ──────────────────────────────────────────────────────────────

  describe('getBalance', () => {
    it('retourne le solde agrégé', async () => {
      mockPrisma.pointsTransaction.aggregate.mockResolvedValue({ _sum: { points: 1500 } });
      const result = await service.getBalance('user-1');
      expect(result).toEqual({ balance: 1500 });
      expect(mockPrisma.pointsTransaction.aggregate).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        _sum: { points: true },
      });
    });

    it('retourne 0 si aucune transaction', async () => {
      mockPrisma.pointsTransaction.aggregate.mockResolvedValue({ _sum: { points: null } });
      const result = await service.getBalance('user-empty');
      expect(result).toEqual({ balance: 0 });
    });
  });

  // ── getHistory ──────────────────────────────────────────────────────────────

  describe('getHistory', () => {
    it('retourne les transactions paginées', async () => {
      const txs = [{ id: 't1', type: 'credit', points: 500, label: 'Bonus parrainage', createdAt: new Date() }];
      mockPrisma.pointsTransaction.findMany.mockResolvedValue(txs);
      mockPrisma.pointsTransaction.count.mockResolvedValue(1);

      const result = await service.getHistory('user-1', 1, 20);
      expect(result.data).toEqual(txs);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
    });
  });

  // ── addPoints ───────────────────────────────────────────────────────────────

  describe('addPoints', () => {
    it('crée une transaction credit pour un montant positif', async () => {
      mockPrisma.pointsTransaction.create.mockResolvedValue({ id: 'tx1' });
      await service.addPoints('user-1', 500, 'Bonus parrainage');
      expect(mockPrisma.pointsTransaction.create).toHaveBeenCalledWith({
        data: { userId: 'user-1', type: 'credit', points: 500, label: 'Bonus parrainage' },
      });
    });

    it('crée une transaction debit pour un montant négatif', async () => {
      mockPrisma.pointsTransaction.create.mockResolvedValue({ id: 'tx2' });
      await service.addPoints('user-1', -200, 'Ajustement');
      expect(mockPrisma.pointsTransaction.create).toHaveBeenCalledWith({
        data: { userId: 'user-1', type: 'debit', points: -200, label: 'Ajustement' },
      });
    });
  });

  // ── deductPoints (H2 — atomicité) ───────────────────────────────────────────

  describe('deductPoints', () => {
    it('déduit si le solde est suffisant', async () => {
      mockTx.pointsTransaction.aggregate.mockResolvedValue({ _sum: { points: 1000 } });
      mockTx.pointsTransaction.create.mockResolvedValue({ id: 'debit-1' });

      await service.deductPoints('user-1', 500, 'Paiement course');

      expect(mockTx.pointsTransaction.aggregate).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        _sum: { points: true },
      });
      expect(mockTx.pointsTransaction.create).toHaveBeenCalledWith({
        data: { userId: 'user-1', type: 'debit', points: -500, label: 'Paiement course' },
      });
    });

    it('lève BadRequestException si solde insuffisant', async () => {
      mockTx.pointsTransaction.aggregate.mockResolvedValue({ _sum: { points: 200 } });

      await expect(service.deductPoints('user-1', 500, 'Paiement course'))
        .rejects.toThrow(BadRequestException);
    });

    it('lève BadRequestException si solde null (aucune transaction)', async () => {
      mockTx.pointsTransaction.aggregate.mockResolvedValue({ _sum: { points: null } });

      await expect(service.deductPoints('user-1', 1, 'Paiement'))
        .rejects.toThrow(BadRequestException);
    });

    it('exécute dans une $transaction (atomicité)', async () => {
      mockTx.pointsTransaction.aggregate.mockResolvedValue({ _sum: { points: 1000 } });
      mockTx.pointsTransaction.create.mockResolvedValue({});

      await service.deductPoints('user-1', 300, 'Test');

      // La $transaction doit être appelée — garantit que le check + débit sont atomiques
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    });
  });

  // ── deductPointsTx ──────────────────────────────────────────────────────────

  describe('deductPointsTx', () => {
    it('déduit depuis un tx existant si solde suffisant', async () => {
      mockTx.pointsTransaction.aggregate.mockResolvedValue({ _sum: { points: 800 } });
      mockTx.pointsTransaction.create.mockResolvedValue({});

      await service.deductPointsTx(mockTx as any, 'user-1', 300, 'Paiement via tx');

      expect(mockTx.pointsTransaction.create).toHaveBeenCalledWith({
        data: { userId: 'user-1', type: 'debit', points: -300, label: 'Paiement via tx' },
      });
    });

    it('lève BadRequestException si solde insuffisant dans le tx', async () => {
      mockTx.pointsTransaction.aggregate.mockResolvedValue({ _sum: { points: 100 } });

      await expect(service.deductPointsTx(mockTx as any, 'user-1', 500, 'Test'))
        .rejects.toThrow(BadRequestException);
    });

    it('n\'appelle pas $transaction (utilise le tx fourni)', async () => {
      mockTx.pointsTransaction.aggregate.mockResolvedValue({ _sum: { points: 1000 } });
      mockTx.pointsTransaction.create.mockResolvedValue({});

      await service.deductPointsTx(mockTx as any, 'user-1', 100, 'Test');

      // $transaction ne doit pas être appelé — on utilise le tx passé en paramètre
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
