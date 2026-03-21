import { Injectable, NotFoundException, InternalServerErrorException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { PointsService } from '../points/points.service';
import { SettingsService } from '../settings/settings.service';
import { PromosService } from '../promos/promos.service';
import { RidesGateway } from './rides.gateway';
import { Prisma } from '@prisma/client';

// Coordonnées des aéroports desservis
const AIRPORT_COORDS: Record<string, { lat: number; lng: number }> = {
  DLA: { lat: 4.0061, lng: 9.7197 },  // Douala International
  NSI: { lat: 3.7226, lng: 11.5532 }, // Nsimalen — Yaoundé
};

// Rayon de recherche par défaut (km)
const PROXIMITY_RADIUS_KM = 20;

// Table de prix authoritative (ne pas faire confiance au client)
const VEHICLE_PRICES: Record<string, number> = {
  eco:         5000,
  eco_plus:    6000,
  standard:    7000,
  confort:     10000,
  confort_plus: 12000,
};

// Capacité par type de véhicule
const VEHICLE_SEATS: Record<string, number> = {
  eco:         4,
  eco_plus:    4,
  standard:    5,
  confort:     5,
  confort_plus: 7,
};

@Injectable()
export class BookingsService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private points: PointsService,
    private settingsService: SettingsService,
    private promosService: PromosService,
    private ridesGateway: RidesGateway,
    private config: ConfigService,
  ) {}

  /** Recherche le vol via AviationStack et le sauvegarde en DB si introuvable */
  private async fetchAndSaveFlight(passengerId: string, flightNumber: string) {
    const apiKey = this.config.get<string>('AVIATIONSTACK_API_KEY');
    if (!apiKey) return null;
    try {
      const res = await fetch(
        `http://api.aviationstack.com/v1/flights?access_key=${apiKey}&flight_iata=${flightNumber}`,
      );
      const data = (await res.json()) as { data?: any[] };
      if (!data.data?.length) return null;
      const f = data.data[0];
      const scheduledArrival = f.arrival?.scheduled || f.arrival?.estimated;
      if (!scheduledArrival) return null;
      return this.prisma.flight.create({
        data: {
          userId: passengerId,
          flightNumber: flightNumber.toUpperCase(),
          airline: f.airline?.name || null,
          origin: f.departure?.airport || null,
          destination: f.arrival?.airport || null,
          arrivalAirport: (f.arrival?.iata || 'DLA').toUpperCase(),
          scheduledArrival: new Date(scheduledArrival),
          actualArrival: f.arrival?.actual ? new Date(f.arrival.actual) : null,
          source: 'api',
        },
      });
    } catch {
      return null;
    }
  }

  // Sélectionne le meilleur driver selon le mode actif (proximité ou rating)
  private async findBestDriver(departureAirport: string, excludeDriverId?: string) {
    const proximityEnabled = await this.settingsService.isProximityAssignmentEnabled();
    const excludeClause = excludeDriverId ? Prisma.sql`AND id != ${excludeDriverId}::uuid` : Prisma.sql``;

    if (proximityEnabled) {
      const coords = AIRPORT_COORDS[departureAirport];
      if (coords) {
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
            HAVING 6371 * acos(
                LEAST(1.0,
                  cos(radians(${coords.lat})) * cos(radians(latitude))
                  * cos(radians(longitude) - radians(${coords.lng}))
                  + sin(radians(${coords.lat})) * sin(radians(latitude))
                )
              ) <= ${PROXIMITY_RADIUS_KM}
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
      },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { ratingAvg: 'desc' },
    });
  }

  async createBooking(passengerId: string, dto: CreateBookingDto) {
    try {
    // Prix autoritatif depuis la table backend (ignore la valeur du client)
    const authorizedPrice = VEHICLE_PRICES[dto.vehicleType];
    if (!authorizedPrice) {
      throw new BadRequestException(`Type de véhicule invalide: ${dto.vehicleType}`);
    }

    // Applique le code promo si fourni
    let finalPrice = authorizedPrice;
    let discountAmount = 0;
    let appliedPromoCode: string | null = null;

    if (dto.promoCode) {
      const promo = await this.promosService.validatePromo(dto.promoCode);
      if (promo) {
        discountAmount = Math.round(authorizedPrice * (promo.discount / 100));
        finalPrice = authorizedPrice - discountAmount;
        appliedPromoCode = dto.promoCode.toUpperCase();
        // Incrémente le compteur d'utilisation
        this.promosService.applyPromo(dto.promoCode).catch(() => {});
      }
    }

    // Calcule l'ETA réel selon l'heure d'atterrissage du vol
    // Si le vol n'est pas encore atterri, on ne dispatche pas le driver immédiatement
    let driverEtaMinutes = 10; // défaut sans vol
    let shouldDispatchNow = true;
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
        if (minutesUntilLanding > 30) {
          // Passager encore en vol — chauffeur sera notifié 30 min avant atterrissage
          shouldDispatchNow = false;
          scheduledLandingMinutes = minutesUntilLanding;
          driverEtaMinutes = minutesUntilLanding + 15; // atterrissage + sortie aéroport
        } else if (minutesUntilLanding > 0) {
          // Atterrissage imminent — dispatcher maintenant
          driverEtaMinutes = minutesUntilLanding + 15;
        }
        // minutesUntilLanding <= 0 → déjà atterri, ETA = 10 min (défaut)
      }
    }

    // Sélection du driver selon le paramètre activé (seulement si dispatch immédiat)
    const driver = shouldDispatchNow ? await this.findBestDriver(dto.departureAirport) : null;

    // Points + booking creation dans une transaction atomique
    const booking = await this.prisma.$transaction(async (tx) => {
      if (dto.paymentMethod === 'points') {
        const pointsNeeded = Math.ceil(finalPrice / 100); // 1 pt = 100 FCFA
        const balResult = await tx.pointsTransaction.aggregate({
          where: { userId: passengerId },
          _sum: { points: true },
        });
        const balance = balResult._sum.points ?? 0;
        if (balance < pointsNeeded) {
          throw new BadRequestException(
            `Solde de points insuffisant : ${balance} pts disponibles, ${pointsNeeded} pts requis`,
          );
        }
        await tx.pointsTransaction.create({
          data: {
            userId: passengerId,
            type: 'debit',
            points: -pointsNeeded,
            label: `Course ${dto.departureAirport} → ${dto.destination}`,
          },
        });
      }

      return tx.booking.create({
        data: {
          passengerId,
          driverProfileId: driver?.id || null,
          flightNumber: dto.flightNumber || null,
          departureAirport: dto.departureAirport,
          destination: dto.destination,
          destLat: dto.destLat ?? null,
          destLng: dto.destLng ?? null,
          vehicleType: dto.vehicleType,
          paymentMethod: dto.paymentMethod,
          estimatedPrice: finalPrice,
          promoCode: appliedPromoCode,
          discountAmount,
          status: 'pending',
          driverEtaMinutes,
        },
        include: {
          driverProfile: {
            include: {
              user: { select: { id: true, name: true } },
            },
          },
        },
      });
    });

    // Credit loyalty points (1 pt per 100 FCFA)
    const earnedPoints = Math.floor(booking.estimatedPrice / 100);
    if (earnedPoints > 0) {
      this.points.addPoints(
        passengerId,
        earnedPoints,
        `Course — ${booking.departureAirport} → ${booking.destination}`,
      ).catch(() => {});
    }

    // Bonus for first booking
    const totalBookings = await this.prisma.booking.count({ where: { passengerId } });
    if (totalBookings === 1) {
      this.points.addPoints(passengerId, 500, 'Bonus première course').catch(() => {});
    }

    // Notify passenger
    const passengerMsg = !shouldDispatchNow && scheduledLandingMinutes !== null
      ? `Réservation enregistrée. Votre chauffeur sera dépêché 30 min avant votre atterrissage (dans ~${scheduledLandingMinutes} min).`
      : `Votre course vers ${booking.destination} est enregistrée. Un chauffeur arrive dans ${booking.driverEtaMinutes} min.`;
    this.notifications.sendToUser(
      passengerId,
      'Réservation confirmée ✅',
      passengerMsg,
    ).catch(() => {});

    // Notify driver if assigned
    if (booking.driverProfile) {
      this.notifications.sendToUser(
        booking.driverProfile.user.id,
        'Nouvelle course 🚗',
        `Course vers ${booking.destination} — ${booking.estimatedPrice.toLocaleString()} FCFA`,
      ).catch(() => {});

      // Emit socket to driver's personal room
      this.ridesGateway.server
        .to(`driver:${booking.driverProfileId}`)
        .emit('booking:new_request', {
          id: booking.id,
          passengerId: booking.passengerId,
          passengerName: null,
          flightNumber: booking.flightNumber,
          destination: booking.destination,
          vehicleType: booking.vehicleType,
          estimatedPrice: booking.estimatedPrice,
          departureAirport: booking.departureAirport,
          seats: VEHICLE_SEATS[booking.vehicleType] ?? 4,
        });
    }

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
      console.error('[BookingsService] createBooking error:', e?.message, e?.code, e?.meta);
      if (e instanceof BadRequestException) throw e;
      throw new InternalServerErrorException('Booking creation failed');
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

    return {
      booking: {
        id: booking.id,
        status: booking.status,
        flightNumber: booking.flightNumber,
        flightStatus,
        destination: booking.destination,
        vehicleType: booking.vehicleType,
        vehicleBrand: booking.driverProfile?.vehicleBrand || '',
        vehicleModel: booking.driverProfile?.vehicleModel || '',
        seats: VEHICLE_SEATS[booking.vehicleType] ?? 4,
        estimatedPrice: booking.estimatedPrice,
        paymentMethod: booking.paymentMethod,
        driverEtaMinutes: liveEtaMinutes,
        countdownSeconds: countdown,
        shareTripEnabled: booking.shareTripEnabled,
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
    });

    if (!booking) throw new NotFoundException('Réservation introuvable');
    if (!['pending', 'confirmed'].includes(booking.status)) {
      throw new BadRequestException('Cette réservation ne peut plus être annulée');
    }

    return this.prisma.booking.update({
      where: { id: bookingId },
      data: { status: 'cancelled', cancelledAt: new Date() },
    });
  }

  async getBookingHistory(passengerId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
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
    return { data: bookings, total, page, limit };
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
        seats: VEHICLE_SEATS[booking.vehicleType] ?? 4,
      },
    };
  }

  async acceptBooking(driverUserId: string, bookingId: string) {
    const driverProfile = await this.prisma.driverProfile.findUnique({ where: { userId: driverUserId } });
    if (!driverProfile) throw new NotFoundException('Profil chauffeur introuvable');

    // Vérifie d'abord que la course appartient bien à ce driver
    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking) throw new NotFoundException('Réservation non trouvée');
    if (booking.driverProfileId !== driverProfile.id) throw new ForbiddenException('Accès refusé');

    // UPDATE atomique : passe à 'confirmed' seulement si toujours en 'pending'
    // Empêche deux drivers d'accepter la même course en cas de race condition
    const result = await this.prisma.booking.updateMany({
      where: { id: bookingId, driverProfileId: driverProfile.id, status: 'pending' },
      data: { status: 'confirmed' },
    });

    if (result.count === 0) {
      throw new BadRequestException('Cette course n\'est plus disponible');
    }

    this.ridesGateway.server.to(`passenger:${booking.passengerId}`).emit('booking:accepted', { id: bookingId });
    this.notifications.sendToUser(booking.passengerId, 'Chauffeur en route 🚗', 'Votre chauffeur a accepté la course et arrive.').catch(() => {});

    return { id: bookingId, status: 'confirmed' };
  }

  async declineBooking(driverUserId: string, bookingId: string) {
    const driverProfile = await this.prisma.driverProfile.findUnique({ where: { userId: driverUserId } });
    if (!driverProfile) throw new NotFoundException('Profil chauffeur introuvable');

    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking) throw new NotFoundException('Réservation non trouvée');
    if (booking.driverProfileId !== driverProfile.id) throw new ForbiddenException('Accès refusé');
    if (booking.status !== 'pending') throw new BadRequestException('Statut incorrect');

    // Cherche un autre driver disponible (en excluant celui qui refuse)
    const nextDriver = await this.findBestDriver(booking.departureAirport, driverProfile.id);

    // Réassigne à un nouveau driver ou laisse orphelin si aucun disponible
    const updated = await this.prisma.booking.update({
      where: { id: bookingId },
      data: { driverProfileId: nextDriver?.id ?? null },
      include: {
        driverProfile: { include: { user: { select: { id: true, name: true } } } },
      },
    });

    // Notifie le nouveau driver s'il y en a un
    if (nextDriver && updated.driverProfile) {
      this.notifications.sendToUser(
        nextDriver.user.id,
        'Nouvelle course 🚗',
        `Course vers ${booking.destination} — ${booking.estimatedPrice.toLocaleString()} FCFA`,
      ).catch(() => {});

      this.ridesGateway.server.to(`driver:${nextDriver.id}`).emit('booking:new_request', {
        id: booking.id,
        passengerId: booking.passengerId,
        passengerName: null,
        flightNumber: booking.flightNumber,
        destination: booking.destination,
        vehicleType: booking.vehicleType,
        estimatedPrice: booking.estimatedPrice,
        departureAirport: booking.departureAirport,
        seats: VEHICLE_SEATS[booking.vehicleType] ?? 4,
      });
    }

    return { id: bookingId, status: 'pending' };
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

    return {
      booking: {
        id: booking.id,
        status: booking.status,
        passengerId: booking.passengerId,
        passengerName: (booking.passenger as any)?.name || null,
        passengerPhone: (booking.passenger as any)?.phone || null,
        flightNumber: booking.flightNumber,
        destination: booking.destination,
        vehicleType: booking.vehicleType,
        estimatedPrice: booking.estimatedPrice,
        departureAirport: booking.departureAirport,
        shareTripEnabled: booking.shareTripEnabled,
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
    this.notifications.sendToUser(booking.passengerId, 'Chauffeur arrivé 📍', 'Votre chauffeur est à l\'aéroport.').catch(() => {});

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

    return { id: updated.id, status: updated.status };
  }

  async completeRide(driverUserId: string, bookingId: string) {
    const driverProfile = await this.prisma.driverProfile.findUnique({ where: { userId: driverUserId } });
    if (!driverProfile) throw new NotFoundException('Profil chauffeur introuvable');

    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking) throw new NotFoundException('Réservation non trouvée');
    if (booking.driverProfileId !== driverProfile.id) throw new ForbiddenException('Accès refusé');
    if (booking.status !== 'in_progress') throw new BadRequestException('Statut incorrect');

    const [updated] = await this.prisma.$transaction([
      this.prisma.booking.update({
        where: { id: bookingId },
        data: { status: 'completed', completedAt: new Date() },
      }),
      this.prisma.driverProfile.update({
        where: { id: driverProfile.id },
        data: { totalRides: { increment: 1 }, isAvailable: true },
      }),
    ]);

    this.ridesGateway.server.to(`passenger:${booking.passengerId}`).emit('booking:completed', { id: updated.id });
    this.notifications.sendToUser(booking.passengerId, 'Course terminée ✅', 'Votre course est terminée. Merci d\'utiliser AeroCab !').catch(() => {});

    // Points fidélité pour le chauffeur
    const driverUser = await this.prisma.driverProfile.findUnique({
      where: { id: driverProfile.id },
      select: { userId: true },
    });
    if (driverUser) {
      const earnedPoints = Math.floor((booking.estimatedPrice as number) / 200);
      if (earnedPoints > 0) {
        this.points.addPoints(driverUser.userId, earnedPoints, `Course complétée`).catch(() => {});
      }
    }

    return { id: updated.id, status: updated.status };
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
}
