import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TrustScoreService } from '../users/trust-score.service';
import { CreateReportDto } from './dto/create-report.dto';

// ── Gravité par catégorie ─────────────────────────────────────────────────────
type Severity = 'minor' | 'moderate' | 'major';

const CATEGORY_SEVERITY: Record<string, Severity> = {
  'Propreté du véhicule':       'minor',
  'Retard important':           'minor',
  'Problème technique':         'minor',
  'Problème avec le prix':      'moderate',
  'Problème de paiement':       'moderate',
  'Comportement du chauffeur':  'major',
  'Comportement du passager':   'major',
  'Accident / Incident':        'major',
  'Autre problème':             'minor',
};

// ── Sanctions par gravité ─────────────────────────────────────────────────────
const SANCTIONS: Record<Severity, {
  pointsDeducted: number;
  scorePenalty: number;
  suspensionDays: number;
  permSuspendAfter: number; // nb signalements résolus pour suspension définitive
}> = {
  minor:    { pointsDeducted: 100, scorePenalty: 0.1, suspensionDays: 1,  permSuspendAfter: 8 },
  moderate: { pointsDeducted: 250, scorePenalty: 0.3, suspensionDays: 3,  permSuspendAfter: 6 },
  major:    { pointsDeducted: 500, scorePenalty: 0.5, suspensionDays: 7,  permSuspendAfter: 4 },
};

const MESSAGE_INCLUDE = {
  sender: { select: { id: true, name: true } },
};

function extractSeverity(reason: string): Severity {
  const category = reason.split(':')[0].trim();
  return CATEGORY_SEVERITY[category] ?? 'minor';
}

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private trustScore: TrustScoreService,
  ) {}

  async createReport(reporterId: string, dto: CreateReportDto) {
    let reportedId = dto.reportedId;

    if (!reportedId && dto.bookingId) {
      const booking = await this.prisma.booking.findUnique({
        where: { id: dto.bookingId },
        include: { driverProfile: { select: { userId: true } } },
      });
      if (booking?.driverProfile?.userId) {
        reportedId = booking.driverProfile.userId;
      }
    }

    const report = await this.prisma.report.create({
      data: {
        reporterId,
        ...(reportedId ? { reportedId } : {}),
        bookingId: dto.bookingId ?? null,
        reason: dto.reason,
        conversationId: dto.conversationId ?? null,
        status: 'open',
      },
      select: { id: true, status: true },
    });

    // Notifier les admins
    this.notifications.sendToAdmins(
      'Nouveau signalement',
      dto.reason.length > 80 ? dto.reason.slice(0, 77) + '...' : dto.reason,
      { type: 'new_report', reportId: report.id },
    ).catch(() => {});

    return report;
  }

  async getMyReports(userId: string) {
    return this.prisma.report.findMany({
      where: { reporterId: userId },
      include: {
        messages: {
          include: MESSAGE_INCLUDE,
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getReportById(reportId: string, userId: string) {
    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
      include: {
        reporter: { select: { id: true, name: true, phone: true } },
        reported: { select: { id: true, name: true, phone: true } },
        messages: {
          include: MESSAGE_INCLUDE,
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!report) throw new NotFoundException('Signalement introuvable');
    if (report.reporterId !== userId) throw new ForbiddenException('Accès refusé');
    return report;
  }

  async getReportByIdAdmin(reportId: string) {
    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
      include: {
        reporter: { select: { id: true, name: true, phone: true } },
        reported: { select: { id: true, name: true, phone: true } },
        messages: {
          include: MESSAGE_INCLUDE,
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!report) throw new NotFoundException('Signalement introuvable');
    return report;
  }

  async addMessage(reportId: string, senderId: string, senderRole: 'user' | 'admin', message: string, imageUrl?: string) {
    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
      select: { id: true, status: true, reporterId: true, reportedId: true },
    });
    if (!report) throw new NotFoundException('Signalement introuvable');
    if (report.status === 'resolved' || report.status === 'dismissed') {
      throw new ForbiddenException('Ce ticket est fermé');
    }
    if (senderRole === 'user' && report.reporterId !== senderId && report.reportedId !== senderId) {
      throw new ForbiddenException('Accès refusé');
    }

    const msg = await this.prisma.ticketMessage.create({
      data: { reportId, senderId, senderRole, message, imageUrl: imageUrl ?? null },
      include: MESSAGE_INCLUDE,
    });

    if (senderRole === 'admin') {
      if (report.status === 'open') {
        await this.prisma.report.update({ where: { id: reportId }, data: { status: 'investigating' } });
        await this.prisma.ticketMessage.create({
          data: { reportId, senderId, senderRole: 'system' as any, message: 'Ticket pris en charge — statut : En cours d\'investigation' },
        });
      }
      this.notifications.sendToUser(
        report.reporterId,
        'Réponse à votre signalement',
        message.length > 100 ? message.slice(0, 97) + '...' : message,
        { type: 'report_reply', reportId },
      ).catch(() => {});
    }

    return msg;
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
          messages: { include: MESSAGE_INCLUDE, orderBy: { createdAt: 'asc' } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.report.count({ where }),
    ]);
    return { data: reports, pagination: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async reopenReport(reportId: string, adminId: string) {
    const report = await this.prisma.report.findUnique({ where: { id: reportId } });
    if (!report) throw new NotFoundException('Signalement introuvable');

    const updated = await this.prisma.report.update({
      where: { id: reportId },
      data: { status: 'open', resolution: null },
    });

    await this.prisma.ticketMessage.create({
      data: { reportId, senderId: adminId, senderRole: 'system' as any, message: 'Ticket réouvert par l\'équipe support' },
    });

    this.notifications.sendToUser(
      report.reporterId,
      'Votre signalement a été réouvert',
      'L\'équipe support a réouvert votre ticket pour complément d\'enquête.',
      { type: 'report_reopened', reportId },
    ).catch(() => {});

    return updated;
  }

  async resolveReport(reportId: string, adminId: string, resolution: string, status: 'resolved' | 'dismissed') {
    const report = await this.prisma.report.findUnique({ where: { id: reportId } });
    if (!report) throw new NotFoundException('Signalement introuvable');

    const updated = await this.prisma.report.update({ where: { id: reportId }, data: { resolution, status } });

    const statusLabel = status === 'resolved' ? 'Résolu' : 'Rejeté';
    await this.prisma.ticketMessage.create({
      data: { reportId, senderId: adminId, senderRole: 'system' as any, message: `Ticket clôturé — statut : ${statusLabel}` },
    });

    // Notification reporter
    this.notifications.sendToUser(
      report.reporterId,
      status === 'resolved' ? 'Votre signalement a été résolu' : 'Votre signalement a été rejeté',
      resolution.length > 100 ? resolution.slice(0, 97) + '...' : resolution,
      { type: 'report_closed', reportId, status },
    ).catch(() => {});

    // Sanctions uniquement si signalement validé ET utilisateur ciblé identifié
    if (status === 'resolved' && report.reportedId) {
      await this.applySanctions(report.reportedId, report.reason, reportId, adminId);
    }

    return updated;
  }

  // ── Révocation / Atténuation de sanctions ────────────────────────────────
  async revokeSanctions(
    reportId: string,
    adminId: string,
    opts: { liftSuspension: boolean; restorePoints: boolean; restoreScore: boolean },
  ) {
    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
      select: { id: true, reason: true, reportedId: true },
    });
    if (!report) throw new NotFoundException('Signalement introuvable');
    if (!report.reportedId) throw new ForbiddenException('Aucun utilisateur ciblé sur ce signalement');

    const userId = report.reportedId;
    const severity = extractSeverity(report.reason);
    const s = SANCTIONS[severity];
    const actions: string[] = [];

    if (opts.liftSuspension) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { status: 'active', suspendedUntil: null },
      });
      // Réactiver le profil chauffeur si suspendu temporairement (pas définitif)
      await this.prisma.driverProfile.updateMany({
        where: { userId, status: 'suspended' },
        data: { status: 'approved' },
      });
      actions.push('suspension levée');
      this.notifications.sendToUser(userId, 'Sanction levée', 'Votre suspension a été levée par l\'équipe support.', { type: 'sanction_revoked' }).catch(() => {});
    }

    if (opts.restorePoints) {
      await this.prisma.pointsTransaction.create({
        data: {
          userId,
          type: 'credit',
          source: 'bonus',
          points: s.pointsDeducted,
          label: `Restauration points — sanction atténuée (signalement ${reportId.slice(0, 8)})`,
        },
      });
      actions.push(`+${s.pointsDeducted} points restaurés`);
    }

    if (opts.restoreScore) {
      const driver = await this.prisma.driverProfile.findFirst({ where: { userId } });
      if (driver) {
        const newScore = Math.min(5.0, parseFloat((driver.score + s.scorePenalty).toFixed(2)));
        const newRating = Math.min(5.0, parseFloat(((driver.ratingAvg || 5.0) + s.scorePenalty * 0.5).toFixed(2)));
        await this.prisma.driverProfile.update({
          where: { id: driver.id },
          data: { score: newScore, ratingAvg: newRating },
        });
        actions.push(`+${s.scorePenalty}⭐ score restauré`);
      }
      await this.trustScore.updateScore(userId).catch(() => {});
    }

    if (actions.length === 0) return { message: 'Aucune action sélectionnée' };

    // Audit trail
    await this.prisma.ticketMessage.create({
      data: {
        reportId,
        senderId: adminId,
        senderRole: 'system' as any,
        message: `Sanctions atténuées par l\'admin : ${actions.join(', ')}`,
      },
    });

    this.logger.log(`Sanctions atténuées pour user ${userId} : ${actions.join(', ')}`);
    return { message: 'Sanctions mises à jour', actions };
  }

  // ── Sanctions ─────────────────────────────────────────────────────────────
  private async applySanctions(userId: string, reason: string, reportId: string, adminId: string) {
    const severity = extractSeverity(reason);
    const s = SANCTIONS[severity];

    this.logger.log(`Sanctions [${severity}] pour user ${userId} : -${s.pointsDeducted}pts, -${s.scorePenalty}⭐, ${s.suspensionDays}j`);

    // 1. Retrait de points
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { pointsTransactions: { select: { points: true, type: true } } },
    });
    if (user) {
      const currentPoints = user.pointsTransactions.reduce(
        (acc, t) => acc + (t.type === 'credit' ? t.points : -t.points), 0
      );
      const deduction = Math.min(s.pointsDeducted, Math.max(0, currentPoints));
      if (deduction > 0) {
        await this.prisma.pointsTransaction.create({
          data: {
            userId,
            type: 'debit',
            source: 'penalty',
            points: deduction,
            label: `Sanction signalement — ${severity}`,
          },
        });
      }
    }

    // 2. Retrait d'étoiles sur le profil chauffeur
    const driver = await this.prisma.driverProfile.findFirst({ where: { userId } });
    if (driver) {
      const newScore = Math.max(1.0, parseFloat((driver.score - s.scorePenalty).toFixed(2)));
      const newRating = Math.max(1.0, parseFloat(((driver.ratingAvg || 5.0) - s.scorePenalty * 0.5).toFixed(2)));
      await this.prisma.driverProfile.update({
        where: { id: driver.id },
        data: { score: newScore, ratingAvg: newRating },
      });
    }

    // 3. Recalcul du TrustScore
    await this.trustScore.updateScore(userId).catch(() => {});

    // 4. Suspension temporaire
    const suspendedUntil = new Date(Date.now() + s.suspensionDays * 24 * 60 * 60 * 1000);
    await this.prisma.user.update({
      where: { id: userId },
      data: { status: 'suspended', suspendedUntil },
    });
    if (driver) {
      await this.prisma.driverProfile.updateMany({
        where: { userId },
        data: { isAvailable: false, isOnline: false },
      });
    }

    // Message audit dans le ticket
    await this.prisma.ticketMessage.create({
      data: {
        reportId,
        senderId: adminId,
        senderRole: 'system' as any,
        message: `Sanctions appliquées [${severity}] : -${s.pointsDeducted} points, -${s.scorePenalty}⭐, suspension ${s.suspensionDays}j`,
      },
    });

    // Notification à l'utilisateur sanctionné
    this.notifications.sendToUser(
      userId,
      'Sanction suite à signalement',
      `Suite à un signalement validé : -${s.pointsDeducted} points, suspension de ${s.suspensionDays} jour(s). Fin : ${suspendedUntil.toLocaleDateString('fr-FR')}.`,
      { type: 'sanction_applied' },
    ).catch(() => {});

    // 5. Vérifier si suspension définitive
    const resolvedCount = await this.prisma.report.count({ where: { reportedId: userId, status: 'resolved' } });
    if (resolvedCount >= s.permSuspendAfter) {
      await this.prisma.user.update({ where: { id: userId }, data: { status: 'suspended', suspendedUntil: null } });
      if (driver) {
        await this.prisma.driverProfile.updateMany({
          where: { userId },
          data: { status: 'suspended', isAvailable: false, isOnline: false },
        });
      }
      this.notifications.sendToUser(
        userId,
        'Compte suspendu définitivement',
        `Votre compte a été suspendu suite à ${resolvedCount} signalements confirmés. Contactez le support.`,
        { type: 'account_suspended_permanent' },
      ).catch(() => {});
      this.logger.warn(`Suspension définitive : user ${userId} (${resolvedCount} signalements, seuil ${s.permSuspendAfter})`);
    }
  }
}
