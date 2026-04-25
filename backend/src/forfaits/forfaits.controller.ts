import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query,
  UseGuards, ParseUUIDPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ForfaitsService } from './forfaits.service';
import { CreateForfaitDto } from './dto/create-forfait.dto';
import { UpdateForfaitDto } from './dto/update-forfait.dto';
import { MatchForfaitDto } from './dto/match-forfait.dto';

@Controller('forfaits')
export class ForfaitsController {
  constructor(private readonly forfaitsService: ForfaitsService) {}

  // ── Public ────────────────────────────────────────────────────────────────────

  @Get('airport/:code')
  findByAirport(@Param('code') code: string) {
    return this.forfaitsService.findByAirport(code);
  }

  @Get('match')
  match(@Query() dto: MatchForfaitDto) {
    return this.forfaitsService.match(
      dto.airportCode,
      dto.destLat,
      dto.destLng,
      dto.vehicleType,
      dto.bookingType,
    );
  }

  // ── Admin ─────────────────────────────────────────────────────────────────────

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('super_admin', 'admin')
  @Get('admin')
  findAll(@Query('countryCode') countryCode?: string) {
    return this.forfaitsService.findAll(countryCode);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('super_admin', 'admin')
  @Post('admin')
  create(@Body() dto: CreateForfaitDto) {
    return this.forfaitsService.create(dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('super_admin', 'admin')
  @Patch('admin/:id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateForfaitDto) {
    return this.forfaitsService.update(id, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('super_admin', 'admin')
  @Delete('admin/:id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.forfaitsService.remove(id);
  }
}
