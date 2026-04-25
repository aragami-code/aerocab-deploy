import { Injectable, NotFoundException, InternalServerErrorException, BadRequestException, ForbiddenException, ConflictException, Logger } from '@nestjs/common';
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
    // 0a. Guard : workflow activé/désactivé par l'admin
    const workflowKey = dto.type === 'ARRIVAL' ? 'workflow_arrival_enabled'
      : dto.type === 'DEPARTURE' ? 'workflow_departure_enabled'
      : 'workflow_international_enabled';
    const workflowEnabled = await this.settingsService.get(workflowKey, 'true');
    if (workflowEnabled === 'false') {
      const labels: Record<string, string> = {
        ARRIVAL: 'Arrivée aéroport',
        DEPARTURE: 'Départ vers aéroport',
        INTERNATIONAL: 'Réservation internationale',
      };
      throw new BadRequestException(`Le service "${labels[dto.type] ?? dto.type}" est indisponible pour le moment. Veuillez réessayer ultérieurement.`);
    }

    // 0b. Guard : pas de double réservation active
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

    // ── Forfait check ──────────────────────────────────────────────────────────
    let activeForfait: any = null;
    let pricingMode = 'kilometrage';

    if (dto.forfaitId) {
      // Passager a sélectionné un forfait explicitement
      activeForfait = await this.forfaitsService.findOne(dto.forfaitId).catch(() => null);
      if (activeForfait && !activeForfait.isActive) activeForfait = null;
    } else if (dto.departureAirport && dto.destLat && dto.destLng) {
      // Matching automatique
      activeForfait = await this.forfaitsService.match(
        dto.departureAirport,
        dto.destLat,
        dto.destLng,
        dto.vehicleType,
        dto.type,
      );
    }

    let priceInFcfa: number;
    if (activeForfait) {
      pricingMode = 'forfait';
      priceInFcfa = this.forfaitsService.calculatePrice(activeForfait, {
        night:    this.isNightTime(),
        rain:     dto.rainSurge ?? false,
        rushHour: this.isRushHour(bookingTariffs.surge),
      });
    } else {
      priceInFcfa = await this.computeBasePriceForVehicleWithTariffs(distanceKm, dto.vehicleType, bookingTariffs);
    }
    // ── End forfait check ──────────────────────────────────────────────────────

    const finalPricePoints = Math.ceil(priceInFcfa / bookingPointValue);

    this.logger.log(`[Pricing] Distance: ${distanceKm.toFixed(2)}km | FCFA: ${priceInFcfa} | Points: ${finalPricePoints} (pointValue=${bookingPointValue})`);

    // 2. Surge Pricing (offre/demande) — skipped for forfait (price already fixed)
    let dynamicPricePoints = finalPricePoints;
    let supplyDemandMultiplier = 1.0;
    let surgeCtx: { multiplier: number; nightSurge: boolean; rainSurge: boolean; rushHourSurge: boolean };
    let finalSurgeMultiplier = 1.0;

    if (!activeForfait) {
      try {
        dynamicPricePoints = await this.pricingService.calculateEstimatedPrice(finalPricePoints, dto.departureAirport);
        supplyDemandMultiplier = finalPricePoints > 0 ? dynamicPricePoints / finalPricePoints : 1.0;
      } catch (err) {
        this.logger.warn(`Surge Pricing failed, using base points: ${err.message}`);
      }

      // 3. Surcharges contextuelles (nuit / pluie / heure de pointe)
      surgeCtx = await this.computeSurgeContextWithTariffs(dto, bookingTariffs);
      dynamicPricePoints = Math.round(dynamicPricePoints * surgeCtx.multiplier);
      finalSurgeMultiplier = Math.round(supplyDemandMultiplier * surgeCtx.multiplier * 100) / 100;
      this.logger.log(`[Surge] offre/demande=${supplyDemandMultiplier.toFixed(2)} ctx=${surgeCtx.multiplier.toFixed(2)} total=${finalSurgeMultiplier.toFixed(2)} nuit=${surgeCtx.nightSurge} pluie=${surgeCtx.rainSurge} rush=${surgeCtx.rushHourSurge}`);

      // 3b. Surcharge INTERNATIONAL (configurable via admin)
      if (dto.type === 'INTERNATIONAL') {
        const surchargeRaw = await this.settingsService.get('international_surcharge_percent', '0');
        const surchargePercent = Math.max(0, parseFloat(surchargeRaw) || 0);
        if (surchargePercent > 0) {
          dynamicPricePoints = Math.round(dynamicPricePoints * (1 + surchargePercent / 100));
          this.logger.log(`[Pricing] Surcharge INTERNATIONAL +${surchargePercent}% → ${dynamicPricePoints} pts`);
        }
      }
    } else {
      // Forfait: surges already included in calculatePrice; set neutral surge context
      surgeCtx = { multiplier: 1.0, nightSurge: false, rainSurge: false, rushHourSurge: false };
      this.logger.log(`[Pricing] Forfait mode — surges intégrés dans le tarif forfaitaire`);
    }

    // 3c. Verrou de prix : tolérance lue depuis AppSetting (0.B16)
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
        discountAmount = Math.min(promo.discount, dynamicPricePoints);
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

    // S141 — Dispatch lock : claim atomique du premier driver via Redis SET NX EX.
    // Deux bookings concurrents ne peuvent pas obtenir le même driver simultanément.
    // TTL = 120s (fenêtre max accept/decline). Libéré dans accept/decline/cancel.
    let driver: (typeof eligibleDrivers)[0] | null = null;
    for (const candidate of eligibleDrivers) {
      const acquired = await this.redis.setNx(`dispatch:lock:${candidate.id}`, 'locked', 120);
      if (acquired) { driver = candidate; break; }
    }

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
        const mapsKey = await this.settingsService.get('google_maps_key')
          || this.config.get<string>('GOOGLE_MAPS_API_KEY', '');
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
      if (dto.paymentMethod === 'wallet' || dto.paymentMethod === 'points') {
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
          // Forfait
          forfaitId:   activeForfait?.id ?? null,
          pricingMode: pricingMode,
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

      // 2. Enregistrement audit du débit (wallet.balance déjà décrémenté atomiquement ci-dessus)
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
    } catch (err: any) {
      // S177 — Index unique partiel sur passenger_id : doublon concurrent → 400 propre
      if (err?.code === 'P2002' || err?.message?.includes('booking_passenger_one_active')) {
        if (driver) this.redis.del(`dispatch:lock:${driver.id}`).catch(() => {});
        throw new BadRequestException('Vous avez déjà une réservation en cours');
      }
      if (driver) this.redis.del(`dispatch:lock:${driver.id}`).catch(() => {});
      throw err;
    }

    // Bonus for first booking — count exclut la course qui vient d'être créée
    const totalBookings = await this.prisma.booking.count({
      where: { passengerId, id: { not: booking.id } },
    });
    if (totalBookings === 0) {
      const firstRideBonus = parseInt(await this.settingsService.get('first_ride_bonus_points', '500'), 10) || 500;
      this.points.addPoints(passengerId, firstRideBonus, 'Bonus première course').catch(() => {});
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
          flightNumber: booking.flightNumber,
          destination: booking.destination,
          vehicleType: booking.vehicleType,
          estimatedPrice: booking.estimatedPrice,
          departureAirport: booking.departureAirport,
          isPreLanding: isPreLanding,
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
        OR: [
          { status: { in: ['pending', 'confirmed', 'arrived_at_airport', 'in_progress', 'passenger_confirming'] } },
          {
            status: { in: ['passenger_confirming', 'completed'] },
            withConsigne: true,
            OR: [{ consigneStatus: null }, { consigneStatus: 'active' }],
          },
        ],
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
    const lateCancelRate = parseFloat(await this.settingsService.get('late_cancel_refund_rate', '0.5')) || 0.5;
    const refundRate = isLateCancel ? lateCancelRate : 1.0;
    const pointsToRefund = Math.ceil(price * refundRate);
    const penaltyPoints  = Math.floor(price * (1 - refundRate));

    // C4 — Annulation + remboursement dans une même transaction atomique.
    const cancelled = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.booking.update({
        where: { id: bookingId },
        data: { status: 'cancelled', cancelledAt: new Date() },
      });

      const isPointsPayment = booking.paymentMethod === 'wallet' || booking.paymentMethod === 'points';

      // Remboursement passager (100% ou 50%) — wallet + audit
      if (isPointsPayment && pointsToRefund > 0) {
        await tx.pointsTransaction.create({
          data: {
            userId: passengerId,
            type: 'credit',
            points: pointsToRefund,
            label: `Remboursement ${isLateCancel ? '50%' : '100%'} annulation course ${bookingId.slice(0, 8)}${isLateCancelBy48h ? ' (< 48h avant vol)' : ''}`,
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

    // S141 — Libère le dispatch lock : driver accepté, la course est confirmée.
    this.redis.del(`dispatch:lock:${driverProfile.id}`).catch(() => {});

    this.ridesGateway.server.to(`passenger:${passengerId}`).emit('booking:accepted', { id: bookingId, status: 'confirmed' });
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

    // S141 — Libère le dispatch lock : driver disponible pour d'autres courses.
    this.redis.del(`dispatch:lock:${driverProfile.id}`).catch(() => {});

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
      // Aucun chauffeur disponible — remboursement + fin de recherche
      const price = Number(booking.estimatedPrice) || 0;
      const isPoints = booking.paymentMethod === 'wallet' || booking.paymentMethod === 'points';

      await this.prisma.$transaction(async (tx) => {
        await tx.booking.update({
          where: { id: bookingId },
          data: { driverProfileId: null, status: 'no_driver_available' },
        });
        if (isPoints && price > 0) {
          await tx.pointsTransaction.create({
            data: {
              userId: booking.passengerId,
              type: 'credit',
              points: price,
              label: `Remboursement aucun chauffeur — course ${bookingId.slice(0, 8)}`,
            },
          });
          await tx.wallet.upsert({
            where: { userId: booking.passengerId },
            update: { balance: { increment: price } },
            create: { userId: booking.passengerId, balance: price },
          });
        }
      });

      this.ridesGateway.notifyPassenger(booking.passengerId, 'booking_status_changed', { id: bookingId, status: 'no_driver_available' });
      this.notifications.sendToUser(booking.passengerId, 'Aucun chauffeur disponible', 'Nous n\'avons trouvé aucun chauffeur disponible. Veuillez réessayer dans quelques minutes.').catch(() => {});
      this.audit.log({ action: 'booking.no_driver_available', entity: 'booking', entityId: bookingId, userId: driverUserId, meta: { declinedByDriverProfileId: driverProfile.id } }).catch(() => {});

      return { id: bookingId, status: 'no_driver_available' };
    }
  }

  // ── D2 : Panne chauffeur ────────────────────────────────────────────────────
  async reportBreakdown(driverUserId: string, bookingId: string) {
    const driverProfile = await this.prisma.driverProfile.findUnique({
      where: { userId: driverUserId },
      include: { user: { select: { id: true } } },
    });
    if (!driverProfile) throw new NotFoundException('Profil chauffeur introuvable');

    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } });
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
        flightNumber: booking.flightNumber,
        destination: booking.destination,
        vehicleType: booking.vehicleType,
        estimatedPrice: booking.estimatedPrice,
        departureAirport: booking.departureAirport,
        seats: await this.getVehicleSeats(booking.vehicleType),
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
        OR: [
          { status: { in: ['confirmed', 'arrived_at_airport', 'in_progress'] } },
          {
            status: { in: ['passenger_confirming', 'completed'] },
            withConsigne: true,
            OR: [{ consigneStatus: null }, { consigneStatus: 'active' }],
          },
        ],
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
        withConsigne: booking.withConsigne,
        consigneDays: booking.consigneDays,
        consigneDailyRate: booking.consigneDailyRate,
        consigneTotal: booking.consigneTotal,
        consigneStatus: (booking as any).consigneStatus ?? null,
        consigneStartedAt: (booking as any).consigneStartedAt ?? null,
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
    // Idempotent : déjà complétée par le scheduler → retourner succès sans erreur
    if ((booking.status as string) === 'completed') return { id: bookingId, status: 'completed' };
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
    // Le chauffeur est payé sur le PRIX PLEIN (avant promo) — la plateforme absorbe les remises.
    if (booking.driverProfile?.userId && booking.paymentMethod !== 'cash') {
      const rideTariffs = await this.settingsService.getTariffs();
      const commissionRate = parseFloat(await this.settingsService.get('commission_rate', '0.15')) || rideTariffs.commissionRate || 0.15;
      const grossAmount = Number(booking.estimatedPrice) + Number(booking.discountAmount ?? 0);
      // Forfait: use forfait's driverPercent if the booking was priced as forfait
      let driverEarningsPct = 1 - commissionRate;
      if (booking.forfaitId) {
        const forfait = await this.forfaitsService.findOne(booking.forfaitId).catch(() => null);
        if (forfait?.driverPercent != null) driverEarningsPct = forfait.driverPercent / 100;
      }
      const pointsEarned = Math.floor(grossAmount * driverEarningsPct);
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
          const tariffs = await this.settingsService.getTariffs();
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

    // WAL·031 — Fidélité Nth course (+X pts toutes les N courses complétées)
    try {
      const completedCount = await this.prisma.booking.count({
        where: { passengerId: booking.passengerId, status: 'completed' },
      });
      const nRaw = await this.settingsService.get('loyalty_bonus_every_n_rides', '10');
      const n = parseInt(nRaw, 10) || 10;
      if (completedCount > 0 && completedCount % n === 0) {
        const bonusRaw = await this.settingsService.get('loyalty_bonus_points', '500');
        const bonus = parseInt(bonusRaw, 10) || 500;
        const ref = `LOYALTY-RIDE-${completedCount}-${booking.passengerId}`;
        const passengerWallet = await this.prisma.wallet.findUnique({ where: { userId: booking.passengerId } });
        if (passengerWallet) {
          await this.prisma.transaction.create({
            data: { walletId: passengerWallet.id, amount: bonus, type: 'deposit', status: 'completed', reference: ref },
          });
        }
        await this.points.addPoints(booking.passengerId, bonus, `Fidélité — ${completedCount}ème course`);
        this.logger.log(`[Loyalty] +${bonus} pts → passager ${booking.passengerId} (${completedCount}e course)`);
      }
    } catch (e: any) {
      if (e?.code !== 'P2002') {
        this.logger.warn(`[Loyalty] Erreur fidélité: ${e.message}`);
      }
    }

    this.audit.log({ action: 'booking.completed', entity: 'booking', entityId: booking.id, userId: booking.passengerId, meta: { finalPrice: booking.estimatedPrice, paymentMethod: booking.paymentMethod } }).catch(() => {});

    return { id: booking.id, status: 'completed' };
  }

  // ── Consigne du véhicule — lifecycle ───────────────────────────────────────
  // C-D10 : Groupe nécessitant 2 véhicules → 2 bookings indépendants, chacun avec sa propre consigne.
  // Chaque booking est autonome : pas de consigne "partagée". Le passager crée 2 réservations distinctes.

  async startConsigne(bookingId: string, driverUserId: string) {
    const driverProfile = await this.prisma.driverProfile.findUnique({ where: { userId: driverUserId } });
    if (!driverProfile) throw new ForbiddenException('Profil chauffeur introuvable');

    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true, passengerId: true, driverProfileId: true, withConsigne: true,
        consigneDays: true, consigneDailyRate: true, consigneVehicleType: true,
        consigneTotal: true, consigneStatus: true, status: true, paymentMethod: true,
      },
    });

    if (!booking) throw new NotFoundException('Réservation introuvable');
    if (booking.driverProfileId !== driverProfile.id) throw new ForbiddenException('Cette réservation ne vous appartient pas');
    if (!booking.withConsigne) throw new BadRequestException('Cette réservation n\'inclut pas de consigne');
    if (!['passenger_confirming', 'completed'].includes(booking.status as string))
      throw new BadRequestException('La course doit être terminée pour démarrer la consigne');

    if ((booking.consigneStatus as string) === 'active') return { id: bookingId, consigneStatus: 'active' };
    if (['completed', 'cancelled'].includes(booking.consigneStatus as string))
      throw new BadRequestException(`Consigne déjà ${booking.consigneStatus}`);

    await this.prisma.booking.update({
      where: { id: bookingId },
      data: { consigneStatus: 'active', consigneStartedAt: new Date() },
    });

    this.notifications.sendToUser(
      booking.passengerId,
      'Consigne démarrée 🚗',
      `Votre véhicule est maintenant en consigne pour ${booking.consigneDays} jour(s). Nous vous notifierons à la restitution.`,
    ).catch(() => {});

    this.audit.log({
      action: 'consigne.started', entity: 'booking', entityId: bookingId,
      userId: driverUserId, meta: { consigneDays: booking.consigneDays, dailyRate: booking.consigneDailyRate },
    }).catch(() => {});

    return { id: bookingId, consigneStatus: 'active' };
  }

  async endConsigne(bookingId: string, driverUserId: string) {
    const driverProfile = await this.prisma.driverProfile.findUnique({ where: { userId: driverUserId } });
    if (!driverProfile) throw new ForbiddenException('Profil chauffeur introuvable');

    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true, passengerId: true, driverProfileId: true, withConsigne: true,
        consigneDays: true, consigneDailyRate: true, consigneVehicleType: true,
        consigneTotal: true, consigneStatus: true, consigneStartedAt: true, paymentMethod: true,
      },
    });

    if (!booking) throw new NotFoundException('Réservation introuvable');
    if (booking.driverProfileId !== driverProfile.id) throw new ForbiddenException('Cette réservation ne vous appartient pas');
    if ((booking.consigneStatus as string) !== 'active') throw new BadRequestException('La consigne n\'est pas active');

    const startedAt = booking.consigneStartedAt ?? new Date();
    const hoursElapsed = (Date.now() - startedAt.getTime()) / (1000 * 60 * 60);
    const actualDays = Math.max(1, Math.ceil(hoursElapsed));
    const dailyRate = Number(booking.consigneDailyRate) || 0;
    const finalTotal = actualDays * dailyRate;
    const now = new Date();

    const rideTariffs = await this.settingsService.getTariffs();
    const commissionRate = parseFloat(await this.settingsService.get('commission_rate', '0.15')) || rideTariffs.commissionRate || 0.15;
    const driverEarnings = Math.floor(finalTotal * (1 - commissionRate));

    await this.prisma.$transaction(async (tx) => {
      await tx.booking.update({
        where: { id: bookingId },
        data: {
          consigneStatus: 'completed',
          consigneEndedAt: now,
          consigneActualDays: actualDays,
          consigneFinalTotal: finalTotal,
        },
      });

      // Débit passager (wallet uniquement — la consigne n'est pas payée en cash)
      if (finalTotal > 0 && booking.paymentMethod !== 'cash') {
        await tx.wallet.upsert({
          where: { userId: booking.passengerId },
          update: { balance: { decrement: finalTotal } },
          create: { userId: booking.passengerId, balance: -finalTotal },
        });
        await tx.pointsTransaction.create({
          data: {
            userId: booking.passengerId,
            type: 'debit',
            points: Math.ceil(finalTotal),
            label: `Consigne véhicule — ${actualDays}j × ${dailyRate.toLocaleString()} FCFA`,
          },
        });
      }

      // Crédit chauffeur
      if (driverEarnings > 0 && booking.paymentMethod !== 'cash') {
        await tx.wallet.upsert({
          where: { userId: driverUserId },
          update: { balance: { increment: driverEarnings } },
          create: { userId: driverUserId, balance: driverEarnings },
        });
        await tx.transaction.create({
          data: {
            walletId: (await tx.wallet.findUnique({ where: { userId: driverUserId } }))!.id,
            amount: driverEarnings,
            type: 'deposit',
            status: 'completed',
            reference: `CONSIGNE-EARN-${bookingId}`,
            metadata: { bookingId, actualDays, dailyRate, finalTotal, commissionRate },
          },
        });
      }
    });

    const extraDays = actualDays - (booking.consigneDays ?? 0);
    const passengerMsg = extraDays > 0
      ? `Consigne terminée (${actualDays}j, dont ${extraDays}j de retard). ${finalTotal.toLocaleString()} FCFA débités.`
      : `Consigne terminée. ${finalTotal.toLocaleString()} FCFA débités. Merci d'avoir utilisé AeroGo !`;

    this.notifications.sendToUser(booking.passengerId, 'Consigne terminée ✅', passengerMsg).catch(() => {});

    this.audit.log({
      action: 'consigne.ended', entity: 'booking', entityId: bookingId,
      userId: driverUserId, meta: { actualDays, dailyRate, finalTotal, commissionRate, driverEarnings },
    }).catch(() => {});

    return { id: bookingId, consigneStatus: 'completed', actualDays, finalTotal };
  }

  async cancelConsigne(bookingId: string, passengerId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true, passengerId: true, driverProfileId: true, withConsigne: true,
        consigneStatus: true, consigneStartedAt: true, consigneDailyRate: true,
        consigneDays: true, paymentMethod: true, driverProfile: { select: { userId: true } },
      },
    });

    if (!booking) throw new NotFoundException('Réservation introuvable');
    if (booking.passengerId !== passengerId) throw new ForbiddenException('Accès refusé');
    if (!booking.withConsigne) throw new BadRequestException('Pas de consigne sur cette réservation');
    if (['completed', 'cancelled'].includes(booking.consigneStatus as string))
      throw new BadRequestException(`Consigne déjà ${booking.consigneStatus}`);

    let refundMsg = 'Consigne annulée. Aucun frais facturé.';

    if ((booking.consigneStatus as string) === 'active' && booking.consigneStartedAt) {
      // Charge les jours déjà utilisés
      const hoursElapsed = (Date.now() - booking.consigneStartedAt.getTime()) / (1000 * 60 * 60);
      const daysUsed = Math.max(1, Math.ceil(hoursElapsed));
      const dailyRate = Number(booking.consigneDailyRate) || 0;
      const chargeAmount = daysUsed * dailyRate;

      if (chargeAmount > 0 && booking.paymentMethod !== 'cash') {
        await this.prisma.$transaction(async (tx) => {
          await tx.booking.update({
            where: { id: bookingId },
            data: { consigneStatus: 'cancelled', consigneEndedAt: new Date(), consigneActualDays: daysUsed, consigneFinalTotal: chargeAmount },
          });
          await tx.wallet.upsert({
            where: { userId: passengerId },
            update: { balance: { decrement: chargeAmount } },
            create: { userId: passengerId, balance: -chargeAmount },
          });
          await tx.pointsTransaction.create({
            data: { userId: passengerId, type: 'debit', points: Math.ceil(chargeAmount), label: `Consigne annulée — ${daysUsed}j × ${dailyRate.toLocaleString()} FCFA` },
          });
        });
        refundMsg = `Consigne annulée. ${chargeAmount.toLocaleString()} FCFA facturés pour ${daysUsed} jour(s) déjà écoulé(s).`;
      } else {
        await this.prisma.booking.update({
          where: { id: bookingId },
          data: { consigneStatus: 'cancelled', consigneEndedAt: new Date(), consigneActualDays: daysUsed },
        });
      }
    } else {
      await this.prisma.booking.update({ where: { id: bookingId }, data: { consigneStatus: 'cancelled' } });
    }

    if (booking.driverProfile?.userId) {
      this.notifications.sendToUser(
        booking.driverProfile.userId,
        'Consigne annulée',
        'Le passager a annulé la consigne.',
      ).catch(() => {});
    }

    this.audit.log({ action: 'consigne.cancelled', entity: 'booking', entityId: bookingId, userId: passengerId }).catch(() => {});

    return { id: bookingId, consigneStatus: 'cancelled', message: refundMsg };
  }

  async rateConsigne(bookingId: string, passengerId: string, rating: number) {
    if (rating < 1 || rating > 5 || !Number.isInteger(rating))
      throw new BadRequestException('La note doit être un entier entre 1 et 5');

    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      select: { id: true, passengerId: true, withConsigne: true, consigneStatus: true, consigneRating: true },
    });

    if (!booking) throw new NotFoundException('Réservation introuvable');
    if (booking.passengerId !== passengerId) throw new ForbiddenException('Accès refusé');
    if (!booking.withConsigne) throw new BadRequestException('Pas de consigne sur cette réservation');
    if ((booking.consigneStatus as string) !== 'completed') throw new BadRequestException('La consigne n\'est pas encore terminée');
    if (booking.consigneRating !== null) throw new ConflictException('Cette consigne a déjà été notée');

    await this.prisma.booking.update({
      where: { id: bookingId },
      data: { consigneRating: rating },
    });

    this.audit.log({ action: 'consigne.rated', entity: 'booking', entityId: bookingId, userId: passengerId, meta: { rating } }).catch(() => {});

    return { id: bookingId, consigneRating: rating };
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

      // Charge les tarifs pour recalculer
      const tariffs = await this.settingsService.getTariffs();
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

}
