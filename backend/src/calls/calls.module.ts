import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CallsGateway } from './calls.gateway';
import { PrismaModule } from '../database/prisma.module';

@Module({
  imports: [
    PrismaModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject:  [ConfigService],
      useFactory: (config: ConfigService) => ({ secret: config.get('JWT_SECRET') }),
    }),
  ],
  providers: [CallsGateway],
})
export class CallsModule {}
