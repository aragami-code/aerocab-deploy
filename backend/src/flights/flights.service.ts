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
   * Search flight info from AviationStack API (or mock in dev)
   */
  async searchFlight(flightNumber: string) {
    const normalized = flightNumber.replace(/\s/g, '').toUpperCase();
    const apiKey = this.config.get<string>('AVIATIONSTACK_API_KEY');

    if (!apiKey) {
      // Mock response for development
      return this.getMockFlightInfo(normalized);
    }

    try {
      const response = await fetch(
        `http://api.aviationstack.com/v1/flights?access_key=${apiKey}&flight_iata=${normalized}`,
      );
      const data = (await response.json()) as {
        data?: Array<{
          flight: { iata: string };
          airline: { name: string };
          departure: { airport: string; iata: string };
          arrival: { airport: string; iata: string; scheduled: string; estimated: string };
          flight_status: string;
        }>;
      };

      if (!data.data || data.data.length === 0) {
        return null;
      }

      const flight = data.data[0];
      return {
        flightNumber: flight.flight.iata,
        airline: flight.airline.name,
        origin: `${flight.departure.airport} (${flight.departure.iata})`,
        destination: `${flight.arrival.airport} (${flight.arrival.iata})`,
        arrivalAirport: flight.arrival.iata?.trim().toUpperCase() ?? 'DLA',
        scheduledArrival: flight.arrival.scheduled || flight.arrival.estimated,
        status: flight.flight_status,
        source: 'api' as const,
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
        airline: dto.airline || null,
        origin: dto.origin || null,
        destination: dto.destination || null,
        arrivalAirport: dto.arrivalAirport,
        scheduledArrival: new Date(dto.scheduledArrival),
        source: dto.source || 'manual',
      },
    });
  }

  /**
   * Get all flights for a user (most recent first)
   */
  async getUserFlights(userId: string) {
    return this.prisma.flight.findMany({
      where: { userId },
      orderBy: { scheduledArrival: 'desc' },
    });
  }

  /**
   * Get a specific flight by ID
   */
  async getFlightById(flightId: string) {
    const flight = await this.prisma.flight.findUnique({
      where: { id: flightId },
      include: {
        user: {
          select: { id: true, name: true, phone: true },
        },
      },
    });

    if (!flight) {
      throw new NotFoundException('Vol non trouve');
    }

    return flight;
  }

  /**
   * Get the active flight for a user (next upcoming)
   */
  async getActiveFlight(userId: string) {
    return this.prisma.flight.findFirst({
      where: {
        userId,
        scheduledArrival: { gte: new Date() },
      },
      orderBy: { scheduledArrival: 'asc' },
    });
  }

  /**
   * Delete a flight
   */
  async deleteFlight(userId: string, flightId: string) {
    const flight = await this.prisma.flight.findFirst({
      where: { id: flightId, userId },
    });

    if (!flight) {
      throw new NotFoundException('Vol non trouve');
    }

    await this.prisma.flight.delete({ where: { id: flightId } });
    return { message: 'Vol supprime' };
  }

  /**
   * GET /flights/live/:flightNumber
   * Données complètes du vol : infos statiques + position temps réel
   */
  async getLiveFlightDetails(flightNumber: string) {
    const normalized = flightNumber.replace(/\s/g, '').toUpperCase();
    const apiKey = this.config.get<string>('AVIATIONSTACK_API_KEY');

    if (!apiKey) return this.getMockLiveDetails(normalized);

    try {
      const res = await fetch(
        `http://api.aviationstack.com/v1/flights?access_key=${apiKey}&flight_iata=${normalized}`,
      );
      const data = (await res.json()) as { data?: any[] };
      if (!data.data?.length) return null;

      const f = data.data[0];
      const flightIcao: string | null = f.flight?.icao ?? null;

      // Position live : d'abord AviationStack, sinon OpenSky (gratuit, sans clé)
      let live: {
        latitude: number; longitude: number; altitude: number;
        speedHorizontal: number; direction: number; isGround: boolean; updatedAt: string;
      } | null = null;

      if (f.live && f.live.latitude != null) {
        live = {
          latitude: f.live.latitude,
          longitude: f.live.longitude,
          altitude: f.live.altitude,
          speedHorizontal: f.live.speed_horizontal,
          direction: f.live.direction,
          isGround: f.live.is_ground,
          updatedAt: f.live.updated,
        };
      } else if (flightIcao) {
        live = await this.getOpenSkyPosition(flightIcao);
      }

      return {
        flightNumber: f.flight?.iata ?? normalized,
        flightIcao,
        status: f.flight_status ?? null,

        airline: {
          name: f.airline?.name ?? null,
          iata: f.airline?.iata ?? null,
          icao: f.airline?.icao ?? null,
        },
        aircraft: {
          type: f.aircraft?.iata ?? null,
          icao: f.aircraft?.icao ?? null,
          registration: f.aircraft?.registration ?? null,
        },
        departure: {
          airport: f.departure?.airport ?? null,
          iata: f.departure?.iata ?? null,
          terminal: f.departure?.terminal ?? null,
          gate: f.departure?.gate ?? null,
          scheduled: f.departure?.scheduled ?? null,
          actual: f.departure?.actual ?? null,
          delay: f.departure?.delay ?? 0,
        },
        arrival: {
          airport: f.arrival?.airport ?? null,
          iata: f.arrival?.iata ?? null,
          terminal: f.arrival?.terminal ?? null,
          baggage: f.arrival?.baggage ?? null,
          scheduled: f.arrival?.scheduled ?? null,
          estimated: f.arrival?.estimated ?? null,
          actual: f.arrival?.actual ?? null,
          delay: f.arrival?.delay ?? 0,
        },
        live,
      };
    } catch {
      return null;
    }
  }

  /**
   * Récupère la position live d'un vol via OpenSky Network (gratuit, sans clé)
   * callsign = code ICAO du vol, ex: "AFR946"
   */
  private async getOpenSkyPosition(callsign: string): Promise<{
    latitude: number; longitude: number; altitude: number;
    speedHorizontal: number; direction: number; isGround: boolean; updatedAt: string;
  } | null> {
    try {
      const res = await fetch(
        `https://opensky-network.org/api/states/all?callsign=${callsign}`,
        { headers: { 'Accept': 'application/json' } },
      );
      if (!res.ok) return null;

      const data = (await res.json()) as { states?: any[][] };
      if (!data.states?.length) return null;

      // OpenSky renvoie tous les vols avec ce callsign (souvent un seul)
      // Colonnes: [icao24, callsign, origin_country, time_position, last_contact,
      //            longitude(5), latitude(6), baro_altitude(7), on_ground(8),
      //            velocity(9 m/s), true_track(10 °), vertical_rate(11), ...]
      const state = data.states.find(
        (s) => s[1]?.trim().toUpperCase() === callsign.toUpperCase(),
      ) ?? data.states[0];

      const longitude   = state[5] as number | null;
      const latitude    = state[6] as number | null;
      const baroAlt     = state[7] as number | null;   // mètres
      const onGround    = state[8] as boolean;
      const velocityMs  = state[9] as number | null;   // m/s → km/h
      const trueTrack   = state[10] as number | null;  // degrés
      const lastContact = state[4] as number;           // timestamp UNIX

      if (latitude == null || longitude == null) return null;

      return {
        latitude,
        longitude,
        altitude: baroAlt ?? 0,
        speedHorizontal: velocityMs != null ? Math.round(velocityMs * 3.6) : 0,
        direction: trueTrack ?? 0,
        isGround: onGround,
        updatedAt: new Date(lastContact * 1000).toISOString(),
      };
    } catch {
      return null;
    }
  }

  private getMockLiveDetails(flightNumber: string) {
    const prefix = flightNumber.slice(0, 2);
    const airlines: Record<string, { name: string; iata: string }> = {
      AF: { name: 'Air France', iata: 'AF' },
      TK: { name: 'Turkish Airlines', iata: 'TK' },
      ET: { name: 'Ethiopian Airlines', iata: 'ET' },
      CM: { name: 'Camair-Co', iata: 'QC' },
    };
    const airline = airlines[prefix] ?? { name: 'Unknown Airline', iata: prefix };
    const dep = new Date(); dep.setHours(dep.getHours() - 5);
    const arr = new Date(); arr.setHours(arr.getHours() + 2);
    return {
      flightNumber,
      flightIcao: null,
      status: 'active',
      airline: { name: airline.name, iata: airline.iata, icao: null },
      aircraft: { type: 'B77W', icao: 'B77W', registration: 'F-GSQI' },
      departure: {
        airport: 'Paris Charles de Gaulle', iata: 'CDG', terminal: '2E',
        gate: 'K45', scheduled: dep.toISOString(), actual: dep.toISOString(), delay: 0,
      },
      arrival: {
        airport: 'Douala International', iata: 'DLA', terminal: 'A',
        baggage: 'B3', scheduled: arr.toISOString(), estimated: arr.toISOString(), actual: null, delay: 0,
      },
      live: {
        latitude: 10.5, longitude: 5.2, altitude: 11278,
        speedHorizontal: 890, direction: 175, isGround: false,
        updatedAt: new Date().toISOString(),
      },
    };
  }

  /**
   * Mock flight data for development
   */
  private getMockFlightInfo(flightNumber: string) {
    const airlines: Record<string, string> = {
      AF: 'Air France',
      TK: 'Turkish Airlines',
      ET: 'Ethiopian Airlines',
      CM: 'Camair-Co',
      QC: 'Camair-Co',
      RW: 'RwandAir',
      KQ: 'Kenya Airways',
      SA: 'South African Airways',
      W3: 'Arik Air',
    };

    const prefix = flightNumber.slice(0, 2);
    const airline = airlines[prefix] || 'Unknown Airline';

    // Generate a realistic arrival time (2-12 hours from now)
    const hoursFromNow = Math.floor(Math.random() * 10) + 2;
    const arrival = new Date();
    arrival.setHours(arrival.getHours() + hoursFromNow);
    arrival.setMinutes(Math.floor(Math.random() * 4) * 15);
    arrival.setSeconds(0);

    const airports = ['DLA', 'NSI'];
    const arrivalAirport = airports[Math.floor(Math.random() * airports.length)];
    const airportNames: Record<string, string> = {
      DLA: 'Douala International Airport',
      NSI: 'Yaounde Nsimalen International Airport',
    };

    const origins = [
      'Paris Charles de Gaulle (CDG)',
      'Istanbul (IST)',
      'Addis Ababa (ADD)',
      'Nairobi (NBO)',
      'Lagos (LOS)',
      'Casablanca (CMN)',
    ];

    return {
      flightNumber,
      airline,
      origin: origins[Math.floor(Math.random() * origins.length)],
      destination: `${airportNames[arrivalAirport]} (${arrivalAirport})`,
      arrivalAirport,
      scheduledArrival: arrival.toISOString(),
      status: 'scheduled',
      source: 'api' as const,
    };
  }
}
