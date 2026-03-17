import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
} from '@nestjs/common';
import { AccessService } from './access.service';
import { PurchaseAccessDto } from './dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('access')
export class AccessController {
  constructor(private accessService: AccessService) {}

  /**
   * POST /access/purchase
   * Purchase a 48h access pass
   */
  @Post('purchase')
  @UseGuards(JwtAuthGuard)
  async purchaseAccess(
    @CurrentUser('id') userId: string,
    @Body() dto: PurchaseAccessDto,
  ) {
    return this.accessService.purchaseAccess(userId, dto);
  }

  /**
   * GET /access/status
   * Check current access status
   */
  @Get('status')
  @UseGuards(JwtAuthGuard)
  async getAccessStatus(@CurrentUser('id') userId: string) {
    return this.accessService.getAccessStatus(userId);
  }

  /**
   * GET /access/history
   * Get access purchase history
   */
  @Get('history')
  @UseGuards(JwtAuthGuard)
  async getAccessHistory(@CurrentUser('id') userId: string) {
    return this.accessService.getAccessHistory(userId);
  }

  /**
   * POST /access/webhook
   * Handle payment provider webhook (NO auth - called by payment provider)
   */
  @Post('webhook')
  async handleWebhook(
    @Body() body: { paymentRef: string; status: 'success' | 'failed' },
  ) {
    return this.accessService.handlePaymentWebhook(body.paymentRef, body.status);
  }
}
