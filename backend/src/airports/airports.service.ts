import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class AirportsService {
  private readonly logger = new Logger(AirportsService.name);

  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.airport.findMany({
      where: { isActive: true },
      orderBy: { iataCode: 'asc' },
    });
  }

  async findByCode(iataCode: string) {
    return this.prisma.airport.findUnique({
      where: { iataCode: iataCode.toUpperCase() },
    });
  }

  async search(query: string) {
    return this.prisma.airport.findMany({
      where: {
        isActive: true,
        OR: [
          { iataCode: { contains: query, mode: 'insensitive' } },
          { name: { contains: query, mode: 'insensitive' } },
          { city: { contains: query, mode: 'insensitive' } },
        ],
      },
      take: 10,
    });
  }

  async findNearby(lat: number, lng: number, radiusKm: number = 1000) {
    try {
      // Haversine formula with safe bounds for acos - using direct template literal
      const nearby = await this.prisma.$queryRaw<any[]>`
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
          id, 
          iata_code AS "iataCode", 
          name, 
          city, 
          country, 
          country_code AS "countryCode", 
          latitude, 
          longitude, 
          is_active AS "isActive",
          distance_km
        FROM distances
        WHERE distance_km <= ${radiusKm}
        ORDER BY distance_km ASC
        LIMIT 5
      `;

      if (nearby && nearby.length > 0) {
        return nearby;
      }
    } catch (e) {
      console.error('[AirportsService] Nearby search failed:', e);
    }

    // Ultimate fallback: return ALL airports so the list is never empty
    return this.findAll();
  }
}
