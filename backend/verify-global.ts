import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function verifyGlobal() {
  const tests = [
    { name: 'Dubaï (DXB)', lat: 25.25, lng: 55.36, expected: 'DXB', icao: 'OMDB' },
    { name: 'Londres (LHR)', lat: 51.50, lng: -0.12, expected: 'LHR', icao: 'EGLL' },
    { name: 'Cameroun (DLA)', lat: 4.05, lng: 9.70, expected: 'DLA', icao: 'FKKD' }
  ];

  console.log('| Lieu | IATA attendu | IATA obtenu | ICAO obtenu | Dist | Resultat |');
  console.log('|------|---------------|-------------|-------------|------|----------|');

  for (const t of tests) {
    const nearby = await prisma.$queryRaw<any[]>`
        WITH distances AS (
          SELECT *,
            (6371 * acos(
              GREATEST(-1.0, LEAST(1.0,
                cos(radians(${t.lat})) * cos(radians(latitude))
                * cos(radians(longitude) - radians(${t.lng}))
                + sin(radians(${t.lat})) * sin(radians(latitude))
              ))
            )) AS distance_km
          FROM airports
          WHERE is_active = true
        )
        SELECT 
          id, iata_code AS "iataCode", icao_code AS "icaoCode", name, city, latitude, longitude, distance_km
        FROM distances
        ORDER BY distance_km ASC
        LIMIT 1
      `;
    
    const res = nearby[0];
    const status = (res.iataCode === t.expected && res.icaoCode === t.icao) ? '✅' : '❌';
    console.log(`| ${t.name} | ${t.expected} / ${t.icao} | ${res.iataCode} | ${res.icaoCode} | ${res.distance_km.toFixed(1)}km | ${status} |`);
  }
  await prisma.$disconnect();
}

verifyGlobal();
