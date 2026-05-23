import { Module } from '@nestjs/common';
import { RatingsController } from './ratings.controller';
import { RatingsService } from './ratings.service';
import { PrismaModule } from '../database/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [PrismaModule, AuditModule, UsersModule],
  controllers: [RatingsController],
  providers: [RatingsService],
  exports: [RatingsService],
})
export class RatingsModule {}
