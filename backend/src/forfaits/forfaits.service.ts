import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../redis/redis.service';
import { CreateForfaitDto } from './dto/create-forfait.dto';
import { UpdateForfaitDto } from './dto/update-forfait.dto';

const CACHE_TTL = 300; // 5 minutes

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

@Injectable()
export class ForfaitsService {
  private readonly logger = new Logger(ForfaitsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async create(dto: CreateForfaitDto) {
    if ((dto.driverPercent ?? 85) + (dto.companyPercent ?? 15) !== 100) {
      throw new BadRequestException('driverPercent + companyPercent doit être égal à 100');
    }
    const forfait = await this.prisma.forfait.create({
      data: {
        name:             dto.name,
        airportCode:      dto.airportCode.toUpperCase(),
        destinationName:  dto.destinationName,
        destLat:          dto.destLat,
        destLng:          dto.destLng,
        destRadius:       dto.destRadius ?? 2.0,
        priceAmount:      dto.priceAmount,
        currency:         dto.currency ?? 'XAF',
        countryCode:      dto.countryCode.toUpperCase(),
        vehicleTypes:     dto.vehicleTypes ?? [],
        bookingTypes:     (dto.bookingTypes as any[]) ?? [],
        driverPercent:    dto.driverPercent ?? 85,
        companyPercent:   dto.companyPercent ?? 15,
        nightSurgeRate:   dto.nightSurgeRate ?? null,
        rainSurgeRate:    dto.rainSurgeRate ?? null,
        rushHourSurgeRate: dto.rushHourSurgeRate ?? null,
        isActive:         dto.isActive ?? true,
      },
    });
    await this.invalidateCache(forfait.airportCode);
    return forfait;
  }

  async findAll(countryCode?: string) {
    return this.prisma.forfait.findMany({
      where: countryCode ? { countryCode: countryCode.toUpperCase() } : undefined,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const forfait = await this.prisma.forfait.findUnique({ where: { id } });
    if (!forfait) throw new NotFoundException('Forfait introuvable');
    return forfait;
  }

  async update(id: string, dto: UpdateForfaitDto) {
    const existing = await this.findOne(id);
    if (dto.driverPercent !== undefined || dto.companyPercent !== undefined) {
      const newDriver  = dto.driverPercent  ?? existing.driverPercent;
      const newCompany = dto.companyPercent ?? existing.companyPercent;
      if (newDriver + newCompany !== 100) {
        throw new BadRequestException('driverPercent + companyPercent doit être égal à 100');
      }
    }
    const updated = await this.prisma.forfait.update({ where: { id }, data: dto as any });
    await this.invalidateCache(updated.airportCode);
    return updated;
  }

  async remove(id: string) {
    await this.findOne(id);
    const deleted = await this.prisma.forfait.update({
      where: { id },
      data: { isActive: false },
    });
    await this.invalidateCache(deleted.airportCode);
    return { success: true };
  }

  async findByAirport(airportCode: string) {
    const cacheKey = `forfaits:airport:${airportCode.toUpperCase()}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const forfaits = await this.prisma.forfait.findMany({
      where: { airportCode: airportCode.toUpperCase(), isActive: true },
      orderBy: { priceAmount: 'asc' },
    });

    await this.redis.set(cacheKey, JSON.stringify(forfaits), CACHE_TTL);
    return forfaits;
  }

  async match(
    airportCode: string,
    destLat: number,
    destLng: number,
    vehicleType?: string,
    bookingType?: string,
  ) {
    const forfaits = await this.findByAirport(airportCode);

    for (const f of forfaits) {
      const dist = haversineKm(destLat, destLng, f.destLat, f.destLng);
      if (dist > f.destRadius) continue;
      if (vehicleType && f.vehicleTypes.length > 0 && !f.vehicleTypes.includes(vehicleType)) continue;
      if (bookingType && f.bookingTypes.length > 0 && !(f.bookingTypes as string[]).includes(bookingType)) continue;
      return f;
    }
    return null;
  }

  calculatePrice(
    forfait: { priceAmount: number; nightSurgeRate: number | null; rainSurgeRate: number | null; rushHourSurgeRate: number | null },
    surges: { night: boolean; rain: boolean; rushHour: boolean },
  ): number {
    let price = forfait.priceAmount;
    if (surges.night    && forfait.nightSurgeRate    !== null) price *= forfait.nightSurgeRate!;
    if (surges.rain     && forfait.rainSurgeRate     !== null) price *= forfait.rainSurgeRate!;
    if (surges.rushHour && forfait.rushHourSurgeRate !== null) price *= forfait.rushHourSurgeRate!;
    return Math.round(price);
  }

  private async invalidateCache(airportCode: string) {
    await this.redis.del(`forfaits:airport:${airportCode.toUpperCase()}`);
    this.logger.log(`[Forfaits] Cache invalidé pour ${airportCode}`);
  }
}
