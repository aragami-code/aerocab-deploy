# Bot Assistant IA — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Claude-powered floating chat bot to the passenger app, a static FAQ help screen, and an admin configuration page for the bot API key, model, system prompt, and on/off toggle.

**Architecture:** A new `BotModule` in the NestJS backend exposes `POST /bot/message` (JWT-protected), which enriches the Claude API system prompt with live user data (active booking, wallet, points, referral code) fetched from Prisma. The passenger app mounts a `<FloatingBot>` component in `_layout.tsx` (visible on all tabs, hidden during active ride). The admin dashboard gets a `BotPage` that reads/writes bot settings via the existing `PATCH /admin/settings/key` endpoint.

**Tech Stack:** NestJS (BotModule/BotController/BotService), Prisma, `fetch` to `api.anthropic.com/v1/messages`, React Native + Expo (FloatingBot FAB + BottomSheet), React/Vite (admin BotPage), Zustand (chat history in-memory), `expo-secure-store` (persist last 20 messages).

---

## File Map

### Backend (new)
- `backend/src/bot/bot.module.ts` — NestJS module wiring
- `backend/src/bot/bot.controller.ts` — `POST /bot/message` endpoint
- `backend/src/bot/bot.service.ts` — fetches settings + user data, calls Claude API
- `backend/src/bot/bot.service.spec.ts` — unit tests
- `backend/src/bot/dto/chat-message.dto.ts` — request DTO

### Backend (modified)
- `backend/prisma/seed.ts` — add 5 bot settings keys
- `backend/src/app.module.ts` — import BotModule

### Passenger app (new)
- `aerocab-native/aerocab-passenger/components/FloatingBot.tsx` — FAB + bottom sheet chat
- `aerocab-native/aerocab-passenger/lib/botHistory.ts` — SecureStore persist (20 msgs max)
- `aerocab-native/aerocab-passenger/app/(tabs)/help.tsx` — static FAQ screen

### Passenger app (modified)
- `aerocab-native/aerocab-passenger/app/_layout.tsx` — mount `<FloatingBot />`
- `aerocab-native/aerocab-passenger/app/(tabs)/_layout.tsx` — add Help tab
- `aerocab-native/aerocab-passenger/services/api.ts` — add `sendBotMessage()`

### Admin dashboard (new)
- `aerocab-admin/src/pages/BotPage.tsx` — bot config page

### Admin dashboard (modified)
- `aerocab-admin/src/App.tsx` — add `/bot` route

---

## Task 1: Backend — Seed bot settings

**Files:**
- Modify: `backend/prisma/seed.ts`

- [ ] **Step 1: Add bot settings to the seed array**

Open `backend/prisma/seed.ts`. Find the `const SETTINGS` array (or the block of `{ key, value, description }` objects). Add these 5 entries immediately after the payment settings block:

```typescript
  // ── Bot Assistant ────────────────────────────────────────────────────────
  { key: 'bot_enabled',        value: 'false', description: 'Activer le bot assistant IA (true/false)' },
  { key: 'bot_claude_api_key', value: '',       description: 'Clé API Anthropic (sk-ant-...)' },
  { key: 'bot_model',          value: 'claude-haiku-4-5-20251001', description: 'Modèle Claude à utiliser' },
  { key: 'bot_max_tokens',     value: '500',    description: 'Nombre max de tokens dans la réponse du bot' },
  { key: 'bot_system_prompt',  value: 'Tu es l\'assistant AeroCab. Réponds en français, de façon concise et amicale. Si tu ne sais pas, propose de contacter le support.', description: 'System prompt du bot (personnalisable sans redéploiement)' },
```

- [ ] **Step 2: Run seed**

```bash
cd /home/aragami/aerogo/aerocab-deploy/backend
npx ts-node prisma/seed.ts 2>&1 | tail -5
```

Expected: `Seeding complete` (or similar) with no errors.

- [ ] **Step 3: Verify settings in DB**

```bash
npx prisma studio --schema ./prisma/schema.prisma &
# Or query directly:
npx ts-node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.appSetting.findMany({ where: { key: { startsWith: 'bot_' } } }).then(r => { console.log(r); p.\$disconnect(); });
"
```

Expected: 5 rows with keys `bot_enabled`, `bot_claude_api_key`, `bot_model`, `bot_max_tokens`, `bot_system_prompt`.

- [ ] **Step 4: Commit**

```bash
git add prisma/seed.ts
git commit -m "feat(bot): add bot_* settings to seed"
```

---

## Task 2: Backend — BotService + BotController

**Files:**
- Create: `backend/src/bot/dto/chat-message.dto.ts`
- Create: `backend/src/bot/bot.service.ts`
- Create: `backend/src/bot/bot.controller.ts`
- Create: `backend/src/bot/bot.module.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/src/bot/bot.service.spec.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /home/aragami/aerogo/aerocab-deploy/backend
npx jest bot.service.spec --no-coverage 2>&1 | tail -10
```

Expected: FAIL — `Cannot find module './bot.service'`

- [ ] **Step 3: Create DTO**

Create `backend/src/bot/dto/chat-message.dto.ts`:

```typescript
export class ChatHistoryItemDto {
  role: 'user' | 'assistant';
  content: string;
}

export class SendBotMessageDto {
  message: string;
  history: ChatHistoryItemDto[];
}
```

- [ ] **Step 4: Create BotService**

Create `backend/src/bot/bot.service.ts`:

```typescript
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { ChatHistoryItemDto } from './dto/chat-message.dto';

const CLAUDE_API = 'https://api.anthropic.com/v1/messages';

@Injectable()
export class BotService {
  private readonly logger = new Logger(BotService.name);

  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
  ) {}

  async chat(userId: string, message: string, history: ChatHistoryItemDto[]): Promise<{ reply: string }> {
    const enabled = await this.settings.get('bot_enabled', 'false');
    if (enabled !== 'true') {
      throw new ServiceUnavailableException('Le bot assistant est désactivé.');
    }

    const apiKey    = await this.settings.get('bot_claude_api_key', '');
    const model     = await this.settings.get('bot_model', 'claude-haiku-4-5-20251001');
    const maxTokens = parseInt(await this.settings.get('bot_max_tokens', '500'), 10) || 500;
    const basePrompt = await this.settings.get('bot_system_prompt', 'Tu es l\'assistant AeroCab. Réponds en français.');

    if (!apiKey) {
      throw new ServiceUnavailableException('Le bot assistant n\'est pas configuré.');
    }

    // Enrich system prompt with live user context
    const [user, activeBooking, wallet, pointsAgg] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { name: true, phone: true, referralCode: true } }),
      this.prisma.booking.findFirst({
        where: { passengerId: userId, status: { in: ['pending', 'accepted', 'in_progress'] } },
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
      `Téléphone : ${user?.phone ?? 'Non renseigné'}`,
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
      throw new Error('Claude API error');
    }

    const data = await res.json();
    const reply = data.content?.[0]?.text ?? 'Désolé, je n\'ai pas pu répondre.';
    return { reply };
  }
}
```

- [ ] **Step 5: Create BotController**

Create `backend/src/bot/bot.controller.ts`:

```typescript
import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { BotService } from './bot.service';
import { SendBotMessageDto } from './dto/chat-message.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('bot')
@UseGuards(JwtAuthGuard)
export class BotController {
  constructor(private botService: BotService) {}

  @Post('message')
  async sendMessage(
    @CurrentUser('id') userId: string,
    @Body() body: SendBotMessageDto,
  ) {
    return this.botService.chat(userId, body.message, body.history ?? []);
  }
}
```

- [ ] **Step 6: Create BotModule**

Create `backend/src/bot/bot.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { BotController } from './bot.controller';
import { BotService } from './bot.service';
import { PrismaModule } from '../database/prisma.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [PrismaModule, SettingsModule],
  controllers: [BotController],
  providers: [BotService],
})
export class BotModule {}
```

- [ ] **Step 7: Register BotModule in AppModule**

Edit `backend/src/app.module.ts`. Add `BotModule` to the imports:

```typescript
import { BotModule } from './bot/bot.module';
// ... inside @Module imports array, after ForfaitsModule:
BotModule,
```

- [ ] **Step 8: Run tests to verify they pass**

```bash
cd /home/aragami/aerogo/aerocab-deploy/backend
npx jest bot.service.spec --no-coverage 2>&1 | tail -15
```

Expected: `Tests: 4 passed, 4 total`

- [ ] **Step 9: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | grep -i "bot\|error" | head -20
```

Expected: no errors related to bot files.

- [ ] **Step 10: Commit**

```bash
git add src/bot/ src/app.module.ts prisma/seed.ts
git commit -m "feat(bot): BotModule — POST /bot/message calling Claude API"
```

---

## Task 3: Passenger app — API method + botHistory util

**Files:**
- Modify: `aerocab-native/aerocab-passenger/services/api.ts`
- Create: `aerocab-native/aerocab-passenger/lib/botHistory.ts`

- [ ] **Step 1: Add sendBotMessage to passenger API service**

Open `aerocab-native/aerocab-passenger/services/api.ts`. Add this method to the `PassengerApiClient` class (or the default export object), after the referral methods:

```typescript
async sendBotMessage(token: string, message: string, history: Array<{ role: 'user' | 'assistant'; content: string }>) {
  return this.request<{ reply: string }>('/bot/message', {
    method: 'POST',
    body: { message, history },
    token,
  });
}
```

- [ ] **Step 2: Create botHistory utility**

Create `aerocab-native/aerocab-passenger/lib/botHistory.ts`:

```typescript
import * as SecureStore from 'expo-secure-store';

export interface BotMessage {
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
}

const STORE_KEY = 'bot_history_v1';
const MAX_MESSAGES = 20;

export async function loadHistory(): Promise<BotMessage[]> {
  try {
    const raw = await SecureStore.getItemAsync(STORE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as BotMessage[];
  } catch {
    return [];
  }
}

export async function saveHistory(messages: BotMessage[]): Promise<void> {
  try {
    const trimmed = messages.slice(-MAX_MESSAGES);
    await SecureStore.setItemAsync(STORE_KEY, JSON.stringify(trimmed));
  } catch {
    // non-critique
  }
}

export async function clearHistory(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(STORE_KEY);
  } catch {
    // non-critique
  }
}
```

- [ ] **Step 3: Verify TypeScript**

```bash
cd /home/aragami/aerogo/aerocab-native/aerocab-passenger
npx tsc --noEmit 2>&1 | grep -i "botHistory\|sendBotMessage\|error" | head -10
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add services/api.ts lib/botHistory.ts
git commit -m "feat(bot): passenger API sendBotMessage + botHistory util"
```

---

## Task 4: Passenger app — FloatingBot component

**Files:**
- Create: `aerocab-native/aerocab-passenger/components/FloatingBot.tsx`
- Modify: `aerocab-native/aerocab-passenger/app/_layout.tsx`

- [ ] **Step 1: Create FloatingBot component**

Create `aerocab-native/aerocab-passenger/components/FloatingBot.tsx`:

```typescript
import { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, Pressable, FlatList, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { MessageCircle, X, Send, Trash2 } from 'lucide-react-native';
import { useAuthStore } from '../stores/authStore';
import { api } from '../services/api';
import { loadHistory, saveHistory, clearHistory, BotMessage } from '../lib/botHistory';
import { COLORS } from '../lib/shared';

const BOT_BLUE = '#1D2C4D';
const BUBBLE_SIZE = 56;

export function FloatingBot() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<BotMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [initialised, setInitialised] = useState(false);
  const token = useAuthStore((s) => s.token);
  const listRef = useRef<FlatList>(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  // Load persisted history on mount
  useEffect(() => {
    loadHistory().then((h) => {
      setMessages(h);
      setInitialised(true);
    });
  }, []);

  // Persist whenever messages change
  useEffect(() => {
    if (initialised) saveHistory(messages);
  }, [messages, initialised]);

  // Fade in/out bottom sheet
  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: open ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [open]);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
  }, []);

  const handleSend = useCallback(async () => {
    if (!input.trim() || loading || !token) return;
    const userMsg: BotMessage = { role: 'user', content: input.trim(), createdAt: Date.now() };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput('');
    setLoading(true);
    scrollToBottom();

    try {
      const history = nextMessages.slice(-10).map((m) => ({ role: m.role, content: m.content }));
      const { reply } = await api.sendBotMessage(token, userMsg.content, history);
      setMessages((prev) => [...prev, { role: 'assistant', content: reply, createdAt: Date.now() }]);
    } catch {
      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: 'Désolé, je suis temporairement indisponible. Réessayez plus tard.',
        createdAt: Date.now(),
      }]);
    } finally {
      setLoading(false);
      scrollToBottom();
    }
  }, [input, loading, token, messages, scrollToBottom]);

  const handleClear = useCallback(async () => {
    setMessages([]);
    await clearHistory();
  }, []);

  if (!token) return null;

  return (
    <>
      {/* Bottom sheet overlay */}
      <Animated.View
        style={[styles.overlay, { opacity: fadeAnim, pointerEvents: open ? 'auto' : 'none' }]}
        pointerEvents={open ? 'auto' : 'none'}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.sheet}
        >
          <SafeAreaView edges={['bottom']} style={styles.sheetInner}>
            {/* Header */}
            <View style={styles.header}>
              <View style={styles.headerLeft}>
                <MessageCircle size={20} color={COLORS.primary} />
                <Text style={styles.headerTitle}>Assistant AeroCab</Text>
              </View>
              <View style={styles.headerActions}>
                <Pressable onPress={handleClear} style={styles.iconBtn} hitSlop={8}>
                  <Trash2 size={18} color="#9CA3AF" />
                </Pressable>
                <Pressable onPress={() => setOpen(false)} style={styles.iconBtn} hitSlop={8}>
                  <X size={20} color="#6B7280" />
                </Pressable>
              </View>
            </View>

            {/* Messages */}
            <FlatList
              ref={listRef}
              data={messages}
              keyExtractor={(_, i) => String(i)}
              style={styles.list}
              contentContainerStyle={styles.listContent}
              onContentSizeChange={scrollToBottom}
              ListEmptyComponent={
                <View style={styles.emptyWrap}>
                  <Text style={styles.emptyText}>Bonjour 👋 Comment puis-je vous aider ?</Text>
                  <Text style={styles.emptyHint}>Statut de course · Paiement · Parrainage · Aide</Text>
                </View>
              }
              renderItem={({ item }) => (
                <View style={[styles.bubble, item.role === 'user' ? styles.bubbleUser : styles.bubbleBot]}>
                  <Text style={[styles.bubbleText, item.role === 'user' ? styles.bubbleTextUser : styles.bubbleTextBot]}>
                    {item.content}
                  </Text>
                </View>
              )}
            />

            {loading && (
              <View style={styles.typingRow}>
                <ActivityIndicator size="small" color={COLORS.primary} />
                <Text style={styles.typingText}>En train d'écrire…</Text>
              </View>
            )}

            {/* Input */}
            <View style={styles.inputRow}>
              <TextInput
                style={styles.input}
                value={input}
                onChangeText={setInput}
                placeholder="Posez votre question…"
                placeholderTextColor="#9CA3AF"
                multiline
                maxLength={500}
                onSubmitEditing={handleSend}
                returnKeyType="send"
              />
              <Pressable
                onPress={handleSend}
                style={[styles.sendBtn, (!input.trim() || loading) && styles.sendBtnDisabled]}
                disabled={!input.trim() || loading}
              >
                <Send size={18} color="#FFFFFF" />
              </Pressable>
            </View>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </Animated.View>

      {/* FAB */}
      <Pressable
        onPress={() => { setOpen((v) => !v); if (!open) scrollToBottom(); }}
        style={[styles.fab, open && styles.fabOpen]}
      >
        {open
          ? <X size={24} color="#FFFFFF" />
          : <MessageCircle size={24} color="#FFFFFF" />
        }
      </Pressable>
    </>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    bottom: 80,
    left: 12,
    right: 12,
    height: '65%',
    zIndex: 999,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 16,
  },
  sheet: { flex: 1 },
  sheetInner: { flex: 1 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerTitle: { fontSize: 15, fontWeight: '600', color: '#111827' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  iconBtn: { padding: 4 },
  list: { flex: 1 },
  listContent: { padding: 12, gap: 8 },
  emptyWrap: { flex: 1, alignItems: 'center', paddingTop: 32 },
  emptyText: { fontSize: 15, fontWeight: '500', color: '#374151', textAlign: 'center' },
  emptyHint: { fontSize: 12, color: '#9CA3AF', marginTop: 6, textAlign: 'center' },
  bubble: {
    maxWidth: '80%',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
  },
  bubbleUser: {
    alignSelf: 'flex-end',
    backgroundColor: '#1D2C4D',
    borderBottomRightRadius: 4,
  },
  bubbleBot: {
    alignSelf: 'flex-start',
    backgroundColor: '#F3F4F6',
    borderBottomLeftRadius: 4,
  },
  bubbleText: { fontSize: 14, lineHeight: 20 },
  bubbleTextUser: { color: '#FFFFFF' },
  bubbleTextBot: { color: '#111827' },
  typingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  typingText: { fontSize: 12, color: '#9CA3AF' },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 100,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingHorizontal: 14,
    paddingVertical: 8,
    fontSize: 14,
    color: '#111827',
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1D2C4D',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendBtnDisabled: { opacity: 0.4 },
  fab: {
    position: 'absolute',
    bottom: 88,
    right: 16,
    width: BUBBLE_SIZE,
    height: BUBBLE_SIZE,
    borderRadius: BUBBLE_SIZE / 2,
    backgroundColor: '#1D2C4D',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 8,
  },
  fabOpen: { backgroundColor: '#374151' },
});
```

- [ ] **Step 2: Mount FloatingBot in passenger _layout.tsx**

Open `aerocab-native/aerocab-passenger/app/_layout.tsx`. Add the import at the top:

```typescript
import { FloatingBot } from '../components/FloatingBot';
```

Inside the returned JSX, add `<FloatingBot />` just before the closing `</>` or wrapping view, after the `<Toast>` component:

```tsx
      <Toast config={toastConfig} />
      <FloatingBot />
```

- [ ] **Step 3: Verify TypeScript**

```bash
cd /home/aragami/aerogo/aerocab-native/aerocab-passenger
npx tsc --noEmit 2>&1 | grep -i "FloatingBot\|error" | head -10
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add components/FloatingBot.tsx app/_layout.tsx
git commit -m "feat(bot): FloatingBot FAB + bottom sheet chat"
```

---

## Task 5: Passenger app — Help screen (FAQ statique)

**Files:**
- Create: `aerocab-native/aerocab-passenger/app/(tabs)/help.tsx`
- Modify: `aerocab-native/aerocab-passenger/app/(tabs)/_layout.tsx`

- [ ] **Step 1: Read current tabs layout**

```bash
cat "/home/aragami/aerogo/aerocab-native/aerocab-passenger/app/(tabs)/_layout.tsx"
```

Note the existing tab entries (icon + label pattern).

- [ ] **Step 2: Create help screen**

Create `aerocab-native/aerocab-passenger/app/(tabs)/help.tsx`:

```typescript
import { useState, useMemo } from 'react';
import {
  View, Text, TextInput, ScrollView, Pressable, StyleSheet, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronDown, ChevronUp, Search, MessageCircle, Mail } from 'lucide-react-native';
import { useColors } from '../../lib/useColors';

interface FaqItem {
  q: string;
  a: string;
  tags: string[];
}

interface FaqSection {
  title: string;
  emoji: string;
  items: FaqItem[];
}

const FAQ_DATA: FaqSection[] = [
  {
    title: 'Réservation',
    emoji: '🚗',
    items: [
      { q: 'Comment réserver une course ?', a: 'Ouvrez l\'app, choisissez votre type de course (Arrivée, Départ ou International), saisissez votre destination et confirmez. Un chauffeur sera assigné automatiquement.', tags: ['réserver', 'course', 'booking'] },
      { q: 'Quelle est la différence entre ARRIVAL, DEPARTURE et INTERNATIONAL ?', a: 'ARRIVAL = course depuis l\'aéroport vers votre destination. DEPARTURE = course depuis chez vous vers l\'aéroport. INTERNATIONAL = transfert longue distance.', tags: ['arrival', 'departure', 'international', 'type'] },
      { q: 'Comment connaître le tarif à l\'avance ?', a: 'Le prix estimé est affiché avant confirmation. Il peut varier selon la distance, l\'heure et les conditions de trafic.', tags: ['tarif', 'prix', 'estimation'] },
    ],
  },
  {
    title: 'Paiement',
    emoji: '💳',
    items: [
      { q: 'Quels moyens de paiement sont acceptés ?', a: 'Wallet AeroCab, Orange Money, MTN MoMo, carte bancaire (Visa/Mastercard). Rechargez votre wallet depuis l\'onglet Paiement.', tags: ['paiement', 'orange', 'mtn', 'carte', 'wallet'] },
      { q: 'Comment recharger mon wallet ?', a: 'Allez dans Paiement → Recharger, choisissez un montant et un moyen de paiement. La recharge est instantanée.', tags: ['recharger', 'wallet', 'solde'] },
      { q: 'Comment obtenir un remboursement ?', a: 'Pour les courses annulées avant prise en charge, le remboursement est automatique. Pour les autres cas, contactez le support.', tags: ['remboursement', 'refund', 'annulation'] },
    ],
  },
  {
    title: 'Annulation',
    emoji: '❌',
    items: [
      { q: 'Puis-je annuler ma course ?', a: 'Oui, depuis l\'écran de suivi tant que le chauffeur n\'a pas encore démarré. Des frais d\'annulation peuvent s\'appliquer après 5 minutes.', tags: ['annuler', 'cancel', 'frais'] },
      { q: 'Que faire si le chauffeur n\'arrive pas ?', a: 'Attendez 5 minutes après le délai estimé, puis contactez le chauffeur via le chat. Si pas de réponse, signalez le problème depuis l\'app.', tags: ['chauffeur', 'retard', 'attente'] },
    ],
  },
  {
    title: 'Parrainage & Points',
    emoji: '🎁',
    items: [
      { q: 'Comment fonctionne le parrainage ?', a: 'Partagez votre code dans Paramètres → Parrainage. Vous recevez des points à l\'inscription de votre filleul et à sa 1ère course.', tags: ['parrainage', 'code', 'referral', 'filleul'] },
      { q: 'Comment utiliser mes points ?', a: 'Les points AeroCab se convertissent en réductions sur vos prochaines courses. Consultez votre solde dans l\'onglet Points.', tags: ['points', 'cashback', 'réduction'] },
    ],
  },
  {
    title: 'Sécurité',
    emoji: '🔒',
    items: [
      { q: 'Comment fonctionne l\'authentification biométrique ?', a: 'Activez l\'empreinte ou Face ID dans Paramètres → Sécurité. L\'app vous demandera de vous authentifier à chaque ouverture (session valide 12h).', tags: ['biométrie', 'empreinte', 'face id', 'sécurité'] },
      { q: 'Mes données sont-elles sécurisées ?', a: 'Oui. Vos informations sont chiffrées en transit (HTTPS) et au repos. Nous ne partageons jamais vos données personnelles avec des tiers sans consentement.', tags: ['données', 'sécurité', 'confidentialité'] },
    ],
  },
];

export default function HelpScreen() {
  const C = useColors();
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const filtered = useMemo(() => {
    if (!query.trim()) return FAQ_DATA;
    const q = query.toLowerCase();
    return FAQ_DATA.map((section) => ({
      ...section,
      items: section.items.filter((item) =>
        item.q.toLowerCase().includes(q) ||
        item.a.toLowerCase().includes(q) ||
        item.tags.some((t) => t.includes(q))
      ),
    })).filter((s) => s.items.length > 0);
  }, [query]);

  const toggle = (key: string) => setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: C.background ?? '#F9FAFB' }]}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Centre d'aide</Text>
          <Text style={styles.subtitle}>Comment pouvons-nous vous aider ?</Text>
        </View>

        {/* Search */}
        <View style={styles.searchRow}>
          <Search size={18} color="#9CA3AF" style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Rechercher une question…"
            placeholderTextColor="#9CA3AF"
            returnKeyType="search"
          />
        </View>

        {/* FAQ sections */}
        {filtered.map((section) => (
          <View key={section.title} style={styles.section}>
            <Text style={styles.sectionTitle}>{section.emoji} {section.title}</Text>
            {section.items.map((item, i) => {
              const key = `${section.title}-${i}`;
              const isOpen = !!expanded[key];
              return (
                <Pressable key={key} onPress={() => toggle(key)} style={styles.faqItem}>
                  <View style={styles.faqQuestion}>
                    <Text style={styles.faqQuestionText}>{item.q}</Text>
                    {isOpen ? <ChevronUp size={16} color="#6B7280" /> : <ChevronDown size={16} color="#6B7280" />}
                  </View>
                  {isOpen && <Text style={styles.faqAnswer}>{item.a}</Text>}
                </Pressable>
              );
            })}
          </View>
        ))}

        {/* No result → ask bot */}
        {filtered.length === 0 && query.trim() !== '' && (
          <View style={styles.noResult}>
            <Text style={styles.noResultText}>Aucun résultat pour « {query} »</Text>
            <Text style={styles.noResultHint}>Utilisez le chat pour poser votre question au bot.</Text>
          </View>
        )}

        {/* Footer CTA */}
        <View style={styles.footer}>
          <Text style={styles.footerTitle}>Vous n'avez pas trouvé ?</Text>
          <Pressable
            onPress={() => Linking.openURL('mailto:support@aerogo24.com?subject=Aide AeroCab')}
            style={styles.footerBtn}
          >
            <Mail size={16} color="#1D2C4D" />
            <Text style={styles.footerBtnText}>Contacter le support</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { padding: 16, paddingBottom: 40 },
  header: { marginBottom: 20 },
  title: { fontSize: 26, fontWeight: '700', color: '#111827' },
  subtitle: { fontSize: 14, color: '#6B7280', marginTop: 4 },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingHorizontal: 12,
    marginBottom: 20,
    height: 44,
  },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, fontSize: 14, color: '#111827' },
  section: { marginBottom: 20 },
  sectionTitle: { fontSize: 15, fontWeight: '600', color: '#374151', marginBottom: 8 },
  faqItem: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 14,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#F3F4F6',
  },
  faqQuestion: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  faqQuestionText: { flex: 1, fontSize: 14, fontWeight: '500', color: '#111827', lineHeight: 20 },
  faqAnswer: { fontSize: 13, color: '#6B7280', marginTop: 10, lineHeight: 20 },
  noResult: { alignItems: 'center', paddingVertical: 32 },
  noResultText: { fontSize: 15, fontWeight: '500', color: '#374151' },
  noResultHint: { fontSize: 13, color: '#9CA3AF', marginTop: 6 },
  footer: {
    marginTop: 24,
    padding: 20,
    backgroundColor: '#F3F4F6',
    borderRadius: 16,
    alignItems: 'center',
    gap: 12,
  },
  footerTitle: { fontSize: 15, fontWeight: '600', color: '#374151' },
  footerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  footerBtnText: { fontSize: 14, fontWeight: '500', color: '#1D2C4D' },
});
```

- [ ] **Step 3: Add Help tab to tabs layout**

Read `aerocab-native/aerocab-passenger/app/(tabs)/_layout.tsx` to understand the tab structure, then add a Help tab entry.

The entry to add (match the existing icon pattern, using `HelpCircle` from `lucide-react-native`):

```tsx
<Tabs.Screen
  name="help"
  options={{
    title: 'Aide',
    tabBarIcon: ({ color, size }) => <HelpCircle size={size} color={color} />,
  }}
/>
```

Add `HelpCircle` to the lucide-react-native import at the top of `_layout.tsx`.

- [ ] **Step 4: Verify TypeScript**

```bash
cd /home/aragami/aerogo/aerocab-native/aerocab-passenger
npx tsc --noEmit 2>&1 | grep -i "help\|error" | head -10
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add "app/(tabs)/help.tsx" "app/(tabs)/_layout.tsx"
git commit -m "feat(bot): Help screen — FAQ statique avec recherche"
```

---

## Task 6: Admin dashboard — BotPage

**Files:**
- Create: `aerocab-admin/src/pages/BotPage.tsx`
- Modify: `aerocab-admin/src/App.tsx`

- [ ] **Step 1: Create BotPage**

Create `aerocab-admin/src/pages/BotPage.tsx`:

```tsx
import { useState, useEffect } from 'react';
import { Bot, Save, Eye, EyeOff, TestTube2, CheckCircle2, AlertTriangle, Power } from 'lucide-react';
import { adminApi } from '../services/api';

const MODELS = [
  { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 — Rapide & économique (recommandé)' },
  { value: 'claude-sonnet-4-6',         label: 'Claude Sonnet 4.6 — Meilleure qualité' },
  { value: 'claude-opus-4-7',           label: 'Claude Opus 4.7 — Qualité maximale' },
];

export default function BotPage() {
  const [enabled, setEnabled]           = useState(false);
  const [apiKey, setApiKey]             = useState('');
  const [showKey, setShowKey]           = useState(false);
  const [model, setModel]               = useState('claude-haiku-4-5-20251001');
  const [maxTokens, setMaxTokens]       = useState('500');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [saving, setSaving]             = useState(false);
  const [testing, setTesting]           = useState(false);
  const [testResult, setTestResult]     = useState<{ ok: boolean; message: string } | null>(null);
  const [saved, setSaved]               = useState(false);

  useEffect(() => {
    adminApi.getSettings().then((s) => {
      setEnabled(s['bot_enabled'] === 'true');
      setApiKey(s['bot_claude_api_key'] ?? '');
      setModel(s['bot_model'] ?? 'claude-haiku-4-5-20251001');
      setMaxTokens(s['bot_max_tokens'] ?? '500');
      setSystemPrompt(s['bot_system_prompt'] ?? '');
    });
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const entries: Array<[string, string]> = [
        ['bot_enabled',        String(enabled)],
        ['bot_claude_api_key', apiKey],
        ['bot_model',          model],
        ['bot_max_tokens',     maxTokens],
        ['bot_system_prompt',  systemPrompt],
      ];
      for (const [key, value] of entries) {
        await adminApi.setAppSetting(key, value);
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!apiKey) {
      setTestResult({ ok: false, message: 'Entrez d\'abord une clé API.' });
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 20,
          messages: [{ role: 'user', content: 'Dis juste "OK".' }],
        }),
      });
      if (res.ok) {
        setTestResult({ ok: true, message: 'Connexion réussie — clé API valide.' });
      } else {
        const text = await res.text();
        setTestResult({ ok: false, message: `Erreur API : ${text.slice(0, 120)}` });
      }
    } catch (e: any) {
      setTestResult({ ok: false, message: `Erreur réseau : ${e.message}` });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Bot className="h-7 w-7 text-indigo-600" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Bot Assistant IA</h1>
          <p className="text-sm text-gray-500">Configurez le chatbot Claude pour les passagers</p>
        </div>
      </div>

      {/* Enable toggle */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium text-gray-900">Activer le bot</p>
            <p className="text-sm text-gray-500">Les passagers verront la bulle de chat flottante</p>
          </div>
          <button
            onClick={() => setEnabled((v) => !v)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${enabled ? 'bg-indigo-600' : 'bg-gray-200'}`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>
      </div>

      {/* API Key */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
        <h2 className="font-semibold text-gray-800">Clé API Anthropic</h2>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-ant-api03-..."
              className="w-full border border-gray-300 rounded-lg px-3 py-2 pr-10 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <button
            onClick={handleTest}
            disabled={testing}
            className="flex items-center gap-2 px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm rounded-lg disabled:opacity-50"
          >
            <TestTube2 size={15} />
            {testing ? 'Test…' : 'Tester'}
          </button>
        </div>
        {testResult && (
          <div className={`flex items-center gap-2 text-sm ${testResult.ok ? 'text-green-700' : 'text-red-600'}`}>
            {testResult.ok ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
            {testResult.message}
          </div>
        )}
        <p className="text-xs text-gray-400">
          Obtenez votre clé sur <a href="https://console.anthropic.com" target="_blank" rel="noreferrer" className="underline">console.anthropic.com</a>
        </p>
      </div>

      {/* Model */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
        <h2 className="font-semibold text-gray-800">Modèle</h2>
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          {MODELS.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
      </div>

      {/* System Prompt */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
        <div>
          <h2 className="font-semibold text-gray-800">System Prompt</h2>
          <p className="text-xs text-gray-500 mt-1">Personnalisez le comportement du bot sans redéploiement. Les données utilisateur (wallet, course active, points, code parrainage) sont injectées automatiquement.</p>
        </div>
        <textarea
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          rows={6}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
          placeholder="Tu es l'assistant AeroCab..."
        />
      </div>

      {/* Max Tokens */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
        <h2 className="font-semibold text-gray-800">Tokens max par réponse</h2>
        <input
          type="number"
          value={maxTokens}
          onChange={(e) => setMaxTokens(e.target.value)}
          min={100}
          max={2000}
          className="w-32 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <p className="text-xs text-gray-400">Entre 100 et 2000. Haiku coûte ~$0.00025 / 1000 tokens.</p>
      </div>

      {/* Save */}
      <button
        onClick={handleSave}
        disabled={saving}
        className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-3 rounded-xl disabled:opacity-50"
      >
        {saved ? <CheckCircle2 size={18} /> : <Save size={18} />}
        {saving ? 'Sauvegarde…' : saved ? 'Sauvegardé !' : 'Sauvegarder la configuration'}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Add route to App.tsx**

Open `aerocab-admin/src/App.tsx`. Add the import:

```typescript
import BotPage from './pages/BotPage';
```

Add the route inside the `<Routes>` block (after the settings route):

```tsx
<Route path="/bot" element={<PermissionRoute permission="edit_settings"><BotPage /></PermissionRoute>} />
```

- [ ] **Step 3: Add Bot link to sidebar/nav**

Find the sidebar navigation component (likely `aerocab-admin/src/components/Sidebar.tsx` or similar). Add a nav item:

```bash
find /home/aragami/aerogo/aerocab-admin/src -name "Sidebar*" -o -name "Navbar*" -o -name "Nav*" | grep -v node_modules
```

Once found, add a nav entry after Settings:

```tsx
{ path: '/bot', label: 'Bot Assistant', icon: Bot, permission: 'edit_settings' }
```

Import `Bot` from `lucide-react`.

- [ ] **Step 4: Verify TypeScript**

```bash
cd /home/aragami/aerogo/aerocab-admin
npx tsc --noEmit 2>&1 | grep -i "bot\|error" | head -10
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/pages/BotPage.tsx src/App.tsx
git commit -m "feat(bot): admin BotPage — config clé API, modèle, system prompt, toggle"
```

---

## Self-Review

**1. Spec coverage:**
- ✅ Bulle flottante passager (FloatingBot FAB + bottom sheet)
- ✅ Écran d'aide FAQ statique avec recherche
- ✅ Backend POST /bot/message (JWT-protected)
- ✅ Enrichissement system prompt avec données utilisateur live
- ✅ Config admin (bot_enabled, api_key, model, system_prompt, max_tokens)
- ✅ Clé API jamais exposée côté client
- ✅ Historique persisté SecureStore (20 messages max)
- ✅ Fallback offline gracieux ("temporairement indisponible")

**2. Placeholder scan:** Aucun TBD, TODO, ou placeholder détecté.

**3. Type consistency:**
- `BotMessage.role: 'user' | 'assistant'` — utilisé cohéremment dans FloatingBot, botHistory, api.ts, BotService
- `ChatHistoryItemDto.role` — identique
- `api.sendBotMessage(token, message, history)` — signature correcte dans FloatingBot
- `bot_claude_api_key` / `bot_enabled` etc. — mêmes clés dans seed.ts, BotService, BotPage
