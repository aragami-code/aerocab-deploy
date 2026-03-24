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
  async findEligibleDrivers(booking: Booking, isPreLanding: boolean) {
    this.logger.log(`Finding drivers for booking ${booking.id} (Pre-landing: ${isPreLanding})`);

    if (isPreLanding) {
      // PRINCIPLE 1: All available drivers (regardless of location)
      // Filtered by reputation (score >= 4.5 for VIP/Early reservation)
      return this.prisma.driverProfile.findMany({
        where: {
          isAvailable: true,
          isOnline: true,
          status: 'approved',
          score: { gte: 4.0 }, // Minimum score for pre-reservations
        },
        include: { user: { select: { name: true, phone: true } } },
        orderBy: [
          { score: 'desc' },
          { ratingAvg: 'desc' }
        ],
        take: 50, // Large broadcast for pre-landing
      });
    } else {
      // PRINCIPLE 2: Passenger already at airport -> Proximity Priority
      return this.findNearbyDrivers(booking.departureAirport);
    }
  }

  /**
   * Find drivers near an airport using Haversine formula via SQL query raw
   */
  private async findNearbyDrivers(airportCode: string) {
    const coords = AIRPORT_COORDS[airportCode.toUpperCase()];
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
        HAVING 6371 * acos(
            LEAST(1.0,
              cos(radians(${coords.lat})) * cos(radians(latitude))
              * cos(radians(longitude) - radians(${coords.lng}))
              + sin(radians(${coords.lat})) * sin(radians(latitude))
            )
          ) <= ${PROXIMITY_RADIUS_KM}
        ORDER BY distance_km ASC, score DESC
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
   * Calculate a priority score for a driver for a specific booking
   */
  calculateDriverPriority(driver: any, booking: Booking): number {
    // 70% Score (Reputation) + 30% App Rating
    return (driver.score || 5.0) * 0.7 + (driver.ratingAvg || 5.0) * 0.3;
  }
}
