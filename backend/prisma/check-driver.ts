import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.findFirst({ where: { phone: '+237650366995' } });
  if (!user) { console.log('User not found'); return; }

  const profile = await prisma.driverProfile.findUnique({
    where: { userId: user.id },
  });
  console.log('Driver profile:', {
    id: profile?.id,
    status: profile?.status,
    isAvailable: profile?.isAvailable,
    vehicleCategory: profile?.vehicleCategory,
  });

  const bookings = await prisma.booking.findMany({
    where: { driverProfileId: profile?.id },
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: { id: true, status: true, vehicleType: true, createdAt: true },
  });
  console.log('Recent bookings:', bookings);
}

main().catch(console.error).finally(() => prisma.$disconnect());
