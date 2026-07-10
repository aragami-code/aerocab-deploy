import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service';
import { CreateFlightDto } from './dto';

type FlightInfo = {
  flightNumber: string;
  airline: string | null;
  origin: string | null;
  destination: string | null;
  destinationCountry: string | null;
  arrivalAirport: string | null;
  scheduledArrival: string | null;
  predictedArrival: string | null;
  actualArrival: string | null;
  status: 'active' | 'scheduled' | 'landed' | 'cancelled';
  aircraft: string | null;
  gate: string | null;
  source: 'api' | 'merged';
};

@Injectable()
export class FlightsService {
  private readonly logger = new Logger(FlightsService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  /**
   * Recherche les infos d'un vol — appels FR24 + AeroDataBox en parallèle, résultat fusionné.
   * apiKeys : clés résolues par l'appelant (app_settings > env). Si absent → ConfigService.
   */
  async searchFlight(flightNumber: string, apiKeys?: { fr24Token?: string; aeroDataBoxKey?: string }): Promise<FlightInfo | null> {
    const normalized  = flightNumber.replace(/\s/g, '').toUpperCase();
    const fr24Token   = apiKeys?.fr24Token    ?? this.config.get<string>('FLIGHT_RADAR_TOKEN', '');
    const aeroDataKey = apiKeys?.aeroDataBoxKey ?? this.config.get<string>('AERODATABOX_API_KEY', '');

    const [fr24Result, adbResult] = await Promise.all([
      this.searchFR24Live(normalized, fr24Token),
      this.searchAeroDataBox(normalized, aeroDataKey),
    ]);

    const merged = this.mergeFlightInfo(fr24Result, adbResult, normalized);
    if (merged) return merged;

    return null;
  }

  /**
   * CRITIQUE 3 — Normalise toute heure d'arrivée en ISO 8601 UTC strict (suffixe 'Z').
   * Les providers renvoient des formats hétérogènes :
   *   - AeroDataBox `.utc` : "2026-06-02 14:30Z" (séparateur espace → Hermes RN échoue)
   *   - AeroDataBox `.local` (fallback) : "2026-06-02 15:30+01:00" (offset présent mais espace)
   *   - FR24 `eta` : epoch (secondes ou ms) ou ISO
   * Sans normalisation, `new Date(...)` côté app (Hermes) peut renvoyer Invalid Date ou
   * interpréter une heure locale dans le fuseau de l'appareil (faux pour un vol INTERNATIONAL).
   */
  private toUtcIso(raw: string | number | null | undefined): string | null {
    if (raw === null || raw === undefined || raw === '') return null;
    // Epoch numérique (number ou chaîne 9–13 chiffres)
    if (typeof raw === 'number' || /^\d{9,13}$/.test(String(raw).trim())) {
      const n = Number(raw);
      const ms = n < 1e12 ? n * 1000 : n; // secondes vs millisecondes
      const d = new Date(ms);
      return isNaN(d.getTime()) ? null : d.toISOString();
    }
    // Chaîne : remplacer l'espace séparateur par 'T' pour un parsing strict (Hermes-safe)
    const s = String(raw).trim().replace(' ', 'T');
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }

  /** Fusionne FR24 (temps réel) + AeroDataBox (métadonnées riches) */
  private mergeFlightInfo(fr24: FlightInfo | null, adb: FlightInfo | null, normalized: string): FlightInfo | null {
    if (!fr24 && !adb) return null;

    // FR24 est autoritaire pour le statut live ; AeroDataBox pour les états au sol
    const status = fr24?.status === 'active' ? 'active' : (adb?.status ?? fr24?.status ?? 'scheduled');

    // ETA : predictedTime AeroDataBox > eta FR24 > scheduledTime AeroDataBox
    const predictedArrival = adb?.predictedArrival ?? fr24?.scheduledArrival ?? null;

    return {
      flightNumber:       fr24?.flightNumber     ?? adb?.flightNumber     ?? normalized,
      airline:            adb?.airline           ?? fr24?.airline,
      origin:             fr24?.origin           ?? adb?.origin           ?? null,
      destination:        fr24?.destination      ?? adb?.destination      ?? null,
      destinationCountry: adb?.destinationCountry                         ?? null,
      arrivalAirport:     fr24?.arrivalAirport   ?? adb?.arrivalAirport   ?? null,
      // CRITIQUE 3 — toutes les heures normalisées en UTC ISO strict
      scheduledArrival:   this.toUtcIso(adb?.scheduledArrival  ?? fr24?.scheduledArrival),
      predictedArrival:   this.toUtcIso(predictedArrival),
      actualArrival:      this.toUtcIso(adb?.actualArrival),
      status,
      aircraft:           adb?.aircraft          ?? null,
      gate:               adb?.gate              ?? null,
      source:             fr24 && adb ? 'merged' : 'api',
    };
  }

  /** FR24 live/flight-positions/full — vols actuellement en vol uniquement */
  private async searchFR24Live(normalized: string, token: string): Promise<FlightInfo | null> {
    if (!token) return null;

    try {
      const baseUrl = this.config.get('FLIGHT_RADAR_API_URL', 'https://fr24api.flightradar24.com/api');
      const res = await fetch(`${baseUrl}/live/flight-positions/full?flights=${normalized}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json',
          'Accept-Version': 'v1',
        },
      });

      if (!res.ok) {
        this.logger.warn(`[FR24] live/flight-positions/full ${res.status} pour ${normalized}`);
        return null;
      }

      const data = await res.json() as { data?: any[] };
      if (!data.data?.length) return null;

      const f = data.data[0];
      return {
        flightNumber:       f.flight ?? normalized,
        airline:            f.operating_as ?? f.painted_as ?? null,
        origin:             f.orig_iata ?? null,
        destination:        f.dest_iata ?? null,
        destinationCountry: null, // FR24 ne fournit pas le pays — complété par AeroDataBox
        arrivalAirport:     f.dest_iata ? f.dest_iata.toUpperCase() : null,
        scheduledArrival:   f.eta ?? null,
        predictedArrival:   f.eta ?? null,
        actualArrival:      null,
        status:             'active',
        aircraft:           f.type ?? null,
        gate:               null,
        source:             'api',
      };
    } catch (err) {
      this.logger.error(`[FR24] Erreur ${normalized}: ${err.message}`);
      return null;
    }
  }

  /**
   * AeroDataBox — tous états (programmé, en vol, atterri, annulé).
   * Endpoint : GET /flights/number/{flightNumber}
   * Retourne un tableau de vols du jour (prend le plus récent).
   */
  private async searchAeroDataBox(normalized: string, apiKey: string): Promise<FlightInfo | null> {
    if (!apiKey) return null;

    try {
      const adbBaseUrl = this.config.get('AERODATABOX_API_URL', 'https://api.magicapi.dev/api/v1/aedbx/aerodatabox');
      const res = await fetch(
        `${adbBaseUrl}/flights/number/${normalized}`,
        {
          headers: {
            'x-magicapi-key': apiKey,
          },
        },
      );

      if (!res.ok) {
        this.logger.warn(`[AeroDataBox] ${res.status} pour ${normalized}`);
        return null;
      }

      const data = await res.json() as any[];
      if (!Array.isArray(data) || !data.length) return null;

      // Prend le vol le plus récent (dernier dans le tableau)
      const f = data[data.length - 1];

      const rawStatus: string = f.status ?? '';
      let status: FlightInfo['status'] = 'scheduled';
      if (rawStatus === 'Active') status = 'active';
      else if (rawStatus === 'Landed') status = 'landed';
      else if (rawStatus === 'Canceled' || rawStatus === 'Cancelled') status = 'cancelled';

      const arrivalIata: string | null = f.arrival?.airport?.iata ?? null;
      const scheduledArrival: string | null =
        f.arrival?.scheduledTime?.utc ?? f.arrival?.scheduledTime?.local ?? null;
      const predictedArrival: string | null =
        f.arrival?.predictedTime?.utc ?? f.arrival?.revisedTime?.utc ?? scheduledArrival;
      const actualArrival: string | null =
        f.arrival?.actualTime?.utc ?? f.arrival?.actualTime?.local ?? null;

      this.logger.log(`[AeroDataBox] ${normalized} → status=${status} dest=${arrivalIata} predicted=${predictedArrival}`);

      return {
        flightNumber:       f.number?.replace(/\s/g, '') ?? normalized,
        airline:            f.airline?.name ?? null,
        origin:             f.departure?.airport?.iata ?? null,
        destination:        arrivalIata,
        destinationCountry: f.arrival?.airport?.countryCode ?? null,
        arrivalAirport:     arrivalIata,
        scheduledArrival,
        predictedArrival,
        actualArrival,
        status,
        aircraft:           f.aircraft?.model ?? null,
        gate:               f.departure?.gate ?? null,
        source:             'api',
      };
    } catch (err) {
      this.logger.error(`[AeroDataBox] Erreur ${normalized}: ${err.message}`);
      return null;
    }
  }

  /**
   * Infos complètes + position live d'un vol (pour tracking passager/driver)
   * Retourne une structure imbriquée compatible avec FlightDetailsScreen (driver).
   */
  async getLiveFlightDetails(flightNumber: string, apiKeys?: { fr24Token?: string; aeroDataBoxKey?: string }) {
    const normalized = flightNumber.replace(/\s/g, '').toUpperCase();
    const token = apiKeys?.fr24Token ?? this.config.get<string>('FLIGHT_RADAR_TOKEN', '');
    if (!token) return null;

    const [summary, live] = await Promise.all([
      this.searchFlight(normalized, apiKeys),
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
        gate:      summary.gate ?? null,
      },
      arrival: {
        iata:              summary.destination ?? null,
        airport:           summary.destination ?? null,
        countryCode:       summary.destinationCountry ?? null,
        scheduled:         summary.scheduledArrival ?? null,
        predicted:         summary.predictedArrival ?? null,
        actual:            summary.actualArrival ?? null,
        estimated:         summary.predictedArrival ?? summary.scheduledArrival ?? null,
        delay:             0,
        terminal:          null,
        baggage:           null,
      },
      status:   summary.status,
      aircraft: summary.aircraft ?? null,
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

}
