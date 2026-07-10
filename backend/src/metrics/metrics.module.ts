import { Module } from '@nestjs/common';
import { PrometheusModule } from '@willsoto/nestjs-prometheus';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MetricsController } from './metrics.controller';
import { MetricsGuard } from './metrics.guard';

@Module({
  imports: [
    PrometheusModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        defaultMetrics: {
          enabled: config.get<string>('METRICS_DEFAULT_METRICS', 'true') === 'true',
        },
        path: config.get<string>('METRICS_PATH', '/metrics'),
        controller: MetricsController,
      }),
    }),
  ],
  providers: [MetricsGuard],
  exports: [PrometheusModule],
})
export class MetricsModule {}
