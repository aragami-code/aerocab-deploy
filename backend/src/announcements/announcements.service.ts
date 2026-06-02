import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { UsersService } from '../users/users.service';

export type FeedUserCtx = { app: 'passenger' | 'driver'; country: string | null; tier: string | null };

@Injectable()
export class AnnouncementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly users: UsersService,
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
}
