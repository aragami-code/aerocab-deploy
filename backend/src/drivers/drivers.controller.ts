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
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as path from 'path';
import * as fs from 'fs';
import { DriversService } from './drivers.service';
import {
  RegisterDriverDto,
  UpdateDriverDto,
  UpdateLocationDto,
} from './dto';
import { JwtAuthGuard, RolesGuard } from '../auth/guards';
import { CurrentUser, Roles } from '../auth/decorators';

const UPLOAD_DIR = '/tmp/aerocab-uploads';
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

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
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: UPLOAD_DIR,
        filename: (_req, file, cb) => {
          const ext = path.extname(file.originalname) || '.jpg';
          cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
        },
      }),
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  async uploadDocument(
    @CurrentUser('id') userId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('type') type: string,
  ) {
    return this.driversService.uploadDocumentFile(userId, type, file);
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

  /** PATCH /drivers/availability — appelé par l'app mobile avec { isAvailable } */
  @Patch('availability')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('driver')
  async setAvailability(
    @CurrentUser('id') userId: string,
    @Body('isAvailable') isAvailable: boolean,
  ) {
    return this.driversService.setAvailability(userId, isAvailable);
  }

  /** POST /drivers/toggle-availability — toggle (conservé pour compatibilité) */
  @Post('toggle-availability')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('driver')
  @HttpCode(200)
  async toggleAvailability(@CurrentUser('id') userId: string) {
    return this.driversService.toggleAvailability(userId);
  }

  // ── Earnings ─────────────────────────────────────────

  @Get('earnings')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('driver')
  async getEarnings(@CurrentUser('id') userId: string) {
    return this.driversService.getEarnings(userId);
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
