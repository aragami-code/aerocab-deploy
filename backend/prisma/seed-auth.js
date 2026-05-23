'use strict';
/**
 * seed-auth.js — Version JavaScript pour exécution dans le container Docker
 * node /tmp/seed-auth.js
 */
const { PrismaClient } = require('/app/node_modules/.pnpm/@prisma+client@6.19.2_prisma@6.19.2_typescript@5.9.3__typescript@5.9.3/node_modules/.prisma/client');

const prisma = new PrismaClient();

// Préfixe b1 = hex valide (seed auth), isolé du préfixe a0 (seed simulation)
const ID = {
  U_EXISTING_PHONE:   'b1000000-0000-0000-0000-000000000002',
  U_EXISTING_EMAIL:   'b1000000-0000-0000-0000-000000000004',
  U_EMAIL_SHARED:     'b1000000-0000-0000-0000-000000000006',
  U_REFERRER:         'b1000000-0000-0000-0000-000000000007',
  U_SUSPENDED:        'b1000000-0000-0000-0000-000000000012',
  U_PASS_ACTIVE:      'b1000000-0000-0000-0000-000000000013',
  U_PASS_GRACE:       'b1000000-0000-0000-0000-000000000014',
  U_PASS_EXPIRED:     'b1000000-0000-0000-0000-000000000015',
  U_PASS_TRIAL:       'b1000000-0000-0000-0000-000000000016',
  U_ALREADY_REFERRED: 'b1000000-0000-0000-0000-000000000018',
};

function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return d; }
function daysFromNow(n) { const d = new Date(); d.setDate(d.getDate() + n); return d; }

async function upsertSetting(key, value) {
  await prisma.appSetting.upsert({
    where: { key },
    update: {},
    create: { key, value },
  });
}

async function main() {
  console.log('🔐 seed-auth.js — Workflow d\'authentification\n');

  // ── AppSettings auth ──────────────────────────────────────────────────────
  console.log('⚙️  AppSettings auth...');
  await upsertSetting('auth_email_otp_enabled', 'true');
  await upsertSetting('auth_google_enabled', 'true');
  await upsertSetting('auth_google_client_id', '');
  await upsertSetting('auth_google_client_secret', '');
  await upsertSetting('test_mode_enabled', 'true');
  await upsertSetting('test_otp_value', '000000');
  console.log('   ✅ 6 clés auth AppSettings\n');

  // ── Utilisateurs ──────────────────────────────────────────────────────────
  console.log('👤 Utilisateurs...');

  // A1 — Pas de user en DB pour +237620000001 (créé par le flow)
  // S'assurer qu'il n'existe pas (idempotent)
  await prisma.user.deleteMany({ where: { phone: '+237620000001' } }).catch(() => {});
  console.log('   [A1] +237620000001 — aucun user (sera créé par flow OTP)');

  // A2 — Passager existant
  await prisma.user.upsert({
    where: { id: ID.U_EXISTING_PHONE },
    update: { name: 'Passager Existant', email: 'existing@test.com' },
    create: {
      id: ID.U_EXISTING_PHONE,
      phone: '+237620000002',
      name: 'Passager Existant',
      email: 'existing@test.com',
      role: 'passenger',
      status: 'active',
      language: 'fr',
    },
  });
  console.log('   [A2] +237620000002 — passager existant (connexion directe)');

  // A3 — Pas de user avec newemail@test.com (créé par le flow)
  console.log('   [A3] newemail@test.com — aucun user (sera créé par email OTP)');

  // A4 — Email existant
  await prisma.user.upsert({
    where: { id: ID.U_EXISTING_EMAIL },
    update: { name: 'Email User', email: 'emailuser@test.com' },
    create: {
      id: ID.U_EXISTING_EMAIL,
      email: 'emailuser@test.com',
      name: 'Email User',
      role: 'passenger',
      status: 'active',
      language: 'fr',
    },
  });
  console.log('   [A4] emailuser@test.com — email OTP existant');

  // A6 — Email partagé (merge Google)
  await prisma.user.upsert({
    where: { id: ID.U_EMAIL_SHARED },
    update: { name: 'Shared Email User', googleId: null },
    create: {
      id: ID.U_EMAIL_SHARED,
      email: 'shared@test.com',
      name: 'Shared Email User',
      role: 'passenger',
      status: 'active',
      language: 'fr',
      googleId: null,
    },
  });
  console.log('   [A6] shared@test.com — googleId null → merge après Google OAuth');

  // A7 — Parrain avec referralCode PARRAIN01
  await prisma.user.upsert({
    where: { referralCode: 'PARRAIN01' },
    update: { name: 'Le Parrain', phone: '+237620000007' },
    create: {
      id: ID.U_REFERRER,
      phone: '+237620000007',
      name: 'Le Parrain',
      role: 'passenger',
      status: 'active',
      language: 'fr',
      referralCode: 'PARRAIN01',
    },
  });
  await prisma.wallet.upsert({
    where: { userId: ID.U_REFERRER },
    update: { balance: 1000 },
    create: { userId: ID.U_REFERRER, balance: 1000, currency: 'XAF' },
  });
  console.log('   [A7] +237620000007 — parrain PARRAIN01 (wallet=1000)');

  // A12 — Compte suspendu
  await prisma.user.upsert({
    where: { id: ID.U_SUSPENDED },
    update: { status: 'suspended' },
    create: {
      id: ID.U_SUSPENDED,
      phone: '+237620000012',
      name: 'Compte Suspendu',
      role: 'passenger',
      status: 'suspended',
      language: 'fr',
    },
  });
  console.log('   [A12] +237620000012 — compte suspendu → UnauthorizedException');

  // A13 — Pass actif
  await prisma.user.upsert({
    where: { id: ID.U_PASS_ACTIVE },
    update: {},
    create: {
      id: ID.U_PASS_ACTIVE,
      phone: '+237620000013',
      name: 'Pass Actif',
      role: 'passenger',
      status: 'active',
      language: 'fr',
    },
  });
  // Tenter de créer un AccessPass si le modèle existe
  try {
    await prisma.accessPass.upsert({
      where: { userId: ID.U_PASS_ACTIVE },
      update: { isActive: true, expiresAt: daysFromNow(15), activatedAt: daysAgo(15) },
      create: {
        userId: ID.U_PASS_ACTIVE,
        isActive: true,
        activatedAt: daysAgo(15),
        expiresAt: daysFromNow(15),
        paidAmount: 2000,
      },
    });
    console.log('   [A13] +237620000013 — access pass actif (expire dans 15j)');
  } catch (e) {
    console.log('   [A13] +237620000013 — user créé (AccessPass géré via champ User)');
  }

  // A14 — Pass grace period (expiré il y a 1j, grace=2j)
  await prisma.user.upsert({
    where: { id: ID.U_PASS_GRACE },
    update: {},
    create: {
      id: ID.U_PASS_GRACE,
      phone: '+237620000014',
      name: 'Pass Grace',
      role: 'passenger',
      status: 'active',
      language: 'fr',
    },
  });
  try {
    await prisma.accessPass.upsert({
      where: { userId: ID.U_PASS_GRACE },
      update: { isActive: false, expiresAt: daysAgo(1), activatedAt: daysAgo(31) },
      create: {
        userId: ID.U_PASS_GRACE,
        isActive: false,
        activatedAt: daysAgo(31),
        expiresAt: daysAgo(1),
        paidAmount: 2000,
      },
    });
    console.log('   [A14] +237620000014 — pass expiré 1j (grace 2j) → bannière');
  } catch (e) {
    console.log('   [A14] +237620000014 — user créé (AccessPass non trouvé)');
  }

  // A15 — Pass expiré (5j, hors grace)
  await prisma.user.upsert({
    where: { id: ID.U_PASS_EXPIRED },
    update: {},
    create: {
      id: ID.U_PASS_EXPIRED,
      phone: '+237620000015',
      name: 'Pass Expiré',
      role: 'passenger',
      status: 'active',
      language: 'fr',
    },
  });
  try {
    await prisma.accessPass.upsert({
      where: { userId: ID.U_PASS_EXPIRED },
      update: { isActive: false, expiresAt: daysAgo(5), activatedAt: daysAgo(35) },
      create: {
        userId: ID.U_PASS_EXPIRED,
        isActive: false,
        activatedAt: daysAgo(35),
        expiresAt: daysAgo(5),
        paidAmount: 2000,
      },
    });
    console.log('   [A15] +237620000015 — pass expiré 5j (hors grace) → écran paiement');
  } catch (e) {
    console.log('   [A15] +237620000015 — user créé (AccessPass non trouvé)');
  }

  // A16 — Trial (inscrit il y a 3j, trial_days=7)
  await prisma.user.upsert({
    where: { id: ID.U_PASS_TRIAL },
    update: {},
    create: {
      id: ID.U_PASS_TRIAL,
      phone: '+237620000016',
      name: 'Passager Trial',
      role: 'passenger',
      status: 'active',
      language: 'fr',
      createdAt: daysAgo(3),
    },
  });
  console.log('   [A16] +237620000016 — inscrit il y a 3j, trial 7j → accès gratuit');

  // A18 — Parrainage déjà appliqué
  await prisma.user.upsert({
    where: { id: ID.U_ALREADY_REFERRED },
    update: { referredBy: ID.U_REFERRER },
    create: {
      id: ID.U_ALREADY_REFERRED,
      phone: '+237620000018',
      name: 'Déjà Parrainé',
      role: 'passenger',
      status: 'active',
      language: 'fr',
      referredBy: ID.U_REFERRER,
    },
  });
  console.log('   [A18] +237620000018 — referredBy posé → "Vous avez déjà un parrain."');

  // A19 — Pas de user pour +237620000019 (isNewUser=true)
  await prisma.user.deleteMany({ where: { phone: '+237620000019' } }).catch(() => {});
  console.log('   [A19] +237620000019 — aucun user (isNewUser=true → accept-terms)');

  console.log('\n   ✅ Utilisateurs auth créés\n');

  // ── Résumé Redis ──────────────────────────────────────────────────────────
  console.log('═══════════════════════════════════════════════════════════');
  console.log('✅  SEED AUTH TERMINÉ\n');
  console.log('MATRICE DES CAS A1–A20 :\n');
  console.log('A1  sendOtp +237620000001 → isNewUser=true → accept-terms');
  console.log('A2  sendOtp +237620000002 → isNewUser=false → access-pass');
  console.log('A3  sendEmailOtp newemail@test.com → isNewUser=true');
  console.log('A4  sendEmailOtp emailuser@test.com → isNewUser=false');
  console.log('A5  Google flow → googleId non trouvé → isNewUser=true');
  console.log('A6  Google flow → email=shared@test.com → merge googleId');
  console.log('A7  verifyOtp +237620000001 + referralCode=PARRAIN01 → bonus points');
  console.log('A8  verifyOtp +237620000001 + referralCode=FAKECODE99 → BadRequest');
  console.log('A9  sendOtp → attendre 5 min → verifyOtp → "Code expiré"');
  console.log('A10 Rate limit (Redis) :');
  console.log('    docker exec aerogo24v2_redis redis-cli SET "otp_rate:+237620000010" 3 EX 600');
  console.log('A11 Rate limit email :');
  console.log('    docker exec aerogo24v2_redis redis-cli SET "otp_rate:email:ratelimited@test.com" 3 EX 600');
  console.log('A12 sendOtp +237620000012 → verifyOtp → Unauthorized "Compte suspendu"');
  console.log('A13 login +237620000013 → access pass actif → /(tabs)/');
  console.log('A14 login +237620000014 → pass grace → bannière affiché, accès ok');
  console.log('A15 login +237620000015 → pass expiré → écran paiement');
  console.log('A16 login +237620000016 → trial 7j → accès direct');
  console.log('A17 verifyOtp +237620000002 × 2 → 1er token invalide (sv++)');
  console.log('A18 /auth/referral/apply PARRAIN01 avec token +237620000018 → déjà parrainé');
  console.log('A19 verifyOtp +237620000019 → accept-terms → complete-profile → KYC');
  console.log('A20 biometric-lock → 3 tentatives erronées → logout (test UI)');
  console.log('═══════════════════════════════════════════════════════════\n');
}

main()
  .catch((e) => {
    console.error('❌ Erreur seed-auth :', e.message || e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
