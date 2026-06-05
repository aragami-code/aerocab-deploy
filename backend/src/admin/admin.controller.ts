import {
  Controller,
  Get,
  Patch,
  Post,
  Delete,
  Param,
  Body,
  Query,
  Header,
  HttpCode,
  StreamableFile,
  UseGuards,
  BadRequestException,
  Req,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminNotificationService } from './admin-notification.service';
import { DriversService } from '../drivers/drivers.service';
import { VerifyDriverDto } from './dto';
import { JwtAuthGuard, RolesGuard } from '../auth/guards';
import { Roles, CurrentUser } from '../auth/decorators';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { RequirePermission } from '../rbac/require-permission.decorator';
import { SkipThrottle } from '@nestjs/throttler';
import { PayoutService } from '../payments/payout.service';
import { SettingsService } from '../settings/settings.service';
import { RevenueService } from './revenue.service';
import { Granularity } from './revenue.types';

@SkipThrottle()
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles('admin')
export class AdminController {
  constructor(
    private adminService: AdminService,
    private adminNotifs: AdminNotificationService,
    private driversService: DriversService,
    private payout: PayoutService,
    private settings: SettingsService,
    private revenue: RevenueService,
  ) {}

  // ── Stats ────────────────────────────────────────────

  @Get('stats')
  @RequirePermission('view_stats')
  async getStats(@Query('country') country?: string) {
    return this.adminService.getStats(country);
  }

  // ── Revenus / Compta centrale ────────────────────────
  @Get('revenue')
  @RequirePermission('view_stats')
  async getRevenue(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('granularity') granularity?: string,
  ) {
    const now = new Date();
    const defFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const fromD = from ? new Date(from) : defFrom;
    const toD = to ? new Date(to) : now;
    if (isNaN(fromD.getTime()) || isNaN(toD.getTime())) throw new BadRequestException('Dates invalides');
    if (fromD > toD) throw new BadRequestException('from doit être antérieur à to');
    const g: Granularity = granularity === 'monthly' ? 'monthly' : 'range';
    return this.revenue.getRevenue(fromD, toD, g);
  }

  @Get('chart-data')
  @RequirePermission('view_stats')
  async getChartData(@Query('country') country?: string) {
    return this.adminService.getChartData(country);
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

  // ── Rapport financier (plage de dates) ───────────────

  @Get('financial-report')
  @RequirePermission('view_stats')
  @SkipThrottle()
  async getFinancialReport(
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    if (!from || !to) throw new BadRequestException('Paramètres from et to requis (ISO 8601)');
    const fromDate = new Date(from);
    const toDate   = new Date(to);
    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) throw new BadRequestException('Dates invalides');
    return this.adminService.getFinancialReport(from, to);
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

  @Get('drivers/country-change-requests')
  @RequirePermission('view_drivers')
  async listCountryChangeRequests(@Query('status') status?: string) {
    return this.driversService.adminListCountryChangeRequests(status);
  }

  @Patch('drivers/country-change-requests/:id')
  @RequirePermission('edit_driver_profile')
  async reviewCountryChangeRequest(
    @Param('id') id: string,
    @CurrentUser('id') adminId: string,
    @Body() body: { status: 'approved' | 'rejected'; adminNote?: string },
  ) {
    return this.driversService.adminReviewCountryChangeRequest(id, adminId, body.status, body.adminNote);
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
    @Body() body: { driverType?: string },
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

  @Get('users/:id/detail')
  @RequirePermission('view_users')
  async getUserDetail(@Param('id') id: string) {
    return this.adminService.getUserDetail(id);
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

  @Get('bookings/:id/ratings')
  @RequirePermission('view_bookings')
  async getBookingRatings(@Param('id') id: string) {
    return this.adminService.getBookingRatings(id);
  }

  @Patch('bookings/:id/cancel')
  @RequirePermission('cancel_booking')
  async cancelBooking(@Param('id') id: string) {
    return this.adminService.cancelBookingAdmin(id);
  }

  @Post('bookings/:id/refund')
  @RequirePermission('cancel_booking')
  async refundBooking(
    @Param('id') id: string,
    @Body('reason') reason: string | undefined,
    @Req() req: any,
  ) {
    return this.adminService.refundBooking(id, req.user?.id ?? 'admin', reason);
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

  // ── Pays & méthodes de paiement ─────────────────────────────────────────────

  @Get('settings/countries')
  @RequirePermission('view_tariffs')
  async getAllCountries() {
    return this.adminService.getAllCountries();
  }

  @Post('settings/countries')
  @RequirePermission('edit_tariffs')
  async createCountry(
    @Body() body: { code: string; name: string; currency: string },
  ) {
    return this.adminService.createCountry(body.code, body.name, body.currency);
  }

  @Delete('settings/countries/:countryCode')
  @RequirePermission('edit_tariffs')
  async deleteCountry(@Param('countryCode') countryCode: string) {
    return this.adminService.deleteCountry(countryCode);
  }

  @Get('settings/countries/:countryCode/payment-methods')
  @RequirePermission('view_tariffs')
  async getCountryPaymentMethods(@Param('countryCode') countryCode: string) {
    return this.adminService.getCountryPaymentMethods(countryCode);
  }

  @Patch('settings/countries/:countryCode/payment-methods')
  @RequirePermission('edit_tariffs')
  async setCountryPaymentMethods(
    @Param('countryCode') countryCode: string,
    @Body() body: { methods: { id: string; label: string; icon: string }[] },
  ) {
    return this.adminService.setCountryPaymentMethods(countryCode, body.methods);
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

  @Get('withdrawals/stats')
  @RequirePermission('view_withdrawals')
  async getWithdrawalStats() {
    return this.adminService.getWithdrawalStats();
  }

  // ── Notifications Admin ──────────────────────────────────────────────────────

  @Get('notifications')
  async getNotifications(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('unread') unread?: string,
  ) {
    return this.adminNotifs.getNotifications(
      page ? parseInt(page) : 1,
      limit ? parseInt(limit) : 20,
      unread === 'true',
    );
  }

  @Get('notifications/unread-count')
  async getUnreadCount() {
    return { count: await this.adminNotifs.getUnreadCount() };
  }

  @Patch('notifications/:id/read')
  async markNotificationRead(@Param('id') id: string) {
    return this.adminNotifs.markAsRead(id);
  }

  @Post('notifications/read-all')
  @HttpCode(200)
  async markAllNotificationsRead() {
    await this.adminNotifs.markAllAsRead();
    return { success: true };
  }

  // ── D5 : Fraude / solde ───────────────────────────────────────────────────

  @Get('fraud/alerts')
  @RequirePermission('view_stats')
  async getFraudAlerts(@Query('min') min?: string) {
    return this.adminService.getFraudAlerts(min ? parseInt(min) : 3);
  }

  @Patch('fraud/reset/:userId')
  @RequirePermission('suspend_user')
  async resetFraudCounter(@Param('userId') userId: string) {
    return this.adminService.resetFraudCounter(userId);
  }

  // ── Export CSV ─────────────────────────────────────────────────────────────

  @Get('export/bookings')
  @RequirePermission('view_stats')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="bookings.csv"')
  async exportBookings() {
    const csv = await this.adminService.getBookingsCsv();
    return new StreamableFile(Buffer.from(csv, 'utf-8'));
  }

  @Get('export/users')
  @RequirePermission('view_stats')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="users.csv"')
  async exportUsers() {
    const csv = await this.adminService.getUsersCsv();
    return new StreamableFile(Buffer.from(csv, 'utf-8'));
  }

  @Get('export/withdrawals')
  @RequirePermission('view_withdrawals')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="withdrawals.csv"')
  async exportWithdrawals() {
    const csv = await this.adminService.getWithdrawalsCsv();
    return new StreamableFile(Buffer.from(csv, 'utf-8'));
  }

  // ── Export Excel (.xlsx) ────────────────────────────────────────────────

  @Get('export/bookings/excel')
  @RequirePermission('export_data')
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @Header('Content-Disposition', 'attachment; filename="reservations.xlsx"')
  async exportBookingsExcel() {
    const buf = await this.adminService.getBookingsXlsx();
    return new StreamableFile(buf);
  }

  @Get('export/users/excel')
  @RequirePermission('export_data')
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @Header('Content-Disposition', 'attachment; filename="utilisateurs.xlsx"')
  async exportUsersExcel() {
    const buf = await this.adminService.getUsersXlsx();
    return new StreamableFile(buf);
  }

  @Get('export/withdrawals/excel')
  @RequirePermission('export_data')
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @Header('Content-Disposition', 'attachment; filename="retraits.xlsx"')
  async exportWithdrawalsExcel() {
    const buf = await this.adminService.getWithdrawalsXlsx();
    return new StreamableFile(buf);
  }

  // ── C.2 — Retrait auto chauffeur : forcer / bloquer ──────────────────────

  @Post('drivers/:driverProfileId/auto-withdrawal/force')
  @HttpCode(200)
  @RequirePermission('manage_withdrawals')
  async forceAutoWithdrawal(
    @Param('driverProfileId') driverProfileId: string,
    @Body() body: { amount?: number },
  ) {
    const balance = body.amount ?? (await (async () => {
      const w = await this.payout.getBalance(driverProfileId);
      return w.balance;
    })());
    try {
      await this.payout.disburse({ driverProfileId, amount: balance });
    } catch (e: any) {
      if (e?.status >= 400 && e?.status < 500) throw e;
      throw new BadRequestException(e?.message ?? 'Erreur lors du virement');
    }
    return { ok: true, message: `Retrait de ${balance} XAF initié` };
  }

  @Post('drivers/:driverProfileId/auto-withdrawal/block')
  @HttpCode(200)
  @RequirePermission('manage_withdrawals')
  async blockAutoWithdrawal(@Param('driverProfileId') driverProfileId: string) {
    const raw = await this.settings.get('auto_withdrawal_blocked_drivers', '[]');
    let ids: string[] = [];
    try { ids = JSON.parse(raw); } catch { ids = []; }
    if (!ids.includes(driverProfileId)) {
      ids.push(driverProfileId);
      await this.settings.set('auto_withdrawal_blocked_drivers', JSON.stringify(ids));
    }
    return { ok: true, blocked: ids };
  }

  @Delete('drivers/:driverProfileId/auto-withdrawal/block')
  @RequirePermission('manage_withdrawals')
  async unblockAutoWithdrawal(@Param('driverProfileId') driverProfileId: string) {
    const raw = await this.settings.get('auto_withdrawal_blocked_drivers', '[]');
    let ids: string[] = [];
    try { ids = JSON.parse(raw); } catch { ids = []; }
    ids = ids.filter(id => id !== driverProfileId);
    await this.settings.set('auto_withdrawal_blocked_drivers', JSON.stringify(ids));
    return { ok: true, blocked: ids };
  }

  // ── Export PDF (vrai .pdf via pdfkit) ────────────────────────────────────

  @Get('export/bookings/pdf')
  @RequirePermission('export_data')
  @Header('Content-Type', 'application/pdf')
  @Header('Content-Disposition', 'attachment; filename="reservations.pdf"')
  async exportBookingsPdf() {
    const buf = await this.adminService.getBookingsPdf();
    return new StreamableFile(buf);
  }

  @Get('export/users/pdf')
  @RequirePermission('export_data')
  @Header('Content-Type', 'application/pdf')
  @Header('Content-Disposition', 'attachment; filename="utilisateurs.pdf"')
  async exportUsersPdf() {
    const buf = await this.adminService.getUsersPdf();
    return new StreamableFile(buf);
  }
}
