import { Module } from '@nestjs/common';
import { CleanupService } from './cleanup.service';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [SettingsModule],
  providers: [CleanupService],
})
export class CleanupModule {}
