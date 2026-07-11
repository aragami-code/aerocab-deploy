import { Controller, Get } from '@nestjs/common';
import { PALETTE_CATALOG, Palette } from './palette-catalog';

@Controller('branding')
export class BrandingController {
  @Get('palettes')
  getPalettes(): Palette[] {
    return PALETTE_CATALOG;
  }
}
