import { SELF } from 'cloudflare:test';
import { createTable } from '@pokernight/engine';
import type { ServerMessage, TableSummary } from '@pokernight/protocol';

/**
 * The engine bodies are being implemented separately and currently throw "not implemented".
 * Tests that need a real TableState skip until it lands (see `test.skipIf(!engineReady)`).
 */
export const engineReady: boolean = (() => {
  try {
    createTable({});
    return true;
  } catch {
    return false;
  }
})();

export async function createTableViaHttp(name = 'test table', config: Record<string, number> = {}, circle?: string): Promise<TableSummary> {
  const res = await SELF.fetch('http://tables.test/tables', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, config, circle }),
  });
  if (res.status !== 201) throw new Error(`create table failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as TableSummary;
}

export async function devSession(name: string): Promise<{ token: string; playerId: string; name: string }> {
  const res = await SELF.fetch('http://tables.test/dev/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (res.status !== 200) throw new Error(`dev session failed: ${res.status}`);
  return (await res.json()) as { token: string; playerId: string; name: string };
}

/**
 * A connected client socket. Every message is appended to `log`; `next`/`waitFor` read from a cursor
 * without consuming, so concurrent waiters (e.g. `waitForAny` over two clients) never steal messages.
 */
export class TestClient {
  readonly log: ServerMessage[] = [];
  private cursor = 0;
  private listeners = new Set<(m: ServerMessage) => void>();

  private constructor(readonly ws: WebSocket) {
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(String(ev.data)) as ServerMessage;
      this.log.push(msg);
      for (const l of this.listeners) l(msg);
    });
  }

  static async connect(tableId: string, token?: string): Promise<TestClient> {
    const url = `http://tables.test/tables/${tableId}/ws${token ? `?token=${encodeURIComponent(token)}` : ''}`;
    const res = await SELF.fetch(url, { headers: { Upgrade: 'websocket' } });
    if (res.status !== 101 || !res.webSocket) throw new Error(`upgrade failed: ${res.status} ${await res.text()}`);
    const ws = res.webSocket;
    ws.accept();
    return new TestClient(ws);
  }

  send(cmd: unknown): void {
    this.ws.send(JSON.stringify(cmd));
  }

  /** The next unread message. */
  next(timeoutMs = 5000): Promise<ServerMessage> {
    return this.waitFor(() => true, timeoutMs);
  }

  /** First unread message matching `pred`; advances the cursor past it. */
  async waitFor(pred: (m: ServerMessage) => boolean, timeoutMs = 5000): Promise<ServerMessage> {
    const found = await waitForAny([this], pred, timeoutMs);
    return found.message;
  }

  /** @internal */
  scanUnread(pred: (m: ServerMessage) => boolean): number {
    for (let i = this.cursor; i < this.log.length; i++) if (pred(this.log[i] as ServerMessage)) return i;
    return -1;
  }

  /** @internal */
  consumeThrough(index: number): void {
    this.cursor = Math.max(this.cursor, index + 1);
  }

  /** @internal */
  subscribe(l: (m: ServerMessage) => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  close(): void {
    this.ws.close(1000, 'done');
  }
}

/** Resolves with the first matching unread message across `clients`; all listeners are removed on settle. */
export function waitForAny(clients: TestClient[], pred: (m: ServerMessage) => boolean, timeoutMs = 5000): Promise<{ client: TestClient; message: ServerMessage }> {
  for (const client of clients) {
    const i = client.scanUnread(pred);
    if (i >= 0) {
      client.consumeThrough(i);
      return Promise.resolve({ client, message: client.log[i] as ServerMessage });
    }
  }
  return new Promise((resolve, reject) => {
    const unsubs: Array<() => void> = [];
    const done = () => {
      clearTimeout(timer);
      for (const u of unsubs) u();
    };
    const timer = setTimeout(() => {
      done();
      reject(new Error(`timed out waiting for a server message; last: ${JSON.stringify(clients.map((c) => c.log.at(-1)?.type ?? null))}`));
    }, timeoutMs);
    for (const client of clients) {
      unsubs.push(
        client.subscribe((m) => {
          if (!pred(m)) return;
          const i = client.log.lastIndexOf(m);
          client.consumeThrough(i);
          done();
          resolve({ client, message: m });
        }),
      );
    }
  });
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
