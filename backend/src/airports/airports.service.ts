import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { Prisma } from '@prisma/client';
import { CreateAirportDto, UpdateAirportDto } from './dto/airport.dto';
import { RedisService } from '../redis/redis.service';

const CONFIG_CACHE_KEY = 'config:cache';

@Injectable()
export class AirportsService {
  private readonly logger = new Logger(AirportsService.name);

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
  ) {}

  async findAll() {
    return this.prisma.airport.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  async findAllAdmin() {
    return this.prisma.airport.findMany({
      orderBy: { name: 'asc' },
    });
  }

  async create(data: CreateAirportDto) {
    return this.prisma.airport.create({
      data: {
        ...data,
        iataCode: data.iataCode.toUpperCase(),
        icaoCode: data.icaoCode?.toUpperCase(),
        countryCode: data.countryCode.toUpperCase(),
      },
    });
  }

  async update(id: string, data: UpdateAirportDto) {
    const result = await this.prisma.airport.update({
      where: { id },
      data: {
        ...data,
        iataCode: data.iataCode?.toUpperCase(),
        icaoCode: data.icaoCode?.toUpperCase(),
        countryCode: data.countryCode?.toUpperCase(),
      },
    });
    await this.redis.del(CONFIG_CACHE_KEY);
    return result;
  }

  async remove(id: string) {
    const result = await this.prisma.airport.delete({ where: { id } });
    await this.redis.del(CONFIG_CACHE_KEY);
    return result;
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

  async findNearby(lat: number, lng: number, radiusKm: number = 80) {
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
          icao_code AS "icaoCode", 
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

      // Aucun aéroport dans le rayon → retourne liste vide (pas de fallback global)
      return [];
    } catch (e) {
      console.error('[AirportsService] Nearby search failed:', e);
    }

    return [];
  }

  /**
   * Retourne l'aéroport actif le plus proche des coordonnées données,
   * sans contrainte de rayon — utilisé comme suggestion quand aucun
   * aéroport n'est trouvé dans les 80km.
   */
  async findClosest(lat: number, lng: number) {
    try {
      const result = await this.prisma.$queryRaw<any[]>`
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
          id, iata_code AS "iataCode", icao_code AS "icaoCode",
          name, city, country, country_code AS "countryCode",
          latitude, longitude, is_active AS "isActive", distance_km
        FROM distances
        ORDER BY distance_km ASC
        LIMIT 1
      `;
      return result[0] ?? null;
    } catch (e) {
      console.error('[AirportsService] findClosest failed:', e);
      return null;
    }
  }
}
