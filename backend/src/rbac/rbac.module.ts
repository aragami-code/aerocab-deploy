import { Module } from '@nestjs/common';
import { PermissionsService } from './permissions.service';
import { PermissionsGuard } from './permissions.guard';
import { PrismaModule } from '../database/prisma.module';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [PrismaModule, RedisModule],
  providers: [PermissionsService, PermissionsGuard],
  exports: [PermissionsService, PermissionsGuard],
})
export class RbacModule {}
