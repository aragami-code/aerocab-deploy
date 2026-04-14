import { Test, TestingModule } from '@nestjs/testing';
import { SettingsService } from './settings.service';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../redis/redis.service';

const mockPrisma = {
  appSetting: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    upsert: jest.fn(),
  },
};

const mockRedis = {
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
};

describe('SettingsService', () => {
  let service: SettingsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SettingsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: RedisService, useValue: mockRedis },
      ],
    }).compile();
    service = module.get<SettingsService>(SettingsService);
    jest.resetAllMocks();
    // restore Redis defaults after reset
    mockRedis.get.mockResolvedValue(null);
    mockRedis.set.mockResolvedValue(undefined);
    mockRedis.del.mockResolvedValue(undefined);
  });

  describe('isProximityAssignmentEnabled', () => {
    it('should return true when setting is "true"', async () => {
      mockPrisma.appSetting.findUnique.mockResolvedValue({ key: 'proximity_assignment_enabled', value: 'true' });
      expect(await service.isProximityAssignmentEnabled()).toBe(true);
    });

    it('should return false when setting is "false"', async () => {
      mockPrisma.appSetting.findUnique.mockResolvedValue({ key: 'proximity_assignment_enabled', value: 'false' });
      expect(await service.isProximityAssignmentEnabled()).toBe(false);
    });

    it('should return false when setting is absent', async () => {
      mockPrisma.appSetting.findUnique.mockResolvedValue(null);
      expect(await service.isProximityAssignmentEnabled()).toBe(false);
    });
  });

  describe('setProximityAssignment', () => {
    it('should upsert with "true" string', async () => {
      mockPrisma.appSetting.upsert.mockResolvedValue({});
      await service.setProximityAssignment(true);
      expect(mockPrisma.appSetting.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ value: 'true' }),
          update: expect.objectContaining({ value: 'true' }),
        }),
      );
    });

    it('should upsert with "false" string', async () => {
      mockPrisma.appSetting.upsert.mockResolvedValue({});
      await service.setProximityAssignment(false);
      expect(mockPrisma.appSetting.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ create: expect.objectContaining({ value: 'false' }) }),
      );
    });
  });
});
