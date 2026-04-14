import { Injectable, NotFoundException, InternalServerErrorException, BadRequestException, ForbiddenException, Logger } from '@nestjs/common';
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
  ) {}

  /** 0.B17 — Capacité d'un type de véhicule depuis AppSetting vehicle_capacity (JSON). */
  private async getVehicleSeats(vehicleType: string): Promise<number> {
    try {
      const raw = await this.settingsService.get('vehicle_capacity', '');
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
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    throw new BadRequestException(
      "Impossible de calculer la distance du trajet. Veuillez vérifier vos adresses de départ et de destination."
    );
  }

  /** Cas 97 : heure locale Cameroun (UTC+1) pour le calcul de surge
   *  Le serveur Render tourne en UTC — on corrige avec +1h */
  private getLocalCameroonHourMinute(): { h: number; m: number } {
    const now = new Date();
    const utcMs = now.getTime();
    const cameroonMs = utcMs + 60 * 60 * 1000; // UTC+1
    const local = new Date(cameroonMs);
    return { h: local.getUTCHours(), m: local.getUTCMinutes() };
  }

  /** Détermine si l'heure actuelle tombe dans la plage nuit (22h-05h) */
  private isNightTime(): boolean {
    const { h } = this.getLocalCameroonHourMinute();
    return h >= 22 || h < 5;
  }

  /** Détermine si l'heure actuelle est en heure de pointe selon la config */
  private isRushHour(surgeConfig: { rushHourStart: string; rushHourEnd: string; rushHourStart2: string; rushHourEnd2: string }): boolean {
    const { h, m } = this.getLocalCameroonHourMinute();
    const toMinutes = (t: string) => {
      const [hh, mm] = t.split(':').map(Number);
      return hh * 60 + mm;
    };
    const current = h * 60 + m;
    const inRange = (s: string, e: string) => current >= toMinutes(s) && current <= toMinutes(e);
    return inRange(surgeConfig.rushHourStart, surgeConfig.rushHourEnd) ||
           inRange(surgeConfig.rushHourStart2, surgeConfig.rushHourEnd2);
  }

  /** Calcule le multiplicateur de surcharge contextuelle */
  /** Calcule le prix total de la consigne (FCFA) */
  private async computeConsignePrice(vehicleType: string, days: number): Promise<{ dailyRate: number; total: number }> {
    const tariffs = await this.settingsService.getTariffs();
    const dailyRate = tariffs.consigne[vehicleType]?.dailyRate ?? 8000;
    return { dailyRate, total: dailyRate * days };
  }

  /** Prix en FCFA basé sur les tarifs DB (avec fallback sur les défauts)
   *  Formule : startupFee + (distanceKm × basePricePerKm × coeff), min = minFare
   *  Le startupFee inclut les `startupMinutes` premières minutes de trajet.
   */
  /** Version de computeSurgeContext acceptant des tarifs déjà chargés */
  private computeSurgeContextWithTariffs(dto: CreateBookingDto, tariffs: import('../settings/settings.service').TariffsConfig) {
    const surge = tariffs.surge;
    const night = this.isNightTime();
    const rush = this.isRushHour(surge);
    const rain = dto.rainSurge === true;
    let multiplier = 1.0;
    if (night) multiplier *= surge.nightMultiplier;
    if (rain)  multiplier *= surge.rainMultiplier;
    if (rush)  multiplier *= surge.rushHourMultiplier;
    return Promise.resolve({ multiplier: Math.round(multiplier * 100) / 100, nightSurge: night, rainSurge: rain, rushHourSurge: rush });
  }

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
    // 0. Guard : pas de double réservation active
    const existingActive = await this.prisma.booking.findFirst({
      where: { passengerId, status: { in: ['pending', 'confirmed', 'arrived_at_airport', 'in_progress'] } },
    });
    if (existingActive) {
      throw new BadRequestException('Vous avez déjà une course en cours. Annulez-la avant d\'en créer une nouvelle.');
    }

    // 1. Distance et prix de base
    const isDeparture = dto.type === 'DEPARTURE';
    const distanceKm = await this.computeDistanceKm(dto);

    // 5.B3 — Guard distance lu depuis AppSetting (max_route_distance_km, défaut 80km)
    const maxRouteRaw = await this.settingsService.get('max_route_distance_km', '80');
    const maxRouteKm = parseFloat(maxRouteRaw) || 80;
    if (dto.type !== 'INTERNATIONAL' && distanceKm > maxRouteKm) {
      throw new BadRequestException('DISTANCE_EXCEEDED');
    }

    // Détecte le pays via l'aéroport pour charger les bons tarifs
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
    const bookingTariffs = await this.settingsService.getTariffsByCountry(bookingCountryCode);
    const bookingPointValue = bookingTariffs.pointValue ?? 1; // pts par unité monétaire locale

    const priceInFcfa = await this.computeBasePriceForVehicleWithTariffs(distanceKm, dto.vehicleType, bookingTariffs);
    const finalPricePoints = Math.ceil(priceInFcfa / bookingPointValue);

    this.logger.log(`[Pricing] Distance: ${distanceKm.toFixed(2)}km | FCFA: ${priceInFcfa} | Points: ${finalPricePoints} (pointValue=${bookingPointValue})`);

    // 2. Surge Pricing (offre/demande)
    let dynamicPricePoints = finalPricePoints;
    let supplyDemandMultiplier = 1.0;
    try {
      dynamicPricePoints = await this.pricingService.calculateEstimatedPrice(finalPricePoints, dto.departureAirport);
      supplyDemandMultiplier = finalPricePoints > 0 ? dynamicPricePoints / finalPricePoints : 1.0;
    } catch (err) {
      this.logger.warn(`Surge Pricing failed, using base points: ${err.message}`);
    }

    // 3. Surcharges contextuelles (nuit / pluie / heure de pointe)
    const surgeCtx = await this.computeSurgeContextWithTariffs(dto, bookingTariffs);
    dynamicPricePoints = Math.round(dynamicPricePoints * surgeCtx.multiplier);
    const finalSurgeMultiplier = Math.round(supplyDemandMultiplier * surgeCtx.multiplier * 100) / 100;
    this.logger.log(`[Surge] offre/demande=${supplyDemandMultiplier.toFixed(2)} ctx=${surgeCtx.multiplier.toFixed(2)} total=${finalSurgeMultiplier.toFixed(2)} nuit=${surgeCtx.nightSurge} pluie=${surgeCtx.rainSurge} rush=${surgeCtx.rushHourSurge}`);

    // 3b. Verrou de prix : tolérance lue depuis AppSetting (0.B16)
    const toleranceRaw = await this.settingsService.get('price_change_tolerance_percent', '5');
    const priceTolerance = (parseFloat(toleranceRaw) || 5) / 100;

    if (dto.expectedPriceFcfa && dto.expectedPriceFcfa > 0) {
      const diff = Math.abs(dynamicPricePoints - dto.expectedPriceFcfa) / dto.expectedPriceFcfa;
      if (diff > priceTolerance) {
        throw new BadRequestException(
          JSON.stringify({
            code: 'PRICE_CHANGED',
            previousPrice: dto.expectedPriceFcfa,
            newPrice: dynamicPricePoints,
            message: `Le prix a changé : ${dto.expectedPriceFcfa.toLocaleString()} → ${dynamicPricePoints.toLocaleString()} FCFA. Veuillez confirmer le nouveau prix.`,
          }),
        );
      }
    }

    // 4. Consigne du véhicule (si demandée)
    let consigneTotal = 0;
    let consigneDailyRate = 0;
    const consigneVehicleType = dto.consigneVehicleType || dto.vehicleType;
    if (dto.withConsigne && dto.consigneDays && dto.consigneDays > 0) {
      const consigne = await this.computeConsignePrice(consigneVehicleType, dto.consigneDays);
      consigneTotal = consigne.total;
      consigneDailyRate = consigne.dailyRate;
      this.logger.log(`[Consigne] ${dto.consigneDays}j × ${consigneDailyRate} FCFA = ${consigneTotal} FCFA`);

      // Verrou de prix consigne : même tolérance
      if (dto.expectedConsigneFcfa && dto.expectedConsigneFcfa > 0) {
        const diff = Math.abs(consigneTotal - dto.expectedConsigneFcfa) / dto.expectedConsigneFcfa;
        if (diff > priceTolerance) {
          throw new BadRequestException(
            JSON.stringify({
              code: 'CONSIGNE_PRICE_CHANGED',
              previousPrice: dto.expectedConsigneFcfa,
              newPrice: consigneTotal,
              message: `Le tarif consigne a changé : ${dto.expectedConsigneFcfa.toLocaleString()} → ${consigneTotal.toLocaleString()} FCFA. Veuillez confirmer le nouveau tarif.`,
            }),
          );
        }
      }
    }

    // Applique le code promo si fourni (sur les points)
    let pointsAfterDiscount = dynamicPricePoints;
    let discountAmount = 0;
    let appliedPromoCode: string | null = null;

    // C3 — validatePromo hors-transaction (lecture seule, OK).
    // applyPromo (incrément usedCount) est différé à l'intérieur du $transaction
    // pour éviter qu'un booking raté laisse une promo "brûlée".
    if (dto.promoCode) {
      const promo = await this.promosService.validatePromo(dto.promoCode, passengerId);
      if (promo) {
        discountAmount = Math.round(dynamicPricePoints * (promo.discount / 100));
        pointsAfterDiscount = dynamicPricePoints - discountAmount;
        appliedPromoCode = dto.promoCode.toUpperCase();
      }
    }
    // applyPromoCode est transmis à la transaction ci-dessous

    // Calcule l'ETA selon l'heure d'atterrissage du vol (modèle Blacklane)
    // Le driver est TOUJOURS assigné à la réservation, même si le vol est dans plusieurs heures.
    // Il reçoit les infos du vol dès le début et s'organise en conséquence.
    let driverEtaMinutes = 10; // défaut sans vol
    let scheduledLandingMinutes: number | null = null;

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
          driverEtaMinutes = minutesUntilLanding + 15; // atterrissage + sortie aéroport
        }
        // minutesUntilLanding <= 0 → déjà atterri, ETA = 10 min (défaut)
      }
    }

    // Phase 3: Smart Dispatch Activation
    // Determine if Pre-landing (Flight is still in air) or Post-landing (Already arrived or no flight)
    let isPreLanding = false;
    if (scheduledLandingMinutes && scheduledLandingMinutes > 0) {
      isPreLanding = true;
    }

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

    const eligibleDrivers = await this.dispatchService.findEligibleDrivers(
      { departureAirport: dto.departureAirport } as any,
      isPreLanding,
      dispatchCustomCoords,
      dto.withConsigne,
    );

    // Consigne priority: internal drivers first, then external consigne-enabled
    if (dto.withConsigne && eligibleDrivers.length > 0) {
      eligibleDrivers.sort((a: any, b: any) => {
        const aInternal = a.driverType === 'internal' ? 0 : 1;
        const bInternal = b.driverType === 'internal' ? 0 : 1;
        return aInternal - bInternal;
      });
    }

    // FIX: 2-Phase Dispatch (Confirmation flow)
    // If no nearby drivers found, and it's not a pre-landing flight,
    // and the user hasn't already "forced" the booking.
    if (eligibleDrivers.length === 0 && !isPreLanding && dto.force !== 'true') {
      const globalDrivers = await this.dispatchService.findGlobalEligibleDrivers(dto.vehicleType);
      if (globalDrivers.length > 0) {
        throw new BadRequestException('NO_NEARBY_DRIVERS');
      }
    }

    // Initial driver assignment (Selection of the top one from the match for the initial record)
    // but the broadcast will be sent to all.
    const driver = eligibleDrivers.length > 0 ? eligibleDrivers[0] : null;

    // Sanity check: Coordinates (guards against NaN from client)
    const cleanDestLat = (typeof dto.destLat === 'number' && !isNaN(dto.destLat)) ? dto.destLat : null;
    const cleanDestLng = (typeof dto.destLng === 'number' && !isNaN(dto.destLng)) ? dto.destLng : null;
    const cleanPickupLat = (typeof dto.pickupLat === 'number' && !isNaN(dto.pickupLat)) ? dto.pickupLat : null;
    const cleanPickupLng = (typeof dto.pickupLng === 'number' && !isNaN(dto.pickupLng)) ? dto.pickupLng : null;

    // 5.B1 — DEPARTURE : géocoder les coords GPS si pickupAddress absent ou brut
    let resolvedPickupAddress = dto.pickupAddress;
    if (isDeparture && cleanPickupLat && cleanPickupLng) {
      const isRawCoords = !resolvedPickupAddress || /^-?\d+(\.\d+)?\s*[°,]/.test(resolvedPickupAddress);
      if (isRawCoords) {
        const mapsKey = this.config.get<string>('GOOGLE_MAPS_API_KEY', '');
        if (mapsKey) {
          try {
            const geoRes = await fetch(
              `https://maps.googleapis.com/maps/api/geocode/json?latlng=${cleanPickupLat},${cleanPickupLng}&language=fr&key=${mapsKey}`
            );
            const geoData = await geoRes.json() as any;
            if (geoData.status === 'OK' && geoData.results?.[0]) {
              const comps = geoData.results[0].address_components as any[];
              const neighborhood = comps?.find((c: any) =>
                c.types.includes('neighborhood') || c.types.includes('sublocality')
              )?.long_name;
              const route = comps?.find((c: any) => c.types.includes('route'))?.long_name;
              resolvedPickupAddress = neighborhood || route || geoData.results[0].formatted_address;
            }
          } catch { /* ignore — garde la valeur existante */ }
        }
      }
    }

    // Taux de conversion : 1 point = 1 FCFA
    const pointsRequired = Math.ceil(pointsAfterDiscount);

    // Points + booking creation dans une transaction atomique
    // C2 — Ordre critique : booking.create() en PREMIER, débit points en SECOND.
    // Si la création du booking échoue (contrainte DB, erreur), le rollback de la
    // transaction annule également le débit → aucun argent perdu.
    const booking = await this.prisma.$transaction(async (tx) => {
      // Vérification du solde AVANT de toucher quoi que ce soit
      if (dto.paymentMethod === 'wallet' || dto.paymentMethod === 'points') {
        const result = await tx.pointsTransaction.aggregate({
          where: { userId: passengerId },
          _sum: { points: true },
        });
        const balance = result._sum.points ?? 0;

        if (balance < pointsRequired) {
          throw new BadRequestException(
            `Solde insuffisant : ${balance} pts disponibles (Besoin de ${pointsRequired} pts pour ${pointsAfterDiscount} FCFA)`,
          );
        }
      }

      // 1. Créer le booking en premier
      const newBooking = await tx.booking.create({
        data: {
          passengerId,
          driverProfileId: driver?.id || null,
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
          status: 'pending',
          driverEtaMinutes,
          type: dto.type || 'ARRIVAL',
          pickupAddress: resolvedPickupAddress || (isDeparture ? 'Lieu de départ' : 'Aéroport'),
          pickupLat: cleanPickupLat,
          pickupLng: cleanPickupLng,
          // Surcharges
          surgeMultiplier: finalSurgeMultiplier,
          nightSurge: surgeCtx.nightSurge,
          rainSurge: surgeCtx.rainSurge,
          rushHourSurge: surgeCtx.rushHourSurge,
          // Consigne
          withConsigne: dto.withConsigne || false,
          consigneDays: dto.consigneDays || null,
          consigneDailyRate: consigneDailyRate || null,
          consigneVehicleType: dto.withConsigne ? consigneVehicleType : null,
          consigneTotal: consigneTotal || null,
        } as any,
        include: {
          passenger: { select: { name: true } },
          driverProfile: {
            include: {
              user: { select: { id: true, name: true } },
            },
          },
        },
      });

      // 2. Débiter les points APRÈS création booking (même transaction → rollback atomique)
      if (dto.paymentMethod === 'wallet' || dto.paymentMethod === 'points') {
        await tx.pointsTransaction.create({
          data: {
            userId: passengerId,
            type: 'debit',
            points: -pointsRequired,
            label: `Réservation course ${dto.flightNumber || 'URBAN'} (${pointsAfterDiscount} FCFA)`,
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
          },
        });
      }

      return newBooking;
    }) as any;

    // Bonus for first booking — count exclut la course qui vient d'être créée
    const totalBookings = await this.prisma.booking.count({
      where: { passengerId, id: { not: booking.id } },
    });
    if (totalBookings === 0) {
      this.points.addPoints(passengerId, 500, 'Bonus première course').catch(() => {});
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
    // Notify all eligible drivers (Pre-landing: All, Post-landing: Nearby)
    if (eligibleDrivers.length > 0) {
      for (const d of eligibleDrivers) {
        // Send Push Notification
        this.notifications.sendToUser(
          d.userId, 
          'Nouvelle course disponible 🚗',
          `Course vers ${booking.destination} — ${booking.estimatedPrice.toLocaleString()} FCFA`
        ).catch(() => {});

        // Emit Socket.io
        this.ridesGateway.notifyNewBooking(d.id, {
          id: booking.id,
          passengerId: booking.passengerId,
          passengerName: booking.passenger?.name || 'Client',
          flightNumber: booking.flightNumber,
          destination: booking.destination,
          vehicleType: booking.vehicleType,
          estimatedPrice: booking.estimatedPrice,
          departureAirport: booking.departureAirport,
          isPreLanding: isPreLanding,
        });
      }
      this.logger.log(`[Dispatch] Broadcasted booking ${booking.id} to ${eligibleDrivers.length} drivers.`);
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
        status: { in: ['pending', 'confirmed', 'arrived_at_airport', 'in_progress'] },
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
          liveEtaMinutes = 10; // déjà atterri, chauffeur en route
        } else if (scheduled < nowDate) {
          status = 'delayed';
          liveEtaMinutes = 10; // heure dépassée, traiter comme atterri
        } else {
          status = 'on_time';
          // Recalculer l'ETA en temps réel depuis l'heure d'atterrissage
          const minutesUntilLanding = Math.floor((scheduled.getTime() - nowDate.getTime()) / 60000);
          liveEtaMinutes = minutesUntilLanding + 15; // +15 min pour sortie aéroport
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
        seats: await this.getVehicleSeats(booking.vehicleType),
        estimatedPrice: booking.estimatedPrice,
        paymentMethod: booking.paymentMethod,
        driverEtaMinutes: liveEtaMinutes,
        countdownSeconds: countdown,
        shareTripEnabled: booking.shareTripEnabled,
        conversationId,
        driverUserId: booking.driverProfile?.user.id || null,
        driverName: booking.driverProfile?.user.name || null,
        driverPhone: booking.driverProfile?.user.phone || null,
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

    return this.prisma.booking.update({
      where: { id: bookingId },
      data: { shareTripEnabled: enabled },
      select: { id: true, shareTripEnabled: true },
    });
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
    // - pending / confirmed   → remboursement 100% (driver n'a pas encore bougé)
    // - arrived_at_airport    → remboursement 50% (driver a fait le déplacement)
    // - in_progress et au-delà → annulation interdite
    const cancellableStatuses = ['pending', 'confirmed', 'arrived_at_airport'];
    if (!cancellableStatuses.includes(booking.status)) {
      throw new BadRequestException('Cette réservation ne peut plus être annulée');
    }

    const isLateCancel = booking.status === 'arrived_at_airport';
    const price = Number(booking.estimatedPrice) || 0;
    const refundRate = isLateCancel ? 0.5 : 1.0;
    const pointsToRefund = Math.ceil(price * refundRate);
    const penaltyPoints  = Math.floor(price * (1 - refundRate));

    // C4 — Annulation + remboursement dans une même transaction atomique.
    const cancelled = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.booking.update({
        where: { id: bookingId },
        data: { status: 'cancelled', cancelledAt: new Date() },
      });

      const isPointsPayment = booking.paymentMethod === 'wallet' || booking.paymentMethod === 'points';

      // Remboursement passager (100% ou 50%)
      if (isPointsPayment && pointsToRefund > 0) {
        await tx.pointsTransaction.create({
          data: {
            userId: passengerId,
            type: 'credit',
            points: pointsToRefund,
            label: `Remboursement ${isLateCancel ? '50%' : '100%'} annulation course ${bookingId.slice(0, 8)}`,
          },
        });
      }

      // M8 — Compensation pénalité au chauffeur (50% si late cancel)
      if (isLateCancel && isPointsPayment && penaltyPoints > 0 && booking.driverProfile?.userId) {
        await tx.pointsTransaction.create({
          data: {
            userId: booking.driverProfile.userId,
            type: 'credit',
            points: penaltyPoints,
            label: `Compensation annulation tardive course ${bookingId.slice(0, 8)}`,
          },
        });
      }

      return updated;
    });

    // Notifier le chauffeur
    if (booking.driverProfile) {
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

    return cancelled;
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

            const rating = conv ? await this.prisma.rating.findUnique({
              where: {
                fromUserId_conversationId: { fromUserId: passengerId, conversationId: conv.id },
              },
            }) : null;

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
          const rating = await this.prisma.rating.findUnique({
            where: {
              fromUserId_conversationId: { fromUserId: userId, conversationId },
            },
          });
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

    const booking = await this.prisma.booking.findFirst({
      where: { driverProfileId: driverProfile.id, status: 'pending' },
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
        seats: await this.getVehicleSeats(booking.vehicleType),
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
      if (booking.driverProfileId !== driverProfile.id) throw new ForbiddenException('Accès refusé');

      // UPDATE conditionnel : ne passe à 'confirmed' que si encore en 'pending'
      const result = await tx.booking.updateMany({
        where: { id: bookingId, driverProfileId: driverProfile.id, status: 'pending' },
        data: { status: 'confirmed' },
      });

      if (result.count === 0) {
        throw new BadRequestException('Cette course a déjà été acceptée ou annulée');
      }

      return { passengerId: booking.passengerId };
    });

    this.ridesGateway.server.to(`passenger:${passengerId}`).emit('booking:accepted', { id: bookingId });
    this.notifications.sendToUser(passengerId, 'Chauffeur en route 🚗', 'Votre chauffeur a accepté la course et arrive.').catch(() => {});

    this.audit.log({ action: 'booking.accepted', entity: 'booking', entityId: bookingId, userId: driverUserId, meta: { driverProfileId: driverProfile.id } }).catch(() => {});

    return { id: bookingId, status: 'confirmed' };
  }

  async declineBooking(driverUserId: string, bookingId: string) {
    const driverProfile = await this.prisma.driverProfile.findUnique({ where: { userId: driverUserId } });
    if (!driverProfile) throw new NotFoundException('Profil chauffeur introuvable');

    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking) throw new NotFoundException('Réservation non trouvée');
    if (booking.driverProfileId !== driverProfile.id) throw new ForbiddenException('Accès refusé');
    if (booking.status !== 'pending') throw new BadRequestException('Statut incorrect');

    // Cherche un autre driver disponible autour du GPS passager (DEPARTURE) ou de l'aéroport (ARRIVAL)
    // Fix: ne plus utiliser AIRPORT_COORDS hardcodé pour les DEPARTURE
    const redispatchCoords = (booking.type === 'DEPARTURE' && booking.pickupLat && booking.pickupLng)
      ? { lat: Number(booking.pickupLat), lng: Number(booking.pickupLng) }
      : (booking.type !== 'DEPARTURE' && booking.pickupLat && booking.pickupLng)
        ? { lat: Number(booking.pickupLat), lng: Number(booking.pickupLng) }
        : undefined;
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
        passengerName: null,
        flightNumber: booking.flightNumber,
        destination: booking.destination,
        vehicleType: booking.vehicleType,
        estimatedPrice: booking.estimatedPrice,
        departureAirport: booking.departureAirport,
        seats: await this.getVehicleSeats(booking.vehicleType),
      });
      this.notifications.sendToUser(
        nextDriver.user.id,
        'Nouvelle course 🚗',
        `Course vers ${booking.destination} — ${booking.estimatedPrice.toLocaleString()} FCFA`,
      ).catch(() => {});

      this.ridesGateway.notifyPassenger(booking.passengerId, 'booking_status_changed', { id: bookingId, status: 'pending' });
      this.notifications.sendToUser(booking.passengerId, 'Nouveau chauffeur en recherche 🔄', 'Votre chauffeur précédent a refusé. Nous cherchons un autre chauffeur pour vous.').catch(() => {});
      this.audit.log({ action: 'booking.declined', entity: 'booking', entityId: bookingId, userId: driverUserId, meta: { declinedByDriverProfileId: driverProfile.id, reassignedTo: nextDriver.id } }).catch(() => {});

      return { id: bookingId, status: 'pending' };
    } else {
      // Aucun chauffeur disponible — terminer la recherche
      await this.prisma.booking.update({
        where: { id: bookingId },
        data: { driverProfileId: null, status: 'no_driver_available' },
      });

      this.ridesGateway.notifyPassenger(booking.passengerId, 'booking_status_changed', { id: bookingId, status: 'no_driver_available' });
      this.notifications.sendToUser(booking.passengerId, 'Aucun chauffeur disponible', 'Nous n\'avons trouvé aucun chauffeur disponible. Veuillez réessayer dans quelques minutes.').catch(() => {});
      this.audit.log({ action: 'booking.no_driver_available', entity: 'booking', entityId: bookingId, userId: driverUserId, meta: { declinedByDriverProfileId: driverProfile.id } }).catch(() => {});

      return { id: bookingId, status: 'no_driver_available' };
    }
  }

  async getDriverActiveRide(driverUserId: string) {
    const driverProfile = await this.prisma.driverProfile.findUnique({ where: { userId: driverUserId } });
    if (!driverProfile) return { booking: null };

    const booking = await this.prisma.booking.findFirst({
      where: {
        driverProfileId: driverProfile.id,
        status: { in: ['confirmed', 'arrived_at_airport', 'in_progress'] },
      },
      include: { passenger: { select: { id: true, name: true, phone: true } } },
      orderBy: { createdAt: 'desc' },
    });

    if (!booking) return { booking: null };

    // Statut du vol en temps réel
    let flightStatus: {
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
        passengerPhone: (booking.passenger as any)?.phone || null,
        flightNumber: booking.flightNumber,
        flightStatus,
        destination: booking.destination,
        vehicleType: booking.vehicleType,
        estimatedPrice: booking.estimatedPrice,
        departureAirport: booking.departureAirport,
        shareTripEnabled: booking.shareTripEnabled,
        type: booking.type,
        pickupAddress: (booking as any).pickupAddress ?? null,
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

    const updated = await this.prisma.booking.update({
      where: { id: bookingId },
      data: { status: 'in_progress' },
    });

    this.ridesGateway.server.to(`passenger:${booking.passengerId}`).emit('booking_status_changed', { id: updated.id, status: 'in_progress' });
    this.audit.log({ action: 'booking.started', entity: 'booking', entityId: bookingId, userId: driverUserId }).catch(() => {});
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
    if ((booking.status as string) !== 'passenger_confirming') throw new BadRequestException('Statut incorrect');
    return this.finalizeRide(booking as any);
  }

  // Méthode de finalisation — appelée par confirmRide + auto-complétion scheduler (5.B4)
  async finalizeRide(booking: any) {
    await this.prisma.booking.update({
      where: { id: booking.id },
      data: { status: 'completed' },
    });

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

    // Versement wallet chauffeur (après déduction commission plateforme)
    if (booking.driverProfile?.userId && booking.paymentMethod !== 'cash') {
      const rideTariffs = await this.settingsService.getTariffs();
      const commissionRate = rideTariffs.commissionRate ?? 0.15;
      const grossAmount = Number(booking.estimatedPrice);
      const pointsEarned = Math.floor(grossAmount * (1 - commissionRate));
      let driverWallet = await this.prisma.wallet.findUnique({ where: { userId: booking.driverProfile.userId } });
      if (!driverWallet) {
        driverWallet = await this.prisma.wallet.create({ data: { userId: booking.driverProfile.userId, balance: 0 } });
      }
      await this.prisma.wallet.update({
        where: { id: driverWallet.id },
        data: { balance: { increment: pointsEarned } },
      });
      await this.prisma.transaction.create({
        data: {
          walletId: driverWallet.id,
          amount: pointsEarned,
          type: 'deposit',
          status: 'completed',
          reference: `EARN-${booking.id}`,
          metadata: { bookingId: booking.id, passengerId: booking.passengerId, grossAmount, commissionRate, points: pointsEarned },
        },
      });
      this.logger.log(`[Wallet] Credited driver ${booking.driverProfile.userId} with ${pointsEarned} pts (${Math.round(commissionRate*100)}% commission on ${grossAmount}).`);
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
        );
        this.logger.log(`[Cashback] +${cashbackPts} pts → passager ${booking.passengerId}`);
      }
    } catch (e) {
      this.logger.warn(`[Cashback] Erreur: ${e.message}`);
    }

    // M7 — Bonus parrainage au premier trajet complété du filleul.
    // Protection race condition : on tente de créer une Transaction de référence unique
    // REFERRAL-FIRST-RIDE-{passengerId}. Si deux courses terminent simultanément, la
    // contrainte @unique sur Transaction.reference garantit qu'une seule réussit.
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
          const tariffs = await this.settingsService.getTariffs();
          const onFirstRideBonus = tariffs.referralBonus?.onFirstRide ?? 1000;
          if (onFirstRideBonus > 0) {
            // Idempotence : on crée d'abord un marqueur Wallet Transaction avec une
            // reference unique. Si deux appels concurrents arrivent, le second échoue
            // sur la contrainte @unique avant d'appeler addPoints.
            const idempotencyRef = `REFERRAL-FIRST-RIDE-${booking.passengerId}`;
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
            );
            this.logger.log(`[Referral] +${onFirstRideBonus} pts → parrain ${passenger.referredBy} (1ère course filleul ${booking.passengerId})`);
          }
        }
      }
    } catch (e: any) {
      // P2002 = unique constraint violation → bonus déjà crédité (race condition gagnée par l'autre appel)
      if (e?.code !== 'P2002') {
        this.logger.warn(`[Referral] Erreur bonus premier trajet: ${e.message}`);
      }
    }

    this.audit.log({ action: 'booking.completed', entity: 'booking', entityId: booking.id, userId: booking.passengerId, meta: { finalPrice: booking.estimatedPrice, paymentMethod: booking.paymentMethod } }).catch(() => {});

    return { id: booking.id, status: 'completed' };
  }

  async getBookingPositions(userId: string, bookingId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { driverProfile: { select: { userId: true } } },
    });

    if (!booking) throw new NotFoundException('Réservation introuvable');

    const isPassenger = booking.passengerId === userId;
    const isDriver = booking.driverProfile?.userId === userId;
    if (!isPassenger && !isDriver) throw new ForbiddenException('Accès refusé');

    const positions = await this.prisma.driverPosition.findMany({
      where: { bookingId },
      select: { latitude: true, longitude: true, recordedAt: true },
      orderBy: { recordedAt: 'asc' },
    });

    // MOCK: Si aucune position n'est trouvée, on génère un trajet fictif pour le test
    if (positions.length === 0) {
      const b = await this.prisma.booking.findUnique({ where: { id: bookingId } });
      const startLat = 4.0511; // Douala centre
      const startLng = 9.7679;
      const endLat = b?.destLat || 4.0061;
      const endLng = b?.destLng || 9.7197;
      
      const mockPoints = [];
      const steps = 10;
      for (let i = 0; i <= steps; i++) {
        mockPoints.push({
          latitude: startLat + (endLat - startLat) * (i / steps),
          longitude: startLng + (endLng - startLng) * (i / steps),
          recordedAt: new Date(Date.now() - (steps - i) * 60000).toISOString(),
        });
      }
      return { positions: mockPoints };
    }

    return { positions };
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

  // --- ESTIMATION DES PRIX ---
  async estimatePrices(dto: Partial<CreateBookingDto> & { countryCode?: string }) {
    const distanceKm = await this.computeDistanceKm(dto);

    // Détection du pays : priorité au countryCode explicite,
    // sinon on lit le countryCode de l'aéroport en DB
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

    // Charge les tarifs du pays (fallback global → défauts)
    const tariffs = await this.settingsService.getTariffsByCountry(countryCode);

    // Surcharges contextuelles (nuit / pluie / heure de pointe) — utilise la config du pays
    const surgeCtx = await this.computeSurgeContextWithTariffs(dto as CreateBookingDto, tariffs);
    // totalSurgeMultiplier affiché dans la réponse (informatif)
    const totalSurgeMultiplier = surgeCtx.multiplier;

    // Estimation par catégorie de véhicule active — même ordre que createBooking
    const estimates: Record<string, {
      priceInFcfa: number; priceInPoints: number;
      baseFcfa: number; surgeFcfa: number;
      label?: string; maxPassengers?: number;
    }> = {};
    for (const vType of Object.keys(tariffs.vehicles)) {
      if (tariffs.vehicles[vType]?.isActive === false) continue; // skip désactivés
      const basePrice = await this.computeBasePriceForVehicleWithTariffs(distanceKm, vType, tariffs);
      const pointValue = tariffs.pointValue ?? 1;

      // Étape 1 : FCFA → points (identique à createBooking)
      let pts = Math.ceil(basePrice / pointValue);

      // Étape 2 : supply/demand (identique à createBooking)
      try {
        const airportCoords = dto.departureAirport ? await this.resolveAirportCoords(dto.departureAirport) : null;
        if (airportCoords) {
          pts = await this.pricingService.calculateEstimatedPrice(pts, dto.departureAirport!);
        }
      } catch { /* ignore */ }

      // Étape 3 : surcharges contextuelles (identique à createBooking)
      pts = Math.round(pts * surgeCtx.multiplier);

      const surgedFcfa = Math.round(pts * pointValue);
      estimates[vType] = {
        priceInFcfa:   surgedFcfa,
        priceInPoints: pts,
        baseFcfa:      basePrice,
        surgeFcfa:     surgedFcfa - basePrice,
        label:         tariffs.vehicles[vType]?.label,
        maxPassengers: tariffs.vehicles[vType]?.maxPassengers,
      };
    }

    // Tarifs consigne par véhicule
    const consigneDailyRates: Record<string, number> = {};
    for (const vType of Object.keys(tariffs.consigne)) {
      consigneDailyRates[vType] = tariffs.consigne[vType]?.dailyRate ?? 8000;
    }

    // Vérifie si on utilise les tarifs par défaut (aucune config pays en DB)
    const hasCountryConfig = countryCode
      ? (await this.settingsService.getCountriesWithTariffs()).includes(countryCode)
      : false;
    const isDefaultTariff = !hasCountryConfig;

    return {
      distanceKm,
      countryCode,
      isDefaultTariff,
      surgeMultiplier: totalSurgeMultiplier,
      surgeContext: {
        nightSurge:    surgeCtx.nightSurge,
        rainSurge:     surgeCtx.rainSurge,
        rushHourSurge: surgeCtx.rushHourSurge,
        multiplier:    surgeCtx.multiplier,
      },
      estimates,
      consigneEnabled: tariffs.consigneEnabled ?? true,
      consigneDailyRates,
      pointValue:    tariffs.pointValue    ?? 1,
      cashbackRate:  tariffs.cashbackRate  ?? 0.05,
      currency:      tariffs.currency      ?? 'XAF',
      currencySymbol: tariffs.currencySymbol ?? 'FCFA',
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
          await this.points.addPoints(booking.passengerId, Math.round(cancelled.estimatedPrice), 'Remboursement — vol annulé');
        }

        // Notifie le passager
        await this.notifications.sendToUser(booking.passengerId, 'Vol annulé', `Votre vol ${booking.flightNumber} a été annulé. Votre réservation a été annulée et vos points remboursés.`);

        this.logger.log(`[CancelledFlight] Booking ${booking.id} annulé — vol ${booking.flightNumber} cancelled`);
      } catch (err) {
        this.logger.warn(`[CancelledFlight] Erreur pour booking ${booking.id}: ${err}`);
      }
    }
  }

}
