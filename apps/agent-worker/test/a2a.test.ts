/**
 * The JSON-RPC round trip a table actually performs: POST `SendMessage` to `/api/a2a` with the parts
 * `encodePokerActParts` produces, and read the reply with `decodePokerActReply`.
 */

import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { isLegal } from '@pokernight/agent-kit';
import type { Card } from '@pokernight/engine';
import {
  A2A_JSONRPC_PATH,
  A2A_SEND_MESSAGE,
  CANASTA_ACT_SKILL,
  POKER_ACT_SKILL,
  agentNameToHost,
  decodePokerActReply,
  encodePokerActParts,
  type PokerActInput,
} from '@pokernight/protocol';
import { PERSONAS, gameOf } from '../src/personas.js';
import { legalFor, makeInput, makeView } from './fixtures.js';

const RPC = `http://localhost:8788${A2A_JSONRPC_PATH}`;

/** A canasta spot: seat 0 on turn, not yet drawn, an eight on top of a three-card pile. */
function canastaRpc(id: string | number = 'canasta-1'): unknown {
  const view = {
    roundNo: 1,
    seedCommit: 'x',
    seedReveal: null,
    dealer: 3,
    toAct: 0,
    phase: 'draw',
    actionDeadline: null,
    stock: 70,
    pileTop: '8C',
    pileSize: 3,
    frozen: false,
    target: 5000,
    scores: { 0: 0, 1: 0 },
    winner: null,
    melds: { 0: [], 1: [] },
    redThrees: { 0: 0, 1: 0 },
    seats: [0, 1, 2, 3].map((seat) => ({ seat, playerId: `p${seat}`, status: 'active', cards: 11, team: seat % 2 })),
    hand: ['8S', '8D', 'KC', 'KH', 'KS', '5C', '5D', '9H', 'QS', 'W*', '2C'],
    result: null,
  };
  const legal = {
    phase: 'draw',
    canDraw: true,
    canTakePile: true,
    takePileReason: null,
    pileTop: '8C',
    pileSize: 3,
    minimumMeld: 50,
    discardable: [],
    canGoOut: false,
  };
  return {
    jsonrpc: '2.0',
    id,
    method: A2A_SEND_MESSAGE,
    params: {
      message: {
        messageId: 'm-canasta',
        role: 'user',
        parts: [{ kind: 'data', data: { skill: CANASTA_ACT_SKILL, input: { skill: CANASTA_ACT_SKILL, tableId: 't', handNo: 1, seat: 0, view, legal, deadlineMs: 5000 } } }],
      },
    },
  };
}

/** A concrete spot: seat 3 on the flop with top pair, 8 to call into a pot of 24. */
function flopSpot(): PokerActInput {
  const view = makeView({
    seats: [
      { seat: 1, stack: 96, streetBet: 8, totalBet: 14 },
      { seat: 3, stack: 180, streetBet: 0, totalBet: 6, hole: ['As', 'Kd'] as Card[] },
      { seat: 5, stack: 40, streetBet: 0, totalBet: 6 },
    ],
    button: 5,
    viewer: 3,
    street: 'flop',
    board: ['7h', '2c', 'Ks'] as Card[],
    potAmount: 18,
    currentBet: 8,
    minRaise: 8,
    actions: [
      { seat: 1, street: 'preflop', action: { type: 'raise', amount: 6 }, amount: 6 },
      { seat: 3, street: 'preflop', action: { type: 'call' }, amount: 6 },
      { seat: 5, street: 'preflop', action: { type: 'call' }, amount: 6 },
      { seat: 1, street: 'flop', action: { type: 'bet', amount: 8 }, amount: 8 },
    ],
  });
  return makeInput(view, legalFor(view));
}

async function sendMessage(body: unknown, url = RPC, headers: Record<string, string> = {}): Promise<{ status: number; json: any }> {
  const res = await SELF.fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

function rpc(input: PokerActInput, id: string | number = 1): unknown {
  return {
    jsonrpc: '2.0',
    id,
    method: A2A_SEND_MESSAGE,
    params: { message: { messageId: crypto.randomUUID(), role: 'user', parts: encodePokerActParts(input) } },
  };
}

describe('SendMessage / poker.act', () => {
  it('returns a legal action in the same response, as a message with no task', async () => {
    const input = flopSpot();
    const { status, json } = await sendMessage(rpc(input, 'hand-7'));

    expect(status).toBe(200);
    expect(json.jsonrpc).toBe('2.0');
    expect(json.id).toBe('hand-7');
    expect(json.error).toBeUndefined();
    // A synchronous reply: `{ result: { message } }`, no task to poll.
    expect(json.result.task).toBeUndefined();
    expect(json.result.message.role).toBe('ROLE_AGENT');

    const parts = json.result.message.parts;
    expect(parts).toHaveLength(1);
    expect(parts[0].kind).toBe('data');

    const decoded = decodePokerActReply(parts);
    expect('error' in decoded).toBe(false);
    if ('error' in decoded) return;
    expect(isLegal(decoded.action, input.legal)).toBe(true);
    expect(typeof decoded.note).toBe('string');
  });

  it('answers on every POKER persona, on its own host and through ?agent=', async () => {
    const input = flopSpot();
    for (const p of PERSONAS.filter((x) => gameOf(x) === 'poker')) {
      for (const url of [
        `https://${agentNameToHost(p.agentName, 'faithnet.ai')}${A2A_JSONRPC_PATH}`,
        `${RPC}?agent=${p.agentName}`,
        `http://localhost:8788/${p.agentName}${A2A_JSONRPC_PATH}`,
      ]) {
        const { status, json } = await sendMessage(rpc(input), url);
        expect(status, `${p.agentName} @ ${url}`).toBe(200);
        const decoded = decodePokerActReply(json.result.message.parts);
        expect('error' in decoded, `${p.agentName} @ ${url}: ${JSON.stringify(decoded)}`).toBe(false);
        if ('error' in decoded) continue;
        // The claude personas have no API key in tests and fall back to the rules baseline.
        expect(isLegal(decoded.action, input.legal)).toBe(true);
      }
    }
  });

  /**
   * The two games do not answer each other's turns.
   *
   * This is the safety property behind giving canasta its own skill id at all. A canasta persona
   * handed a poker spot must not guess — it holds no cards it understands, and a guessed move in
   * somebody's game is worse than a refusal the table can log and default past.
   */
  it('refuses a poker turn at a CANASTA persona, and a canasta turn at a poker one', async () => {
    const canastaPersonas = PERSONAS.filter((p) => gameOf(p) === 'canasta');
    expect(canastaPersonas.length).toBeGreaterThan(0);

    for (const p of canastaPersonas) {
      const { json } = await sendMessage(rpc(flopSpot()), `${RPC}?agent=${p.agentName}`);
      const decoded = decodePokerActReply(json.result?.message?.parts ?? []);
      expect('error' in decoded, `${p.agentName} answered a poker turn`).toBe(true);
    }

    for (const p of PERSONAS.filter((x) => gameOf(x) === 'poker')) {
      const { json } = await sendMessage(canastaRpc(), `${RPC}?agent=${p.agentName}`);
      const decoded = decodePokerActReply(json.result?.message?.parts ?? []);
      expect('error' in decoded, `${p.agentName} answered a canasta turn`).toBe(true);
    }
  });

  it('plays a canasta turn at a canasta persona, and the move is one canasta has', async () => {
    for (const p of PERSONAS.filter((x) => gameOf(x) === 'canasta')) {
      const { status, json } = await sendMessage(canastaRpc(), `${RPC}?agent=${p.agentName}`);
      expect(status, p.agentName).toBe(200);
      const parts = json.result?.message?.parts ?? [];
      const action = (parts[0]?.data ?? {}).action as { type?: string } | undefined;
      // The seat has not drawn yet, so the only two moves in the game are draw and take-pile.
      expect(['draw', 'take-pile'], `${p.agentName} played ${JSON.stringify(action)}`).toContain(action?.type);
    }
  });

  it('rejects a malformed poker.act request with a failed task and a message that says why', async () => {
    const cases: Array<{ name: string; parts: unknown[]; expect: RegExp }> = [
      { name: 'no parts', parts: [], expect: /no parts/i },
      { name: 'no data part', parts: [{ kind: 'text', text: 'act please' }], expect: /no data part/i },
      { name: 'wrong skill', parts: [{ kind: 'data', data: { skill: 'chess.move', input: {} } }], expect: /unsupported skill/i },
      {
        name: 'no view',
        parts: [{ kind: 'data', data: { skill: POKER_ACT_SKILL, input: { tableId: 't', handNo: 1, seat: 0, deadlineMs: 5000 } } }],
        expect: /malformed/i,
      },
      {
        name: 'no legal',
        parts: [
          {
            kind: 'data',
            data: { skill: POKER_ACT_SKILL, input: { tableId: 't', handNo: 1, seat: 0, view: flopSpot().view, deadlineMs: 5000 } },
          },
        ],
        expect: /legal/i,
      },
    ];

    for (const c of cases) {
      const { status, json } = await sendMessage({
        jsonrpc: '2.0',
        id: c.name,
        method: A2A_SEND_MESSAGE,
        params: { message: { messageId: crypto.randomUUID(), role: 'user', parts: c.parts } },
      });
      expect(status, c.name).toBe(200);
      // A rejected request is a FAILED task, never a guessed action: the caller must learn it sent junk.
      expect(json.result.message, c.name).toBeUndefined();
      expect(json.result.task.status.state, c.name).toBe('TASK_STATE_FAILED');
      const text = JSON.stringify(json.result.task.status.message.parts);
      expect(text, `${c.name}: ${text}`).toMatch(c.expect);
    }
  });

  it('refuses a non-JSON-RPC request at the door', async () => {
    const notJsonRpc = await sendMessage({ hello: 'world' });
    expect(notJsonRpc.status).toBe(400);
    expect(notJsonRpc.json.error.code).toBe(-32600);

    const unknownMethod = await sendMessage({ jsonrpc: '2.0', id: 1, method: 'DoTheThing', params: {} });
    expect(unknownMethod.json.error.code).toBe(-32601);

    const wrongType = await SELF.fetch(RPC, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' });
    expect(wrongType.status).toBe(415);

    const wrongVerb = await SELF.fetch(RPC, { method: 'GET' });
    expect(wrongVerb.status).toBe(405);
  });
});
