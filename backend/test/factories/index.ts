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
    consigneEnabled: false,
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
