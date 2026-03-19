import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { AccessService } from './access.service';
import { PurchaseAccessDto } from './dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('access')
export class AccessController {
  constructor(private accessService: AccessService) {}

  @Post('purchase')
  @UseGuards(JwtAuthGuard)
  purchaseAccess(@CurrentUser('id') userId: string, @Body() dto: PurchaseAccessDto) {
    return this.accessService.purchaseAccess(userId, dto);
  }

  @Get('status')
  @UseGuards(JwtAuthGuard)
  getAccessStatus(@CurrentUser('id') userId: string) {
    return this.accessService.getAccessStatus(userId);
  }

  @Get('history')
  @UseGuards(JwtAuthGuard)
  getAccessHistory(@CurrentUser('id') userId: string) {
    return this.accessService.getAccessHistory(userId);
  }
}
