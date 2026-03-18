import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { JwtAuthGuard } from '../auth/guards';

@Controller('bookings')
@UseGuards(JwtAuthGuard)
export class BookingsController {
  constructor(private bookingsService: BookingsService) {}

  @Post()
  create(@Request() req: any, @Body() dto: CreateBookingDto) {
    return this.bookingsService.createBooking(req.user.id, dto);
  }

  @Get('active')
  getActive(@Request() req: any) {
    return this.bookingsService.getActiveBooking(req.user.id);
  }

  @Get('history')
  getHistory(@Request() req: any) {
    return this.bookingsService.getBookingHistory(req.user.id);
  }

  @Get('stats')
  getStats(@Request() req: any) {
    return this.bookingsService.getPassengerStats(req.user.id);
  }

  @Patch(':id/share-trip')
  updateShareTrip(
    @Request() req: any,
    @Param('id') id: string,
    @Body('enabled') enabled: boolean,
  ) {
    return this.bookingsService.updateShareTrip(req.user.id, id, enabled);
  }

  @Delete(':id')
  cancel(@Request() req: any, @Param('id') id: string) {
    return this.bookingsService.cancelBooking(req.user.id, id);
  }

  // Admin
  @Get('admin/all')
  getAllBookings(
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.bookingsService.getAllBookings(
      status,
      page ? parseInt(page) : 1,
      limit ? parseInt(limit) : 20,
    );
  }
}
