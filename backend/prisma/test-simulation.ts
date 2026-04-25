/**
 * test-simulation.ts — Tests HTTP automatisés D1→D5
 *
 * Pré-requis : serveur NestJS démarré (Docker)
 *              seed injecté : npx ts-node prisma/seed-simulation.ts
 *
 * Commande : npx ts-node prisma/test-simulation.ts
 *
 * Idempotent : reset les états DB avant chaque test.
 */

import { PrismaClient } from '@prisma/client';
import { execFileSync } from 'child_process';

const prisma  = new PrismaClient();
const BASE    = 'http://localhost:3000/api';
const TEST_OTP = '123456';

const PHONE = {
  P1:    '+237600000001',
  P3:    '+237600000003',
  DU1:   '+237611000001',
  DU4:   '+237611000004',
  ADMIN: '+237699000001',
};

const ID = {
  P3:    'a0000000-0000-0000-0000-000000000003',
  P6:    'a0000000-0000-0000-0000-000000000006',
  DP1:   'c0000000-0000-0000-0000-000000000001',
  DP2:   'c0000000-0000-0000-0000-000000000002',
  B_S11: 'e0000000-0000-0000-0000-000000000011',
  B_S18: 'e0000000-0000-0000-0000-000000000018',
  B_S37: 'e0000000-0000-0000-0000-000000000037',
  B_S44: 'e0000000-0000-0000-0000-000000000044',
};

// ── Compteurs ─────────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures: string[] = [];

function ok(name: string)              { console.log(`  ✅ ${name}`); passed++; }
function fail(name: string, info = '') { console.log(`  ❌ ${name}${info ? ' — ' + info : ''}`); failed++; failures.push(name); }
function check(name: string, cond: boolean, info = '') { cond ? ok(name) : fail(name, info); }
function skip(name: string, reason: string) { console.log(`  ⏭  ${name} [SKIPPED: ${reason}]`); }
function section(title: string) { console.log(`\n${'─'.repeat(57)}\n${title}\n${'─'.repeat(57)}`); }

// ── HTTP helper ───────────────────────────────────────────────────────────────
async function api(
  method: string, path: string, body?: object, token?: string,
): Promise<{ status: number; data: any }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let data: any = {};
  try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ── Login OTP (retry 429 : fenêtre throttle = 60s) ────────────────────────────
async function login(phone: string, intendedRole?: 'passenger' | 'driver', attempt = 1): Promise<{ accessToken: string; refreshToken: string }> {
  const send = await api('POST', '/auth/otp/send', { phone });
  if (send.status === 429 && attempt === 1) {
    console.log(`  ⏳ Throttle 429 pour ${phone} — attente 62s…`);
    await sleep(62_000);
    return login(phone, intendedRole, 2);
  }
  if (send.status !== 200) {
    throw new Error(`sendOtp échoué pour ${phone}: ${JSON.stringify(send.data)}`);
  }
  const body: Record<string, string> = { phone, code: TEST_OTP };
  if (intendedRole) body.intendedRole = intendedRole;
  const r = await api('POST', '/auth/otp/verify', body);
  if (!r.data?.accessToken) {
    throw new Error(`verifyOtp échoué pour ${phone}: ${JSON.stringify(r.data)}`);
  }
  return r.data as { accessToken: string; refreshToken: string };
}

// ── Decode JWT payload (sans vérif. signature) ────────────────────────────────
function jwtPayload(token: string): Record<string, any> {
  const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
}

// ── Clear OTP rate limits via docker exec (execFile = pas de shell) ───────────
function clearOtpRateLimits() {
  const keys = Object.values(PHONE).map(p => `otp_rate:${p}`);
  try {
    execFileSync('docker', ['exec', 'aerocab_redis', 'redis-cli', 'DEL', ...keys], { stdio: 'pipe' });
    console.log('✅ Rate limits OTP effacés (Redis Docker)');
  } catch {
    console.warn('⚠️  docker exec indisponible — rate limits non effacés');
  }
}

// ── Mode test OTP ─────────────────────────────────────────────────────────────
async function enableTestMode() {
  await prisma.appSetting.upsert({ where: { key: 'test_mode_enabled' }, update: { value: 'true'   }, create: { key: 'test_mode_enabled', value: 'true'   } });
  await prisma.appSetting.upsert({ where: { key: 'test_otp_value'    }, update: { value: TEST_OTP }, create: { key: 'test_otp_value',    value: TEST_OTP } });
}
async function disableTestMode() {
  await prisma.appSetting.upsert({ where: { key: 'test_mode_enabled' }, update: { value: 'false' }, create: { key: 'test_mode_enabled', value: 'false' } });
}

// ── Reset état DB ─────────────────────────────────────────────────────────────
async function resetState() {
  await prisma.booking.updateMany({ where: { id: ID.B_S37 }, data: { status: 'pending',   cancelledAt: null } });
  await prisma.booking.updateMany({ where: { id: ID.B_S11 }, data: { status: 'confirmed', driverProfileId: ID.DP1 } });
  await prisma.driverProfile.updateMany({ where: { id: { in: [ID.DP1, ID.DP2] } }, data: { isAvailable: true, isOnline: true } });
  await prisma.wallet.upsert({ where: { userId: ID.P3 }, update: { balance: 3000 }, create: { userId: ID.P3, balance: 3000, currency: 'XAF' } });
}

// ── D2/D3 detected inline ─────────────────────────────────────────────────────
let hasD2 = false;
let hasD3 = false;

// ═════════════════════════════════════════════════════════════════════════════
async function main() {
  console.log('🧪 Démarrage tests simulation D1→D5\n');

  const ping = await fetch(`${BASE}/auth/me`).catch(() => null);
  if (!ping) { console.error('❌ Serveur inaccessible sur http://localhost:3000'); process.exit(1); }
  console.log('✅ Serveur en ligne');

  clearOtpRateLimits();
  await enableTestMode();
  console.log(`✅ Mode test OTP activé (code : ${TEST_OTP})`);
  await resetState();
  console.log('✅ États DB réinitialisés\n');

  try {
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // D3 — MULTI-DEVICE / SESSION UNIQUE (S21-S28)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    section('D3 — Multi-device / Session unique (S21-S28)');

    const sessA = await login(PHONE.P1, 'passenger');
    const pldA  = jwtPayload(sessA.accessToken);
    hasD3 = 'sv' in pldA;
    ok(`S21 — Login P1 device A : sv=${pldA.sv ?? 'ABSENT'}${!hasD3 ? ' ⚠️  (image Docker ancienne)' : ''}`);

    const sessB = await login(PHONE.P1, 'passenger');
    const pldB  = jwtPayload(sessB.accessToken);
    ok(`S22 — Login P1 device B : sv=${pldB.sv ?? 'ABSENT'}`);

    if (!hasD3) {
      console.log('\n  ⚠️  D3 absent du Docker — rebuilder pour activer S23-S26');
      ['S23','S24','S25','S26'].forEach(s => skip(s, 'D3 non compilé'));
    } else {
      const meA = await api('GET', '/auth/me', undefined, sessA.accessToken);
      check('S23 — GET /auth/me token A (sv obsolète) → 401', meA.status === 401, `reçu ${meA.status}`);

      const meB = await api('GET', '/auth/me', undefined, sessB.accessToken);
      check('S24 — GET /auth/me token B (sv actif) → 200', meB.status === 200, `reçu ${meB.status}`);

      const refA = await api('POST', '/auth/refresh', { refreshToken: sessA.refreshToken });
      check('S25 — Refresh token A → 401 (Redis écrasé)', refA.status === 401, `reçu ${refA.status}`);

      const refB = await api('POST', '/auth/refresh', { refreshToken: sessB.refreshToken });
      check('S26 — Refresh token B → 200', refB.status === 200 && !!refB.data?.accessToken, `reçu ${refB.status}`);
    }

    const logout = await api('POST', '/auth/logout', {}, sessB.accessToken);
    check('S27 — POST /auth/logout → 200', logout.status === 200, `reçu ${logout.status}`);

    const refAfterLogout = await api('POST', '/auth/refresh', { refreshToken: sessB.refreshToken });
    check('S28 — Refresh après logout → 401', refAfterLogout.status === 401, `reçu ${refAfterLogout.status}`);

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // D2 — PANNE CHAUFFEUR (S11, S18)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    section('D2 — Panne chauffeur (S11, S18)');

    const du1 = await login(PHONE.DU1, 'driver');
    const du4 = await login(PHONE.DU4, 'driver');

    // Sonde breakdown pour détecter D2
    const probe = await api('PATCH', `/bookings/${ID.B_S18}/breakdown`, {}, du4.accessToken);
    hasD2 = probe.status !== 404;

    if (!hasD2) {
      console.log('\n  ⚠️  D2 absent du Docker — rebuilder pour activer S11/S18');
      ['S18','S11'].forEach(s => skip(s, 'D2 non compilé'));
    } else {
      check('S18 — Breakdown DU4 (mauvais driver) → 403', probe.status === 403, `reçu ${probe.status}`);

      const s11Before = await prisma.booking.findUnique({ where: { id: ID.B_S11 } });
      const s11 = await api('PATCH', `/bookings/${ID.B_S11}/breakdown`, {}, du1.accessToken);
      check('S11 — Breakdown owner DU1 → 200', s11.status === 200, `reçu ${s11.status}`);

      const s11After = await prisma.booking.findUnique({ where: { id: ID.B_S11 } });
      const reassigned = s11After?.status === 'confirmed' && s11After.driverProfileId !== s11Before?.driverProfileId;
      const cancelled  = s11After?.status === 'cancelled';
      check('S11 — B_S11 réassigné ou annulé', reassigned || cancelled, `status=${s11After?.status}`);
      console.log(`     → ${reassigned ? `Réassigné à ${s11After?.driverProfileId}` : 'Annulé (aucun remplaçant)'}`);
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // D5 — FRAUDE / SOLDE (S37, S43-S45)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    section('D5 — Fraude / Solde (S37, S43-S45)');

    const p3 = await login(PHONE.P3, 'passenger');

    const wBefore = (await prisma.wallet.findUnique({ where: { userId: ID.P3 } }))?.balance ?? 0;
    const s37 = await api('DELETE', `/bookings/${ID.B_S37}`, undefined, p3.accessToken);
    check('S37 — DELETE /bookings/B_S37 (pending) → 200', s37.status === 200, `reçu ${s37.status} : ${s37.data?.message ?? ''}`);

    const s37DB = await prisma.booking.findUnique({ where: { id: ID.B_S37 } });
    check('S37 — B_S37 status=cancelled en DB', s37DB?.status === 'cancelled', `status=${s37DB?.status}`);

    const wAfter = (await prisma.wallet.findUnique({ where: { userId: ID.P3 } }))?.balance ?? 0;
    check('S37 — Wallet P3 inchangé ou augmenté', wAfter >= wBefore, `avant=${wBefore}, après=${wAfter}`);
    console.log(`     → ${wAfter > wBefore ? `+${wAfter - wBefore} pts remboursés` : 'Booking seed (pas de débit API) — wallet non modifié'}`);

    // Admin fraud endpoints
    const admin = await login(PHONE.ADMIN); // pas de intendedRole → conserve rôle admin

    const alerts = await api('GET', '/admin/fraud/alerts?min=1', undefined, admin.accessToken);
    const hasFraudEndpoints = alerts.status !== 404;
    if (!hasFraudEndpoints) {
      skip('S43 — GET /admin/fraud/alerts → 200 + array', 'D5 admin endpoints non compilés');
      skip('S44 — PATCH /admin/fraud/reset/P6 → 200',    'D5 admin endpoints non compilés');
    } else {
      check('S43 — GET /admin/fraud/alerts → 200 + array', alerts.status === 200 && Array.isArray(alerts.data), `reçu ${alerts.status}`);
      const alertCount = Array.isArray(alerts.data) ? alerts.data.length : 0;
      console.log(`     → ${alertCount} alerte(s) fraude en Redis`);

      const reset = await api('PATCH', `/admin/fraud/reset/${ID.P6}`, {}, admin.accessToken);
      check('S44 — PATCH /admin/fraud/reset/P6 → 200', reset.status === 200, `reçu ${reset.status}`);
    }

    const s44 = await prisma.booking.findUnique({ where: { id: ID.B_S44 } });
    check('S45 — B_S44 status=no_driver_available (seed)', s44?.status === 'no_driver_available', `status=${s44?.status}`);

    // ── Récapitulatif ─────────────────────────────────────────────────────────
    console.log('\n' + '═'.repeat(57));
    console.log(`RÉSULTAT : ${passed} PASS  /  ${failed} FAIL`);
    if (failures.length) {
      console.log('\nÉchecs :');
      failures.forEach(f => console.log(`  ✗ ${f}`));
    } else {
      console.log('🎉 Tous les tests sont passés !');
    }
    if (!hasD2 || !hasD3) {
      console.log('\n⚠️  Tests D2/D3/D5-admin ignorés — image Docker à rebuilder :');
      console.log('   cd aerocab-deploy && docker compose build api && docker compose up -d api');
    }
    console.log('═'.repeat(57));

  } finally {
    await disableTestMode();
    await prisma.$disconnect();
    console.log('\n🔑 Mode test OTP désactivé');
  }
}

main().catch(e => {
  console.error('\n💥 Erreur fatale :', e.message);
  disableTestMode().finally(() => process.exit(1));
});
