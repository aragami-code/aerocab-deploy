import { Test, TestingModule } from '@nestjs/testing';
import { AuditService } from './audit.service';
import { PrismaService } from '../database/prisma.service';

const mockPrisma = {
  auditLog: {
    create: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  },
};

describe('AuditService', () => {
  let service: AuditService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<AuditService>(AuditService);
    jest.clearAllMocks();
  });

  describe('log', () => {
    it('should create an audit log entry', async () => {
      const entry = { action: 'CREATE', entity: 'Booking', entityId: 'b-1', adminId: 'a-1' };
      mockPrisma.auditLog.create.mockResolvedValue({ id: 'log-1', ...entry });
      await service.log(entry);
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'CREATE', entity: 'Booking' }) }),
      );
    });

    it('should cast meta as Prisma.InputJsonValue', async () => {
      const entry = { action: 'UPDATE', entity: 'User', meta: { before: 'a', after: 'b' } };
      mockPrisma.auditLog.create.mockResolvedValue({ id: 'log-2' });
      await service.log(entry);
      const callData = mockPrisma.auditLog.create.mock.calls[0][0].data;
      expect(callData.meta).toEqual({ before: 'a', after: 'b' });
    });
  });

  describe('findAll', () => {
    it('should return items and total', async () => {
      mockPrisma.auditLog.findMany.mockResolvedValue([{ id: 'log-1' }]);
      mockPrisma.auditLog.count.mockResolvedValue(1);
      const result = await service.findAll();
      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it('should filter by entity', async () => {
      mockPrisma.auditLog.findMany.mockResolvedValue([]);
      mockPrisma.auditLog.count.mockResolvedValue(0);
      await service.findAll({ entity: 'Booking' });
      expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ entity: 'Booking' }) }),
      );
    });

    it('should apply default limit of 50', async () => {
      mockPrisma.auditLog.findMany.mockResolvedValue([]);
      mockPrisma.auditLog.count.mockResolvedValue(0);
      await service.findAll();
      expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 50, skip: 0 }),
      );
    });
  });
});
