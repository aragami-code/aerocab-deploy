/**
 * Bot Assistant Integration Tests — S201-S220
 *
 * Route: POST /api/bot/message
 *   - JwtAuthGuard (passenger token required)
 *   - Body: { message: string (1-2000), history?: { role: 'user'|'assistant', content: string }[] }
 *   - Returns: { reply: string }
 *
 * Claude API (global.fetch) is mocked — no real HTTP calls.
 * bot_* settings are upserted in beforeAll and reset per test when needed.
 * app_settings is NOT in TRUNCATE_TABLES → persists across tests by design.
 */

import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { getApp, closeApp } from './helpers/app';
import { truncateAll, getPrisma } from './helpers/db';
import { createPassengerToken, createAdminToken } from './helpers/auth';
import { randomUUID } from 'crypto';

// ── Fake Claude API response ──────────────────────────────────────────────────

function claudeOk(text: string) {
  return Promise.resolve({
    ok: true,
    json: async () => ({ content: [{ type: 'text', text }] }),
  } as any);
}

function claudeFail(status = 500, body = 'Internal Server Error') {
  return Promise.resolve({
    ok: false,
    status,
    text: async () => body,
  } as any);
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('Bot Assistant (S201-S220)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fetchSpy: jest.SpyInstance;

  beforeAll(async () => {
    app = await getApp();
    prisma = await getPrisma();
  });

  afterAll(async () => {
    await closeApp();
  });

  beforeEach(async () => {
    await truncateAll();
    // Re-seed bot settings (cleared by truncateAll)
    await prisma.appSetting.upsert({ where: { key: 'bot_enabled' },        update: { value: 'true' },                       create: { key: 'bot_enabled',        value: 'true' } });
    await prisma.appSetting.upsert({ where: { key: 'bot_claude_api_key' }, update: { value: 'sk-ant-test-integration' },     create: { key: 'bot_claude_api_key', value: 'sk-ant-test-integration' } });
    await prisma.appSetting.upsert({ where: { key: 'bot_model' },          update: { value: 'claude-haiku-4-5-20251001' },   create: { key: 'bot_model',          value: 'claude-haiku-4-5-20251001' } });
    await prisma.appSetting.upsert({ where: { key: 'bot_max_tokens' },     update: { value: '500' },                         create: { key: 'bot_max_tokens',     value: '500' } });
    await prisma.appSetting.upsert({ where: { key: 'bot_system_prompt' },  update: { value: 'Tu es l\'assistant AeroCab.' }, create: { key: 'bot_system_prompt',  value: 'Tu es l\'assistant AeroCab.' } });
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  // ── Helper ────────────────────────────────────────────────────────────────

  async function createPassenger(suffix: string) {
    const user = await prisma.user.create({
      data: { phone: `+2376200${suffix}`, role: 'passenger', name: `Test ${suffix}`, status: 'active' },
    });
    return { user, token: createPassengerToken(user.id, user.phone!) };
  }

  function post(token: string | null, body: object) {
    const req = request(app.getHttpServer()).post('/api/bot/message');
    if (token) req.set('Authorization', `Bearer ${token}`);
    return req.send(body);
  }

  // ── S201: token manquant → 401 ────────────────────────────────────────────

  it('S201: POST /bot/message sans token → 401', async () => {
    const res = await post(null, { message: 'Bonjour' });
    expect(res.status).toBe(401);
  });

  // ── S202: token invalide → 401 ────────────────────────────────────────────

  it('S202: token JWT invalide → 401', async () => {
    const res = await post('not.a.valid.jwt', { message: 'Bonjour' });
    expect(res.status).toBe(401);
  });

  // ── S203: token admin (non-passenger) — guard accepte tout rôle valide ────

  it('S203: token admin JWT valide → 201 (guard vérifie seulement le JWT, pas le rôle)', async () => {
    fetchSpy.mockImplementationOnce(() => claudeOk('Bonjour admin !'));
    const admin = await prisma.user.create({
      data: { phone: '+237000000001', role: 'admin', name: 'Admin Test', status: 'active' },
    });
    const token = createAdminToken(admin.id, admin.phone!);
    const res = await post(token, { message: 'Bonjour' });
    // JwtAuthGuard accepte n'importe quel rôle valide — aucune restriction 'passenger' côté bot
    expect(res.status).toBe(201);
  });

  // ── S204: bot désactivé → 503 ─────────────────────────────────────────────

  it('S204: bot_enabled=false → 503', async () => {
    await prisma.appSetting.update({ where: { key: 'bot_enabled' }, data: { value: 'false' } });
    const { token } = await createPassenger('204');
    try {
      const res = await post(token, { message: 'Bonjour' });
      expect(res.status).toBe(503);
    } finally {
      await prisma.appSetting.update({ where: { key: 'bot_enabled' }, data: { value: 'true' } });
    }
  });

  // ── S205: clé API vide → 503 ──────────────────────────────────────────────

  it('S205: bot_claude_api_key vide → 503', async () => {
    await prisma.appSetting.update({ where: { key: 'bot_claude_api_key' }, data: { value: '' } });
    const { token } = await createPassenger('205');
    try {
      const res = await post(token, { message: 'Bonjour' });
      expect(res.status).toBe(503);
    } finally {
      await prisma.appSetting.update({ where: { key: 'bot_claude_api_key' }, data: { value: 'sk-ant-test-integration' } });
    }
  });

  // ── S206: champ message absent → 400 ─────────────────────────────────────

  it('S206: body sans champ message → 400', async () => {
    const { token } = await createPassenger('206');
    const res = await post(token, {});
    expect(res.status).toBe(400);
  });

  // ── S207: message vide → 400 ─────────────────────────────────────────────

  it('S207: message="" → 400 (IsNotEmpty)', async () => {
    const { token } = await createPassenger('207');
    const res = await post(token, { message: '' });
    expect(res.status).toBe(400);
  });

  // ── S208: message > 2000 chars → 400 ─────────────────────────────────────

  it('S208: message > 2000 caractères → 400 (MaxLength)', async () => {
    const { token } = await createPassenger('208');
    const res = await post(token, { message: 'a'.repeat(2001) });
    expect(res.status).toBe(400);
  });

  // ── S209: history avec role invalide → 400 ───────────────────────────────

  it('S209: history item role="moderator" → 400 (IsIn)', async () => {
    const { token } = await createPassenger('209');
    const res = await post(token, {
      message: 'Bonjour',
      history: [{ role: 'moderator', content: 'Contenu' }],
    });
    expect(res.status).toBe(400);
  });

  // ── S210: history item sans content → 400 ────────────────────────────────

  it('S210: history item sans content → 400 (IsNotEmpty)', async () => {
    const { token } = await createPassenger('210');
    const res = await post(token, {
      message: 'Bonjour',
      history: [{ role: 'user', content: '' }],
    });
    expect(res.status).toBe(400);
  });

  // ── S211: history item content > 4000 chars → 400 ────────────────────────

  it('S211: history item content > 4000 chars → 400 (MaxLength)', async () => {
    const { token } = await createPassenger('211');
    const res = await post(token, {
      message: 'Bonjour',
      history: [{ role: 'user', content: 'b'.repeat(4001) }],
    });
    expect(res.status).toBe(400);
  });

  // ── S212: succès — réponse { reply } retournée ────────────────────────────

  it('S212: message valide + bot activé → 200 { reply }', async () => {
    fetchSpy.mockImplementationOnce(() => claudeOk('Bienvenue sur AeroCab !'));
    const { token } = await createPassenger('212');
    const res = await post(token, { message: 'Bonjour' });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('reply', 'Bienvenue sur AeroCab !');
  });

  // ── S213: history omis → 200 (champ optionnel) ───────────────────────────

  it('S213: body sans history → 201 (history est optionnel)', async () => {
    fetchSpy.mockImplementationOnce(() => claudeOk('Bonjour !'));
    const { token } = await createPassenger('213');
    const res = await post(token, { message: 'Salut' });
    expect(res.status).toBe(201);
    expect(res.body.reply).toBe('Bonjour !');
  });

  // ── S214: history envoyée → transmise à Claude ───────────────────────────

  it('S214: history valide → transmise à l\'API Claude', async () => {
    fetchSpy.mockImplementationOnce(() => claudeOk('Oui bien sûr.'));
    const { token } = await createPassenger('214');

    await post(token, {
      message: 'Et ensuite ?',
      history: [
        { role: 'user',      content: 'Comment réserver ?' },
        { role: 'assistant', content: 'Ouvrez l\'app et choisissez un type.' },
      ],
    });

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as any).body);
    expect(body.messages).toHaveLength(3); // 2 history + 1 new
    expect(body.messages[0].role).toBe('user');
    expect(body.messages[0].content).toBe('Comment réserver ?');
    expect(body.messages[2].content).toBe('Et ensuite ?');
  });

  // ── S215: history > 10 items → seulement les 10 derniers envoyés ─────────

  it('S215: history > 10 items → seuls les 10 derniers sont envoyés à Claude', async () => {
    fetchSpy.mockImplementationOnce(() => claudeOk('Compris.'));
    const { token } = await createPassenger('215');

    const history = Array.from({ length: 14 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant' as const,
      content: `Message ${i + 1}`,
    }));

    await post(token, { message: 'Nouveau message', history });

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as any).body);
    // 10 (slice) + 1 (new message)
    expect(body.messages).toHaveLength(11);
    expect(body.messages[0].content).toBe('Message 5'); // les 10 derniers du tableau de 14
  });

  // ── S216: prompt enrichi contient le nom de l'utilisateur ────────────────

  it('S216: system prompt contient le nom de l\'utilisateur', async () => {
    fetchSpy.mockImplementationOnce(() => claudeOk('OK'));
    const user = await prisma.user.create({
      data: { phone: '+237620002160', role: 'passenger', name: 'Alice Martin', status: 'active' },
    });
    const token = createPassengerToken(user.id, user.phone!);

    await post(token, { message: 'Bonjour' });

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as any).body);
    expect(body.system).toContain('Alice Martin');
  });

  // ── S217: prompt enrichi contient le solde wallet ─────────────────────────

  it('S217: system prompt contient le solde du wallet', async () => {
    fetchSpy.mockImplementationOnce(() => claudeOk('OK'));
    const user = await prisma.user.create({
      data: { phone: '+237620002170', role: 'passenger', name: 'Bob', status: 'active' },
    });
    await prisma.wallet.create({ data: { userId: user.id, balance: 18500 } });
    const token = createPassengerToken(user.id, user.phone!);

    await post(token, { message: 'Mon solde ?' });

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as any).body);
    expect(body.system).toContain('18500');
  });

  // ── S218: course active incluse dans le prompt ────────────────────────────

  it('S218: course active (confirmed) → incluse dans le prompt', async () => {
    fetchSpy.mockImplementationOnce(() => claudeOk('OK'));
    const user = await prisma.user.create({
      data: { phone: '+237620002180', role: 'passenger', name: 'Carole', status: 'active' },
    });
    await prisma.booking.create({
      data: {
        passengerId:      user.id,
        status:           'confirmed',
        destination:      'Aéroport Douala',
        estimatedPrice:   9500,
        type:             'DEPARTURE',
        departureAirport: 'DLA',
        vehicleType:      'berline',
        paymentMethod:    'wallet',
      },
    });
    const token = createPassengerToken(user.id, user.phone!);

    await post(token, { message: 'Ma course ?' });

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as any).body);
    expect(body.system).toContain('confirmed');
    expect(body.system).toContain('Aéroport Douala');
    expect(body.system).toContain('9500');
  });

  // ── S219: pas de course active → prompt indique "aucune" ──────────────────

  it('S219: aucune course active → prompt indique "aucune"', async () => {
    fetchSpy.mockImplementationOnce(() => claudeOk('OK'));
    const { token } = await createPassenger('219');

    await post(token, { message: 'Mes courses ?' });

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as any).body);
    expect(body.system).toContain('aucune');
  });

  // ── S220: erreur Claude (non-ok) → 503 ───────────────────────────────────

  it('S220: Claude API répond non-ok → 503', async () => {
    fetchSpy.mockImplementationOnce(() => claudeFail(500, 'overloaded'));
    const { token } = await createPassenger('220');
    const res = await post(token, { message: 'Bonjour' });
    expect(res.status).toBe(503);
  });
});
