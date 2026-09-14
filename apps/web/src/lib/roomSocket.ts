import type { RoomClientMessage, RoomManifest, RoomPerson, RoomServerMessage } from '@pokernight/protocol';
import { roomSocketUrl } from './api';

/**
 * THE ROOM'S TRANSPORT — presence in, presence out. Poses go up at most ten times a second; people come
 * down in batches. The scene reads `people` every frame and eases each body toward its last pose, so a
 * 10 Hz stream draws at whatever the display does. Reconnects with a short back-off; nothing is queued
 * while down — a stale pose is worth nothing.
 */
export interface RoomState {
  manifest: RoomManifest | null;
  you: string | null;
  people: Map<string, RoomPerson>;
  zone: string | null;
  connection: 'connecting' | 'open' | 'reconnecting' | 'closed';
  error: string | null;
}

export class RoomSocket {
  private ws: WebSocket | null = null;
  private closed = false;
  private lastPose = 0;
  private retry = 0;
  readonly state: RoomState = { manifest: null, you: null, people: new Map(), zone: null, connection: 'connecting', error: null };
  constructor(private readonly roomId: string, private readonly token: string, private readonly body: string | undefined, private readonly onChange: () => void) {
    this.connect();
  }
  private connect(): void {
    if (this.closed) return;
    const ws = new WebSocket(roomSocketUrl(this.roomId, this.token));
    this.ws = ws;
    ws.addEventListener('open', () => {
      this.retry = 0;
      this.state.connection = 'open';
      ws.send(JSON.stringify({ type: 'join', ...(this.body ? { body: this.body } : {}) } satisfies RoomClientMessage));
      this.onChange();
    });
    ws.addEventListener('message', (e) => {
      let m: RoomServerMessage;
      try { m = JSON.parse(String(e.data)) as RoomServerMessage; } catch { return; }
      if (m.type === 'room') {
        this.state.manifest = m.manifest;
        if (m.you) this.state.you = m.you;
        this.state.people = new Map(m.people.map((p) => [p.playerId, p]));
      } else if (m.type === 'people') {
        for (const p of m.upserts) this.state.people.set(p.playerId, p);
        for (const id of m.leaves) this.state.people.delete(id);
      } else if (m.type === 'zone') this.state.zone = m.zone;
      else if (m.type === 'error') this.state.error = m.message;
      this.onChange();
    });
    ws.addEventListener('close', (e) => {
      if (this.closed || e.code === 4001) { this.state.connection = 'closed'; if (e.code === 4001) this.state.error = 'You walked in from another tab; this one is standing aside.'; this.onChange(); return; }
      this.state.connection = 'reconnecting'; this.onChange();
      const wait = Math.min(8000, 500 * 2 ** this.retry++);
      setTimeout(() => this.connect(), wait);
    });
  }
  /** At most ten a second; the newest pose wins. */
  pose(x: number, y: number, yaw: number): void {
    const now = Date.now();
    if (now - this.lastPose < 100 || this.ws?.readyState !== WebSocket.OPEN) return;
    this.lastPose = now;
    this.ws.send(JSON.stringify({ type: 'pose', x, y, yaw, t: now } satisfies RoomClientMessage));
  }
  say(text: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'say', text: text.slice(0, 140) } satisfies RoomClientMessage));
  }
  close(): void { this.closed = true; this.ws?.close(1000, 'left'); }
}
