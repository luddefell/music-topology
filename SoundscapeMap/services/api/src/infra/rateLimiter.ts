import type { Redis } from 'ioredis';

export class SlidingWindowRateLimiter {
  constructor(private redis: Redis) {}

  async allow(key: string, limit: number, windowSeconds: number) {
    const now = Date.now();
    const redisKey = `rl:${key}`;
    const minScore = now - windowSeconds * 1000;
    const token = `${now}:${Math.random().toString(36).slice(2)}`;
    const pipeline = this.redis.multi();
    pipeline.zremrangebyscore(redisKey, 0, minScore);
    pipeline.zcard(redisKey);
    pipeline.zadd(redisKey, now, token);
    pipeline.expire(redisKey, windowSeconds);
    const result = await pipeline.exec();
    const count = Number(result?.[1]?.[1] ?? 0);
    if (count >= limit) {
      await this.redis.zrem(redisKey, token);
      return { ok: false, retry_after: windowSeconds };
    }
    return { ok: true, remaining: Math.max(0, limit - count - 1) };
  }
}
