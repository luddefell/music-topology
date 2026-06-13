import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import { isValidH3Cell } from '@soundscapemap/shared';
import { config } from '../config.js';

type SocketLike = {
  send: (message: string) => void;
  close: () => void;
};

export class WebSocketHub {
  private subscribers = new Map<string, Set<SocketLike>>();
  private socketCells = new WeakMap<SocketLike, Set<string>>();

  constructor(private redisSub: Redis) {}

  async subscribe(socket: SocketLike, cells: string[]) {
    const validCells = cells.filter(isValidH3Cell).slice(0, config.maxCellsPerSubscription);
    const current = this.socketCells.get(socket) ?? new Set<string>();
    for (const cell of validCells) {
      if (!this.subscribers.has(cell)) {
        this.subscribers.set(cell, new Set());
        await this.redisSub.subscribe(`region:${cell}`);
      }
      this.subscribers.get(cell)?.add(socket);
      current.add(cell);
    }
    this.socketCells.set(socket, current);
  }

  async unsubscribe(socket: SocketLike, cells: string[]) {
    const current = this.socketCells.get(socket);
    if (!current) return;
    for (const cell of cells) {
      current.delete(cell);
      const set = this.subscribers.get(cell);
      set?.delete(socket);
      if (set && set.size === 0) {
        this.subscribers.delete(cell);
        await this.redisSub.unsubscribe(`region:${cell}`);
      }
    }
  }

  async disconnect(socket: SocketLike) {
    await this.unsubscribe(socket, [...(this.socketCells.get(socket) ?? [])]);
  }

  bindRedis() {
    this.redisSub.on('message', (channel: string, message: string) => {
      const cell = channel.replace(/^region:/, '');
      for (const socket of this.subscribers.get(cell) ?? []) {
        socket.send(message);
      }
    });
  }
}

export function registerWebSocket(app: FastifyInstance, hub: WebSocketHub) {
  app.get('/ws', { websocket: true }, (socket: SocketLike & { on: (event: string, handler: (...args: any[]) => void) => void }) => {
    socket.on('message', async (raw: Buffer) => {
      try {
        const message = JSON.parse(raw.toString());
        if (message.type === 'subscribe') await hub.subscribe(socket, message.cells ?? []);
        if (message.type === 'unsubscribe') await hub.unsubscribe(socket, message.cells ?? []);
        if (message.type === 'pong') return;
      } catch {
        socket.send(JSON.stringify({ type: 'error', code: 'BAD_MESSAGE', message: 'WebSocket message could not be parsed.' }));
      }
    });
    socket.on('close', () => void hub.disconnect(socket));
  });
}
