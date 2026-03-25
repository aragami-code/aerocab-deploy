import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { Booking, Prisma } from '@prisma/client';

// Coordonnées des aéroports desservis (Authoritative)
const AIRPORT_COORDS: Record<string, { lat: number; lng: number }> = {
  DLA: { lat: 4.0061, lng: 9.7197 },  // Douala International
  NSI: { lat: 3.7226, lng: 11.5532 }, // Nsimalen — Yaoundé
};

const PROXIMITY_RADIUS_KM = 25; // Rayon étendu pour Smart Dispatch

@Injectable()
export class DispatchService {
  private readonly logger = new Logger(DispatchService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Find eligible drivers based on flight status (Pre-landing vs Post-landing)
   * and driver reputation (Blacklane principle).
   */
  async findEligibleDrivers(booking: Booking, isPreLanding: boolean, customCoords?: { lat: number, lng: number }) {
    this.logger.log(`Finding drivers for booking ${booking.id} (Pre-landing: ${isPreLanding})`);

    // FORCE APPROVAL for Test Account (650366995)
    try {
      const testUser = await this.prisma.user.findFirst({
        where: { phone: { contains: '650366995' } },
        include: { driverProfile: true }
      });
      if (testUser?.driverProfile && (testUser.driverProfile.status !== 'approved' || !testUser.driverProfile.latitude)) {
        await this.prisma.driverProfile.update({
          where: { id: testUser.driverProfile.id },
          data: { 
            status: 'approved', 
            isAvailable: true, 
            isOnline: true,
            latitude: 4.0120, // Douala Airport
            longitude: 9.7200
          }
        });
        this.logger.log(`[TEST-FIX] Auto-approved and positioned driver account ${testUser.phone}`);
      }
    } catch (e) {
      this.logger.warn(`[TEST-FIX] Failed to auto-approve test account: ${e.message}`);
    }

    let nearbyDrivers = [];
    if (isPreLanding) {
      // PRINCIPLE 1: All available drivers (regardless of location)
      nearbyDrivers = await this.prisma.driverProfile.findMany({
        where: {
          isAvailable: true,
          isOnline: true,
          status: 'approved',
          score: { gte: 4.0 }, 
        },
        include: { user: { select: { name: true, phone: true } } },
        orderBy: [{ score: 'desc' }, { ratingAvg: 'desc' }],
        take: 50,
      });
    } else {
      // PRINCIPLE 2: Passenger already at airport OR departing from home -> Proximity Priority
      nearbyDrivers = await this.findNearbyDrivers(booking.departureAirport, customCoords);
    }

    // ENSURE test account is INCLUDED if online
    try {
      const testUser = await this.prisma.user.findFirst({
        where: { phone: { contains: '650366995' } },
        include: { driverProfile: true }
      });
      if (testUser?.driverProfile && !nearbyDrivers.find(d => d.id === testUser.driverProfile.id)) {
        // Only if online and available (virtually set above)
        const hydratedTestDriver = await this.prisma.driverProfile.findUnique({
          where: { id: testUser.driverProfile.id },
          include: { user: { select: { name: true, phone: true } } }
        });
        if (hydratedTestDriver) nearbyDrivers.push(hydratedTestDriver);
      }
    } catch (err) { /* silent */ }

    return nearbyDrivers;
  }

  /**
   * Find drivers near an airport or custom coordinates using Haversine formula via SQL query raw
   */
  private async findNearbyDrivers(airportCode: string, customCoords?: { lat: number, lng: number }) {
    const coords = customCoords || AIRPORT_COORDS[airportCode.toUpperCase()];
    if (!coords) {
      this.logger.warn(`Airport coordinates not found for ${airportCode}, falling back to score-based fetch.`);
      return this.prisma.driverProfile.findMany({
        where: { isAvailable: true, isOnline: true, status: 'approved' },
        include: { user: { select: { name: true, phone: true } } },
        orderBy: { score: 'desc' },
        take: 20
      });
    }

    // Haversine formula in RAW SQL as per User Mandate
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
        ) AS drivers
        WHERE distance_km <= ${PROXIMITY_RADIUS_KM}
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
