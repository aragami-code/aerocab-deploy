import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TEST_CASES = [
  { name: 'Maroua (Extrême-Nord)', lat: 10.45, lng: 14.24, expected: 'MVR' },
  { name: 'Garoua (Nord)', lat: 9.33, lng: 13.39, expected: 'GOU' },
  { name: 'Ngaoundéré (Adamaoua)', lat: 7.35, lng: 13.58, expected: 'NGE' },
  { name: 'Bamenda (Nord-Ouest)', lat: 5.96, lng: 10.15, expected: 'BPC' },
  { name: 'Bafoussam (Ouest)', lat: 5.47, lng: 10.41, expected: 'BFX' },
  { name: 'Bertoua (Est)', lat: 4.57, lng: 13.68, expected: 'BTA' },
  { name: 'Yaoundé-Ville (Centre)', lat: 3.84, lng: 11.50, expected: 'NSI' },
  { name: 'Douala-Ville (Littoral)', lat: 4.05, lng: 9.70, expected: 'DLA' },
  { name: 'Point perdu (Rayon 10km)', lat: 6.5, lng: 12.0, radius: 10, expected: 'NGE' } // Doit déclencher le fallback
];

async function runTests() {
  console.log('| Région | Coordonnées | Rayon | Résultat | Distance | Statut |');
  console.log('|--------|--------------|-------|----------|----------|--------|');

  for (const tc of TEST_CASES) {
    const radius = tc.radius || 1000;
    try {
      // Simulation de logic findNearby
      let results = await prisma.$queryRaw<any[]>`
        WITH dists AS (
          SELECT iata_code, name, latitude, longitude,
            (6371 * acos(GREATEST(-1.0, LEAST(1.0, cos(radians(${tc.lat})) * cos(radians(latitude)) * cos(radians(longitude) - radians(${tc.lng})) + sin(radians(${tc.lat})) * sin(radians(latitude)))))) AS distance
          FROM airports WHERE is_active = true
        )
        SELECT * FROM dists WHERE distance <= ${radius} ORDER BY distance ASC LIMIT 5
      `;

      let mode = 'Standard';
      if (results.length === 0) {
        mode = 'FALLBACK';
        results = await prisma.$queryRaw<any[]>`
          WITH dists AS (
            SELECT iata_code, name, latitude, longitude,
              (6371 * acos(GREATEST(-1.0, LEAST(1.0, cos(radians(${tc.lat})) * cos(radians(latitude)) * cos(radians(longitude) - radians(${tc.lng})) + sin(radians(${tc.lat})) * sin(radians(latitude)))))) AS distance
            FROM airports WHERE is_active = true
          )
          SELECT * FROM dists ORDER BY distance ASC LIMIT 1
        `;
      }

      const best = results[0];
      const status = best.iata_code === tc.expected ? '✅ OK' : `❌ KO (Attendu ${tc.expected})`;
      console.log(`| ${tc.name} | ${tc.lat},${tc.lng} | ${radius}km | ${best.iata_code} (${mode}) | ${best.distance.toFixed(1)}km | ${status} |`);
    } catch (e: any) {
      console.log(`| ${tc.name} | Error: ${e.message} | - | - | - | ❌ |`);
    }
  }
  await prisma.$disconnect();
}

runTests();
