/**
 * Seed des 8804 aéroports mondiaux (catalogue OurAirports) dans la table `airports`.
 *
 * Source : prisma/airports-catalog.json (généré côté passenger par
 *   aerocab-passenger/scripts/generate-airports-json.mjs — partagé app+backend)
 *
 * Stratégie :
 *  - Upsert par iataCode → idempotent (rejouable sans doublons).
 *  - Pour un aéroport EXISTANT : on conserve isOperated, isActive, detectionRadius
 *    et on garde aussi name/country si déjà personnalisés (français curé pour DLA/NSI…).
 *  - Pour un aéroport NOUVEAU : isOperated=true uniquement pour DLA et NSI,
 *    isActive=true, detectionRadius=3.0 (défaut Prisma).
 *
 * Usage : npx tsx prisma/seed-airports.ts
 */

import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';
import { join } from 'path';

const prisma = new PrismaClient();

type CatalogAirport = {
  iataCode: string;
  name: string;
  city: string;
  countryCode: string;
  latitude: number;
  longitude: number;
};

const DEFAULT_OPERATED = new Set(['DLA', 'NSI']);

async function main() {
  const catalogPath = join(__dirname, 'airports-catalog.json');
  const raw = readFileSync(catalogPath, 'utf8');
  const catalog: CatalogAirport[] = JSON.parse(raw);

  console.log(`Catalogue chargé : ${catalog.length} aéroports`);

  let created = 0;
  let updatedCoords = 0;
  let skipped = 0;
  const BATCH = 200;

  for (let i = 0; i < catalog.length; i += BATCH) {
    const slice = catalog.slice(i, i + BATCH);
    await Promise.all(slice.map(async (a) => {
      const iata = a.iataCode.toUpperCase();
      const countryCode = (a.countryCode || 'XX').toUpperCase();

      try {
        const existing = await prisma.airport.findUnique({ where: { iataCode: iata } });

        if (!existing) {
          await prisma.airport.create({
            data: {
              iataCode: iata,
              name: a.name,
              city: a.city || iata,
              country: countryCode,  // placeholder — l'admin peut éditer
              countryCode,
              latitude: a.latitude,
              longitude: a.longitude,
              isActive: true,
              isOperated: DEFAULT_OPERATED.has(iata),
            },
          });
          created++;
        } else {
          // Met à jour UNIQUEMENT les coords (au cas où OurAirports corrige une erreur).
          // On NE TOUCHE PAS à : name, city, country, countryCode (curé manuellement),
          // isActive, isOperated, detectionRadius (décisions admin).
          await prisma.airport.update({
            where: { iataCode: iata },
            data: {
              latitude: a.latitude,
              longitude: a.longitude,
            },
          });
          updatedCoords++;
        }
      } catch (e) {
        skipped++;
        if (skipped < 5) {
          console.warn(`  ⚠ ${iata} ignoré:`, (e as Error).message);
        }
      }
    }));
    console.log(`  …${Math.min(i + BATCH, catalog.length)}/${catalog.length}`);
  }

  console.log(`\n✓ Seed terminé`);
  console.log(`  Créés         : ${created}`);
  console.log(`  Coords MAJ    : ${updatedCoords}`);
  console.log(`  Ignorés       : ${skipped}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
