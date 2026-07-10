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

describe('SettingsService.getForCountry (cascade)', () => {
  function makeService(store: Record<string, string>) {
    const prisma = {
      appSetting: {
        findUnique: async ({ where: { key } }: any) =>
          store[key] !== undefined ? { key, value: store[key] } : null,
      },
    } as any;
    const redis = { del: async () => {} } as any;
    return new SettingsService(prisma, redis);
  }

  it('override pays prioritaire sur global', async () => {
    const svc = makeService({ 'commission_rate': '0.15', 'commission_rate:CM': '0.12' });
    expect(await svc.getForCountry('commission_rate', 'CM', '0.10')).toBe('0.12');
  });
  it('retombe sur global si pas d\'override pays', async () => {
    const svc = makeService({ 'commission_rate': '0.15' });
    expect(await svc.getForCountry('commission_rate', 'CM', '0.10')).toBe('0.15');
  });
  it('retombe sur le défaut si ni override ni global', async () => {
    const svc = makeService({});
    expect(await svc.getForCountry('commission_rate', 'CM', '0.10')).toBe('0.10');
  });
  it('countryCode null → comportement global pur', async () => {
    const svc = makeService({ 'commission_rate': '0.15', 'commission_rate:CM': '0.12' });
    expect(await svc.getForCountry('commission_rate', null, '0.10')).toBe('0.15');
  });
  it('countryCode normalisé en majuscules', async () => {
    const svc = makeService({ 'commission_rate:CM': '0.12' });
    expect(await svc.getForCountry('commission_rate', 'cm', '0.10')).toBe('0.12');
  });
});
