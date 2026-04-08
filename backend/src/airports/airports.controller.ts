import { Controller, Get, Post, Patch, Delete, Body, Query, Param, UseGuards } from '@nestjs/common';
import { AirportsService } from './airports.service';
import { JwtAuthGuard, RolesGuard } from '../auth/guards';
import { Roles } from '../auth/decorators';
import { UserRole } from '@prisma/client';
import { CreateAirportDto, UpdateAirportDto } from './dto/airport.dto';

@Controller('airports')
@UseGuards(JwtAuthGuard)
export class AirportsController {
  constructor(private readonly airportsService: AirportsService) {}

  @Get()
  findAll() {
    return this.airportsService.findAll();
  }

  @Get('admin')
  @Roles(UserRole.admin)
  @UseGuards(RolesGuard)
  findAllAdmin() {
    return this.airportsService.findAllAdmin();
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
      radius ? parseFloat(radius) : 1000,
    );
  }

  @Get(':code')
  findByCode(@Param('code') code: string) {
    return this.airportsService.findByCode(code);
  }

  @Post()
  @Roles(UserRole.admin)
  @UseGuards(RolesGuard)
  create(@Body() data: CreateAirportDto) {
    return this.airportsService.create(data);
  }

  @Patch(':id')
  @Roles(UserRole.admin)
  @UseGuards(RolesGuard)
  update(@Param('id') id: string, @Body() data: UpdateAirportDto) {
    return this.airportsService.update(id, data);
  }

  @Delete(':id')
  @Roles(UserRole.admin)
  @UseGuards(RolesGuard)
  remove(@Param('id') id: string) {
    return this.airportsService.remove(id);
  }
}
