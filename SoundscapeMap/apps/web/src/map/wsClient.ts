import type { RegionSnapshot } from '../state/useAppStore';

type Handler = (snapshot: RegionSnapshot) => void;

export class SoundscapeSocket {
  private socket?: WebSocket;
  private cells = new Set<string>();
  private reconnectDelay = 1000;
  private closedByUser = false;

  constructor(private url: string, private onRegionUpdate: Handler, private onStatus: (status: string) => void) {}

  connect() {
    this.closedByUser = false;
    this.socket = new WebSocket(this.url);
    this.socket.onopen = () => {
      this.reconnectDelay = 1000;
      this.onStatus('connected');
      this.resubscribeAll();
    };
    this.socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.type === 'ping') this.socket?.send(JSON.stringify({ type: 'pong' }));
      if (message.type === 'region_update') this.onRegionUpdate(message.snapshot);
    };
    this.socket.onclose = () => {
      this.onStatus('reconnecting');
      if (this.closedByUser) return;
      const delay = this.reconnectDelay + Math.random() * 1000;
      window.setTimeout(() => this.connect(), delay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
    };
  }

  updateSubscriptions(nextCells: string[]) {
    const next = new Set(nextCells);
    const subscribe = [...next].filter((cell) => !this.cells.has(cell));
    const unsubscribe = [...this.cells].filter((cell) => !next.has(cell));
    if (subscribe.length) this.send({ type: 'subscribe', cells: subscribe });
    if (unsubscribe.length) this.send({ type: 'unsubscribe', cells: unsubscribe });
    this.cells = next;
  }

  close() {
    this.closedByUser = true;
    this.socket?.close();
  }

  private resubscribeAll() {
    if (this.cells.size) this.send({ type: 'subscribe', cells: [...this.cells] });
  }

  private send(payload: unknown) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(payload));
    }
  }
}
