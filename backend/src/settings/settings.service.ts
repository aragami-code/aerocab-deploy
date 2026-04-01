import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

export interface VehicleTariff {
  basePricePerKm: number;
  minFare: number;
  coefficient: number;
}

export interface VehicleConsigneTariff {
  dailyRate: number; // FCFA/jour
}

export interface SurgeConfig {
  nightMultiplier: number;    // Multiplicateur nuit (22h-05h), défaut 1.3
  rainMultiplier: number;     // Multiplicateur pluie, défaut 1.2
  rushHourMultiplier: number; // Multiplicateur heure de pointe, défaut 1.25
  rushHourStart: string;      // ex: "07:00"
  rushHourEnd: string;        // ex: "09:00"
  rushHourStart2: string;     // ex: "17:00"
  rushHourEnd2: string;       // ex: "19:00"
}

export interface TariffsConfig {
  basePricePerKm: number;
  fcfaPerPoint: number;
  startupFee: number;        // Frais fixes de démarrage inclus dans chaque course (FCFA)
  startupMinutes: number;    // Nombre de minutes incluses dans le frais de démarrage
  pricePerMinute: number;    // FCFA/minute au-delà des minutes incluses
  vehicles: Record<string, VehicleTariff>;
  consigne: Record<string, VehicleConsigneTariff>;
  surge: SurgeConfig;
}

export const DEFAULT_TARIFFS: TariffsConfig = {
  basePricePerKm: 250,
  fcfaPerPoint: 1,
  startupFee: 500,           // 500 FCFA de frais fixes à chaque prise en charge
  startupMinutes: 3,         // 3 premières minutes incluses dans le startupFee
  pricePerMinute: 50,        // 50 FCFA/min au-delà
  vehicles: {
    eco:          { basePricePerKm: 250, minFare: 3000,  coefficient: 1.0 },
    eco_plus:     { basePricePerKm: 250, minFare: 3500,  coefficient: 1.2 },
    standard:     { basePricePerKm: 250, minFare: 5000,  coefficient: 1.4 },
    confort:      { basePricePerKm: 250, minFare: 8000,  coefficient: 2.0 },
    confort_plus: { basePricePerKm: 250, minFare: 12000, coefficient: 2.5 },
  },
  consigne: {
    eco:          { dailyRate: 5000  },
    eco_plus:     { dailyRate: 6000  },
    standard:     { dailyRate: 8000  },
    confort:      { dailyRate: 12000 },
    confort_plus: { dailyRate: 18000 },
  },
  surge: {
    nightMultiplier:    1.3,
    rainMultiplier:     1.2,
    rushHourMultiplier: 1.25,
    rushHourStart:  '07:00',
    rushHourEnd:    '09:00',
    rushHourStart2: '17:00',
    rushHourEnd2:   '19:00',
  },
};

@Injectable()
export class SettingsService {
  constructor(private prisma: PrismaService) {}

  async get(key: string, defaultValue = ''): Promise<string> {
    const setting = await this.prisma.appSetting.findUnique({ where: { key } });
    return setting?.value ?? defaultValue;
  }

  async set(key: string, value: string): Promise<void> {
    await this.prisma.appSetting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
  }

  async isProximityAssignmentEnabled(): Promise<boolean> {
    const val = await this.get('proximity_assignment_enabled', 'false');
    return val === 'true';
  }

  async setProximityAssignment(enabled: boolean): Promise<void> {
    await this.set('proximity_assignment_enabled', String(enabled));
  }

  async getAll(): Promise<Record<string, string>> {
    const rows = await this.prisma.appSetting.findMany();
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  /** Retourne la config des tarifs (DB avec fallback sur les défauts) */
  async getTariffs(): Promise<TariffsConfig> {
    const raw = await this.get('tariffs_config', '');
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as TariffsConfig;
        return {
          ...DEFAULT_TARIFFS,
          ...parsed,
          vehicles: { ...DEFAULT_TARIFFS.vehicles, ...(parsed.vehicles ?? {}) },
        };
      } catch { /* fallback */ }
    }
    return DEFAULT_TARIFFS;
  }

  /** Sauvegarde la config des tarifs */
  async setTariffs(config: TariffsConfig): Promise<void> {
    await this.set('tariffs_config', JSON.stringify(config));
  }

  /** Retourne le taux FCFA par point */
  async getFcfaPerPoint(): Promise<number> {
    const tariffs = await this.getTariffs();
    return tariffs.fcfaPerPoint;
  }
}
