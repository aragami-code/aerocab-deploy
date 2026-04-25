import { Module } from '@nestjs/common';
import { ForfaitsService } from './forfaits.service';
import { ForfaitsController } from './forfaits.controller';
import { PrismaModule } from '../database/prisma.module';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [PrismaModule, RedisModule],
  controllers: [ForfaitsController],
  providers: [ForfaitsService],
  exports: [ForfaitsService],
})
export class ForfaitsModule {}
