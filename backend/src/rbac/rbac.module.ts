import { Module } from '@nestjs/common';
import { PermissionsService } from './permissions.service';
import { PermissionsGuard } from './permissions.guard';
import { CountryScopeService } from './country-scope.service';
import { PrismaModule } from '../database/prisma.module';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [PrismaModule, RedisModule],
  providers: [PermissionsService, PermissionsGuard, CountryScopeService],
  exports: [PermissionsService, PermissionsGuard, CountryScopeService],
})
export class RbacModule {}
