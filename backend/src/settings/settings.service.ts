import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

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

  // Retourne tous les paramètres sous forme de map
  async getAll(): Promise<Record<string, string>> {
    const rows = await this.prisma.appSetting.findMany();
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }
}
