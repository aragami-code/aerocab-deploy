import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../redis/redis.service';

// C5 — TTL réduit à 60s (était 300s) : permission révoquée active max 1 min.
const CACHE_TTL = 60;

@Injectable()
export class PermissionsService implements OnModuleInit {
  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
  ) {}

  // C5 — S'abonne au canal pub/sub RBAC au démarrage.
  // Quand invalidateAll() est appelé sur n'importe quelle instance (scalabilité horizontale),
  // chaque instance vide son cache local via le même mécanisme.
  async onModuleInit() {
    await this.redis.subscribe(this.redis.rbacInvalidateChannel, async (message) => {
      if (message === 'all') {
        // Invalider toutes les clés rbac:* via SCAN (non-bloquant, itératif)
        await this.scanAndDeleteRbacKeys();
      } else {
        // Invalider un user spécifique
        await this.redis.del(`rbac:${message}`);
      }
    });
  }

  private async scanAndDeleteRbacKeys(): Promise<void> {
    try {
      const keys = await this.redis.scan('rbac:*', 100);
      for (const key of keys) {
        await this.redis.del(key);
      }
    } catch { /* ignore */ }
  }

  // Retourne la liste effective des permissions d'un user (rôles + overrides)
  async getEffectivePermissions(userId: string): Promise<string[]> {
    const cacheKey = `rbac:${userId}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    // 1. Permissions via rôles
    const userRoles = await this.prisma.userAdminRole.findMany({
      where: { userId },
      include: {
        role: {
          include: {
            rolePerms: { include: { permission: true } },
          },
        },
      },
    });

    const fromRoles = new Set<string>();
    for (const ur of userRoles) {
      for (const rp of ur.role.rolePerms) {
        fromRoles.add(rp.permission.key);
      }
    }

    // 2. Overrides directs (granted=true ajoute, granted=false retire)
    const overrides = await this.prisma.userPermission.findMany({
      where: { userId },
      include: { permission: true },
    });

    for (const o of overrides) {
      if (o.granted) {
        fromRoles.add(o.permission.key);
      } else {
        fromRoles.delete(o.permission.key);
      }
    }

    const result = Array.from(fromRoles);
    await this.redis.set(cacheKey, JSON.stringify(result), CACHE_TTL);
    return result;
  }

  async hasPermission(userId: string, permission: string): Promise<boolean> {
    const perms = await this.getEffectivePermissions(userId);
    return perms.includes(permission);
  }

  // Invalider le cache d'un user via pub/sub (toutes les instances reçoivent le message)
  async invalidateCache(userId: string): Promise<void> {
    await this.redis.publish(this.redis.rbacInvalidateChannel, userId);
  }

  // C5 — invalidateAll via pub/sub : non-bloquant, scalable horizontalement.
  // Chaque instance s'abonne au canal et fait un SCAN itératif (non-bloquant).
  async invalidateAll(): Promise<void> {
    await this.redis.publish(this.redis.rbacInvalidateChannel, 'all');
  }
}
