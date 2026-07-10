// src/loyalty/loyalty.controller.ts
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards';
import { CurrentUser } from '../auth/decorators';
import { LoyaltyService } from './loyalty.service';

@Controller('loyalty')
@SkipThrottle()
@UseGuards(JwtAuthGuard)
export class LoyaltyController {
  constructor(private readonly loyalty: LoyaltyService) {}

  @Get('options')
  async options(
    @CurrentUser('id') userId: string,
    @Query('vehicleType') vehicleType: string,
    @Query('country') country?: string,
  ) {
    return this.loyalty.getOptions(userId, vehicleType ?? 'standard', country ?? null);
  }
}
