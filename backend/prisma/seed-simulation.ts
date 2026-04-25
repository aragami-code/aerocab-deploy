/**
 * seed-simulation.ts — Données de test pour les 50 cas de simulation D1→D5
 *
 * Commande : npx ts-node prisma/seed-simulation.ts
 *
 * STRUCTURE DES IDs (préfixes fixes pour idempotence) :
 *  a0...01-08  → passengers (users)
 *  b0...01-04  → drivers (users)
 *  c0...01-04  → driver profiles
 *  d0...01     → admin
 *  e0...01-30  → bookings
 *  f0...01-08  → flights
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ── UUIDs fixes ────────────────────────────────────────────────────────────────
const ID = {
  // Passengers
  P1: 'a0000000-0000-0000-0000-000000000001', // wallet 5000 pts
  P2: 'a0000000-0000-0000-0000-000000000002', // PAS de wallet (1er booking)
  P3: 'a0000000-0000-0000-0000-000000000003', // wallet 3000 pts
  P4: 'a0000000-0000-0000-0000-000000000004', // paiement cash uniquement
  P5: 'a0000000-0000-0000-0000-000000000005', // wallet 800 pts (race condition D5)
  P6: 'a0000000-0000-0000-0000-000000000006', // wallet 0 pt (solde insuffisant)
  P7: 'a0000000-0000-0000-0000-000000000007', // RGPD — vieux bookings

  // Drivers (users)
  DU1: 'b0000000-0000-0000-0000-000000000001', // driver principal, disponible
  DU2: 'b0000000-0000-0000-0000-000000000002', // driver remplaçant
  DU3: 'b0000000-0000-0000-0000-000000000003', // driver hors ligne (pas de remplacement)
  DU4: 'b0000000-0000-0000-0000-000000000004', // driver avec wallet

  // Driver profiles
  DP1: 'c0000000-0000-0000-0000-000000000001',
  DP2: 'c0000000-0000-0000-0000-000000000002',
  DP3: 'c0000000-0000-0000-0000-000000000003', // offline
  DP4: 'c0000000-0000-0000-0000-000000000004',

  // Admin
  ADMIN: 'd0000000-0000-0000-0000-000000000001',

  // Bookings
  // D1 — Vol annulé
  B_S01: 'e0000000-0000-0000-0000-000000000001', // confirmed, wallet, vol annulé
  B_S02: 'e0000000-0000-0000-0000-000000000002', // confirmed, wallet SANS wallet row
  B_S03: 'e0000000-0000-0000-0000-000000000003', // in_progress, vol annulé
  B_S04: 'e0000000-0000-0000-0000-000000000004', // arrived_at_airport, compensation driver
  B_S05: 'e0000000-0000-0000-0000-000000000005', // cash, pas de remboursement points
  B_S07: 'e0000000-0000-0000-0000-000000000007', // pending sans driver assigné
  B_S09: 'e0000000-0000-0000-0000-000000000009', // déjà cancelled avant vol annulé

  // D2 — Panne chauffeur
  B_S11: 'e0000000-0000-0000-0000-000000000011', // confirmed, remplacement dispo
  B_S12: 'e0000000-0000-0000-0000-000000000012', // arrived_at_airport, aucun remplaçant
  B_S13: 'e0000000-0000-0000-0000-000000000013', // in_progress, panne en route
  B_S15: 'e0000000-0000-0000-0000-000000000015', // DEPARTURE, panne
  B_S18: 'e0000000-0000-0000-0000-000000000018', // mauvais driver tente panne
  B_S19: 'e0000000-0000-0000-0000-000000000019', // cash, pas de points à rembourser

  // D4 — RGPD
  B_S32: 'e0000000-0000-0000-0000-000000000032', // completed > 12 mois avec GPS
  B_S33: 'e0000000-0000-0000-0000-000000000033', // completed > 12 mois avec adresse texte
  B_S34: 'e0000000-0000-0000-0000-000000000034', // pending > 12 mois (NON anonymisé)

  // D5 — Fraude / Solde
  B_S36A: 'e0000000-0000-0000-0000-000000000036', // 1er booking concurrent (800 pts)
  B_S37:  'e0000000-0000-0000-0000-000000000037', // pending → annulation → remboursement
  B_S38:  'e0000000-0000-0000-0000-000000000038', // pending → expiration → remboursement
  B_S44:  'e0000000-0000-0000-0000-000000000044', // no_driver_available → remboursement
  B_S47:  'e0000000-0000-0000-0000-000000000047', // cash → aucune vérification wallet
  B_S49:  'e0000000-0000-0000-0000-000000000049', // promo 20%, débit sur prix réduit
  B_S50:  'e0000000-0000-0000-0000-000000000050', // course normale complète

  // Flights
  F_S01: 'f0000000-0000-0000-0000-000000000001', // AF6501 — annulé (S01)
  F_S02: 'f0000000-0000-0000-0000-000000000002', // AF6502 — annulé (S02, pas de wallet)
  F_S03: 'f0000000-0000-0000-0000-000000000003', // AF6503 — annulé (S03, in_progress)
  F_S04: 'f0000000-0000-0000-0000-000000000004', // AF6504 — annulé (S04, driver at airport)
  F_S05: 'f0000000-0000-0000-0000-000000000005', // AF6505 — annulé (S05, cash)
  F_S06: 'f0000000-0000-0000-0000-000000000006', // AF6506 — sentinel déjà posé (S06)
  F_S07: 'f0000000-0000-0000-0000-000000000007', // AF6507 — annulé (S07, no driver)
  F_S08: 'f0000000-0000-0000-0000-000000000008', // AF6508 — annulé (S08, 2 bookings)
} as const;

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Date dans le passé lointain (> 12 mois) pour tests RGPD */
function oldDate(monthsAgo: number): Date {
  const d = new Date();
  d.setMonth(d.getMonth() - monthsAgo);
  return d;
}

/** Scheduled arrival dans les 6 heures (fenêtre de sync FR24) */
function soonDate(hoursFromNow = 3): Date {
  return new Date(Date.now() + hoursFromNow * 60 * 60 * 1000);
}

// ── SEED PRINCIPAL ─────────────────────────────────────────────────────────────

async function main() {
  console.log('🌱 Début seed simulation D1→D5...\n');

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. UTILISATEURS
  // ═══════════════════════════════════════════════════════════════════════════

  console.log('👤 Création des utilisateurs...');

  // Passengers
  await prisma.user.upsert({
    where: { phone: '+237600000001' },
    update: {},
    create: {
      id: ID.P1,
      phone: '+237600000001',
      name: 'Amadou Ndiaye',
      role: 'passenger',
      status: 'active',
      language: 'fr',
      fcmToken: 'sim-fcm-p1',
    },
  });

  await prisma.user.upsert({
    where: { phone: '+237600000002' },
    update: {},
    create: {
      id: ID.P2,
      phone: '+237600000002',
      name: 'Fatou Diallo',       // S02 — pas de wallet
      role: 'passenger',
      status: 'active',
      language: 'fr',
    },
  });

  await prisma.user.upsert({
    where: { phone: '+237600000003' },
    update: {},
    create: {
      id: ID.P3,
      phone: '+237600000003',
      name: 'Kofi Mensah',
      role: 'passenger',
      status: 'active',
      language: 'fr',
      fcmToken: 'sim-fcm-p3',
    },
  });

  await prisma.user.upsert({
    where: { phone: '+237600000004' },
    update: {},
    create: {
      id: ID.P4,
      phone: '+237600000004',
      name: 'Marie Atangana',     // paiement cash
      role: 'passenger',
      status: 'active',
      language: 'fr',
    },
  });

  await prisma.user.upsert({
    where: { phone: '+237600000005' },
    update: {},
    create: {
      id: ID.P5,
      phone: '+237600000005',
      name: 'Jean Fofana',        // S36 — race condition 800 pts
      role: 'passenger',
      status: 'active',
      language: 'fr',
      fcmToken: 'sim-fcm-p5',
    },
  });

  await prisma.user.upsert({
    where: { phone: '+237600000006' },
    update: {},
    create: {
      id: ID.P6,
      phone: '+237600000006',
      name: 'Aissatou Barry',     // S41/42 — fraude répétée
      role: 'passenger',
      status: 'active',
      language: 'fr',
    },
  });

  await prisma.user.upsert({
    where: { phone: '+237600000007' },
    update: {},
    create: {
      id: ID.P7,
      phone: '+237600000007',
      name: 'Paul Essomba',       // D4 — vieux bookings RGPD
      role: 'passenger',
      status: 'active',
      language: 'fr',
    },
  });

  // Drivers
  await prisma.user.upsert({
    where: { phone: '+237611000001' },
    update: {},
    create: {
      id: ID.DU1,
      phone: '+237611000001',
      name: 'Ibrahim Coulibaly',  // driver principal
      role: 'driver',
      status: 'active',
      language: 'fr',
      fcmToken: 'sim-fcm-d1',
    },
  });

  await prisma.user.upsert({
    where: { phone: '+237611000002' },
    update: {},
    create: {
      id: ID.DU2,
      phone: '+237611000002',
      name: 'Oumar Traoré',       // driver remplaçant (D2)
      role: 'driver',
      status: 'active',
      language: 'fr',
      fcmToken: 'sim-fcm-d2',
    },
  });

  await prisma.user.upsert({
    where: { phone: '+237611000003' },
    update: {},
    create: {
      id: ID.DU3,
      phone: '+237611000003',
      name: 'Sékou Camara',       // driver hors ligne
      role: 'driver',
      status: 'active',
      language: 'fr',
    },
  });

  await prisma.user.upsert({
    where: { phone: '+237611000004' },
    update: {},
    create: {
      id: ID.DU4,
      phone: '+237611000004',
      name: 'Moussa Keita',
      role: 'driver',
      status: 'active',
      language: 'fr',
      fcmToken: 'sim-fcm-d4',
    },
  });

  // Admin
  await prisma.user.upsert({
    where: { phone: '+237699000001' },
    update: {},
    create: {
      id: ID.ADMIN,
      phone: '+237699000001',
      name: 'Admin AeroGo',
      role: 'admin',
      status: 'active',
      language: 'fr',
      fcmToken: 'sim-fcm-admin',  // S16 — recevoir alerte panne
    },
  });

  console.log('   ✅ 12 utilisateurs créés\n');

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. DRIVER PROFILES
  // ═══════════════════════════════════════════════════════════════════════════

  console.log('🚗 Création des profils chauffeurs...');

  await prisma.driverProfile.upsert({
    where: { userId: ID.DU1 },
    update: { isAvailable: true, isOnline: true },
    create: {
      id: ID.DP1,
      userId: ID.DU1,
      vehicleBrand: 'Toyota',
      vehicleModel: 'Camry',
      vehicleColor: 'Blanc',
      vehiclePlate: 'DLA-1001-A',
      vehicleYear: 2021,
      vehicleCategory: 'confort',
      status: 'approved',
      ratingAvg: 4.8,
      ratingCount: 142,
      totalRides: 142,
      isAvailable: true,
      isOnline: true,
      score: 4.8,
      latitude: 4.0450,   // près aéroport Douala
      longitude: 9.7082,
    },
  });

  // S11 — Driver remplaçant disponible
  await prisma.driverProfile.upsert({
    where: { userId: ID.DU2 },
    update: { isAvailable: true, isOnline: true },
    create: {
      id: ID.DP2,
      userId: ID.DU2,
      vehicleBrand: 'Hyundai',
      vehicleModel: 'Elantra',
      vehicleColor: 'Gris',
      vehiclePlate: 'DLA-2002-B',
      vehicleYear: 2020,
      vehicleCategory: 'standard',
      status: 'approved',
      ratingAvg: 4.6,
      ratingCount: 89,
      totalRides: 89,
      isAvailable: true,
      isOnline: true,
      score: 4.6,
      latitude: 4.0500,
      longitude: 9.7100,
    },
  });

  // S12 — Driver hors ligne (ne peut pas remplacer)
  await prisma.driverProfile.upsert({
    where: { userId: ID.DU3 },
    update: { isAvailable: false, isOnline: false },
    create: {
      id: ID.DP3,
      userId: ID.DU3,
      vehicleBrand: 'Kia',
      vehicleModel: 'Rio',
      vehicleColor: 'Noir',
      vehiclePlate: 'DLA-3003-C',
      vehicleYear: 2019,
      vehicleCategory: 'eco',
      status: 'approved',
      ratingAvg: 4.2,
      ratingCount: 45,
      totalRides: 45,
      isAvailable: false,   // offline → pas de remplacement possible
      isOnline: false,
      score: 4.2,
    },
  });

  await prisma.driverProfile.upsert({
    where: { userId: ID.DU4 },
    update: { isAvailable: true, isOnline: true },
    create: {
      id: ID.DP4,
      userId: ID.DU4,
      vehicleBrand: 'Renault',
      vehicleModel: 'Logan',
      vehicleColor: 'Bleu',
      vehiclePlate: 'DLA-4004-D',
      vehicleYear: 2022,
      vehicleCategory: 'eco_plus',
      status: 'approved',
      ratingAvg: 4.5,
      ratingCount: 67,
      totalRides: 67,
      isAvailable: true,
      isOnline: true,
      score: 4.5,
      latitude: 4.0420,
      longitude: 9.7060,
    },
  });

  console.log('   ✅ 4 profils chauffeurs créés\n');

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. WALLETS & POINTS
  // ═══════════════════════════════════════════════════════════════════════════

  console.log('💰 Création des wallets et transactions...');

  // P1 — 5000 pts (S01, S04, S08, S38, S50)
  await prisma.wallet.upsert({
    where: { userId: ID.P1 },
    update: { balance: 5000 },
    create: { userId: ID.P1, balance: 5000, currency: 'XAF' },
  });
  await prisma.pointsTransaction.create({
    data: {
      userId: ID.P1,
      type: 'credit',
      points: 5000,
      label: '[SIM] Crédit initial passager P1',
    },
  });

  // P2 — PAS de wallet (S02 — bug détecté : wallet non créé au remboursement)
  // → Ne pas créer de wallet pour P2 intentionnellement

  // P3 — 3000 pts (S03, S12, S37)
  await prisma.wallet.upsert({
    where: { userId: ID.P3 },
    update: { balance: 3000 },
    create: { userId: ID.P3, balance: 3000, currency: 'XAF' },
  });
  await prisma.pointsTransaction.create({
    data: {
      userId: ID.P3,
      type: 'credit',
      points: 3000,
      label: '[SIM] Crédit initial passager P3',
    },
  });

  // P4 — cash, pas de wallet (S05, S19)
  // → Pas de wallet intentionnellement

  // P5 — 800 pts exactement (S36 race condition : 2 bookings à 800 pts simultanés)
  await prisma.wallet.upsert({
    where: { userId: ID.P5 },
    update: { balance: 800 },
    create: { userId: ID.P5, balance: 800, currency: 'XAF' },
  });
  await prisma.pointsTransaction.create({
    data: {
      userId: ID.P5,
      type: 'credit',
      points: 800,
      label: '[SIM] Crédit initial passager P5 (test race condition)',
    },
  });

  // P6 — 0 pts (S40, S41 — fraude solde insuffisant répété)
  await prisma.wallet.upsert({
    where: { userId: ID.P6 },
    update: { balance: 0 },
    create: { userId: ID.P6, balance: 0, currency: 'XAF' },
  });

  // P7 — 2000 pts (RGPD)
  await prisma.wallet.upsert({
    where: { userId: ID.P7 },
    update: { balance: 2000 },
    create: { userId: ID.P7, balance: 2000, currency: 'XAF' },
  });

  // Driver D1 — wallet pour compensation panne (S04, S12)
  await prisma.wallet.upsert({
    where: { userId: ID.DU1 },
    update: { balance: 1200 },
    create: { userId: ID.DU1, balance: 1200, currency: 'XAF' },
  });

  console.log('   ✅ Wallets et transactions créés\n');

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. FLIGHTS (pour D1)
  // ═══════════════════════════════════════════════════════════════════════════

  console.log('✈️  Création des vols...');

  // S01 — AF6501 : vol actif, sera annulé → P1 avec wallet
  await prisma.flight.upsert({
    where: { id: ID.F_S01 },
    update: {},
    create: {
      id: ID.F_S01,
      userId: ID.P1,
      flightNumber: 'AF6501',
      airline: 'Air France',
      origin: 'CDG',
      arrivalAirport: 'DLA',
      scheduledArrival: soonDate(2),
      actualArrival: null,
      source: 'api',
    },
  });

  // S02 — AF6502 : vol annulé → P2 SANS wallet (teste le upsert fix)
  await prisma.flight.upsert({
    where: { id: ID.F_S02 },
    update: {},
    create: {
      id: ID.F_S02,
      userId: ID.P2,
      flightNumber: 'AF6502',
      airline: 'Air France',
      origin: 'CDG',
      arrivalAirport: 'DLA',
      scheduledArrival: soonDate(2),
      actualArrival: null,
      source: 'api',
    },
  });

  // S03 — AF6503 : vol annulé → booking in_progress (teste l'ajout du statut)
  await prisma.flight.upsert({
    where: { id: ID.F_S03 },
    update: {},
    create: {
      id: ID.F_S03,
      userId: ID.P3,
      flightNumber: 'AF6503',
      airline: 'Kenya Airways',
      origin: 'NBO',
      arrivalAirport: 'DLA',
      scheduledArrival: soonDate(1),
      actualArrival: null,
      source: 'api',
    },
  });

  // S04 — AF6504 : chauffeur déjà à l'aéroport → compensation 50%
  await prisma.flight.upsert({
    where: { id: ID.F_S04 },
    update: {},
    create: {
      id: ID.F_S04,
      userId: ID.P1,
      flightNumber: 'AF6504',
      airline: 'Ethiopian Airlines',
      origin: 'ADD',
      arrivalAirport: 'NSI',
      scheduledArrival: soonDate(1),
      actualArrival: null,
      source: 'api',
    },
  });

  // S05 — AF6505 : paiement cash → pas de remboursement points
  await prisma.flight.upsert({
    where: { id: ID.F_S05 },
    update: {},
    create: {
      id: ID.F_S05,
      userId: ID.P4,
      flightNumber: 'AF6505',
      airline: 'Cameroon Airlines',
      origin: 'LOS',
      arrivalAirport: 'DLA',
      scheduledArrival: soonDate(3),
      actualArrival: null,
      source: 'api',
    },
  });

  // S06 — AF6506 : sentinel déjà posé → ne doit pas être retraité
  await prisma.flight.upsert({
    where: { id: ID.F_S06 },
    update: {},
    create: {
      id: ID.F_S06,
      userId: ID.P1,
      flightNumber: 'AF6506',
      airline: 'Air France',
      origin: 'CDG',
      arrivalAirport: 'DLA',
      scheduledArrival: oldDate(1),
      actualArrival: new Date('2000-01-01T00:00:00Z'), // sentinel posé
      source: 'api',
    },
  });

  // S07 — AF6507 : booking pending sans driver
  await prisma.flight.upsert({
    where: { id: ID.F_S07 },
    update: {},
    create: {
      id: ID.F_S07,
      userId: ID.P5,
      flightNumber: 'AF6507',
      airline: 'Royal Air Maroc',
      origin: 'CMN',
      arrivalAirport: 'NSI',
      scheduledArrival: soonDate(4),
      actualArrival: null,
      source: 'api',
    },
  });

  // S08 — AF6508 : 2 bookings sur le même vol
  await prisma.flight.upsert({
    where: { id: ID.F_S08 },
    update: {},
    create: {
      id: ID.F_S08,
      userId: ID.P3,
      flightNumber: 'AF6508',
      airline: 'Brussels Airlines',
      origin: 'BRU',
      arrivalAirport: 'DLA',
      scheduledArrival: soonDate(2),
      actualArrival: null,
      source: 'api',
    },
  });

  console.log('   ✅ 8 vols créés\n');

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. BOOKINGS
  // ═══════════════════════════════════════════════════════════════════════════

  console.log('📋 Création des réservations...');

  // ── D1 — Vol annulé ──────────────────────────────────────────────────────

  // S01 — confirmed + wallet P1 (5000 pts) — remboursement 3000 pts attendu
  await prisma.booking.upsert({
    where: { id: ID.B_S01 },
    update: {},
    create: {
      id: ID.B_S01,
      passengerId: ID.P1,
      driverProfileId: ID.DP1,
      flightNumber: 'AF6501',
      departureAirport: 'DLA',
      destination: 'Hôtel Akwa Palace, Douala',
      destLat: 4.0500,
      destLng: 9.7200,
      vehicleType: 'confort',
      paymentMethod: 'wallet',
      estimatedPrice: 3000,
      status: 'confirmed',
      type: 'ARRIVAL',
      pickupAddress: 'Aéroport International de Douala',
      pickupLat: 4.0061,
      pickupLng: 9.7197,
    } as any,
  });

  // S02 — confirmed + wallet P2 SANS wallet row — teste wallet.upsert au remboursement
  await prisma.booking.upsert({
    where: { id: ID.B_S02 },
    update: {},
    create: {
      id: ID.B_S02,
      passengerId: ID.P2,
      driverProfileId: ID.DP1,
      flightNumber: 'AF6502',
      departureAirport: 'DLA',
      destination: 'Résidence Les Cocotiers, Douala',
      vehicleType: 'standard',
      paymentMethod: 'wallet',
      estimatedPrice: 2500,
      status: 'confirmed',
      type: 'ARRIVAL',
      pickupAddress: 'Aéroport International de Douala',
    } as any,
  });

  // S03 — in_progress (passager déjà dans la voiture), vol annulé en vol
  await prisma.booking.upsert({
    where: { id: ID.B_S03 },
    update: {},
    create: {
      id: ID.B_S03,
      passengerId: ID.P3,
      driverProfileId: ID.DP2,
      flightNumber: 'AF6503',
      departureAirport: 'DLA',
      destination: 'Hôtel Djeuga Palace, Yaoundé',
      vehicleType: 'standard',
      paymentMethod: 'wallet',
      estimatedPrice: 4000,
      status: 'in_progress',   // ← ajouté dans le fix S03
      type: 'ARRIVAL',
      pickupAddress: 'Aéroport International de Douala',
      pickupLat: 4.0061,
      pickupLng: 9.7197,
    } as any,
  });

  // S04 — arrived_at_airport → compensation 50% chauffeur
  await prisma.booking.upsert({
    where: { id: ID.B_S04 },
    update: {},
    create: {
      id: ID.B_S04,
      passengerId: ID.P1,
      driverProfileId: ID.DP1,
      flightNumber: 'AF6504',
      departureAirport: 'NSI',
      destination: 'Hôtel Mont Fébé, Yaoundé',
      vehicleType: 'confort',
      paymentMethod: 'wallet',
      estimatedPrice: 5000,
      status: 'arrived_at_airport',
      type: 'ARRIVAL',
      pickupAddress: 'Aéroport de Yaoundé-Nsimalen',
    } as any,
  });

  // S05 — paiement cash → annulation vol, aucun remboursement points
  await prisma.booking.upsert({
    where: { id: ID.B_S05 },
    update: {},
    create: {
      id: ID.B_S05,
      passengerId: ID.P4,
      driverProfileId: ID.DP2,
      flightNumber: 'AF6505',
      departureAirport: 'DLA',
      destination: 'Quartier Bonanjo, Douala',
      vehicleType: 'eco',
      paymentMethod: 'cash',
      estimatedPrice: 6000,
      status: 'confirmed',
      type: 'ARRIVAL',
    } as any,
  });

  // S07 — pending sans driver → annulation propre sans libération driver
  await prisma.booking.upsert({
    where: { id: ID.B_S07 },
    update: {},
    create: {
      id: ID.B_S07,
      passengerId: ID.P5,
      driverProfileId: null,
      flightNumber: 'AF6507',
      departureAirport: 'NSI',
      destination: 'Avenue Kennedy, Yaoundé',
      vehicleType: 'eco_plus',
      paymentMethod: 'wallet',
      estimatedPrice: 2000,
      status: 'pending',
      type: 'ARRIVAL',
    } as any,
  });

  // S08a — 1er booking AF6508, P3 (2 bookings sur même vol)
  await prisma.booking.upsert({
    where: { id: 'e0000000-0000-0000-0000-000000000008' },
    update: {},
    create: {
      id: 'e0000000-0000-0000-0000-000000000008',
      passengerId: ID.P3,
      driverProfileId: ID.DP1,
      flightNumber: 'AF6508',
      departureAirport: 'DLA',
      destination: 'Hôtel Ibis, Douala',
      vehicleType: 'eco',
      paymentMethod: 'wallet',
      estimatedPrice: 1800,
      status: 'pending',
      type: 'ARRIVAL',
    } as any,
  });
  // S08b — 2ème booking AF6508 même passager (état différent)
  await prisma.booking.upsert({
    where: { id: 'e0000000-0000-0000-0000-000000000008' },
    update: {},
    create: {
      id: 'e0000000-0000-0000-0000-000000000008',
      passengerId: ID.P3,
      driverProfileId: ID.DP2,
      flightNumber: 'AF6508',
      departureAirport: 'DLA',
      destination: 'Appartement Bastos, Yaoundé',
      vehicleType: 'eco_plus',
      paymentMethod: 'wallet',
      estimatedPrice: 2200,
      status: 'confirmed',
      type: 'ARRIVAL',
    } as any,
  });

  // S09 — déjà cancelled → ne doit pas être retraité
  await prisma.booking.upsert({
    where: { id: ID.B_S09 },
    update: {},
    create: {
      id: ID.B_S09,
      passengerId: ID.P1,
      driverProfileId: null,
      flightNumber: 'AF6501',
      departureAirport: 'DLA',
      destination: 'Résidence Ancien booking',
      vehicleType: 'standard',
      paymentMethod: 'wallet',
      estimatedPrice: 2800,
      status: 'cancelled',
      cancelledAt: oldDate(0),
      type: 'ARRIVAL',
    } as any,
  });

  // ── D2 — Panne chauffeur ─────────────────────────────────────────────────

  // S11 — confirmed, driver DP1, remplaçant DP2 disponible
  await prisma.booking.upsert({
    where: { id: ID.B_S11 },
    update: {},
    create: {
      id: ID.B_S11,
      passengerId: ID.P1,
      driverProfileId: ID.DP1,
      flightNumber: null,
      departureAirport: 'DLA',
      destination: 'Hôtel Sawa, Douala',
      vehicleType: 'confort',
      paymentMethod: 'wallet',
      estimatedPrice: 3500,
      status: 'confirmed',
      type: 'ARRIVAL',
      pickupAddress: 'Aéroport International de Douala',
      pickupLat: 4.0061,
      pickupLng: 9.7197,
    } as any,
  });

  // S12 — arrived_at_airport, tous les drivers offline → annulation + remboursement
  await prisma.booking.upsert({
    where: { id: ID.B_S12 },
    update: {},
    create: {
      id: ID.B_S12,
      passengerId: ID.P3,
      driverProfileId: ID.DP3,  // driver hors ligne
      flightNumber: null,
      departureAirport: 'NSI',
      destination: 'Centre-ville Yaoundé',
      vehicleType: 'standard',
      paymentMethod: 'wallet',
      estimatedPrice: 4000,
      status: 'arrived_at_airport',
      type: 'ARRIVAL',
      pickupAddress: 'Aéroport de Yaoundé-Nsimalen',
    } as any,
  });

  // S13 — in_progress, panne pendant le trajet (bouton "Panne" ajouté dans le fix)
  await prisma.booking.upsert({
    where: { id: ID.B_S13 },
    update: {},
    create: {
      id: ID.B_S13,
      passengerId: ID.P3,
      driverProfileId: ID.DP1,
      flightNumber: null,
      departureAirport: 'DLA',
      destination: 'Quartier Makepe, Douala',
      vehicleType: 'confort',
      paymentMethod: 'wallet',
      estimatedPrice: 5000,
      status: 'in_progress',
      type: 'ARRIVAL',
      pickupAddress: 'Aéroport International de Douala',
    } as any,
  });

  // S15 — DEPARTURE, panne avant prise en charge
  await prisma.booking.upsert({
    where: { id: ID.B_S15 },
    update: {},
    create: {
      id: ID.B_S15,
      passengerId: ID.P1,
      driverProfileId: ID.DP1,
      flightNumber: 'AF6501',
      departureAirport: 'DLA',
      destination: 'Aéroport International de Douala',
      vehicleType: 'confort',
      paymentMethod: 'wallet',
      estimatedPrice: 3000,
      status: 'confirmed',
      type: 'DEPARTURE',
      pickupAddress: 'Avenue de Gaulle 12, Douala',
      pickupLat: 4.0600,
      pickupLng: 9.7300,
    } as any,
  });

  // S18 — mauvais driver (DP4) tente de signaler panne sur booking de DP1
  await prisma.booking.upsert({
    where: { id: ID.B_S18 },
    update: {},
    create: {
      id: ID.B_S18,
      passengerId: ID.P1,
      driverProfileId: ID.DP1,  // appartient à DP1, DP4 sera rejeté
      flightNumber: null,
      departureAirport: 'DLA',
      destination: 'Appartement Bonanjo, Douala',
      vehicleType: 'standard',
      paymentMethod: 'wallet',
      estimatedPrice: 2500,
      status: 'confirmed',
      type: 'ARRIVAL',
    } as any,
  });

  // S19 — cash, panne, aucun remplaçant → annulation sans remboursement points
  await prisma.booking.upsert({
    where: { id: ID.B_S19 },
    update: {},
    create: {
      id: ID.B_S19,
      passengerId: ID.P4,
      driverProfileId: ID.DP3,
      flightNumber: null,
      departureAirport: 'DLA',
      destination: 'Hôtel La Falaise, Douala',
      vehicleType: 'eco',
      paymentMethod: 'cash',
      estimatedPrice: 3000,
      status: 'confirmed',
      type: 'ARRIVAL',
    } as any,
  });

  // ── D4 — RGPD (vieux bookings > 12 mois) ────────────────────────────────

  // S32 — completed > 12 mois avec coordonnées GPS → doivent être nullifiées
  await prisma.booking.upsert({
    where: { id: ID.B_S32 },
    update: {},
    create: {
      id: ID.B_S32,
      passengerId: ID.P7,
      driverProfileId: null,
      flightNumber: 'AF5000',
      departureAirport: 'DLA',
      destination: 'Bastos, Yaoundé',
      destLat: 3.8800,
      destLng: 11.5200,
      pickupAddress: 'Aéroport International de Douala',
      pickupLat: 4.0061,
      pickupLng: 9.7197,
      vehicleType: 'eco',
      paymentMethod: 'wallet',
      estimatedPrice: 4500,
      status: 'completed',
      completedAt: oldDate(14),
      createdAt: oldDate(14),
      type: 'ARRIVAL',
    } as any,
  });

  // S33 — completed > 12 mois avec adresse texte → pickupAddress + destination doivent être nullifiés
  await prisma.booking.upsert({
    where: { id: ID.B_S33 },
    update: {},
    create: {
      id: ID.B_S33,
      passengerId: ID.P7,
      driverProfileId: null,
      flightNumber: null,
      departureAirport: 'NSI',
      destination: 'Rue Nachtigal 45, Yaoundé Centre',  // ← adresse textuelle à anonymiser
      pickupAddress: 'Aéroport de Yaoundé-Nsimalen',    // ← idem
      pickupLat: 3.7226,
      pickupLng: 11.5532,
      vehicleType: 'standard',
      paymentMethod: 'points',
      estimatedPrice: 3200,
      status: 'cancelled',
      cancelledAt: oldDate(13),
      createdAt: oldDate(13),
      type: 'DEPARTURE',
    } as any,
  });

  // S34 — pending > 12 mois → NON anonymisé (statut hors du scope de la purge)
  await prisma.booking.upsert({
    where: { id: ID.B_S34 },
    update: {},
    create: {
      id: ID.B_S34,
      passengerId: ID.P7,
      driverProfileId: null,
      flightNumber: null,
      departureAirport: 'DLA',
      destination: 'Boulangerie du Centre, Douala',
      pickupAddress: 'Appartement Akwa Nord',
      pickupLat: 4.0600,
      pickupLng: 9.7100,
      vehicleType: 'eco',
      paymentMethod: 'wallet',
      estimatedPrice: 1500,
      status: 'pending',   // ← NOT in ['completed','cancelled'] → NON anonymisé
      createdAt: oldDate(15),
      type: 'ARRIVAL',
    } as any,
  });

  // ── D5 — Fraude / Solde ──────────────────────────────────────────────────

  // S36 — P5 avec 800 pts : 2 bookings simultanés à 800 pts chacun
  // Le 1er booking a déjà été créé (état final après race condition)
  await prisma.booking.upsert({
    where: { id: ID.B_S36A },
    update: {},
    create: {
      id: ID.B_S36A,
      passengerId: ID.P5,
      driverProfileId: ID.DP4,
      flightNumber: null,
      departureAirport: 'DLA',
      destination: 'Quartier Deido, Douala',
      vehicleType: 'eco_plus',
      paymentMethod: 'wallet',
      estimatedPrice: 800,
      status: 'confirmed',  // 1er booking → réussi
      type: 'ARRIVAL',
    } as any,
  });
  // Enregistrer le débit atomique du 1er booking (wallet=0 après)
  await prisma.wallet.upsert({
    where: { userId: ID.P5 },
    update: { balance: 0 },  // solde épuisé après 1er booking
    create: { userId: ID.P5, balance: 0 },
  });

  // S37 — booking pending → sera annulé → remboursement wallet attendu
  await prisma.booking.upsert({
    where: { id: ID.B_S37 },
    update: {},
    create: {
      id: ID.B_S37,
      passengerId: ID.P3,
      driverProfileId: ID.DP2,
      flightNumber: null,
      departureAirport: 'DLA',
      destination: 'Akwa Palace, Douala',
      vehicleType: 'standard',
      paymentMethod: 'wallet',
      estimatedPrice: 2000,
      status: 'pending',
      type: 'ARRIVAL',
      pickupAddress: 'Aéroport International de Douala',
    } as any,
  });
  // Le débit a déjà été fait à la création (wallet P3 = 3000 - 2000 = 1000)
  await prisma.wallet.upsert({
    where: { userId: ID.P3 },
    update: { balance: 1000 },
    create: { userId: ID.P3, balance: 1000 },
  });

  // S38 — booking pending créé il y a 12 min (> timeout 10 min) → expiration imminente
  const twelveMinAgo = new Date(Date.now() - 12 * 60 * 1000);
  await prisma.booking.upsert({
    where: { id: ID.B_S38 },
    update: {},
    create: {
      id: ID.B_S38,
      passengerId: ID.P1,
      driverProfileId: null,
      flightNumber: null,
      departureAirport: 'DLA',
      destination: 'Hôtel Sawa Beach, Kribi',
      vehicleType: 'confort_plus',
      paymentMethod: 'wallet',
      estimatedPrice: 1500,
      status: 'pending',
      createdAt: twelveMinAgo,
      type: 'ARRIVAL',
    } as any,
  });

  // S44 — no_driver_available : remboursement attendu via wallet.upsert (fix S44)
  await prisma.booking.upsert({
    where: { id: ID.B_S44 },
    update: {},
    create: {
      id: ID.B_S44,
      passengerId: ID.P1,
      driverProfileId: null,
      flightNumber: null,
      departureAirport: 'NSI',
      destination: 'Quartier Mimboman, Yaoundé',
      vehicleType: 'eco',
      paymentMethod: 'wallet',
      estimatedPrice: 2500,
      status: 'no_driver_available' as any,
      type: 'ARRIVAL',
    } as any,
  });

  // S47 — paiement cash : aucune vérification wallet
  await prisma.booking.upsert({
    where: { id: ID.B_S47 },
    update: {},
    create: {
      id: ID.B_S47,
      passengerId: ID.P4,
      driverProfileId: ID.DP4,
      flightNumber: null,
      departureAirport: 'DLA',
      destination: 'Gare routière Bonaberi, Douala',
      vehicleType: 'eco',
      paymentMethod: 'cash',
      estimatedPrice: 1200,
      status: 'confirmed',
      type: 'ARRIVAL',
    } as any,
  });

  // S49 — promo 20% : débit sur prix réduit (4000 → 3200)
  await prisma.booking.upsert({
    where: { id: ID.B_S49 },
    update: {},
    create: {
      id: ID.B_S49,
      passengerId: ID.P1,
      driverProfileId: ID.DP2,
      flightNumber: null,
      departureAirport: 'DLA',
      destination: 'Ambassade de France, Yaoundé',
      vehicleType: 'standard',
      paymentMethod: 'wallet',
      estimatedPrice: 3200,  // prix après remise 20%
      discountAmount: 800,   // 20% de 4000
      promoCode: 'SIMTEST20',
      status: 'confirmed',
      type: 'ARRIVAL',
    } as any,
  });

  // S50 — course normale complète (workflow ARRIVAL, points, cashback attendu)
  await prisma.booking.upsert({
    where: { id: ID.B_S50 },
    update: {},
    create: {
      id: ID.B_S50,
      passengerId: ID.P1,
      driverProfileId: ID.DP4,
      flightNumber: null,
      departureAirport: 'DLA',
      destination: 'Appartement Kotto, Douala',
      vehicleType: 'eco_plus',
      paymentMethod: 'wallet',
      estimatedPrice: 2800,
      status: 'passenger_confirming' as any,  // attente confirmation passager
      completedAt: new Date(),
      type: 'ARRIVAL',
      pickupAddress: 'Aéroport International de Douala',
    } as any,
  });

  console.log('   ✅ 22 réservations créées\n');

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. DRIVER POSITIONS (D4 — vieux enregistrements GPS)
  // ═══════════════════════════════════════════════════════════════════════════

  console.log('📍 Création des positions GPS historiques (D4)...');

  const gpsRecords = [
    // Positions > 12 mois → seront supprimées par le cron RGPD
    { lat: 4.0061, lng: 9.7197, bookingId: ID.B_S32, daysAgo: 420 },
    { lat: 4.0100, lng: 9.7250, bookingId: ID.B_S32, daysAgo: 418 },
    { lat: 4.0150, lng: 9.7300, bookingId: ID.B_S32, daysAgo: 415 },
    { lat: 3.7226, lng: 11.5532, bookingId: ID.B_S33, daysAgo: 400 },
    { lat: 3.7300, lng: 11.5600, bookingId: ID.B_S33, daysAgo: 398 },
    // Positions récentes → conservées (< 12 mois)
    { lat: 4.0450, lng: 9.7082, bookingId: ID.B_S11, daysAgo: 0 },
    { lat: 4.0460, lng: 9.7090, bookingId: ID.B_S11, daysAgo: 0 },
    { lat: 4.0470, lng: 9.7100, bookingId: ID.B_S13, daysAgo: 0 },
  ];

  for (const rec of gpsRecords) {
    const recordedAt = new Date(Date.now() - rec.daysAgo * 24 * 60 * 60 * 1000);
    await prisma.driverPosition.create({
      data: {
        driverProfileId: ID.DP1,
        bookingId: rec.bookingId,
        latitude: rec.lat,
        longitude: rec.lng,
        recordedAt,
      } as any,
    });
  }

  console.log('   ✅ 8 positions GPS créées (5 anciennes + 3 récentes)\n');

  // ═══════════════════════════════════════════════════════════════════════════
  // 7. RÉSUMÉ FINAL
  // ═══════════════════════════════════════════════════════════════════════════

  console.log('═══════════════════════════════════════════════════════════');
  console.log('✅  SEED SIMULATION TERMINÉ\n');
  console.log('ÉTATS INITIAUX POUR LES TESTS :\n');

  console.log('─── D1 — Vol annulé ────────────────────────────────────────');
  console.log('S01  AF6501  P1(wallet=5000) + DP1  → booking confirmed       → attendre : remboursement 3000 pts');
  console.log('S02  AF6502  P2(PAS wallet)  + DP1  → booking confirmed       → attendre : wallet créé avec 2500 pts');
  console.log('S03  AF6503  P3(wallet=3000) + DP2  → booking in_progress     → attendre : annulation + remboursement');
  console.log('S04  AF6504  P1              + DP1  → arrived_at_airport      → attendre : +5000 passager +2500 driver');
  console.log('S05  AF6505  P4(cash)        + DP2  → booking confirmed       → attendre : annulation, 0 pts remboursé');
  console.log('S06  AF6506  sentinel posé           → vol ignoré au prochain cycle');
  console.log('S07  AF6507  P5              sans DP → booking pending         → annulation propre');
  console.log('S08  AF6508  P3, 2 bookings          → les 2 annulés');
  console.log('S09  AF6501  P1  already cancelled   → ignoré');

  console.log('\n─── D2 — Panne chauffeur ───────────────────────────────────');
  console.log('S11  B_S11  DP1 panne → DP2 disponible      → reassign + notif');
  console.log('S12  B_S12  DP3 panne → tous offline         → cancel + rembours. 4000 pts P3');
  console.log('S13  B_S13  DP1 panne in_progress            → cancel + rembours. 5000 pts P3');
  console.log('S15  B_S15  DP1 panne DEPARTURE              → reassign DP2');
  console.log('S18  B_S18  DP4 tente panne booking DP1      → ForbiddenException');
  console.log('S19  B_S19  P4(cash) panne                   → cancel, 0 pts remboursé');

  console.log('\n─── D3 — Multi-device ──────────────────────────────────────');
  console.log('S21-S30  Tester via Postman/JWT :');
  console.log('  POST /auth/verify-otp P1 → sv=N (device A)');
  console.log('  POST /auth/verify-otp P1 → sv=N+1 (device B)');
  console.log('  GET  /bookings/active avec token device A → 401 session expirée');

  console.log('\n─── D4 — RGPD GPS ──────────────────────────────────────────');
  console.log('S31  DriverPositions créées avec recordedAt > 12 mois         → seront supprimées');
  console.log('S32  B_S32 completed, GPS + adresses > 12 mois               → null après cron');
  console.log('S33  B_S33 cancelled, pickupAddress + destination > 12 mois  → null après cron');
  console.log('S34  B_S34 pending > 12 mois                                 → NON anonymisé');

  console.log('\n─── D5 — Fraude / Solde ────────────────────────────────────');
  console.log('S36  P5(wallet=0 après 1er booking) → 2ème booking rejeté   → count=0 updateMany');
  console.log('S37  B_S37 pending → appeler DELETE /bookings/:id            → wallet P3 += 2000');
  console.log('S38  B_S38 créé il y a 12 min → scheduler expire            → wallet P1 += 1500');
  console.log('S39  POST /admin/users/P1/points {amount:500}               → wallet P1 += 500');
  console.log('S40  POST /admin/users/P6/points {amount:-200} wallet=0     → BadRequestException');
  console.log('S41  6x POST /bookings P6(solde 0)                          → fraud counter Redis');
  console.log('S42  GET /admin/fraud/alerts?min=3                           → P6 listé');
  console.log('S44  B_S44 no_driver_available                               → vérifier wallet P1');
  console.log('S47  B_S47 cash → pas de vérification wallet                → booking créé OK');
  console.log('S49  B_S49 promo 20% → débit 3200 pts (pas 4000)           → wallet correct');
  console.log('S50  B_S50 passenger_confirming → PATCH /bookings/:id/confirm → completed');
  console.log('═══════════════════════════════════════════════════════════\n');
}

main()
  .catch((e) => {
    console.error('❌ Erreur seed simulation :', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
