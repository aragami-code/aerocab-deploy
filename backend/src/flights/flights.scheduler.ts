import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../database/prisma.service';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class FlightsScheduler {
  private readonly logger = new Logger(FlightsScheduler.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  // Toutes les 15 minutes — met à jour les vols pas encore atterris
  @Cron(CronExpression.EVERY_10_MINUTES)
  async syncFlightStatuses() {
    const apiKey = this.config.get<string>('AVIATIONSTACK_API_KEY');
    if (!apiKey) return; // Pas d'API key → skip silencieusement

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
      take: 50, // max 50 par batch pour éviter de dépasser les quotas
    });

    if (flights.length === 0) return;

    this.logger.log(`Syncing ${flights.length} flights...`);

    for (const flight of flights) {
      try {
        const res = await fetch(
          `http://api.aviationstack.com/v1/flights?access_key=${apiKey}&flight_iata=${flight.flightNumber}`,
        );
        const data = await res.json() as any;
        const info = data?.data?.[0];
        if (!info) continue;

        const status: string = info.flight_status;
        const actualLanding: string | null = info.arrival?.actual ?? null;

        if (status === 'landed' && actualLanding) {
          await this.prisma.flight.update({
            where: { id: flight.id },
            data: { actualArrival: new Date(actualLanding) },
          });
          this.logger.log(`Flight ${flight.flightNumber} landed at ${actualLanding}`);
        }
      } catch {
        // silencieux — un vol en erreur n'arrête pas les autres
      }
    }
  }
}
