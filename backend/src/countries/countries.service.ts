import { Injectable, Logger, BadRequestException } from '@nestjs/common';
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

  /**
   * Remplit les métadonnées pays (préfixe, symbole devise, défaut) sur les pays
   * déjà opérés, sans écraser les champs gérés par l'admin (name, currency,
   * paymentMethods, accessPrice). Idempotent — appelé au démarrage.
   */
  async backfillKnownCountries(): Promise<void> {
    const known = [
      { code: 'CM', name: 'Cameroun', currency: 'XAF', phonePrefix: '+237', flagEmoji: '🇨🇲', currencySymbol: 'FCFA', currencyDecimals: 0, defaultLanguage: 'fr' },
      { code: 'SN', name: 'Sénégal',  currency: 'XOF', phonePrefix: '+221', flagEmoji: '🇸🇳', currencySymbol: 'FCFA', currencyDecimals: 0, defaultLanguage: 'fr' },
    ];

    for (const c of known) {
      try {
        await this.prisma.country.upsert({
          where: { code: c.code },
          // Crée la ligne complète si absente (cas d'un nouvel environnement)
          create: {
            code: c.code, name: c.name, currency: c.currency,
            phonePrefix: c.phonePrefix, flagEmoji: c.flagEmoji,
            currencySymbol: c.currencySymbol, currencyDecimals: c.currencyDecimals,
            defaultLanguage: c.defaultLanguage, status: 'active',
          },
          // Ne remplit QUE les métadonnées structurelles (pas name/currency/paymentMethods)
          update: {
            phonePrefix: c.phonePrefix, flagEmoji: c.flagEmoji,
            currencySymbol: c.currencySymbol, currencyDecimals: c.currencyDecimals,
          },
        });
      } catch (e: any) {
        this.logger.warn(`[backfill] pays ${c.code} échoué: ${e?.message}`);
      }
    }

    // Garantit un pays par défaut (CM) si aucun n'est encore marqué — sans écraser un choix admin existant.
    const existingDefault = await this.prisma.country.findFirst({ where: { isDefault: true } });
    if (!existingDefault) {
      await this.setDefault('CM').catch((e) => this.logger.warn(`[backfill] setDefault CM échoué: ${e?.message}`));
    }
  }

  /** Vérifie la complétude config d'un pays pour activation. */
  async getReadiness(code: string): Promise<{ ready: boolean; missing: string[] }> {
    const cc = code.toUpperCase();
    const country = await this.prisma.country.findUnique({ where: { code: cc } });
    const missing: string[] = [];
    if (!country) return { ready: false, missing: ['country_not_found'] };
    if (!country.currency) missing.push('currency');
    const methods = (country.paymentMethods as any[]) ?? [];
    if (!Array.isArray(methods) || methods.length === 0) missing.push('payment_methods');
    const tariffs = await this.prisma.appSetting.findUnique({ where: { key: `tariffs_config:${cc}` } });
    if (!tariffs) missing.push('tariffs');
    const operated = await this.prisma.airport.count({ where: { countryCode: cc, isOperated: true } as any });
    if (operated < 1) missing.push('operated_airports');
    return { ready: missing.length === 0, missing };
  }

  /** Active un pays après vérification de complétude. */
  async activate(code: string) {
    const r = await this.getReadiness(code);
    if (!r.ready) throw new BadRequestException(`Pays incomplet : ${r.missing.join(', ')}`);
    return this.prisma.country.update({ where: { code: code.toUpperCase() }, data: { status: 'active' } });
  }

  /** Suspend un pays (nouvelles réservations bloquées). */
  async suspend(code: string) {
    return this.prisma.country.update({ where: { code: code.toUpperCase() }, data: { status: 'suspended' } });
  }
}
