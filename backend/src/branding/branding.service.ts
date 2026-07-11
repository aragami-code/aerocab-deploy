import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { getCurrentTenantId } from '../tenancy/tenant-context';
import { ZERO_TENANT_ID } from '../tenancy/tenant.constants';
import { UpdateBrandingDto } from './dto/update-branding.dto';

export interface BrandingBlock {
  primaryColor: string;
  accentColor: string;
  logoUrl: string | null;
  appNamePassenger: string;
  appNameDriver: string;
}

const DEFAULTS: BrandingBlock = {
  primaryColor: '#C0102E',
  accentColor: '#1E1E1E',
  logoUrl: null,
  appNamePassenger: 'AeroGo',
  appNameDriver: 'AeroGo Driver',
};

@Injectable()
export class BrandingService {
  constructor(private prisma: PrismaService) {}

  async resolve(tenantId?: string): Promise<BrandingBlock> {
    const id = tenantId ?? getCurrentTenantId() ?? ZERO_TENANT_ID;
    const t = await this.prisma.tenant.findUnique({ where: { id } });
    if (!t) return { ...DEFAULTS };
    return {
      primaryColor: t.primaryColor ?? DEFAULTS.primaryColor,
      accentColor: t.accentColor ?? DEFAULTS.accentColor,
      logoUrl: t.logoUrl ?? null,
      appNamePassenger: t.appNamePassenger ?? DEFAULTS.appNamePassenger,
      appNameDriver: t.appNameDriver ?? DEFAULTS.appNameDriver,
    };
  }

  async update(tenantId: string, dto: UpdateBrandingDto): Promise<BrandingBlock> {
    await this.prisma.tenant.update({ where: { id: tenantId }, data: { ...dto } });
    return this.resolve(tenantId);
  }
}
