import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { ExportService } from './export.service';
import { RevenueService } from './revenue.service';
import { RbacAdminController } from './rbac-admin.controller';
import { RbacAdminService } from './rbac-admin.service';
import { SettingsModule } from '../settings/settings.module';
import { RbacModule } from '../rbac/rbac.module';
import { PrismaModule } from '../database/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RedisModule } from '../redis/redis.module';
import { PaymentsModule } from '../payments/payments.module';
import { DriversModule } from '../drivers/drivers.module';

@Module({
  imports: [SettingsModule, RbacModule, PrismaModule, NotificationsModule, RedisModule, PaymentsModule, DriversModule],
  controllers: [AdminController, RbacAdminController],
  providers: [AdminService, RbacAdminService, ExportService, RevenueService],
  exports: [AdminService],
})
export class AdminModule {}
