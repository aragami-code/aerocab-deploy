import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Order matters: truncate dependents before parents.
// Table names from @@map annotations in schema.prisma.
const TRUNCATE_TABLES = [
  'audit_logs',
  'ratings',
  'reports',
  'ticket_messages',
  'messages',
  'conversations',
  'points_transactions',
  'withdrawal_requests',
  'transactions',
  'wallets',
  'promo_usages',
  'bookings',
  'tariff_snapshots',
  'driver_positions',
  'driver_documents',
  'driver_profiles',
  'user_permissions',
  'user_admin_roles',
  'role_permissions',
  'admin_roles',
  'permissions',
  'users',
];

export async function truncateAll(): Promise<void> {
  for (const table of TRUNCATE_TABLES) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE`);
  }
}

export async function getPrisma(): Promise<PrismaClient> {
  return prisma;
}

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}
