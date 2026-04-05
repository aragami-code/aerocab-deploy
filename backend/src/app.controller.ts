import { Controller, Get } from '@nestjs/common';
import { PrismaService } from './database/prisma.service';

@Controller()
export class AppController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('health')
  async healthCheck() {
    let dbStatus = 'disconnected';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      dbStatus = 'connected';
    } catch {
      dbStatus = 'error';
    }

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'aerogo24-api',
      version: '0.1.0',
      database: dbStatus,
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

    let dbStatus = 'connected';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      dbStatus = 'error';
    }

    return {
      timestamp: new Date().toISOString(),
      database: dbStatus,
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
