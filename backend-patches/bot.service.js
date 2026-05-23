"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var BotService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.BotService = void 0;
const common_1 = require("@nestjs/common");
const crypto_1 = require("crypto");
const prisma_service_1 = require("../database/prisma.service");
const settings_service_1 = require("../settings/settings.service");
const PROVIDER_URLS = {
    claude: 'https://api.anthropic.com/v1/messages',
    openai: 'https://api.openai.com/v1/chat/completions',
    zhipu: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
};
const PROVIDER_DEFAULT_MODELS = {
    claude:  'claude-haiku-4-5-20251001',
    openai:  'gpt-4o-mini',
    zhipu:   'glm-4-flash',
    gemini:  'gemini-2.5-flash',
};
let BotService = BotService_1 = class BotService {
    constructor(prisma, settings) {
        this.prisma = prisma;
        this.settings = settings;
        this.logger = new common_1.Logger(BotService_1.name);
    }
    async chat(userId, message, history) {
        var _a, _b, _c, _d;
        const enabled = await this.settings.get('bot_enabled', 'false');
        if (enabled !== 'true') {
            throw new common_1.ServiceUnavailableException('Le bot assistant est désactivé.');
        }
        const rawProvider = await this.settings.get('bot_provider', 'claude');
        const provider = ['claude', 'openai', 'zhipu', 'gemini'].includes(rawProvider)
            ? rawProvider
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
            throw new common_1.ServiceUnavailableException('Le bot assistant n\'est pas configuré.');
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
        const walletBalance = Number((_a = wallet === null || wallet === void 0 ? void 0 : wallet.balance) !== null && _a !== void 0 ? _a : 0);
        const points = (_b = pointsAgg._sum.points) !== null && _b !== void 0 ? _b : 0;
        const contextBlock = [
            `\n\n--- Contexte utilisateur ---`,
            `Nom : ${(_c = user === null || user === void 0 ? void 0 : user.name) !== null && _c !== void 0 ? _c : 'Inconnu'}`,
            `Code parrainage : ${(_d = user === null || user === void 0 ? void 0 : user.referralCode) !== null && _d !== void 0 ? _d : 'Aucun'}`,
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
    // ── Google Gemini ─────────────────────────────────────────────────────────
    async callGemini(apiKey, model, maxTokens, system, history, message) {
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
            throw new common_1.ServiceUnavailableException('Le service bot est temporairement indisponible.');
        }
        const data = await res.json();
        const reply = data.candidates?.[0]?.content?.parts?.[0]?.text ?? 'Désolé, je n\'ai pas pu répondre.';
        return { reply };
    }
    // ── Anthropic (Claude) ────────────────────────────────────────────────────
    async callAnthropic(apiKey, model, maxTokens, system, history, message) {
        var _a, _b, _c;
        const messages = [...history, { role: 'user', content: message }];
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
            throw new common_1.ServiceUnavailableException('Le service bot est temporairement indisponible.');
        }
        const data = await res.json();
        return { reply: (_c = (_b = (_a = data.content) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.text) !== null && _c !== void 0 ? _c : 'Désolé, je n\'ai pas pu répondre.' };
    }
    // ── JWT pour ZhipuAI (format id.secret → HS256 JWT) ─────────────────────
    buildZhipuJwt(apiKey) {
        const [id, secret] = apiKey.split('.');
        const now = Date.now();
        const header = Buffer.from(JSON.stringify({ alg: 'HS256', sign_type: 'SIGN' })).toString('base64url');
        const payload = Buffer.from(JSON.stringify({ api_key: id, exp: now + 3600000, timestamp: now })).toString('base64url');
        const sig = (0, crypto_1.createHmac)('sha256', secret).update(`${header}.${payload}`).digest('base64url');
        return `${header}.${payload}.${sig}`;
    }
    // ── OpenAI-compatible (OpenAI + ZhipuAI) ─────────────────────────────────
    async callOpenAICompat(provider, apiKey, model, maxTokens, system, history, message) {
        var _a, _b, _c, _d;
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
            throw new common_1.ServiceUnavailableException('Le service bot est temporairement indisponible.');
        }
        const data = await res.json();
        return { reply: (_d = (_c = (_b = (_a = data.choices) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.message) === null || _c === void 0 ? void 0 : _c.content) !== null && _d !== void 0 ? _d : 'Désolé, je n\'ai pas pu répondre.' };
    }
};
exports.BotService = BotService;
exports.BotService = BotService = BotService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        settings_service_1.SettingsService])
], BotService);
//# sourceMappingURL=bot.service.js.map