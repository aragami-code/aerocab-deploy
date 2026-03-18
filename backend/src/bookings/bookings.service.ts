import { Injectable, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { PointsService } from '../points/points.service';

@Injectable()
export class BookingsService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private points: PointsService,
  ) {}

  async createBooking(passengerId: string, dto: CreateBookingDto) {
    try {
    // Find nearest available approved driver
    const driver = await this.prisma.driverProfile.findFirst({
      where: { status: 'approved', isAvailable: true },
      include: {
        user: { select: { id: true, name: true } },
      },
      orderBy: { ratingAvg: 'desc' },
    });

    const booking = await this.prisma.booking.create({
      data: {
        passengerId,
        driverProfileId: driver?.id || null,
        flightNumber: dto.flightNumber || null,
        departureAirport: dto.departureAirport,
        destination: dto.destination,
        vehicleType: dto.vehicleType,
        paymentMethod: dto.paymentMethod,
        estimatedPrice: dto.estimatedPrice,
        status: 'pending',
        driverEtaMinutes: 10,
      },
      include: {
        driverProfile: {
          include: {
            user: { select: { id: true, name: true } },
          },
        },
      },
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
    this.notifications.sendToUser(
      passengerId,
      'Réservation confirmée ✅',
      `Votre course vers ${booking.destination} est enregistrée. Un chauffeur arrive dans ${booking.driverEtaMinutes} min.`,
    ).catch(() => {});

    // Notify driver if assigned
    if (booking.driverProfile) {
      this.notifications.sendToUser(
        booking.driverProfile.user.id,
        'Nouvelle course 🚗',
        `Course vers ${booking.destination} — ${booking.estimatedPrice.toLocaleString()} FCFA`,
      ).catch(() => {});
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
      throw new InternalServerErrorException(e?.message || 'Booking creation failed');
    }
  }

  async getActiveBooking(passengerId: string) {
    const booking = await this.prisma.booking.findFirst({
      where: {
        passengerId,
        status: { in: ['pending', 'confirmed', 'in_progress'] },
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

    const createdAt = new Date(booking.createdAt).getTime();
    const now = Date.now();
    const etaSeconds = (booking.driverEtaMinutes || 10) * 60;
    const elapsed = Math.floor((now - createdAt) / 1000);
    const countdown = Math.max(0, etaSeconds - elapsed);

    return {
      booking: {
        id: booking.id,
        flightNumber: booking.flightNumber,
        expectedArrival: null,
        destination: booking.destination,
        vehicleType: booking.vehicleType,
        vehicleBrand: booking.driverProfile?.vehicleBrand || '',
        vehicleModel: booking.driverProfile?.vehicleModel || '',
        seats: 4,
        estimatedPrice: booking.estimatedPrice,
        driverEtaMinutes: booking.driverEtaMinutes || 10,
        countdownSeconds: countdown,
        shareTripEnabled: booking.shareTripEnabled,
        driverName: booking.driverProfile?.user.name || null,
        driverPhone: booking.driverProfile?.user.phone || null,
      },
    };
  }

  async cancelBooking(passengerId: string, bookingId: string) {
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, passengerId },
    });

    if (!booking) throw new NotFoundException('Réservation introuvable');

    return this.prisma.booking.update({
      where: { id: bookingId },
      data: { status: 'cancelled', cancelledAt: new Date() },
    });
  }

  async getBookingHistory(passengerId: string) {
    return this.prisma.booking.findMany({
      where: { passengerId },
      include: {
        driverProfile: {
          include: {
            user: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
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
