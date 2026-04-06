import { Controller, Get, Query, Param, UseGuards } from '@nestjs/common';
import { AirportsService } from './airports.service';
import { JwtAuthGuard } from '../auth/guards';

@Controller('airports')
@UseGuards(JwtAuthGuard)
export class AirportsController {
  constructor(private readonly airportsService: AirportsService) {}

  @Get()
  findAll() {
    return this.airportsService.findAll();
  }

  @Get('search')
  search(@Query('q') q: string) {
    if (!q) return [];
    return this.airportsService.search(q);
  }

  @Get('nearby')
  findNearby(
    @Query('lat') lat: string,
    @Query('lng') lng: string,
    @Query('radius') radius?: string,
  ) {
    return this.airportsService.findNearby(
      parseFloat(lat),
      parseFloat(lng),
      radius ? parseFloat(radius) : 100,
    );
  }

  @Get(':code')
  findByCode(@Param('code') code: string) {
    return this.airportsService.findByCode(code);
  }
}
