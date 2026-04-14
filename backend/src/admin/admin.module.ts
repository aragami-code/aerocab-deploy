import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { RbacAdminController } from './rbac-admin.controller';
import { RbacAdminService } from './rbac-admin.service';
import { SettingsModule } from '../settings/settings.module';
import { RbacModule } from '../rbac/rbac.module';
import { PrismaModule } from '../database/prisma.module';

@Module({
  imports: [SettingsModule, RbacModule, PrismaModule],
  controllers: [AdminController, RbacAdminController],
  providers: [AdminService, RbacAdminService],
  exports: [AdminService],
})
export class AdminModule {}
