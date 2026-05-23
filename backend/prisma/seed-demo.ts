/**
 * Seed de démonstration — idempotent, données réalistes pour tester le workflow.
 * Peut être relancé plusieurs fois sans erreur.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const NSI_LAT = 3.7223;
const NSI_LNG = 11.5533;
const DLA_LAT = 4.0061;
const DLA_LNG = 9.7197;

function nearby(lat: number, lng: number, r = 4) {
  return {
    lat: lat + (Math.random() - 0.5) * 2 * (r / 111),
    lng: lng + (Math.random() - 0.5) * 2 * (r / (111 * Math.cos(lat * Math.PI / 180))),
  };
}
function daysAgo(n: number) { const d = new Date(); d.setDate(d.getDate() - n); return d; }
function hoursFromNow(h: number) { return new Date(Date.now() + h * 3_600_000); }

async function tryCreate(label: string, fn: () => Promise<any>) {
  try { return await fn(); }
  catch (e: any) {
    if (e?.code === 'P2002') { /* contrainte unique — déjà existant, on skip */ }
    else console.warn(`  ⚠️  ${label}: ${e?.message?.split('\n')[0]}`);
    return null;
  }
}

async function main() {
  console.log('🌱 Seeding demo data...');

  // ── 1. Pays ───────────────────────────────────────────────────────────────
  await prisma.country.upsert({
    where: { code: 'CM' },
    update: {},
    create: {
      code: 'CM', name: 'Cameroun', currency: 'XAF',
      paymentMethods: [
        { id: 'orange_money', label: 'Orange Money', icon: 'orange_money' },
        { id: 'mtn_momo',     label: 'MTN MoMo',     icon: 'mtn_momo'     },
        { id: 'card',         label: 'Carte bancaire', icon: 'card'        },
      ],
    },
  });
  await prisma.country.upsert({
    where: { code: 'SN' },
    update: {},
    create: {
      code: 'SN', name: 'Sénégal', currency: 'XOF',
      paymentMethods: [
        { id: 'wave',         label: 'Wave',         icon: 'wave'         },
        { id: 'orange_money', label: 'Orange Money', icon: 'orange_money' },
      ],
    },
  });
  console.log('✅ Countries');

  // ── 2. Chauffeurs ─────────────────────────────────────────────────────────
  const driversData = [
    { phone: '+237670001001', name: 'Paul Mbeki',      brand: 'Toyota',   model: 'Camry',    color: 'Blanc',  plate: 'CE-001-CM', cat: 'standard',     bLat: NSI_LAT, bLng: NSI_LNG },
    { phone: '+237670001002', name: 'Marie Fotso',     brand: 'Mercedes', model: 'E-Class',  color: 'Noir',   plate: 'CE-002-CM', cat: 'confort',      bLat: NSI_LAT, bLng: NSI_LNG },
    { phone: '+237670001003', name: 'Samuel Nganou',   brand: 'Hyundai',  model: 'Tucson',   color: 'Gris',   plate: 'CE-003-CM', cat: 'eco',          bLat: DLA_LAT, bLng: DLA_LNG },
    { phone: '+237670001004', name: 'Aminata Diallo',  brand: 'Kia',      model: 'Sportage', color: 'Bleu',   plate: 'CE-004-CM', cat: 'eco_plus',     bLat: NSI_LAT, bLng: NSI_LNG },
    { phone: '+237670001005', name: 'Rodrigue Biyong', brand: 'BMW',      model: 'Série 5',  color: 'Noir',   plate: 'CE-005-CM', cat: 'confort_plus', bLat: DLA_LAT, bLng: DLA_LNG },
    { phone: '+237670001006', name: 'Cécile Enama',    brand: 'Honda',    model: 'CR-V',     color: 'Argent', plate: 'CE-006-CM', cat: 'standard',     bLat: NSI_LAT, bLng: NSI_LNG },
  ];

  const driverUsers: Array<{ user: any; profile: any }> = [];
  for (const d of driversData) {
    const pos  = nearby(d.bLat, d.bLng, 3);
    const user = await prisma.user.upsert({
      where: { phone: d.phone },
      update: { name: d.name },
      create: { phone: d.phone, name: d.name, role: 'driver', status: 'active', language: 'fr',
                referralCode: `DRV${d.plate.replace(/-/g,'').slice(0,6)}` },
    });
    const profile = await prisma.driverProfile.upsert({
      where: { userId: user.id },
      update: { isAvailable: true, isOnline: true, latitude: pos.lat, longitude: pos.lng,
                locationUpdatedAt: new Date(), status: 'approved' },
      create: {
        userId: user.id, vehicleBrand: d.brand, vehicleModel: d.model,
        vehicleColor: d.color, vehiclePlate: d.plate,
        vehicleYear: 2020 + Math.floor(Math.random() * 4),
        vehicleCategory: d.cat, languages: ['fr','en'], status: 'approved',
        ratingAvg: parseFloat((4.2 + Math.random() * 0.7).toFixed(1)),
        ratingCount: 10 + Math.floor(Math.random() * 90),
        totalRides:  20 + Math.floor(Math.random() * 200),
        isAvailable: true, isOnline: true,
        score: parseFloat((4.5 + Math.random() * 0.4).toFixed(2)),
        latitude: pos.lat, longitude: pos.lng,
        locationUpdatedAt: new Date(), lastActive: new Date(), verifiedAt: daysAgo(30),
      },
    });
    await prisma.wallet.upsert({
      where:  { userId: user.id },
      update: {},
      create: { userId: user.id, balance: 8000 + Math.floor(Math.random() * 40000) },
    });
    await tryCreate(`points ${d.name}`, () => prisma.pointsTransaction.create({
      data: { userId: user.id, type: 'credit', source: 'bonus',
              points: 500 + Math.floor(Math.random() * 1500),
              label: 'Bonus inscription chauffeur', createdAt: daysAgo(30) },
    }));
    driverUsers.push({ user, profile });
  }
  console.log('✅ Drivers (6)');

  // ── 3. Passagers supplémentaires ─────────────────────────────────────────
  const passengersExtra = [
    { phone: '+237655001001', name: 'Alice Kouam',   ref: 'ALICE001' },
    { phone: '+237655001002', name: 'Bruno Tchamba', ref: 'BRUNO002' },
    { phone: '+237655001003', name: 'Diane Essomba', ref: 'DIANE003' },
  ];
  const extraPassengers: any[] = [];
  for (const p of passengersExtra) {
    const user = await prisma.user.upsert({
      where: { phone: p.phone }, update: {},
      create: { phone: p.phone, name: p.name, role: 'passenger', status: 'active',
                language: 'fr', referralCode: p.ref },
    });
    await prisma.wallet.upsert({
      where:  { userId: user.id }, update: {},
      create: { userId: user.id, balance: 3000 + Math.floor(Math.random() * 10000) },
    });
    extraPassengers.push(user);
  }
  const mainPassenger = await prisma.user.findFirst({ where: { phone: '+237698886176' } });
  if (mainPassenger) {
    await prisma.wallet.upsert({
      where: { userId: mainPassenger.id }, update: { balance: 15500 },
      create: { userId: mainPassenger.id, balance: 15500 },
    });
  }
  console.log('✅ Passengers + wallets');

  // ── 4. Promo codes ────────────────────────────────────────────────────────
  await prisma.promoCode.upsert({
    where: { code: 'AEROBETA10' }, update: {},
    create: { code: 'AEROBETA10', discount: 10, maxUses: 100, usedCount: 3,
              expiresAt: hoursFromNow(24 * 60), isActive: true },
  });
  await prisma.promoCode.upsert({
    where: { code: 'BIENVENUE20' }, update: {},
    create: { code: 'BIENVENUE20', discount: 20, maxUses: 50, usedCount: 1,
              expiresAt: hoursFromNow(24 * 30), isActive: true },
  });
  console.log('✅ Promo codes');

  // ── 5. Bookings ───────────────────────────────────────────────────────────
  const destinations = [
    { name: 'Hôtel Hilton Yaoundé',        lat: 3.8617, lng: 11.5163 },
    { name: 'Centre Orca Déco Yaoundé',    lat: 3.8752, lng: 11.5001 },
    { name: 'Quartier Bastos Yaoundé',     lat: 3.8934, lng: 11.5200 },
    { name: 'Université de Yaoundé I',     lat: 3.8676, lng: 11.5059 },
    { name: 'Hôtel Akwa Palace Douala',    lat: 4.0489, lng: 9.6977  },
    { name: 'Rond-Point Deïdo Douala',     lat: 4.0611, lng: 9.7221  },
  ];
  const vtypes  = ['eco','standard','confort'];
  const pmethods = ['orange_money','mtn_momo','wallet'];
  let bookingCount = 0;

  // Helper — crée une course complétée uniquement si le passager a < maxCompleted courses complétées
  async function createCompletedBooking(passengerId: string, i: number, maxCompleted: number) {
    const existing = await prisma.booking.count({ where: { passengerId, status: 'completed' } });
    if (existing >= maxCompleted) return null;
    const driver = driverUsers[i % driverUsers.length];
    const dest   = destinations[i % destinations.length];
    const dBack  = 2 + i * 3;
    const price  = 3500 + Math.floor(Math.random() * 10000);
    const bk = await tryCreate(`booking completed #${i}`, () => prisma.booking.create({
      data: {
        passengerId, driverProfileId: driver.profile.id,
        flightNumber: `KQ${100 + i}`,
        departureAirport: i % 2 === 0 ? 'NSI' : 'DLA',
        destination: dest.name, destLat: dest.lat, destLng: dest.lng,
        vehicleType: vtypes[i % vtypes.length],
        paymentMethod: pmethods[i % pmethods.length],
        estimatedPrice: price, status: 'completed', type: 'ARRIVAL',
        completedAt: daysAgo(dBack), createdAt: daysAgo(dBack), updatedAt: daysAgo(dBack),
        driverEtaMinutes: 5 + Math.floor(Math.random() * 15),
      },
    }));
    if (bk) {
      bookingCount++;
      // Points fidélité
      await tryCreate('points loyalty', () => prisma.pointsTransaction.create({
        data: { userId: passengerId, type: 'credit', source: 'loyalty',
                points: Math.floor(price / 100),
                label: `Fidélité — ${dest.name.slice(0,40)}`, createdAt: daysAgo(dBack) },
      }));
      // Transaction wallet si payé par wallet
      if (pmethods[i % pmethods.length] === 'wallet') {
        const w = await prisma.wallet.findUnique({ where: { userId: passengerId } });
        if (w) await tryCreate('tx wallet payment', () => prisma.transaction.create({
          data: { walletId: w.id, amount: price, type: 'payment', status: 'completed',
                  reference: `BOOKING-${bk.id.slice(0,12)}`,
                  metadata: { bookingId: bk.id }, createdAt: daysAgo(dBack) },
        }));
      }
    }
    return bk;
  }

  // 4 courses complétées pour le passager principal
  if (mainPassenger) {
    for (let i = 0; i < 4; i++) await createCompletedBooking(mainPassenger.id, i, 4);
  }

  // 2 courses complétées pour chaque passager extra
  for (let i = 0; i < extraPassengers.length; i++) {
    for (let j = 0; j < 2; j++) await createCompletedBooking(extraPassengers[i].id, i + j + 3, 2);
  }

  // 1 booking in_progress pour le passager principal (si aucun actif)
  if (mainPassenger) {
    const activeMain = await prisma.booking.findFirst({
      where: { passengerId: mainPassenger.id,
                status: { in: ['pending','confirmed','in_progress','arrived_at_airport'] } },
    });
    if (!activeMain) {
      const driver = driverUsers[0];
      const pickup = nearby(NSI_LAT, NSI_LNG, 2);
      await tryCreate('in_progress booking', () => prisma.booking.create({
        data: {
          passengerId: mainPassenger.id, driverProfileId: driver.profile.id,
          departureAirport: 'NSI',
          destination: 'Aéroport International Nsimalen',
          destLat: NSI_LAT, destLng: NSI_LNG,
          pickupAddress: 'Quartier Bastos, Yaoundé',
          pickupLat: pickup.lat, pickupLng: pickup.lng,
          vehicleType: 'standard', paymentMethod: 'wallet',
          estimatedPrice: 4500, status: 'in_progress', type: 'DEPARTURE',
          driverEtaMinutes: 8,
          createdAt: new Date(Date.now() - 20 * 60_000), updatedAt: new Date(),
        },
      }));
      bookingCount++;
    }
  }

  // 1 booking pending pour un passager extra sans course active
  for (const pass of extraPassengers) {
    const active = await prisma.booking.findFirst({
      where: { passengerId: pass.id,
                status: { in: ['pending','confirmed','in_progress','arrived_at_airport'] } },
    });
    if (!active) {
      const dest = destinations[1];
      await tryCreate('pending booking', () => prisma.booking.create({
        data: {
          passengerId: pass.id, flightNumber: 'ET302',
          departureAirport: 'NSI', destination: dest.name,
          destLat: dest.lat, destLng: dest.lng,
          vehicleType: 'confort', paymentMethod: 'wallet',
          estimatedPrice: 7500, status: 'pending', type: 'ARRIVAL',
          driverEtaMinutes: 10, createdAt: new Date(), updatedAt: new Date(),
        },
      }));
      bookingCount++;
      break;
    }
  }

  console.log(`✅ Bookings (${bookingCount} nouveaux)`);

  // ── 6. Recharges wallet passager principal ────────────────────────────────
  if (mainPassenger) {
    const w = await prisma.wallet.findUnique({ where: { userId: mainPassenger.id } });
    if (w) {
      for (const r of [
        { pts: 5000,  back: 10, ref: 'WALLET-MOCK-SEED001' },
        { pts: 10000, back: 5,  ref: 'WALLET-MOCK-SEED002' },
      ]) {
        const exists = await prisma.transaction.findUnique({ where: { reference: r.ref } });
        if (!exists) {
          await prisma.transaction.create({
            data: { walletId: w.id, amount: r.pts, type: 'deposit', status: 'completed',
                    reference: r.ref, metadata: { points: r.pts, provider: 'mock' },
                    createdAt: daysAgo(r.back) },
          });
          await prisma.pointsTransaction.create({
            data: { userId: mainPassenger.id, type: 'credit', source: 'recharge',
                    points: r.pts, label: `Recharge — ${r.pts} pts`, createdAt: daysAgo(r.back) },
          });
        }
      }
    }
  }
  console.log('✅ Wallet recharges');

  // ── 7. Résumé ─────────────────────────────────────────────────────────────
  const [users, drivers, bookings, wallets, txs, ptxs, countries, promos] = await Promise.all([
    prisma.user.count(),
    prisma.driverProfile.count(),
    prisma.booking.count(),
    prisma.wallet.count(),
    prisma.transaction.count(),
    prisma.pointsTransaction.count(),
    prisma.country.count(),
    prisma.promoCode.count(),
  ]);

  console.log('\n📊 État final:');
  console.log(`   Users           : ${users}`);
  console.log(`   Drivers         : ${drivers}`);
  console.log(`   Bookings        : ${bookings}`);
  console.log(`   Wallets         : ${wallets}`);
  console.log(`   Transactions    : ${txs}`);
  console.log(`   Points TX       : ${ptxs}`);
  console.log(`   Countries       : ${countries}`);
  console.log(`   Promo codes     : ${promos}`);
  console.log('\n🎉 Seed démo terminé !');
}

main()
  .catch((e) => { console.error('❌', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
