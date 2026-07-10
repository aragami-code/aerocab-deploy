import { Controller, Get, Post, Param, Query, UseGuards, Request } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards';
import { AnnouncementsService } from './announcements.service';

@Controller('announcements')
@UseGuards(JwtAuthGuard)
export class AnnouncementsController {
  constructor(private readonly svc: AnnouncementsService) {}

  @Get('feed')
  feed(@Request() req: any, @Query('app') app: 'passenger' | 'driver') {
    const resolved = app === 'driver' ? 'driver' : 'passenger';
    return this.svc.getFeed(req.user.id, resolved);
  }

  @Post(':id/seen')
  seen(@Request() req: any, @Param('id') id: string) {
    return this.svc.markSeen(req.user.id, id);
  }
}
