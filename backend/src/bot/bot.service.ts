import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { ChatHistoryItemDto } from './dto/chat-message.dto';

const CLAUDE_API = 'https://api.anthropic.com/v1/messages';

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

    const [apiKey, model, rawMaxTokens, basePrompt] = await Promise.all([
      this.settings.get('bot_claude_api_key', ''),
      this.settings.get('bot_model', 'claude-haiku-4-5-20251001'),
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

    const messages = [
      ...history.slice(-10).map((h) => ({ role: h.role, content: h.content })),
      { role: 'user' as const, content: message },
    ];

    const res = await fetch(CLAUDE_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model, max_tokens: maxTokens, system: systemPrompt, messages }),
    });

    if (!res.ok) {
      const text = await res.text();
      this.logger.error(`Claude API error: ${text}`);
      throw new ServiceUnavailableException('Le service bot est temporairement indisponible.');
    }

    const data = await res.json() as { content?: Array<{ type: string; text: string }> };
    const reply = data.content?.[0]?.text ?? 'Désolé, je n\'ai pas pu répondre.';
    return { reply };
  }
}
