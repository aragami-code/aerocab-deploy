import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { ExchangeRateService } from '../payments/exchange-rate.service';
import { buildInsights, pctDelta } from './revenue.insights';
import { Granularity, RevenueResponse, RawCountryAgg, CountryRevenue, DeltaMetric } from './revenue.types';

@Injectable()
export class RevenueService {
  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
    private fx: ExchangeRateService,
  ) {}

  /** Agrège les 3 sources sur [from,to) → map country → RawCountryAgg (devise locale). */
  private async aggregateRaw(from: Date, to: Date): Promise<Map<string, RawCountryAgg>> {
    const acc = new Map<string, RawCountryAgg>();
    const ensure = (country: string) => {
      const c = country || 'UNKNOWN';
      if (!acc.has(c)) acc.set(c, { country: c, currency: 'XAF', registration: 0, accessPass: 0, commission: 0 });
      return acc.get(c)!;
    };

    // 1. Inscription chauffeur : revenueAmount, status=paid, pays via driverProfile.countryCode
    const regs = await this.prisma.driverRegistrationPayment.findMany({
      where: { status: 'paid', createdAt: { gte: from, lt: to } },
      select: { revenueAmount: true, driverProfile: { select: { countryCode: true } } },
    });
    for (const r of regs) ensure(r.driverProfile?.countryCode ?? 'UNKNOWN').registration += r.revenueAmount ?? 0;

    // 2. Pass d'accès : Transaction metadata.type='access_pass', status=completed, pays via wallet.user.countryCode
    const passes = await this.prisma.transaction.findMany({
      where: { status: 'completed', createdAt: { gte: from, lt: to }, metadata: { path: ['type'], equals: 'access_pass' } } as any,
      select: { amount: true, wallet: { select: { user: { select: { countryCode: true } } } } },
    });
    for (const p of passes) ensure((p as any).wallet?.user?.countryCode ?? 'UNKNOWN').accessPass += p.amount ?? 0;

    // 3. Commission courses : estimatedPrice × commissionRate(défaut), status=completed, pays via operatingCountry
    const bookings = await this.prisma.booking.findMany({
      where: { status: 'completed', updatedAt: { gte: from, lt: to } },
      select: { estimatedPrice: true, commissionRate: true, operatingCountry: true },
    });
    for (const b of bookings) {
      const country = b.operatingCountry || 'UNKNOWN';
      let rate = b.commissionRate;
      if (rate == null) {
        const raw = await this.settings.getForCountry('commission_rate', country === 'UNKNOWN' ? null : country, '0.15');
        rate = parseFloat(raw) || 0.15;
      }
      ensure(country).commission += (b.estimatedPrice ?? 0) * rate;
    }
    return acc;
  }

  /** Devise d'un pays (Country.currency), fallback XAF. */
  private async currencyOf(country: string): Promise<string> {
    if (country === 'UNKNOWN') return 'XAF';
    const row = await this.prisma.country.findUnique({ where: { code: country }, select: { currency: true } });
    return row?.currency ?? 'XAF';
  }

  async getRevenue(from: Date, to: Date, granularity: Granularity): Promise<RevenueResponse> {
    const baseCurrency = 'XAF';
    const raw = await this.aggregateRaw(from, to);

    const byCountry: CountryRevenue[] = [];
    for (const agg of raw.values()) {
      const currency = await this.currencyOf(agg.country);
      const platformTotal = agg.registration + agg.accessPass;
      const ridesTotal = agg.commission;
      const grandLocal = platformTotal + ridesTotal;
      const grandBase = await this.fx.toBase(grandLocal, currency).catch(() => grandLocal);
      byCountry.push({
        country: agg.country, currency,
        platform: { registration: agg.registration, accessPass: agg.accessPass, total: platformTotal },
        rides: { commission: ridesTotal, total: ridesTotal },
        grandLocal, grandBase,
      });
    }
    byCountry.sort((a, b) => b.grandBase - a.grandBase);

    // Consolidé (base) : convertir plateforme et courses séparément
    let platBase = 0, ridesBase = 0;
    for (const c of byCountry) {
      platBase  += await this.fx.toBase(c.platform.total, c.currency).catch(() => c.platform.total);
      ridesBase += await this.fx.toBase(c.rides.total, c.currency).catch(() => c.rides.total);
    }
    const totalBase = platBase + ridesBase;

    // Comparaison période précédente (même durée, juste avant from)
    const durationMs = to.getTime() - from.getTime();
    const prevFrom = new Date(from.getTime() - durationMs);
    const prevTo = from;
    const prevRaw = await this.aggregateRaw(prevFrom, prevTo);
    let prevPlat = 0, prevRides = 0;
    for (const agg of prevRaw.values()) {
      const currency = await this.currencyOf(agg.country);
      prevPlat  += await this.fx.toBase(agg.registration + agg.accessPass, currency).catch(() => agg.registration + agg.accessPass);
      prevRides += await this.fx.toBase(agg.commission, currency).catch(() => agg.commission);
    }
    const mkDelta = (cur: number, prev: number): DeltaMetric => ({ current: Math.round(cur), previous: Math.round(prev), deltaPct: pctDelta(cur, prev) });
    const comparison = {
      platform: mkDelta(platBase, prevPlat),
      rides: mkDelta(ridesBase, prevRides),
      total: mkDelta(totalBase, prevPlat + prevRides),
    };

    const timeseries = await this.buildMonthlySeries(from, to);
    const insights = buildInsights(byCountry, comparison, totalBase);

    return {
      period: { from: from.toISOString(), to: to.toISOString(), granularity },
      baseCurrency,
      byCountry: byCountry.map(c => ({
        ...c,
        platform: { registration: Math.round(c.platform.registration), accessPass: Math.round(c.platform.accessPass), total: Math.round(c.platform.total) },
        rides: { commission: Math.round(c.rides.commission), total: Math.round(c.rides.total) },
        grandLocal: Math.round(c.grandLocal), grandBase: Math.round(c.grandBase),
      })),
      consolidated: { baseCurrency, platform: Math.round(platBase), rides: Math.round(ridesBase), total: Math.round(totalBase) },
      timeseries,
      comparison,
      insights,
    };
  }

  /** Série mensuelle consolidée (base) : un point par mois de la période. */
  private async buildMonthlySeries(from: Date, to: Date): Promise<{ month: string; platform: number; rides: number }[]> {
    const points: { month: string; platform: number; rides: number }[] = [];
    const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
    const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));
    while (cursor <= end) {
      const mStart = new Date(cursor);
      const mEnd = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
      const raw = await this.aggregateRaw(mStart, mEnd);
      let plat = 0, rides = 0;
      for (const agg of raw.values()) {
        const currency = await this.currencyOf(agg.country);
        plat  += await this.fx.toBase(agg.registration + agg.accessPass, currency).catch(() => agg.registration + agg.accessPass);
        rides += await this.fx.toBase(agg.commission, currency).catch(() => agg.commission);
      }
      points.push({ month: `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`, platform: Math.round(plat), rides: Math.round(rides) });
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    return points;
  }
}
