import { Controller, Get, UseGuards, Request } from '@nestjs/common';
import { PointsService } from './points.service';
import { JwtAuthGuard } from '../auth/guards';

@Controller('points')
@UseGuards(JwtAuthGuard)
export class PointsController {
  constructor(private pointsService: PointsService) {}

  @Get('balance')
  getBalance(@Request() req: any) {
    return this.pointsService.getBalance(req.user.id);
  }

  @Get('history')
  getHistory(@Request() req: any) {
    return this.pointsService.getHistory(req.user.id);
  }
}
