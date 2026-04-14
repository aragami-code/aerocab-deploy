import { Controller, Get, Headers, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import { PrismaService } from './database/prisma.service';
import { RedisService } from './redis/redis.service';
import { AirportsService } from './airports/airports.service';
import { SettingsService } from './settings/settings.service';

const CONFIG_CACHE_KEY = 'config:cache';
const CONFIG_CACHE_TTL = 300; // 5 min

// Keys exposées publiquement via GET /config (pas les clés sensibles)
const PUBLIC_SETTING_KEYS = [
  'driver_position_interval_ms',
  'tracking_poll_2g_ms',
  'tracking_poll_3g_ms',
  'tracking_poll_4g_ms',
  'booking_passenger_timeout_ms',
  'passenger_confirm_timeout_min',
  'otp_channel',
];

@Controller()
@SkipThrottle()
export class AppController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly airports: AirportsService,
    private readonly settings: SettingsService,
    private readonly config: ConfigService,
  ) {}

  /**
   * 0.B1 — Config publique chargée au démarrage des apps mobiles.
   * Protégée par header X-App-Key pour éviter le scraping.
   * Cache Redis TTL 5min, invalidé activement par SettingsService.set() et AirportsService.
   */
  @Get('config')
  async getConfig(@Headers('x-app-key') appKey: string) {
    const expectedKey = this.config.get<string>('APP_KEY');
    if (expectedKey && appKey !== expectedKey) {
      throw new UnauthorizedException('X-App-Key invalide');
    }

    // Tenter le cache Redis
    const cached = await this.redis.get(CONFIG_CACHE_KEY);
    if (cached) {
      return JSON.parse(cached);
    }

    // Construire la réponse
    const [airportList, ...settingValues] = await Promise.all([
      this.airports.findAll(),
      ...PUBLIC_SETTING_KEYS.map((k) => this.settings.get(k)),
    ]);

    const publicSettings: Record<string, string> = {};
    PUBLIC_SETTING_KEYS.forEach((k, i) => {
      publicSettings[k] = settingValues[i] as string;
    });

    const payload = { airports: airportList, settings: publicSettings };

    // Mettre en cache
    await this.redis.set(CONFIG_CACHE_KEY, JSON.stringify(payload), CONFIG_CACHE_TTL);

    return payload;
  }

  /**
   * 0.B25 — Health check pour Render et monitoring.
   */
  @Get('health')
  async healthCheck() {
    let dbStatus = 'ok';
    let redisStatus = 'ok';

    await Promise.all([
      this.prisma.$queryRaw`SELECT 1`.catch(() => { dbStatus = 'error'; }),
      this.redis.get('__health__').catch(() => { redisStatus = 'error'; }),
    ]);

    return {
      status: dbStatus === 'ok' && redisStatus === 'ok' ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      service: 'aerogo24-api',
      version: process.env.npm_package_version ?? '0.1.0',
      database: dbStatus,
      redis: redisStatus,
    };
  }

  @Get('metrics')
  async metrics() {
    const [
      totalUsers,
      totalDrivers,
      activeDrivers,
      pendingBookings,
      activeBookings,
      completedToday,
      cancelledToday,
      totalRevenue,
    ] = await Promise.all([
      this.prisma.user.count({ where: { role: 'passenger' } }),
      this.prisma.driverProfile.count(),
      this.prisma.driverProfile.count({ where: { isAvailable: true, status: 'approved' } }),
      this.prisma.booking.count({ where: { status: 'pending' } }),
      this.prisma.booking.count({ where: { status: { in: ['confirmed', 'in_progress'] } } }),
      this.prisma.booking.count({
        where: {
          status: 'completed',
          updatedAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
        },
      }),
      this.prisma.booking.count({
        where: {
          status: 'cancelled',
          updatedAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
        },
      }),
      this.prisma.booking.aggregate({
        _sum: { estimatedPrice: true },
        where: { status: 'completed' },
      }),
    ]);

    return {
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
      memory: {
        heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
        rss: Math.round(process.memoryUsage().rss / 1024 / 1024),
        unit: 'MB',
      },
      users: { total: totalUsers },
      drivers: { total: totalDrivers, active: activeDrivers },
      bookings: {
        pending: pendingBookings,
        active: activeBookings,
        completedToday,
        cancelledToday,
        totalRevenuePts: totalRevenue._sum.estimatedPrice ?? 0,
      },
    };
  }
}
