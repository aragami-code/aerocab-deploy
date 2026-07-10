import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';

@Injectable()
export class MetricsGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const metricsEnabled = this.config.get<string>('METRICS_ENABLED', 'true') === 'true';
    if (!metricsEnabled) throw new UnauthorizedException('Metrics disabled');

    const token = this.config.get<string>('METRICS_TOKEN', '');

    // Sécurité — fail-closed : si aucun token n'est configuré, l'endpoint est refusé.
    // L'accès libre "réseau interne" n'est PAS supposé fiable au niveau applicatif
    // (l'endpoint peut être routé par le reverse-proxy). Pour autoriser un scrape
    // Prometheus sans token sur un réseau réellement isolé, opt-in explicite via
    // METRICS_ALLOW_NO_TOKEN=true — jamais par défaut.
    if (!token) {
      const allowNoToken = this.config.get<string>('METRICS_ALLOW_NO_TOKEN', 'false') === 'true';
      if (allowNoToken) return true;
      throw new UnauthorizedException('Metrics token not configured');
    }

    const req = context.switchToHttp().getRequest<any>();
    const auth: string = req.headers['authorization'] ?? '';
    const expected = `Bearer ${token}`;

    // Comparaison à temps constant (anti timing-attack)
    const a = Buffer.from(auth);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Invalid metrics token');
    }

    return true;
  }
}
