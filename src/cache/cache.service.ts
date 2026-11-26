import { Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { Redis } from "ioredis";

/**
 * Read-through Redis cache. Without REDIS_URL, or when Redis is down, every
 * call just runs the loader, so caching can never take an endpoint down.
 */
@Injectable()
export class CacheService implements OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private readonly redis: Redis | null;

  constructor() {
    const url = process.env.REDIS_URL?.trim();
    this.redis = url
      ? new Redis(url, { maxRetriesPerRequest: 1, enableOfflineQueue: false })
      : null;
    this.redis?.on("error", (err) =>
      this.logger.warn(`Redis error: ${err.message}`),
    );
  }

  async getOrSet<T>(key: string, ttlSec: number, load: () => Promise<T>): Promise<T> {
    if (!this.redis) return load();
    try {
      const hit = await this.redis.get(key);
      if (hit !== null) return JSON.parse(hit) as T;
    } catch {
      return load();
    }
    const value = await load();
    // shortcut: no stampede lock, concurrent misses each load once; add one if a loader gets expensive.
    await this.redis.set(key, JSON.stringify(value), "EX", ttlSec).catch(() => {});
    return value;
  }

  async del(...keys: string[]): Promise<void> {
    await this.redis?.del(...keys).catch(() => {});
  }

  async onModuleDestroy(): Promise<void> {
    this.redis?.disconnect();
  }
}
