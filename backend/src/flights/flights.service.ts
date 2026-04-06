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
   * Search flight info using AeroDataBox (primary) or local mock
   */
  async searchFlight(flightNumber: string) {
    const normalized = flightNumber.replace(/\s/g, '').toUpperCase();
    const aeroDataBoxKey = this.config.get<string>('AERODATABOX_API_KEY');

    if (!aeroDataBoxKey) {
      // Mock response for development if no API key is provided
      console.warn(`[FlightsService] No AeroDataBox API key found. Returning mock data for ${normalized}.`);
      return this.getMockFlightInfo(normalized);
    }

    try {
      // We use the existing getAeroDataBoxFlight method for consistency
      const flight = await this.getAeroDataBoxFlight(normalized, aeroDataBoxKey);

      if (!flight) {
        return null;
      }

      return {
        flightNumber: flight.flightNumber,
        airline: flight.airline.name,
        origin: flight.departure.airport 
          ? `${flight.departure.airport} (${flight.departure.iata})`
          : flight.departure.iata,
        destination: flight.arrival.airport
          ? `${flight.arrival.airport} (${flight.arrival.iata})`
          : flight.arrival.iata,
        arrivalAirport: flight.arrival.iata?.trim().toUpperCase() ?? 'DLA',
        scheduledArrival: flight.arrival.scheduled || flight.arrival.estimated,
        status: flight.status,
        source: 'api' as const,
      };
    } catch (error) {
      console.error(`[FlightsService] Error searching flight ${normalized} via AeroDataBox:`, error);
      return null;
    }
  }

  /* AviationStack code commented out as requested
  async searchFlightAviationStack(flightNumber: string) {
    const normalized = flightNumber.replace(/\s/g, '').toUpperCase();
    const apiKey = this.config.get<string>('AVIATIONSTACK_API_KEY');

    if (!apiKey) return this.getMockFlightInfo(normalized);

    try {
      const response = await fetch(
        `http://api.aviationstack.com/v1/flights?access_key=${apiKey}&flight_iata=${normalized}`,
      );
      const data = await response.json();
      if (!data.data || data.data.length === 0) return null;

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
  */

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
   * Infos statiques via AeroDataBox + position live via OpenSky
   */
  async getLiveFlightDetails(flightNumber: string) {
    const normalized = flightNumber.replace(/\s/g, '').toUpperCase();
    const aeroDataBoxKey = this.config.get<string>('AERODATABOX_API_KEY');

    if (!aeroDataBoxKey) return null;

    const staticData = await this.getAeroDataBoxFlight(normalized, aeroDataBoxKey);
    if (!staticData) return null;

    // Position live via OpenSky (gratuit, sans clé)
    const live = staticData.callSign
      ? await this.getOpenSkyPosition(staticData.callSign)
      : null;

    const { callSign, ...rest } = staticData;
    return { ...rest, live };
  }

  /**
   * Récupère les infos complètes d'un vol via AeroDataBox (RapidAPI)
   */
  private async getAeroDataBoxFlight(flightNumber: string, apiKey: string) {
    try {
      const res = await fetch(
        `https://aerodatabox.p.rapidapi.com/flights/number/${flightNumber}`,
        {
          headers: {
            'X-RapidAPI-Key': apiKey,
            'X-RapidAPI-Host': 'aerodatabox.p.rapidapi.com',
          },
        },
      );
      if (!res.ok) return null;

      const data = await res.json() as any[];
      if (!Array.isArray(data) || !data.length) return null;

      // Prioriser le vol en cours, sinon scheduled
      const f = data.find((d: any) => d.status === 'EnRoute')
             ?? data.find((d: any) => d.status === 'Departed')
             ?? data.find((d: any) => d.status === 'Scheduled')
             ?? data[0];

      const statusMap: Record<string, string> = {
        EnRoute: 'active', Departed: 'active', Arrived: 'landed',
        Scheduled: 'scheduled', Canceled: 'cancelled', Diverted: 'diverted',
      };

      const toIso = (t?: string | null) => t ? new Date(t).toISOString() : null;

      return {
        flightNumber: f.number ?? flightNumber,
        flightIcao: f.callSign ?? null,
        callSign: f.callSign ?? null,
        status: statusMap[f.status] ?? 'scheduled',
        airline: {
          name: f.airline?.name ?? null,
          iata: f.airline?.iata ?? null,
          icao: f.airline?.icao ?? null,
        },
        aircraft: {
          type: f.aircraft?.model ?? null,
          icao: null,
          registration: f.aircraft?.reg ?? null,
        },
        departure: {
          airport: f.departure?.airport?.name ?? null,
          iata: f.departure?.airport?.iata ?? null,
          terminal: f.departure?.terminal ?? null,
          gate: f.departure?.gate ?? null,
          scheduled: toIso(f.departure?.scheduledTime?.utc),
          actual: toIso(f.departure?.actualTime?.utc),
          delay: f.departure?.delay ?? 0,
        },
        arrival: {
          airport: f.arrival?.airport?.name ?? null,
          iata: f.arrival?.airport?.iata ?? null,
          terminal: f.arrival?.terminal ?? null,
          baggage: f.arrival?.baggageBelt ?? null,
          scheduled: toIso(f.arrival?.scheduledTime?.utc),
          estimated: toIso(f.arrival?.estimatedTime?.utc),
          actual: toIso(f.arrival?.actualTime?.utc),
          delay: f.arrival?.delay ?? 0,
        },
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
