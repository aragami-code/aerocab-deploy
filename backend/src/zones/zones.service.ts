import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

export interface ZonePrices {
  eco?: number;
  eco_plus?: number;
  standard?: number;
  confort?: number;
  confort_plus?: number;
  [key: string]: number | undefined;
}

export interface PricingZone {
  id: string;
  name: string;
  minDistKm: number;
  maxDistKm: number;
  prices: ZonePrices;
  countryCode: string | null;  // null = zone globale (fallback)
  isActive: boolean;
  sortOrder: number;
}

export interface ZoneMatchResult {
  zone: PricingZone;
  distanceKm: number;
  pricePoints: number;
  vehicleType: string;
}

@Injectable()
export class ZonesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(): Promise<PricingZone[]> {
    const zones = await this.prisma.pricingZone.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
    return zones.map(this.toZone);
  }

  async findAllIncludingInactive(filter?: { countryCode?: string | null }): Promise<PricingZone[]> {
    const where: any = {};
    if (filter && 'countryCode' in filter) {
      where.countryCode = filter.countryCode ? filter.countryCode.toUpperCase() : null;
    }
    const zones = await this.prisma.pricingZone.findMany({
      where,
      orderBy: { sortOrder: 'asc' },
    });
    return zones.map(this.toZone);
  }

  /**
   * Retourne les zones applicables à un pays donné, avec cascade :
   *  1. Zones spécifiques au pays (countryCode = X)
   *  2. Si aucune → zones globales (countryCode IS NULL)
   *
   * Permet d'avoir des découpages géographiques différents par pays sans
   * forcer la création de zones pour chaque pays opéré.
   */
  async findForCountry(countryCode: string | null): Promise<PricingZone[]> {
    if (countryCode) {
      const country = await this.prisma.pricingZone.findMany({
        where: { isActive: true, countryCode: countryCode.toUpperCase() },
        orderBy: { sortOrder: 'asc' },
      });
      if (country.length > 0) return country.map(this.toZone);
    }
    const global = await this.prisma.pricingZone.findMany({
      where: { isActive: true, countryCode: null },
      orderBy: { sortOrder: 'asc' },
    });
    return global.map(this.toZone);
  }

  async findOne(id: string): Promise<PricingZone> {
    const zone = await this.prisma.pricingZone.findUnique({ where: { id } });
    if (!zone) throw new NotFoundException('Zone introuvable');
    return this.toZone(zone);
  }

  async create(dto: { name: string; minDistKm: number; maxDistKm: number; prices: ZonePrices; countryCode?: string | null; sortOrder?: number }): Promise<PricingZone> {
    const zone = await this.prisma.pricingZone.create({
      data: {
        name: dto.name,
        minDistKm: dto.minDistKm,
        maxDistKm: dto.maxDistKm,
        prices: dto.prices as any,
        countryCode: dto.countryCode ? dto.countryCode.toUpperCase() : null,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
    return this.toZone(zone);
  }

  async update(id: string, dto: Partial<{ name: string; minDistKm: number; maxDistKm: number; prices: ZonePrices; countryCode: string | null; isActive: boolean; sortOrder: number }>): Promise<PricingZone> {
    await this.findOne(id);
    const zone = await this.prisma.pricingZone.update({
      where: { id },
      data: {
        ...(dto.name !== undefined        && { name: dto.name }),
        ...(dto.minDistKm !== undefined   && { minDistKm: dto.minDistKm }),
        ...(dto.maxDistKm !== undefined   && { maxDistKm: dto.maxDistKm }),
        ...(dto.prices !== undefined      && { prices: dto.prices as any }),
        ...(dto.countryCode !== undefined && { countryCode: dto.countryCode ? dto.countryCode.toUpperCase() : null }),
        ...(dto.isActive !== undefined    && { isActive: dto.isActive }),
        ...(dto.sortOrder !== undefined   && { sortOrder: dto.sortOrder }),
      },
    });
    return this.toZone(zone);
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    await this.prisma.pricingZone.update({ where: { id }, data: { isActive: false } });
  }

  /**
   * Trouve la zone correspondant à une distance routière donnée (sans considérer le type de véhicule).
   * Retourne null si aucune zone active n'existe.
   */
  matchZone(distanceKm: number, zones: PricingZone[]): PricingZone | null {
    const sorted = [...zones].sort((a, b) => a.minDistKm - b.minDistKm);
    for (const zone of sorted) {
      if (distanceKm >= zone.minDistKm && distanceKm < zone.maxDistKm) return zone;
    }
    return sorted[sorted.length - 1] ?? null;
  }

  /**
   * Trouve la zone ET le prix pour un type de véhicule donné.
   * Retourne null si la zone n'existe pas OU si le véhicule n'a pas de prix dans cette zone.
   * Aucun fallback : un véhicule absent de la zone = non disponible pour cette distance.
   */
  match(distanceKm: number, vehicleType: string, zones: PricingZone[]): { zone: PricingZone; pricePoints: number } | null {
    const zone = this.matchZone(distanceKm, zones);
    if (!zone) return null;
    const pricePoints = zone.prices[vehicleType];
    if (pricePoints === undefined) return null;
    return { zone, pricePoints };
  }

  private toZone(raw: any): PricingZone {
    return {
      id:          raw.id,
      name:        raw.name,
      minDistKm:   raw.minDistKm,
      maxDistKm:   raw.maxDistKm,
      prices:      (raw.prices ?? {}) as ZonePrices,
      countryCode: raw.countryCode ?? null,
      isActive:    raw.isActive,
      sortOrder:   raw.sortOrder,
    };
  }
}
