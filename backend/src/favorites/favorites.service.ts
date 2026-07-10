import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class FavoritesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Résout un identifiant chauffeur qui peut être soit un `DriverProfile.id`,
   * soit le `User.id` du chauffeur (les écrans passager — notation — manipulent
   * l'id utilisateur). Retourne toujours le `DriverProfile.id`, ou null si introuvable.
   */
  private async resolveDriverProfileId(driverIdOrUserId: string): Promise<string | null> {
    const byProfile = await this.prisma.driverProfile.findUnique({ where: { id: driverIdOrUserId }, select: { id: true } });
    if (byProfile) return byProfile.id;
    const byUser = await this.prisma.driverProfile.findUnique({ where: { userId: driverIdOrUserId }, select: { id: true } });
    return byUser?.id ?? null;
  }

  /** Ajoute/retire un chauffeur des favoris du passager (toggle idempotent). */
  async toggle(passengerId: string, driverIdOrUserId: string): Promise<{ favorited: boolean }> {
    const driverId = await this.resolveDriverProfileId(driverIdOrUserId);
    if (!driverId) throw new NotFoundException('Chauffeur introuvable');
    const existing = await this.prisma.favoriteDriver.findUnique({
      where: { passengerId_driverId: { passengerId, driverId } },
    });
    if (existing) {
      await this.prisma.favoriteDriver.delete({ where: { id: existing.id } });
      return { favorited: false };
    }
    await this.prisma.favoriteDriver.create({ data: { passengerId, driverId } });
    return { favorited: true };
  }

  /** Liste des favoris d'un passager (avec infos chauffeur). */
  async list(passengerId: string) {
    return this.prisma.favoriteDriver.findMany({
      where: { passengerId },
      orderBy: { createdAt: 'desc' },
      include: {
        driver: { select: { id: true, userId: true, ratingAvg: true, vehicleBrand: true, vehicleModel: true } },
      },
    });
  }

  /** IDs des chauffeurs favoris (pour le biais dispatch). */
  async driverIds(passengerId: string): Promise<string[]> {
    const rows = await this.prisma.favoriteDriver.findMany({
      where: { passengerId },
      select: { driverId: true },
    });
    return rows.map((r) => r.driverId);
  }

  /** Ce passager a-t-il mis ce chauffeur en favori ? (badge app chauffeur). */
  async isFavorite(passengerId: string, driverIdOrUserId: string): Promise<boolean> {
    const driverId = await this.resolveDriverProfileId(driverIdOrUserId);
    if (!driverId) return false;
    const row = await this.prisma.favoriteDriver.findUnique({
      where: { passengerId_driverId: { passengerId, driverId } },
    });
    return !!row;
  }
}
