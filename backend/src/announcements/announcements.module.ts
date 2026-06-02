import { Module } from '@nestjs/common';
import { PrismaModule } from '../database/prisma.module';
import { SettingsModule } from '../settings/settings.module';
import { UsersModule } from '../users/users.module';
import { RbacModule } from '../rbac/rbac.module';
import { AnnouncementsService } from './announcements.service';
import { AnnouncementsController } from './announcements.controller';
import { AnnouncementsAdminController, AppVersionAdminController } from './announcements.admin.controller';

@Module({
  imports: [PrismaModule, SettingsModule, UsersModule, RbacModule],
  controllers: [AnnouncementsController, AnnouncementsAdminController, AppVersionAdminController],
  providers: [AnnouncementsService],
})
export class AnnouncementsModule {}
