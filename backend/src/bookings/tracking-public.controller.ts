import { Controller, Get, Param } from '@nestjs/common';
import { BookingsService } from './bookings.service';

@Controller('track')
export class TrackingPublicController {
  constructor(private bookingsService: BookingsService) {}

  @Get(':token')
  getPublicTracking(@Param('token') token: string) {
    return this.bookingsService.getPublicTracking(token);
  }
}
