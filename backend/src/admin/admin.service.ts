import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { VerifyDriverDto, VerificationAction } from './dto';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private prisma: PrismaService,
    private settingsService: SettingsService,
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
    });

    if (!doc) {
      throw new NotFoundException('Document introuvable');
    }

    if (action === 'reject' && !reason) {
      throw new BadRequestException('Un motif de rejet est requis');
    }

    const updated = await this.prisma.driverDocument.update({
      where: { id: documentId },
      data: {
        status: action === 'approve' ? 'approved' : 'rejected',
        rejectionReason: action === 'reject' ? reason : null,
        verifiedAt: action === 'approve' ? new Date() : null,
      },
    });

    return updated;
  }

  // ── Stats ────────────────────────────────────────────

  async getStats() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      totalUsers,
      totalDrivers,
      pendingDrivers,
      approvedDrivers,
      totalBookings,
      pendingBookings,
      activeBookings,
      completedBookings,
      cancelledBookings,
      completedToday,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.driverProfile.count(),
      this.prisma.driverProfile.count({ where: { status: 'pending' } }),
      this.prisma.driverProfile.count({ where: { status: 'approved' } }),
      this.prisma.booking.count(),
      this.prisma.booking.count({ where: { status: 'pending' } }),
      this.prisma.booking.count({ where: { status: { in: ['confirmed', 'arrived_at_airport', 'in_progress'] } } }),
      this.prisma.booking.count({ where: { status: 'completed' } }),
      this.prisma.booking.count({ where: { status: 'cancelled' } }),
      this.prisma.booking.count({ where: { status: 'completed', updatedAt: { gte: today } } }),
    ]);

    return {
      totalUsers,
      totalDrivers,
      pendingDrivers,
      approvedDrivers,
      bookings: {
        total: totalBookings,
        pending: pendingBookings,
        active: activeBookings,
        completed: completedBookings,
        cancelled: cancelledBookings,
        completedToday,
      },
    };
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

  async cancelBookingAdmin(bookingId: string) {
    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking) throw new NotFoundException('Réservation introuvable');
    if (['completed', 'cancelled'].includes(booking.status)) {
      throw new BadRequestException('Cette réservation ne peut plus être annulée');
    }
    return this.prisma.booking.update({
      where: { id: bookingId },
      data: { status: 'cancelled' },
    });
  }

  async updateDriverProfile(driverId: string, data: { driverType?: string; consigneEnabled?: boolean }) {
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

    return { data, total, page, limit };
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

    return this.prisma.$transaction(async (tx) => {
      // Débit wallet uniquement quand on marque "paid"
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
            amount: withdrawal.amount,
            type: 'withdrawal',
            status: 'completed',
            reference: `WITHDRAW-${id}`,
            metadata: { withdrawalRequestId: id, adminId },
          },
        });
      }

      return tx.withdrawalRequest.update({
        where: { id },
        data: { status, adminNote: adminNote ?? null, processedAt: new Date() },
        select: {
          id: true,
          status: true,
          adminNote: true,
          processedAt: true,
          amount: true,
          currency: true,
          method: true,
          mobileNumber: true,
          user: { select: { id: true, name: true, phone: true } },
        },
      });
    });
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
      // Vérifier le solde en cas de débit
      if (amount < 0) {
        const agg = await tx.pointsTransaction.aggregate({
          where: { userId },
          _sum: { points: true },
        });
        const currentBalance = agg._sum.points ?? 0;
        if (currentBalance + amount < 0) {
          throw new BadRequestException(`Solde insuffisant (${currentBalance} pts)`);
        }
      }

      await tx.pointsTransaction.create({
        data: {
          userId,
          type: amount >= 0 ? 'credit' : 'debit',
          points: amount,
          label: `[Admin ${adminId}] ${reason}`,
        },
      });

      const agg = await tx.pointsTransaction.aggregate({
        where: { userId },
        _sum: { points: true },
      });

      this.logger.log(`[AdminPoints] ${amount >= 0 ? '+' : ''}${amount} pts → user ${userId} par admin ${adminId} : ${reason}`);
      return { balance: agg._sum.points ?? 0 };
    });
  }
}
