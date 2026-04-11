import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const airports = await prisma.airport.findMany({
    where: { isActive: true }
  });
  console.log('Active airports in DB:', airports.length);
  airports.forEach(a => console.log(`- ${a.iataCode}: ${a.name} (${a.latitude}, ${a.longitude})`));
  
  // Test finding nearby for Douala (approx 4.05, 9.70)
  const lat = 4.05;
  const lng = 9.70;
  const radius = 500;
  
  const nearby = await prisma.$queryRaw<any[]>`
    WITH distances AS (
      SELECT *,
        (6371 * acos(
          LEAST(1.0,
            cos(radians(${lat})) * cos(radians(latitude))
            * cos(radians(longitude) - radians(${lng}))
            + sin(radians(${lat})) * sin(radians(latitude))
          )
        )) AS distance_km
      FROM airports
      WHERE is_active = true
    )
    SELECT * FROM distances
    WHERE distance_km <= ${radius}
    ORDER BY distance_km ASC
    LIMIT 5
  `;
  
  console.log(`\nNearby airports for (${lat}, ${lng}) with radius ${radius}km:`, nearby.length);
  nearby.forEach(n => console.log(`- ${n.iataCode}: ${n.distance_km.toFixed(2)} km`));
}

main().catch(console.error).finally(() => prisma.$disconnect());
