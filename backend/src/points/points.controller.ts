import { Controller, Get, UseGuards, Request, Query } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { PointsService } from './points.service';
import { JwtAuthGuard } from '../auth/guards';
import { PointsSource } from '@prisma/client';

@SkipThrottle()
@Controller('points')
@UseGuards(JwtAuthGuard)
export class PointsController {
  constructor(private pointsService: PointsService) {}

  @Get('balance')
  getBalance(@Request() req: any) {
    return this.pointsService.getBalance(req.user.id);
  }

  @Get('history')
  getHistory(
    @Request() req: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('source') source?: string,
  ) {
    const validSources: PointsSource[] = ['recharge', 'referral', 'loyalty', 'bonus', 'cashback', 'refund', 'payment'];
    const sourceFilter = validSources.includes(source as PointsSource) ? (source as PointsSource) : undefined;
    return this.pointsService.getHistory(
      req.user.id,
      page ? parseInt(page) : 1,
      limit ? parseInt(limit) : 20,
      sourceFilter,
    );
  }
}
