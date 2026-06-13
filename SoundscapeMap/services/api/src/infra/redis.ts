import { Redis } from 'ioredis';
import type { RegionSnapshot } from '../types.js';

export class RedisBus {
  readonly pub: Redis;
  readonly sub: Redis;

  constructor(redisUrl: string) {
    this.pub = new Redis(redisUrl);
    this.sub = new Redis(redisUrl);
  }

  async health() {
    await this.pub.ping();
    return { ok: true };
  }

  async publishRegionUpdate(snapshot: RegionSnapshot) {
    const payload = JSON.stringify({ type: 'region_update', h3_cell: snapshot.h3_cell, snapshot });
    await this.pub.set(`region_snapshot:${snapshot.h3_cell}`, JSON.stringify(snapshot), 'EX', 60);
    await this.pub.publish(`region:${snapshot.h3_cell}`, payload);
  }
}
