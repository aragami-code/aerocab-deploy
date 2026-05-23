import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const total = await prisma.airport.count();
  console.log(`Total aéroports en base: ${total}`);

  const cmUpdate = await prisma.airport.updateMany({
    where: { countryCode: 'CM' },
    data: { detectionRadius: 15 },
  });
  console.log(`Aéroports camerounais mis à jour (rayon 15km): ${cmUpdate.count}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
