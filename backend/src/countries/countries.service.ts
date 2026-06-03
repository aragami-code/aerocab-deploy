import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { FALLBACK_COUNTRY } from '../common/country.constants';

@Injectable()
export class CountriesService {
  private readonly logger = new Logger(CountriesService.name);

  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.country.findMany({ orderBy: { name: 'asc' } });
  }

  findActive() {
    return this.prisma.country.findMany({ where: { status: 'active' }, orderBy: { name: 'asc' } });
  }

  /** Code du pays de repli (isDefault), sinon constante FALLBACK_COUNTRY. */
  async getDefaultCountryCode(): Promise<string> {
    const def = await this.prisma.country.findFirst({ where: { isDefault: true } });
    return def?.code ?? FALLBACK_COUNTRY;
  }

  /** Invariant : un seul pays isDefault à la fois. */
  async setDefault(code: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.country.updateMany({ where: { code: { not: code } }, data: { isDefault: false } }),
      this.prisma.country.update({ where: { code }, data: { isDefault: true } }),
    ]);
  }
}
