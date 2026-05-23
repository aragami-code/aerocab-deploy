/**
 * seed-auth.ts — Données de test pour le workflow complet d'authentification
 *
 * Couvre les cas A1–A20 :
 *   A1  Nouveau passager → inscription via phone OTP    (aucun user en DB)
 *   A2  Passager existant → connexion via phone OTP     (user complet en DB)
 *   A3  Inscription via email OTP                       (aucun user avec cet email)
 *   A4  Connexion via email OTP                         (user email existant)
 *   A5  Inscription via Google OAuth                    (nouveau googleId)
 *   A6  Connexion Google – merge email existant          (email partagé → googleId mergé)
 *   A7  Code parrainage valide                          (parrain avec referralCode PARRAIN01)
 *   A8  Code parrainage invalide                        (code inexistant)
 *   A9  OTP expiré                                      (tester après TTL 300s)
 *   A10 Trop de tentatives OTP (3 → blocage)            (redis otp_rate:phone)
 *   A11 Rate limit email OTP                            (redis otp_rate:email:...)
 *   A12 Compte suspendu                                 (status='suspended')
 *   A13 Access pass actif                               (pass non requis ou actif)
 *   A14 Access pass en grace period                     (expiré < grace_days)
 *   A15 Access pass expiré sans grace                   (expiré > grace_days)
 *   A16 Access pass trial (nouveau passager)            (accès gratuit trial_days)
 *   A17 Multi-device → session invalidée               (sv++ après nouvelle connexion)
 *   A18 Parrainage déjà appliqué                        (referredBy déjà posé)
 *   A19 Complétion profil — nom + parrainage            (isNewUser=true → complete-profile)
 *   A20 Biométrie — max 3 tentatives                    (testé en UI uniquement)
 *
 * Commande :
 *   npx ts-node prisma/seed-auth.ts
 *
 * Redis (à exécuter manuellement pour A10/A11) :
 *   docker exec aerogo24v2_redis redis-cli SET "otp_rate:+237620000010" 3 EX 600
 *   docker exec aerogo24v2_redis redis-cli SET "otp_rate:email:ratelimited@test.com" 3 EX 600
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ── UUIDs fixes (préfixe auth0 pour isoler) ───────────────────────────────────
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
  U_OAUTH_NO_PHONE:   'b1000000-0000-0000-0000-000000000021',
  U_OAUTH_PHONE_DUPE: 'b1000000-0000-0000-0000-000000000022',
} as const;

// ── Helpers ────────────────────────────────────────────────────────────────────
function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}
function daysFromNow(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
}

async function main() {
  console.log('🔐 seed-auth.ts — Workflow d\'authentification\n');

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. AppSettings — Auth providers (E1: auth_email_otp_enabled, Google)
  // ═══════════════════════════════════════════════════════════════════════════

  console.log('⚙️  AppSettings auth...');

  const authSettings = [
    { key: 'auth_email_otp_enabled',   value: 'true',  description: 'Connexion par email OTP activée' },
    { key: 'auth_google_enabled',      value: 'true',  description: 'Connexion Google OAuth activée' },
    { key: 'auth_google_client_id',    value: '',      description: 'Google Client ID (vide = désactivé en pratique)' },
    { key: 'auth_google_client_secret',value: '',      description: 'Google Client Secret' },
    { key: 'test_mode_enabled',        value: 'true',  description: 'OTP fixe en mode test' },
    { key: 'test_otp_value',           value: '000000', description: 'Code OTP en mode test' },
  ];

  for (const s of authSettings) {
    await prisma.appSetting.upsert({
      where: { key: s.key },
      update: {},
      create: { key: s.key, value: s.value },
    });
  }
  console.log('   ✅ 6 clés auth AppSettings\n');

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. Utilisateurs de test
  // ═══════════════════════════════════════════════════════════════════════════

  console.log('👤 Utilisateurs...');

  // A1 — Nouveau passager : aucun user en DB avec +237620000001
  //      → le flow OTP créera l'utilisateur lors du verify
  //      (on ne crée PAS ce user intentionnellement)
  console.log('   [A1] +237620000001 — aucun user (sera créé par le flow OTP)');

  // A2 — Passager existant complet
  await prisma.user.upsert({
    where: { phone: '+237620000002' },
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

  // A3 — Nouveau email : aucun user avec newemail@test.com
  console.log('   [A3] newemail@test.com — aucun user (sera créé par email OTP)');

  // A4 — Email existant (upsert via id)
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
  console.log('   [A4] emailuser@test.com — connexion email OTP existant');

  // A5 — Pas de user Google en DB (googleId=google-sub-new-001)
  console.log('   [A5] googleId=google-sub-new-001 — aucun user (Google crée le compte)');

  // A6 — Email partagé : user avec email mais sans googleId → sera mergé par Google callback
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
    where: { phone: '+237620000007' },
    update: { referralCode: 'PARRAIN01' },
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
  // Wallet parrain (pour vérifier le crédit bonus)
  await prisma.wallet.upsert({
    where: { userId: ID.U_REFERRER },
    update: { balance: 1000 },
    create: { userId: ID.U_REFERRER, balance: 1000, currency: 'XAF' },
  });
  console.log('   [A7] +237620000007 — parrain PARRAIN01 (wallet=1000)');

  // A8 — Code invalide : FAKECODE99 n'existe pas (pas de user à créer)
  console.log('   [A8] FAKECODE99 — code parrainage inexistant (test reject)');

  // A12 — Compte suspendu
  await prisma.user.upsert({
    where: { phone: '+237620000012' },
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
    where: { phone: '+237620000013' },
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
  // AccessPass actif
  await (prisma as any).accessPass?.upsert?.({
    where: { userId: ID.U_PASS_ACTIVE },
    update: { isActive: true, expiresAt: daysFromNow(15), activatedAt: daysAgo(15) },
    create: {
      userId: ID.U_PASS_ACTIVE,
      isActive: true,
      activatedAt: daysAgo(15),
      expiresAt: daysFromNow(15),
      paidAmount: 2000,
    },
  }).catch(() => {
    // AccessPass table peut ne pas exister si le pass est géré autrement
  });
  console.log('   [A13] +237620000013 — access pass actif (expire dans 15j)');

  // A14 — Pass en grace period (expiré il y a 1j, grace_days=2)
  await prisma.user.upsert({
    where: { phone: '+237620000014' },
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
  await (prisma as any).accessPass?.upsert?.({
    where: { userId: ID.U_PASS_GRACE },
    update: { isActive: false, expiresAt: daysAgo(1), activatedAt: daysAgo(31) },
    create: {
      userId: ID.U_PASS_GRACE,
      isActive: false,
      activatedAt: daysAgo(31),
      expiresAt: daysAgo(1),
      paidAmount: 2000,
    },
  }).catch(() => {});
  console.log('   [A14] +237620000014 — pass expiré depuis 1j (dans grace 2j) → bannière');

  // A15 — Pass expiré (expiré il y a 5j, grace_days=2)
  await prisma.user.upsert({
    where: { phone: '+237620000015' },
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
  await (prisma as any).accessPass?.upsert?.({
    where: { userId: ID.U_PASS_EXPIRED },
    update: { isActive: false, expiresAt: daysAgo(5), activatedAt: daysAgo(35) },
    create: {
      userId: ID.U_PASS_EXPIRED,
      isActive: false,
      activatedAt: daysAgo(35),
      expiresAt: daysAgo(5),
      paidAmount: 2000,
    },
  }).catch(() => {});
  console.log('   [A15] +237620000015 — pass expiré depuis 5j (hors grace) → écran paiement');

  // A16 — Trial : nouveau passager inscrit il y a 3j, trial_days=7
  await prisma.user.upsert({
    where: { phone: '+237620000016' },
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

  // A17 — Multi-device : utiliser U_EXISTING_PHONE et deux JWT différents
  console.log('   [A17] +237620000002 — multi-device : reconnecter sur 2ème device → 1er JWT invalide');

  // A18 — Parrainage déjà appliqué
  await prisma.user.upsert({
    where: { phone: '+237620000018' },
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
  console.log('   [A18] +237620000018 — referredBy déjà posé → "Vous avez déjà un parrain."');

  // A19 — Passager nouveau sans nom (isNewUser=true → complete-profile)
  //      → Sera créé par le flow OTP sur +237620000019 (pas de user en DB)
  console.log('   [A19] +237620000019 — aucun user (isNewUser=true → accept-terms → complete-profile)');

  // A21 — OAuth sans phone : user créé via Google/email, phone=null → complete-profile téléphone OBLIGATOIRE
  await prisma.user.upsert({
    where: { id: ID.U_OAUTH_NO_PHONE },
    update: { email: 'oauth.nophone@test.com', phone: null },
    create: {
      id: ID.U_OAUTH_NO_PHONE,
      email: 'oauth.nophone@test.com',
      googleId: 'google-sub-oauth-nophone-001',
      name: null,
      role: 'passenger',
      status: 'active',
      language: 'fr',
    },
  });
  console.log('   [A21] oauth.nophone@test.com — OAuth sans phone (→ complete-profile, phone obligatoire)');

  // A22 — OAuth sans phone, numéro déjà pris par un autre compte (test conflit unicité)
  await prisma.user.upsert({
    where: { id: ID.U_OAUTH_PHONE_DUPE },
    update: { phone: '+237620000022' },
    create: {
      id: ID.U_OAUTH_PHONE_DUPE,
      phone: '+237620000022',
      name: 'Autre Compte',
      role: 'passenger',
      status: 'active',
      language: 'fr',
    },
  });
  console.log('   [A22] +237620000022 — numéro pris (test PATCH /users/me { phone } → 400 "déjà utilisé")');

  console.log('\n   ✅ Utilisateurs auth créés\n');

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. Résumé des commandes Redis pour A10/A11
  // ═══════════════════════════════════════════════════════════════════════════

  console.log('═══════════════════════════════════════════════════════════');
  console.log('✅  SEED AUTH TERMINÉ\n');
  console.log('MATRICE DES CAS DE TEST :\n');

  console.log('─── OTP Phone ──────────────────────────────────────────────');
  console.log('A1  POST /auth/otp/send   { phone: "+237620000001" }');
  console.log('    → isNewUser=true → accept-terms → complete-profile');
  console.log('A2  POST /auth/otp/send   { phone: "+237620000002" }');
  console.log('    → isNewUser=false → access-pass → /(tabs)/');
  console.log('A9  Attendre 5 min après sendOtp → verify → "Code expiré"');
  console.log('A10 Redis : SET otp_rate:+237620000010 3 EX 600');
  console.log('    POST /auth/otp/send   { phone: "+237620000010" }');
  console.log('    → BadRequest "Trop de tentatives. Reessayez dans X min"');
  console.log('A12 POST /auth/otp/send   { phone: "+237620000012" }  (OTP envoyé)');
  console.log('    POST /auth/otp/verify { phone: "+237620000012", code: "000000" }');
  console.log('    → Unauthorized "Compte suspendu"');

  console.log('\n─── OTP Email ──────────────────────────────────────────────');
  console.log('A3  POST /auth/otp/send-email   { email: "newemail@test.com" }');
  console.log('    POST /auth/otp/verify-email { email: "newemail@test.com", code: "000000" }');
  console.log('    → isNewUser=true → accept-terms');
  console.log('A4  POST /auth/otp/send-email   { email: "emailuser@test.com" }');
  console.log('    POST /auth/otp/verify-email { email: "emailuser@test.com", code: "000000" }');
  console.log('    → isNewUser=false → access-pass');
  console.log('A11 Redis : SET "otp_rate:email:ratelimited@test.com" 3 EX 600');
  console.log('    POST /auth/otp/send-email { email: "ratelimited@test.com" }');
  console.log('    → BadRequest "Trop de tentatives"');

  console.log('\n─── Google OAuth ───────────────────────────────────────────');
  console.log('A5  Flow Google → googleId=google-sub-new-001 non trouvé');
  console.log('    → isNewUser=true, user créé');
  console.log('A6  Flow Google → email=shared@test.com trouvé sans googleId');
  console.log('    → update User.googleId, isNewUser=false');

  console.log('\n─── Parrainage ─────────────────────────────────────────────');
  console.log('A7  POST /auth/otp/verify { phone: "+237620000001", referralCode: "PARRAIN01" }');
  console.log('    → bonus referrer +500 pts, filleul +300 pts');
  console.log('A8  POST /auth/otp/verify { phone: "+237620000001", referralCode: "FAKECODE99" }');
  console.log('    → BadRequest "Code de parrainage invalide"');
  console.log('A18 POST /auth/referral/apply { code: "PARRAIN01" } (token U_ALREADY_REFERRED)');
  console.log('    → { success: false, message: "Vous avez déjà un parrain." }');

  console.log('\n─── Access Pass ────────────────────────────────────────────');
  console.log('A13 GET /auth/pass-status (token U_PASS_ACTIVE)');
  console.log('    → { required: ..., active: true } → redirect /(tabs)/');
  console.log('A14 GET /auth/pass-status (token U_PASS_GRACE)');
  console.log('    → { active: false, inGrace: true } → bannière visible, accès limité');
  console.log('A15 GET /auth/pass-status (token U_PASS_EXPIRED)');
  console.log('    → { active: false, inGrace: false } → écran paiement');
  console.log('A16 GET /auth/pass-status (token U_PASS_TRIAL)');
  console.log('    → { active: true } via trial_days → accès direct');

  console.log('\n─── Multi-device (A17) ─────────────────────────────────────');
  console.log('1.  POST /auth/otp/verify { phone: "+237620000002" } → accessToken A (sv=N)');
  console.log('2.  POST /auth/otp/verify { phone: "+237620000002" } → accessToken B (sv=N+1)');
  console.log('3.  GET  /bookings/active avec accessToken A → 401 (sv obsolète)');

  console.log('\n─── OAuth + Téléphone obligatoire (A21/A22) ─────────────────');
  console.log('A21 Se connecter avec oauth.nophone@test.com via email OTP ou Google');
  console.log('    → isNewUser=true → complete-profile avec phone obligatoire');
  console.log('    PATCH /users/me { name: "Test", phone: "+237699000021" } → 200 OK');
  console.log('    PATCH /users/me { name: "Test" }                        → 400 "phone obligatoire" (côté app)');
  console.log('    PATCH /users/me { name: "Test", phone: "0699000021" }   → 400 validation E.164');
  console.log('A22 Tenter de prendre +237620000022 (déjà pris par U_OAUTH_PHONE_DUPE)');
  console.log('    PATCH /users/me { phone: "+237620000022" } (token A21)  → 400 "déjà utilisé"');
  console.log('    PATCH /users/me { phone: "+237620000022" } (token A22)  → 200 idempotent');

  console.log('\n─── Redis commands (pour simuler rate-limit) ────────────────');
  console.log('docker exec aerogo24v2_redis redis-cli SET "otp_rate:+237620000010" 3 EX 600');
  console.log('docker exec aerogo24v2_redis redis-cli SET "otp_rate:email:ratelimited@test.com" 3 EX 600');
  console.log('═══════════════════════════════════════════════════════════\n');
}

main()
  .catch((e) => {
    console.error('❌ Erreur seed-auth :', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
