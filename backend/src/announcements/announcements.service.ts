import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { UsersService } from '../users/users.service';
import { NotificationsService } from '../notifications/notifications.service';

export type FeedUserCtx = { app: 'passenger' | 'driver'; country: string | null; tier: string | null };

@Injectable()
export class AnnouncementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly users: UsersService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Vrai si l'annonce cible cet utilisateur. Filtres vides = pas de restriction. */
  matchesUser(a: { targetApps: string[]; targetCountries: string[]; targetTiers: string[] }, ctx: FeedUserCtx): boolean {
    if (a.targetApps.length && !a.targetApps.includes(ctx.app)) return false;
    if (a.targetCountries.length) {
      if (!ctx.country || !a.targetCountries.map(c => c.toUpperCase()).includes(ctx.country.toUpperCase())) return false;
    }
    if (a.targetTiers.length) {
      // Le tier n'existe que pour les passagers — une annonce tier-ciblée n'atteint pas les chauffeurs
      if (ctx.app !== 'passenger') return false;
      if (!ctx.tier || !a.targetTiers.includes(ctx.tier)) return false;
    }
    return true;
  }

  /** Feed filtré pour un utilisateur : annonces actives dans la fenêtre + politique version. */
  async getFeed(userId: string, app: 'passenger' | 'driver') {
    const now = new Date();
    const profile = await this.prisma.user
      .findUnique({ where: { id: userId }, select: { countryCode: true } })
      .catch(() => null);
    const country = profile?.countryCode ?? null;
    const tier = app === 'passenger' ? await this.users.getPassengerTier(userId).catch(() => null) : null;
    const ctx: FeedUserCtx = { app, country, tier };

    const candidates = await this.prisma.announcement.findMany({
      where: {
        isActive: true,
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
        ],
      },
      orderBy: { createdAt: 'desc' },
      include: { reads: { where: { userId }, select: { id: true } } },
    });

    const announcements = candidates
      .filter(a => this.matchesUser(a, ctx))
      .map(a => ({
        id: a.id, type: a.type, title: a.title, body: a.body, imageUrl: a.imageUrl,
        priority: a.priority, ctaType: a.ctaType, ctaLabel: a.ctaLabel, ctaValue: a.ctaValue,
        createdAt: a.createdAt, seen: a.reads.length > 0,
      }));

    const suffix = app;
    const version = {
      min: await this.settings.get(`min_version_${suffix}`, '0.0.0'),
      latest: await this.settings.get(`latest_version_${suffix}`, '0.0.0'),
      apkUrl: await this.settings.get(`apk_url_${suffix}`, ''),
    };

    return { announcements, version };
  }

  /** Marque une annonce comme vue (idempotent). */
  async markSeen(userId: string, announcementId: string) {
    await this.prisma.announcementRead.upsert({
      where: { announcementId_userId: { announcementId, userId } },
      update: {},
      create: { announcementId, userId },
    });
    return { ok: true };
  }

  // ── Admin ──
  listAdmin() {
    return this.prisma.announcement.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async create(dto: any, adminId: string) {
    const announcement = await this.prisma.announcement.create({
      data: {
        ...dto,
        startsAt: dto.startsAt ? new Date(dto.startsAt) : null,
        endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
        createdBy: adminId,
      },
    });
    // Notif push aux utilisateurs ciblés (non-bloquant — ne fait pas échouer la création).
    this.notifyTargetedUsers(announcement).catch(() => {});
    return announcement;
  }

  /**
   * Envoie une notification push aux utilisateurs ciblés par l'annonce, seulement si
   * elle est « live » (active et dans la fenêtre temporelle — une annonce programmée
   * dans le futur ne déclenche pas de push à la création).
   */
  private async notifyTargetedUsers(a: {
    id: string; title: string; body: string; isActive?: boolean;
    startsAt?: Date | null; endsAt?: Date | null;
    targetApps?: string[]; targetCountries?: string[]; targetTiers?: string[];
  }): Promise<void> {
    const now = new Date();
    const live = a.isActive !== false
      && (!a.startsAt || a.startsAt <= now)
      && (!a.endsAt || a.endsAt >= now);
    if (!live) return;

    const apps = a.targetApps ?? [];
    const tiers = a.targetTiers ?? [];
    const countries = a.targetCountries ?? [];

    // apps → rôles ciblés (tier-ciblé ⇒ passagers uniquement)
    const roles: string[] = tiers.length
      ? ['passenger']
      : [
          ...(apps.length === 0 || apps.includes('passenger') ? ['passenger'] : []),
          ...(apps.length === 0 || apps.includes('driver') ? ['driver'] : []),
        ];
    if (roles.length === 0) return;

    const where: any = { fcmToken: { not: null }, role: { in: roles } };
    if (countries.length) where.countryCode = { in: countries.map((c) => c.toUpperCase()) };
    if (tiers.length) where.loyaltyTier = { in: tiers };

    const recipients = await this.prisma.user.findMany({ where, select: { id: true } });
    await Promise.allSettled(
      recipients.map((u) =>
        this.notifications.sendToUser(u.id, a.title, a.body, { type: 'announcement', announcementId: a.id }),
      ),
    );
  }

  async update(id: string, dto: any) {
    const exists = await this.prisma.announcement.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('Annonce introuvable');
    return this.prisma.announcement.update({
      where: { id },
      data: {
        ...dto,
        ...(dto.startsAt !== undefined ? { startsAt: dto.startsAt ? new Date(dto.startsAt) : null } : {}),
        ...(dto.endsAt !== undefined ? { endsAt: dto.endsAt ? new Date(dto.endsAt) : null } : {}),
      },
    });
  }

  remove(id: string) {
    return this.prisma.announcement.delete({ where: { id } });
  }

  async stats(id: string) {
    const reads = await this.prisma.announcementRead.count({ where: { announcementId: id } });
    return { views: reads };
  }

  async getVersionConfig() {
    const keys = ['min_version_passenger','latest_version_passenger','apk_url_passenger','min_version_driver','latest_version_driver','apk_url_driver'];
    const out: Record<string, string> = {};
    for (const k of keys) out[k] = await this.settings.get(k, '');
    return out;
  }

  async setVersionConfig(dto: Record<string, string | undefined>) {
    for (const [k, v] of Object.entries(dto)) {
      if (v !== undefined) await this.settings.set(k, v);
    }
    return this.getVersionConfig();
  }
}
