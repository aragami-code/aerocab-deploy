import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RedisService } from '../redis/redis.service';
import { NotchPayService, WITHDRAWAL_METHOD_TO_NOTCHPAY } from '../payments/notchpay.service';
import { FlutterwaveService, WITHDRAWAL_METHOD_TO_FLUTTERWAVE } from '../payments/flutterwave.service';
import { PaymentIntentService } from '../payments/payment-intent.service';
import { VerifyDriverDto, VerificationAction } from './dto';
import { ExportService } from './export.service';

const DOC_LABELS: Record<string, string> = {
  cni_front: 'CNI Recto', cni_back: 'CNI Verso',
  license: 'Permis de conduire', registration: 'Carte grise',
  vehicle_photo: 'Photo du véhicule',
};

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private prisma: PrismaService,
    private settingsService: SettingsService,
    private notifications: NotificationsService,
    private redis: RedisService,
    private notchpay: NotchPayService,
    private flutterwave: FlutterwaveService,
    private exportService: ExportService,
    private paymentIntentSvc: PaymentIntentService,
  ) {}

  // ── Tariffs ──────────────────────────────────────────

  async getTariffs() {
    return this.settingsService.getTariffs();
  }

  async setTariffs(config: any) {
    return this.settingsService.setTariffs(config);
  }

  async getCountriesWithTariffs() {
    return this.settingsService.getCountriesWithTariffs();
  }

  async getTariffsByCountry(countryCode: string) {
    return this.settingsService.getTariffsByCountry(countryCode);
  }

  async setTariffsByCountry(countryCode: string, config: any) {
    await this.settingsService.setTariffsByCountry(countryCode, config);
    return { success: true, countryCode: countryCode.toUpperCase() };
  }

  async deleteTariffsByCountry(countryCode: string) {
    await this.settingsService.deleteTariffsByCountry(countryCode);
    return { success: true, countryCode: countryCode.toUpperCase() };
  }

  // ── Gestion des pays ─────────────────────────────────
  async getAllCountries() {
    return this.prisma.country.findMany({
      select: { code: true, name: true, currency: true, paymentMethods: true, isActive: true },
      orderBy: { code: 'asc' },
    });
  }

  async createCountry(code: string, name: string, currency: string) {
    const cc = code.trim().toUpperCase();
    if (!/^[A-Z]{2,3}$/.test(cc)) throw new Error('Code pays invalide (2-3 lettres majuscules)');
    return this.prisma.country.upsert({
      where: { code: cc },
      update: { name, currency },
      create: { code: cc, name, currency, paymentMethods: [] },
    });
  }

  async deleteCountry(countryCode: string) {
    await this.prisma.country.delete({ where: { code: countryCode.toUpperCase() } });
    return { success: true };
  }

  // ── Payment methods par pays ──────────────────────────
  async getCountryPaymentMethods(countryCode: string) {
    const country = await this.prisma.country.findUnique({
      where: { code: countryCode.toUpperCase() },
      select: { code: true, name: true, paymentMethods: true },
    });
    if (!country) throw new Error(`Pays introuvable : ${countryCode}`);
    return { countryCode: country.code, name: country.name, methods: country.paymentMethods ?? [] };
  }

  async setCountryPaymentMethods(countryCode: string, methods: { id: string; label: string; icon: string }[]) {
    await this.prisma.country.upsert({
      where: { code: countryCode.toUpperCase() },
      update: { paymentMethods: methods },
      create: { code: countryCode.toUpperCase(), name: countryCode.toUpperCase(), paymentMethods: methods },
    });
    return { success: true, countryCode: countryCode.toUpperCase(), methods };
  }

  // ── Chart Data (15 derniers jours) ──────────────────
  async getChartData(country?: string) {
    const cc = country ? country.toUpperCase() : null;
    const bookingWhere = cc ? { operatingCountry: cc } : {};

    const days = 15;
    const result: { day: string; courses: number; revenus: number }[] = [];

    for (let i = days - 1; i >= 0; i--) {
      const start = new Date();
      start.setDate(start.getDate() - i);
      start.setHours(0, 0, 0, 0);

      const end = new Date(start);
      end.setHours(23, 59, 59, 999);

      const [courses, revenusAgg] = await Promise.all([
        this.prisma.booking.count({
          where: { ...bookingWhere, createdAt: { gte: start, lte: end } },
        }),
        this.prisma.booking.aggregate({
          where: { ...bookingWhere, status: 'completed', updatedAt: { gte: start, lte: end } },
          _sum: { estimatedPrice: true },
        }),
      ]);

      result.push({
        day: start.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }),
        courses,
        revenus: revenusAgg._sum.estimatedPrice ?? 0,
      });
    }

    return result;
  }

  // ── Driver Verification ──────────────────────────────

  async getDrivers(status?: string, page = 1, limit = 20) {
    const where = status ? { status: status as any } : {};
    const skip = (page - 1) * limit;

    const [drivers, total] = await Promise.all([
      this.prisma.driverProfile.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              phone: true,
              name: true,
              avatarUrl: true,
              createdAt: true,
            },
          },
          documents: {
            select: {
              id: true,
              type: true,
              fileUrl: true,
              status: true,
              rejectionReason: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.driverProfile.count({ where }),
    ]);

    return {
      data: drivers,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getDriverDetail(driverProfileId: string) {
    const driver = await this.prisma.driverProfile.findUnique({
      where: { id: driverProfileId },
      include: {
        user: {
          select: {
            id: true,
            phone: true,
            name: true,
            email: true,
            avatarUrl: true,
            createdAt: true,
          },
        },
        documents: true,
      },
    });

    if (!driver) {
      throw new NotFoundException('Profil chauffeur introuvable');
    }

    return driver;
  }

  async verifyDriver(driverProfileId: string, dto: VerifyDriverDto) {
    const driver = await this.prisma.driverProfile.findUnique({
      where: { id: driverProfileId },
      include: { documents: true },
    });

    if (!driver) {
      throw new NotFoundException('Profil chauffeur introuvable');
    }

    if (dto.action === VerificationAction.APPROVE) {
      // Approve driver + all pending documents
      await this.prisma.$transaction([
        this.prisma.driverProfile.update({
          where: { id: driverProfileId },
          data: {
            status: 'approved',
            verifiedAt: new Date(),
            ...(dto.vehicleCategory ? { vehicleCategory: dto.vehicleCategory } : {}),
          },
        }),
        this.prisma.driverDocument.updateMany({
          where: {
            driverProfileId,
            status: 'pending',
          },
          data: { status: 'approved', verifiedAt: new Date() },
        }),
      ]);

      this.logger.log(`Driver approved/reactivated: ${driverProfileId}`);
      return { message: 'Chauffeur approuve avec succes', status: 'approved' };
    }

    if (dto.action === VerificationAction.SUSPEND) {
      await this.prisma.driverProfile.update({
        where: { id: driverProfileId },
        data: { status: 'suspended' },
      });

      this.logger.log(`Driver suspended: ${driverProfileId}`);
      return { message: 'Chauffeur suspendu avec succes', status: 'suspended' };
    }

    if (dto.action === VerificationAction.REJECT) {
      if (!dto.reason) {
        throw new BadRequestException(
          'Un motif de rejet est requis',
        );
      }

      await this.prisma.driverProfile.update({
        where: { id: driverProfileId },
        data: { status: 'rejected' },
      });

      this.logger.log(`Driver rejected: ${driverProfileId} - ${dto.reason}`);
      return {
        message: 'Chauffeur rejete',
        status: 'rejected',
        reason: dto.reason,
      };
    }

    throw new BadRequestException('Action invalide');
  }

  async verifyDocument(
    documentId: string,
    action: 'approve' | 'reject',
    reason?: string,
  ) {
    const doc = await this.prisma.driverDocument.findUnique({
      where: { id: documentId },
      include: { driverProfile: { select: { userId: true } } },
    });

    if (!doc) throw new NotFoundException('Document introuvable');

    const updated = await this.prisma.driverDocument.update({
      where: { id: documentId },
      data: {
        status: action === 'approve' ? 'approved' : 'rejected',
        rejectionReason: action === 'reject' ? (reason ?? null) : null,
        verifiedAt: action === 'approve' ? new Date() : null,
      },
    });

    // Notification push au chauffeur
    const userId = (doc as any).driverProfile?.userId;
    if (userId) {
      const label = DOC_LABELS[doc.type] ?? doc.type;
      if (action === 'reject') {
        await this.notifications.sendToUser(
          userId,
          'Document refusé',
          reason
            ? `${label} refusé — Motif : ${reason}`
            : `${label} a été refusé. Veuillez le remplacer.`,
          { type: 'document_rejected', screen: 'pending-review', docType: doc.type },
        ).catch(() => {});
      } else {
        await this.notifications.sendToUser(
          userId,
          'Document approuvé ✓',
          `${label} a été approuvé.`,
          { type: 'document_approved', screen: 'pending-review' },
        ).catch(() => {});
      }
    }

    return updated;
  }

  // ── Stats ────────────────────────────────────────────

  async getStats(country?: string) {
    const cc = country ? country.toUpperCase() : null;
    const bookingWhere = cc ? { operatingCountry: cc } : {};
    const userWhere = cc ? { countryCode: cc } : {};
    const driverWhere = cc ? { countryCode: cc } : {};

    const cacheKey = cc ? `admin:stats:${cc}` : 'admin:stats';
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      try { return JSON.parse(cached); } catch { /* recompute */ }
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      totalUsers,
      newUsersToday,
      totalDrivers,
      pendingDrivers,
      approvedDrivers,
      totalBookings,
      pendingBookings,
      activeBookings,
      completedBookings,
      cancelledBookings,
      completedToday,
      revenueAgg,
      revenueTodayAgg,
      pendingKYC,
      pendingWithdrawals,
      pendingWithdrawalsAmount,
      pendingReports,
      unreadNotifications,
    ] = await Promise.all([
      this.prisma.user.count({ where: userWhere }),
      this.prisma.user.count({ where: { ...userWhere, createdAt: { gte: today } } }),
      this.prisma.driverProfile.count({ where: driverWhere }),
      this.prisma.driverProfile.count({ where: { ...driverWhere, status: 'pending' } }),
      this.prisma.driverProfile.count({ where: { ...driverWhere, status: 'approved' } }),
      this.prisma.booking.count({ where: bookingWhere }),
      this.prisma.booking.count({ where: { ...bookingWhere, status: 'pending' } }),
      this.prisma.booking.count({ where: { ...bookingWhere, status: { in: ['confirmed', 'arrived_at_airport', 'in_progress'] } } }),
      this.prisma.booking.count({ where: { ...bookingWhere, status: 'completed' } }),
      this.prisma.booking.count({ where: { ...bookingWhere, status: 'cancelled' } }),
      this.prisma.booking.count({ where: { ...bookingWhere, status: 'completed', updatedAt: { gte: today } } }),
      this.prisma.booking.aggregate({ where: { ...bookingWhere, status: 'completed' }, _sum: { estimatedPrice: true } }),
      this.prisma.booking.aggregate({ where: { ...bookingWhere, status: 'completed', updatedAt: { gte: today } }, _sum: { estimatedPrice: true } }),
      this.prisma.user.count({ where: { ...userWhere, kycStatus: 'submitted' } }),
      (this.prisma as any).withdrawalRequest.count({ where: { status: 'pending' } }),
      (this.prisma as any).withdrawalRequest.aggregate({ where: { status: 'pending' }, _sum: { amount: true } }),
      this.prisma.report.count({ where: { status: 'open' } }),
      (this.prisma as any).adminNotification.count({ where: { read: false } }),
    ]);

    const result = {
      totalUsers,
      newUsersToday,
      totalDrivers,
      pendingDrivers,
      approvedDrivers,
      activeAccessPasses: 0,
      totalRevenue: revenueAgg._sum.estimatedPrice ?? 0,
      revenueToday: revenueTodayAgg._sum.estimatedPrice ?? 0,
      pendingKYC,
      pendingWithdrawals,
      pendingWithdrawalsAmount: pendingWithdrawalsAmount?._sum?.amount ?? 0,
      pendingReports,
      unreadNotifications,
      bookings: {
        total: totalBookings,
        pending: pendingBookings,
        active: activeBookings,
        completed: completedBookings,
        cancelled: cancelledBookings,
        completedToday,
      },
    };

    await this.redis.set(cacheKey, JSON.stringify(result), 60);
    return result;
  }

  async getBookings(status?: string, page = 1, limit = 20) {
    const where: any = {};
    if (status) where.status = status;
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.prisma.booking.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          passenger: { select: { name: true, phone: true } },
          driverProfile: {
            select: {
              driverType: true,
              vehicleBrand: true,
              vehicleModel: true,
              user: { select: { name: true, phone: true } },
            },
          },
        },
      }),
      this.prisma.booking.count({ where }),
    ]);
    return { data, pagination: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async getBookingRatings(bookingId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { driverProfile: { select: { userId: true } } },
    });
    if (!booking) throw new NotFoundException('Réservation introuvable');

    const driverUserId = booking.driverProfile?.userId;
    if (!driverUserId) return { ratings: [] };

    const conversation = await this.prisma.conversation.findFirst({
      where: { passengerId: booking.passengerId, driverId: driverUserId },
    });
    if (!conversation) return { ratings: [] };

    const ratings = await this.prisma.rating.findMany({
      where: { conversationId: conversation.id },
      include: {
        fromUser: { select: { id: true, name: true, role: true } },
        toUser:   { select: { id: true, name: true, role: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    return { ratings };
  }

  async cancelBookingAdmin(bookingId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { driverProfile: { select: { id: true, userId: true } } },
    });
    if (!booking) throw new NotFoundException('Réservation introuvable');
    if (['completed', 'cancelled'].includes(booking.status)) {
      throw new BadRequestException('Cette réservation ne peut plus être annulée');
    }

    const price = Number(booking.estimatedPrice) || 0;

    try {
      await this.paymentIntentSvc.refund(bookingId, { reason: 'admin_cancel', penaltyPct: 0 });
    } catch {}

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.booking.updateMany({
        where: { id: bookingId, status: { notIn: ['completed', 'cancelled'] } },
        data: { status: 'cancelled', cancelledAt: new Date() },
      });
      if (updated.count === 0) return;

      if ((booking.paymentMethod === 'wallet' || booking.paymentMethod === 'points') && price > 0) {
        await tx.pointsTransaction.create({
          data: {
            userId: booking.passengerId,
            type: 'credit',
            points: price,
            label: `Remboursement annulation admin — course ${bookingId.slice(0, 8)}`,
            source: 'refund',
          },
        });
        await tx.wallet.upsert({
          where: { userId: booking.passengerId },
          update: { balance: { increment: price } },
          create: { userId: booking.passengerId, balance: price },
        });
      }

      if (booking.driverProfile?.id) {
        await tx.driverProfile.update({
          where: { id: booking.driverProfile.id },
          data: { isAvailable: true },
        }).catch(() => {});
      }
    });

    this.notifications.sendToUser(booking.passengerId, 'Course annulée', `Votre course a été annulée par l'administration. Vous avez été remboursé.`).catch(() => {});
    if (booking.driverProfile?.userId) {
      this.notifications.sendToUser(booking.driverProfile.userId, 'Course annulée', `La course ${bookingId.slice(0, 8)} a été annulée par l'administration.`).catch(() => {});
    }

    return { success: true };
  }

  async refundBooking(bookingId: string, adminUserId: string, reason?: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { paymentIntent: true },
    });
    if (!booking) throw new NotFoundException('Réservation introuvable');

    // Déjà remboursé ?
    if (booking.paymentIntent?.refundedAt) {
      throw new BadRequestException('Cette réservation a déjà été remboursée');
    }

    const amount = booking.estimatedPrice ?? 0;
    if (amount <= 0) throw new BadRequestException('Montant de remboursement nul');

    await this.prisma.$transaction(async (tx) => {
      await tx.pointsTransaction.create({
        data: {
          userId: booking.passengerId,
          type: 'credit',
          source: 'refund',
          points: amount,
          label: `Remboursement course #${bookingId.slice(-6)}${reason ? ` — ${reason}` : ''}`,
        },
      });

      await tx.wallet.upsert({
        where: { userId: booking.passengerId },
        update: { balance: { increment: amount } },
        create: { userId: booking.passengerId, balance: amount },
      });

      if (booking.paymentIntent) {
        await tx.paymentIntent.update({
          where: { bookingId },
          data: {
            status: 'refunded',
            refundedAt: new Date(),
            adminNote: reason ?? null,
          },
        });
      }
    });

    // Notifier le passager
    this.notifications.sendToUser(
      booking.passengerId,
      '💚 Remboursement effectué',
      `${amount.toLocaleString()} pts ont été crédités sur votre portefeuille${reason ? ` (${reason})` : ''}.`,
    ).catch(() => {});

    this.logger.log(`Refund booking ${bookingId} — ${amount} pts → user ${booking.passengerId} by admin ${adminUserId}`);

    return { success: true, amount, passengerId: booking.passengerId };
  }

  async updateDriverProfile(driverId: string, data: { driverType?: string }) {
    return this.prisma.driverProfile.update({
      where: { id: driverId },
      data,
    });
  }

  // ── Users Management ─────────────────────────────────

  async getUsers(role?: string, page = 1, limit = 20) {
    const where = role ? { role: role as any } : {};
    const skip = (page - 1) * limit;

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          phone: true,
          name: true,
          email: true,
          role: true,
          status: true,
          avatarUrl: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      data: users,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // ── Reports ──────────────────────────────────────────

  async getReports(status?: string, page = 1, limit = 20) {
    const where = status ? { status: status as any } : {};
    const skip = (page - 1) * limit;

    const [reports, total] = await Promise.all([
      this.prisma.report.findMany({
        where,
        include: {
          reporter: { select: { id: true, phone: true, name: true } },
          reported: { select: { id: true, phone: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.report.count({ where }),
    ]);

    return {
      data: reports,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }


  // ── 6.B1 — Active bookings (real-time) ───────────────

  async getActiveBookings() {
    return this.prisma.booking.findMany({
      where: { status: { in: ['confirmed', 'arrived_at_airport', 'in_progress'] as any[] } },
      include: {
        passenger: { select: { name: true, phone: true } },
        driverProfile: {
          select: {
            user: { select: { name: true, phone: true } },
            vehicleBrand: true,
            vehicleModel: true,
            driverType: true,
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  // ── 6.B2 — Online drivers ─────────────────────────────

  async getOnlineDrivers() {
    return this.prisma.driverProfile.findMany({
      where: { isAvailable: true, status: 'approved' as any },
      select: {
        id: true,
        driverType: true,
        vehicleBrand: true,
        vehicleModel: true,
        latitude: true,
        longitude: true,
        totalRides: true,
        user: { select: { name: true, phone: true, avatarUrl: true } },
      },
    });
  }

  // ── 6.B3 — Revenue metrics ────────────────────────────

  async getRevenueMetrics(period: 'day' | 'week' | 'month' = 'day') {
    const now = new Date();
    let startDate: Date;
    switch (period) {
      case 'week':  startDate = new Date(now.getTime() - 7  * 24 * 60 * 60 * 1000); break;
      case 'month': startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); break;
      default:
        startDate = new Date(now);
        startDate.setHours(0, 0, 0, 0);
    }

    const bookings = await this.prisma.booking.findMany({
      where: { status: 'completed', completedAt: { gte: startDate } },
      select: { estimatedPrice: true, type: true, completedAt: true },
    });

    const totalRevenue = bookings.reduce((sum, b) => sum + (b.estimatedPrice ?? 0), 0);
    const byType = bookings.reduce<Record<string, { count: number; revenue: number }>>(
      (acc, b) => {
        const t = b.type ?? 'unknown';
        if (!acc[t]) acc[t] = { count: 0, revenue: 0 };
        acc[t].count++;
        acc[t].revenue += b.estimatedPrice ?? 0;
        return acc;
      },
      {},
    );

    return { period, from: startDate, to: now, totalRides: bookings.length, totalRevenue, byType };
  }

  // ── Rapport financier avec plage de dates ─────────────

  async getFinancialReport(from: string, to: string) {
    const fromDate = new Date(from);
    const toDate   = new Date(to);
    const [bookings, commissionRateSetting] = await Promise.all([
      this.prisma.booking.findMany({
        where: { status: 'completed', completedAt: { gte: fromDate, lte: toDate } },
        select: { estimatedPrice: true, type: true, vehicleType: true },
      }),
      this.settingsService.get('commission_rate', '0.15'),
    ]);
    const rate = parseFloat(commissionRateSetting) || 0.15;
    const totalRevenue  = bookings.reduce((s, b) => s + (b.estimatedPrice ?? 0), 0);
    const commission    = Math.round(totalRevenue * rate);
    const driverPayouts = totalRevenue - commission;
    const byType = bookings.reduce<Record<string, { count: number; revenue: number }>>((acc, b) => {
      const t = b.type ?? 'unknown';
      if (!acc[t]) acc[t] = { count: 0, revenue: 0 };
      acc[t].count++;
      acc[t].revenue += b.estimatedPrice ?? 0;
      return acc;
    }, {});
    return { from: fromDate.toISOString(), to: toDate.toISOString(), totalBookings: bookings.length, totalRevenue, commission, driverPayouts, byType };
  }

  // ── 6.B4 — Suspend / reactivate driver ───────────────

  async suspendDriver(driverProfileId: string, action: 'suspend' | 'reactivate') {
    const driver = await this.prisma.driverProfile.findUnique({ where: { id: driverProfileId } });
    if (!driver) throw new NotFoundException('Profil chauffeur introuvable');
    const newStatus = action === 'suspend' ? 'suspended' : 'approved';
    return this.prisma.driverProfile.update({
      where: { id: driverProfileId },
      data: { status: newStatus as any },
    });
  }

  // ── 6.B5 — Update user status ─────────────────────────

  async updateUserStatus(userId: string, status: 'active' | 'suspended') {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Utilisateur introuvable');
    return this.prisma.user.update({ where: { id: userId }, data: { status: status as any } });
  }

  // ── 6.B7/B8 — Tariff snapshots ────────────────────────

  async getTariffSnapshots() {
    return (this.prisma as any).tariffSnapshot.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, countryCode: true, createdAt: true, createdBy: true },
    });
  }

  async setTariffsWithSnapshot(config: any, adminUserId?: string) {
    const current = await this.settingsService.getTariffs();
    await (this.prisma as any).tariffSnapshot.create({
      data: { data: current as any, createdBy: adminUserId ?? null },
    });
    return this.settingsService.setTariffs(config);
  }

  async rollbackTariffs(snapshotId: string) {
    const snapshot = await (this.prisma as any).tariffSnapshot.findUnique({ where: { id: snapshotId } });
    if (!snapshot) throw new NotFoundException('Snapshot introuvable');
    return this.settingsService.setTariffs(snapshot.data as any);
  }

  // ── Referrals ─────────────────────────────────────────

  async getReferrals(page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    const [referrals, total] = await Promise.all([
      (this.prisma.user as any).findMany({
        where: { referredBy: { not: null } },
        select: {
          id: true,
          name: true,
          phone: true,
          createdAt: true,
          referrer: {
            select: {
              id: true,
              name: true,
              phone: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.user.count({ where: { referredBy: { not: null } } }),
    ]);

    return {
      data: referrals,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // ── Retraits chauffeurs ──────────────────────────────────────────────────────

  async getWithdrawals(status?: string, page = 1, limit = 20) {
    const skip = Math.max(0, (page - 1) * limit);
    const where = status ? { status: status as any } : {};

    const [data, total] = await Promise.all([
      this.prisma.withdrawalRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          amount: true,
          currency: true,
          method: true,
          mobileNumber: true,
          status: true,
          adminNote: true,
          processedAt: true,
          createdAt: true,
          user: { select: { id: true, name: true, phone: true } },
        },
      }),
      this.prisma.withdrawalRequest.count({ where }),
    ]);

    return { data, pagination: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async processWithdrawal(
    id: string,
    status: 'approved' | 'rejected' | 'paid',
    adminId: string,
    adminNote?: string,
  ) {
    const withdrawal = await this.prisma.withdrawalRequest.findUnique({ where: { id } });
    if (!withdrawal) throw new NotFoundException('Demande de retrait introuvable');
    if (withdrawal.status === 'paid' || withdrawal.status === 'rejected') {
      throw new BadRequestException('Cette demande a déjà été traitée');
    }
    if (status === 'paid' && withdrawal.status !== 'approved') {
      throw new BadRequestException('La demande doit être approuvée avant d\'être marquée comme payée');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      if (status === 'paid') {
        const wallet = await tx.wallet.findUnique({ where: { userId: withdrawal.userId } });
        if (!wallet || Number(wallet.balance) < withdrawal.amount) {
          throw new BadRequestException('Solde wallet insuffisant pour effectuer le retrait');
        }
        await tx.wallet.update({
          where: { userId: withdrawal.userId },
          data: { balance: { decrement: withdrawal.amount } },
        });
        await tx.transaction.create({
          data: {
            walletId: wallet.id,
            amount:   withdrawal.amount,
            type:     'withdrawal',
            status:   'completed',
            reference: `WITHDRAW-${id}`,
            metadata: { withdrawalRequestId: id, adminId },
          },
        });
      }

      return tx.withdrawalRequest.update({
        where: { id },
        data: { status, adminNote: adminNote ?? null, processedAt: new Date() },
        select: {
          id: true, status: true, adminNote: true, processedAt: true,
          amount: true, currency: true, method: true, mobileNumber: true,
          user: { select: { id: true, name: true, phone: true } },
        },
      });
    });

    // Disbursement automatique — NotchPay en priorité, Flutterwave en fallback
    // Déclenché après le commit DB pour ne pas bloquer la transaction Prisma
    if (status === 'paid') {
      const notchChannel = WITHDRAWAL_METHOD_TO_NOTCHPAY[withdrawal.method as string];
      const flwBank      = WITHDRAWAL_METHOD_TO_FLUTTERWAVE[withdrawal.method as string];

      const updateDisb = (disbursementStatus: string) =>
        Promise.resolve(this.prisma.withdrawalRequest.update({ where: { id }, data: { disbursementStatus } }))
          .catch(() => {/* non-critique */});

      const onSuccess = (provider: string, txId: string, txStatus: string) => {
        this.logger.log(`${provider} disbursement ${txId} status=${txStatus}`);
        void updateDisb('sent');
      };

      const onFailure = (provider: string, err: Error) => {
        this.logger.error(`${provider} disbursement FAILED pour withdrawal ${id}: ${err.message}`);
        void updateDisb('failed');
        void this.notifications.sendToAdmins(
          'Échec disbursement',
          `Retrait #${id} (${withdrawal.amount} ${withdrawal.currency ?? 'XAF'}) via ${provider} n'a pas abouti — intervention manuelle requise.`,
          { withdrawalId: id, provider, error: err.message },
        );
      };

      if (notchChannel && await this.notchpay.isConfigured()) {
        this.notchpay
          .transfer({
            reference:        `DISBURSE-NP-${id}`,
            amount:           withdrawal.amount,
            currency:         withdrawal.currency ?? 'XAF',
            beneficiaryName:  (result as any).user?.name ?? 'Chauffeur',
            beneficiaryPhone: withdrawal.mobileNumber,
            channel:          notchChannel,
            description:      `Retrait AeroGo 24 — ${withdrawal.amount} XAF`,
          })
          .then((t) => onSuccess('NotchPay', t.id, t.status))
          .catch((e) => onFailure('NotchPay', e));
      } else if (flwBank && await this.flutterwave.isConfigured()) {
        this.flutterwave
          .transfer({
            reference:        `DISBURSE-FLW-${id}`,
            amount:           withdrawal.amount,
            currency:         withdrawal.currency ?? 'XAF',
            beneficiaryPhone: withdrawal.mobileNumber,
            bankCode:         flwBank,
            description:      `Retrait AeroGo 24 — ${withdrawal.amount} XAF`,
          })
          .then((t) => onSuccess('Flutterwave', t.id, t.status))
          .catch((e) => onFailure('Flutterwave', e));
      }
    }

    return result;
  }

  // ── Détail utilisateur (courses + solde + retraits) ─────────────────────

  async getUserDetail(userId: string) {
    const [user, pointsAgg, totalBookings] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true, name: true, phone: true, email: true, role: true,
          status: true, referralCode: true, createdAt: true,
          wallet: { select: { balance: true } },
          bookings: {
            orderBy: { createdAt: 'desc' },
            take: 20,
            select: {
              id: true, status: true, destination: true, estimatedPrice: true,
              discountAmount: true, type: true, createdAt: true,
              driverProfile: { select: { user: { select: { name: true } } } },
            },
          },
          pointsTransactions: {
            orderBy: { createdAt: 'desc' },
            take: 20,
            select: { id: true, points: true, type: true, label: true, createdAt: true },
          },
          withdrawalRequests: {
            orderBy: { createdAt: 'desc' },
            take: 10,
            select: { id: true, amount: true, status: true, createdAt: true },
          },
        },
      }),
      this.prisma.pointsTransaction.aggregate({
        where: { userId },
        _sum: { points: true },
      }),
      this.prisma.booking.count({ where: { passengerId: userId } }),
    ]);
    if (!user) throw new NotFoundException('Utilisateur introuvable');
    return {
      ...user,
      pointsBalance: pointsAgg._sum.points ?? 0,
      totalBookings,
    };
  }

  // ── Stats retraits ───────────────────────────────────────────────────────

  async getWithdrawalStats() {
    const [total, pending, approved, paid, rejected, sumPaid] = await Promise.all([
      this.prisma.withdrawalRequest.count(),
      this.prisma.withdrawalRequest.count({ where: { status: 'pending' } }),
      this.prisma.withdrawalRequest.count({ where: { status: 'approved' } }),
      this.prisma.withdrawalRequest.count({ where: { status: 'paid' } }),
      this.prisma.withdrawalRequest.count({ where: { status: 'rejected' } }),
      this.prisma.withdrawalRequest.aggregate({
        where: { status: 'paid' },
        _sum: { amount: true },
      }),
    ]);
    return {
      total,
      byStatus: { pending, approved, paid, rejected },
      totalPaidAmount: Number(sumPaid._sum.amount ?? 0),
    };
  }

  // ── Export CSV ─────────────────────────────────────────────────────────────

  async getBookingsCsv(): Promise<string> {
    const rows = await this.prisma.booking.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10000,
      select: {
        id: true, status: true, type: true,
        destination: true, pickupAddress: true,
        estimatedPrice: true, discountAmount: true,
        paymentMethod: true, createdAt: true, completedAt: true,
        passenger: { select: { name: true, phone: true } },
        driverProfile: { select: { user: { select: { name: true, phone: true } } } },
      },
    });
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = 'id,status,type,passengerName,passengerPhone,driverName,driverPhone,pickupAddress,destination,estimatedPrice,discountAmount,paymentMethod,createdAt,completedAt';
    const lines = rows.map((r) =>
      [r.id, r.status, r.type, r.passenger?.name, r.passenger?.phone,
       r.driverProfile?.user?.name, r.driverProfile?.user?.phone,
       r.pickupAddress, r.destination, r.estimatedPrice, r.discountAmount,
       r.paymentMethod, r.createdAt?.toISOString(), r.completedAt?.toISOString()]
        .map(esc).join(','),
    );
    return [header, ...lines].join('\n');
  }

  async getUsersCsv(): Promise<string> {
    const rows = await this.prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10000,
      select: {
        id: true, name: true, phone: true, email: true, role: true, createdAt: true,
        wallet: { select: { balance: true } },
        _count: { select: { bookings: true } },
      },
    });
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = 'id,name,phone,email,role,createdAt,walletBalance,totalBookings';
    const lines = rows.map((r) =>
      [r.id, r.name, r.phone, r.email, r.role, r.createdAt?.toISOString(),
       r.wallet?.balance ?? 0, r._count.bookings].map(esc).join(','),
    );
    return [header, ...lines].join('\n');
  }

  async getWithdrawalsCsv(): Promise<string> {
    const rows = await this.prisma.withdrawalRequest.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10000,
      select: {
        id: true, amount: true, currency: true, method: true,
        mobileNumber: true, status: true, adminNote: true,
        createdAt: true, processedAt: true,
        user: { select: { name: true, phone: true } },
      },
    });
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = 'id,userName,userPhone,amount,currency,method,mobileNumber,status,adminNote,createdAt,processedAt';
    const lines = rows.map((r) =>
      [r.id, r.user?.name, r.user?.phone, r.amount, r.currency, r.method,
       r.mobileNumber, r.status, r.adminNote, r.createdAt?.toISOString(), r.processedAt?.toISOString()]
        .map(esc).join(','),
    );
    return [header, ...lines].join('\n');
  }

  // ── Export Excel (SpreadsheetML) ─────────────────────────────────────────

  async getBookingsXls(): Promise<Buffer> {
    const rows = await this.prisma.booking.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10000,
      select: {
        id: true, status: true, type: true,
        destination: true, pickupAddress: true,
        estimatedPrice: true, discountAmount: true,
        paymentMethod: true, createdAt: true, completedAt: true,
        passenger: { select: { name: true, phone: true } },
        driverProfile: { select: { user: { select: { name: true, phone: true } } } },
      },
    });

    const headers = ['ID', 'Statut', 'Type', 'Passager', 'Téléphone passager',
      'Chauffeur', 'Téléphone chauffeur', 'Départ', 'Destination',
      'Prix estimé', 'Remise', 'Paiement', 'Créé le', 'Terminé le'];

    const dataRows = rows.map(r => [
      r.id, r.status, r.type,
      r.passenger?.name ?? '', r.passenger?.phone ?? '',
      r.driverProfile?.user?.name ?? '', r.driverProfile?.user?.phone ?? '',
      r.pickupAddress ?? '', r.destination ?? '',
      r.estimatedPrice ?? 0, r.discountAmount ?? 0, r.paymentMethod ?? '',
      r.createdAt?.toISOString() ?? '', r.completedAt?.toISOString() ?? '',
    ]);

    return this.buildXls('Réservations', headers, dataRows);
  }

  async getUsersXls(): Promise<Buffer> {
    const rows = await this.prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10000,
      select: {
        id: true, name: true, phone: true, email: true, role: true, createdAt: true,
        wallet: { select: { balance: true } },
        _count: { select: { bookings: true } },
      },
    });

    const headers = ['ID', 'Nom', 'Téléphone', 'Email', 'Rôle', 'Créé le', 'Solde pts', 'Nb courses'];
    const dataRows = rows.map(r => [
      r.id, r.name ?? '', r.phone, r.email ?? '', r.role,
      r.createdAt?.toISOString() ?? '',
      r.wallet?.balance ?? 0, r._count.bookings,
    ]);

    return this.buildXls('Utilisateurs', headers, dataRows);
  }

  private buildXls(sheetName: string, headers: string[], rows: (string | number)[][]): Buffer {
    const esc = (v: string | number) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const cell = (v: string | number) => {
      const type = typeof v === 'number' ? 'Number' : 'String';
      return `<Cell><Data ss:Type="${type}">${esc(v)}</Data></Cell>`;
    };
    const headerRow = `<Row>${headers.map(h => `<Cell ss:StyleID="header"><Data ss:Type="String">${esc(h)}</Data></Cell>`).join('')}</Row>`;
    const dataRowsXml = rows.map(r => `<Row>${r.map(cell).join('')}</Row>`).join('\n');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:x="urn:schemas-microsoft-com:office:excel">
<Styles>
  <Style ss:ID="header">
    <Font ss:Bold="1"/>
    <Interior ss:Color="#1a1a2e" ss:Pattern="Solid"/>
    <Font ss:Color="#FFFFFF" ss:Bold="1"/>
  </Style>
</Styles>
<Worksheet ss:Name="${esc(sheetName)}">
<Table>
${headerRow}
${dataRowsXml}
</Table>
</Worksheet>
</Workbook>`;

    return Buffer.from(xml, 'utf-8');
  }

  // ── Export PDF (HTML imprimable) ──────────────────────────────────────────

  async getBookingsPdfHtml(): Promise<string> {
    const rows = await this.prisma.booking.findMany({
      orderBy: { createdAt: 'desc' },
      take: 1000,
      select: {
        id: true, status: true, type: true,
        destination: true, pickupAddress: true,
        estimatedPrice: true, paymentMethod: true,
        createdAt: true, completedAt: true,
        passenger: { select: { name: true, phone: true } },
        driverProfile: { select: { user: { select: { name: true } } } },
      },
    });

    const statusColor: Record<string, string> = {
      completed: '#16a34a', cancelled: '#dc2626', pending: '#d97706',
      in_progress: '#2563eb', confirmed: '#7c3aed',
    };

    const rows_html = rows.map((r, i) => `
      <tr style="background:${i % 2 === 0 ? '#f9f9f9' : '#fff'}">
        <td>${r.id.slice(0, 8)}</td>
        <td><span style="color:${statusColor[r.status] ?? '#333'};font-weight:600">${r.status}</span></td>
        <td>${r.type}</td>
        <td>${r.passenger?.name ?? '—'}</td>
        <td>${r.destination ?? '—'}</td>
        <td>${(r.estimatedPrice ?? 0).toLocaleString()} FCFA</td>
        <td>${r.paymentMethod ?? '—'}</td>
        <td>${r.driverProfile?.user?.name ?? '—'}</td>
        <td>${r.createdAt ? new Date(r.createdAt).toLocaleDateString('fr-FR') : '—'}</td>
      </tr>`).join('');

    return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Export Réservations — AeroCab</title>
<style>
  @media print { @page { margin: 1cm; } }
  body { font-family: Arial, sans-serif; font-size: 11px; color: #333; }
  h1 { font-size: 16px; color: #1a1a2e; border-bottom: 2px solid #1a1a2e; padding-bottom: 8px; }
  .meta { font-size: 11px; color: #666; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #1a1a2e; color: #fff; padding: 6px 8px; text-align: left; font-size: 10px; }
  td { padding: 5px 8px; border-bottom: 1px solid #eee; }
  .footer { margin-top: 16px; font-size: 10px; color: #999; text-align: center; }
</style>
</head>
<body>
<h1>AeroCab Connect — Réservations</h1>
<div class="meta">Exporté le ${new Date().toLocaleString('fr-FR')} · ${rows.length} résultats</div>
<table>
<thead><tr>
  <th>Réf.</th><th>Statut</th><th>Type</th><th>Passager</th>
  <th>Destination</th><th>Prix</th><th>Paiement</th><th>Chauffeur</th><th>Date</th>
</tr></thead>
<tbody>${rows_html}</tbody>
</table>
<div class="footer">AeroCab Connect · export automatique</div>
<script>window.addEventListener('load', () => window.print());</script>
</body>
</html>`;
  }

  // ── Crédit / Débit manuel de points (ADM·069) ────────────────────────────

  async adjustUserPoints(
    userId: string,
    amount: number,
    reason: string,
    adminId: string,
  ): Promise<{ balance: number }> {
    if (!amount || amount === 0) throw new BadRequestException('Le montant ne peut pas être 0');
    if (!reason?.trim()) throw new BadRequestException('Un motif est obligatoire');

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Utilisateur introuvable');

    return this.prisma.$transaction(async (tx) => {
      // D5 — Utiliser wallet.balance comme source de vérité unique
      const wallet = await tx.wallet.upsert({
        where: { userId },
        update: {},
        create: { userId, balance: 0 },
      });
      const currentBalance = Number(wallet.balance);

      if (amount < 0 && currentBalance + amount < 0) {
        throw new BadRequestException(`Solde insuffisant (${currentBalance} pts)`);
      }

      await tx.pointsTransaction.create({
        data: {
          userId,
          type: amount >= 0 ? 'credit' : 'debit',
          points: amount,
          label: `[Admin ${adminId}] ${reason}`,
        },
      });

      const newWallet = await tx.wallet.update({
        where: { userId },
        data: { balance: { increment: amount } },
      });

      this.logger.log(`[AdminPoints] ${amount >= 0 ? '+' : ''}${amount} pts → user ${userId} par admin ${adminId} : ${reason}`);
      return { balance: Number(newWallet.balance) };
    });
  }

  // ── D5 : Alertes fraude solde ─────────────────────────────────────────────

  async getFraudAlerts(minFailures: number = 3) {
    // Récupère les utilisateurs ayant eu des échecs de solde répétés via Redis SCAN (non-bloquant)
    const keys = await this.redis.scan('fraud:balance_fail:*');

    const alerts: { userId: string; name: string | null; email: string | null; failures: number; walletBalance: number }[] = [];

    for (const key of keys) {
      const raw = await this.redis.get(key);
      const count = raw ? parseInt(raw, 10) : 0;
      if (count < minFailures) continue;

      const userId = key.replace('fraud:balance_fail:', '');
      const [user, wallet] = await Promise.all([
        this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, email: true } }),
        this.prisma.wallet.findUnique({ where: { userId } }),
      ]);

      alerts.push({
        userId,
        name: user?.name ?? null,
        email: user?.email ?? null,
        failures: count,
        walletBalance: wallet ? Number(wallet.balance) : 0,
      });
    }

    return alerts.sort((a, b) => b.failures - a.failures);
  }

  async resetFraudCounter(userId: string) {
    await this.redis.del(`fraud:balance_fail:${userId}`);
    return { success: true };
  }

  // ── Export XLSX ───────────────────────────────────────────────────────────

  async getBookingsXlsx(): Promise<Buffer> {
    const rows = await this.prisma.booking.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10000,
      select: {
        id: true, status: true, type: true,
        destination: true, pickupAddress: true,
        estimatedPrice: true, discountAmount: true,
        paymentMethod: true, createdAt: true, completedAt: true,
        passenger: { select: { name: true, phone: true } },
        driverProfile: { select: { user: { select: { name: true, phone: true } } } },
      },
    });

    const headers = [
      { header: 'ID', key: 'id', width: 38 },
      { header: 'Statut', key: 'status', width: 16 },
      { header: 'Type', key: 'type', width: 14 },
      { header: 'Passager', key: 'passengerName', width: 22 },
      { header: 'Tél. passager', key: 'passengerPhone', width: 18 },
      { header: 'Chauffeur', key: 'driverName', width: 22 },
      { header: 'Tél. chauffeur', key: 'driverPhone', width: 18 },
      { header: 'Départ', key: 'pickup', width: 30 },
      { header: 'Destination', key: 'destination', width: 30 },
      { header: 'Prix (FCFA)', key: 'price', width: 14 },
      { header: 'Remise', key: 'discount', width: 12 },
      { header: 'Paiement', key: 'payment', width: 14 },
      { header: 'Créé le', key: 'createdAt', width: 20 },
      { header: 'Terminé le', key: 'completedAt', width: 20 },
    ];

    const data = rows.map((r) => ({
      id: r.id,
      status: r.status,
      type: r.type,
      passengerName: r.passenger?.name ?? '',
      passengerPhone: r.passenger?.phone ?? '',
      driverName: r.driverProfile?.user?.name ?? '',
      driverPhone: r.driverProfile?.user?.phone ?? '',
      pickup: r.pickupAddress ?? '',
      destination: r.destination ?? '',
      price: r.estimatedPrice ?? 0,
      discount: r.discountAmount ?? 0,
      payment: r.paymentMethod ?? '',
      createdAt: r.createdAt ? new Date(r.createdAt).toLocaleString('fr-FR') : '',
      completedAt: r.completedAt ? new Date(r.completedAt).toLocaleString('fr-FR') : '',
    }));

    return this.exportService.buildXlsx('Réservations', headers, data);
  }

  async getUsersXlsx(): Promise<Buffer> {
    const rows = await this.prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10000,
      select: {
        id: true, name: true, phone: true, email: true,
        role: true, status: true, loyaltyTier: true,
        createdAt: true,
        wallet: { select: { balance: true } },
        _count: { select: { bookings: true } },
      },
    });

    const headers = [
      { header: 'ID', key: 'id', width: 38 },
      { header: 'Nom', key: 'name', width: 24 },
      { header: 'Téléphone', key: 'phone', width: 18 },
      { header: 'Email', key: 'email', width: 28 },
      { header: 'Rôle', key: 'role', width: 12 },
      { header: 'Statut', key: 'status', width: 14 },
      { header: 'Niveau fidélité', key: 'tier', width: 16 },
      { header: 'Solde points', key: 'balance', width: 14 },
      { header: 'Nb courses', key: 'rides', width: 12 },
      { header: 'Inscrit le', key: 'createdAt', width: 20 },
    ];

    const data = rows.map((r) => ({
      id: r.id,
      name: r.name ?? '',
      phone: r.phone,
      email: r.email ?? '',
      role: r.role,
      status: r.status,
      tier: r.loyaltyTier ?? 'bronze',
      balance: r.wallet?.balance ?? 0,
      rides: r._count.bookings,
      createdAt: r.createdAt ? new Date(r.createdAt).toLocaleString('fr-FR') : '',
    }));

    return this.exportService.buildXlsx('Utilisateurs', headers, data);
  }

  async getWithdrawalsXlsx(): Promise<Buffer> {
    const rows = await this.prisma.withdrawalRequest.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10000,
      select: {
        id: true, amount: true, currency: true, method: true,
        mobileNumber: true, status: true, adminNote: true,
        createdAt: true, processedAt: true,
        user: { select: { name: true, phone: true } },
      },
    });

    const headers = [
      { header: 'ID', key: 'id', width: 38 },
      { header: 'Chauffeur', key: 'name', width: 24 },
      { header: 'Tél. chauffeur', key: 'phone', width: 18 },
      { header: 'Montant', key: 'amount', width: 14 },
      { header: 'Devise', key: 'currency', width: 10 },
      { header: 'Méthode', key: 'method', width: 16 },
      { header: 'Numéro Mobile Money', key: 'mobileNumber', width: 22 },
      { header: 'Statut', key: 'status', width: 14 },
      { header: 'Note admin', key: 'adminNote', width: 30 },
      { header: 'Demandé le', key: 'createdAt', width: 20 },
      { header: 'Traité le', key: 'processedAt', width: 20 },
    ];

    const data = rows.map((r) => ({
      id: r.id,
      name: r.user?.name ?? '',
      phone: r.user?.phone ?? '',
      amount: r.amount,
      currency: r.currency,
      method: r.method,
      mobileNumber: r.mobileNumber,
      status: r.status,
      adminNote: r.adminNote ?? '',
      createdAt: r.createdAt ? new Date(r.createdAt).toLocaleString('fr-FR') : '',
      processedAt: r.processedAt ? new Date(r.processedAt).toLocaleString('fr-FR') : '',
    }));

    return this.exportService.buildXlsx('Retraits', headers, data);
  }

  // ── Export PDF ────────────────────────────────────────────────────────────

  async getBookingsPdf(): Promise<Buffer> {
    const rows = await this.prisma.booking.findMany({
      orderBy: { createdAt: 'desc' },
      take: 2000,
      select: {
        id: true, status: true, type: true,
        destination: true, estimatedPrice: true,
        paymentMethod: true, createdAt: true,
        passenger: { select: { name: true } },
        driverProfile: { select: { user: { select: { name: true } } } },
      },
    });

    const headers = ['Réf.', 'Statut', 'Type', 'Passager', 'Destination', 'Prix FCFA', 'Paiement', 'Chauffeur', 'Date'];
    const data = rows.map((r) => [
      r.id.slice(0, 8),
      r.status,
      r.type,
      r.passenger?.name ?? '—',
      r.destination ?? '—',
      r.estimatedPrice ?? 0,
      r.paymentMethod ?? '—',
      r.driverProfile?.user?.name ?? '—',
      r.createdAt ? new Date(r.createdAt).toLocaleDateString('fr-FR') : '—',
    ]);

    return this.exportService.buildPdf(
      'Export Réservations',
      `${rows.length} résultats · exporté le ${new Date().toLocaleString('fr-FR')}`,
      headers,
      data,
    );
  }

  async getUsersPdf(): Promise<Buffer> {
    const rows = await this.prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      take: 2000,
      select: {
        id: true, name: true, phone: true, role: true,
        status: true, loyaltyTier: true, createdAt: true,
        _count: { select: { bookings: true } },
      },
    });

    const headers = ['Réf.', 'Nom', 'Téléphone', 'Rôle', 'Statut', 'Niveau', 'Courses', 'Inscrit le'];
    const data = rows.map((r) => [
      r.id.slice(0, 8),
      r.name ?? '—',
      r.phone,
      r.role,
      r.status,
      r.loyaltyTier ?? 'bronze',
      r._count.bookings,
      r.createdAt ? new Date(r.createdAt).toLocaleDateString('fr-FR') : '—',
    ]);

    return this.exportService.buildPdf(
      'Export Utilisateurs',
      `${rows.length} résultats · exporté le ${new Date().toLocaleString('fr-FR')}`,
      headers,
      data,
    );
  }
}
