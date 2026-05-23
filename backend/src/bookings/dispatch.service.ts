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
  async findEligibleDrivers(booking: Booking, isPreLanding: boolean, customCoords?: { lat: number, lng: number }, passengerTier?: string) {
    this.logger.log(`Finding drivers for booking ${booking.id} (Pre-landing: ${isPreLanding}, tier: ${passengerTier ?? 'bronze'})`);

    let nearbyDrivers = [];
    // 0.B15 — score min + limits depuis AppSettings
    const [minScoreRaw, preLandingLimitRaw] = await Promise.all([
      this.settingsService.get('min_driver_score', '4.0'),
      this.settingsService.get('dispatch_prelanding_limit', '50'),
    ]);
    const minScore = parseFloat(minScoreRaw) || 4.0;
    const basePrelanding = parseInt(preLandingLimitRaw, 10) || 50;

    // F8 — Multiplicateur de pool selon tier fidélité passager
    const tierMultiplier: Record<string, number> = { bronze: 1.0, silver: 1.1, gold: 1.3, platinum: 1.5 };
    const tierMult = tierMultiplier[passengerTier ?? 'bronze'] ?? 1.0;
    const preLandingLimit = Math.ceil(basePrelanding * tierMult);

    // F8 — Or/Platine : score minimum abaissé pour garantir un meilleur chauffeur disponible
    const tierMinScoreBoost: Record<string, number> = { gold: -0.2, platinum: -0.3 };
    const boostedMinScore = Math.max(3.5, minScore + (tierMinScoreBoost[passengerTier ?? ''] ?? 0));

    // Un chauffeur est "actif" s'il est connecté OU s'il a envoyé sa position dans les 10 dernières minutes
    const recentThreshold = new Date(Date.now() - 10 * 60 * 1000);
    const onlineFilter = { OR: [{ isOnline: true }, { lastActive: { gte: recentThreshold } }] };

    if (isPreLanding) {
      // PRINCIPLE 1: All available drivers (regardless of location)
      nearbyDrivers = await this.prisma.driverProfile.findMany({
        where: {
          isAvailable: true,
          ...onlineFilter,
          status: 'approved',
          score: { gte: boostedMinScore },
        } as any,
        include: { user: { select: { name: true, phone: true } } },
        orderBy: [{ score: 'desc' }, { ratingAvg: 'desc' }],
        take: preLandingLimit,
      });
    } else {
      // PRINCIPLE 2: Passenger already at airport OR departing from home -> Proximity Priority
      nearbyDrivers = await this.findNearbyDrivers(booking.departureAirport, customCoords);
      // F8 — Gold/Platinum : si pool insuffisant, élargir rayon via fetch global
      if ((passengerTier === 'gold' || passengerTier === 'platinum') && nearbyDrivers.length < 3) {
        const extra = await this.prisma.driverProfile.findMany({
          where: { isAvailable: true, ...onlineFilter, status: 'approved', score: { gte: boostedMinScore } } as any,
          include: { user: { select: { name: true, phone: true } } },
          orderBy: [{ score: 'desc' }],
          take: Math.ceil(10 * tierMult),
        });
        const existingIds = new Set(nearbyDrivers.map((d: any) => d.id));
        for (const d of extra) { if (!existingIds.has(d.id)) nearbyDrivers.push(d); }
      }
    }

    return nearbyDrivers;
  }

  /**
   * Find drivers near an airport or custom coordinates using Haversine formula via SQL query raw.
   * 0.B3 — Coords lues depuis la table airports DB (plus de constante hardcodée).
   * 0.B4 — Rayon lu depuis AppSetting proximity_radius_km.
   */
  private async findNearbyDrivers(airportCode: string, customCoords?: { lat: number, lng: number }) {
    let coords = customCoords;
    if (!coords && airportCode) {
      const airport = await this.airportsService.findByCode(airportCode.toUpperCase());
      if (airport?.latitude && airport?.longitude) {
        coords = { lat: Number(airport.latitude), lng: Number(airport.longitude) };
      }
    }

    const recentThreshold = new Date(Date.now() - 10 * 60 * 1000);
    const onlineFilter = { OR: [{ isOnline: true }, { lastActive: { gte: recentThreshold } }] };

    if (!coords) {
      this.logger.warn(`Airport coordinates not found for ${airportCode}, falling back to score-based fetch.`);
      return this.prisma.driverProfile.findMany({
        where: { isAvailable: true, ...onlineFilter, status: 'approved' } as any,
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
            AND (is_online = true OR last_active >= NOW() - INTERVAL '10 minutes')
            AND latitude IS NOT NULL
            AND longitude IS NOT NULL
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
    const recentThreshold = new Date(Date.now() - 10 * 60 * 1000);
    return this.prisma.driverProfile.findMany({
      where: {
        isAvailable: true,
        OR: [{ isOnline: true }, { lastActive: { gte: recentThreshold } }],
        status: 'approved',
      } as any,
      include: { user: { select: { name: true } } },
      take: 5,
    });
  }

  /**
   * Calcule un ETA réaliste pour un booking déclenché alors qu'aucun chauffeur
   * n'est dans le rayon de proximité. Utilise la distance Haversine vers le
   * chauffeur global le plus proche divisée par la vitesse moyenne configurée.
   *
   * Tous les paramètres viennent de la DB ou des AppSettings — aucune valeur
   * hardcodée hors des defaults de fallback.
   */
  async estimateDelayedDispatch(
    vehicleType: string,
    pickupCoords?: { lat: number; lng: number },
  ): Promise<{ globalDriversCount: number; estimatedWaitMin: number; closestDistanceKm: number | null }> {
    // Chauffeurs disponibles globalement avec coords (pour estimation distance)
    const recentThreshold = new Date(Date.now() - 10 * 60 * 1000);
    const drivers = await this.prisma.driverProfile.findMany({
      where: {
        isAvailable: true,
        OR: [{ isOnline: true }, { lastActive: { gte: recentThreshold } }],
        status: 'approved',
        latitude:  { not: null },
        longitude: { not: null },
      } as any,
      select: { latitude: true, longitude: true },
      take: 50,
    });
    const globalDriversCount = drivers.length;

    // Setting dynamique : vitesse moyenne, défaut 30 km/h (urbain)
    const avgSpeedRaw = await this.settingsService.get('avg_driver_speed_kmh', '30');
    const avgSpeedKmh = Math.max(1, parseFloat(avgSpeedRaw) || 30);

    // Setting fallback si pas de coords / pas de chauffeur géolocalisé
    const fallbackRaw = await this.settingsService.get('delayed_dispatch_default_wait_min', '45');
    const fallbackMin = Math.max(1, parseInt(fallbackRaw, 10) || 45);

    if (!pickupCoords || drivers.length === 0) {
      return { globalDriversCount, estimatedWaitMin: fallbackMin, closestDistanceKm: null };
    }

    const R = 6371;
    let closestKm = Infinity;
    for (const d of drivers) {
      const dLat = ((d.latitude! - pickupCoords.lat) * Math.PI) / 180;
      const dLng = ((d.longitude! - pickupCoords.lng) * Math.PI) / 180;
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((pickupCoords.lat * Math.PI) / 180) *
          Math.cos((d.latitude! * Math.PI) / 180) *
          Math.sin(dLng / 2) ** 2;
      const km = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      if (km < closestKm) closestKm = km;
    }

    if (closestKm === Infinity) {
      return { globalDriversCount, estimatedWaitMin: fallbackMin, closestDistanceKm: null };
    }

    // ETA = distance / vitesse * 60 + buffer de prise en charge (setting)
    const pickupBufferRaw = await this.settingsService.get('driver_pickup_buffer_min', '5');
    const pickupBuffer = Math.max(0, parseInt(pickupBufferRaw, 10) || 5);
    const estimatedWaitMin = Math.ceil((closestKm / avgSpeedKmh) * 60) + pickupBuffer;

    return {
      globalDriversCount,
      estimatedWaitMin,
      closestDistanceKm: Math.round(closestKm * 10) / 10,
    };
  }

  /**
   * Calculate a priority score for a driver for a specific booking
   */
  calculateDriverPriority(driver: any, booking: Booking): number {
    // 70% Score (Reputation) + 30% App Rating
    return (driver.score || 5.0) * 0.7 + (driver.ratingAvg || 5.0) * 0.3;
  }
}
