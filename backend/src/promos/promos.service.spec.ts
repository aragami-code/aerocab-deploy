import { Test, TestingModule } from '@nestjs/testing';
import { PromosService } from './promos.service';
import { PrismaService } from '../database/prisma.service';

const mockPrisma = {
  promoCode: {
    findUnique: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  },
};

const activePromo = {
  id: 'p-1',
  code: 'PROMO50',
  discount: 50,
  maxUses: 100,
  usedCount: 0,
  isActive: true,
  expiresAt: null,
};

describe('PromosService', () => {
  let service: PromosService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PromosService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<PromosService>(PromosService);
    jest.clearAllMocks();
  });

  // ── validatePromo ──────────────────────────────────────────────────────────

  describe('validatePromo', () => {
    it('should return discount for a valid active promo', async () => {
      mockPrisma.promoCode.findUnique.mockResolvedValue(activePromo);
      const result = await service.validatePromo('PROMO50');
      expect(result).toEqual({ discount: 50, promoId: 'p-1' });
    });

    it('should be case-insensitive', async () => {
      mockPrisma.promoCode.findUnique.mockResolvedValue(activePromo);
      await service.validatePromo('promo50');
      expect(mockPrisma.promoCode.findUnique).toHaveBeenCalledWith({
        where: { code: 'PROMO50' },
      });
    });

    it('should return null if promo does not exist', async () => {
      mockPrisma.promoCode.findUnique.mockResolvedValue(null);
      const result = await service.validatePromo('UNKNOWN');
      expect(result).toBeNull();
    });

    it('should return null if promo is inactive', async () => {
      mockPrisma.promoCode.findUnique.mockResolvedValue({ ...activePromo, isActive: false });
      const result = await service.validatePromo('PROMO50');
      expect(result).toBeNull();
    });

    it('should return null if max uses reached', async () => {
      mockPrisma.promoCode.findUnique.mockResolvedValue({ ...activePromo, usedCount: 100, maxUses: 100 });
      const result = await service.validatePromo('PROMO50');
      expect(result).toBeNull();
    });

    it('should return null if promo is expired', async () => {
      const yesterday = new Date(Date.now() - 86400_000);
      mockPrisma.promoCode.findUnique.mockResolvedValue({ ...activePromo, expiresAt: yesterday });
      const result = await service.validatePromo('PROMO50');
      expect(result).toBeNull();
    });

    it('should be valid if expiry is in the future', async () => {
      const tomorrow = new Date(Date.now() + 86400_000);
      mockPrisma.promoCode.findUnique.mockResolvedValue({ ...activePromo, expiresAt: tomorrow });
      const result = await service.validatePromo('PROMO50');
      expect(result).not.toBeNull();
    });
  });

  // ── applyPromo ─────────────────────────────────────────────────────────────

  describe('applyPromo', () => {
    it('should increment usedCount by promoId (not code)', async () => {
      mockPrisma.promoCode.findUnique.mockResolvedValue(activePromo);
      mockPrisma.promoCode.update.mockResolvedValue({ ...activePromo, usedCount: 1 });
      await service.applyPromo('PROMO50');
      // applyPromo looks up by code first, then updates by id
      expect(mockPrisma.promoCode.update).toHaveBeenCalledWith({
        where: { id: 'p-1' },
        data: { usedCount: { increment: 1 } },
      });
    });

    it('should do nothing if promo does not exist', async () => {
      mockPrisma.promoCode.findUnique.mockResolvedValue(null);
      await service.applyPromo('UNKNOWN');
      expect(mockPrisma.promoCode.update).not.toHaveBeenCalled();
    });
  });

  // ── createPromo ────────────────────────────────────────────────────────────

  describe('createPromo', () => {
    it('should uppercase the code on creation', async () => {
      mockPrisma.promoCode.create.mockResolvedValue(activePromo);
      await service.createPromo({ code: 'promo50', discount: 50, maxUses: 100 });
      expect(mockPrisma.promoCode.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ code: 'PROMO50' }) }),
      );
    });

    it('should set expiresAt to null when not provided', async () => {
      mockPrisma.promoCode.create.mockResolvedValue(activePromo);
      await service.createPromo({ code: 'TEST', discount: 10, maxUses: 5 });
      expect(mockPrisma.promoCode.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ expiresAt: null }) }),
      );
    });

    it('should parse expiresAt string into Date when provided', async () => {
      mockPrisma.promoCode.create.mockResolvedValue(activePromo);
      await service.createPromo({ code: 'TEST', discount: 10, maxUses: 5, expiresAt: '2030-12-31' });
      const callArg = mockPrisma.promoCode.create.mock.calls[0][0];
      expect(callArg.data.expiresAt).toBeInstanceOf(Date);
    });
  });

  // ── togglePromo ────────────────────────────────────────────────────────────

  describe('togglePromo', () => {
    it('should flip isActive from true to false', async () => {
      mockPrisma.promoCode.findUniqueOrThrow.mockResolvedValue(activePromo);
      mockPrisma.promoCode.update.mockResolvedValue({ ...activePromo, isActive: false });
      const result = await service.togglePromo('p-1');
      expect(mockPrisma.promoCode.update).toHaveBeenCalledWith({
        where: { id: 'p-1' },
        data: { isActive: false },
      });
      expect(result.isActive).toBe(false);
    });

    it('should flip isActive from false to true', async () => {
      mockPrisma.promoCode.findUniqueOrThrow.mockResolvedValue({ ...activePromo, isActive: false });
      mockPrisma.promoCode.update.mockResolvedValue({ ...activePromo, isActive: true });
      const result = await service.togglePromo('p-1');
      expect(mockPrisma.promoCode.update).toHaveBeenCalledWith({
        where: { id: 'p-1' },
        data: { isActive: true },
      });
      expect(result.isActive).toBe(true);
    });
  });

  // ── listPromos ─────────────────────────────────────────────────────────────

  describe('listPromos', () => {
    it('should return paginated results', async () => {
      mockPrisma.promoCode.findMany.mockResolvedValue([activePromo]);
      mockPrisma.promoCode.count.mockResolvedValue(1);
      const result = await service.listPromos(1, 20);
      expect(result.data).toHaveLength(1);
      expect(result.pagination.total).toBe(1);
      expect(result.pagination.totalPages).toBe(1);
    });

    it('should calculate correct skip for page 2', async () => {
      mockPrisma.promoCode.findMany.mockResolvedValue([]);
      mockPrisma.promoCode.count.mockResolvedValue(25);
      await service.listPromos(2, 20);
      expect(mockPrisma.promoCode.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 20 }),
      );
    });
  });
});
