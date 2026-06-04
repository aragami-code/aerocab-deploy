import { Injectable, NotFoundException, InternalServerErrorException, BadRequestException, ForbiddenException, ConflictException, Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { PointsService } from '../points/points.service';
import { SettingsService } from '../settings/settings.service';
import { PromosService } from '../promos/promos.service';
import { PricingService } from './pricing.service';
import { DispatchService } from './dispatch.service';
import { RidesGateway } from './rides.gateway';
import { RedisService } from '../redis/redis.service';
import { Prisma } from '@prisma/client';

// Valeurs par défaut (écrasées par la DB via SettingsService)
const DEFAULT_BASE_PRICE_PER_KM = 250;
const DEFAULT_VEHICLE_COEFFICIENTS: Record<string, number> = {
  eco: 1.0, eco_plus: 1.2, standard: 1.4, confort: 2.0, confort_plus: 2.5,
};
const DEFAULT_VEHICLE_MIN_PRICES: Record<string, number> = {
  eco: 3000, eco_plus: 3500, standard: 5000, confort: 8000, confort_plus: 12000,
};

// 0.B17 — Capacité par défaut (override par AppSetting vehicle_capacity)
const DEFAULT_VEHICLE_SEATS: Record<string, number> = {
  eco: 4, eco_plus: 4, standard: 5, confort: 5, confort_plus: 7,
};

import { FlightsService } from '../flights/flights.service';
import { AuditService } from '../audit/audit.service';
import { ForfaitsService } from '../forfaits/forfaits.service';
import { Forfait } from '@prisma/client';
import { ZonesService } from '../zones/zones.service';
import { PaymentIntentService } from '../payments/payment-intent.service';
import { PayoutService } from '../payments/payout.service';
import { CashCommissionService } from '../payments/cash-commission.service';
import { ReceiptService } from '../payments/receipt.service';
import { UsersService } from '../users/users.service';
import { resolveCommissionRate } from './commission-resolver';

// Méthodes de paiement direct (F4) — pas de débit wallet points
const F4_PAYMENT_METHODS = ['orange_money_cm', 'mtn_cm', 'card', 'cash'];

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private points: PointsService,
    private settingsService: SettingsService,
    private promosService: PromosService,
    private ridesGateway: RidesGateway,
    private pricingService: PricingService,
    private dispatchService: DispatchService,
    private config: ConfigService,
    private flightsService: FlightsService,
    private audit: AuditService,
    private redis: RedisService,
    private readonly forfaitsService: ForfaitsService,
    private readonly zonesService: ZonesService,
    private readonly paymentIntentSvc: PaymentIntentService,
    private readonly payoutSvc: PayoutService,
    private readonly cashCommissionSvc: CashCommissionService,
    private readonly receiptSvc: ReceiptService,
    private readonly usersService: UsersService,
  ) {}

  /** 0.B17 — Capacité d'un type de véhicule depuis AppSetting vehicle_capacity (JSON). */
  private async getVehicleSeats(vehicleType: string, country?: string | null): Promise<number> {
    try {
      const raw = await this.settingsService.getForCountry('vehicle_capacity', country ?? null, '');
      if (raw) {
        const capacity: Record<string, number> = JSON.parse(raw);
        if (capacity[vehicleType] !== undefined) return capacity[vehicleType];
      }
    } catch { /* fallback */ }
    return DEFAULT_VEHICLE_SEATS[vehicleType] ?? 4;
  }

  /** Recherche le vol via FlightRadar24 et le sauvegarde en DB si introuvable */
  private async fetchAndSaveFlight(passengerId: string, flightNumber: string) {
    try {
      const f = await this.flightsService.searchFlight(flightNumber);
      if (!f) return null;

      return this.prisma.flight.create({
        data: {
          userId: passengerId,
          flightNumber: flightNumber.toUpperCase(),
          airline: f.airline || null,
          origin: f.origin || null,
          destination: f.destination || null,
          arrivalAirport: (f.arrivalAirport || 'DLA').toUpperCase(),
          scheduledArrival: new Date(f.scheduledArrival),
          actualArrival: null,
          source: 'api',
        },
      });
    } catch (e) {
      this.logger.error(`[BookingsService] Error in fetchAndSaveFlight: ${e.message}`);
      return null;
    }
  }

  // Sélectionne le meilleur driver selon le mode actif (proximité ou rating)
  private async findBestDriver(
    departureAirport: string, 
    excludeDriverId?: string, 
    vehicleCategory?: string,
    customCoords?: { lat: number; lng: number }
  ) {
    const proximityEnabled = await this.settingsService.isProximityAssignmentEnabled();
    const excludeClause = excludeDriverId ? Prisma.sql`AND id != ${excludeDriverId}::uuid` : Prisma.sql``;
    const categoryClause = vehicleCategory ? Prisma.sql`AND vehicle_category = ${vehicleCategory}` : Prisma.sql``;

    if (proximityEnabled) {
      const coords = customCoords || await this.resolveAirportCoords(departureAirport);
      // 2.B2 — Guard: rejeter coords NaN/Infinity avant $queryRaw (comportement SQL indéfini sinon)
      if (
        coords &&
        Number.isFinite(coords.lat) && Number.isFinite(coords.lng) &&
        coords.lat >= -90 && coords.lat <= 90 &&
        coords.lng >= -180 && coords.lng <= 180
      ) {
        const radiusRaw = await this.settingsService.get('proximity_radius_km', '20');
        const proximityRadiusKm = parseFloat(radiusRaw) || 20;
        // Haversine en SQL — retourne le driver le plus proche dans le rayon
        const nearby = await this.prisma.$queryRaw<{ id: string; distance_km: number }[]>(
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
              AND latitude IS NOT NULL
              AND longitude IS NOT NULL
              ${excludeClause}
              ${categoryClause}
            HAVING 6371 * acos(
                LEAST(1.0,
                  cos(radians(${coords.lat})) * cos(radians(latitude))
                  * cos(radians(longitude) - radians(${coords.lng}))
                  + sin(radians(${coords.lat})) * sin(radians(latitude))
                )
              ) <= ${proximityRadiusKm}
            ORDER BY distance_km ASC
            LIMIT 1
          `,
        );

        if (nearby.length > 0) {
          return this.prisma.driverProfile.findUnique({
            where: { id: nearby[0].id },
            include: { user: { select: { id: true, name: true } } },
          });
        }
        // Aucun driver dans le rayon → fallback par rating
      }
    }

    // Mode par défaut : meilleur rating
    return this.prisma.driverProfile.findFirst({
      where: {
        status: 'approved',
        isAvailable: true,
        ...(excludeDriverId ? { id: { not: excludeDriverId } } : {}),
        ...(vehicleCategory ? { vehicleCategory } : {}),
      },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { ratingAvg: 'desc' },
    });
  }

  // ─── Méthodes de calcul partagées ────────────────────────────────────────

  /** 0.B3 — Résout les coordonnées d'un aéroport depuis la table airports DB. */
  private async resolveAirportCoords(iataCode: string | undefined): Promise<{ lat: number; lng: number } | null> {
    if (!iataCode) return null;
    try {
      const ap = await this.prisma.airport.findUnique({
        where: { iataCode: iataCode.toUpperCase() },
        select: { latitude: true, longitude: true },
      });
      if (ap?.latitude && ap?.longitude) {
        return { lat: Number(ap.latitude), lng: Number(ap.longitude) };
      }
    } catch { /* ignore */ }
    return null;
  }

  private async computeDistanceKm(dto: Partial<CreateBookingDto>): Promise<number> {
    // Use road distance from frontend when available (more accurate than Haversine for urban areas)
    if (dto.roadDistanceKm && dto.roadDistanceKm > 0) {
      return dto.roadDistanceKm;
    }

    const airportCoords = await this.resolveAirportCoords(dto.departureAirport);
    const isDeparture = dto.type === 'DEPARTURE';

    // Priorité absolue aux coordonnées réelles transmises par le mobile (Google Places)
    // Fallback sur les coordonnées de l'aéroport (DB ou constante) si le GPS est manquant
    const startCoords = isDeparture
      ? (dto.pickupLat && dto.pickupLng ? { lat: dto.pickupLat, lng: dto.pickupLng } : null)
      : (dto.pickupLat && dto.pickupLng
          ? { lat: dto.pickupLat, lng: dto.pickupLng }
          : (airportCoords ?? null));

    const endCoords = isDeparture
      ? (dto.destLat && dto.destLng
          ? { lat: dto.destLat, lng: dto.destLng }
          : (airportCoords ?? null))
      : (dto.destLat && dto.destLng ? { lat: dto.destLat, lng: dto.destLng } : null);

    // Cas 26 : log si coords semblent incorrectes (0,0 ou hors Afrique)
    const isValidCoord = (lat: number, lng: number) =>
      Math.abs(lat) > 0.001 || Math.abs(lng) > 0.001;
    if (startCoords && !isValidCoord(startCoords.lat, startCoords.lng)) {
      this.logger.warn(`[Coords] startCoords invalides (0,0) pour departureAirport=${dto.departureAirport} type=${dto.type}`);
    }
    if (endCoords && !isValidCoord(endCoords.lat, endCoords.lng)) {
      this.logger.warn(`[Coords] endCoords invalides (0,0) pour departureAirport=${dto.departureAirport} type=${dto.type}`);
    }

    if (startCoords?.lat && startCoords?.lng && endCoords?.lat && endCoords?.lng) {
      const R = 6371;
      const dLat = (endCoords.lat - startCoords.lat) * Math.PI / 180;
      const dLon = (endCoords.lng - startCoords.lng) * Math.PI / 180;
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(startCoords.lat * Math.PI / 180) * Math.cos(endCoords.lat * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
      const haversineKm = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      // Road correction: actual road distance in African cities is ~2.2× Haversine straight-line
      return haversineKm * 2.2;
    }

    throw new BadRequestException(
      "Impossible de calculer la distance du trajet. Veuillez vérifier vos adresses de départ et de destination."
    );
  }

  /**
   * F5.3 — Tente d'envoyer le reçu et enqueue un job pour retry si échec.
   * Le job sera repris par `BookingsScheduler.processReceiptJobs` toutes les minutes.
   */
  private async enqueueReceiptJob(bookingId: string): Promise<void> {
    try {
      await this.receiptSvc.sendRideReceipt(bookingId);
      // Succès → marquer le job comme envoyé (si existait) ou ne rien faire
      await this.prisma.receiptJob.upsert({
        where: { bookingId },
        update: { status: 'sent', updatedAt: new Date() },
        create: { bookingId, status: 'sent', attempts: 1 },
      }).catch(() => { /* table déjà à jour, pas critique */ });
    } catch (err: any) {
      // Échec → crée/met à jour un job pending pour retry
      this.logger.warn(`[Receipt] first send failed booking=${bookingId}: ${err?.message}`);
      await this.prisma.receiptJob.upsert({
        where: { bookingId },
        update: { status: 'pending', attempts: { increment: 1 }, lastError: err?.message?.slice(0, 500), updatedAt: new Date() },
        create: { bookingId, status: 'pending', attempts: 1, lastError: err?.message?.slice(0, 500) },
      }).catch((e) => this.logger.error(`[Receipt] upsert job failed ${bookingId}: ${e?.message}`));
    }
  }

  /**
   * F5.9 — Calcule le montant de commission AeroCab sur une course (FCFA arrondi).
   * Cascade : forfait.companyPercent → settings.commission_rate_pct → tariffs.commissionRate → 15%
   */
  private async computeCommissionAmount(
    grossAmount: number,
    vehicleType: string,
    forfaitId: string | null,
    operatingCountry: string | null,
  ): Promise<number> {
    let forfaitPercent: number | null = null;
    if (forfaitId) {
      const forfait = await this.forfaitsService.findOne(forfaitId).catch(() => null);
      forfaitPercent = forfait?.companyPercent ?? null;
    }
    const rideTariffs = await this.settingsService.getTariffsByCountry(operatingCountry);
    const vehicleRate = rideTariffs.vehicles?.[vehicleType]?.commissionRate ?? null;
    const settingRaw = await this.settingsService.getForCountry('commission_rate_pct', operatingCountry, '');
    const settingRate = settingRaw ? parseFloat(settingRaw) / 100 : null;
    const tariffsRate = rideTariffs.commissionRate ?? null;
    const rate = resolveCommissionRate({ forfaitPercent, vehicleRate, settingRate, tariffsRate });
    return Math.round(grossAmount * rate * 100) / 100;
  }

  /** Taux de commission effectif (0–1) pour un nouveau booking, country-aware. */
  private async resolveBookingCommissionRate(
    vehicleType: string, forfaitId: string | null, operatingCountry: string | null,
  ): Promise<number> {
    let forfaitPercent: number | null = null;
    if (forfaitId) {
      const forfait = await this.forfaitsService.findOne(forfaitId).catch(() => null);
      forfaitPercent = forfait?.companyPercent ?? null;
    }
    const rideTariffs = await this.settingsService.getTariffsByCountry(operatingCountry);
    const vehicleRate = rideTariffs.vehicles?.[vehicleType]?.commissionRate ?? null;
    const settingRaw = await this.settingsService.getForCountry('commission_rate_pct', operatingCountry, '');
    const settingRate = settingRaw ? parseFloat(settingRaw) / 100 : null;
    return resolveCommissionRate({ forfaitPercent, vehicleRate, settingRate, tariffsRate: rideTariffs.commissionRate ?? null });
  }

  /**
   * P2.1 — Géocodage inversé asynchrone du pickupAddress après création du booking.
   * Appelle Google Geocoding, met à jour le booking si trouvé, et émet une socket
   * d'update au passager pour rafraîchir l'affichage. Fire-and-forget : ne bloque
   * jamais la réponse POST /bookings.
   */
  private async geocodeBookingPickupAsync(
    bookingId: string,
    passengerId: string,
    lat: number,
    lng: number,
  ): Promise<void> {
    const mapsKey = await this.settingsService.get('google_maps_key')
      || this.config.get<string>('GOOGLE_MAPS_API_KEY', '');
    if (!mapsKey) return;

    let resolved: string | null = null;
    try {
      const geoRes = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&language=fr&key=${mapsKey}`,
      );
      const geoData = await geoRes.json() as any;
      if (geoData.status === 'OK' && geoData.results?.[0]) {
        const comps = geoData.results[0].address_components as any[];
        const neighborhood = comps?.find((c: any) =>
          c.types.includes('neighborhood') || c.types.includes('sublocality')
        )?.long_name;
        const route = comps?.find((c: any) => c.types.includes('route'))?.long_name;
        resolved = neighborhood || route || geoData.results[0].formatted_address;
      }
    } catch { /* silent : on garde le fallback brut */ }

    if (!resolved) return;

    try {
      await this.prisma.booking.update({
        where: { id: bookingId },
        data: { pickupAddress: resolved },
      });
      this.ridesGateway.server
        .to(`passenger:${passengerId}`)
        .emit('booking:pickup_address_updated', { id: bookingId, pickupAddress: resolved });
    } catch (e: any) {
      this.logger.warn(`[Geocoding] update booking ${bookingId} failed: ${e?.message}`);
    }
  }

  /** Prix en FCFA basé sur les tarifs DB (avec fallback sur les défauts)
   *  Formule : startupFee + (distanceKm × basePricePerKm × coeff), min = minFare
   *  Le startupFee inclut les `startupMinutes` premières minutes de trajet.
   */
  /** Version de computeBasePriceForVehicle acceptant des tarifs déjà chargés */
  private computeBasePriceForVehicleWithTariffs(distanceKm: number, vehicleType: string, tariffs: import('../settings/settings.service').TariffsConfig): Promise<number> {
    const vehicle = tariffs.vehicles[vehicleType];
    const basePricePerKm = vehicle?.basePricePerKm ?? tariffs.basePricePerKm ?? DEFAULT_BASE_PRICE_PER_KM;
    const coeff          = vehicle?.coefficient    ?? DEFAULT_VEHICLE_COEFFICIENTS[vehicleType] ?? 1.0;
    const minFare        = vehicle?.minFare        ?? DEFAULT_VEHICLE_MIN_PRICES[vehicleType]   ?? 3000;
    const startupFee     = tariffs.startupFee ?? 500;
    const distancePrice  = Math.round(distanceKm * basePricePerKm * coeff);
    return Promise.resolve(Math.max(minFare, startupFee + distancePrice));
  }

  // ─── Fin méthodes partagées ───────────────────────────────────────────────

  async createBooking(passengerId: string, dto: CreateBookingDto) {
    try {
    // Garde profil : un passager sans numéro vérifié ne peut pas réserver.
    const passenger = await this.prisma.user.findUnique({ where: { id: passengerId }, select: { phone: true } });
    if (!passenger?.phone) {
      throw new ForbiddenException({ code: 'PROFILE_INCOMPLETE', message: 'Vérifiez votre numéro de téléphone avant de réserver.' });
    }
    // P1.1 — Validation early du vehicleType contre la liste dynamique des véhicules
    // configurés. Évite d'exécuter tout le pipeline tarifaire pour rejeter un type invalide.
    const globalTariffs = await this.settingsService.getTariffs();
    const allowedVehicleTypes = Object.keys(globalTariffs.vehicles ?? {})
      .filter((k) => globalTariffs.vehicles[k]?.isActive !== false);
    if (!allowedVehicleTypes.includes(dto.vehicleType)) {
      throw new BadRequestException(
        `Type de véhicule "${dto.vehicleType}" non disponible. Choix possibles : ${allowedVehicleTypes.join(', ')}.`,
      );
    }

    // 2. Guard : workflow activé/désactivé par l'admin
    const workflowKey = dto.type === 'ARRIVAL' ? 'workflow_arrival_enabled'
      : dto.type === 'DEPARTURE' ? 'workflow_departure_enabled'
      : 'workflow_international_enabled';
    const workflowEnabled = await this.settingsService.getForCountry(workflowKey, dto.countryCode?.toUpperCase() ?? null, 'true');
    if (workflowEnabled === 'false') {
      const labels: Record<string, string> = {
        ARRIVAL: 'Arrivée aéroport',
        DEPARTURE: 'Départ vers aéroport',
        INTERNATIONAL: 'Réservation internationale',
      };
      throw new BadRequestException(`Le service "${labels[dto.type] ?? dto.type}" est indisponible pour le moment. Veuillez réessayer ultérieurement.`);
    }

    // 3. Guard pass d'accès passager
    const passEnabled = await this.settingsService.get('access_pass_enabled', 'false');
    if (passEnabled === 'true') {
      const passenger = await this.prisma.user.findUnique({
        where: { id: passengerId },
        select: { passExpiresAt: true, passType: true },
      });
      const graceDaysRaw = await this.settingsService.get('access_pass_grace_days', '2');
      const graceDays = parseInt(graceDaysRaw, 10) || 0;
      const now = new Date();
      const expiry  = passenger?.passExpiresAt;
      const graceEnd = expiry ? new Date(expiry.getTime() + graceDays * 86400000) : null;
      const hasValidPass = !!expiry && expiry > now;
      const inGrace      = !hasValidPass && !!graceEnd && graceEnd > now;
      if (!hasValidPass && !inGrace) {
        throw new BadRequestException('Votre pass d\'accès AeroCab est expiré ou inexistant. Veuillez l\'activer dans l\'application.');
      }
    }

    // 4. Guard : pas de double réservation active
    const existingActive = await this.prisma.booking.findFirst({
      where: { passengerId, status: { in: ['pending', 'confirmed', 'arrived_at_airport', 'in_progress', 'scheduled'] } },
    });
    if (existingActive) {
      throw new BadRequestException('Vous avez déjà une course en cours. Annulez-la avant d\'en créer une nouvelle.');
    }

    // 5. Réservation programmée — validation date
    const scheduledAt = dto.scheduledAt ? new Date(dto.scheduledAt) : null;
    const SCHEDULE_MIN_ADVANCE_MIN = 30; // min 30 min à l'avance
    const SCHEDULE_MAX_ADVANCE_DAYS = 7; // max 7 jours
    if (scheduledAt) {
      const nowMs = Date.now();
      const diffMin = (scheduledAt.getTime() - nowMs) / 60000;
      if (diffMin < SCHEDULE_MIN_ADVANCE_MIN) {
        throw new BadRequestException(`La réservation programmée doit être au moins ${SCHEDULE_MIN_ADVANCE_MIN} min à l'avance`);
      }
      if (diffMin > SCHEDULE_MAX_ADVANCE_DAYS * 24 * 60) {
        throw new BadRequestException(`La réservation programmée ne peut pas dépasser ${SCHEDULE_MAX_ADVANCE_DAYS} jours`);
      }
    }

    // 6. Distance et prix de base
    const isDeparture = dto.type === 'DEPARTURE';
    const distanceKm = await this.computeDistanceKm(dto);

    // 5.B3 — Guard distance lu depuis AppSetting (max_route_distance_km, défaut 80km)
    const maxRouteRaw = await this.settingsService.get('max_route_distance_km', '80');
    const maxRouteKm = parseFloat(maxRouteRaw) || 80;
    if (dto.type !== 'INTERNATIONAL' && distanceKm > maxRouteKm) {
      throw new BadRequestException('DISTANCE_EXCEEDED');
    }

    // P3 — Refus précoce : ARRIVAL et DEPARTURE EXIGENT un aéroport IATA valide.
    // Le sentinel 'INTERNATIONAL' est réservé aux bookings type=INTERNATIONAL sans aéroport.
    // Sans ce guard, un client envoyant `departureAirport: ''` se voyait créer un booking
    // avec departureAirport='INTERNATIONAL' (fallback ligne plus bas) → bypass du Filtre 2.
    if (dto.type !== 'INTERNATIONAL') {
      const code = dto.departureAirport?.trim().toUpperCase();
      if (!code || code === 'INTERNATIONAL' || !/^[A-Z]{3}$/.test(code)) {
        throw new BadRequestException(
          `Un aéroport de départ valide (code IATA 3 lettres) est requis pour les courses ${dto.type}.`,
        );
      }
    }

    // Filtre 2 — refus si l'aéroport n'est pas opéré par AeroCab (source de vérité backend).
    // Le frontend applique le Filtre 1 pour l'UX, mais cette garde est obligatoire car
    // un client modifié ou une requête forgée pourrait contourner le filtrage UI.
    // Le sentinel 'INTERNATIONAL' (pas un vrai IATA) est utilisé pour les bookings sans aéroport.
    if (dto.departureAirport && dto.departureAirport.toUpperCase() !== 'INTERNATIONAL') {
      const airport = await this.prisma.airport.findUnique({
        where: { iataCode: dto.departureAirport.toUpperCase() },
        select: { isActive: true, isOperated: true, city: true },
      });
      if (!airport || !airport.isActive || !airport.isOperated) {
        throw new BadRequestException(
          `Le service AeroCab n'est pas disponible à ${airport?.city ?? dto.departureAirport}. Contactez le support pour plus d'informations.`,
        );
      }
    }

    // Détecte le pays : 1) via l'aéroport, 2) via countryCode explicite du DTO (INTERNATIONAL sans aéroport)
    let bookingCountryCode: string | null = null;
    if (dto.departureAirport) {
      try {
        const airport = await this.prisma.airport.findUnique({
          where: { iataCode: dto.departureAirport.toUpperCase() },
          select: { countryCode: true },
        });
        bookingCountryCode = airport?.countryCode?.toUpperCase() ?? null;
      } catch { /* ignore */ }
    }
    if (!bookingCountryCode && dto.countryCode) {
      bookingCountryCode = dto.countryCode.toUpperCase();
    }
    const isCountrySupported = await this.settingsService.isCountrySupported(bookingCountryCode);
    if (!isCountrySupported) {
      throw new BadRequestException(
        `Le service AeroCab n'est pas encore disponible dans votre pays (${bookingCountryCode}). Contactez le support pour plus d'informations.`,
      );
    }

    const bookingTariffs = await this.settingsService.getTariffsByCountry(bookingCountryCode);
    const bookingPointValue = bookingTariffs.pointValue ?? 1; // pts par unité monétaire locale

    // ── Zone pricing ───────────────────────────────────────────────────────────
    // Cascade aéroport → pays → global
    const pricingMode = 'zone';
    const zones = await this.zonesService.findForCountry(bookingCountryCode, dto.departureAirport ?? null);

    const matchedZone = this.zonesService.matchZone(distanceKm, zones);
    if (!matchedZone) {
      const airportLabel = dto.departureAirport ? `l'aéroport ${dto.departureAirport.toUpperCase()}` : `le pays ${bookingCountryCode}`;
      throw new BadRequestException(
        `Aucune zone tarifaire configurée pour ${airportLabel} (distance : ${distanceKm.toFixed(1)} km). Contactez l'administrateur pour configurer les tarifs.`,
      );
    }

    const zonePrice = matchedZone.prices[dto.vehicleType];
    if (zonePrice === undefined) {
      throw new BadRequestException(
        `Le type de véhicule "${dto.vehicleType}" n'est pas disponible pour un trajet de ${distanceKm.toFixed(1)} km (${matchedZone.name}).`,
      );
    }

    const finalPricePoints = zonePrice;
    const zoneMatch = { zone: matchedZone, pricePoints: finalPricePoints };
    const priceInFcfa = Math.round(finalPricePoints * bookingPointValue);

    this.logger.log(`[Zone Pricing] ${distanceKm.toFixed(1)}km → ${zoneMatch.zone.name} | ${dto.vehicleType} | ${finalPricePoints} pts | ${priceInFcfa} ${bookingTariffs.currency ?? 'XAF'}`);

    // 7. Prix fixe zone garanti : modèle Blacklane, aucune surcharge nuit/pluie/pointe
    let bookingPricePoints = finalPricePoints;

    // 8. Surcharge INTERNATIONAL (configurable via admin) — tarif pays différent, conservé
    if (dto.type === 'INTERNATIONAL') {
      const surchargeRaw = await this.settingsService.get('international_surcharge_percent', '0');
      const surchargePercent = Math.max(0, parseFloat(surchargeRaw) || 0);
      if (surchargePercent > 0) {
        bookingPricePoints = Math.round(bookingPricePoints * (1 + surchargePercent / 100));
        this.logger.log(`[Pricing] Surcharge INTERNATIONAL +${surchargePercent}% → ${bookingPricePoints} pts`);
      }
    }

    // 9. Verrou de prix : tolérance lue depuis AppSetting
    const toleranceRaw = await this.settingsService.get('price_change_tolerance_percent', '5');
    const priceTolerance = (parseFloat(toleranceRaw) || 5) / 100;

    if (dto.expectedPriceFcfa && dto.expectedPriceFcfa > 0) {
      const diff = Math.abs(bookingPricePoints - dto.expectedPriceFcfa) / dto.expectedPriceFcfa;
      if (diff > priceTolerance) {
        throw new BadRequestException(
          JSON.stringify({
            code: 'PRICE_CHANGED',
            previousPrice: dto.expectedPriceFcfa,
            newPrice: bookingPricePoints,
            message: `Le prix a changé : ${dto.expectedPriceFcfa.toLocaleString()} → ${bookingPricePoints.toLocaleString()} FCFA. Veuillez confirmer le nouveau prix.`,
          }),
        );
      }
    }

    // Applique le code promo si fourni (sur les points)
    let pointsAfterDiscount = bookingPricePoints;
    let discountAmount = 0;
    let appliedPromoCode: string | null = null;

    // C3 — validatePromo hors-transaction (lecture seule, OK).
    // applyPromo (incrément usedCount) est différé à l'intérieur du $transaction
    // pour éviter qu'un booking raté laisse une promo "brûlée".
    if (dto.promoCode) {
      const promo = await this.promosService.validatePromo(dto.promoCode, passengerId);
      if (promo) {
        discountAmount = Math.min(promo.discount, bookingPricePoints);
        pointsAfterDiscount = bookingPricePoints - discountAmount;
        appliedPromoCode = dto.promoCode.toUpperCase();
      }
    }
    // applyPromoCode est transmis à la transaction ci-dessous

    // 10. Calcule l'ETA selon l'heure d'atterrissage (modèle Blacklane)
    // Le driver est TOUJOURS assigné à la réservation, même si le vol est dans plusieurs heures.
    // P2.2 — délai de sortie aéroport (immigration + bagages) lu depuis Airport.exitDelayMinutes
    // → DLA petit aéroport ~15 min, CDG ou JFK avec immigration ~45 min, configurable par admin.
    const defaultEtaRaw = await this.settingsService.get('default_driver_eta_min', '10');
    let driverEtaMinutes = parseInt(defaultEtaRaw, 10) || 10;
    let scheduledLandingMinutes: number | null = null;

    // Délai sortie aéroport : récupéré depuis l'aéroport de départ si dispo
    let airportExitDelay: number | null = null;
    if (dto.departureAirport && dto.departureAirport.toUpperCase() !== 'INTERNATIONAL') {
      try {
        const airportInfo = await this.prisma.airport.findUnique({
          where: { iataCode: dto.departureAirport.toUpperCase() },
          select: { exitDelayMinutes: true },
        });
        airportExitDelay = airportInfo?.exitDelayMinutes ?? null;
      } catch { /* fallback ci-dessous */ }
    }
    const exitDelay = airportExitDelay ?? (parseInt(await this.settingsService.get('default_airport_exit_delay_min', '15'), 10) || 15);

    if (dto.flightNumber) {
      const flight = await this.prisma.flight.findFirst({
        where: { userId: passengerId, flightNumber: dto.flightNumber },
        orderBy: { createdAt: 'desc' },
      });
      if (flight) {
        const landingTime = flight.actualArrival ?? flight.scheduledArrival;
        const minutesUntilLanding = Math.floor(
          (new Date(landingTime).getTime() - Date.now()) / 60000,
        );
        if (minutesUntilLanding > 0) {
          scheduledLandingMinutes = minutesUntilLanding;
          driverEtaMinutes = minutesUntilLanding + exitDelay;
        }
        // minutesUntilLanding <= 0 → déjà atterri, ETA = défaut (configurable)
      }
    }

    // P1 — Dispatch :
    //   pre-landing  → score-based, large pool (le passager est en l'air, on a le temps)
    //   post-landing → proximity-based (passager au sol, il veut le plus proche)
    // Avant : ARRIVAL sans vol était traité comme pre-landing → spam des drivers lointains.
    // Maintenant : isPreLanding=true UNIQUEMENT si on sait que le vol est encore en l'air.
    const isPreLanding = !!(scheduledLandingMinutes && scheduledLandingMinutes > 0);

    // Coords de dispatch :
    //   DEPARTURE → cherche les drivers autour du lieu de prise en charge (position du passager)
    //   ARRIVAL avec aéroport inconnu → utilise pickupLat/Lng (= position aéroport envoyée par le client)
    // 0.B3 — coords depuis DB ; si DEPARTURE ou aéroport inconnu → utilise coords GPS du passager
    const knownAirportCoords = await this.resolveAirportCoords(dto.departureAirport);
    const dispatchCustomCoords =
      isDeparture && dto.pickupLat && dto.pickupLng
        ? { lat: dto.pickupLat, lng: dto.pickupLng }
        : (!knownAirportCoords && dto.pickupLat && dto.pickupLng)
          ? { lat: dto.pickupLat, lng: dto.pickupLng }
          : undefined;

    // F8 — Récupérer tier passager pour dispatch prioritaire
    const passengerTierForDispatch = await this.usersService.getPassengerTier(passengerId).catch(() => 'bronze');

    const eligibleDrivers = await this.dispatchService.findEligibleDrivers(
      { departureAirport: dto.departureAirport, operatingCountry: bookingCountryCode } as any,
      isPreLanding,
      dispatchCustomCoords,
      passengerTierForDispatch,
    );

    // P1.3 — Dispatch différé explicite
    // Cas : aucun chauffeur dans le rayon de proximité ET booking non pre-landing.
    // Si des chauffeurs existent globalement, on calcule un ETA réaliste depuis le
    // plus proche et on demande au passager une confirmation explicite (acceptDelay).
    // Pas de bypass via flag opaque "force=true" — chaque délai accepté est tracé.
    if (eligibleDrivers.length === 0 && !isPreLanding && dto.acceptDelay !== true) {
      const pickupCoords = dispatchCustomCoords
        ?? (knownAirportCoords ? { lat: knownAirportCoords.lat, lng: knownAirportCoords.lng } : undefined);
      const delay = await this.dispatchService.estimateDelayedDispatch(dto.vehicleType, pickupCoords, bookingCountryCode);
      if (delay.globalDriversCount > 0) {
        throw new BadRequestException(
          JSON.stringify({
            code: 'DELAYED_DISPATCH',
            estimatedWaitMin: delay.estimatedWaitMin,
            closestDistanceKm: delay.closestDistanceKm,
            globalDriversCount: delay.globalDriversCount,
            message: `Aucun chauffeur à proximité immédiate. Le plus proche arrivera dans environ ${delay.estimatedWaitMin} min. Confirmez votre réservation pour patienter.`,
          }),
        );
      }
      // Aucun chauffeur disponible nulle part → message clair, pas de booking créé
      throw new BadRequestException('Aucun chauffeur n\'est disponible actuellement. Veuillez réessayer dans quelques minutes.');
    }

    // Broadcast model : pas d'auto-assign — tous les chauffeurs notifiés, le 1er à accepter obtient la course.

    // Sanity check: Coordinates (guards against NaN from client)
    const cleanDestLat = (typeof dto.destLat === 'number' && !isNaN(dto.destLat)) ? dto.destLat : null;
    const cleanDestLng = (typeof dto.destLng === 'number' && !isNaN(dto.destLng)) ? dto.destLng : null;
    const cleanPickupLat = (typeof dto.pickupLat === 'number' && !isNaN(dto.pickupLat)) ? dto.pickupLat : null;
    const cleanPickupLng = (typeof dto.pickupLng === 'number' && !isNaN(dto.pickupLng)) ? dto.pickupLng : null;

    // P2.1 — Géocodage inversé async :
    //   1) On garde le pickupAddress reçu (ou un fallback coords brut) pour créer le booking IMMÉDIATEMENT
    //   2) Si l'adresse est brute ET en mode DEPARTURE, on déclenche un géocodage en arrière-plan
    //      qui met à jour le booking + émet un socket d'update au passager.
    // Bénéfice : -800ms à -2.5s de latence sur le POST /bookings.
    let resolvedPickupAddress = dto.pickupAddress;
    let needsAsyncGeocoding = false;
    if (isDeparture && cleanPickupLat && cleanPickupLng) {
      const isRawCoords = !resolvedPickupAddress || /^-?\d+(\.\d+)?\s*[°,]/.test(resolvedPickupAddress);
      if (isRawCoords) {
        // Fallback immédiat lisible — sera remplacé par l'adresse géocodée plus tard
        if (!resolvedPickupAddress) {
          resolvedPickupAddress = `${cleanPickupLat.toFixed(4)}°, ${cleanPickupLng.toFixed(4)}°`;
        }
        needsAsyncGeocoding = true;
      }
    }

    // Taux de conversion : 1 point = 1 FCFA
    const pointsRequired = Math.ceil(pointsAfterDiscount);

    // Points + booking creation dans une transaction atomique
    // C2 — Ordre critique : booking.create() en PREMIER, débit points en SECOND.
    // Si la création du booking échoue (contrainte DB, erreur), le rollback de la
    // transaction annule également le débit → aucun argent perdu.
    // S177 — L'index partiel unique sur (passenger_id) WHERE status actif bloque les doublons
    // au niveau DB. On attrape P2002 pour retourner une 400 lisible plutôt qu'un 500.
    let booking: any;
    try {
    booking = await this.prisma.$transaction(async (tx) => {
      // S118 — Idempotence : un passager ne peut avoir qu'un seul booking actif à la fois.
      // Vérifié DANS la transaction pour éviter les race conditions (double-tap).
      const existingActive = await tx.booking.findFirst({
        where: {
          passengerId,
          status: { in: ['pending', 'confirmed', 'arrived_at_airport', 'in_progress'] },
        },
        select: { id: true },
      });
      if (existingActive) {
        throw new BadRequestException('Vous avez déjà une réservation en cours');
      }

      // D5 — Débit atomique wallet (protection race condition double-dépense)
      // wallet.updateMany avec WHERE balance >= pointsRequired est une opération atomique :
      // si deux bookings concurrents lisent le même solde, le second obtiendra count=0 et sera rejeté.
      // F4 — Les méthodes de paiement direct (Mobile Money, Carte, Cash) ne débitent pas le wallet.
      const isF4Payment = F4_PAYMENT_METHODS.includes(dto.paymentMethod);
      if (!isF4Payment && (dto.paymentMethod === 'wallet' || dto.paymentMethod === 'points')) {
        // Garantir l'existence du wallet avant le débit
        await tx.wallet.upsert({
          where: { userId: passengerId },
          update: {},
          create: { userId: passengerId, balance: 0 },
        });

        const debited = await tx.wallet.updateMany({
          where: { userId: passengerId, balance: { gte: pointsRequired } },
          data: { balance: { decrement: pointsRequired } },
        });

        if (debited.count === 0) {
          // Incrémente le compteur de fraude (clé expire après 24h)
          this.redis.incr(`fraud:balance_fail:${passengerId}`)
            .then(() => this.redis.expire(`fraud:balance_fail:${passengerId}`, 86400))
            .catch(() => {});
          const wallet = await tx.wallet.findUnique({ where: { userId: passengerId } });
          throw new BadRequestException(
            `Solde insuffisant : ${wallet?.balance ?? 0} pts disponibles (${pointsRequired} pts requis)`,
          );
        }
      }

      // 1. Créer le booking en premier
      const frozenCommissionRate = await this.resolveBookingCommissionRate(dto.vehicleType, null, bookingCountryCode);
      const newBooking = await tx.booking.create({
        data: {
          passengerId,
          driverProfileId: null,
          flightNumber: dto.flightNumber || null,
          departureAirport: dto.departureAirport?.toUpperCase() || 'INTERNATIONAL',
          destination: dto.destination || 'Destination',
          destLat: cleanDestLat,
          destLng: cleanDestLng,
          vehicleType: dto.vehicleType,
          paymentMethod: dto.paymentMethod,
          estimatedPrice: pointsAfterDiscount,
          promoCode: appliedPromoCode,
          discountAmount,
          // F4 — devise et pays d'opération (taux de change gelé à la réservation)
          currency:         (dto as any).currency ?? 'XAF',
          operatingCountry: bookingCountryCode ?? 'CM',
          paymentStatus:    isF4Payment ? 'pending' : 'not_required',
          // Devise d'affichage passager (multi-pays)
          displayCurrency:  dto.displayCurrency ?? null,
          displayAmount:    dto.displayAmount    ?? null,
          exchangeRateUsed: dto.exchangeRateUsed ?? null,
          scheduledAt: scheduledAt ?? null,
          status: scheduledAt ? 'scheduled' : 'pending',
          driverEtaMinutes: scheduledAt ? null : driverEtaMinutes,
          type: dto.type || 'ARRIVAL',
          pickupAddress: resolvedPickupAddress || (isDeparture ? 'Lieu de départ' : 'Aéroport'),
          pickupLat: cleanPickupLat,
          pickupLng: cleanPickupLng,
          // Métriques course
          estimatedDistanceKm:  parseFloat(distanceKm.toFixed(2)),
          estimatedDurationMin: Math.max(5, Math.round(distanceKm / 30 * 60)),
          baseFare:    priceInFcfa,
          airportFee:  null,
          // Forfait
          forfaitId:     null,
          commissionRate: frozenCommissionRate,
          pricingZoneId: zoneMatch.zone.id,
          pricingMode:   pricingMode as any,
        } as any,
        include: {
          passenger: { select: { name: true, avatarUrl: true, status: true } },
          driverProfile: {
            include: {
              user: { select: { id: true, name: true } },
            },
          },
        },
      });

      // 2. Enregistrement audit du débit (wallet.balance déjà décrémenté atomiquement ci-dessus)
      // F4 — skip audit points pour les paiements directs
      if (!isF4Payment && (dto.paymentMethod === 'wallet' || dto.paymentMethod === 'points')) {
        await tx.pointsTransaction.create({
          data: {
            userId: passengerId,
            type: 'debit',
            points: -pointsRequired,
            label: `Réservation course ${dto.flightNumber || 'URBAN'} (${pointsAfterDiscount} FCFA)`,
            source: 'payment',
          },
        });
      }

      // C3 — Incrémenter usedCount promo via tx (atomique avec le booking).
      // On ne peut pas appeler promosService.applyPromo() ici car il utilise
      // this.prisma (connexion indépendante). On fait l'update directement via tx.
      if (appliedPromoCode) {
        const promoRecord = await tx.promoCode.findUnique({ where: { code: appliedPromoCode } });
        if (promoRecord) {
          await tx.promoCode.update({
            where: { id: promoRecord.id },
            data: { usedCount: { increment: 1 } },
          });
        }
      }

      // 3. Points de fidélité dans la même transaction (H3)
      const earnedPoints = Math.floor(newBooking.estimatedPrice as number / 100);
      if (earnedPoints > 0) {
        await tx.pointsTransaction.create({
          data: {
            userId: passengerId,
            type: 'credit',
            points: earnedPoints,
            label: `Fidélité — ${newBooking.departureAirport} → ${newBooking.destination}`,
            source: 'loyalty',
          },
        });
      }

      return newBooking;
    }) as any;
    } catch (err: any) {
      // S177 — Index unique partiel sur passenger_id : doublon concurrent → 400 propre
      if (err?.code === 'P2002' || err?.message?.includes('booking_passenger_one_active')) {
        throw new BadRequestException('Vous avez déjà une réservation en cours');
      }
      throw err;
    }

    // P2.1 — Géocodage différé en arrière-plan (fire-and-forget) si l'adresse est restée brute.
    // On laisse le booking créé partir, puis on patche pickupAddress + on émet une socket
    // d'update dès que Google répond. Le passager voit la page tracking instantanément.
    if (needsAsyncGeocoding && cleanPickupLat !== null && cleanPickupLng !== null) {
      this.geocodeBookingPickupAsync(booking.id, passengerId, cleanPickupLat, cleanPickupLng)
        .catch((e) => this.logger.warn(`[Geocoding] booking ${booking.id} failed: ${e?.message}`));
    }

    // Bonus for first booking — count exclut la course qui vient d'être créée
    const totalBookings = await this.prisma.booking.count({
      where: { passengerId, id: { not: booking.id } },
    });
    if (totalBookings === 0) {
      const firstRideBonus = parseInt(await this.settingsService.getForCountry('first_ride_bonus_points', bookingCountryCode, '500'), 10) || 500;
      this.points.addPoints(passengerId, firstRideBonus, 'Bonus première course', 'bonus').catch(() => {});
    }

    // Réservation programmée — ne pas dispatcher immédiatement
    if (scheduledAt) {
      const scheduledStr = scheduledAt.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
      this.notifications.sendToUser(
        passengerId,
        'Réservation programmée ✅',
        `Votre course vers ${booking.destination} est confirmée pour le ${scheduledStr}.`,
      ).catch(() => {});
      this.ridesGateway.server
        .to(`passenger:${passengerId}`)
        .emit('booking:created', { id: booking.id, status: 'scheduled', scheduledAt: scheduledAt.toISOString() });
      return booking;
    }

    // Notify passenger — booking created, searching for a driver
    const passengerMsg = scheduledLandingMinutes !== null
      ? `Recherche d'un chauffeur en cours. Il sera là à votre atterrissage (dans ~${scheduledLandingMinutes} min).`
      : `Réservation reçue. Recherche d'un chauffeur vers ${booking.destination}…`;
    this.notifications.sendToUser(
      passengerId,
      'Réservation en cours 🔍',
      passengerMsg,
    ).catch(() => {});

    // Socket : notifie immédiatement la page de tracking du passager
    this.ridesGateway.server
      .to(`passenger:${passengerId}`)
      .emit('booking:created', { id: booking.id, status: 'pending' });

    // Phase 3: Smart Broadcast Activation
    // Notify all eligible drivers via Socket.io (online) + FCM push (all approved)
    if (eligibleDrivers.length > 0) {
      for (const d of eligibleDrivers) {
        this.notifications.sendToUser(
          d.userId,
          'Nouvelle course disponible 🚗',
          `Course vers ${booking.destination} — ${booking.estimatedPrice.toLocaleString()} FCFA`,
          { bookingId: booking.id, type: 'new_booking' },
        ).catch(() => {});

        this.ridesGateway.notifyNewBooking(d.id, {
          id: booking.id,
          passengerId: booking.passengerId,
          passengerName: booking.passenger?.name || 'Client',
          passengerAvatarUrl: (booking.passenger as any)?.avatarUrl ?? null,
          passengerVerified: (booking.passenger as any)?.status === 'active',
          flightNumber: booking.flightNumber,
          destination: booking.destination,
          vehicleType: booking.vehicleType,
          estimatedPrice: booking.estimatedPrice,
          departureAirport: booking.departureAirport,
          type: booking.type,
          pickupAddress: booking.pickupAddress,
          pricingMode: (booking as any).pricingMode ?? 'kilometrage',
          isPreLanding: isPreLanding,
          distanceKm: parseFloat(distanceKm.toFixed(1)),
          durationMin: Math.max(5, Math.round(distanceKm / 30 * 60)),
        });
      }
      this.logger.log(`[Dispatch] Broadcasted booking ${booking.id} to ${eligibleDrivers.length} online drivers.`);
    } else {
      // Aucun chauffeur online → notifier TOUS les chauffeurs approuvés via FCM
      // pour les réveiller (app fermée). Ils pourront se mettre en ligne et accepter.
      const allApprovedDrivers = await this.prisma.driverProfile.findMany({
        where: { status: 'approved', user: { fcmToken: { not: null } } },
        select: { userId: true },
      });
      for (const d of allApprovedDrivers) {
        this.notifications.sendToUser(
          d.userId,
          'Course en attente 🔔',
          `Une course vers ${booking.destination} attend un chauffeur. Connectez-vous pour l'accepter.`,
          { bookingId: booking.id, type: 'wake_up' },
        ).catch(() => {});
      }
      if (allApprovedDrivers.length > 0) {
        this.logger.log(`[Dispatch] No online drivers — FCM wake-up sent to ${allApprovedDrivers.length} approved drivers.`);
      }
    }

    // H4 — setTimeout supprimé : il était non-persistant (perdu au redémarrage du serveur).
    // Le scheduler @Cron expireUnassignedBookings() (bookings.scheduler.ts, toutes les 2min)
    // gère l'expiration via DB, de façon fiable et persistante.
    // Le délai est configuré via AppSetting 'booking_assignment_timeout_min' (défaut : 2min).

    if (isNaN(pointsAfterDiscount)) {
      throw new BadRequestException('Le calcul du prix a échoué (NaN)');
    }

    // M12 — Audit : booking créé
    this.audit.log({
      action: 'booking.created',
      entity: 'booking',
      entityId: booking.id,
      userId: passengerId,
      meta: { vehicleType: booking.vehicleType, estimatedPrice: booking.estimatedPrice, paymentMethod: booking.paymentMethod, type: booking.type },
    }).catch(() => {});

    return {
      id: booking.id,
      status: booking.status,
      vehicleType: booking.vehicleType,
      estimatedPrice: booking.estimatedPrice,
      driverEtaMinutes: booking.driverEtaMinutes,
      driver: booking.driverProfile
        ? {
            name: booking.driverProfile.user.name,
            vehicleBrand: booking.driverProfile.vehicleBrand,
            vehicleModel: booking.driverProfile.vehicleModel,
          }
        : null,
      createdAt: booking.createdAt,
    };
    } catch (e: any) {
      this.logger.error(`[BookingsService] createBooking error: ${e?.message} | Code: ${e?.code} | Meta: ${JSON.stringify(e?.meta)}`);
      if (e instanceof BadRequestException) throw e;
      throw new InternalServerErrorException(`Booking creation failed: ${e?.message || 'Unknown error'}`);
    }
  }

  async getActiveBooking(passengerId: string) {
    const booking = await this.prisma.booking.findFirst({
      where: {
        passengerId,
        status: { in: ['pending', 'confirmed', 'arrived_at_airport', 'in_progress', 'passenger_confirming'] },
      },
      include: {
        driverProfile: {
          include: {
            user: { select: { id: true, name: true, phone: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!booking) return { booking: null };

    // Récupère le statut du vol lié à cette réservation
    let flightStatus: {
      scheduledArrival: string;
      actualArrival: string | null;
      status: 'on_time' | 'delayed' | 'landed';
    } | null = null;

    let liveEtaMinutes = booking.driverEtaMinutes || 10;

    if (booking.flightNumber) {
      let flight = await this.prisma.flight.findFirst({
        where: { userId: passengerId, flightNumber: booking.flightNumber },
        orderBy: { createdAt: 'desc' },
      });
      // Vol absent en DB → on le récupère depuis AviationStack et on le sauvegarde
      if (!flight) {
        flight = await this.fetchAndSaveFlight(passengerId, booking.flightNumber);
      }
      if (flight) {
        const scheduled = new Date(flight.scheduledArrival);
        const actual = flight.actualArrival ? new Date(flight.actualArrival) : null;
        const nowDate = new Date();

        let status: 'on_time' | 'delayed' | 'landed';
        if (actual) {
          status = 'landed';
          liveEtaMinutes = parseInt(await this.settingsService.get('default_driver_eta_min', '10'), 10) || 10;
        } else if (scheduled < nowDate) {
          status = 'delayed';
          liveEtaMinutes = parseInt(await this.settingsService.get('default_driver_eta_min', '10'), 10) || 10;
        } else {
          status = 'on_time';
          // P2.2 — délai sortie aéroport lu depuis Airport.exitDelayMinutes (fallback global)
          let exitDelayLive: number | null = null;
          if (booking.departureAirport && booking.departureAirport.toUpperCase() !== 'INTERNATIONAL') {
            const a = await this.prisma.airport.findUnique({
              where: { iataCode: booking.departureAirport.toUpperCase() },
              select: { exitDelayMinutes: true },
            }).catch(() => null);
            exitDelayLive = a?.exitDelayMinutes ?? null;
          }
          const exit = exitDelayLive ?? (parseInt(await this.settingsService.get('default_airport_exit_delay_min', '15'), 10) || 15);
          const minutesUntilLanding = Math.floor((scheduled.getTime() - nowDate.getTime()) / 60000);
          liveEtaMinutes = minutesUntilLanding + exit;
        }

        flightStatus = {
          scheduledArrival: flight.scheduledArrival.toISOString(),
          actualArrival: flight.actualArrival?.toISOString() || null,
          status,
        };
      }
    }

    // Countdown basé sur l'ETA live (pas la valeur stockée en DB)
    const etaSeconds = liveEtaMinutes * 60;
    const createdAt = new Date(booking.createdAt).getTime();
    const elapsed = Math.floor((Date.now() - createdAt) / 1000);
    const countdown = Math.max(0, etaSeconds - elapsed);

    // 3.B3 — Garantir conversationId : find-or-create si driver assigné
    let conversationId: string | null = null;
    if (booking.driverProfile?.user?.id) {
      const driverUserId = booking.driverProfile.user.id;
      const existing = await this.prisma.conversation.findFirst({
        where: { passengerId, driverId: driverUserId },
        select: { id: true },
      });
      if (existing) {
        conversationId = existing.id;
      } else {
        const created = await this.prisma.conversation.create({
          data: { passengerId, driverId: driverUserId },
          select: { id: true },
        });
        conversationId = created.id;
      }
    }

    return {
      booking: {
        id: booking.id,
        status: booking.status,
        type: booking.type,
        flightNumber: booking.flightNumber,
        flightStatus,
        destination: booking.destination,
        vehicleType: booking.vehicleType,
        vehicleBrand: booking.driverProfile?.vehicleBrand || '',
        vehicleModel: booking.driverProfile?.vehicleModel || '',
        seats: await this.getVehicleSeats(booking.vehicleType, (booking as any).operatingCountry ?? null),
        estimatedPrice: booking.estimatedPrice,
        paymentMethod: booking.paymentMethod,
        driverEtaMinutes: liveEtaMinutes,
        countdownSeconds: countdown,
        shareTripEnabled: booking.shareTripEnabled,
        conversationId,
        driverUserId: booking.driverProfile?.user.id || null,
        driverName: booking.driverProfile?.user.name || null,
        driverVehicleBrand: booking.driverProfile?.vehicleBrand || null,
        driverVehicleModel: booking.driverProfile?.vehicleModel || null,
        driverVehicleColor: booking.driverProfile?.vehicleColor || null,
        driverVehiclePlate: booking.driverProfile?.vehiclePlate || null,
      },
    };
  }

  async updateShareTrip(passengerId: string, bookingId: string, enabled: boolean) {
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, passengerId },
    });
    if (!booking) throw new NotFoundException('Réservation introuvable');

    let shareToken = booking.shareToken;
    if (enabled && !shareToken) {
      shareToken = randomBytes(16).toString('hex');
    }

    const updated = await this.prisma.booking.update({
      where: { id: bookingId },
      data: { shareTripEnabled: enabled, shareToken: enabled ? shareToken : null },
      select: { id: true, shareTripEnabled: true, shareToken: true },
    });

    return { id: updated.id, shareTripEnabled: updated.shareTripEnabled, shareToken: updated.shareToken };
  }

  async getPublicTracking(token: string) {
    const booking = await this.prisma.booking.findFirst({
      where: { shareToken: token, shareTripEnabled: true },
      select: {
        id: true,
        status: true,
        destination: true,
        estimatedPrice: true,
        currency: true,
        driverEtaMinutes: true,
        pickupLat: true,
        pickupLng: true,
        destLat: true,
        destLng: true,
        type: true,
        createdAt: true,
        driverProfile: {
          select: {
            vehicleBrand: true, vehicleModel: true, vehicleColor: true, vehiclePlate: true,
            user: { select: { name: true } },
          },
        },
        positions: {
          orderBy: { recordedAt: 'desc' },
          take: 1,
          select: { latitude: true, longitude: true, recordedAt: true },
        },
      },
    });

    if (!booking) throw new NotFoundException('Lien de suivi invalide ou expiré');

    const latest = booking.positions[0] ?? null;

    // Calcul ETA dynamique par haversine
    let etaMinutes: number | null = booking.driverEtaMinutes ?? null;
    if (latest && booking.destLat && booking.destLng) {
      const distKm = haversineKm(
        latest.latitude, latest.longitude,
        booking.status === 'in_progress' ? booking.destLat : (booking.pickupLat ?? booking.destLat),
        booking.status === 'in_progress' ? booking.destLng : (booking.pickupLng ?? booking.destLng),
      );
      etaMinutes = Math.ceil((distKm / 40) * 60); // vitesse moyenne 40 km/h
    }

    return {
      status: booking.status,
      destination: booking.destination,
      currency: booking.currency,
      etaMinutes,
      driver: booking.driverProfile ? {
        name: booking.driverProfile.user?.name ?? 'Chauffeur',
        vehicle: `${booking.driverProfile.vehicleColor} ${booking.driverProfile.vehicleBrand} ${booking.driverProfile.vehicleModel}`,
        plate: booking.driverProfile.vehiclePlate,
      } : null,
      driverPosition: latest ? { lat: latest.latitude, lng: latest.longitude, updatedAt: latest.recordedAt } : null,
      pickupLat: booking.pickupLat,
      pickupLng: booking.pickupLng,
      destLat: booking.destLat,
      destLng: booking.destLng,
    };
  }

  async cancelBooking(passengerId: string, bookingId: string) {
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, passengerId },
      include: {
        driverProfile: { select: { id: true, userId: true } },
      },
    });

    if (!booking) throw new NotFoundException('Réservation introuvable');

    // M8 — Fenêtre d'annulation étendue à arrived_at_airport, avec pénalité.
    // - pending / confirmed   → remboursement 100% ou 50% selon règle 48h
    // - arrived_at_airport    → remboursement 50% (driver a fait le déplacement)
    // - in_progress et au-delà → annulation interdite
    const cancellableStatuses = ['pending', 'confirmed', 'arrived_at_airport'];
    if (!cancellableStatuses.includes(booking.status)) {
      throw new BadRequestException('Cette réservation ne peut plus être annulée');
    }

    // S465 — Règle 48h : pénalité si annulation < 48h avant le vol (INTERNATIONAL/DEPARTURE)
    // Le calcul est en durée UTC (timestamps), l'affichage côté client se fait en WAT.
    let isLateCancelBy48h = false;
    if (booking.flightNumber && booking.type !== 'ARRIVAL') {
      const flight = await this.prisma.flight.findFirst({
        where: { flightNumber: booking.flightNumber, userId: passengerId },
        select: { scheduledArrival: true },
        orderBy: { createdAt: 'desc' },
      });
      if (flight?.scheduledArrival) {
        const hoursUntilFlight = (flight.scheduledArrival.getTime() - Date.now()) / (1000 * 60 * 60);
        isLateCancelBy48h = hoursUntilFlight < 48;
      }
    }

    const isLateCancel = booking.status === 'arrived_at_airport' || isLateCancelBy48h;
    const price = Number(booking.estimatedPrice) || 0;
    const lateCancelRate = parseFloat(await this.settingsService.getForCountry('late_cancel_refund_rate', booking.operatingCountry ?? null, '0.5')) || 0.5;
    const refundRate = isLateCancel ? lateCancelRate : 1.0;
    const pointsToRefund = Math.ceil(price * refundRate);
    const penaltyPoints  = Math.floor(price * (1 - refundRate));

    // ── F4 — Remboursement PaymentIntent (avant transaction DB pour éviter débit sans annulation) ──
    const isCancelF4 = F4_PAYMENT_METHODS.includes(booking.paymentMethod);
    if (isCancelF4) {
      // penaltyPct selon la décision architecture : 0% avant dispatch, 20% après dispatch
      const penaltyPct = isLateCancel ? 20 : 0;
      try {
        await this.paymentIntentSvc.refund(bookingId, {
          reason: isLateCancel ? 'late_cancellation' : 'passenger_cancelled',
          penaltyPct,
        });
      } catch (err) {
        this.logger.warn(`[F4] Refund échoué pour ${bookingId}: ${err.message}`);
      }
    }

    // C4 — Annulation + remboursement dans une même transaction atomique.
    const cancelled = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.booking.update({
        where: { id: bookingId },
        data: { status: 'cancelled', cancelledAt: new Date() },
      });

      const isPointsPayment = !isCancelF4 && (booking.paymentMethod === 'wallet' || booking.paymentMethod === 'points');

      // Remboursement passager (100% ou 50%) — wallet + audit
      if (isPointsPayment && pointsToRefund > 0) {
        await tx.pointsTransaction.create({
          data: {
            userId: passengerId,
            type: 'credit',
            points: pointsToRefund,
            label: `Remboursement ${isLateCancel ? '50%' : '100%'} annulation course ${bookingId.slice(0, 8)}${isLateCancelBy48h ? ' (< 48h avant vol)' : ''}`,
            source: 'refund',
          },
        });
        await tx.wallet.upsert({
          where: { userId: passengerId },
          update: { balance: { increment: pointsToRefund } },
          create: { userId: passengerId, balance: pointsToRefund },
        });
      }

      // M8 — Compensation pénalité au chauffeur (50% si late cancel) — wallet + audit
      if (isLateCancel && isPointsPayment && penaltyPoints > 0 && booking.driverProfile?.userId) {
        await tx.pointsTransaction.create({
          data: {
            userId: booking.driverProfile.userId,
            type: 'credit',
            points: penaltyPoints,
            label: `Compensation annulation tardive course ${bookingId.slice(0, 8)}`,
            source: 'refund',
          },
        });
        await tx.wallet.upsert({
          where: { userId: booking.driverProfile.userId },
          update: { balance: { increment: penaltyPoints } },
          create: { userId: booking.driverProfile.userId, balance: penaltyPoints },
        });
      }

      return updated;
    });

    // Notifier le chauffeur
    if (booking.driverProfile) {
      // S141 — Libère le dispatch lock si le booking était encore pending
      if (booking.status === 'pending') {
        this.redis.del(`dispatch:lock:${booking.driverProfile.id}`).catch(() => {});
      }

      this.ridesGateway.server
        .to(`driver:${booking.driverProfile.id}`)
        .emit('booking:cancelled', { bookingId, reason: 'passenger_cancelled', isLateCancel });

      const driverMsg = isLateCancel
        ? `Le passager a annulé après votre arrivée. Une compensation de ${penaltyPoints} pts vous a été créditée.`
        : 'Le passager a annulé la réservation.';
      this.notifications.sendToUser(booking.driverProfile.userId, 'Course annulée', driverMsg).catch(() => {});
    }

    this.audit.log({
      action: 'booking.cancelled',
      entity: 'booking',
      entityId: bookingId,
      userId: passengerId,
      meta: { previousStatus: booking.status, paymentMethod: booking.paymentMethod, isLateCancel, refundRate, pointsToRefund, penaltyPoints },
    }).catch(() => {});

    this.usersService.updateTrustScore(passengerId).catch(() => {});

    return cancelled;
  }

  async getHeatmapZones() {
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const bookings = await this.prisma.booking.findMany({
      where: { createdAt: { gte: since }, pickupLat: { not: null }, pickupLng: { not: null } },
      select: { pickupLat: true, pickupLng: true },
      take: 2000,
    });

    const grid: Record<string, { lat: number; lng: number; count: number }> = {};
    for (const b of bookings) {
      if (b.pickupLat == null || b.pickupLng == null) continue;
      const cellLat = Math.round(Number(b.pickupLat) / 0.01) * 0.01;
      const cellLng = Math.round(Number(b.pickupLng) / 0.01) * 0.01;
      const key = `${cellLat.toFixed(2)},${cellLng.toFixed(2)}`;
      if (!grid[key]) grid[key] = { lat: cellLat, lng: cellLng, count: 0 };
      grid[key].count++;
    }

    const zones = Object.values(grid)
      .sort((a, b) => b.count - a.count)
      .slice(0, 60)
      .map(z => ({
        lat: z.lat,
        lng: z.lng,
        count: z.count,
        intensity: z.count >= 10 ? 'high' : z.count >= 3 ? 'medium' : 'low' as 'high' | 'medium' | 'low',
      }));

    return { zones, since: since.toISOString() };
  }

  async getBookingHistory(passengerId: string, page = 1, limit = 20) {
    try {
      const skip = Math.max(0, (page - 1) * limit);
      const [bookings, total] = await Promise.all([
        this.prisma.booking.findMany({
          where: { passengerId },
          include: {
            driverProfile: {
              include: {
                user: { select: { id: true, name: true } },
              },
            },
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
        }),
        this.prisma.booking.count({ where: { passengerId } }),
      ]);

      // Simple enrichment for conversationId if driver exists
      const enriched = await Promise.all(
        bookings.map(async (b) => {
          if (!b.driverProfile || !b.driverProfile.userId) return b;
          try {
            const conv = await this.prisma.conversation.findFirst({
              where: {
                passengerId,
                driverId: b.driverProfile.userId,
              },
            });

            const rating = conv ? await this.prisma.rating.findFirst({ where: { fromUserId: passengerId, conversationId: conv.id } }) : null;

            return { 
              ...b, 
              conversationId: conv?.id,
              hasRated: !!rating 
            };
          } catch {
            return b;
          }
        }),
      );

      return { data: enriched, total, page, limit };
    } catch (err: any) {
      this.logger.error(`[HistoryReal] Error for ${passengerId}: ${err.message}`);
      return { data: [], total: 0, page, limit };
    }
  }

  async getBookingById(userId: string, id: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id },
      include: {
        driverProfile: {
          include: {
            user: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (!booking) throw new NotFoundException('Réservation introuvable');
    if (booking.passengerId !== userId) throw new ForbiddenException('Accès refusé');

    // 2.B1 — Charger les données vol si un flightNumber est lié (ARRIVAL optionnel + INTERNATIONAL)
    let flightData: {
      flightNumber: string | null;
      airline: string | null;
      origin: string | null;
      destination: string | null;
      scheduledArrival: Date;
      estimatedArrival: Date;
      hasLanded: boolean;
    } | null = null;

    if (booking.flightNumber) {
      const flight = await this.prisma.flight.findFirst({
        where: { userId, flightNumber: booking.flightNumber },
        orderBy: { createdAt: 'desc' },
      });
      if (flight) {
        const rawEta = flight.actualArrival ?? flight.scheduledArrival;
        // N07 — Guard ETA négatif : si le vol est déjà passé, on retourne l'heure réelle
        // mais on ne recalcule pas artificiellement — le passager verra "Atterri"
        flightData = {
          flightNumber: flight.flightNumber ?? null,
          airline: flight.airline ?? null,
          origin: flight.origin ?? null,
          destination: flight.destination ?? null,
          scheduledArrival: flight.scheduledArrival,
          estimatedArrival: rawEta,
          hasLanded: rawEta <= new Date(),
        };
      }
    }

    // Find conversationId safely
    let conversationId: string | undefined;
    try {
      if (booking.driverProfile) {
        let flightId: string | undefined;
        if (booking.flightNumber) {
          const flight = await this.prisma.flight.findFirst({
            where: { userId, flightNumber: booking.flightNumber },
            orderBy: { createdAt: 'desc' },
          });
          flightId = flight?.id;
        }

        const conv = await this.prisma.conversation.findFirst({
          where: {
            passengerId: userId,
            driverId: booking.driverProfile.userId,
            flightId: flightId || null,
          },
          select: { id: true },
        });
        conversationId = conv?.id;

        let hasRated = false;
        if (conversationId) {
          const rating = await this.prisma.rating.findFirst({ where: { fromUserId: userId, conversationId } });
          hasRated = !!rating;
        }

        return {
          ...booking,
          flight: flightData,
          estimatedPrice: booking.estimatedPrice || 0,
          conversationId,
          hasRated
        };
      }
    } catch (e) {
      console.error('[Bookings] Error fetching conversationId:', e);
    }

    return {
      ...booking,
      flight: flightData,
      estimatedPrice: booking.estimatedPrice || 0,
      conversationId: undefined,
      hasRated: false
    };
  }

  async getPassengerStats(passengerId: string) {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [total, thisMonth, ratings] = await Promise.all([
      this.prisma.booking.count({ where: { passengerId } }),
      this.prisma.booking.count({
        where: { passengerId, createdAt: { gte: startOfMonth } },
      }),
      this.prisma.rating.aggregate({
        where: { toUserId: passengerId },
        _avg: { score: true },
        _count: true,
      }),
    ]);

    return {
      totalTrips: total,
      thisMonthTrips: thisMonth,
      avgRating: ratings._avg.score ? parseFloat(ratings._avg.score.toFixed(1)) : null,
      ratingCount: ratings._count,
    };
  }

  // ── Driver endpoints ───────────────────────────────────────────────────────

  async getDriverPendingRequest(driverUserId: string) {
    const driverProfile = await this.prisma.driverProfile.findUnique({ where: { userId: driverUserId } });
    if (!driverProfile) throw new NotFoundException('Profil chauffeur introuvable');

    // Encoche désactivée → pas de demandes
    if (!driverProfile.isAvailable) return { booking: null };

    // Broadcast model : cherche la course pré-assignée au chauffeur OU toute course ouverte (driverProfileId null)
    const booking = await this.prisma.booking.findFirst({
      where: {
        OR: [{ driverProfileId: driverProfile.id }, { driverProfileId: null }],
        status: 'pending',
      },
      include: { passenger: { select: { id: true, name: true, phone: true } } },
      orderBy: { createdAt: 'asc' },
    });

    if (!booking) return { booking: null };

    return {
      booking: {
        id: booking.id,
        passengerId: booking.passengerId,
        passengerName: (booking.passenger as any)?.name || null,
        flightNumber: booking.flightNumber,
        destination: booking.destination,
        vehicleType: booking.vehicleType,
        estimatedPrice: booking.estimatedPrice,
        departureAirport: booking.departureAirport,
        seats: await this.getVehicleSeats(booking.vehicleType, (booking as any).operatingCountry ?? null),
      },
    };
  }

  async acceptBooking(driverUserId: string, bookingId: string) {
    const driverProfile = await this.prisma.driverProfile.findUnique({ where: { userId: driverUserId } });
    if (!driverProfile) throw new NotFoundException('Profil chauffeur introuvable');

    // H1 — Vérification ownership + updateMany dans la même $transaction.
    // Sans transaction, un driver B pourrait accepter entre le findUnique (qui voit pending)
    // et le updateMany du driver A, causant deux confirmations simultanées.
    const { passengerId } = await this.prisma.$transaction(async (tx) => {
      const booking = await tx.booking.findUnique({
        where: { id: bookingId },
        select: { id: true, driverProfileId: true, passengerId: true, status: true },
      });

      if (!booking) throw new NotFoundException('Réservation non trouvée');
      // S141 — Un booking sans driver assigné (driverProfileId=null) est "open" :
      // n'importe quel driver qui a reçu le broadcast peut l'accepter en premier.
      if (booking.driverProfileId !== null && booking.driverProfileId !== driverProfile.id) {
        throw new ForbiddenException('Accès refusé');
      }

      // S141 — Empêche un driver déjà actif sur une course d'en accepter une deuxième.
      const driverAlreadyActive = await tx.booking.findFirst({
        where: {
          driverProfileId: driverProfile.id,
          status: { in: ['confirmed', 'arrived_at_airport', 'in_progress'] },
        },
        select: { id: true },
      });
      if (driverAlreadyActive) {
        throw new BadRequestException('Vous avez déjà une course active en cours');
      }

      // UPDATE conditionnel : atomique — le premier driver à écrire gagne (TOCTOU safe).
      // Accepte le booking s'il est encore pending ET (assigné à ce driver OU non assigné).
      const result = await tx.booking.updateMany({
        where: {
          id: bookingId,
          status: 'pending',
          OR: [{ driverProfileId: driverProfile.id }, { driverProfileId: null }],
        },
        data: { status: 'confirmed', driverProfileId: driverProfile.id },
      });

      if (result.count === 0) {
        throw new BadRequestException('Cette course a déjà été acceptée ou annulée');
      }

      return { passengerId: booking.passengerId };
    });

    // Libère le dispatch lock si existant (compatibilité avec ancienne logique)
    this.redis.del(`dispatch:lock:${driverProfile.id}`).catch(() => {});

    // Notifie le passager avec les infos du chauffeur pour affichage immédiat
    const driverUser = await this.prisma.user.findUnique({
      where: { id: driverUserId },
      select: { id: true, name: true },
    });
    this.ridesGateway.server.to(`passenger:${passengerId}`).emit('booking:accepted', {
      id: bookingId,
      status: 'confirmed',
      driverUserId: driverUserId,
      driverName: driverUser?.name ?? null,
      driverProfileId: driverProfile.id,
    });
    this.notifications.sendToUser(passengerId, 'Chauffeur en route 🚗', 'Votre chauffeur a accepté la course et arrive.').catch(() => {});

    this.audit.log({ action: 'booking.accepted', entity: 'booking', entityId: bookingId, userId: driverUserId, meta: { driverProfileId: driverProfile.id } }).catch(() => {});

    return { id: bookingId, status: 'confirmed' };
  }

  async declineBooking(driverUserId: string, bookingId: string) {
    const driverProfile = await this.prisma.driverProfile.findUnique({ where: { userId: driverUserId } });
    if (!driverProfile) throw new NotFoundException('Profil chauffeur introuvable');

    // D3.2 — Récupère aussi le nom du passager pour le réenvoyer au prochain driver
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { passenger: { select: { name: true } } },
    });
    if (!booking) throw new NotFoundException('Réservation non trouvée');
    // Accepte le déclin si le booking est assigné à ce driver OU en open-dispatch (null)
    if (booking.driverProfileId !== null && booking.driverProfileId !== driverProfile.id) throw new ForbiddenException('Accès refusé');
    if (booking.status !== 'pending') throw new BadRequestException('Statut incorrect');

    // S141 — Libère le dispatch lock : driver disponible pour d'autres courses.
    this.redis.del(`dispatch:lock:${driverProfile.id}`).catch(() => {});

    // P4 — Coords pour le re-dispatch :
    //   1) DEPARTURE → pickupLat/Lng du passager (sa vraie position)
    //   2) ARRIVAL/INTERNATIONAL → coords de l'aéroport depuis la DB (fallback si pickupLat null)
    //   Sans ce fallback, le findBestDriver retombe sur un rating global et peut proposer un
    //   driver à 100km → mauvaise UX passager.
    let redispatchCoords: { lat: number; lng: number } | undefined;
    if (booking.pickupLat && booking.pickupLng) {
      redispatchCoords = { lat: Number(booking.pickupLat), lng: Number(booking.pickupLng) };
    } else if (booking.type !== 'DEPARTURE' && booking.departureAirport) {
      const airportCoords = await this.resolveAirportCoords(booking.departureAirport);
      if (airportCoords) redispatchCoords = airportCoords;
    }
    const nextDriver = await this.findBestDriver(booking.departureAirport, driverProfile.id, booking.vehicleType, redispatchCoords);

    if (nextDriver) {
      // Réassigner au prochain chauffeur — statut reste pending
      await this.prisma.booking.update({
        where: { id: bookingId },
        data: { driverProfileId: nextDriver.id },
      });

      this.ridesGateway.server.to(`driver:${nextDriver.id}`).emit('booking:new_request', {
        id: booking.id,
        passengerId: booking.passengerId,
        passengerName: booking.passenger?.name ?? null,
        flightNumber: booking.flightNumber,
        destination: booking.destination,
        vehicleType: booking.vehicleType,
        estimatedPrice: booking.estimatedPrice,
        departureAirport: booking.departureAirport,
        seats: await this.getVehicleSeats(booking.vehicleType, (booking as any).operatingCountry ?? null),
      });
      this.notifications.sendToUser(
        nextDriver.user.id,
        'Nouvelle course 🚗',
        `Course vers ${booking.destination} — ${booking.estimatedPrice.toLocaleString()} FCFA`,
      ).catch(() => {});

      this.ridesGateway.notifyPassenger(booking.passengerId, 'booking_status_changed', { id: bookingId, status: 'pending' });
      this.notifications.sendToUser(booking.passengerId, 'Nouveau chauffeur en recherche 🔄', 'Votre chauffeur précédent a refusé. Nous cherchons un autre chauffeur pour vous.').catch(() => {});
      this.audit.log({ action: 'booking.declined', entity: 'booking', entityId: bookingId, userId: driverUserId, meta: { declinedByDriverProfileId: driverProfile.id, reassignedTo: nextDriver.id } })
        .catch((err) => this.logger.warn(`[Audit] booking.declined ${bookingId} failed: ${err?.message}`));

      return { id: bookingId, status: 'pending' };
    }

    // D3.3 — Aucun driver disponible : paiement cash uniquement → rien à rembourser, juste passer en status.
    // L'ancien bloc isPoints (wallet/points) est mort depuis que tout est cash.
    await this.prisma.booking.update({
      where: { id: bookingId },
      data: { driverProfileId: null, status: 'no_driver_available' },
    });

    this.ridesGateway.notifyPassenger(booking.passengerId, 'booking_status_changed', { id: bookingId, status: 'no_driver_available' });
    this.notifications.sendToUser(booking.passengerId, 'Aucun chauffeur disponible', 'Nous n\'avons trouvé aucun chauffeur disponible. Veuillez réessayer dans quelques minutes.').catch(() => {});
    this.audit.log({ action: 'booking.no_driver_available', entity: 'booking', entityId: bookingId, userId: driverUserId, meta: { declinedByDriverProfileId: driverProfile.id } })
      .catch((err) => this.logger.warn(`[Audit] booking.no_driver_available ${bookingId} failed: ${err?.message}`));

    return { id: bookingId, status: 'no_driver_available' };
  }

  // ── D2 : Panne chauffeur ────────────────────────────────────────────────────
  async reportBreakdown(driverUserId: string, bookingId: string) {
    const driverProfile = await this.prisma.driverProfile.findUnique({
      where: { userId: driverUserId },
      include: { user: { select: { id: true } } },
    });
    if (!driverProfile) throw new NotFoundException('Profil chauffeur introuvable');

    // D3.2 — inclure passenger.name pour le réenvoyer au driver de remplacement
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { passenger: { select: { name: true } } },
    });
    if (!booking) throw new NotFoundException('Réservation non trouvée');
    if (booking.driverProfileId !== driverProfile.id) throw new ForbiddenException('Accès refusé');
    if (!['confirmed', 'arrived_at_airport', 'in_progress'].includes(booking.status)) {
      throw new BadRequestException('La course n\'est pas active');
    }

    // Notifier immédiatement le passager — panne signalée
    this.ridesGateway.notifyPassenger(booking.passengerId, 'driver_breakdown', {
      bookingId,
      searching: true,
    });

    // Alerte admin en temps réel
    this.notifications.sendToAdmins(
      'Panne chauffeur 🚨',
      `Chauffeur en panne — booking ${bookingId.slice(0, 8)} — recherche remplaçant en cours.`,
      { bookingId, type: 'driver_breakdown' },
    ).catch(() => {});

    // Libérer le chauffeur en panne
    await this.prisma.driverProfile.update({
      where: { id: driverProfile.id },
      data: { isAvailable: true },
    });

    // Tenter de trouver un remplaçant
    const redispatchCoords = (booking.pickupLat && booking.pickupLng)
      ? { lat: Number(booking.pickupLat), lng: Number(booking.pickupLng) }
      : undefined;
    const nextDriver = await this.findBestDriver(
      booking.departureAirport,
      driverProfile.id,
      booking.vehicleType,
      redispatchCoords,
    );

    if (nextDriver) {
      // Réassigner sans modifier le prix ni le statut du passager
      await this.prisma.booking.update({
        where: { id: bookingId },
        data: { driverProfileId: nextDriver.id, status: 'pending' },
      });

      this.ridesGateway.server.to(`driver:${nextDriver.id}`).emit('booking:new_request', {
        id: booking.id,
        passengerId: booking.passengerId,
        passengerName: (booking as any).passenger?.name ?? null,
        flightNumber: booking.flightNumber,
        destination: booking.destination,
        vehicleType: booking.vehicleType,
        estimatedPrice: booking.estimatedPrice,
        departureAirport: booking.departureAirport,
        seats: await this.getVehicleSeats(booking.vehicleType, (booking as any).operatingCountry ?? null),
      });
      this.notifications.sendToUser(
        nextDriver.user.id,
        'Remplacement urgence 🚗',
        `Prise en charge urgente vers ${booking.destination}`,
      ).catch(() => {});

      this.ridesGateway.notifyPassenger(booking.passengerId, 'driver_breakdown', {
        bookingId,
        searching: false,
        replaced: true,
      });
      this.notifications.sendToUser(
        booking.passengerId,
        'Chauffeur remplacé 🔄',
        'Votre chauffeur a signalé une panne. Un nouveau chauffeur a été trouvé.',
      ).catch(() => {});

      this.audit.log({
        action: 'booking.driver_breakdown',
        entity: 'booking',
        entityId: bookingId,
        userId: driverUserId,
        meta: { replacedBy: nextDriver.id, status: 'reassigned' },
      }).catch(() => {});

      return { bookingId, replaced: true, status: 'pending' };
    }

    // Aucun remplaçant — remboursement 100% et annulation
    const price = Number(booking.estimatedPrice) || 0;
    const isPoints = booking.paymentMethod === 'wallet' || booking.paymentMethod === 'points';

    await this.prisma.$transaction(async (tx) => {
      await tx.booking.update({
        where: { id: bookingId },
        data: { status: 'cancelled', cancelledAt: new Date() },
      });
      if (isPoints && price > 0) {
        await tx.pointsTransaction.create({
          data: {
            userId: booking.passengerId,
            type: 'credit',
            points: price,
            label: `Remboursement 100% — panne chauffeur`,
            source: 'refund',
          },
        });
        await tx.wallet.upsert({
          where: { userId: booking.passengerId },
          update: { balance: { increment: price } },
          create: { userId: booking.passengerId, balance: price },
        });
      }
    });

    this.ridesGateway.notifyPassenger(booking.passengerId, 'driver_breakdown', {
      bookingId,
      searching: false,
      replaced: false,
      cancelled: true,
    });
    this.ridesGateway.notifyPassenger(booking.passengerId, 'booking_status_changed', {
      id: bookingId,
      status: 'cancelled',
      reason: 'driver_breakdown',
    });
    this.notifications.sendToUser(
      booking.passengerId,
      'Course annulée — panne chauffeur',
      isPoints && price > 0
        ? `Votre chauffeur a eu une panne. Aucun remplaçant disponible. ${price} pts remboursés.`
        : 'Votre chauffeur a eu une panne. Aucun remplaçant disponible. Course annulée.',
    ).catch(() => {});

    this.audit.log({
      action: 'booking.driver_breakdown',
      entity: 'booking',
      entityId: bookingId,
      userId: driverUserId,
      meta: { status: 'cancelled_no_replacement', refund: price },
    }).catch(() => {});

    return { bookingId, replaced: false, status: 'cancelled' };
  }

  async getDriverActiveRide(driverUserId: string) {
    const driverProfile = await this.prisma.driverProfile.findUnique({ where: { userId: driverUserId } });
    if (!driverProfile) return { booking: null };

    const booking = await this.prisma.booking.findFirst({
      where: {
        driverProfileId: driverProfile.id,
        status: { in: ['confirmed', 'arrived_at_airport', 'in_progress'] },
      },
      include: { passenger: { select: { id: true, name: true, phone: true, avatarUrl: true, status: true } } },
      orderBy: { createdAt: 'desc' },
    });

    if (!booking) return { booking: null };

    // Statut du vol en temps réel
    let flightStatus: {
      airline: string | null;
      scheduledArrival: string;
      actualArrival: string | null;
      status: 'on_time' | 'delayed' | 'landed';
      minutesUntilLanding: number;
    } | null = null;

    if (booking.flightNumber) {
      let flight = await this.prisma.flight.findFirst({
        where: { flightNumber: booking.flightNumber },
        orderBy: { createdAt: 'desc' },
      });
      if (!flight) {
        flight = await this.fetchAndSaveFlight(booking.passengerId, booking.flightNumber);
      }
      if (flight) {
        const scheduled = new Date(flight.scheduledArrival);
        const actual = flight.actualArrival ? new Date(flight.actualArrival) : null;
        const now = new Date();
        let status: 'on_time' | 'delayed' | 'landed';
        let minutesUntilLanding: number;

        if (actual) {
          status = 'landed';
          minutesUntilLanding = 0;
        } else if (scheduled < now) {
          status = 'delayed';
          minutesUntilLanding = 0;
        } else {
          status = 'on_time';
          minutesUntilLanding = Math.floor((scheduled.getTime() - now.getTime()) / 60000);
        }

        flightStatus = {
          airline: flight.airline ?? null,
          scheduledArrival: flight.scheduledArrival.toISOString(),
          actualArrival: flight.actualArrival?.toISOString() || null,
          status,
          minutesUntilLanding,
        };
      }
    }

    return {
      booking: {
        id: booking.id,
        status: booking.status,
        passengerId: booking.passengerId,
        passengerName: (booking.passenger as any)?.name || null,
        passengerAvatarUrl: (booking.passenger as any)?.avatarUrl ?? null,
        passengerVerified: (booking.passenger as any)?.status === 'active',
        flightNumber: booking.flightNumber,
        flightStatus,
        destination: booking.destination,
        vehicleType: booking.vehicleType,
        estimatedPrice: booking.estimatedPrice,
        departureAirport: booking.departureAirport,
        shareTripEnabled: booking.shareTripEnabled,
        type: booking.type,
        pickupAddress: (booking as any).pickupAddress ?? null,
        pricingMode: (booking as any).pricingMode ?? 'kilometrage',
      },
    };
  }

  async notifyArrival(driverUserId: string, bookingId: string) {
    const driverProfile = await this.prisma.driverProfile.findUnique({ where: { userId: driverUserId } });
    if (!driverProfile) throw new NotFoundException('Profil chauffeur introuvable');

    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking) throw new NotFoundException('Réservation non trouvée');
    if (booking.driverProfileId !== driverProfile.id) throw new ForbiddenException('Accès refusé');
    if (booking.status !== 'confirmed') throw new BadRequestException('Statut incorrect');

    // D4.4 — Anti-fraude : vérifier que le driver est physiquement proche du point d'arrivée annoncé.
    // ARRIVAL/INTERNATIONAL → l'aéroport. DEPARTURE → le pickupLat/Lng du passager.
    const proximityRaw = await this.settingsService.get('arrival_proximity_threshold_km', '0.5');
    const proximityKm = Math.max(0.1, parseFloat(proximityRaw) || 0.5);
    let targetLat: number | null = null;
    let targetLng: number | null = null;
    if (booking.type === 'DEPARTURE' && booking.pickupLat && booking.pickupLng) {
      targetLat = Number(booking.pickupLat);
      targetLng = Number(booking.pickupLng);
    } else if (booking.departureAirport && booking.departureAirport.toUpperCase() !== 'INTERNATIONAL') {
      const airport = await this.prisma.airport.findUnique({
        where: { iataCode: booking.departureAirport.toUpperCase() },
        select: { latitude: true, longitude: true },
      });
      if (airport) {
        targetLat = airport.latitude;
        targetLng = airport.longitude;
      }
    }
    const bypassProximity = process.env.BYPASS_PROXIMITY_CHECK === 'true';
    if (!bypassProximity && targetLat !== null && targetLng !== null && driverProfile.latitude && driverProfile.longitude) {
      const dKm = haversineKm(driverProfile.latitude, driverProfile.longitude, targetLat, targetLng);
      if (dKm > proximityKm) {
        throw new BadRequestException(
          `Vous êtes à ${dKm.toFixed(1)} km du point de prise en charge (seuil ${proximityKm} km). Approchez-vous avant de notifier votre arrivée.`,
        );
      }
    }

    const updated = await this.prisma.booking.update({
      where: { id: bookingId },
      data: { status: 'arrived_at_airport' },
    });

    this.ridesGateway.server.to(`passenger:${booking.passengerId}`).emit('booking:driver_arrived', { id: updated.id });
    this.ridesGateway.server.to(`passenger:${booking.passengerId}`).emit('booking_status_changed', { id: updated.id, status: 'arrived_at_airport' });
    const isDeparture = booking.type === 'DEPARTURE';
    this.notifications.sendToUser(
      booking.passengerId,
      'Chauffeur arrivé 📍',
      isDeparture ? 'Votre chauffeur attend devant votre adresse.' : 'Votre chauffeur est à l\'aéroport.',
    ).catch(() => {});
    this.audit.log({ action: 'booking.arrived_at_airport', entity: 'booking', entityId: bookingId, userId: driverUserId }).catch(() => {});

    return { id: updated.id, status: updated.status };
  }

  async startRide(driverUserId: string, bookingId: string) {
    const driverProfile = await this.prisma.driverProfile.findUnique({ where: { userId: driverUserId } });
    if (!driverProfile) throw new NotFoundException('Profil chauffeur introuvable');

    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking) throw new NotFoundException('Réservation non trouvée');
    if (booking.driverProfileId !== driverProfile.id) throw new ForbiddenException('Accès refusé');
    if (booking.status !== 'arrived_at_airport') throw new BadRequestException('Statut incorrect');

    // D5 — Vérification solde au démarrage (fenêtre longue entre réservation et prise en charge)
    if (booking.paymentMethod === 'wallet' || booking.paymentMethod === 'points') {
      const wallet = await this.prisma.wallet.findUnique({ where: { userId: booking.passengerId } });
      if (!wallet || wallet.balance < 0) {
        this.audit.log({
          action: 'fraud.negative_balance_at_start',
          entity: 'booking',
          entityId: bookingId,
          userId: driverUserId,
          meta: { passengerId: booking.passengerId, balance: wallet?.balance ?? null },
        }).catch(() => {});
        this.logger.warn(`[D5] Wallet négatif au démarrage — bookingId=${bookingId} passengerId=${booking.passengerId} balance=${wallet?.balance}`);
      }
    }

    const updated = await this.prisma.booking.update({
      where: { id: bookingId },
      data: { status: 'in_progress', startedAt: new Date() },
    });

    this.ridesGateway.server.to(`passenger:${booking.passengerId}`).emit('booking_status_changed', { id: updated.id, status: 'in_progress' });
    // D4.1 — FCM pour le passager qui a verrouillé son téléphone (récup bagages, etc.)
    this.notifications.sendToUser(
      booking.passengerId,
      'Course démarrée 🚗',
      `Direction ${booking.destination}. Bon voyage !`,
    ).catch(() => {});
    this.audit.log({ action: 'booking.started', entity: 'booking', entityId: bookingId, userId: driverUserId })
      .catch((err) => this.logger.warn(`[Audit] booking.started ${bookingId} failed: ${err?.message}`));

    return { id: updated.id, status: updated.status };
  }

  // 5.B2 — Le chauffeur signale la fin de course → passe en attente de confirmation passager
  async completeRide(driverUserId: string, bookingId: string) {
    const driverProfile = await this.prisma.driverProfile.findUnique({ where: { userId: driverUserId } });
    if (!driverProfile) throw new NotFoundException('Profil chauffeur introuvable');

    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking) throw new NotFoundException('Réservation non trouvée');
    if (booking.driverProfileId !== driverProfile.id) throw new ForbiddenException('Accès refusé');
    if (booking.status !== 'in_progress') throw new BadRequestException('Statut incorrect');

    // Libérer le chauffeur + passer en passenger_confirming
    await this.prisma.$transaction([
      this.prisma.booking.update({
        where: { id: bookingId },
        data: { status: 'passenger_confirming' as any, completedAt: new Date() },
      }),
      this.prisma.driverProfile.update({
        where: { id: driverProfile.id },
        data: { totalRides: { increment: 1 }, isAvailable: true },
      }),
    ]);

    this.ridesGateway.server
      .to(`passenger:${booking.passengerId}`)
      .emit('booking:pending_passenger_confirmation', { id: bookingId });
    this.ridesGateway.server
      .to(`passenger:${booking.passengerId}`)
      .emit('booking_status_changed', { id: bookingId, status: 'passenger_confirming' });
    this.notifications.sendToUser(
      booking.passengerId,
      'Confirmez votre arrivée ✅',
      'Votre chauffeur a terminé la course. Confirmez votre arrivée à destination.',
    ).catch(() => {});
    this.audit.log({ action: 'booking.passenger_confirming', entity: 'booking', entityId: bookingId, userId: driverUserId, meta: { estimatedPrice: booking.estimatedPrice } }).catch(() => {});

    return { id: bookingId, status: 'passenger_confirming' };
  }

  // 5.B2 — Passager confirme l'arrivée → finalisation complète
  async confirmRide(passengerId: string, bookingId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { driverProfile: { select: { id: true, userId: true } } },
    });
    if (!booking) throw new NotFoundException('Réservation non trouvée');
    if (booking.passengerId !== passengerId) throw new ForbiddenException('Accès refusé');
    // Idempotent : déjà complétée par le scheduler → retourner succès sans erreur
    if ((booking.status as string) === 'completed') return { id: bookingId, status: 'completed' };
    if ((booking.status as string) !== 'passenger_confirming') throw new BadRequestException('Statut incorrect');
    return this.finalizeRide(booking as any);
  }

  // Méthode de finalisation — appelée par confirmRide + auto-complétion scheduler (5.B4)
  async finalizeRide(booking: any) {
    // F5.4 — Idempotence : si confirmRide et autoCompletePassengerConfirming se déclenchent
    // simultanément, on évite cashback double + commission double. UpdateMany conditionnel
    // ne passe que si le statut est encore 'passenger_confirming'. Si 0 row affectée,
    // un autre process a déjà finalisé → on sort sans rejouer les side-effects.
    const transition = await this.prisma.booking.updateMany({
      where: { id: booking.id, status: 'passenger_confirming' as any },
      data: { status: 'completed' },
    });
    if (transition.count === 0) {
      this.logger.log(`[finalizeRide] ${booking.id} déjà finalisé — skip side-effects`);
      return { id: booking.id, status: 'completed' };
    }

    // B6 — Trouver ou créer la conversation passager↔chauffeur
    let rideConversationId: string | undefined;
    if (booking.driverProfile?.userId) {
      try {
        const existingConv = await this.prisma.conversation.findFirst({
          where: { passengerId: booking.passengerId, driverId: booking.driverProfile.userId },
          select: { id: true },
        });
        rideConversationId = existingConv?.id ?? (await this.prisma.conversation.create({
          data: { passengerId: booking.passengerId, driverId: booking.driverProfile.userId },
          select: { id: true },
        })).id;
      } catch (e) {
        this.logger.warn(`[FinalizeRide] Conversation find/create failed: ${e.message}`);
      }
    }

    this.ridesGateway.server.to(`passenger:${booking.passengerId}`).emit('booking:completed', { id: booking.id, conversationId: rideConversationId });
    this.ridesGateway.server.to(`passenger:${booking.passengerId}`).emit('booking_status_changed', { id: booking.id, status: 'completed' });
    this.ridesGateway.server.to(`passenger:${booking.passengerId}`).emit('booking_updated', { id: booking.id, status: 'completed' });
    this.notifications.sendToUser(booking.passengerId, 'Course terminée ✅', 'Votre course est terminée. Merci d\'utiliser AeroGo 24 !').catch(() => {});

    const isF4 = F4_PAYMENT_METHODS.includes(booking.paymentMethod);

    // ── F4 — Capture PaymentIntent (Stripe card = capture manuelle à la fin de course) ──────
    if (isF4) {
      try {
        await this.paymentIntentSvc.capture(booking.id);
      } catch (err) {
        this.logger.warn(`[F4] Capture PaymentIntent échouée pour ${booking.id}: ${err.message}`);
      }
    }

    // F5.1+F5.9 — Versement chauffeur unifié.
    // Tous les paiements actuels passent par F4 (cash inclus dans F4_PAYMENT_METHODS).
    // La branche legacy "wallet/points" était inatteignable (isF4 inclut cash) → supprimée.
    if (isF4 && booking.driverProfile?.id) {
      const grossAmount = Number(booking.estimatedPrice) + Number(booking.discountAmount ?? 0);
      try {
        await this.payoutSvc.creditFromRide({
          bookingId:       booking.id,
          driverProfileId: booking.driverProfile.id,
          grossAmount,
          isCash:          booking.paymentMethod === 'cash',
        });

        // Pour le cash : le passager paie le driver en main. Le driver doit la commission
        // à AeroCab → on enregistre la dette pour qu'elle soit déduite de ses retraits futurs.
        if (booking.paymentMethod === 'cash') {
          const commissionAmount = booking.commissionRate != null
            ? Math.round(grossAmount * booking.commissionRate * 100) / 100
            : await this.computeCommissionAmount(grossAmount, booking.vehicleType, booking.forfaitId ?? null, booking.operatingCountry ?? null);
          await this.cashCommissionSvc.recordDebt(booking.driverProfile.id, commissionAmount)
            .catch((err) => this.logger.warn(`[CashCommission] recordDebt ${booking.id} failed: ${err?.message}`));
        }
      } catch (err) {
        this.logger.warn(`[F4] Payout échoué pour ${booking.id}: ${err.message}`);
      }
    }

    // Cashback passager
    try {
      let cashbackCountryCode: string | null = null;
      if (booking.departureAirport && booking.departureAirport !== 'INTERNATIONAL') {
        const ap = await this.prisma.airport.findUnique({
          where: { iataCode: booking.departureAirport },
          select: { countryCode: true },
        });
        cashbackCountryCode = ap?.countryCode?.toUpperCase() ?? null;
      }
      const cashbackTariffs = await this.settingsService.getTariffsByCountry(cashbackCountryCode);
      const cashbackRate = cashbackTariffs.cashbackRate ?? 0.05;
      const cashbackPtVal = cashbackTariffs.pointValue ?? 1;
      const priceLocal = Number(booking.estimatedPrice) || 0;
      const cashbackPts = Math.floor((priceLocal * cashbackRate) / cashbackPtVal);
      if (cashbackPts > 0) {
        await this.points.addPoints(
          booking.passengerId,
          cashbackPts,
          `Cashback ${Math.round(cashbackRate * 100)}% — course ${booking.departureAirport} → ${booking.destination}`,
          'cashback',
        );
        this.logger.log(`[Cashback] +${cashbackPts} pts → passager ${booking.passengerId}`);
      }

      // Cashback bonus fidélité (Silver +5%, Gold +10%, Platinum +15%)
      const passengerTier = await this.usersService.getPassengerTier(booking.passengerId);
      const tierBonusRate = this.usersService.getTierCashbackRate(passengerTier) / 100;
      if (tierBonusRate > 0) {
        const bonusPts = Math.floor((priceLocal * tierBonusRate) / cashbackPtVal);
        if (bonusPts > 0) {
          await this.points.addPoints(
            booking.passengerId,
            bonusPts,
            `Bonus fidélité ${passengerTier} +${Math.round(tierBonusRate * 100)}%`,
            'loyalty',
          );
          this.logger.log(`[LoyaltyBonus] +${bonusPts} pts (${passengerTier}) → passager ${booking.passengerId}`);
        }
      }
    } catch (e: any) {
      // F5.2 — Cashback robuste : trace pour audit + retry possible plus tard
      this.logger.error(`[Cashback] failed booking=${booking.id} passenger=${booking.passengerId}: ${e?.message}`);
      this.audit.log({
        action: 'cashback.failed',
        entity: 'booking',
        entityId: booking.id,
        userId: booking.passengerId,
        meta: { error: e?.message, stack: e?.stack?.slice?.(0, 500) },
      }).catch(() => {});
    }

    // F5.3 — Reçu électronique : enqueue pour retry si échec (pas seulement fire-and-forget)
    this.enqueueReceiptJob(booking.id).catch((err) => {
      this.logger.warn(`[Receipt] enqueue failed booking ${booking.id}: ${err.message}`);
    });

    // F5.6 — Prompt rating au passager (socket + FCM via app)
    if (booking.driverProfile?.userId) {
      this.ridesGateway.server
        .to(`passenger:${booking.passengerId}`)
        .emit('rating:prompt', {
          bookingId: booking.id,
          driverUserId: booking.driverProfile.userId,
        });
    }

    // M7 — Bonus parrainage au premier trajet complété du filleul.
    // PAR·049 : queue Redis pour retry en cas de crash après marqueur créé.
    try {
      const passenger = await this.prisma.user.findUnique({
        where: { id: booking.passengerId },
        select: { referredBy: true },
      });
      if (passenger?.referredBy) {
        const completedRidesCount = await this.prisma.booking.count({
          where: { passengerId: booking.passengerId, status: 'completed', id: { not: booking.id } },
        });
        if (completedRidesCount === 0) {
          // Bonus 1ère course selon le pays de la course (null = global)
          const tariffs = await this.settingsService.getTariffsByCountry((booking as any).operatingCountry ?? null);
          const onFirstRideBonus = tariffs.referralBonus?.onFirstRide ?? 1000;
          if (onFirstRideBonus > 0) {
            const idempotencyRef = `REFERRAL-FIRST-RIDE-${booking.passengerId}`;
            // PAR·049 — Enqueue avant la transaction pour retry si crash entre marqueur et addPoints
            await this.redis.set(
              `referral:pending:${booking.passengerId}`,
              JSON.stringify({ referrerId: passenger.referredBy, bonus: onFirstRideBonus, bookingId: booking.id }),
              86400,
            ).catch(() => {});
            const referrerWallet = await this.prisma.wallet.findUnique({ where: { userId: passenger.referredBy } });
            if (referrerWallet) {
              await this.prisma.transaction.create({
                data: { walletId: referrerWallet.id, amount: onFirstRideBonus, type: 'deposit', status: 'completed', reference: idempotencyRef },
              });
            }
            await this.points.addPoints(
              passenger.referredBy,
              onFirstRideBonus,
              `Bonus parrainage — 1ère course de votre filleul`,
              'referral',
            );
            // Succès — retirer de la queue retry
            await this.redis.del(`referral:pending:${booking.passengerId}`).catch(() => {});
            this.logger.log(`[Referral] +${onFirstRideBonus} pts → parrain ${passenger.referredBy} (1ère course filleul ${booking.passengerId})`);
          }
        }
      }
    } catch (e: any) {
      // P2002 = unique constraint violation → bonus déjà crédité (race condition gagnée par l'autre appel)
      if (e?.code === 'P2002') {
        await this.redis.del(`referral:pending:${booking.passengerId}`).catch(() => {});
      } else {
        this.logger.warn(`[Referral] Erreur bonus premier trajet: ${e.message}`);
      }
    }

    // WAL·031 — Fidélité Nth course (Platine = course offerte, autres = +X pts)
    try {
      const completedCount = await this.prisma.booking.count({
        where: { passengerId: booking.passengerId, status: 'completed' },
      });
      const nRaw = await this.settingsService.getForCountry('loyalty_bonus_every_n_rides', booking.operatingCountry ?? null, '10');
      const n = parseInt(nRaw, 10) || 10;
      if (completedCount > 0 && completedCount % n === 0) {
        const ref = `LOYALTY-RIDE-${completedCount}-${booking.passengerId}`;
        const currentTier = await this.usersService.getPassengerTier(booking.passengerId).catch(() => 'bronze');
        let bonus: number;
        let label: string;
        if (currentTier === 'platinum') {
          // F8 — Platine : remboursement intégral de la course
          bonus = booking.estimatedPrice;
          label = `🎁 Course offerte Platine — ${completedCount}ème trajet`;
          this.logger.log(`[Loyalty/Platine] Course offerte ${bonus} pts → passager ${booking.passengerId} (${completedCount}e course)`);
        } else {
          const bonusRaw = await this.settingsService.getForCountry('loyalty_bonus_points', booking.operatingCountry ?? null, '500');
          bonus = parseInt(bonusRaw, 10) || 500;
          label = `Fidélité — ${completedCount}ème course`;
          this.logger.log(`[Loyalty] +${bonus} pts → passager ${booking.passengerId} (${completedCount}e course)`);
        }
        const passengerWallet = await this.prisma.wallet.findUnique({ where: { userId: booking.passengerId } });
        if (passengerWallet) {
          await this.prisma.transaction.create({
            data: { walletId: passengerWallet.id, amount: bonus, type: 'deposit', status: 'completed', reference: ref },
          });
        }
        await this.points.addPoints(booking.passengerId, bonus, label, 'loyalty');
      }
    } catch (e: any) {
      if (e?.code !== 'P2002') {
        this.logger.warn(`[Loyalty] Erreur fidélité: ${e.message}`);
      }
    }

    this.audit.log({ action: 'booking.completed', entity: 'booking', entityId: booking.id, userId: booking.passengerId, meta: { finalPrice: booking.estimatedPrice, paymentMethod: booking.paymentMethod } }).catch(() => {});

    this.usersService.updateLoyaltyTier(booking.passengerId).catch(() => {});
    this.usersService.updateTrustScore(booking.passengerId).catch(() => {});

    return { id: booking.id, status: 'completed' };
  }

  async getBookingPositions(userId: string, bookingId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        driverProfile: { select: { userId: true, latitude: true, longitude: true, locationUpdatedAt: true } },
      },
    });

    if (!booking) throw new NotFoundException('Réservation introuvable');

    const isPassenger = booking.passengerId === userId;
    const isDriver = booking.driverProfile?.userId === userId;
    if (!isPassenger && !isDriver) throw new ForbiddenException('Accès refusé');

    let positions = await this.prisma.driverPosition.findMany({
      where: { bookingId },
      select: { latitude: true, longitude: true, recordedAt: true },
      orderBy: { recordedAt: 'asc' },
    });

    // Fallback : si aucune position enregistrée, utiliser la position actuelle du profil chauffeur
    if (positions.length === 0 && booking.driverProfile?.latitude != null && booking.driverProfile?.longitude != null) {
      positions = [{
        latitude: booking.driverProfile.latitude,
        longitude: booking.driverProfile.longitude,
        recordedAt: booking.driverProfile.locationUpdatedAt ?? new Date(),
      }];
    }

    if (positions.length === 0) {
      return { positions: [], etaMinutes: null };
    }

    // Calcul ETA dynamique depuis la dernière position connue
    let etaMinutes: number | null = null;
    const last = positions[positions.length - 1];
    const bk = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      select: { destLat: true, destLng: true, pickupLat: true, pickupLng: true, status: true },
    });
    if (bk) {
      const targetLat = bk.status === 'in_progress' ? bk.destLat : (bk.pickupLat ?? bk.destLat);
      const targetLng = bk.status === 'in_progress' ? bk.destLng : (bk.pickupLng ?? bk.destLng);
      if (targetLat != null && targetLng != null) {
        const distKm = haversineKm(last.latitude, last.longitude, targetLat, targetLng);
        etaMinutes = Math.max(1, Math.ceil((distKm / 40) * 60));
      }
    }

    return { positions, etaMinutes };
  }

  // Admin
  async getAllBookings(status?: string, page = 1, limit = 20) {
    const where = status ? { status: status as any } : {};
    const skip = (page - 1) * limit;

    const [bookings, total] = await Promise.all([
      this.prisma.booking.findMany({
        where,
        include: {
          passenger: { select: { id: true, name: true, phone: true } },
          driverProfile: {
            include: {
              user: { select: { id: true, name: true, phone: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.booking.count({ where }),
    ]);

    return {
      data: bookings,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  // --- ESTIMATION DES PRIX (zone-based) ---
  async estimatePrices(dto: Partial<CreateBookingDto> & { countryCode?: string }) {
    // Pays via countryCode explicite ou aéroport en DB — vérifié EN PREMIER
    let countryCode = dto.countryCode?.toUpperCase() ?? null;
    if (!countryCode && dto.departureAirport) {
      try {
        const airport = await this.prisma.airport.findUnique({
          where: { iataCode: dto.departureAirport.toUpperCase() },
          select: { countryCode: true },
        });
        countryCode = airport?.countryCode?.toUpperCase() ?? null;
      } catch { /* ignore */ }
    }

    const isSupported = await this.settingsService.isCountrySupported(countryCode);
    if (!isSupported) {
      throw new BadRequestException(
        `Le service AeroCab n'est pas encore disponible dans votre pays (${countryCode}). Contactez le support pour plus d'informations.`,
      );
    }

    const distanceKm = await this.computeDistanceKm(dto);

    const tariffs = await this.settingsService.getTariffsByCountry(countryCode);
    const pointValue = tariffs.pointValue ?? 1;

    // Chargement des zones tarifaires actives — cascade aéroport → pays → global
    const zones = await this.zonesService.findForCountry(countryCode ?? null, dto.departureAirport ?? null);

    // Zone unique pour cette distance (commune à tous les types de véhicules)
    const matchedZone = this.zonesService.matchZone(distanceKm, zones);

    if (!matchedZone) {
      const airportLabel = dto.departureAirport
        ? `l'aéroport ${dto.departureAirport.toUpperCase()}`
        : `le pays ${countryCode}`;
      throw new BadRequestException(
        `Aucune zone tarifaire configurée pour ${airportLabel} (distance : ${distanceKm.toFixed(1)} km). Contactez l'administrateur pour configurer les tarifs.`,
      );
    }

    // Prix par type de véhicule — seuls les véhicules ayant un prix dans cette zone sont inclus
    const estimates: Record<string, {
      priceInFcfa: number; priceInPoints: number;
      baseFcfa: number;
      zoneName?: string; label?: string; maxPassengers?: number;
    }> = {};

    for (const vType of Object.keys(tariffs.vehicles)) {
      if (tariffs.vehicles[vType]?.isActive === false) continue;

      const zonePrice = matchedZone.prices[vType];
      // Véhicule non disponible pour cette zone → on ne l'affiche pas
      if (zonePrice === undefined) continue;

      let pts = zonePrice;

      // Supply/demand pricing (offre/demande) — conservé
      try {
        if (dto.departureAirport) {
          pts = await this.pricingService.calculateEstimatedPrice(pts, dto.departureAirport);
        }
      } catch { /* ignore */ }

      // Prix fixe garanti : aucune surcharge contextuelle (modèle Blacklane)
      const priceInFcfa = Math.round(pts * pointValue);
      const baseFcfa    = priceInFcfa;

      estimates[vType] = {
        priceInFcfa,
        priceInPoints: pts,
        baseFcfa,
        zoneName:      matchedZone.name,
        label:         tariffs.vehicles[vType]?.label,
        maxPassengers: tariffs.vehicles[vType]?.maxPassengers,
      };
    }

    this.logger.log(`[Zone Pricing] ${distanceKm.toFixed(1)}km | pays=${countryCode}`);

    return {
      distanceKm,
      countryCode,
      estimates,
      pointValue:         pointValue,
      cashbackRate:       tariffs.cashbackRate  ?? 0.05,
      currency:           tariffs.currency      ?? 'XAF',
      currencySymbol:     tariffs.currencySymbol ?? 'FCFA',
    };
  }

  // ── Job : annulation automatique si vol annulé ────────────────────────────
  // Toutes les 10 minutes, vérifie les bookings actifs liés à un vol
  // Si le vol est annulé → annule le booking + notifie
  @Cron(CronExpression.EVERY_10_MINUTES)
  async checkCancelledFlights() {
    const activeBookings = await this.prisma.booking.findMany({
      where: {
        status: { in: ['pending', 'confirmed'] },
        flightNumber: { not: null },
      },
      select: { id: true, passengerId: true, flightNumber: true },
    });

    if (!activeBookings.length) return;

    const aeroDataBoxKey = this.config.get<string>('AERODATABOX_API_KEY');
    if (!aeroDataBoxKey) return; // pas de clé API → skip

    for (const booking of activeBookings) {
      try {
        const res = await fetch(
          `https://aerodatabox.p.rapidapi.com/flights/number/${booking.flightNumber}`,
          {
            headers: {
              'X-RapidAPI-Key': aeroDataBoxKey,
              'X-RapidAPI-Host': 'aerodatabox.p.rapidapi.com',
            },
          },
        );
        if (!res.ok) continue;

        const data = await res.json() as any[];
        if (!Array.isArray(data) || !data.length) continue;

        const flight = data[0];
        const isCancelled = flight.status === 'Canceled' || flight.status === 'Cancelled';
        if (!isCancelled) continue;

        // Annule le booking + récupère le prix pour remboursement
        const cancelled = await this.prisma.booking.update({
          where: { id: booking.id },
          data: { status: 'cancelled', cancelledAt: new Date() },
          select: { estimatedPrice: true },
        });

        // Rembourse les points au passager
        if (cancelled.estimatedPrice) {
          await this.points.addPoints(booking.passengerId, Math.round(cancelled.estimatedPrice), 'Remboursement — vol annulé', 'refund');
        }

        // Notifie le passager
        await this.notifications.sendToUser(booking.passengerId, 'Vol annulé', `Votre vol ${booking.flightNumber} a été annulé. Votre réservation a été annulée et vos points remboursés.`);

        this.logger.log(`[CancelledFlight] Booking ${booking.id} annulé — vol ${booking.flightNumber} cancelled`);
      } catch (err) {
        this.logger.warn(`[CancelledFlight] Erreur pour booking ${booking.id}: ${err}`);
      }
    }
  }

  // ─── Modification de destination en cours de course ────────────────────────

  async requestDestinationChange(
    passengerId: string,
    bookingId: string,
    newDestination: string,
    newDestLat?: number,
    newDestLng?: number,
  ) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { driverProfile: { include: { user: { select: { id: true, fcmToken: true } } } } },
    });
    if (!booking) throw new NotFoundException('Réservation introuvable');
    if (booking.passengerId !== passengerId) throw new ForbiddenException('Accès refusé');
    if (!['confirmed', 'in_progress'].includes(booking.status)) {
      throw new BadRequestException('Modification de destination impossible dans cet état.');
    }
    if (!booking.driverProfile) {
      throw new BadRequestException('Aucun chauffeur assigné.');
    }

    // Recalcul du prix avec la nouvelle destination
    let newPrice = booking.estimatedPrice;
    if (newDestLat && newDestLng && booking.pickupLat && booking.pickupLng) {
      const R = 6371;
      const startLat = Number(booking.pickupLat);
      const startLng = Number(booking.pickupLng);
      const dLat = (newDestLat - startLat) * Math.PI / 180;
      const dLon = (newDestLng - startLng) * Math.PI / 180;
      const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(startLat * Math.PI / 180) * Math.cos(newDestLat * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
      const distKm = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

      // Charge les tarifs du pays de la course pour recalculer (null = global)
      const tariffs = await this.settingsService.getTariffsByCountry((booking as any).operatingCountry ?? null);
      const priceInFcfa = await this.computeBasePriceForVehicleWithTariffs(distKm, booking.vehicleType, tariffs);
      const pointValue = tariffs.pointValue ?? 1;
      newPrice = Math.ceil(priceInFcfa / pointValue);
    }

    const priceDiff = newPrice - booking.estimatedPrice;

    // Vérifier que le passager a les points si le prix augmente
    if (priceDiff > 0) {
      const wallet = await this.prisma.wallet.findUnique({ where: { userId: passengerId } });
      if (!wallet || wallet.balance < priceDiff) {
        throw new BadRequestException('Solde insuffisant pour couvrir la différence de prix.');
      }
    }

    // Stocker en Redis (TTL 75s — le client a 60s pour répondre, +15s de marge)
    const redisKey = `dest_change:${bookingId}`;
    await this.redis.set(redisKey, JSON.stringify({
      passengerId,
      driverId: booking.driverProfile.userId,
      driverProfileId: booking.driverProfileId,
      newDestination,
      newDestLat,
      newDestLng,
      oldDestination: booking.destination,
      oldPrice: booking.estimatedPrice,
      newPrice,
      priceDiff,
    }), 75);

    // Notifier le chauffeur via WebSocket
    this.ridesGateway.server.to(`driver:${booking.driverProfileId}`).emit('booking:destination_change_request', {
      bookingId,
      oldDestination: booking.destination,
      newDestination,
      oldPrice: booking.estimatedPrice,
      newPrice,
      priceDiff,
    });

    // Notifier le chauffeur via FCM si hors app
    if (booking.driverProfile.user.fcmToken) {
      this.notifications.sendToUser(
        booking.driverProfile.userId,
        'Modification de destination 📍',
        `Le passager souhaite changer la destination : ${newDestination}`,
        { bookingId, type: 'destination_change' },
      ).catch(() => {});
    }

    this.logger.log(`[DestChange] Booking ${bookingId} — demande passager: "${newDestination}" prix ${booking.estimatedPrice}→${newPrice} pts`);
    return { status: 'pending', newPrice, priceDiff, oldPrice: booking.estimatedPrice };
  }

  async respondDestinationChange(driverId: string, bookingId: string, accepted: boolean) {
    const redisKey = `dest_change:${bookingId}`;
    const raw = await this.redis.get(redisKey);
    if (!raw) throw new BadRequestException('La demande a expiré ou n\'existe pas.');

    const data = JSON.parse(raw) as {
      passengerId: string;
      driverId: string;
      driverProfileId: string;
      newDestination: string;
      newDestLat?: number;
      newDestLng?: number;
      oldDestination: string;
      oldPrice: number;
      newPrice: number;
      priceDiff: number;
    };

    if (data.driverId !== driverId) throw new ForbiddenException('Accès refusé');

    await this.redis.del(redisKey);

    if (!accepted) {
      // Notifier le passager du refus
      this.ridesGateway.notifyPassenger(data.passengerId, 'booking:destination_change_response', {
        bookingId, accepted: false,
        oldDestination: data.oldDestination,
      });
      return { accepted: false };
    }

    // Accepté : ajuster le solde et mettre à jour la réservation
    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking) throw new NotFoundException('Réservation introuvable');

    await this.prisma.$transaction(async (tx) => {
      // Débit ou remboursement de la différence
      if (data.priceDiff > 0) {
        await tx.wallet.update({
          where: { userId: data.passengerId },
          data: { balance: { decrement: data.priceDiff } },
        });
        await tx.pointsTransaction.create({
          data: {
            userId: data.passengerId,
            points: -data.priceDiff,
            type: 'debit',
            label: `Supplément destination: ${data.newDestination}`,
            source: 'payment',
          },
        });
      } else if (data.priceDiff < 0) {
        const refund = Math.abs(data.priceDiff);
        await tx.wallet.upsert({
          where: { userId: data.passengerId },
          create: { userId: data.passengerId, balance: refund },
          update: { balance: { increment: refund } },
        });
        await tx.pointsTransaction.create({
          data: {
            userId: data.passengerId,
            points: refund,
            type: 'credit',
            label: `Remboursement destination: ${data.newDestination}`,
            source: 'refund',
          },
        });
      }

      // Mettre à jour la réservation
      await tx.booking.update({
        where: { id: bookingId },
        data: {
          destination: data.newDestination,
          estimatedPrice: data.newPrice,
          ...(data.newDestLat ? { destLat: data.newDestLat } : {}),
          ...(data.newDestLng ? { destLng: data.newDestLng } : {}),
        },
      });
    });

    // Notifier le passager de l'acceptation
    this.ridesGateway.notifyPassenger(data.passengerId, 'booking:destination_change_response', {
      bookingId, accepted: true,
      newDestination: data.newDestination,
      newPrice: data.newPrice,
      priceDiff: data.priceDiff,
    });

    this.logger.log(`[DestChange] Booking ${bookingId} accepté par chauffeur — "${data.newDestination}" ${data.priceDiff > 0 ? '+' : ''}${data.priceDiff} pts`);
    return { accepted: true, newDestination: data.newDestination, newPrice: data.newPrice };
  }

  // ── Driver ride history ────────────────────────────────────────────────────

  async getDriverRideHistory(
    driverUserId: string,
    filter: 'all' | 'today' | 'week' | 'month' | 'cancelled' = 'all',
    page = 1,
  ) {
    const driverProfile = await this.prisma.driverProfile.findUnique({ where: { userId: driverUserId } });
    if (!driverProfile) throw new NotFoundException('Profil chauffeur introuvable');

    const limit = 20;
    const skip = (page - 1) * limit;

    const now = new Date();
    let dateFilter: any = undefined;
    let statusFilter: any = { in: ['completed', 'cancelled'] };

    if (filter === 'today') {
      const start = new Date(now); start.setHours(0, 0, 0, 0);
      dateFilter = { gte: start };
    } else if (filter === 'week') {
      const start = new Date(now);
      start.setDate(now.getDate() - now.getDay() + (now.getDay() === 0 ? -6 : 1));
      start.setHours(0, 0, 0, 0);
      dateFilter = { gte: start };
    } else if (filter === 'month') {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      dateFilter = { gte: start };
    } else if (filter === 'cancelled') {
      statusFilter = 'cancelled';
    }

    const where: any = {
      driverProfileId: driverProfile.id,
      status: statusFilter,
      ...(dateFilter ? { createdAt: dateFilter } : {}),
    };

    const [rides, total] = await Promise.all([
      this.prisma.booking.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, status: true, type: true,
          departureAirport: true, destination: true,
          estimatedPrice: true, estimatedDistanceKm: true, estimatedDurationMin: true,
          pricingMode: true, createdAt: true, completedAt: true,
          passenger: { select: { name: true, avatarUrl: true } },
        },
      }),
      this.prisma.booking.count({ where }),
    ]);

    return {
      rides: rides.map((r) => ({
        id: r.id,
        status: r.status,
        type: r.type,
        departureAirport: r.departureAirport,
        destination: r.destination,
        estimatedPrice: r.estimatedPrice,
        estimatedDistanceKm: (r as any).estimatedDistanceKm ?? null,
        estimatedDurationMin: (r as any).estimatedDurationMin ?? null,
        pricingMode: r.pricingMode,
        createdAt: r.createdAt,
        completedAt: (r as any).completedAt ?? null,
        passengerName: (r.passenger as any)?.name ?? null,
        passengerAvatarUrl: (r.passenger as any)?.avatarUrl ?? null,
      })),
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getDriverRideDetail(driverUserId: string, bookingId: string) {
    const driverProfile = await this.prisma.driverProfile.findUnique({ where: { userId: driverUserId } });
    if (!driverProfile) throw new NotFoundException('Profil chauffeur introuvable');

    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        passenger: { select: { name: true, avatarUrl: true } },
      },
    });
    if (!booking) throw new NotFoundException('Réservation introuvable');
    if (booking.driverProfileId !== driverProfile.id) throw new ForbiddenException('Accès refusé');

    return {
      id: booking.id,
      status: booking.status,
      type: booking.type,
      departureAirport: booking.departureAirport,
      destination: booking.destination,
      flightNumber: booking.flightNumber,
      estimatedPrice: booking.estimatedPrice,
      estimatedDistanceKm: (booking as any).estimatedDistanceKm ?? null,
      estimatedDurationMin: (booking as any).estimatedDurationMin ?? null,
      baseFare: (booking as any).baseFare ?? null,
      airportFee: (booking as any).airportFee ?? null,
      pricingMode: booking.pricingMode,
      createdAt: booking.createdAt,
      startedAt: (booking as any).startedAt ?? null,
      completedAt: booking.completedAt ?? null,
      passengerName: (booking.passenger as any)?.name ?? null,
      passengerAvatarUrl: (booking.passenger as any)?.avatarUrl ?? null,
    };
  }

  async getDriverRideReceipt(driverUserId: string, bookingId: string) {
    const detail = await this.getDriverRideDetail(driverUserId, bookingId);

    const date = new Date(detail.createdAt);
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yy = String(date.getFullYear()).slice(-2);
    const reference = `#LR-${dd}${mm}${yy}-${bookingId.slice(-3).toUpperCase()}`;

    return { ...detail, reference };
  }

  // ── Pourboire ────────────────────────────────────────────────────────────────

  async addTip(passengerId: string, bookingId: string, amount: number) {
    if (!amount || amount <= 0) {
      throw new BadRequestException('Le montant du pourboire doit être positif');
    }
    const MAX_TIP = 10000;
    if (amount > MAX_TIP) {
      throw new BadRequestException(`Pourboire maximum : ${MAX_TIP} pts`);
    }

    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, passengerId },
      include: { driverProfile: { include: { user: true } }, payout: true },
    });

    if (!booking) throw new NotFoundException('Réservation introuvable');
    if (booking.status !== 'completed') {
      throw new BadRequestException('Le pourboire ne peut être ajouté qu\'après la fin de la course');
    }
    if (booking.tipAmount > 0) {
      throw new BadRequestException('Un pourboire a déjà été envoyé pour cette course');
    }

    await this.prisma.$transaction(async (tx) => {
      // Débit passager
      const balRes = await tx.pointsTransaction.aggregate({
        where: { userId: passengerId },
        _sum: { points: true },
      });
      const balance = balRes._sum.points ?? 0;
      if (balance < amount) {
        throw new BadRequestException(`Solde insuffisant : ${balance} pts disponibles`);
      }
      await tx.pointsTransaction.create({
        data: { userId: passengerId, type: 'debit', source: 'payment', points: -amount, label: `Pourboire course #${bookingId.slice(-6)}` },
      });

      // Crédit chauffeur
      const driverUserId = booking.driverProfile?.user?.id;
      if (driverUserId) {
        await tx.pointsTransaction.create({
          data: { userId: driverUserId, type: 'credit', source: 'bonus', points: amount, label: `Pourboire reçu #${bookingId.slice(-6)}` },
        });
      }

      // Créer TipTransaction
      await tx.tipTransaction.create({
        data: {
          bookingId,
          payerId: passengerId,
          driverProfileId: booking.driverProfileId!,
          amount,
          currency: booking.currency,
          provider: 'points',
          status: 'captured',
          capturedAt: new Date(),
        },
      });

      // Mettre à jour Booking.tipAmount
      await tx.booking.update({ where: { id: bookingId }, data: { tipAmount: amount } });

      // Mettre à jour BookingPayout.tipAmount si existant
      if (booking.payout) {
        await tx.bookingPayout.update({
          where: { bookingId },
          data: { tipAmount: amount },
        });
      }
    });

    // Notifier le chauffeur
    const driverUserId = booking.driverProfile?.user?.id;
    if (driverUserId) {
      this.notifications.sendToUser(
        driverUserId,
        '💰 Pourboire reçu !',
        `Un passager vous a envoyé ${amount.toLocaleString()} pts de pourboire.`,
      ).catch(() => {});
    }

    await this.audit.log({
      action: 'booking.tip_added',
      entity: 'booking',
      entityId: bookingId,
      userId: passengerId,
      meta: { amount, currency: booking.currency },
    }).catch(() => {});

    return { success: true, amount };
  }

  // ── Appel masqué ────────────────────────────────────────────────────────────

  async initiateCall(userId: string, bookingId: string): Promise<{ phone: string }> {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        passenger: { select: { id: true, phone: true } },
        driverProfile: { include: { user: { select: { id: true, phone: true } } } },
      },
    });

    if (!booking) throw new NotFoundException('Réservation introuvable');

    const isPassenger = booking.passengerId === userId;
    const isDriver    = booking.driverProfile?.userId === userId;

    if (!isPassenger && !isDriver) throw new ForbiddenException('Accès non autorisé');

    const activeStatuses = ['confirmed', 'arrived_at_airport', 'in_progress', 'passenger_confirming'];
    if (!activeStatuses.includes(booking.status)) {
      throw new BadRequestException('Course non active — appel non disponible');
    }

    let phone: string | null;
    if (isPassenger) {
      phone = booking.driverProfile?.user?.phone ?? null;
    } else {
      phone = (booking.passenger as any)?.phone ?? null;
    }

    if (!phone) throw new NotFoundException('Numéro introuvable');

    this.audit.log({
      action: 'call.initiated',
      entity: 'booking',
      entityId: bookingId,
      userId,
      meta: { role: isPassenger ? 'passenger' : 'driver' },
    }).catch(() => {});

    return { phone };
  }
}
