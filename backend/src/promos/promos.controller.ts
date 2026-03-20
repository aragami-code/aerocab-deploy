import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { PromosService } from './promos.service';
import { CreatePromoDto } from './dto/create-promo.dto';
import { JwtAuthGuard, RolesGuard } from '../auth/guards';
import { Roles } from '../auth/decorators';

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
  ) {
    return this.promosService.listPromos(
      page ? parseInt(page) : 1,
      limit ? parseInt(limit) : 20,
    );
  }

  @Get('validate/:code')
  async validate(@Param('code') code: string) {
    const result = await this.promosService.validatePromo(code);
    if (!result) return { valid: false, discount: 0 };
    return { valid: true, discount: result.discount };
  }
}
