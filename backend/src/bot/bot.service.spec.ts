import { Test, TestingModule } from '@nestjs/testing';
import { BotService } from './bot.service';
import { PrismaService } from '../database/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { ServiceUnavailableException } from '@nestjs/common';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockSettings = { get: jest.fn() };

const mockPrisma = {
  user:              { findUnique: jest.fn() },
  booking:           { findFirst: jest.fn() },
  wallet:            { findUnique: jest.fn() },
  pointsTransaction: { aggregate: jest.fn() },
};

const mockFetch = jest.fn();
global.fetch = mockFetch as any;

// ── Helpers ───────────────────────────────────────────────────────────────────

const BASE_SETTINGS: Record<string, string> = {
  bot_enabled:      'true',
  bot_provider:     'claude',
  bot_claude_api_key: 'sk-ant-test',
  bot_openai_api_key: '',
  bot_zhipu_api_key:  '',
  bot_model:        'claude-haiku-4-5-20251001',
  bot_max_tokens:   '500',
  bot_system_prompt: 'Tu es l\'assistant AeroCab.',
};

function setupSettings(overrides: Record<string, string> = {}) {
  const map = { ...BASE_SETTINGS, ...overrides };
  mockSettings.get.mockImplementation((key: string) => Promise.resolve(map[key] ?? ''));
}

function setupUser() {
  mockPrisma.user.findUnique.mockResolvedValue({ name: 'Jean Dupont', referralCode: 'JEAN01' });
  mockPrisma.booking.findFirst.mockResolvedValue(null);
  mockPrisma.wallet.findUnique.mockResolvedValue({ balance: 10000 });
  mockPrisma.pointsTransaction.aggregate.mockResolvedValue({ _sum: { points: 200 } });
}

function mockOkFetch(responseBody: object) {
  mockFetch.mockResolvedValueOnce({ ok: true, json: async () => responseBody });
}

function mockErrorFetch() {
  mockFetch.mockResolvedValueOnce({ ok: false, text: async () => 'Unauthorized' });
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('BotService', () => {
  let service: BotService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BotService,
        { provide: PrismaService,  useValue: mockPrisma  },
        { provide: SettingsService, useValue: mockSettings },
      ],
    }).compile();
    service = module.get<BotService>(BotService);
  });

  // ── Activation ──────────────────────────────────────────────────────────────

  it('lève ServiceUnavailableException si bot_enabled=false', async () => {
    mockSettings.get.mockResolvedValue('false');
    await expect(service.chat('u-1', 'Bonjour', [])).rejects.toThrow(ServiceUnavailableException);
  });

  it('lève ServiceUnavailableException si la clé du provider actif est vide', async () => {
    setupSettings({ bot_claude_api_key: '' });
    setupUser();
    await expect(service.chat('u-1', 'Bonjour', [])).rejects.toThrow(ServiceUnavailableException);
  });

  // ── Provider Claude (Anthropic) ─────────────────────────────────────────────

  describe('provider: claude', () => {
    it('appelle api.anthropic.com avec x-api-key', async () => {
      setupSettings();
      setupUser();
      mockOkFetch({ content: [{ type: 'text', text: 'Bonjour !' }] });

      const result = await service.chat('u-1', 'Bonjour', []);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.anthropic.com/v1/messages',
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-api-key': 'sk-ant-test',
            'anthropic-version': '2023-06-01',
          }),
        }),
      );
      expect(result.reply).toBe('Bonjour !');
    });

    it('envoie system + messages dans le bon format Anthropic', async () => {
      setupSettings();
      setupUser();
      mockOkFetch({ content: [{ type: 'text', text: 'OK' }] });

      await service.chat('u-1', 'Test', [{ role: 'assistant', content: 'Salut' }]);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body).toHaveProperty('system');
      expect(body.system).toContain('Jean Dupont');
      expect(body.messages).toContainEqual({ role: 'assistant', content: 'Salut' });
      expect(body.messages).toContainEqual({ role: 'user', content: 'Test' });
      // OpenAI "messages[0].role=system" format must NOT be used for Claude
      expect(body.messages[0].role).not.toBe('system');
    });

    it('injecte le contexte utilisateur dans le system prompt', async () => {
      setupSettings();
      mockPrisma.user.findUnique.mockResolvedValue({ name: 'Alice', referralCode: 'ALICE1' });
      mockPrisma.booking.findFirst.mockResolvedValue({ status: 'in_progress', destination: 'Aéroport', estimatedPrice: 7500 });
      mockPrisma.wallet.findUnique.mockResolvedValue({ balance: 25000 });
      mockPrisma.pointsTransaction.aggregate.mockResolvedValue({ _sum: { points: 350 } });
      mockOkFetch({ content: [{ type: 'text', text: 'OK' }] });

      await service.chat('u-1', 'Bonjour', []);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.system).toContain('Alice');
      expect(body.system).toContain('25000');
      expect(body.system).toContain('350');
      expect(body.system).toContain('ALICE1');
      expect(body.system).toContain('in_progress');
    });

    it('lève une erreur si l\'API Claude répond non-ok', async () => {
      setupSettings();
      setupUser();
      mockErrorFetch();
      await expect(service.chat('u-1', 'Bonjour', [])).rejects.toThrow(ServiceUnavailableException);
    });

    it('tronque l\'historique à 10 messages', async () => {
      setupSettings();
      setupUser();
      mockOkFetch({ content: [{ type: 'text', text: 'OK' }] });

      const longHistory = Array.from({ length: 20 }, (_, i) => ({
        role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
        content: `Message ${i}`,
      }));
      await service.chat('u-1', 'Dernier', longHistory);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      // 10 from history + 1 user message
      expect(body.messages).toHaveLength(11);
    });
  });

  // ── Provider OpenAI ─────────────────────────────────────────────────────────

  describe('provider: openai', () => {
    beforeEach(() => {
      setupSettings({ bot_provider: 'openai', bot_openai_api_key: 'sk-openai-test', bot_model: 'gpt-4o-mini' });
      setupUser();
    });

    it('appelle api.openai.com avec Authorization Bearer', async () => {
      mockOkFetch({ choices: [{ message: { content: 'Hello!' } }] });

      const result = await service.chat('u-1', 'Hi', []);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.openai.com/v1/chat/completions',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer sk-openai-test',
          }),
        }),
      );
      expect(result.reply).toBe('Hello!');
    });

    it('envoie system prompt comme premier message role=system', async () => {
      mockOkFetch({ choices: [{ message: { content: 'OK' } }] });

      await service.chat('u-1', 'Test', [{ role: 'user', content: 'Historique' }]);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.messages[0].role).toBe('system');
      expect(body.messages[0].content).toContain('Jean Dupont');
      expect(body.messages[1]).toEqual({ role: 'user', content: 'Historique' });
      expect(body.messages[2]).toEqual({ role: 'user', content: 'Test' });
    });

    it('lève une erreur si l\'API OpenAI répond non-ok', async () => {
      mockErrorFetch();
      await expect(service.chat('u-1', 'Hi', [])).rejects.toThrow(ServiceUnavailableException);
    });

    it('lit bot_openai_api_key et non bot_claude_api_key', async () => {
      mockOkFetch({ choices: [{ message: { content: 'OK' } }] });
      await service.chat('u-1', 'Test', []);

      const settingsKeys = mockSettings.get.mock.calls.map((c: any[]) => c[0]);
      expect(settingsKeys).toContain('bot_openai_api_key');
      expect(settingsKeys).not.toContain('bot_claude_api_key');
    });
  });

  // ── Provider ZhipuAI (GLM) ──────────────────────────────────────────────────

  describe('provider: zhipu', () => {
    // La clé ZhipuAI doit être au format "id.secret" pour construire le JWT HS256
    beforeEach(() => {
      setupSettings({ bot_provider: 'zhipu', bot_zhipu_api_key: 'testid.testsecret', bot_model: 'glm-4-flash' });
      setupUser();
    });

    it('appelle open.bigmodel.cn avec Authorization Bearer (JWT)', async () => {
      mockOkFetch({ choices: [{ message: { content: 'Bonjour GLM!' } }] });

      const result = await service.chat('u-1', 'Bonjour', []);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://open.bigmodel.cn/api/paas/v4/chat/completions',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': expect.stringMatching(/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/),
          }),
        }),
      );
      expect(result.reply).toBe('Bonjour GLM!');
    });

    it('envoie le même format OpenAI-compatible que pour openai', async () => {
      mockOkFetch({ choices: [{ message: { content: 'OK' } }] });

      await service.chat('u-1', 'Test', []);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.messages[0].role).toBe('system');
      expect(body.model).toBe('glm-4-flash');
    });

    it('lève une erreur si l\'API ZhipuAI répond non-ok', async () => {
      mockErrorFetch();
      await expect(service.chat('u-1', 'Test', [])).rejects.toThrow(ServiceUnavailableException);
    });

    it('lit bot_zhipu_api_key et non les autres clés', async () => {
      mockOkFetch({ choices: [{ message: { content: 'OK' } }] });
      await service.chat('u-1', 'Test', []);

      const settingsKeys = mockSettings.get.mock.calls.map((c: any[]) => c[0]);
      expect(settingsKeys).toContain('bot_zhipu_api_key');
      expect(settingsKeys).not.toContain('bot_claude_api_key');
      expect(settingsKeys).not.toContain('bot_openai_api_key');
    });
  });

  // ── Fallback provider invalide ──────────────────────────────────────────────

  it('retombe sur claude si bot_provider est une valeur inconnue', async () => {
    setupSettings({ bot_provider: 'unknown_provider', bot_claude_api_key: 'sk-ant-test' });
    setupUser();
    mockOkFetch({ content: [{ type: 'text', text: 'Fallback' }] });

    await service.chat('u-1', 'Test', []);

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/messages',
      expect.anything(),
    );
  });
});
