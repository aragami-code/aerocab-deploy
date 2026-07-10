import { Controller, Get, Post, Patch, Param, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, RolesGuard } from '../auth/guards';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { RequirePermission } from '../rbac/require-permission.decorator';
import { CountriesService } from './countries.service';

@Controller('admin/countries')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@RequirePermission('manage_countries')
export class CountriesController {
  constructor(private readonly countries: CountriesService) {}

  @Get() list() { return this.countries.list(); }

  @Get(':code/readiness') readiness(@Param('code') code: string) {
    return this.countries.getReadiness(code);
  }

  @Post() create(@Body() dto: {
    code: string; name: string; currency: string; currencySymbol?: string;
    currencyDecimals?: number; phonePrefix?: string; flagEmoji?: string;
  }) {
    return this.countries.createCountry(dto);
  }

  @Patch(':code/activate') activate(@Param('code') code: string) { return this.countries.activate(code); }
  @Patch(':code/suspend')  suspend(@Param('code') code: string)  { return this.countries.suspend(code); }
  @Patch(':code/default')  setDefault(@Param('code') code: string) {
    return this.countries.setDefault(code).then(() => ({ ok: true, code: code.toUpperCase() }));
  }
}
