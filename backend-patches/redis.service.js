"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var RedisService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.RedisService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const ioredis_1 = __importDefault(require("ioredis"));
// C5 — Canal pub/sub pour l'invalidation globale du cache RBAC.
// Remplace le scan KEYS bloquant par un publish non-bloquant.
const RBAC_INVALIDATE_CHANNEL = 'rbac:invalidate';
let RedisService = RedisService_1 = class RedisService {
    constructor(configService) {
        this.configService = configService;
        this.logger = new common_1.Logger(RedisService_1.name);
        // Handlers enregistrés par d'autres services pour réagir aux messages pub/sub
        this.messageHandlers = new Map();
        const redisUrl = this.configService.get('REDIS_URL');
        if (redisUrl) {
            this.client = new ioredis_1.default(redisUrl);
            this.subscriber = new ioredis_1.default(redisUrl);
        }
        else {
            const opts = {
                host: this.configService.get('REDIS_HOST', 'localhost'),
                port: this.configService.get('REDIS_PORT', 6379),
                password: this.configService.get('REDIS_PASSWORD', undefined),
                db: this.configService.get('REDIS_DB', 0),
            };
            this.client = new ioredis_1.default(opts);
            this.subscriber = new ioredis_1.default(opts);
        }
    }
    async onModuleInit() {
        this.subscriber.on('message', (channel, message) => {
            var _a;
            const handlers = (_a = this.messageHandlers.get(channel)) !== null && _a !== void 0 ? _a : [];
            for (const h of handlers) {
                try {
                    h(message);
                }
                catch ( /* ignore */_b) { /* ignore */ }
            }
        });
    }
    // Enregistre un handler pour un channel donné et s'y abonne si premier handler
    async subscribe(channel, handler) {
        var _a;
        const existing = (_a = this.messageHandlers.get(channel)) !== null && _a !== void 0 ? _a : [];
        if (existing.length === 0) {
            await this.subscriber.subscribe(channel);
            this.logger.log(`[Redis] Subscribed to channel: ${channel}`);
        }
        this.messageHandlers.set(channel, [...existing, handler]);
    }
    // Publie un message sur un channel
    async publish(channel, message) {
        await this.client.publish(channel, message);
    }
    // Expose le channel RBAC pour que PermissionsService puisse s'y abonner
    get rbacInvalidateChannel() {
        return RBAC_INVALIDATE_CHANNEL;
    }
    async get(key) {
        return this.client.get(key);
    }
    async set(key, value, ttlSeconds) {
        if (ttlSeconds) {
            await this.client.setex(key, ttlSeconds, value);
        }
        else {
            await this.client.set(key, value);
        }
    }
    // SET NX EX — retourne true si la clé a été posée (lock acquis), false si déjà existante.
    async setNx(key, value, ttlSeconds) {
        const result = await this.client.set(key, value, 'NX', 'EX', ttlSeconds);
        return result === 'OK';
    }
    async del(key) {
        await this.client.del(key);
    }
    async incr(key) {
        return this.client.incr(key);
    }
    async ttl(key) {
        return this.client.ttl(key);
    }
    async expire(key, ttlSeconds) {
        await this.client.expire(key, ttlSeconds);
    }
    // Itère sur les clés correspondant au pattern via SCAN (non-bloquant).
    // Retourne toutes les clés trouvées en plusieurs passes curseur.
    async scan(pattern, count = 100) {
        const keys = [];
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
};
exports.RedisService = RedisService;
exports.RedisService = RedisService = RedisService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], RedisService);
//# sourceMappingURL=redis.service.js.map