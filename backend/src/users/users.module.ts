import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { TrustScoreService } from './trust-score.service';
import { SettingsModule } from '../settings/settings.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [SettingsModule, NotificationsModule],
  controllers: [UsersController],
  providers: [UsersService, TrustScoreService],
  exports: [UsersService, TrustScoreService],
})
export class UsersModule {}
