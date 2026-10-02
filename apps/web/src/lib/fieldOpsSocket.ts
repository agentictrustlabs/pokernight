import type { FieldOpsView } from '@pokernight/fieldops';
import { fieldOpsSocketUrl, type FieldOpsAgentRow, type FieldOpsSummary } from './api';

/**
 * FIELD OPERATIONS' TRANSPORT — one part's own view down it, and the agent report beside it.
 *
 * The same shape as the commission's socket: the season sends each socket a view of its own (a part sees where it
 * stands and what it may do; nobody sees the readiness), so there is no reducer and nothing to merge. The AGENTS
 * row rides every push because the season is a test of them and the page shows the tally as it moves.
 */
export interface FieldOpsClientState {
  view: FieldOpsView | null;
  staging: FieldOpsSummary | null;
  agents: FieldOpsAgentRow[];
  connection: 'connecting' | 'open' | 'reconnecting' | 'closed';
  error: string | null;
}

export class FieldOpsSocket {
  private ws: WebSocket | null = null;
  private closed = false;
  private retry = 0;
  private beat: ReturnType<typeof setInterval> | null = null;
  readonly state: FieldOpsClientState = { view: null, staging: null, agents: [], connection: 'connecting', error: null };
  constructor(private readonly stagingId: string, private readonly token: string, private readonly onChange: () => void) {
    this.connect();
    this.beat = setInterval(() => { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'ping' })); }, 20_000);
  }
  private connect(): void {
    if (this.closed) return;
    const ws = new WebSocket(fieldOpsSocketUrl(this.stagingId, this.token));
    this.ws = ws;
    ws.addEventListener('open', () => { this.retry = 0; this.state.connection = 'open'; ws.send(JSON.stringify({ type: 'join' })); this.onChange(); });
    ws.addEventListener('message', (e) => {
      type Down = { type: string; view?: FieldOpsView | null; staging?: FieldOpsSummary | null; agents?: FieldOpsAgentRow[]; message?: string };
      let m: Down | null = null;
      try { m = JSON.parse(String(e.data)) as Down; } catch { return; }
      if (!m) return;
      if (m.type === 'staging') {
        if (m.view !== undefined) this.state.view = m.view ?? null;
        if (m.staging !== undefined) this.state.staging = m.staging ?? null;
        if (m.agents !== undefined) this.state.agents = m.agents ?? [];
        this.state.error = null;
      } else if (m.type === 'error') this.state.error = m.message ?? 'The season refused that.';
      this.onChange();
    });
    ws.addEventListener('close', () => {
      if (this.closed) { this.state.connection = 'closed'; this.onChange(); return; }
      this.state.connection = 'reconnecting'; this.onChange();
      setTimeout(() => this.connect(), Math.min(8000, 500 * 2 ** this.retry++));
    });
  }
  /** One of the engine's own verbs. It validates them; a refusal comes back in the game's words. */
  act(action: unknown): void { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'act', action })); }
  say(text: string): void { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'say', text: text.slice(0, 280) })); }
  /** The person is here: their own input, throttled by the page. A watcher's only way to keep the season running. */
  attend(): void { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'attend' })); }
  pause(on: boolean): void { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'pause', on })); }
  close(): void { this.closed = true; if (this.beat) { clearInterval(this.beat); this.beat = null; } this.ws?.close(1000, 'left'); }
}
