import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Order matters: truncate dependents before parents.
// Table names from @@map annotations in schema.prisma.
// NOTE: permissions/admin_roles/role_permissions are seeded once in global-setup — do NOT truncate.
// NOTE: user_admin_roles cascades when users are truncated (FK constraint ON DELETE CASCADE).
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
  // Phase B/C/D/E new tables
  'tip_transactions',
  'ride_receipts',
  'payment_links',
  'booking_participants',
  'booking_payouts',
  'payment_intents',
  'driver_earnings_wallets',
  'driver_registration_payments',
  'kyc_documents',
  'emergency_contacts',
  'bookings',
  'tariff_snapshots',
  'driver_positions',
  'driver_documents',
  'country_change_requests',
  'driver_profiles',
  'user_permissions',
  'users',
  'app_settings',
];

export async function truncateAll(): Promise<void> {
  for (const table of TRUNCATE_TABLES) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE`);
  }
}

/**
 * Assign the seeded 'super_admin' DB role to a test user so PermissionsGuard
 * passes for ALL permissions — unaffected by other specs that reset 'admin' role perms.
 */
export async function assignAdminRole(userId: string): Promise<void> {
  const role = await prisma.adminRole.findUnique({ where: { name: 'super_admin' } });
  if (!role) throw new Error('super_admin role not found — did global-setup run seed-rbac?');
  await prisma.userAdminRole.upsert({
    where:  { userId_roleId: { userId, roleId: role.id } },
    create: { userId, roleId: role.id },
    update: {},
  });
}

export async function getPrisma(): Promise<PrismaClient> {
  return prisma;
}

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}
