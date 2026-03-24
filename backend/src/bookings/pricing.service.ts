import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class PricingService {
  private readonly logger = new Logger(PricingService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Calculate dynamic pricing based on demand (Surge Pricing)
   * Ratio: (Pending Bookings in last 15m) / (Available & Online Drivers)
   */
  async calculateEstimatedPrice(basePrice: number, airportCode: string): Promise<number> {
    this.logger.log(`Calculating surge price for ${airportCode} (Base: ${basePrice})`);

    try {
      const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);

      // 1. Demand: Active or Pending bookings for this airport zone
      const demandCount = await this.prisma.booking.count({
        where: {
          departureAirport: airportCode.toUpperCase(),
          status: { in: ['pending', 'confirmed'] },
          createdAt: { gte: fifteenMinutesAgo }
        }
      });

      // 2. Supply: Drivers online and available
      const supplyCount = await this.prisma.driverProfile.count({
        where: {
          isAvailable: true,
          isOnline: true,
          status: 'approved'
        }
      });

      if (supplyCount === 0) return basePrice * 1.5; // Scarcity fallback

      const ratio = demandCount / supplyCount;
      let multiplier = 1.0;

      if (ratio > 2.0) multiplier = 1.8;
      else if (ratio > 1.5) multiplier = 1.5;
      else if (ratio > 1.0) multiplier = 1.2;

      this.logger.log(`Surge Report - Demand: ${demandCount}, Supply: ${supplyCount}, Ratio: ${ratio.toFixed(2)} -> Multiplier: ${multiplier}x`);

      return Math.round(basePrice * multiplier);
    } catch (err) {
      this.logger.error(`Failed to calculate surge price: ${err.message}`);
      return basePrice; // Safety fallback
    }
  }

  /**
   * Check if Surge Pricing is currently active for a zone
   */
  async isSurgeActive(airportCode: string): Promise<boolean> {
    const price = await this.calculateEstimatedPrice(1000, airportCode);
    return price > 1000;
  }
}
