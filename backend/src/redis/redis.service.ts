import { Injectable, OnModuleDestroy, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

// C5 — Canal pub/sub pour l'invalidation globale du cache RBAC.
// Remplace le scan KEYS bloquant par un publish non-bloquant.
const RBAC_INVALIDATE_CHANNEL = 'rbac:invalidate';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis;
  // Client dédié au subscribe (un client en mode subscribe ne peut plus émettre de commandes)
  private readonly subscriber: Redis;

  // Handlers enregistrés par d'autres services pour réagir aux messages pub/sub
  private readonly messageHandlers = new Map<string, ((message: string) => void)[]>();

  constructor(private configService: ConfigService) {
    const redisUrl = this.configService.get<string>('REDIS_URL');
    if (redisUrl) {
      this.client     = new Redis(redisUrl);
      this.subscriber = new Redis(redisUrl);
    } else {
      const opts = {
        host:     this.configService.get('REDIS_HOST', 'localhost'),
        port:     this.configService.get<number>('REDIS_PORT', 6379),
        password: this.configService.get<string | undefined>('REDIS_PASSWORD', undefined),
        db:       this.configService.get<number>('REDIS_DB', 0),
      };
      this.client     = new Redis(opts);
      this.subscriber = new Redis(opts);
    }
  }

  async onModuleInit() {
    this.subscriber.on('message', (channel: string, message: string) => {
      const handlers = this.messageHandlers.get(channel) ?? [];
      for (const h of handlers) {
        try { h(message); } catch { /* ignore */ }
      }
    });
  }

  // Enregistre un handler pour un channel donné et s'y abonne si premier handler
  async subscribe(channel: string, handler: (message: string) => void): Promise<void> {
    const existing = this.messageHandlers.get(channel) ?? [];
    if (existing.length === 0) {
      await this.subscriber.subscribe(channel);
      this.logger.log(`[Redis] Subscribed to channel: ${channel}`);
    }
    this.messageHandlers.set(channel, [...existing, handler]);
  }

  // Publie un message sur un channel
  async publish(channel: string, message: string): Promise<void> {
    await this.client.publish(channel, message);
  }

  // Expose le channel RBAC pour que PermissionsService puisse s'y abonner
  get rbacInvalidateChannel(): string {
    return RBAC_INVALIDATE_CHANNEL;
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) {
      await this.client.setex(key, ttlSeconds, value);
    } else {
      await this.client.set(key, value);
    }
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  async incr(key: string): Promise<number> {
    return this.client.incr(key);
  }

  async ttl(key: string): Promise<number> {
    return this.client.ttl(key);
  }

  async expire(key: string, ttlSeconds: number): Promise<void> {
    await this.client.expire(key, ttlSeconds);
  }

  // Itère sur les clés correspondant au pattern via SCAN (non-bloquant).
  // Retourne toutes les clés trouvées en plusieurs passes curseur.
  async scan(pattern: string, count = 100): Promise<string[]> {
    const keys: string[] = [];
    let cursor = '0';
    do {
      const [nextCursor, batch] = await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', count);
      cursor = nextCursor;
      keys.push(...batch);
    } while (cursor !== '0');
    return keys;
  }

  async onModuleDestroy() {
    await this.subscriber.quit();
    await this.client.quit();
  }
}
