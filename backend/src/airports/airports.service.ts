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

  async findNearby(lat: number, lng: number, radiusKm: number = 100) {
    // Haversine formula via CTE (valid PostgreSQL, no GROUP BY needed)
    return this.prisma.$queryRaw<any[]>(
      Prisma.sql`
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
        WHERE distance_km <= ${radiusKm}
        ORDER BY distance_km ASC
        LIMIT 5
      `,
    );
  }
}
