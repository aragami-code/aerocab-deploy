import { Controller, Get, Res, UseGuards } from '@nestjs/common';
import { PrometheusController } from '@willsoto/nestjs-prometheus';
import { MetricsGuard } from './metrics.guard';

@Controller()
export class MetricsController extends PrometheusController {
  @UseGuards(MetricsGuard)
  @Get('/metrics')
  async index(@Res({ passthrough: false }) response: any) {
    return super.index(response);
  }
}
