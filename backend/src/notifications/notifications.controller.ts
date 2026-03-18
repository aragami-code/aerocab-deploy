import { Controller, Post, Body, UseGuards, Request } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../auth/guards';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private notificationsService: NotificationsService) {}

  @Post('token')
  async saveToken(@Request() req: any, @Body() body: { token: string }) {
    await this.notificationsService.savePushToken(req.user.id, body.token);
    return { success: true };
  }
}
