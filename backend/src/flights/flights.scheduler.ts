import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../database/prisma.service';
import { ConfigService } from '@nestjs/config';
import { FlightsService } from './flights.service';

@Injectable()
export class FlightsScheduler {
  private readonly logger = new Logger(FlightsScheduler.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private flightsService: FlightsService,
  ) {}

  // Toutes les 10 minutes — met à jour les vols pas encore atterris
  @Cron(CronExpression.EVERY_10_MINUTES)
  async syncFlightStatuses() {
    // On vérifie maintenant la clé AeroDataBox
    const aeroDataBoxKey = this.config.get<string>('AERODATABOX_API_KEY');
    if (!aeroDataBoxKey) return; 

    const now = new Date();
    const cutoff = new Date(now.getTime() + 6 * 60 * 60 * 1000); // 6h à l'avance max

    // Vols avec flightNumber, pas encore atterris, dans les 6 prochaines heures
    const flights = await this.prisma.flight.findMany({
      where: {
        flightNumber: { not: null },
        actualArrival: null,
        scheduledArrival: { lte: cutoff },
        source: 'api',
      },
      take: 20, // max 20 par batch pour éviter de dépasser les quotas RapidAPI
    });

    if (flights.length === 0) return;

    this.logger.log(`[FlightsScheduler] Syncing ${flights.length} flights via AeroDataBox...`);

    for (const flight of flights) {
      if (!flight.flightNumber) continue;
      try {
        const info = await this.flightsService.searchFlight(flight.flightNumber);
        if (!info) continue;

        // Si le statut indique que l'avion est arriv (selon les rgles de FlightsService/AeroDataBox)
        if (info.status === 'Arrived' || info.status === 'Landed') {
          await this.prisma.flight.update({
            where: { id: flight.id },
            data: { 
              actualArrival: info.scheduledArrival ? new Date(info.scheduledArrival) : new Date(),
            },
          });
          this.logger.log(`[FlightsScheduler] Flight ${flight.flightNumber} marked as landed.`);
        }
      } catch (err) {
        this.logger.error(`[FlightsScheduler] Error syncing flight ${flight.flightNumber}: ${err.message}`);
      }
    }
  }
}
