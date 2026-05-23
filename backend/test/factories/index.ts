import { faker } from '@faker-js/faker';

export function makeUser(overrides: Record<string, any> = {}) {
  return {
    id: faker.string.uuid(),
    name: faker.person.fullName(),
    phone: `+237${faker.string.numeric(9)}`,
    email: faker.internet.email(),
    role: 'passenger',
    status: 'active',
    referralCode: faker.string.alphanumeric(8).toUpperCase(),
    referredBy: null,
    language: 'fr',
    fcmToken: null,
    avatarUrl: null,
    createdAt: faker.date.past(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export function makeAdmin(overrides: Record<string, any> = {}) {
  return makeUser({ role: 'admin', ...overrides });
}

/** Utilisateur inscrit via OAuth (email/Google) — phone null, nécessite complete-profile */
export function makeOAuthUser(overrides: Record<string, any> = {}) {
  return makeUser({
    phone: null,
    email: faker.internet.email(),
    googleId: `google-sub-${faker.string.alphanumeric(12)}`,
    ...overrides,
  });
}

export function makeDriverUser(overrides: Record<string, any> = {}) {
  return makeUser({ role: 'driver', ...overrides });
}

export function makeDriverProfile(overrides: Record<string, any> = {}) {
  return {
    id: faker.string.uuid(),
    userId: faker.string.uuid(),
    vehicleBrand: faker.helpers.arrayElement(['Toyota', 'Hyundai', 'Kia', 'Honda']),
    vehicleModel: faker.helpers.arrayElement(['Corolla', 'Tucson', 'Sportage', 'Civic']),
    vehicleColor: faker.helpers.arrayElement(['Blanc', 'Noir', 'Gris', 'Bleu']),
    vehiclePlate: `LT ${faker.string.numeric(4)} ${faker.string.alpha(2).toUpperCase()}`,
    vehicleYear: faker.number.int({ min: 2015, max: 2024 }),
    vehicleCategory: 'berline',
    status: 'approved',
    isAvailable: true,
    isOnline: true,
    ratingAvg: faker.number.float({ min: 3.5, max: 5.0, fractionDigits: 1 }),
    ratingCount: faker.number.int({ min: 5, max: 200 }),
    totalRides: faker.number.int({ min: 10, max: 500 }),
    score: 5.0,
    latitude: faker.number.float({ min: 3.8, max: 4.2, fractionDigits: 4 }),
    longitude: faker.number.float({ min: 9.6, max: 9.8, fractionDigits: 4 }),
    driverType: 'external',
    createdAt: faker.date.past(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export function makeBooking(overrides: Record<string, any> = {}) {
  return {
    id: faker.string.uuid(),
    passengerId: faker.string.uuid(),
    driverProfileId: faker.string.uuid(),
    type: faker.helpers.arrayElement(['ARRIVAL', 'DEPARTURE', 'INTERNATIONAL']),
    status: 'completed',
    vehicleType: 'berline',
    estimatedPrice: faker.number.int({ min: 2000, max: 25000 }),
    paymentMethod: 'cash',
    pickupLat: 4.012,
    pickupLng: 9.72,
    dropoffLat: 3.866,
    dropoffLng: 11.516,
    origin: faker.location.city(),
    destination: faker.location.city(),
    departureAirport: null,
    flightNumber: null,
    completedAt: new Date(),
    createdAt: faker.date.recent(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export function makeWallet(overrides: Record<string, any> = {}) {
  return {
    id: faker.string.uuid(),
    userId: faker.string.uuid(),
    balance: faker.number.int({ min: 0, max: 100000 }),
    createdAt: faker.date.past(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export function makeTransaction(overrides: Record<string, any> = {}) {
  return {
    id: faker.string.uuid(),
    walletId: faker.string.uuid(),
    amount: faker.number.int({ min: 500, max: 50000 }),
    type: 'deposit',
    status: 'completed',
    reference: `WALLET-FLUTTERWAVE-${faker.string.alphanumeric(12).toUpperCase()}`,
    metadata: {},
    createdAt: faker.date.recent(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export function makePromo(overrides: Record<string, any> = {}) {
  return {
    id: faker.string.uuid(),
    code: faker.string.alphanumeric(6).toUpperCase(),
    discount: faker.number.int({ min: 10, max: 50 }),
    maxUses: faker.number.int({ min: 10, max: 500 }),
    usedCount: faker.number.int({ min: 0, max: 9 }),
    isActive: true,
    usagePerUser: false,
    expiresAt: null,
    createdAt: faker.date.past(),
    ...overrides,
  };
}

export function makeWithdrawalRequest(overrides: Record<string, any> = {}) {
  return {
    id: faker.string.uuid(),
    userId: faker.string.uuid(),
    amount: faker.number.int({ min: 1000, max: 50000 }),
    currency: 'XAF',
    method: 'mtn_momo',
    mobileNumber: `+237${faker.string.numeric(9)}`,
    status: 'pending',
    createdAt: faker.date.recent(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const ALL_DOC_TYPES = [
  'cni_front', 'cni_back', 'license', 'registration', 'vehicle_photo',
  'insurance', 'technical_control', 'vtc_license', 'passport', 'portrait',
  'criminal_record', 'proof_of_address', 'medical_certificate',
  'vaccination_card', 'border_pass',
] as const;

export type DocType = typeof ALL_DOC_TYPES[number];

export function makeDriverDocument(overrides: Record<string, any> = {}) {
  return {
    id: faker.string.uuid(),
    driverProfileId: faker.string.uuid(),
    type: faker.helpers.arrayElement(ALL_DOC_TYPES) as DocType,
    url: faker.internet.url(),
    status: 'pending',
    rejectionReason: null,
    createdAt: faker.date.recent(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/** Build a set of required documents for a driver (5 mandatory defaults). */
export function makeRequiredDocuments(driverProfileId: string, statusOverride: string = 'approved') {
  return (['cni_front', 'cni_back', 'license', 'registration', 'vehicle_photo'] as DocType[]).map(
    type => makeDriverDocument({ driverProfileId, type, status: statusOverride }),
  );
}

/** Build a full document config entry (as stored in AppSetting driver_document_config). */
export function makeDocConfig(overrides: Partial<{
  type: DocType; label: string; required: boolean; enabled: boolean;
}> = {}) {
  const type = overrides.type ?? faker.helpers.arrayElement(ALL_DOC_TYPES);
  return {
    type,
    label: faker.lorem.words(3),
    required: false,
    enabled: true,
    ...overrides,
  };
}

export function makePointsPackages(count = 4): number[] {
  return Array.from({ length: count }, () =>
    faker.helpers.arrayElement([500, 1000, 2000, 3000, 5000, 10000, 20000]),
  );
}

export function makeAirport(overrides: Record<string, any> = {}) {
  const cities = [
    { iataCode: 'DLA', icaoCode: 'FKKD', name: 'Aéroport International de Douala', city: 'Douala', country: 'Cameroun', countryCode: 'CM', latitude: 4.006086, longitude: 9.719483 },
    { iataCode: 'NSI', icaoCode: 'FKYS', name: 'Aéroport International de Yaoundé-Nsimalen', city: 'Yaoundé', country: 'Cameroun', countryCode: 'CM', latitude: 3.722556, longitude: 11.553250 },
    { iataCode: 'ABJ', icaoCode: 'DIAP', name: 'Aéroport Félix-Houphouët-Boigny', city: 'Abidjan', country: "Côte d'Ivoire", countryCode: 'CI', latitude: 5.261390, longitude: -3.926290 },
  ];
  const base = faker.helpers.arrayElement(cities);
  return {
    id: faker.string.uuid(),
    detectionRadius: 3.0,
    isActive: true,
    createdAt: faker.date.past(),
    updatedAt: new Date(),
    ...base,
    ...overrides,
  };
}

export function makeFlight(overrides: Record<string, any> = {}) {
  const scheduledArrival = faker.date.soon({ days: 7 });
  return {
    id: faker.string.uuid(),
    userId: faker.string.uuid(),
    flightNumber: `${faker.string.alpha(2).toUpperCase()}${faker.string.numeric(4)}`,
    airline: faker.helpers.arrayElement(['Air France', 'Ethiopian Airlines', 'Camair-Co', 'Kenya Airways']),
    origin: faker.helpers.arrayElement(['CDG', 'ADD', 'NBO', 'LHR']),
    destination: faker.helpers.arrayElement(['DLA', 'NSI', 'ABJ']),
    arrivalAirport: 'DLA',
    scheduledArrival,
    actualArrival: null,
    source: 'manual',
    createdAt: faker.date.past(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export function makeAppSetting(key: string, value: string): { key: string; value: string; updatedAt: Date } {
  return { key, value, updatedAt: new Date() };
}

export function makeDriverPosition(overrides: Record<string, any> = {}) {
  return {
    id: faker.string.uuid(),
    bookingId: faker.string.uuid(),
    driverProfileId: faker.string.uuid(),
    latitude: faker.number.float({ min: 3.8, max: 4.2, fractionDigits: 6 }),
    longitude: faker.number.float({ min: 9.6, max: 9.8, fractionDigits: 6 }),
    recordedAt: new Date(),
    ...overrides,
  };
}

export function makeDriverEarningsWallet(overrides: Record<string, any> = {}) {
  return {
    id:              faker.string.uuid(),
    driverProfileId: faker.string.uuid(),
    balance:         faker.number.float({ min: 0, max: 50000, fractionDigits: 2 }),
    pendingBalance:  0,
    currency:        'XAF',
    totalEarned:     faker.number.float({ min: 0, max: 200000, fractionDigits: 2 }),
    totalWithdrawn:  faker.number.float({ min: 0, max: 50000, fractionDigits: 2 }),
    createdAt:       faker.date.past(),
    updatedAt:       new Date(),
    ...overrides,
  };
}

export function makePaymentIntent(overrides: Record<string, any> = {}) {
  return {
    id:           faker.string.uuid(),
    bookingId:    faker.string.uuid(),
    provider:     faker.helpers.arrayElement(['orange_money_cm', 'mtn_cm', 'cash']),
    providerRef:  faker.string.alphanumeric(24),
    amount:       faker.number.float({ min: 1000, max: 30000, fractionDigits: 2 }),
    currency:     'XAF',
    amountBase:   faker.number.float({ min: 1000, max: 30000, fractionDigits: 2 }),
    baseCurrency: 'XAF',
    exchangeRate: 1,
    status:       'pending',
    metadata:     {},
    createdAt:    faker.date.recent(),
    ...overrides,
  };
}

export function makeBookingPayout(overrides: Record<string, any> = {}) {
  const gross = faker.number.float({ min: 2000, max: 20000, fractionDigits: 2 });
  const commissionRate = 0.15;
  const commission = Math.round(gross * commissionRate * 100) / 100;
  return {
    id:               faker.string.uuid(),
    bookingId:        faker.string.uuid(),
    driverProfileId:  faker.string.uuid(),
    grossAmount:      gross,
    commissionRate,
    commissionAmount: commission,
    providerFeeRate:  0.02,
    providerFeeAmount: 0,
    netAmount:        gross - commission,
    tipAmount:        0,
    currency:         'XAF',
    isCash:           false,
    status:           'pending',
    createdAt:        faker.date.recent(),
    ...overrides,
  };
}

export function makeForfait(overrides: Record<string, any> = {}) {
  return {
    id: faker.string.uuid(),
    name: faker.lorem.words(3),
    airportCode: 'DLA',
    destinationName: faker.location.city(),
    destLat: faker.number.float({ min: 3.8, max: 4.2, fractionDigits: 6 }),
    destLng: faker.number.float({ min: 9.6, max: 9.8, fractionDigits: 6 }),
    destRadius: 2.0,
    priceAmount: faker.number.int({ min: 3000, max: 25000 }),
    currency: 'XAF',
    countryCode: 'CM',
    vehicleTypes: ['eco', 'berline'],
    bookingTypes: ['ARRIVAL', 'DEPARTURE'],
    driverPercent: 85,
    companyPercent: 15,
    isActive: true,
    createdAt: faker.date.past(),
    updatedAt: new Date(),
    ...overrides,
  };
}
