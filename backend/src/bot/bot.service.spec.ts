import { Test, TestingModule } from '@nestjs/testing';
import { BotService } from './bot.service';
import { PrismaService } from '../database/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { ServiceUnavailableException } from '@nestjs/common';

const mockSettings = {
  get: jest.fn(),
};

const mockPrisma = {
  user: { findUnique: jest.fn() },
  booking: { findFirst: jest.fn() },
  wallet: { findUnique: jest.fn() },
  pointsTransaction: { aggregate: jest.fn() },
};

const mockFetch = jest.fn();
global.fetch = mockFetch as any;

describe('BotService', () => {
  let service: BotService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BotService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: SettingsService, useValue: mockSettings },
      ],
    }).compile();
    service = module.get<BotService>(BotService);
  });

  it('lève ServiceUnavailableException si bot_enabled=false', async () => {
    mockSettings.get.mockResolvedValue('false');
    await expect(service.chat('u-1', 'Bonjour', [])).rejects.toThrow(ServiceUnavailableException);
  });

  it('lève ServiceUnavailableException si bot_claude_api_key vide', async () => {
    mockSettings.get.mockImplementation((key: string) => {
      if (key === 'bot_enabled') return Promise.resolve('true');
      if (key === 'bot_claude_api_key') return Promise.resolve('');
      return Promise.resolve('');
    });
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'u-1', name: 'Test', phone: '+237600000000', referralCode: 'REF123' });
    mockPrisma.booking.findFirst.mockResolvedValue(null);
    mockPrisma.wallet.findUnique.mockResolvedValue({ balance: 5000 });
    mockPrisma.pointsTransaction.aggregate.mockResolvedValue({ _sum: { points: 100 } });
    await expect(service.chat('u-1', 'Bonjour', [])).rejects.toThrow(ServiceUnavailableException);
  });

  it('appelle l\'API Claude avec le bon système de prompt enrichi', async () => {
    mockSettings.get.mockImplementation((key: string) => {
      const map: Record<string, string> = {
        bot_enabled: 'true',
        bot_claude_api_key: 'sk-ant-test',
        bot_model: 'claude-haiku-4-5-20251001',
        bot_max_tokens: '500',
        bot_system_prompt: 'Tu es l\'assistant AeroCab.',
      };
      return Promise.resolve(map[key] ?? '');
    });
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'u-1', name: 'Jean Dupont', phone: '+237600000000', referralCode: 'JEAN01' });
    mockPrisma.booking.findFirst.mockResolvedValue({ id: 'bk-1', status: 'in_progress', destination: 'Aéroport', estimatedPrice: 8000 });
    mockPrisma.wallet.findUnique.mockResolvedValue({ balance: 15000 });
    mockPrisma.pointsTransaction.aggregate.mockResolvedValue({ _sum: { points: 250 } });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: 'Bonjour Jean !' }] }),
    });

    const result = await service.chat('u-1', 'Bonjour', []);

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/messages',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'x-api-key': 'sk-ant-test',
          'anthropic-version': '2023-06-01',
        }),
      }),
    );

    const body = JSON.parse((mockFetch.mock.calls[0][1] as any).body);
    expect(body.system).toContain('Jean Dupont');
    expect(body.system).toContain('15000');
    expect(body.system).toContain('250');
    expect(body.system).toContain('JEAN01');
    expect(body.system).toContain('in_progress');
    expect(result.reply).toBe('Bonjour Jean !');
  });

  it('lève une erreur si l\'API Claude répond non-ok', async () => {
    mockSettings.get.mockImplementation((key: string) => {
      const map: Record<string, string> = {
        bot_enabled: 'true',
        bot_claude_api_key: 'sk-ant-test',
        bot_model: 'claude-haiku-4-5-20251001',
        bot_max_tokens: '500',
        bot_system_prompt: 'prompt',
      };
      return Promise.resolve(map[key] ?? '');
    });
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'u-1', name: 'Test', phone: '', referralCode: '' });
    mockPrisma.booking.findFirst.mockResolvedValue(null);
    mockPrisma.wallet.findUnique.mockResolvedValue({ balance: 0 });
    mockPrisma.pointsTransaction.aggregate.mockResolvedValue({ _sum: { points: 0 } });
    mockFetch.mockResolvedValueOnce({ ok: false, text: async () => 'Unauthorized' });

    await expect(service.chat('u-1', 'Bonjour', [])).rejects.toThrow('Claude API error');
  });
});
