import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, HttpCode } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards';
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
   * Retourne la liste des codes pays disponibles pour créer des zones :
   * union des pays opérés (airports.is_operated=true) et des pays ayant des
   * tarifs configurés. 100% dynamique, aucun pays hardcodé.
   */
  @Get('admin/countries')
  @UseGuards(JwtAuthGuard)
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
   * Admin — liste toutes les zones (actives ou non).
   * Filtre optionnel :
   *  - ?countryCode=CM  → uniquement les zones CM
   *  - ?countryCode=    → uniquement les zones globales (null)
   *  - aucun param      → toutes confondues
   */
  @Get('admin/all')
  @UseGuards(JwtAuthGuard)
  findAllAdmin(@Query('countryCode') countryCode?: string) {
    if (countryCode === undefined) {
      return this.zonesService.findAllIncludingInactive();
    }
    return this.zonesService.findAllIncludingInactive({
      countryCode: countryCode === '' ? null : countryCode,
    });
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  create(@Body() dto: { name: string; minDistKm: number; maxDistKm: number; prices: ZonePrices; countryCode?: string | null; sortOrder?: number }) {
    return this.zonesService.create(dto);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  update(
    @Param('id') id: string,
    @Body() dto: Partial<{ name: string; minDistKm: number; maxDistKm: number; prices: ZonePrices; countryCode: string | null; isActive: boolean; sortOrder: number }>,
  ) {
    return this.zonesService.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @HttpCode(204)
  remove(@Param('id') id: string) {
    return this.zonesService.remove(id);
  }
}
