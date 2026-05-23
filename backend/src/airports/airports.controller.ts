import { Controller, Get, Post, Patch, Delete, Body, Query, Param, UseGuards, BadRequestException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AirportsService } from './airports.service';
import { JwtAuthGuard, RolesGuard } from '../auth/guards';
import { Roles } from '../auth/decorators';
import { UserRole } from '@prisma/client';
import { CreateAirportDto, UpdateAirportDto } from './dto/airport.dto';

@Controller('airports')
export class AirportsController {
  constructor(private readonly airportsService: AirportsService) {}

  @Get()
  findAll() {
    return this.airportsService.findAll();
  }

  @Get('admin')
  @Throttle({ admin: { limit: 300, ttl: 60000 } })
  @Roles(UserRole.admin)
  @UseGuards(JwtAuthGuard, RolesGuard)
  findAllAdmin(
    @Query('page')    page?:    string,
    @Query('limit')   limit?:   string,
    @Query('search')  search?:  string,
    @Query('country') country?: string,
  ) {
    return this.airportsService.findAllAdmin({
      page:    page    ? parseInt(page)  : undefined,
      limit:   limit   ? parseInt(limit) : undefined,
      search:  search  || undefined,
      country: country || undefined,
    });
  }

  @Get('search')
  search(@Query('q') q: string) {
    if (!q) return [];
    return this.airportsService.search(q);
  }

  @Get('closest')
  findClosest(
    @Query('lat') lat: string,
    @Query('lng') lng: string,
  ) {
    return this.airportsService.findClosest(parseFloat(lat), parseFloat(lng));
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
      radius ? parseFloat(radius) : 80,
    );
  }

  @Get('detect')
  @UseGuards(JwtAuthGuard)
  async detect(
    @Query('lat') lat: string,
    @Query('lng') lng: string,
  ) {
    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);
    if (isNaN(latNum) || isNaN(lngNum)) {
      throw new BadRequestException('lat et lng requis et doivent être des nombres');
    }
    if (latNum < -90 || latNum > 90 || lngNum < -180 || lngNum > 180) {
      throw new BadRequestException('Coordonnées hors limites WGS-84');
    }
    const airport = await this.airportsService.detectByCoords(latNum, lngNum);
    return airport ?? { detected: false };
  }

  @Get(':code')
  findByCode(@Param('code') code: string) {
    return this.airportsService.findByCode(code);
  }

  @Post()
  @Roles(UserRole.admin)
  @UseGuards(JwtAuthGuard, RolesGuard)
  create(@Body() data: CreateAirportDto) {
    return this.airportsService.create(data);
  }

  @Patch(':id')
  @Roles(UserRole.admin)
  @UseGuards(JwtAuthGuard, RolesGuard)
  update(@Param('id') id: string, @Body() data: UpdateAirportDto) {
    return this.airportsService.update(id, data);
  }

  // Toggle dédié pour le flag « opéré » — distinct de update pour audit/RBAC clair
  @Patch(':id/operated')
  @Roles(UserRole.admin)
  @UseGuards(JwtAuthGuard, RolesGuard)
  setOperated(@Param('id') id: string, @Body() body: { isOperated: boolean }) {
    if (typeof body?.isOperated !== 'boolean') {
      throw new BadRequestException('isOperated (boolean) requis');
    }
    return this.airportsService.setOperated(id, body.isOperated);
  }

  @Delete(':id')
  @Roles(UserRole.admin)
  @UseGuards(JwtAuthGuard, RolesGuard)
  remove(@Param('id') id: string) {
    return this.airportsService.remove(id);
  }
}
