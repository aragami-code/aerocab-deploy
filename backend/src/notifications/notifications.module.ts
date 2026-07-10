import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { PrismaModule } from '../database/prisma.module';
import { AdminNotificationService } from '../admin/admin-notification.service';

@Module({
  imports: [PrismaModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, AdminNotificationService],
  exports: [NotificationsService, AdminNotificationService],
})
export class NotificationsModule {}
