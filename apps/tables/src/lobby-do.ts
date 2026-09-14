/**
 * LobbyDO — one per CLUB, plus `default` for pickup tables. Registry of tables.
 *
 *   SQL `tables(table_id PK, name, config_json, settlement, created_at)`
 *
 * One lobby per club is what makes a club's tables private WITHOUT filtering: they are simply not in
 * the public lobby's index, so there is no list to accidentally leak and no predicate to get wrong.
 * `default` is the pickup lobby — public, and what every table lived in before clubs existed.
 *
 * `list` asks every table DO for its live `/summary` (seated, handNo). Simple and always correct;
 * a report/cache path can replace it if a lobby ever holds hundreds of tables.
 */

import { DurableObject } from 'cloudflare:workers';
import { TableSummarySchema, type CreateTableRequest, type MissionRef, type TableSummary } from '@pokernight/protocol';
import type { Env } from './env.js';
import type { InitRequest } from './table-do.js';

/** What the Worker sends to `/create`: the client's request plus the club NAME it resolved, which the
 *  client never supplies (it would be a label the club itself did not agree to). */
type CreateTableBody = CreateTableRequest & { clubName?: string; createdBy?: string; guest?: MissionRef; night?: string };

type TableRow = {
  table_id: string;
  name: string;
  config_json: string;
  settlement: TableSummary['settlement'];
  created_at: number;
}

export class LobbyDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS tables (
          table_id    TEXT PRIMARY KEY,
          name        TEXT NOT NULL,
          config_json TEXT NOT NULL,
          settlement  TEXT NOT NULL,
          created_at  INTEGER NOT NULL
        )`);
    });
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/list') return json(await this.list());
    // Just the ids, with no fan-out to the table DOs. `list` asks every table for its live summary,
    // which is right for a lobby screen and wrong for "which tables might this player be sitting at".
    if (request.method === 'GET' && url.pathname === '/ids') return json({ tableIds: this.tableIds() });
    // OPERATOR: retire one table. The Worker has checked the operator token before we get here.
    if (request.method === 'POST' && url.pathname === '/retire') {
      const { tableId } = (await request.json()) as { tableId?: string };
      const id = (tableId ?? '').trim();
      if (!id) return json({ error: 'tableId is required' }, 400);
      return this.retire(id);
    }
    if (request.method === 'POST' && url.pathname === '/create') {
      const body = (await request.json()) as CreateTableBody;
      const result = await this.create(body);
      return 'error' in result ? json(result, 400) : json(result, 201);
    }
    return json({ error: 'not found' }, 404);
  }

  /** Creates the table id, initializes the PokerTableDO, then records the table here. */
  private async create(req: CreateTableBody): Promise<TableSummary | { error: string }> {
    const tableId = crypto.randomUUID();
    const createdAt = Date.now();
    const init: InitRequest = {
      tableId,
      name: req.name,
      // Carried through unopened. The GAME validates its own config and refuses the table by name.
      config: req.config ?? {},
      settlement: req.settlement,
      createdAt,
      // The club is PINNED on the table, not looked up from it later — same rule as the chip rate
      // and the asset, and for the same reason. A table whose club is renamed still says what it was
      // called on the night it was played, and one whose club is retired still knows what it was.
      ...(req.club ? { club: req.club, ...(req.clubName ? { clubName: req.clubName } : {}) } : {}),
      // THE GUEST, resolved by the Worker against the registry and stamped here like the club.
      ...(req.guest ? { mission: req.guest } : {}),
      ...(req.night ? { night: req.night } : {}),
      // Which game, passed straight through. The table resolves it and refuses by name; the lobby
      // does not keep a list of games, because two lists of games is one list too many.
      ...(req.game ? { game: req.game } : {}),
      // WHO OPENED IT, so they can close it again. Same pinning rule as the club above.
      ...(req.createdBy ? { createdBy: req.createdBy } : {}),
    };
    const stub = this.env.TABLES.get(this.env.TABLES.idFromName(tableId));
    const res = await stub.fetch('https://table/init', { method: 'POST', body: JSON.stringify(init), headers: { 'content-type': 'application/json' } });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({ error: `init failed (${res.status})` }))) as { error?: string };
      return { error: body.error ?? `init failed (${res.status})` };
    }
    const summary = TableSummarySchema.parse(await res.json());
    this.ctx.storage.sql.exec(
      'INSERT INTO tables (table_id, name, config_json, settlement, created_at) VALUES (?, ?, ?, ?, ?)',
      tableId,
      req.name,
      JSON.stringify(summary.config),
      req.settlement,
      createdAt,
    );
    return summary;
  }

  /**
   * Take a table out of the lobby and tell it to delete itself.
   *
   * The table DO decides whether it MAY go — it is the only thing that knows who is sitting at it —
   * so its refusal is passed straight back and the row stays. Only once it has retired itself is the
   * row dropped, so the lobby can never list a table that no longer exists or forget one that does.
   */
  private async retire(tableId: string): Promise<Response> {
    const row = this.ctx.storage.sql.exec<TableRow>('SELECT * FROM tables WHERE table_id = ?', tableId).toArray()[0];
    if (!row) return json({ error: `no table ${tableId} in this lobby` }, 404);
    const stub = this.env.TABLES.get(this.env.TABLES.idFromName(tableId));
    const res = await stub.fetch('https://table/retire', { method: 'POST' });
    // 404 means the DO never initialised (or has already retired). The lobby row is then the only
    // trace of it, and dropping it is exactly right.
    if (!res.ok && res.status !== 404) return json((await res.json()) as Record<string, unknown>, res.status as 409);
    this.ctx.storage.sql.exec('DELETE FROM tables WHERE table_id = ?', tableId);
    return json({ retired: true, tableId, name: row.name });
  }

  private tableIds(): string[] {
    return this.ctx.storage.sql
      .exec<{ table_id: string }>('SELECT table_id FROM tables ORDER BY created_at DESC')
      .toArray()
      .map((r) => r.table_id);
  }

  private async list(): Promise<TableSummary[]> {
    const rows = this.ctx.storage.sql.exec<TableRow>('SELECT * FROM tables ORDER BY created_at DESC').toArray();
    return Promise.all(
      rows.map(async (row) => {
        const fallback: TableSummary = {
          tableId: row.table_id,
          name: row.name,
          config: JSON.parse(row.config_json) as TableSummary['config'],
          settlement: row.settlement,
          seated: 0,
          handNo: 0,
          createdAt: row.created_at,
        };
        try {
          const stub = this.env.TABLES.get(this.env.TABLES.idFromName(row.table_id));
          const res = await stub.fetch('https://table/summary');
          if (!res.ok) return fallback;
          const live = TableSummarySchema.safeParse(await res.json());
          return live.success ? live.data : fallback;
        } catch {
          return fallback;
        }
      }),
    );
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
