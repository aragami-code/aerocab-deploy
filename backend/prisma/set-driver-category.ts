/**
 * Script : assigne vehicleCategory à un chauffeur par son numéro de téléphone
 * Usage  : npx ts-node prisma/set-driver-category.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const phone = '+237650366995';
  const category = 'standard'; // eco | eco_plus | standard | confort | confort_plus

  const user = await prisma.user.findFirst({ where: { phone } });
  if (!user) throw new Error(`Utilisateur introuvable: ${phone}`);

  const profile = await prisma.driverProfile.findUnique({ where: { userId: user.id } });
  if (!profile) throw new Error(`Profil chauffeur introuvable pour ${phone}`);

  console.log('Profil actuel:', {
    vehicleBrand: profile.vehicleBrand,
    vehicleModel: profile.vehicleModel,
    vehicleColor: profile.vehicleColor,
    vehiclePlate: profile.vehiclePlate,
    vehicleYear: profile.vehicleYear,
    vehicleCategory: profile.vehicleCategory,
    status: profile.status,
  });

  const updated = await prisma.driverProfile.update({
    where: { id: profile.id },
    data: { vehicleCategory: category },
  });

  console.log(`\n✅ Catégorie assignée: ${updated.vehicleCategory}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
