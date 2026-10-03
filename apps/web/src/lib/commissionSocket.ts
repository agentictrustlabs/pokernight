import type { CommissionView } from '@pokernight/commission';
import { commissionSocketUrl, type CommissionSummary } from './api';

/**
 * GREAT COMMISSION'S TRANSPORT — one part's own view down it, and never the whole story.
 *
 * The same shape as the mystery's socket, for the same reason: the staging sends each socket a view of its own
 * (a part sees its vault and what it has been shown; nobody sees the hidden state), so there is no reducer and
 * nothing to merge. What arrives IS the truth for whoever is holding it.
 */
export interface CommissionClientState {
  view: CommissionView | null;
  staging: CommissionSummary | null;
  connection: 'connecting' | 'open' | 'reconnecting' | 'closed';
  error: string | null;
}

export class CommissionSocket {
  private ws: WebSocket | null = null;
  private closed = false;
  private retry = 0;
  private beat: ReturnType<typeof setInterval> | null = null;
  readonly state: CommissionClientState = { view: null, staging: null, connection: 'connecting', error: null };
  constructor(private readonly stagingId: string, private readonly token: string, private readonly onChange: () => void) {
    this.connect();
    // A heartbeat: the clock only runs while somebody is here. A ping is a tab proving it is a tab — it heals a
    // lost alarm and counts as nobody being present.
    this.beat = setInterval(() => { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'ping' })); }, 20_000);
  }
  private connect(): void {
    if (this.closed) return;
    const ws = new WebSocket(commissionSocketUrl(this.stagingId, this.token));
    this.ws = ws;
    ws.addEventListener('open', () => {
      this.retry = 0;
      this.state.connection = 'open';
      ws.send(JSON.stringify({ type: 'join' }));
      this.onChange();
    });
    ws.addEventListener('message', (e) => {
      type Down = { type: string; view?: CommissionView | null; staging?: CommissionSummary | null; message?: string };
      let m: Down | null = null;
      try { m = JSON.parse(String(e.data)) as Down; } catch { return; }
      if (!m) return;
      if (m.type === 'staging') {
        if (m.view !== undefined) this.state.view = m.view ?? null;
        if (m.staging !== undefined) this.state.staging = m.staging ?? null;
        this.state.error = null;
      } else if (m.type === 'error') this.state.error = m.message ?? 'The house refused that.';
      this.onChange();
    });
    ws.addEventListener('close', () => {
      if (this.closed) { this.state.connection = 'closed'; this.onChange(); return; }
      this.state.connection = 'reconnecting';
      this.onChange();
      setTimeout(() => this.connect(), Math.min(8000, 500 * 2 ** this.retry++));
    });
  }
  /** One of the engine's own verbs. It validates them; a refusal comes back in the game's words. */
  act(action: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'act', action }));
  }
  say(text: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'say', text: text.slice(0, 280) }));
  }
  /** The host's hold: everything stops, the parts included, and the clock is given back. */
  pause(on: boolean): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'pause', on }));
  }
  close(): void { this.closed = true; if (this.beat) { clearInterval(this.beat); this.beat = null; } this.ws?.close(1000, 'left'); }
}
