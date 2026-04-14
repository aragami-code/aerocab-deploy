import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { Booking, Prisma } from '@prisma/client';
import { AirportsService } from '../airports/airports.service';
import { SettingsService } from '../settings/settings.service';

@Injectable()
export class DispatchService {
  private readonly logger = new Logger(DispatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly airportsService: AirportsService,
    private readonly settingsService: SettingsService,
  ) {}

  /**
   * Find eligible drivers based on flight status (Pre-landing vs Post-landing)
   * and driver reputation (Blacklane principle).
   */
  async findEligibleDrivers(booking: Booking, isPreLanding: boolean, customCoords?: { lat: number, lng: number }, withConsigne?: boolean) {
    this.logger.log(`Finding drivers for booking ${booking.id} (Pre-landing: ${isPreLanding})`);

    // Consigne filter: if withConsigne, only drivers with consigneEnabled OR driverType='internal'
    const consigneFilter: any = withConsigne
      ? { OR: [{ consigneEnabled: true }, { driverType: 'internal' }] }
      : {};

    let nearbyDrivers = [];
    // 0.B15 — score min + limits depuis AppSettings
    const [minScoreRaw, preLandingLimitRaw] = await Promise.all([
      this.settingsService.get('min_driver_score', '4.0'),
      this.settingsService.get('dispatch_prelanding_limit', '50'),
    ]);
    const minScore = parseFloat(minScoreRaw) || 4.0;
    const preLandingLimit = parseInt(preLandingLimitRaw, 10) || 50;

    if (isPreLanding) {
      // PRINCIPLE 1: All available drivers (regardless of location)
      nearbyDrivers = await this.prisma.driverProfile.findMany({
        where: {
          isAvailable: true,
          isOnline: true,
          status: 'approved',
          score: { gte: minScore },
          ...consigneFilter,
        } as any,
        include: { user: { select: { name: true, phone: true } } },
        orderBy: [{ score: 'desc' }, { ratingAvg: 'desc' }],
        take: preLandingLimit,
      });
    } else {
      // PRINCIPLE 2: Passenger already at airport OR departing from home -> Proximity Priority
      nearbyDrivers = await this.findNearbyDrivers(booking.departureAirport, customCoords, withConsigne);
    }

    return nearbyDrivers;
  }

  /**
   * Find drivers near an airport or custom coordinates using Haversine formula via SQL query raw.
   * 0.B3 — Coords lues depuis la table airports DB (plus de constante hardcodée).
   * 0.B4 — Rayon lu depuis AppSetting proximity_radius_km.
   */
  private async findNearbyDrivers(airportCode: string, customCoords?: { lat: number, lng: number }, withConsigne?: boolean) {
    let coords = customCoords;
    if (!coords && airportCode) {
      const airport = await this.airportsService.findByCode(airportCode.toUpperCase());
      if (airport?.latitude && airport?.longitude) {
        coords = { lat: Number(airport.latitude), lng: Number(airport.longitude) };
      }
    }

    const consigneClause = withConsigne
      ? Prisma.sql`AND (consigne_enabled = true OR driver_type = 'internal')`
      : Prisma.sql``;

    if (!coords) {
      this.logger.warn(`Airport coordinates not found for ${airportCode}, falling back to score-based fetch.`);
      return this.prisma.driverProfile.findMany({
        where: { isAvailable: true, isOnline: true, status: 'approved', ...(withConsigne ? { OR: [{ consigneEnabled: true }, { driverType: 'internal' }] } : {}) } as any,
        include: { user: { select: { name: true, phone: true } } },
        orderBy: { score: 'desc' },
        take: 20,
      });
    }

    const radiusRaw = await this.settingsService.get('proximity_radius_km', '25');
    const proximityRadiusKm = parseFloat(radiusRaw) || 25;

    // Haversine formula in RAW SQL
    const nearby = await this.prisma.$queryRaw<any[]>(
      Prisma.sql`
        SELECT id, distance_km FROM (
          SELECT id,
            6371 * acos(
              LEAST(1.0,
                cos(radians(${coords.lat})) * cos(radians(latitude))
                * cos(radians(longitude) - radians(${coords.lng}))
                + sin(radians(${coords.lat})) * sin(radians(latitude))
              )
            ) AS distance_km
          FROM driver_profiles
          WHERE status = 'approved'
            AND is_available = true
            AND is_online = true
            AND latitude IS NOT NULL
            AND longitude IS NOT NULL
            ${consigneClause}
        ) AS drivers
        WHERE distance_km <= ${proximityRadiusKm}
        ORDER BY distance_km ASC
        LIMIT 20
      `
    );

    if (nearby.length === 0) return [];

    // Hydrate the raw results with full profile and user data
    return this.prisma.driverProfile.findMany({
      where: { id: { in: nearby.map(n => n.id) } },
      include: { user: { select: { name: true, phone: true } } },
    });
  }

  /**
   * Check if there are ANY eligible drivers globally for a specific vehicle type.
   * Useful when no drivers are found nearby.
   */
  async findGlobalEligibleDrivers(vehicleType: string) {
    return this.prisma.driverProfile.findMany({
      where: {
        isAvailable: true,
        isOnline: true,
        status: 'approved',
        // Note: Filter by vehicle type if needed, but here we just check availability
      },
      include: { user: { select: { name: true } } },
      take: 5,
    });
  }

  /**
   * Calculate a priority score for a driver for a specific booking
   */
  calculateDriverPriority(driver: any, booking: Booking): number {
    // 70% Score (Reputation) + 30% App Rating
    return (driver.score || 5.0) * 0.7 + (driver.ratingAvg || 5.0) * 0.3;
  }
}
