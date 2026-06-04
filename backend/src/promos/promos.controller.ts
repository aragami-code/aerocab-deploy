import { Controller, Get, Post, Delete, Patch, Body, Param, Query, Request, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { PromosService } from './promos.service';
import { CreatePromoDto } from './dto/create-promo.dto';
import { JwtAuthGuard, RolesGuard } from '../auth/guards';
import { Roles } from '../auth/decorators';

@SkipThrottle()
@Controller('promos')
@UseGuards(JwtAuthGuard)
export class PromosController {
  constructor(private promosService: PromosService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles('admin')
  create(@Body() dto: CreatePromoDto) {
    return this.promosService.createPromo(dto);
  }

  @Get()
  @UseGuards(RolesGuard)
  @Roles('admin')
  list(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('country') country?: string,
  ) {
    return this.promosService.listPromos(
      page ? parseInt(page) : 1,
      limit ? parseInt(limit) : 20,
      country || undefined,
    );
  }

  @Get('validate/:code')
  async validate(@Request() req: any, @Param('code') code: string) {
    // L'endpoint est authentifié (JwtAuthGuard au niveau classe) → on scope le
    // promo par le pays de l'utilisateur qui le saisit.
    const result = await this.promosService.validatePromo(code, req.user?.id);
    if (!result) return { valid: false, discount: 0 };
    return { valid: true, discount: result.discount };
  }

  @Patch(':id/toggle')
  @UseGuards(RolesGuard)
  @Roles('admin')
  toggle(@Param('id') id: string) {
    return this.promosService.togglePromo(id);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('admin')
  remove(@Param('id') id: string) {
    return this.promosService.deletePromo(id);
  }
}
