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
