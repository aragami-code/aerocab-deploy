import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function testNearby() {
  const lat = 10.0; // Far North
  const lng = 14.0;
  const radiusKm = 10; // Very small radius, should trigger fallback

  console.log(`Testing nearby with lat=${lat}, lng=${lng}, radius=${radiusKm}...`);

  try {
    // Initial search with radius
    const nearby = await prisma.$queryRaw<any[]>`
        WITH distances AS (
          SELECT *,
            (6371 * acos(
              GREATEST(-1.0, LEAST(1.0,
                cos(radians(${lat})) * cos(radians(latitude))
                * cos(radians(longitude) - radians(${lng}))
                + sin(radians(${lat})) * sin(radians(latitude))
              ))
            )) AS distance_km
          FROM airports
          WHERE is_active = true
        )
        SELECT 
          id, iata_code AS "iataCode", name, city, country, 
          country_code AS "countryCode", latitude, longitude, 
          is_active AS "isActive", distance_km
        FROM distances
        WHERE distance_km <= ${radiusKm}
        ORDER BY distance_km ASC
        LIMIT 5
      `;

    console.log('Search with radius results:', nearby.length);

    if (nearby.length === 0) {
      console.log('No airports in radius, triggering fallback search...');
      const closest = await prisma.$queryRaw<any[]>`
        WITH distances AS (
          SELECT *,
            (6371 * acos(
              GREATEST(-1.0, LEAST(1.0,
                cos(radians(${lat})) * cos(radians(latitude))
                * cos(radians(longitude) - radians(${lng}))
                + sin(radians(${lat})) * sin(radians(latitude))
              ))
            )) AS distance_km
          FROM airports
          WHERE is_active = true
        )
        SELECT 
          id, iata_code AS "iataCode", name, city, country, 
          country_code AS "countryCode", latitude, longitude, 
          is_active AS "isActive", distance_km
        FROM distances
        ORDER BY distance_km ASC
        LIMIT 1
      `;
      console.log('Fallback result (Closest):', closest[0]?.iataCode, `at ${closest[0]?.distance_km.toFixed(2)} km`);
    } else {
      console.log('Closest found in radius:', nearby[0].iataCode);
    }
  } catch (e) {
    console.error('Test failed:', e);
  } finally {
    await prisma.$disconnect();
  }
}

testNearby();
