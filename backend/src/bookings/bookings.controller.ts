import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { JwtAuthGuard, RolesGuard } from '../auth/guards';
import { Roles, CurrentUser } from '../auth/decorators';

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

  @Get(':id')
  findOne(@Request() req: any, @Param('id') id: string) {
    return this.bookingsService.getBookingById(req.user.id, id);
  }

  @Get('history')
  getHistory(
    @Request() req: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.bookingsService.getBookingHistory(
      req.user.id,
      page ? parseInt(page) : 1,
      limit ? parseInt(limit) : 20,
    );
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

  // ── Driver ──────────────────────────────────────────────────────────────────

  @Get('driver/pending')
  @UseGuards(RolesGuard)
  @Roles('driver')
  getDriverPending(@CurrentUser('id') userId: string) {
    return this.bookingsService.getDriverPendingRequest(userId);
  }

  @Get('driver/active')
  @UseGuards(RolesGuard)
  @Roles('driver')
  getDriverActive(@CurrentUser('id') userId: string) {
    return this.bookingsService.getDriverActiveRide(userId);
  }

  @Patch(':id/accept')
  @UseGuards(RolesGuard)
  @Roles('driver')
  acceptBooking(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.bookingsService.acceptBooking(userId, id);
  }

  @Patch(':id/decline')
  @UseGuards(RolesGuard)
  @Roles('driver')
  declineBooking(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.bookingsService.declineBooking(userId, id);
  }

  @Patch(':id/arrived')
  @UseGuards(RolesGuard)
  @Roles('driver')
  notifyArrival(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.bookingsService.notifyArrival(userId, id);
  }

  @Patch(':id/start')
  @UseGuards(RolesGuard)
  @Roles('driver')
  startRide(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.bookingsService.startRide(userId, id);
  }

  @Patch(':id/complete')
  @UseGuards(RolesGuard)
  @Roles('driver')
  completeRide(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.bookingsService.completeRide(userId, id);
  }

  // Admin
  @Get(':id/positions')
  getPositions(@Request() req: any, @Param('id') bookingId: string) {
    return this.bookingsService.getBookingPositions(req.user.id, bookingId);
  }

  @Get('admin/all')
  @UseGuards(RolesGuard)
  @Roles('admin')
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
