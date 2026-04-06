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

      this.logger.log(`Driver approved: ${driverProfileId}`);
      return { message: 'Chauffeur approuve avec succes', status: 'approved' };
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
    const [
      totalUsers,
      totalDrivers,
      pendingDrivers,
      approvedDrivers,
      activeAccessPasses,
      totalRevenue,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.driverProfile.count(),
      this.prisma.driverProfile.count({ where: { status: 'pending' } }),
      this.prisma.driverProfile.count({ where: { status: 'approved' } }),
      this.prisma.accessPass.count({ where: { status: 'active' } }),
      this.prisma.accessPass.aggregate({
        where: { status: 'active' },
        _sum: { amount: true },
      }),
    ]);

    return {
      totalUsers,
      totalDrivers,
      pendingDrivers,
      approvedDrivers,
      activeAccessPasses,
      totalRevenue: totalRevenue._sum.amount || 0,
    };
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

  // ── Access Passes ────────────────────────────────────

  async getAccessPasses(status?: string, page = 1, limit = 20) {
    const where = status ? { status: status as any } : {};
    const skip = (page - 1) * limit;

    const [passes, total] = await Promise.all([
      this.prisma.accessPass.findMany({
        where,
        include: {
          user: {
            select: { id: true, phone: true, name: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.accessPass.count({ where }),
    ]);

    return {
      data: passes,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}
