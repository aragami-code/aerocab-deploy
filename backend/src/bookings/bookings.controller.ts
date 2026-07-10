import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { BookingsService } from './bookings.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { JwtAuthGuard, RolesGuard } from '../auth/guards';
import { Roles, CurrentUser } from '../auth/decorators';

@SkipThrottle()
@Controller('bookings')
@UseGuards(JwtAuthGuard)
export class BookingsController {
  constructor(private bookingsService: BookingsService) {}

  @Post()
  create(@Request() req: any, @Body() dto: CreateBookingDto) {
    return this.bookingsService.createBooking(req.user.id, dto);
  }

  // Relance d'une course sans chauffeur — réactive la MÊME réservation (prix/promo préservés).
  @Post(':id/relaunch')
  relaunch(@Request() req: any, @Param('id') id: string) {
    return this.bookingsService.relaunchBooking(req.user.id, id);
  }

  @Post('estimate')
  estimate(@Body() dto: Partial<CreateBookingDto>) {
    return this.bookingsService.estimatePrices(dto);
  }

  @Get('active')
  getActive(@Request() req: any) {
    return this.bookingsService.getActiveBooking(req.user.id);
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

  @Get(':id')
  findOne(@Request() req: any, @Param('id') id: string) {
    return this.bookingsService.getBookingById(req.user.id, id);
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

  @Get('driver/heatmap')
  @UseGuards(RolesGuard)
  @Roles('driver')
  getHeatmap() {
    return this.bookingsService.getHeatmapZones();
  }

  @Get('driver/history')
  @UseGuards(RolesGuard)
  @Roles('driver')
  getDriverHistory(
    @CurrentUser('id') userId: string,
    @Query('filter') filter?: string,
    @Query('page') page?: string,
  ) {
    return this.bookingsService.getDriverRideHistory(
      userId,
      (filter as any) || 'all',
      page ? parseInt(page) : 1,
    );
  }

  @Get(':id/driver-detail')
  @UseGuards(RolesGuard)
  @Roles('driver')
  getDriverRideDetail(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.bookingsService.getDriverRideDetail(userId, id);
  }

  @Get(':id/receipt')
  @UseGuards(RolesGuard)
  @Roles('driver')
  getDriverRideReceipt(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.bookingsService.getDriverRideReceipt(userId, id);
  }

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

  @Patch(':id/breakdown')
  @UseGuards(RolesGuard)
  @Roles('driver')
  reportBreakdown(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.bookingsService.reportBreakdown(userId, id);
  }

  // 5.B2 — Passager confirme l'arrivée à destination
  @Patch(':id/confirm')
  @UseGuards(RolesGuard)
  @Roles('passenger')
  confirmRide(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.bookingsService.confirmRide(userId, id);
  }

  // ── Modification de destination ─────────────────────────────────────────────

  @Patch(':id/destination')
  @UseGuards(RolesGuard)
  @Roles('passenger')
  requestDestinationChange(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() body: { newDestination: string; newDestLat?: number; newDestLng?: number },
  ) {
    return this.bookingsService.requestDestinationChange(userId, id, body.newDestination, body.newDestLat, body.newDestLng);
  }

  @Post(':id/destination/respond')
  @UseGuards(RolesGuard)
  @Roles('driver')
  respondDestinationChange(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body('accepted') accepted: boolean,
  ) {
    return this.bookingsService.respondDestinationChange(userId, id, accepted);
  }

  // Admin
  @Get(':id/positions')
  getPositions(@Request() req: any, @Param('id') bookingId: string) {
    return this.bookingsService.getBookingPositions(req.user.id, bookingId);
  }

  @Post(':id/initiate-call')
  initiateCall(@Request() req: any, @Param('id') bookingId: string) {
    return this.bookingsService.initiateCall(req.user.id, bookingId);
  }

  @Post(':id/tip')
  addTip(
    @Request() req: any,
    @Param('id') bookingId: string,
    @Body('amount') amount: number,
  ) {
    return this.bookingsService.addTip(req.user.id, bookingId, amount);
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
