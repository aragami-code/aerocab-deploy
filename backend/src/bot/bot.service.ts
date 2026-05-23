import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { createHmac } from 'crypto';
import { PrismaService } from '../database/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { ChatHistoryItemDto } from './dto/chat-message.dto';

type Provider = 'claude' | 'openai' | 'zhipu' | 'gemini';

const PROVIDER_URLS: Record<Exclude<Provider, 'gemini'>, string> = {
  claude: 'https://api.anthropic.com/v1/messages',
  openai: 'https://api.openai.com/v1/chat/completions',
  zhipu:  'https://open.bigmodel.cn/api/paas/v4/chat/completions',
};

const PROVIDER_DEFAULT_MODELS: Record<Provider, string> = {
  claude:  'claude-haiku-4-5-20251001',
  openai:  'gpt-4o-mini',
  zhipu:   'glm-4-flash',
  gemini:  'gemini-2.5-flash',
};

@Injectable()
export class BotService {
  private readonly logger = new Logger(BotService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async chat(userId: string, message: string, history: ChatHistoryItemDto[]): Promise<{ reply: string }> {
    const enabled = await this.settings.get('bot_enabled', 'false');
    if (enabled !== 'true') {
      throw new ServiceUnavailableException('Le bot assistant est désactivé.');
    }

    const rawProvider = await this.settings.get('bot_provider', 'claude');
    const provider: Provider = (['claude', 'openai', 'zhipu', 'gemini'] as Provider[]).includes(rawProvider as Provider)
      ? (rawProvider as Provider)
      : 'claude';

    const defaultModel = PROVIDER_DEFAULT_MODELS[provider];
    const settingKey = provider === 'gemini' ? 'bot_gemini_api_key' : `bot_${provider}_api_key`;
    const [apiKey, model, rawMaxTokens, basePrompt] = await Promise.all([
      this.settings.get(settingKey, ''),
      this.settings.get('bot_model', defaultModel),
      this.settings.get('bot_max_tokens', '500'),
      this.settings.get('bot_system_prompt', 'Tu es l\'assistant AeroCab. Réponds en français.'),
    ]);
    const maxTokens = parseInt(rawMaxTokens, 10) || 500;

    if (!apiKey) {
      throw new ServiceUnavailableException('Le bot assistant n\'est pas configuré.');
    }

    const [user, activeBooking, wallet, pointsAgg] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { name: true, referralCode: true } }),
      this.prisma.booking.findFirst({
        where: { passengerId: userId, status: { in: ['pending', 'confirmed', 'in_progress'] } },
        select: { id: true, status: true, destination: true, estimatedPrice: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.wallet.findUnique({ where: { userId }, select: { balance: true } }),
      this.prisma.pointsTransaction.aggregate({ where: { userId }, _sum: { points: true } }),
    ]);

    const walletBalance = Number(wallet?.balance ?? 0);
    const points = pointsAgg._sum.points ?? 0;

    const contextBlock = [
      `\n\n--- Contexte utilisateur ---`,
      `Nom : ${user?.name ?? 'Inconnu'}`,
      `Code parrainage : ${user?.referralCode ?? 'Aucun'}`,
      `Solde wallet : ${walletBalance} XAF`,
      `Points : ${points}`,
      activeBooking
        ? `Course active : ${activeBooking.status} — destination : ${activeBooking.destination} — prix estimé : ${activeBooking.estimatedPrice} XAF`
        : `Course active : aucune`,
      `--- Fin contexte ---`,
    ].join('\n');

    const systemPrompt = basePrompt + contextBlock;
    const recentHistory = history.slice(-10).map((h) => ({ role: h.role, content: h.content }));

    if (provider === 'claude') {
      return this.callAnthropic(apiKey, model, maxTokens, systemPrompt, recentHistory, message);
    }
    if (provider === 'gemini') {
      return this.callGemini(apiKey, model, maxTokens, systemPrompt, recentHistory, message);
    }
    return this.callOpenAICompat(provider, apiKey, model, maxTokens, systemPrompt, recentHistory, message);
  }

  // ── Anthropic (Claude) ────────────────────────────────────────────────────

  private async callAnthropic(
    apiKey: string,
    model: string,
    maxTokens: number,
    system: string,
    history: { role: string; content: string }[],
    message: string,
  ): Promise<{ reply: string }> {
    const messages = [...history, { role: 'user' as const, content: message }];

    const res = await fetch(PROVIDER_URLS.claude, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages }),
    });

    if (!res.ok) {
      const text = await res.text();
      this.logger.error(`Anthropic API error: ${text}`);
      throw new ServiceUnavailableException('Le service bot est temporairement indisponible.');
    }

    const data = await res.json() as { content?: Array<{ type: string; text: string }> };
    return { reply: data.content?.[0]?.text ?? 'Désolé, je n\'ai pas pu répondre.' };
  }

  // ── Google Gemini ─────────────────────────────────────────────────────────

  private async callGemini(
    apiKey: string,
    model: string,
    maxTokens: number,
    system: string,
    history: { role: string; content: string }[],
    message: string,
  ): Promise<{ reply: string }> {
    // Gemini utilise role "user"/"model", pas "assistant"
    const contents = [
      ...history.map(h => ({
        role: h.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: h.content }],
      })),
      { role: 'user', parts: [{ text: message }] },
    ];

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents,
        generationConfig: { maxOutputTokens: maxTokens },
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      this.logger.error(`Gemini API error: ${text}`);
      throw new ServiceUnavailableException('Le service bot est temporairement indisponible.');
    }

    const data = await res.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text ?? 'Désolé, je n\'ai pas pu répondre.';
    return { reply };
  }

  // ── JWT pour ZhipuAI (format id.secret → HS256 JWT) ─────────────────────

  private buildZhipuJwt(apiKey: string): string {
    const [id, secret] = apiKey.split('.');
    const now = Date.now();
    const header  = Buffer.from(JSON.stringify({ alg: 'HS256', sign_type: 'SIGN' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ api_key: id, exp: now + 3_600_000, timestamp: now })).toString('base64url');
    const sig     = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
    return `${header}.${payload}.${sig}`;
  }

  // ── OpenAI-compatible (OpenAI + ZhipuAI) ─────────────────────────────────

  private async callOpenAICompat(
    provider: 'openai' | 'zhipu',
    apiKey: string,
    model: string,
    maxTokens: number,
    system: string,
    history: { role: string; content: string }[],
    message: string,
  ): Promise<{ reply: string }> {
    const messages = [
      { role: 'system', content: system },
      ...history,
      { role: 'user', content: message },
    ];

    const bearerToken = provider === 'zhipu' ? this.buildZhipuJwt(apiKey) : apiKey;

    const res = await fetch(PROVIDER_URLS[provider], {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${bearerToken}`,
      },
      body: JSON.stringify({ model, max_tokens: maxTokens, messages }),
    });

    if (!res.ok) {
      const text = await res.text();
      this.logger.error(`${provider} API error: ${text}`);
      throw new ServiceUnavailableException('Le service bot est temporairement indisponible.');
    }

    const data = await res.json() as { choices?: Array<{ message: { content: string } }> };
    return { reply: data.choices?.[0]?.message?.content ?? 'Désolé, je n\'ai pas pu répondre.' };
  }
}
