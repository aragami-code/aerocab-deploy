import { Module } from '@nestjs/common';
import { PrismaModule } from '../database/prisma.module';
import { RbacModule } from '../rbac/rbac.module';
import { BrandingController } from './branding.controller';
import { BrandingAdminController } from './branding-admin.controller';
import { BrandingService } from './branding.service';

@Module({
  imports: [PrismaModule, RbacModule],
  controllers: [BrandingController, BrandingAdminController],
  providers: [BrandingService],
  exports: [BrandingService],
})
export class BrandingModule {}
