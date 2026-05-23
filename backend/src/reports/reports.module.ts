import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { ReportsScheduler } from './reports.scheduler';
import { PrismaModule } from '../database/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [PrismaModule, NotificationsModule, UsersModule],
  controllers: [ReportsController],
  providers: [ReportsService, ReportsScheduler],
  exports: [ReportsService],
})
export class ReportsModule {}
