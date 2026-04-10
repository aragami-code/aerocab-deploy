import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { CreateReportDto } from './dto/create-report.dto';

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  async createReport(reporterId: string, dto: CreateReportDto) {
    let reportedId = dto.reportedId;

    // Si bookingId fourni, on résout le userId du chauffeur depuis la réservation
    if (!reportedId && dto.bookingId) {
      const booking = await this.prisma.booking.findUnique({
        where: { id: dto.bookingId },
        include: { driverProfile: { select: { userId: true } } },
      });
      if (booking?.driverProfile?.userId) {
        reportedId = booking.driverProfile.userId;
      }
    }

    if (!reportedId) {
      throw new Error('Impossible d\'identifier la personne signalée');
    }

    const report = await this.prisma.report.create({
      data: {
        reporterId,
        reportedId,
        reason: dto.reason,
        conversationId: dto.conversationId ?? null,
        status: 'open',
      },
      select: { id: true, status: true },
    });
    return report;
  }

  async getMyReports(userId: string) {
    return this.prisma.report.findMany({
      where: {
        OR: [{ reporterId: userId }, { reportedId: userId }],
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getAdminReports(status?: string, page = 1, limit = 20) {
    const where = status ? { status: status as any } : {};
    const skip = (page - 1) * limit;

    const [reports, total] = await Promise.all([
      this.prisma.report.findMany({
        where,
        include: {
          reporter: { select: { id: true, name: true, phone: true } },
          reported: { select: { id: true, name: true, phone: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.report.count({ where }),
    ]);

    return {
      data: reports,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async resolveReport(
    reportId: string,
    resolution: string,
    status: 'resolved' | 'dismissed',
  ) {
    const report = await this.prisma.report.findUnique({ where: { id: reportId } });
    if (!report) throw new NotFoundException('Signalement introuvable');

    return this.prisma.report.update({
      where: { id: reportId },
      data: { resolution, status },
    });
  }
}
