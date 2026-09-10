import { SELF } from 'cloudflare:test';
import { createTable } from '@pokernight/engine';
import type { ClubSummary, PokerServerMessage, TableSummary } from '@pokernight/protocol';

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

export interface CreateTableOpts {
  /** Whose session opens it. Minted here if absent — opening a table now requires one. */
  token?: string;
  /** Open it FOR a club. The token must belong to one of that club's hosts. */
  club?: string;
  settlement?: string;
}

/**
 * Open a table over HTTP.
 *
 * A session is now required (see `POST /tables`), so one is minted when the caller does not care
 * whose it is. Tests that want a lobby of their own pass `club`, which is both the isolation they
 * were using a random `circle` for before AND the real gated path.
 */
export async function createTableViaHttp(
  name = 'test table',
  config: Record<string, number> = {},
  opts: CreateTableOpts = {},
): Promise<TableSummary> {
  const token = opts.token ?? (await devSession(`opener-${crypto.randomUUID().slice(0, 8)}`)).token;
  const res = await SELF.fetch('http://tables.test/tables', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ name, config, ...(opts.club ? { club: opts.club } : {}), ...(opts.settlement ? { settlement: opts.settlement } : {}) }),
  });
  if (res.status !== 201) throw new Error(`create table failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as TableSummary;
}

/** Start a club. The signed-in player becomes its first host, and is on its roster from the start. */
export async function createClubViaHttp(token: string, name = 'test club'): Promise<ClubSummary> {
  const res = await SELF.fetch('http://tables.test/clubs', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ name }),
  });
  if (res.status !== 201) throw new Error(`create club failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as ClubSummary;
}

/**
 * A club of one, and the host who can open tables in it.
 *
 * This is the isolation a test wants when all it needs is a lobby nobody else is writing to — the
 * job a random `circle` string used to do, now done by the real gated path so the isolation and the
 * feature are tested by the same call. Returns the shape `createTableViaHttp` takes, so it reads as
 * `createTableViaHttp('name', {}, await soloClub())`.
 */
export async function soloClub(name = 'solo'): Promise<{ club: string; token: string }> {
  const host = await devSession(`host-${crypto.randomUUID().slice(0, 8)}`);
  const club = await createClubViaHttp(host.token, name);
  return { club: club.clubId, token: host.token };
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
  /**
   * THESE TESTS ARE POKER'S. The protocol carries a game's view, legal actions and events opaquely,
   * so a poker client narrows them at its own socket boundary — here, once, where the JSON arrives —
   * rather than casting at every assertion. `PokerTableDO` widens at the matching seam.
   */
  readonly log: PokerServerMessage[] = [];
  private cursor = 0;
  private listeners = new Set<(m: PokerServerMessage) => void>();

  private constructor(readonly ws: WebSocket) {
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(String(ev.data)) as PokerServerMessage;
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
  next(timeoutMs = 5000): Promise<PokerServerMessage> {
    return this.waitFor(() => true, timeoutMs);
  }

  /** First unread message matching `pred`; advances the cursor past it. */
  async waitFor(pred: (m: PokerServerMessage) => boolean, timeoutMs = 5000): Promise<PokerServerMessage> {
    const found = await waitForAny([this], pred, timeoutMs);
    return found.message;
  }

  /** @internal */
  scanUnread(pred: (m: PokerServerMessage) => boolean): number {
    for (let i = this.cursor; i < this.log.length; i++) if (pred(this.log[i] as PokerServerMessage)) return i;
    return -1;
  }

  /** @internal */
  consumeThrough(index: number): void {
    this.cursor = Math.max(this.cursor, index + 1);
  }

  /** @internal */
  subscribe(l: (m: PokerServerMessage) => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  close(): void {
    this.ws.close(1000, 'done');
  }
}

/** Resolves with the first matching unread message across `clients`; all listeners are removed on settle. */
export function waitForAny(clients: TestClient[], pred: (m: PokerServerMessage) => boolean, timeoutMs = 5000): Promise<{ client: TestClient; message: PokerServerMessage }> {
  for (const client of clients) {
    const i = client.scanUnread(pred);
    if (i >= 0) {
      client.consumeThrough(i);
      return Promise.resolve({ client, message: client.log[i] as PokerServerMessage });
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

/**
 * Wait for a condition to become true, rather than for a length of time.
 *
 * `await sleep(1500); expect(dealt)` is a test that passes on a quiet machine and fails under load —
 * which is exactly what it did: the practice-reset test went red only when the whole suite ran, and
 * green every time it was run on its own, so it read as flakiness rather than as a bad wait. A fixed
 * sleep is either too short (a false failure) or too long (a slow suite), and there is no value that
 * is neither on every machine.
 *
 * The deadline is the backstop, not the mechanism. `what` names the condition so a real timeout says
 * which one gave up instead of "expected 0 to be greater than 0".
 */
export async function until<T>(what: string, read: () => Promise<T>, ok: (v: T) => boolean, timeoutMs = 15_000): Promise<T> {
  const stopAt = Date.now() + timeoutMs;
  let last: T = await read();
  while (!ok(last)) {
    if (Date.now() > stopAt) throw new Error(`timed out waiting for ${what}; last saw ${JSON.stringify(last)}`);
    await sleep(100);
    last = await read();
  }
  return last;
}
