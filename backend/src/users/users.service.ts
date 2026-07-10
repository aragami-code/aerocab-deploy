import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { extractCountryFromPhone } from '../common/phone-country';
import { SettingsService } from '../settings/settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AdminNotificationService } from '../admin/admin-notification.service';
import { TrustScoreService } from './trust-score.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

const TIER_THRESHOLDS = { bronze: 0, silver: 500, gold: 2000, platinum: 5000 } as const;
type TierKey = keyof typeof TIER_THRESHOLDS;

const TIER_META: Record<TierKey, { label: string; color: string; emoji: string; nextTier: TierKey | null }> = {
  bronze:   { label: 'Bronze',   color: '#CD7F32', emoji: '🥉', nextTier: 'silver' },
  silver:   { label: 'Argent',   color: '#A8A9AD', emoji: '🥈', nextTier: 'gold' },
  gold:     { label: 'Or',       color: '#FFD700', emoji: '🥇', nextTier: 'platinum' },
  platinum: { label: 'Platine',  color: '#E5E4E2', emoji: '💎', nextTier: null },
};

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
    private notifications: NotificationsService,
    private trustScoreService: TrustScoreService,
    private adminNotifs: AdminNotificationService,
  ) {}

  async updateTrustScore(userId: string): Promise<void> {
    return this.trustScoreService.updateScore(userId);
  }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        phone: true,
        name: true,
        email: true,
        role: true,
        status: true,
        avatarUrl: true,
        language: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('Utilisateur introuvable');
    }

    return user;
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    if (dto.phone) {
      const existing = await this.prisma.user.findUnique({ where: { phone: dto.phone }, select: { id: true } });
      if (existing && existing.id !== userId) {
        throw new BadRequestException('Ce numéro de téléphone est déjà utilisé par un autre compte');
      }
    }

    if (dto.email) {
      const existing = await this.prisma.user.findFirst({ where: { email: dto.email }, select: { id: true } });
      if (existing && existing.id !== userId) {
        throw new BadRequestException('Cette adresse email est déjà utilisée par un autre compte');
      }
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.name  !== undefined && { name:  dto.name }),
        ...(dto.email !== undefined && { email: dto.email }),
        ...(dto.language !== undefined && { language: dto.language }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
        ...(dto.phone !== undefined && { countryCode: extractCountryFromPhone(dto.phone) }),
      },
      select: {
        id: true,
        phone: true,
        name: true,
        email: true,
        role: true,
        avatarUrl: true,
        language: true,
        updatedAt: true,
      },
    });

    if (dto.phone || dto.email) {
      const changes: string[] = [];
      if (dto.phone) changes.push(`tél→${dto.phone}`);
      if (dto.email) changes.push(`email→${dto.email}`);
      void this.adminNotifs.notify(
        'user.profile_change',
        'Modification profil sensible',
        `Utilisateur ${userId} : ${changes.join(', ')}`,
        { userId, changes },
      );
    }

    return user;
  }

  async deleteAccount(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, status: true } });
    if (!user) throw new NotFoundException('Utilisateur introuvable');
    if (user.status === 'deleted') throw new BadRequestException('Compte déjà supprimé');
    const anon = `deleted_${userId.replace(/-/g, '').slice(0, 10)}`;
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        name:         anon,
        phone:        `+00000${userId.replace(/-/g, '').slice(0, 9)}`,
        email:        `${anon}@deleted.invalid`,
        avatarUrl:    null,
        referralCode: null,
        status:       'deleted',
      },
    });

    void this.adminNotifs.notify(
      'user.account_deleted',
      'Compte supprimé',
      `Utilisateur ${userId} a supprimé son compte`,
      { userId },
    );

    return { success: true };
  }

  async updateAvatar(userId: string, avatarUrl: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl },
      select: {
        id: true,
        avatarUrl: true,
      },
    });
  }

  // ── Fidélité ────────────────────────────────────────────────────────────────

  async getLoyaltyStatus(userId: string) {
    const user = await this.prisma.user.findUnique({
      where:  { id: userId },
      select: { loyaltyTier: true },
    });
    if (!user) throw new NotFoundException('Utilisateur introuvable');

    const [silverThraw, goldThraw, platThraw] = await Promise.all([
      this.settings.get('loyalty_silver_threshold', '500'),
      this.settings.get('loyalty_gold_threshold', '2000'),
      this.settings.get('loyalty_platinum_threshold', '5000'),
    ]);

    const thresholds = {
      bronze:   0,
      silver:   parseInt(silverThraw, 10),
      gold:     parseInt(goldThraw, 10),
      platinum: parseInt(platThraw, 10),
    };

    const totalEarned = await this.prisma.pointsTransaction.aggregate({
      where:   { userId, type: 'credit' },
      _sum:    { points: true },
    });

    const earnedTotal = totalEarned._sum.points ?? 0;
    const currentTier = user.loyaltyTier as TierKey;
    const meta = TIER_META[currentTier];
    const nextTier = meta.nextTier;
    const nextThreshold = nextTier ? thresholds[nextTier] : null;
    const currentThreshold = thresholds[currentTier];
    const progressPct = nextThreshold
      ? Math.min(100, Math.round(((earnedTotal - currentThreshold) / (nextThreshold - currentThreshold)) * 100))
      : 100;

    return {
      tier:             currentTier,
      tierLabel:        meta.label,
      tierColor:        meta.color,
      tierEmoji:        meta.emoji,
      pointsTotal:      earnedTotal,
      currentThreshold,
      nextTier,
      nextThreshold,
      progressPct,
      benefits: this.getTierBenefits(currentTier),
    };
  }

  async updateLoyaltyTier(userId: string): Promise<void> {
    const [silverThraw, goldThraw, platThraw] = await Promise.all([
      this.settings.get('loyalty_silver_threshold', '500'),
      this.settings.get('loyalty_gold_threshold', '2000'),
      this.settings.get('loyalty_platinum_threshold', '5000'),
    ]);

    const thresholds = {
      silver:   parseInt(silverThraw, 10),
      gold:     parseInt(goldThraw, 10),
      platinum: parseInt(platThraw, 10),
    };

    const totalEarned = await this.prisma.pointsTransaction.aggregate({
      where: { userId, type: 'credit' },
      _sum:  { points: true },
    });
    const pts = totalEarned._sum.points ?? 0;

    const newTier: TierKey =
      pts >= thresholds.platinum ? 'platinum' :
      pts >= thresholds.gold     ? 'gold'     :
      pts >= thresholds.silver   ? 'silver'   : 'bronze';

    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { loyaltyTier: true } });
    if (user && user.loyaltyTier !== newTier) {
      await this.prisma.user.update({
        where: { id: userId },
        data:  { loyaltyTier: newTier },
      });

      // Notification de montée de niveau
      const meta = TIER_META[newTier];
      const tierLabels: Record<TierKey, string> = { bronze: 'Bronze', silver: 'Argent', gold: 'Or', platinum: 'Platine' };
      this.notifications.sendToUser(
        userId,
        `${meta.emoji} Niveau ${tierLabels[newTier]} atteint !`,
        `Félicitations ! Vous avez atteint le niveau ${tierLabels[newTier]}. Découvrez vos nouveaux avantages.`,
      ).catch(() => {});
    }
  }

  /** Taux de cashback bonus selon le niveau (en %) */
  getTierCashbackRate(tier: string): number {
    const rates: Record<string, number> = { bronze: 0, silver: 5, gold: 10, platinum: 15 };
    return rates[tier] ?? 0;
  }

  /** Récupère le tier d'un passager — utilisé par BookingsService */
  async getPassengerTier(userId: string): Promise<TierKey> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { loyaltyTier: true } });
    return (user?.loyaltyTier ?? 'bronze') as TierKey;
  }

  /** Statut du pass d'accès passager */
  async getPassStatus(userId: string) {
    const [passEnabled, priceFcfa, durationDays, trialDays, graceDays] = await Promise.all([
      this.settings.get('access_pass_enabled',       'false'),
      this.settings.get('access_pass_price_fcfa',    '2000'),
      this.settings.get('access_pass_duration_days', '30'),
      this.settings.get('access_pass_trial_days',    '7'),
      this.settings.get('access_pass_grace_days',    '2'),
    ]);

    const required      = passEnabled === 'true';
    const price         = parseInt(priceFcfa, 10) || 2000;
    const duration      = parseInt(durationDays, 10) || 30;
    const trial         = parseInt(trialDays, 10) || 0;
    const grace         = parseInt(graceDays, 10) || 0;

    const user = await this.prisma.user.findUnique({
      where:  { id: userId },
      select: { passExpiresAt: true, passType: true },
    });

    // Activation automatique du pass d'essai pour les nouveaux utilisateurs
    if (required && trial > 0 && (!user?.passExpiresAt) && (!user?.passType || user.passType === 'none')) {
      const trialExpiry = new Date(Date.now() + trial * 86400000);
      await this.prisma.user.update({
        where: { id: userId },
        data:  { passExpiresAt: trialExpiry, passType: 'trial' },
      });
      return {
        required,
        active: true,
        inGrace: false,
        passType: 'trial',
        expiresAt: trialExpiry,
        daysLeft: trial,
        price,
        durationDays: duration,
        trialDays: trial,
      };
    }

    const now     = new Date();
    const expiry  = user?.passExpiresAt ?? null;
    const isActive    = !!expiry && expiry > now;
    const graceEnd    = expiry ? new Date(expiry.getTime() + grace * 86400000) : null;
    const inGrace     = !isActive && !!graceEnd && graceEnd > now;
    const daysLeft    = isActive && expiry
      ? Math.ceil((expiry.getTime() - now.getTime()) / 86400000)
      : 0;

    return {
      required,
      active: isActive,
      inGrace,
      passType: user?.passType ?? 'none',
      expiresAt: expiry,
      daysLeft,
      price,
      durationDays: duration,
      trialDays: trial,
    };
  }

  /** Confirme un pass après paiement — appelé par le webhook PASS-* */
  async confirmPass(userId: string): Promise<void> {
    const durationDays = parseInt(await this.settings.get('access_pass_duration_days', '30'), 10) || 30;
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { passExpiresAt: true } });
    // Prolonger depuis l'expiration actuelle si pas encore expiré
    const base = user?.passExpiresAt && user.passExpiresAt > new Date()
      ? user.passExpiresAt
      : new Date();
    const newExpiry = new Date(base.getTime() + durationDays * 86400000);
    await this.prisma.user.update({
      where: { id: userId },
      data:  { passExpiresAt: newExpiry, passType: 'paid' },
    });
    this.logger.log(`Pass confirmé: userId=${userId} expires=${newExpiry.toISOString()}`);
  }

  private getTierBenefits(tier: TierKey): string[] {
    const all = {
      bronze:   ['Accès à toutes les réservations', 'Support standard'],
      silver:   ['5% de cashback bonus', 'Support prioritaire', 'File d\'attente réduite'],
      gold:     ['10% de cashback bonus', 'Support VIP', 'Annulation gratuite', 'Accès véhicules Or'],
      platinum: ['15% de cashback bonus', 'Support 24h/24', 'Chauffeur attitré prioritaire', 'Accès toutes catégories'],
    };
    return all[tier];
  }
}
