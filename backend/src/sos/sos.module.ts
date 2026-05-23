import { Module } from '@nestjs/common';
import { SosController } from './sos.controller';
import { SosService } from './sos.service';
import { PrismaModule } from '../database/prisma.module';
import { SmsModule } from '../sms/sms.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [PrismaModule, SmsModule, NotificationsModule, AuditModule],
  controllers: [SosController],
  providers: [SosService],
  exports: [SosService],
})
export class SosModule {}
