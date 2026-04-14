import {
  Controller,
  Get,
  Patch,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import { VerifyDriverDto } from './dto';
import { JwtAuthGuard, RolesGuard } from '../auth/guards';
import { Roles, CurrentUser } from '../auth/decorators';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { RequirePermission } from '../rbac/require-permission.decorator';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles('admin')
export class AdminController {
  constructor(private adminService: AdminService) {}

  // ── Stats ────────────────────────────────────────────

  @Get('stats')
  @RequirePermission('view_stats')
  async getStats() {
    return this.adminService.getStats();
  }

  // ── Active bookings (real-time) ──────────────────────

  @Get('bookings/active')
  @RequirePermission('view_active_bookings')
  async getActiveBookings() {
    return this.adminService.getActiveBookings();
  }

  // ── Revenue metrics ───────────────────────────────────

  @Get('metrics/revenue')
  @RequirePermission('view_stats')
  async getRevenueMetrics(@Query('period') period?: 'day' | 'week' | 'month') {
    return this.adminService.getRevenueMetrics(period ?? 'day');
  }

  // ── Online drivers ────────────────────────────────────

  @Get('drivers/online')
  @RequirePermission('view_drivers')
  async getOnlineDrivers() {
    return this.adminService.getOnlineDrivers();
  }

  // ── Driver Verification ──────────────────────────────

  @Get('drivers')
  @RequirePermission('view_drivers')
  async getDrivers(
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adminService.getDrivers(
      status,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
    );
  }

  @Get('drivers/:id')
  @RequirePermission('view_drivers')
  async getDriverDetail(@Param('id') id: string) {
    return this.adminService.getDriverDetail(id);
  }

  @Patch('drivers/:id/verify')
  @RequirePermission('verify_driver')
  async verifyDriver(
    @Param('id') id: string,
    @Body() dto: VerifyDriverDto,
  ) {
    return this.adminService.verifyDriver(id, dto);
  }

  @Patch('drivers/:id/suspend')
  @RequirePermission('suspend_driver')
  async suspendDriver(
    @Param('id') id: string,
    @Body() body: { action: 'suspend' | 'reactivate' },
  ) {
    return this.adminService.suspendDriver(id, body.action);
  }

  @Patch('drivers/:id/profile')
  @RequirePermission('edit_driver_profile')
  async updateDriverProfile(
    @Param('id') id: string,
    @Body() body: { driverType?: string; consigneEnabled?: boolean },
  ) {
    return this.adminService.updateDriverProfile(id, body);
  }

  @Patch('documents/:id/verify')
  @RequirePermission('verify_driver')
  async verifyDocument(
    @Param('id') id: string,
    @Body() body: { action: 'approve' | 'reject'; reason?: string },
  ) {
    return this.adminService.verifyDocument(id, body.action, body.reason);
  }

  // ── Users ────────────────────────────────────────────

  @Get('users')
  @RequirePermission('view_users')
  async getUsers(
    @Query('role') role?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adminService.getUsers(
      role,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
    );
  }

  @Patch('users/:id/status')
  @RequirePermission('suspend_user')
  async updateUserStatus(
    @Param('id') id: string,
    @Body() body: { status: 'active' | 'suspended' },
  ) {
    return this.adminService.updateUserStatus(id, body.status);
  }

  @Post('users/:id/points')
  @RequirePermission('adjust_points')
  async adjustUserPoints(
    @Param('id') id: string,
    @CurrentUser('id') adminId: string,
    @Body() body: { amount: number; reason: string },
  ) {
    return this.adminService.adjustUserPoints(id, body.amount, body.reason, adminId);
  }

  // ── Bookings ─────────────────────────────────────────

  @Get('bookings')
  @RequirePermission('view_bookings')
  async getBookings(
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adminService.getBookings(
      status,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
    );
  }

  @Patch('bookings/:id/cancel')
  @RequirePermission('cancel_booking')
  async cancelBooking(@Param('id') id: string) {
    return this.adminService.cancelBookingAdmin(id);
  }

  // ── Reports ──────────────────────────────────────────

  @Get('reports')
  @RequirePermission('view_reports')
  async getReports(
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adminService.getReports(
      status,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
    );
  }

  // ── Referrals ─────────────────────────────────────────

  @Get('referrals')
  @RequirePermission('view_referrals')
  async getReferrals(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adminService.getReferrals(
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
    );
  }

  // ── Settings/Tariffs ──────────────────────────────────

  @Get('settings/tariffs/snapshots')
  @RequirePermission('view_tariffs')
  async getTariffSnapshots() {
    return this.adminService.getTariffSnapshots();
  }

  @Post('settings/tariffs/rollback/:snapshotId')
  @RequirePermission('rollback_tariffs')
  async rollbackTariffs(@Param('snapshotId') snapshotId: string) {
    return this.adminService.rollbackTariffs(snapshotId);
  }

  @Get('settings/tariffs')
  @RequirePermission('view_tariffs')
  async getTariffs() {
    return this.adminService.getTariffs();
  }

  @Patch('settings/tariffs')
  @RequirePermission('edit_tariffs')
  async setTariffs(
    @CurrentUser('id') userId: string,
    @Body() body: any,
  ) {
    return this.adminService.setTariffsWithSnapshot(body, userId);
  }

  @Get('settings/tariffs/countries')
  @RequirePermission('view_tariffs')
  async getCountriesWithTariffs() {
    return this.adminService.getCountriesWithTariffs();
  }

  @Get('settings/tariffs/country/:countryCode')
  @RequirePermission('view_tariffs')
  async getTariffsByCountry(@Param('countryCode') countryCode: string) {
    return this.adminService.getTariffsByCountry(countryCode);
  }

  @Patch('settings/tariffs/country/:countryCode')
  @RequirePermission('edit_tariffs')
  async setTariffsByCountry(
    @Param('countryCode') countryCode: string,
    @Body() body: any,
  ) {
    return this.adminService.setTariffsByCountry(countryCode, body);
  }

  @Patch('settings/tariffs/country/:countryCode/delete')
  @RequirePermission('edit_tariffs')
  async deleteTariffsByCountry(@Param('countryCode') countryCode: string) {
    return this.adminService.deleteTariffsByCountry(countryCode);
  }

  // ── Retraits chauffeurs ──────────────────────────────────────────────────────

  @Get('withdrawals')
  @RequirePermission('view_withdrawals')
  async getWithdrawals(
    @Query('status') status?: string,
    @Query('page') page?: string,
  ) {
    return this.adminService.getWithdrawals(status, page ? parseInt(page) : 1);
  }

  @Patch('withdrawals/:id')
  @RequirePermission('manage_withdrawals')
  async processWithdrawal(
    @Param('id') id: string,
    @CurrentUser('id') adminId: string,
    @Body() body: { status: 'approved' | 'rejected' | 'paid'; adminNote?: string },
  ) {
    return this.adminService.processWithdrawal(id, body.status, adminId, body.adminNote);
  }
}
