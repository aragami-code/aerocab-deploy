import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class CountryScopeService {
  constructor(private readonly prisma: PrismaService) {}

  /** Scope pays effectif de l'admin. [] = tous pays (au moins un rôle global). */
  async getAdminCountryScope(userId: string): Promise<string[]> {
    const roles = await this.prisma.userAdminRole.findMany({
      where: { userId },
      select: { countryScope: true },
    });
    if (roles.some((r) => (r.countryScope ?? []).length === 0)) return []; // global
    const union = new Set<string>();
    for (const r of roles)
      for (const c of r.countryScope ?? []) union.add(c.toUpperCase());
    return [...union];
  }

  /** Vrai si l'admin peut agir sur ce pays. Scope vide = tous pays. */
  async isAllowed(userId: string, countryCode: string): Promise<boolean> {
    const scope = await this.getAdminCountryScope(userId);
    if (scope.length === 0) return true;
    return scope.includes(countryCode.toUpperCase());
  }
}
