/**
 * Operator authority.
 *
 * Two routes in this app reach past what a player may do for themselves: `DELETE
 * /tables/:id/seat/:seat` takes a seat away from somebody who did not ask to leave, and `DELETE
 * /tables/:id` retires a table out of the lobby. Both are real powers, and the only thing standing
 * between them and a kick button is what this file does — so it is deliberately small enough to
 * read in one sitting.
 *
 * There is no admin ROLE here. No player is an operator, no session can become one, and no amount of
 * ordinary sign-in gets you past this gate: the authority is a shared secret (`OPERATOR_TOKEN`) held
 * by whoever runs the deployment, presented in its OWN header (`x-operator-token`) so it can never be
 * confused with — or promoted from — a player's `Authorization: Bearer` session token.
 *
 * Three properties this file is responsible for:
 *   1. A deployment with no `OPERATOR_TOKEN` set clears nothing and retires nothing. Absent is not
 *      "allow"; it is 503.
 *   2. The comparison leaks no timing. Both sides are SHA-256'd first, so the loop always runs over
 *      32 fixed bytes and the length of the presented token tells an attacker nothing either.
 *   3. The token is never logged, never echoed, and never included in any response body.
 *
 * The token ALONE does nothing. Clearing a seat has three further conditions about the seat itself
 * (no live socket, not in a running hand, idle past the threshold); retiring a table has one about
 * the table (nobody seated). All of them live in the table DO, which cannot be reached without
 * passing this one first.
 */

import type { Env } from './env.js';

/** The header an operator presents. Separate from `Authorization` on purpose — see the file header. */
export const OPERATOR_HEADER = 'x-operator-token';

export type OperatorCheck = { ok: true } | { ok: false; status: 401 | 403 | 503; reason: string };

/**
 * Is this request from the operator?
 *
 * The refusals are worded for the person reading a terminal, and each says which of the three ways
 * this can fail actually happened: not configured, not presented, not accepted. None of them repeats
 * any part of the token.
 */
export async function checkOperator(env: Env, request: Request): Promise<OperatorCheck> {
  const configured = (env.OPERATOR_TOKEN ?? '').trim();
  if (!configured) {
    return {
      ok: false,
      status: 503,
      reason:
        'operator: this deployment has no OPERATOR_TOKEN set, so no seat can be cleared and no table ' +
        'retired by an operator. ' +
        'Set it with `wrangler secret put OPERATOR_TOKEN --env <env>`.',
    };
  }
  const presented = (request.headers.get(OPERATOR_HEADER) ?? '').trim();
  if (!presented) {
    return { ok: false, status: 401, reason: `operator: this route needs the operator token in the ${OPERATOR_HEADER} header` };
  }
  return (await constantTimeEqual(presented, configured))
    ? { ok: true }
    : { ok: false, status: 403, reason: 'operator: that operator token was not accepted' };
}

/**
 * Compare two secrets without leaking how far they matched — or how long either one is.
 *
 * Digesting first is what buys the second half: a raw byte loop over two strings has to decide what
 * to do about unequal lengths, and every answer to that question tells the caller the length of the
 * secret. Over two SHA-256 digests the loop is always 32 iterations and always compares every one.
 */
async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [da, db] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  const x = new Uint8Array(da);
  const y = new Uint8Array(db);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= (x[i] as number) ^ (y[i] as number);
  return diff === 0;
}
