/**
 * Test rapide NotchPay sandbox — lance avec :
 *   npx ts-node scripts/test-notchpay-sandbox.ts
 *
 * Remplace les 3 clés ci-dessous depuis ton dashboard NotchPay > API Keys.
 */

const PUBLIC_KEY  = 'pk_test.pRKjmcbQ1YGyGxZEs9rBSKSL3CycjuaJksCT4foNLAaMh9vydppVkz8tw2YJ03fyWBEdNw5kS5EsXOCsiMBFUGj9udSbvNu34Dr7hWsc4FlaSxsrZIGiRKIHY6BDW';
const PRIVATE_KEY = 'sk_test.REMPLACE_MOI';   // Clé privée sandbox (optionnel pour ce test)
const HASH_KEY    = 'hsk_test.REMPLACE_MOI';  // Hash key (optionnel pour ce test)

const BASE = 'https://api.notchpay.co';
const REF  = `TEST-AEROCAB-${Date.now()}`;

// ── 1. Initier un paiement ─────────────────────────────────────────────────
async function testInitiate() {
  console.log('\n📤 [1] Initier un paiement sandbox...');
  const body = {
    amount:      500,            // 500 XAF
    currency:    'XAF',
    reference:   REF,
    description: 'Test recharge wallet AeroCab',
    email:       'test@aerogo24.com',
    phone:       '+237699000001',
    name:        'Test Passager',
    callback:    'https://webhook.site/aerocab-test',  // URL de test temporaire
    redirect:    'aerogo24-passenger://payment/return?ref=TEST',
  };

  const res = await fetch(`${BASE}/payments`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': PUBLIC_KEY },
    body:    JSON.stringify(body),
  });

  const data = await res.json() as any;
  console.log('Status HTTP :', res.status);
  console.log('Réponse     :', JSON.stringify(data, null, 2));

  if (!res.ok) {
    throw new Error(`Initiation échouée: ${data?.message || res.statusText}`);
  }

  const url = data.transaction?.authorization_url ?? data.authorization_url;
  console.log('\n✅ URL de paiement:', url);
  console.log('   Référence      :', REF);
  return REF;
}

// ── 2. Vérifier le statut d'un paiement ──────────────────────────────────────
async function testVerify(ref: string) {
  console.log(`\n🔍 [2] Vérifier le statut de ${ref}...`);
  const res = await fetch(`${BASE}/payments/${ref}`, {
    headers: { 'Authorization': PUBLIC_KEY },
  });

  const data = await res.json() as any;
  console.log('Status HTTP :', res.status);
  const status = data.transaction?.status ?? data.status ?? 'inconnu';
  console.log('Statut paiement :', status);
  return status;
}

// ── 3. Tester un transfert (retrait) ──────────────────────────────────────────
async function testTransfer() {
  console.log('\n💸 [3] Tester un transfert sandbox (retrait chauffeur)...');
  const key = PRIVATE_KEY || PUBLIC_KEY;
  const body = {
    amount:      1000,
    currency:    'XAF',
    reference:   `TRANSFER-${Date.now()}`,
    description: 'Retrait chauffeur test',
    beneficiary: {
      name:    'Chauffeur Test',
      phone:   '+237699000001',
      channel: 'cm.orange',
    },
  };

  const res = await fetch(`${BASE}/transfers`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': key },
    body:    JSON.stringify(body),
  });

  const data = await res.json() as any;
  console.log('Status HTTP :', res.status);
  console.log('Réponse     :', JSON.stringify(data, null, 2));
}

// ── 4. Configurer les clés dans la DB locale ──────────────────────────────────
async function configureInDb() {
  console.log('\n⚙️  [4] Configuration des clés dans la DB...');
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();

  const settings = [
    { key: 'payment_notchpay_public_key',    value: PUBLIC_KEY  },
    { key: 'payment_notchpay_private_key',   value: PRIVATE_KEY },
    { key: 'payment_notchpay_hash_key',      value: HASH_KEY    },
    { key: 'payment_notchpay_enabled',       value: 'true'      },
  ];

  for (const s of settings) {
    await prisma.appSetting.upsert({
      where:  { key: s.key },
      update: { value: s.value },
      create: { key: s.key, value: s.value },
    });
    const display = s.value.length > 20 ? `${s.value.slice(0, 20)}...` : s.value;
    console.log(`  ✓ ${s.key} = ${display}`);
  }

  await prisma.$disconnect();
  console.log('  ✅ Clés enregistrées en DB');
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  if (PUBLIC_KEY.includes('REMPLACE_MOI')) {
    console.error('❌ Remplace la PUBLIC_KEY en haut du fichier avant de lancer le test !');
    process.exit(1);
  }

  console.log('🚀 Test NotchPay Sandbox');
  console.log('='.repeat(50));
  console.log('Public key :', PUBLIC_KEY.slice(0, 25) + '...');

  // Configurer en DB d'abord
  await configureInDb();

  // Tester l'initiation
  const ref = await testInitiate();

  // Vérifier le statut (sera "pending" car pas encore payé)
  await testVerify(ref);

  // Tester un transfert
  await testTransfer();

  console.log('\n' + '='.repeat(50));
  console.log('✅ Tests sandbox terminés !');
  console.log('💡 Ouvre l\'URL de paiement dans ton navigateur pour simuler un paiement.');
}

main().catch(e => {
  console.error('❌ Erreur:', e.message);
  process.exit(1);
});
