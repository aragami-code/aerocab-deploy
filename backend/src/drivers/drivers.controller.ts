import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import { DriversService } from './drivers.service';
import {
  RegisterDriverDto,
  UpdateDriverDto,
  UpdateLocationDto,
  UploadDocumentDto,
} from './dto';
import { JwtAuthGuard, RolesGuard } from '../auth/guards';
import { CurrentUser, Roles } from '../auth/decorators';

@Controller('drivers')
export class DriversController {
  constructor(private driversService: DriversService) {}

  // ── Driver Registration ──────────────────────────────

  @Post('register')
  @UseGuards(JwtAuthGuard)
  async register(
    @CurrentUser('id') userId: string,
    @Body() dto: RegisterDriverDto,
  ) {
    return this.driversService.register(userId, dto);
  }

  // ── Driver Profile (self) ────────────────────────────

  @Get('me')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('driver')
  async getMyProfile(@CurrentUser('id') userId: string) {
    return this.driversService.getMyProfile(userId);
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('driver')
  async updateProfile(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateDriverDto,
  ) {
    return this.driversService.updateProfile(userId, dto);
  }

  // ── Documents ────────────────────────────────────────

  @Post('documents')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('driver')
  async uploadDocument(
    @CurrentUser('id') userId: string,
    @Body() dto: UploadDocumentDto,
  ) {
    return this.driversService.uploadDocument(userId, dto);
  }

  @Get('documents')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('driver')
  async getDocuments(@CurrentUser('id') userId: string) {
    return this.driversService.getDocuments(userId);
  }

  @Post('submit-review')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('driver')
  @HttpCode(200)
  async submitForReview(@CurrentUser('id') userId: string) {
    return this.driversService.submitForReview(userId);
  }

  // ── Location & Availability ──────────────────────────

  @Patch('location')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('driver')
  async updateLocation(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateLocationDto,
  ) {
    return this.driversService.updateLocation(userId, dto);
  }

  @Post('toggle-availability')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('driver')
  @HttpCode(200)
  async toggleAvailability(@CurrentUser('id') userId: string) {
    return this.driversService.toggleAvailability(userId);
  }

  // ── Public (for passengers) ──────────────────────────

  @Get('nearby')
  @UseGuards(JwtAuthGuard)
  async getNearbyDrivers(
    @Query('latitude') latitude: string,
    @Query('longitude') longitude: string,
    @Query('radius') radius?: string,
  ) {
    return this.driversService.getNearbyDrivers(
      parseFloat(latitude),
      parseFloat(longitude),
      radius ? parseFloat(radius) : undefined,
    );
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  async getDriverById(@Param('id') id: string) {
    return this.driversService.getDriverById(id);
  }
}
