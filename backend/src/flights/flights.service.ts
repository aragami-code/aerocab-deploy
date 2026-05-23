import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service';
import { CreateFlightDto } from './dto';


@Injectable()
export class FlightsService {
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  /**
   * Recherche les infos d'un vol via FlightRadar24 flight-summaries
   * Remplace AeroDataBox
   */
  async searchFlight(flightNumber: string) {
    const normalized = flightNumber.replace(/\s/g, '').toUpperCase();
    const token = this.config.get<string>('FLIGHT_RADAR_TOKEN');

    if (!token) {
      console.warn(`[FlightsService] Pas de FLIGHT_RADAR_TOKEN. Mock pour ${normalized}.`);
      return this.getMockFlightInfo(normalized);
    }

    try {
      // Utilise live/flight-positions/full (disponible sur notre plan)
      // flight-summaries/light n'est pas accessible sur notre niveau d'abonnement FR24
      const fr24BaseUrl = this.config.get('FLIGHT_RADAR_API_URL', 'https://fr24api.flightradar24.com/api');
      const res = await fetch(
        `${fr24BaseUrl}/live/flight-positions/full?flights=${normalized}`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json',
            'Accept-Version': 'v1',
          },
        },
      );

      if (!res.ok) {
        console.error(`[FlightsService] FR24 live/flight-positions/full erreur: ${res.status}`);
        return this.getMockFlightInfo(normalized);
      }

      const data = await res.json() as { data?: any[] };
      if (!data.data?.length) return null; // Vol non trouvé → le client affichera le sélecteur d'aéroport

      const f = data.data[0];

      const arrivalAirport = f.dest_iata ? f.dest_iata.toUpperCase() : null;
      // ETA est le champ disponible sur l'endpoint live/full
      const scheduledArrival = f.eta ?? null;

      return {
        flightNumber: f.flight ?? normalized,
        airline: f.operating_as ?? f.painted_as ?? null,
        origin: f.orig_iata ?? null,
        destination: f.dest_iata ?? null,
        arrivalAirport,
        scheduledArrival,
        actualArrival: null,
        status: 'active' as const, // vol en cours si présent dans live
        source: 'api' as const,
      };
    } catch (error) {
      console.error(`[FlightsService] Erreur searchFlight ${normalized}:`, error);
      return null; // Erreur réseau → client affichera le sélecteur d'aéroport
    }
  }

  /**
   * Infos complètes + position live d'un vol (pour tracking passager/driver)
   * Retourne une structure imbriquée compatible avec FlightDetailsScreen (driver).
   */
  async getLiveFlightDetails(flightNumber: string) {
    const normalized = flightNumber.replace(/\s/g, '').toUpperCase();
    const token = this.config.get<string>('FLIGHT_RADAR_TOKEN');
    if (!token) return null;

    const [summary, live] = await Promise.all([
      this.searchFlight(normalized),
      this.getFlightRadar24Position(normalized, token),
    ]);

    if (!summary) return null;

    // Transforme la structure plate en structure imbriquée attendue par l'UI driver
    return {
      flightNumber: summary.flightNumber,
      airline: { name: summary.airline ?? null },
      departure: {
        iata:      summary.origin ?? null,
        airport:   summary.origin ?? null,
        scheduled: null,
        actual:    null,
        delay:     0,
        terminal:  null,
        gate:      null,
      },
      arrival: {
        iata:      summary.destination ?? null,
        airport:   summary.destination ?? null,
        scheduled: summary.scheduledArrival ?? null,
        actual:    summary.actualArrival ?? null,
        estimated: summary.scheduledArrival ?? null,
        delay:     0,
        terminal:  null,
        baggage:   null,
      },
      status:   summary.status,
      aircraft: null,
      live,
    };
  }

  /**
   * Position live via FR24 (latitude, longitude, altitude, vitesse, cap)
   */
  private async getFlightRadar24Position(flightNumber: string, token: string): Promise<{
    latitude: number; longitude: number; altitude: number;
    speedHorizontal: number; direction: number; isGround: boolean; updatedAt: string;
  } | null> {
    try {
      const fr24BaseUrl = this.config.get('FLIGHT_RADAR_API_URL', 'https://fr24api.flightradar24.com/api');
      const res = await fetch(
        `${fr24BaseUrl}/live/flight-positions/light?flights=${flightNumber}`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json',
            'Accept-Version': 'v1',
          },
        },
      );
      if (!res.ok) return null;

      const data = await res.json() as { data?: any[] };
      if (!data.data?.length) return null;

      const f = data.data[0];
      return {
        latitude:        f.lat,
        longitude:       f.lon,
        altitude:        f.alt ?? 0,
        speedHorizontal: f.gspeed ?? 0,
        direction:       f.track ?? 0,
        isGround:        f.on_ground ?? false,
        updatedAt: new Date((f.timestamp ?? Date.now() / 1000) * 1000).toISOString(),
      };
    } catch {
      return null;
    }
  }

  /**
   * Create a flight record for a user
   */
  async createFlight(userId: string, dto: CreateFlightDto) {
    return this.prisma.flight.create({
      data: {
        userId,
        flightNumber: dto.flightNumber?.replace(/\s/g, '').toUpperCase() || null,
        airline:      dto.airline || null,
        origin:       dto.origin || null,
        destination:  dto.destination || null,
        arrivalAirport:  dto.arrivalAirport,
        scheduledArrival: new Date(dto.scheduledArrival),
        source: dto.source || 'manual',
      },
    });
  }

  async getUserFlights(userId: string) {
    return this.prisma.flight.findMany({
      where: { userId },
      orderBy: { scheduledArrival: 'desc' },
    });
  }

  async getFlightById(flightId: string) {
    const flight = await this.prisma.flight.findUnique({
      where: { id: flightId },
      include: { user: { select: { id: true, name: true, phone: true } } },
    });
    if (!flight) throw new NotFoundException('Vol non trouvé');
    return flight;
  }

  async getActiveFlight(userId: string) {
    return this.prisma.flight.findFirst({
      where: { userId, scheduledArrival: { gte: new Date() } },
      orderBy: { scheduledArrival: 'asc' },
    });
  }

  async deleteFlight(userId: string, flightId: string) {
    const flight = await this.prisma.flight.findFirst({ where: { id: flightId, userId } });
    if (!flight) throw new NotFoundException('Vol non trouvé');
    await this.prisma.flight.delete({ where: { id: flightId } });
    return { message: 'Vol supprimé' };
  }

  /**
   * Mock pour développement sans token FR24
   */
  private getMockFlightInfo(flightNumber: string) {
    const airlines: Record<string, string> = {
      AF: 'Air France', TK: 'Turkish Airlines', ET: 'Ethiopian Airlines',
      CM: 'Camair-Co', QC: 'Camair-Co', RW: 'RwandAir', KQ: 'Kenya Airways',
      J7: 'Afrijet', U6: 'Ural Airlines', FR: 'Ryanair', W6: 'Wizz Air',
    };
    const prefix = flightNumber.slice(0, 2);
    const hoursFromNow = Math.floor(Math.random() * 10) + 2;
    const arrival = new Date();
    arrival.setHours(arrival.getHours() + hoursFromNow);
    arrival.setMinutes(Math.floor(Math.random() * 4) * 15);
    arrival.setSeconds(0);

    return {
      flightNumber,
      airline: airlines[prefix] ?? null,
      origin: null,
      destination: null,
      arrivalAirport: null, // Pas d'aéroport confirmé → le client affichera le sélecteur
      scheduledArrival: arrival.toISOString(),
      actualArrival: null,
      status: 'scheduled',
      source: 'mock' as const,
    };
  }
}
