/**
 * LobbyDO — one per circle ("default" in phase 1). Registry of tables.
 *
 *   SQL `tables(table_id PK, name, config_json, settlement, created_at)`
 *
 * `list` asks every table DO for its live `/summary` (seated, handNo). Simple and always correct;
 * a report/cache path can replace it if a lobby ever holds hundreds of tables.
 */

import { DurableObject } from 'cloudflare:workers';
import type { TableConfig } from '@pokernight/engine';
import { TableSummarySchema, type CreateTableRequest, type TableSummary } from '@pokernight/protocol';
import type { Env } from './env.js';
import type { InitRequest } from './table-do.js';

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
    if (request.method === 'POST' && url.pathname === '/create') {
      const body = (await request.json()) as CreateTableRequest;
      const result = await this.create(body);
      return 'error' in result ? json(result, 400) : json(result, 201);
    }
    return json({ error: 'not found' }, 404);
  }

  /** Creates the table id, initializes the PokerTableDO, then records the table here. */
  private async create(req: CreateTableRequest): Promise<TableSummary | { error: string }> {
    const tableId = crypto.randomUUID();
    const createdAt = Date.now();
    const init: InitRequest = { tableId, name: req.name, config: (req.config ?? {}) as Partial<TableConfig>, settlement: req.settlement, createdAt };
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
          config: JSON.parse(row.config_json) as TableConfig,
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
