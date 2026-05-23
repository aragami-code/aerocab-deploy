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

  /**
   * Retourne la liste des codes pays distincts ayant au moins un aéroport opéré.
   * Utilisé par l'admin pour proposer dynamiquement les pays disponibles
   * lors de la création de zones tarifaires.
   */
  async getOperatedCountryCodes(): Promise<string[]> {
    const rows = await this.prisma.airport.findMany({
      where: { isActive: true, isOperated: true },
      select: { countryCode: true },
      distinct: ['countryCode'],
      orderBy: { countryCode: 'asc' },
    });
    return rows.map((r) => r.countryCode.toUpperCase());
  }

  /**
   * Retourne uniquement les aéroports opérés par AeroCab (chauffeurs actifs,
   * tarifs configurés). Utilisé par /config pour informer les apps mobiles
   * de la zone de service réelle.
   */
  async findAllOperated() {
    return this.prisma.airport.findMany({
      where: { isActive: true, isOperated: true },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Renvoie true si l'aéroport (par code IATA) est opéré.
   * Utilisé par BookingsService comme garde-fou (Filtre 2).
   */
  async isOperated(iataCode: string): Promise<boolean> {
    const airport = await this.prisma.airport.findUnique({
      where: { iataCode: iataCode.toUpperCase() },
      select: { isOperated: true, isActive: true },
    });
    return !!airport && airport.isActive && airport.isOperated;
  }

  /**
   * Toggle admin : active/désactive un aéroport comme « opéré ».
   * Invalide le cache /config pour propager immédiatement aux apps.
   */
  async setOperated(id: string, isOperated: boolean) {
    const result = await this.prisma.airport.update({
      where: { id },
      data: { isOperated },
    });
    await this.redis.del(CONFIG_CACHE_KEY);
    return result;
  }

  async findAllAdmin(params: {
    page?: number;
    limit?: number;
    search?: string;
    country?: string;
  } = {}) {
    const page  = Math.max(1, params.page  ?? 1);
    const limit = Math.min(200, Math.max(1, params.limit ?? 50));
    const skip  = (page - 1) * limit;

    const where: any = {};
    if (params.search) {
      where.OR = [
        { iataCode: { contains: params.search, mode: 'insensitive' } },
        { icaoCode: { contains: params.search, mode: 'insensitive' } },
        { name:     { contains: params.search, mode: 'insensitive' } },
        { city:     { contains: params.search, mode: 'insensitive' } },
      ];
    }
    if (params.country) {
      where.countryCode = params.country.toUpperCase();
    }

    const [data, total] = await Promise.all([
      this.prisma.airport.findMany({ where, orderBy: { name: 'asc' }, skip, take: limit }),
      this.prisma.airport.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
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

  async detectByCoords(lat: number, lng: number): Promise<any | null> {
    try {
      // Bounding box ~50km pour pré-filtrer en SQL avant haversine
      const MAX_RADIUS_KM = 50;
      const degLat = MAX_RADIUS_KM / 111.0;
      const degLng = MAX_RADIUS_KM / (111.0 * Math.cos((lat * Math.PI) / 180));

      const airports = await this.prisma.airport.findMany({
        where: {
          isActive: true,
          latitude:  { gte: lat - degLat,  lte: lat + degLat  },
          longitude: { gte: lng - degLng, lte: lng + degLng },
        },
        select: { id: true, iataCode: true, name: true, city: true, countryCode: true, latitude: true, longitude: true, detectionRadius: true },
      });

      // Tri par distance croissante, retourne le plus proche dans son rayon
      const candidates: { airport: typeof airports[0]; distKm: number }[] = [];
      for (const airport of airports) {
        const R = 6371;
        const dLat = ((airport.latitude - lat) * Math.PI) / 180;
        const dLng = ((airport.longitude - lng) * Math.PI) / 180;
        const a =
          Math.sin(dLat / 2) ** 2 +
          Math.cos((lat * Math.PI) / 180) *
            Math.cos((airport.latitude * Math.PI) / 180) *
            Math.sin(dLng / 2) ** 2;
        const distKm = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        if (distKm <= airport.detectionRadius) {
          candidates.push({ airport, distKm });
        }
      }
      if (candidates.length === 0) return null;
      candidates.sort((a, b) => a.distKm - b.distKm);
      return candidates[0].airport;
    } catch (e) {
      this.logger.error('[AirportsService] detectByCoords failed:', e);
      return null;
    }
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
