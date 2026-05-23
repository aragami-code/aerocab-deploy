import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query,
  UseGuards, ParseUUIDPipe,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { JwtAuthGuard, RolesGuard } from '../auth/guards';
import { Roles } from '../auth/decorators';
import { ForfaitsService } from './forfaits.service';
import { CreateForfaitDto } from './dto/create-forfait.dto';
import { UpdateForfaitDto } from './dto/update-forfait.dto';
import { MatchForfaitDto } from './dto/match-forfait.dto';

@Controller('forfaits')
export class ForfaitsController {
  constructor(private readonly forfaitsService: ForfaitsService) {}

  // ── Public ────────────────────────────────────────────────────────────────────

  @Get('airport/:code')
  async findByAirport(@Param('code') code: string) {
    return this.forfaitsService.findByAirport(code);
  }

  @Get('country/:code')
  async findByCountry(@Param('code') code: string) {
    return this.forfaitsService.findByCountry(code);
  }

  @Get('match')
  async match(@Query() dto: MatchForfaitDto) {
    return this.forfaitsService.match(
      dto.airportCode,
      dto.destLat,
      dto.destLng,
      dto.vehicleType,
      dto.bookingType,
    );
  }

  // ── Admin ─────────────────────────────────────────────────────────────────────

  @SkipThrottle()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('super_admin', 'admin', 'operator')
  @Get('admin')
  async findAll(@Query('countryCode') countryCode?: string) {
    return this.forfaitsService.findAll(countryCode);
  }

  @SkipThrottle()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('super_admin', 'admin')
  @Post('admin')
  async create(@Body() dto: CreateForfaitDto) {
    return this.forfaitsService.create(dto);
  }

  @SkipThrottle()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('super_admin', 'admin')
  @Patch('admin/:id')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateForfaitDto) {
    return this.forfaitsService.update(id, dto);
  }

  @SkipThrottle()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('super_admin', 'admin')
  @Delete('admin/:id')
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.forfaitsService.remove(id);
  }
}
