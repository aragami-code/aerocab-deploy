import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

const VALID_TYPES = ['cni_front', 'cni_back', 'passport', 'selfie'] as const;
type KycDocType = typeof VALID_TYPES[number];

@Injectable()
export class KycService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  async getStatus(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        kycStatus: true,
        kycVerifiedAt: true,
        kycDocuments: {
          select: { id: true, type: true, status: true, fileUrl: true, rejectionReason: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!user) throw new NotFoundException('Utilisateur introuvable');
    return user;
  }

  async uploadDocument(userId: string, type: string, file: Express.Multer.File) {
    if (!VALID_TYPES.includes(type as KycDocType)) {
      throw new BadRequestException('Type invalide. Valeurs acceptées : cni_front, cni_back, passport, selfie');
    }
    if (!file) throw new BadRequestException('Fichier manquant');

    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw new NotFoundException('Utilisateur introuvable');

    const fileUrl = `/api/uploads/${file.filename}`;

    const doc = await this.prisma.kycDocument.upsert({
      where: { userId_type: { userId, type: type as any } },
      update: { fileUrl, status: 'pending', rejectionReason: null, verifiedAt: null, aiVerified: false, aiScore: null },
      create: { userId, type: type as any, fileUrl },
      select: { id: true, type: true, status: true, fileUrl: true },
    });

    return doc;
  }

  async submitForReview(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { kycStatus: true, kycDocuments: { select: { type: true } } },
    });
    if (!user) throw new NotFoundException('Utilisateur introuvable');
    if (user.kycStatus === 'approved') throw new BadRequestException('KYC déjà approuvé');

    const uploaded = user.kycDocuments.map(d => d.type);
    const hasCni    = uploaded.includes('cni_front' as any) && uploaded.includes('cni_back' as any);
    const hasPassport = uploaded.includes('passport' as any);
    const hasSelfie = uploaded.includes('selfie' as any);

    if (!hasCni && !hasPassport) {
      throw new BadRequestException('Veuillez uploader votre CNI (recto + verso) ou votre passeport');
    }
    if (!hasSelfie) {
      throw new BadRequestException('Veuillez uploader votre selfie');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { kycStatus: 'submitted' },
    });

    return { success: true, kycStatus: 'submitted' };
  }

  // ── Admin ────────────────────────────────────────────────────────────────────

  async getPending(page = 1, limit = 20) {
    const skip = Math.max(0, (page - 1) * limit);
    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where: { kycStatus: { in: ['submitted', 'rejected'] } },
        select: {
          id: true, name: true, phone: true, email: true, kycStatus: true,
          kycDocuments: { select: { id: true, type: true, status: true, fileUrl: true, rejectionReason: true, createdAt: true } },
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.user.count({ where: { kycStatus: { in: ['submitted', 'rejected'] } } }),
    ]);
    return { data: users, total, page, limit };
  }

  async reviewKyc(userId: string, action: 'approve' | 'reject', reason?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, kycStatus: true },
    });
    if (!user) throw new NotFoundException('Utilisateur introuvable');
    if (user.kycStatus !== 'submitted') {
      throw new BadRequestException('KYC non soumis ou déjà traité');
    }

    if (action === 'approve') {
      await this.prisma.user.update({
        where: { id: userId },
        data: { kycStatus: 'approved', kycVerifiedAt: new Date() },
      });
      await this.prisma.kycDocument.updateMany({
        where: { userId, status: 'pending' },
        data: { status: 'approved', verifiedAt: new Date() },
      });
      this.notifications.sendToUser(userId, 'Identité vérifiée ✅', 'Votre identité a été vérifiée avec succès. Bon voyage !').catch(() => {});
    } else {
      await this.prisma.user.update({
        where: { id: userId },
        data: { kycStatus: 'rejected' },
      });
      await this.prisma.kycDocument.updateMany({
        where: { userId, status: 'pending' },
        data: { status: 'rejected', rejectionReason: reason ?? 'Document non conforme' },
      });
      this.notifications.sendToUser(
        userId,
        'Vérification refusée',
        reason ?? 'Vos documents n\'ont pas pu être vérifiés. Veuillez les soumettre à nouveau.',
      ).catch(() => {});
    }

    return { success: true, action };
  }
}
