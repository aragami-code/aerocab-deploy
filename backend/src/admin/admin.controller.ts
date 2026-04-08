import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import { VerifyDriverDto } from './dto';
import { JwtAuthGuard, RolesGuard } from '../auth/guards';
import { Roles } from '../auth/decorators';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminController {
  constructor(private adminService: AdminService) {}

  // ── Stats ────────────────────────────────────────────

  @Get('stats')
  async getStats() {
    return this.adminService.getStats();
  }

  // ── Driver Verification ──────────────────────────────

  @Get('drivers')
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
  async getDriverDetail(@Param('id') id: string) {
    return this.adminService.getDriverDetail(id);
  }

  @Patch('drivers/:id/verify')
  async verifyDriver(
    @Param('id') id: string,
    @Body() dto: VerifyDriverDto,
  ) {
    return this.adminService.verifyDriver(id, dto);
  }

  @Patch('documents/:id/verify')
  async verifyDocument(
    @Param('id') id: string,
    @Body() body: { action: 'approve' | 'reject'; reason?: string },
  ) {
    return this.adminService.verifyDocument(id, body.action, body.reason);
  }

  // ── Users ────────────────────────────────────────────

  @Get('users')
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

  // ── Reports ──────────────────────────────────────────

  @Get('reports')
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

  // ── Access Passes ────────────────────────────────────

  @Get('access-passes')
  async getAccessPasses(
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adminService.getAccessPasses(
      status,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
    );
  }

  // ── Referrals ─────────────────────────────────────────

  @Get('referrals')
  async getReferrals(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adminService.getReferrals(
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
    );
  }

  // ── Settings/Tariffs ─────────────────────────────────

  @Get('settings/tariffs')
  async getTariffs() {
    return this.adminService.getTariffs();
  }

  @Patch('settings/tariffs')
  async setTariffs(@Body() body: any) {
    return this.adminService.setTariffs(body);
  }

}

