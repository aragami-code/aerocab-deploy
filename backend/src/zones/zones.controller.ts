import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, HttpCode } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards';
import { RolesGuard } from '../auth/guards';
import { Roles } from '../auth/decorators';
import { ZonesService, ZonePrices } from './zones.service';
import { AirportsService } from '../airports/airports.service';
import { SettingsService } from '../settings/settings.service';

@Controller('zones')
export class ZonesController {
  constructor(
    private readonly zonesService: ZonesService,
    private readonly airportsService: AirportsService,
    private readonly settingsService: SettingsService,
  ) {}

  @Get()
  findAll() {
    return this.zonesService.findAll();
  }

  /**
   * Retourne les codes pays disponibles pour créer des zones :
   * union des pays avec aéroports opérés + pays ayant des tarifs configurés.
   */
  @Get('admin/countries')
  @Throttle({ admin: { limit: 300, ttl: 60000 } })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async getAvailableCountries() {
    const [operated, withTariffs] = await Promise.all([
      this.airportsService.getOperatedCountryCodes(),
      this.settingsService.getCountriesWithTariffs(),
    ]);
    const merged = Array.from(new Set([...operated, ...withTariffs.map((c) => c.toUpperCase())]));
    merged.sort();
    return merged;
  }

  /**
   * Retourne les aéroports opérés pour un pays donné.
   * Utilisé par l'admin pour lister les aéroports disponibles sous un pays.
   */
  @Get('admin/airports')
  @Throttle({ admin: { limit: 300, ttl: 60000 } })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async getAirportsForCountry(@Query('countryCode') countryCode: string) {
    const result = await this.airportsService.findAllAdmin({
      country: countryCode?.toUpperCase(),
      limit: 200,
    });
    const operated = result.data.filter((a: any) => a.isOperated && a.isActive);
    return operated.map((a: any) => ({
      iataCode:    a.iataCode,
      name:        a.name,
      city:        a.city,
      countryCode: a.countryCode,
    }));
  }

  /**
   * Admin — liste toutes les zones (actives ou non).
   * Filtres :
   *  - ?airportIata=DLA  → zones de l'aéroport DLA
   *  - ?countryCode=CM   → zones pays CM (sans airport)
   *  - ?countryCode=     → zones globales (null)
   *  - aucun param       → toutes
   */
  @Get('admin/all')
  @Throttle({ admin: { limit: 300, ttl: 60000 } })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  findAllAdmin(
    @Query('airportIata') airportIata?: string,
    @Query('countryCode') countryCode?: string,
  ) {
    if (airportIata !== undefined) {
      return this.zonesService.findAllIncludingInactive({
        airportIata: airportIata === '' ? null : airportIata,
      });
    }
    if (countryCode !== undefined) {
      return this.zonesService.findAllIncludingInactive({
        countryCode: countryCode === '' ? null : countryCode,
      });
    }
    return this.zonesService.findAllIncludingInactive();
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  create(
    @Body()
    dto: {
      name: string;
      minDistKm: number;
      maxDistKm: number;
      prices: ZonePrices;
      currency?: string;
      airportIata?: string | null;
      countryCode?: string | null;
      sortOrder?: number;
    },
  ) {
    return this.zonesService.create(dto);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  update(
    @Param('id') id: string,
    @Body()
    dto: Partial<{
      name: string;
      minDistKm: number;
      maxDistKm: number;
      prices: ZonePrices;
      currency: string;
      airportIata: string | null;
      countryCode: string | null;
      isActive: boolean;
      sortOrder: number;
    }>,
  ) {
    return this.zonesService.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @HttpCode(204)
  remove(@Param('id') id: string) {
    return this.zonesService.remove(id);
  }
}
