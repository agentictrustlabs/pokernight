/**
 * The treasury routes: which Smart Agent funds a player's night, what is in it, and what the card
 * room has been authorised to take out of it.
 *
 * A player signs in as an IDENTITY. That says who they are, not what they can spend. What they spend
 * from is a TREASURY — a `treasury`-kind Smart Agent chartered under their person agent at their own
 * Home (DESIGN.md §5.0). An earlier build offered the person agent itself as a candidate; that was
 * wrong, and the correction is the shape of this file: candidates come from the Home's own answer to
 * "what agents does this person have", filtered to `person-treasury`, and from nowhere else. A player
 * with none is not offered a substitute — they are offered a way to make one.
 *
 *   GET  /treasury                     the chosen treasury, its balance, the candidates, the mandate
 *   POST /treasury/quick-start         the whole thing in one call: a treasury, a stake, the authority
 *   POST /treasury/select {address}    choose one — refused unless the Home says it is theirs
 *   POST /treasury/create {label?}     make one (server-side for a demo persona; a hand-off otherwise)
 *   POST /treasury/fund {amount}       mint Sheqels, an open-mint test asset only
 *   POST /treasury/mandate {...}       sign, or record, the buy-in mandate for this session
 *
 * Every one requires a session. Every refusal names the exact thing that is missing: a money route
 * that answers "failed" is a money route nobody can debug, and a money route that answers "choose
 * something else" without saying what is worse.
 */

import { z } from 'zod';
import type { Context } from 'hono';
import {
  TreasuryError,
  asBuyInMandate,
  buyInMandateDigest,
  buyInMandateTerms,
  checkBuyInMandate,
  describeBuyInMandate,
  formatMoney,
  formatAmount,
  parseAmount,
  unsignedBuyInMandate,
  type Address,
  type BuyInMandateTerms,
} from '@pokernight/treasury';
import { patchSessionRecord, readSessionRecord, setSessionTreasury, type SessionClaims } from './auth.js';
import type { Env } from './env.js';
import {
  HomeApiError,
  checkTreasuryLabel,
  demoPersonaFor,
  demoSignIn,
  listRelatedAgents,
  managedAgentsUrl,
  treasuryHandoffUrl,
  personTreasuries,
  personaSignDigest,
  type DemoPersona,
} from './home-api.js';
import {
  OPEN_DELEGATE,
  TreasuryConfigError,
  chainId,
  chipValue,
  custodialTreasury,
  defaultAssetSymbol,
  delegationManager,
  deployments,
  homeApi,
  houseDelegate,
  houseTreasury,
  isAddress,
  isTestAsset,
  mandateEnforcers,
  mandatePolicy,
  readOnlyTreasury,
  treasuryNaming,
} from './treasury.js';
import { BUY_IN_TEMPLATE } from './home.js';
import { TreasuryCreationError, createTreasuryForPersona } from './treasury-create.js';
import type { TreasuryClient } from '@pokernight/treasury';

export const SelectTreasurySchema = z.object({ address: z.string().trim().min(1).max(64) });
/** A decimal Sheqel amount, e.g. "100" or "12.50". Capped so a demo faucet stays a demo faucet. */
export const FundTreasurySchema = z.object({ amount: z.string().trim().min(1).max(32).optional() });
/** Nameless is the default; a label is a request for `<label>.treasury`. */
export const CreateTreasurySchema = z.object({ label: z.string().trim().max(32).optional() });
/**
 * The mandate route takes either nothing (a demo persona, whose Home signs server-side) or a
 * delegation the player's own Home issued to them in the browser.
 */
export const MandateSchema = z.object({ delegation: z.unknown().optional() });

/** Biggest single faucet grant. Test money, but an unbounded mint button is still a bad button. */
export const MAX_FUND = 100_000_000_000n; // 100_000 Sheqels in base units

/** One treasury the player could choose. Every candidate is a `person-treasury` at their own Home. */
export interface TreasuryCandidate {
  address: string;
  /** `<label>.treasury`, or '' — a treasury is allowed to be nameless. */
  name: string;
  /** What the panel calls it: the name if it has one, else a short address. */
  label: string;
  balance: string | null;
  balanceText: string | null;
  /** Present when the balance could not be read, saying why. */
  error?: string;
}

/** How this player could come to have a treasury, and who does the making. */
export interface TreasuryCreationOffer {
  /** `server` — the Home lends this identity and holds its key, so the card room can ask for one.
   *  `home-portal` — a real person: their Home creates and custodies it, and we hand them over. */
  mode: 'server' | 'home-portal';
  /** Where to send a real player. Their Home, never ours. */
  portalUrl: string | null;
  /** Whether `<label>.treasury` can be claimed here at all. */
  canName: boolean;
}

/** What the player has authorised, said in the numbers a consent screen shows. */
export interface MandateView {
  present: boolean;
  /** The treasury it was signed by. Null when there is none. */
  treasury: string | null;
  /** Base-unit strings; the client formats them. */
  maxPerBuyIn: string;
  sessionTotal: string;
  maxBuyIns: number;
  /** Unix SECONDS. */
  validUntil: number;
  /** Where buy-ins go, and in what. */
  payee: string;
  asset: string;
  /** Null when the mandate covers this session; a sentence when it does not (and why). */
  problem: string | null;
  /** Why a mandate cannot be offered at all right now. Null when it can. */
  unavailable: string | null;
}

export interface TreasuryView {
  chainId: number;
  asset: string;
  /** What that asset calls itself — `SHQ`, the card room's own and only coin. Stated by the server
   *  so the client never has to hold a ticker of its own next to a real balance. */
  assetSymbol: string;
  /** Asset base units per chip, as a decimal string (bigints do not survive JSON). */
  chipValue: string;
  /** The player's PERSON agent — their identity. Shown so they can see it is not on the list. */
  person: string | null;
  personName: string | null;
  /** The treasury this session funds play from, or null when the player has not chosen yet. */
  chosen: string | null;
  chosenName: string | null;
  balance: string | null;
  balanceText: string | null;
  candidates: TreasuryCandidate[];
  /** Why the candidate list could not be read from the Home, when it could not. */
  discoveryError: string | null;
  create: TreasuryCreationOffer;
  mandate: MandateView;
  /** Whether `POST /treasury/fund` will work here, and if not, why not. */
  faucet: { available: boolean; asset: string | null; reason: string | null };
  /** Something the card room did on the player's behalf that they should know about. */
  notice: string | null;
  /** Why the money layer is unavailable, when it is. Null when everything needed is configured. */
  unavailable: string | null;
}

type Ctx = Context<{ Bindings: Env }>;

function configFailure(e: unknown): string {
  if (e instanceof TreasuryConfigError) return `the card room is not configured to settle on chain: ${e.message}`;
  return `the card room could not reach the money layer: ${e instanceof Error ? e.message : String(e)}`;
}

function short(address: string): string {
  return address.length > 14 ? `${address.slice(0, 10)}…${address.slice(-6)}` : address;
}

/* ------------------------------------------------------------------ discovery */

interface Discovered {
  treasuries: TreasuryCandidate[];
  error: string | null;
}

/**
 * The player's treasuries, from their own Home.
 *
 * This is the whole correction. The Home is asked what agents belong to this person and the answer
 * is filtered to `person-treasury`; the person agent is not one and so cannot appear. A card room
 * that guessed at a candidate would be guessing about someone else's money.
 */
async function discover(env: Env, idToken: string | undefined): Promise<Discovered> {
  if (!idToken) {
    return {
      treasuries: [],
      error: 'this session was not established through a Home, so there is no one to ask which treasuries you have',
    };
  }
  let config;
  try {
    config = homeApi(env);
  } catch (e) {
    return { treasuries: [], error: configFailure(e) };
  }
  try {
    const agents = await listRelatedAgents(config, idToken);
    return {
      treasuries: personTreasuries(agents).map((t) => ({
        address: t.orgAgent,
        name: t.orgName,
        label: t.orgName || short(t.orgAgent),
        balance: null,
        balanceText: null,
      })),
      error: null,
    };
  } catch (e) {
    const reason = e instanceof HomeApiError ? e.reason : e instanceof Error ? e.message : String(e);
    return { treasuries: [], error: `your Home could not be asked which treasuries you have: ${reason}` };
  }
}

/** The demo persona behind this session, or null for a real person. Never throws. */
async function personaFor(env: Env, address: string | undefined): Promise<DemoPersona | null> {
  if (!address) return null;
  try {
    return await demoPersonaFor(homeApi(env), address);
  } catch {
    return null;
  }
}

/* --------------------------------------------------------------- the mandate */

interface MandateContext {
  terms: BuyInMandateTerms;
  chainId: number;
  delegationManager: Address;
  houseDelegate: Address;
}

/**
 * Everything needed to ASK for a mandate, or the named reason it cannot be asked for. The house
 * delegate, the enforcers and the redemption point are all deployment configuration, so a gap in any
 * of them is an operator problem stated as one — never a player being told to try again.
 */
function mandateContext(env: Env, now: number): MandateContext | { error: string } {
  try {
    const delegate = houseDelegate(env);
    if (!delegate) {
      throw new TreasuryConfigError('HOUSE_DELEGATE', 'HOUSE_DELEGATE is not set to an address, so there is no house agent to authorise');
    }
    return {
      terms: buyInMandateTerms({
        payee: houseTreasury(env),
        asset: deployments(env).asset,
        enforcers: mandateEnforcers(env),
        chipValue: chipValue(env),
        policy: mandatePolicy(env),
        now,
      }),
      chainId: chainId(env),
      delegationManager: delegationManager(env),
      houseDelegate: delegate,
    };
  } catch (e) {
    return { error: configFailure(e) };
  }
}

/**
 * What to CALL this deployment's money in a sentence a player reads: `SHQ`.
 *
 * There is one currency. A deployment that states no symbol names none, and a sentence about money
 * with no ticker in it is better than one carrying a ticker nobody configured.
 */
export function moneyName(env: Env): string {
  return defaultAssetSymbol(env) ?? '';
}

/**
 * What a buy-in authorisation would cost the player, in the numbers a consent screen must show —
 * or `null` where this deployment cannot ask for one at all.
 *
 * It exists for the SIGN-IN screen. Signing in now asks the player's Home for the payment template
 * as well as the session (one ceremony instead of two), which means the act of signing in is also
 * the act of approving a spending ceiling. A player must be told that BEFORE they go, in the same
 * numbers their Home will show them when they get there — so the screen reads these, and if they
 * are not available it does not claim a ceiling and does not ask for one.
 *
 * Everything here is public: the same caps the Home has registered for this client and the same
 * ones the on-chain PaymentEnforcer holds.
 */
export function buyInOffer(env: Env): {
  template: string;
  /** Base-unit strings; the client formats them. */
  maxPerBuyIn: string;
  sessionTotal: string;
  maxBuyIns: number;
  maxBuyInChips: number;
  validSeconds: number;
  /** What the money is called (`SHQ`). */
  symbol: string;
} | null {
  const ctx = mandateContext(env, Date.now());
  if ('error' in ctx) return null;
  const consent = describeBuyInMandate(ctx.terms);
  const policy = mandatePolicy(env);
  return {
    template: BUY_IN_TEMPLATE,
    maxPerBuyIn: consent.maxAmountPerCharge.toString(),
    sessionTotal: consent.sessionBudget.toString(),
    maxBuyIns: consent.maxRedemptionsPerWindow,
    maxBuyInChips: policy.maxBuyInChips,
    validSeconds: policy.windowSeconds,
    symbol: moneyName(env),
  };
}

/** The mandate half of `GET /treasury`: what is authorised, and whether it still covers this session. */
function mandateView(
  env: Env,
  stored: unknown,
  boundTo: string | undefined,
  chosen: string | null,
  now: number,
): MandateView {
  const ctx = mandateContext(env, now);
  const empty = (unavailable: string | null): MandateView => ({
    present: false,
    treasury: null,
    maxPerBuyIn: '0',
    sessionTotal: '0',
    maxBuyIns: 0,
    validUntil: 0,
    payee: '',
    asset: '',
    problem: null,
    unavailable,
  });
  if ('error' in ctx) return empty(ctx.error);

  const consent = describeBuyInMandate(ctx.terms);
  const offered: MandateView = {
    present: false,
    treasury: null,
    maxPerBuyIn: consent.maxAmountPerCharge.toString(),
    sessionTotal: consent.sessionBudget.toString(),
    maxBuyIns: consent.maxRedemptionsPerWindow,
    validUntil: consent.expiresAt,
    payee: consent.recipient,
    asset: consent.asset,
    problem: null,
    unavailable: null,
  };
  if (!stored || !chosen) return offered;
  if (boundTo && boundTo.toLowerCase() !== chosen.toLowerCase()) {
    return {
      ...offered,
      problem: `the mandate you signed covers ${short(boundTo)}, but this session now spends from ${short(chosen)} — sign again for the treasury you are using`,
    };
  }
  const problem = checkBuyInMandate(stored, {
    treasury: chosen as Address,
    houseDelegate: ctx.houseDelegate,
    payee: ctx.terms.payee,
    asset: ctx.terms.asset,
    paymentEnforcer: ctx.terms.enforcers.payment,
    openDelegate: OPEN_DELEGATE,
    now,
  });
  const mandate = asBuyInMandate(stored);
  return { ...offered, present: problem === null, treasury: mandate?.delegator ?? boundTo ?? null, problem };
}

/**
 * Accept — or discard — a mandate the player's Home minted during sign-in.
 *
 * Signing in asks the Home for the payment template, so the session and the spending authority
 * arrive together and the player is asked once instead of twice. What arrives cannot be accepted at
 * that instant: a mandate authorises ONE account to be spent from, and at sign-in this card room has
 * not yet asked the Home which accounts are the player's. So it is parked (`pendingMandate`) and
 * dealt with here, where the Home's own list of the player's treasuries is in hand.
 *
 * The rules, in order:
 *   • the mandate's delegator must be a treasury the player's HOME lists as theirs — otherwise this
 *     is an authority over an account nobody has vouched for, and it is discarded;
 *   • if the session has not chosen a treasury, the one the mandate names becomes the choice: the
 *     player just authorised spending from it, at their own Home, which is a choice;
 *   • if the session HAS chosen a different treasury, nothing happens — the player's later choice
 *     wins over an earlier ceremony, and they can authorise the chosen one the ordinary way;
 *   • the mandate is then checked exactly as a hand-delivered one is, and kept only if it passes.
 *
 * Either way the pending field is cleared, so this decision is made once. Returns what changed, or
 * null when nothing did.
 */
async function promotePendingMandate(
  env: Env,
  playerId: string,
  record: { pendingMandate?: unknown; treasuryName?: string } | null,
  found: { treasuries: TreasuryCandidate[]; error: string | null },
  chosen: string | null,
  now: number,
): Promise<{ treasury: string; treasuryName: string | null; mandate: unknown } | null> {
  const pending = record?.pendingMandate;
  if (!pending) return null;
  // The Home could not be asked. Leave the mandate parked rather than discarding an authority the
  // player really did sign because a lookup was down; the next load asks again.
  if (found.error) return null;

  const delegator = asBuyInMandate(pending)?.delegator?.toLowerCase() ?? '';
  const match = isAddress(delegator) ? found.treasuries.find((t) => t.address === delegator) : undefined;
  if (!match) {
    await patchSessionRecord(env, playerId, { pendingMandate: null });
    return null;
  }
  if (chosen && chosen !== delegator) return null;

  const ctx = mandateContext(env, now);
  if ('error' in ctx) return null;
  if (checkBuyInMandate(pending, mandateExpectation(ctx, delegator, now)) !== null) {
    await patchSessionRecord(env, playerId, { pendingMandate: null });
    return null;
  }
  const ok = await patchSessionRecord(env, playerId, {
    treasury: delegator,
    treasuryName: match.name,
    buyInMandate: pending,
    mandateTreasury: delegator,
    mandateAsset: ctx.terms.asset,
    mandateValidUntil: ctx.terms.validUntil,
    pendingMandate: null,
  });
  if (!ok) return null;
  return { treasury: delegator, treasuryName: match.name || null, mandate: pending };
}

/* ------------------------------------------------------------------ GET /treasury */

/**
 * `GET /treasury` — what funds this player, what is in it, and what they have authorised.
 *
 * It also REPAIRS one thing on the way past: a treasury chosen by an earlier build could be the
 * player's person agent, which is not a treasury and will never appear in the candidate list again.
 * Rather than leave a selection pointing at an identity, this clears it and says so.
 */
export async function getTreasury(c: Ctx, session: SessionClaims): Promise<Response> {
  const now = Date.now();
  const money = moneyName(c.env);
  const record = await readSessionRecord(c.env, session.playerId);
  const person = record?.address && isAddress(record.address) ? record.address.toLowerCase() : null;
  let chosen = record?.treasury && isAddress(record.treasury) ? record.treasury.toLowerCase() : null;

  const persona = await personaFor(c.env, person ?? undefined);
  let create: TreasuryCreationOffer;
  try {
    create = {
      mode: persona ? 'server' : 'home-portal',
      portalUrl: persona ? null : treasuryHandoffUrl(homeApi(c.env)),
      canName: treasuryNaming(c.env) !== null,
    };
  } catch {
    create = { mode: 'home-portal', portalUrl: null, canName: false };
  }

  // Discovery is a question for the person's Home, not for the chain, so it is asked even on a
  // deployment that cannot settle: "which treasuries do you have" has an answer either way.
  const found = await discover(c.env, record?.idToken);

  let base: TreasuryView;
  try {
    base = {
      chainId: chainId(c.env),
      asset: deployments(c.env).asset,
      assetSymbol: money,
      chipValue: chipValue(c.env).toString(),
      person,
      personName: record?.agentName ?? null,
      chosen,
      chosenName: record?.treasuryName ?? null,
      balance: null,
      balanceText: null,
      candidates: [],
      discoveryError: null,
      create,
      mandate: mandateView(c.env, record?.buyInMandate, record?.mandateTreasury, chosen, now),
      faucet: { available: false, asset: null, reason: null },
      notice: null,
      unavailable: null,
    };
  } catch (e) {
    return c.json(
      {
        chainId: Number(c.env.CHAIN_ID) || 0,
        asset: '',
        assetSymbol: money,
        chipValue: '0',
        person,
        personName: record?.agentName ?? null,
        chosen,
        chosenName: record?.treasuryName ?? null,
        balance: null,
        balanceText: null,
        candidates: found.treasuries,
        discoveryError: found.error,
        create,
        mandate: mandateView(c.env, record?.buyInMandate, record?.mandateTreasury, chosen, now),
        faucet: { available: false, asset: null, reason: null },
        notice: null,
        unavailable: configFailure(e),
      } satisfies TreasuryView,
      200,
    );
  }

  base.candidates = found.treasuries;
  base.discoveryError = found.error;

  // A selection that is not on the list is not a selection any more. The commonest cause is the one
  // this file exists to correct — a person agent chosen when identities were offered as treasuries —
  // and leaving it in place would let a seat spend from an identity.
  if (chosen && found.error === null && !found.treasuries.some((t) => t.address === chosen)) {
    await setSessionTreasury(c.env, session.playerId, null);
    base.notice =
      chosen === person
        ? `Play was set to be funded from ${short(chosen)}, which is your PERSON agent — your identity, not a treasury. That choice has been cleared: a treasury is a separate Smart Agent chartered under you.`
        : `Play was set to be funded from ${short(chosen)}, which your Home no longer lists as one of your treasuries. That choice has been cleared.`;
    chosen = null;
    base.chosen = null;
    base.chosenName = null;
    base.mandate = mandateView(c.env, undefined, undefined, null, now);
  }

  // A mandate the Home minted during SIGN-IN, now that we know which accounts are actually theirs.
  //
  // This is the second half of collapsing two trips into one: the ceremony that established the
  // session also minted the authority, but the authority names an account and the card room could
  // not yet check that the account is the player's. It can here — `found.treasuries` is the Home's
  // own answer — so the mandate goes through exactly the verification a hand-delivered one goes
  // through and is kept only if it passes.
  const promoted = await promotePendingMandate(c.env, session.playerId, record, found, chosen, now);
  if (promoted) {
    chosen = promoted.treasury;
    base.chosen = promoted.treasury;
    base.chosenName = promoted.treasuryName ?? base.chosenName;
    base.mandate = mandateView(c.env, promoted.mandate, promoted.treasury, promoted.treasury, now);
  }

  const client = readOnlyTreasury(c.env);
  for (const candidate of base.candidates) {
    try {
      const balance = await client.readBalance(candidate.address as Address);
      candidate.balance = balance.toString();
      candidate.balanceText = formatAmount(balance);
      if (candidate.address === chosen) {
        base.balance = candidate.balance;
        base.balanceText = candidate.balanceText;
        base.chosenName = candidate.name || base.chosenName;
      }
    } catch (e) {
      candidate.error = `could not read the balance of ${candidate.address}: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  const faucet = await isTestAsset(c.env);
  base.faucet = faucet.ok ? { available: true, asset: faucet.name, reason: null } : { available: false, asset: null, reason: faucet.reason };

  return c.json(base);
}

/* --------------------------------------------------------- POST /treasury/select */

/**
 * `POST /treasury/select` — choose the treasury that funds this player's play.
 *
 * The only accepted answers are the ones the player's own Home listed as theirs. That is stricter
 * than the on-chain custody check it replaces, and deliberately so: custody proves an account can be
 * spent from, but a person agent passes that test too, and spending from an identity is exactly the
 * confusion this route now refuses to allow.
 */
export async function selectTreasury(c: Ctx, session: SessionClaims, address: string): Promise<Response> {
  const wanted = address.trim();
  if (!isAddress(wanted)) return c.json({ error: `"${wanted}" is not a 20-byte address` }, 400);
  const lower = wanted.toLowerCase();

  const record = await readSessionRecord(c.env, session.playerId);
  const person = record?.address && isAddress(record.address) ? record.address.toLowerCase() : null;

  if (person && lower === person) {
    return c.json(
      {
        error:
          `${lower} is your person agent — your identity at your Home, not a treasury. Play is funded from a ` +
          `separate treasury Smart Agent chartered under you; create one, or pick one your Home already lists.`,
      },
      400,
    );
  }

  const found = await discover(c.env, record?.idToken);
  if (found.error) return c.json({ error: found.error }, 502);
  const match = found.treasuries.find((t) => t.address === lower);
  if (!match) {
    return c.json(
      {
        error:
          found.treasuries.length === 0
            ? `your Home lists no treasuries for you, so there is nothing to fund play from yet — create one first`
            : `your Home does not list ${lower} as one of your treasuries. It lists ${found.treasuries
                .map((t) => t.label)
                .join(', ')}.`,
      },
      403,
    );
  }

  if (!(await setSessionTreasury(c.env, session.playerId, lower, match.name))) {
    return c.json({ error: 'this session is no longer active, so the choice was not recorded' }, 401);
  }

  let balance: string | null = null;
  let balanceText: string | null = null;
  try {
    const b = await readOnlyTreasury(c.env).readBalance(lower as Address);
    balance = b.toString();
    balanceText = formatAmount(b);
  } catch {
    /* the choice is recorded either way; the balance is a nicety */
  }
  return c.json({
    chosen: lower,
    name: match.name,
    balance,
    balanceText,
    // Saying this out loud is the point: the player has to sign again, and a silent invalidation
    // would look like the mandate had simply stopped working.
    note: 'Any buy-in mandate you had signed covered the treasury you were using before, so it no longer applies. Sign one for this treasury before taking a settled seat.',
  });
}

/* --------------------------------------------------------- POST /treasury/create */

/**
 * `POST /treasury/create` — get this player a treasury.
 *
 * For one of the Home's demo people the whole ceremony runs here: the Home lends the identity and
 * holds its key, so it can be asked to deploy an account under that person's own custodian and to
 * record it in their agent tree. The card room signs nothing and custodies nothing.
 *
 * For a real person there is nothing to run. Their Home creates and custodies their agents, and the
 * only endpoint that does it requires a session their Home mints for itself. So this refuses with the
 * URL to send them to, which is a step in the flow rather than a dead end.
 */
export async function createTreasury(c: Ctx, session: SessionClaims, label: string | undefined): Promise<Response> {
  const record = await readSessionRecord(c.env, session.playerId);
  const person = record?.address && isAddress(record.address) ? record.address.toLowerCase() : null;
  if (!person) {
    return c.json({ error: 'this session has no Smart Agent, so there is no person to charter a treasury under' }, 403);
  }

  let config;
  try {
    config = homeApi(c.env);
  } catch (e) {
    return c.json({ error: configFailure(e) }, 503);
  }

  const persona = await personaFor(c.env, person);
  if (!persona) {
    return c.json(
      {
        error:
          'your Home creates and custodies your treasury, not this card room — it is your money and your key. ' +
          'Open your Home, create a personal treasury there, then come back and check again.',
        portalUrl: treasuryHandoffUrl(config),
        mode: 'home-portal',
      },
      409,
    );
  }

  const naming = treasuryNaming(c.env);
  if (label && !naming) {
    return c.json(
      { error: 'this deployment cannot claim a name (AGENT_NAME_REGISTRY / TREASURY_SUBREGISTRY are not set) — create it without one' },
      503,
    );
  }

  let signIn;
  try {
    signIn = await demoSignIn(config, persona.handle);
  } catch (e) {
    const reason = e instanceof HomeApiError ? e.reason : e instanceof Error ? e.message : String(e);
    return c.json({ error: `your Home would not authorise creating a treasury: ${reason}` }, 502);
  }
  if (signIn.agent !== person) {
    return c.json({ error: 'your Home answered for a different person than this session — nothing was created' }, 502);
  }

  try {
    const created = await createTreasuryForPersona(
      { home: config, nameRegistry: naming?.nameRegistry ?? '0x', treasurySubregistry: naming?.treasurySubregistry ?? '0x' },
      { persona, homeSession: signIn.homeSession, ...(label ? { label } : {}) },
    );
    // Chosen straight away: a player who just made a treasury did not make it to look at it. The
    // mandate is cleared with the switch, as it is for any other change of treasury.
    await setSessionTreasury(c.env, session.playerId, created.address, created.name);
    return c.json({
      treasury: created.address,
      name: created.name,
      txHash: created.txHash,
      chosen: true,
      note: created.name
        ? `${created.name} is yours: a treasury Smart Agent chartered under your person agent, custodied by your Home.`
        : 'Your treasury is a Smart Agent chartered under your person agent, custodied by your Home. It has no name, which is fine — the address is its identity.',
    });
  } catch (e) {
    if (e instanceof TreasuryCreationError) {
      return c.json({ error: e.reason, code: e.code }, e.code === 'label-taken' || e.code === 'label-unusable' ? 409 : 502);
    }
    return c.json({ error: `the treasury was not created: ${e instanceof Error ? e.message : String(e)}` }, 502);
  }
}

/* --------------------------------------------------------- POST /treasury/mandate */

/**
 * `POST /treasury/mandate` — the buy-in ceremony.
 *
 * A cash-out is the house spending its own funds. A buy-in is not: the money is the player's, and the
 * only thing that lets the house move it is a delegation the player's treasury signed, capped by
 * caveats their Home showed them first. Two ways to get one, and they end in the same place:
 *
 *   demo persona  the Home holds the custodian key, so the card room builds the exact delegation,
 *                 asks the Home to sign the EIP-712 digest as that person, and stores the result.
 *   real player   their Home runs the ceremony in the browser and hands the signed delegation back;
 *                 this route CHECKS it against the terms this table would have asked for and stores
 *                 it only if it matches.
 *
 * Nothing here trusts the browser: a delegation that arrives is verified against the treasury on the
 * server session, the house delegate, the payee, the asset and the window before it is kept.
 */
export async function signMandate(c: Ctx, session: SessionClaims, supplied: unknown): Promise<Response> {
  const now = Date.now();
  const record = await readSessionRecord(c.env, session.playerId);
  const person = record?.address && isAddress(record.address) ? record.address.toLowerCase() : null;
  const chosen = record?.treasury && isAddress(record.treasury) ? record.treasury.toLowerCase() : null;
  if (!chosen) {
    return c.json({ error: 'choose the treasury that funds your play before authorising anything to leave it' }, 409);
  }

  const ctx = mandateContext(c.env, now);
  if ('error' in ctx) return c.json({ error: ctx.error }, 503);

  const expectation = mandateExpectation(ctx, chosen, now, moneyName(c.env));

  // A delegation the player's own Home issued. Checked, never trusted — including its CURRENCY: the
  // asset it names must be the one this card room settles in, and the answer is recorded WITH the
  // mandate (`mandateAsset`), which is what stops it being spent at a table pinned to anything else
  // (`PokerTableDO.playerFunding`).
  if (supplied !== undefined && supplied !== null) {
    const problem = checkBuyInMandate(supplied, expectation);
    if (problem !== null) return c.json({ error: problem }, 400);
    const validUntil = ctx.terms.validUntil;
    if (
      !(await patchSessionRecord(c.env, session.playerId, {
        buyInMandate: supplied,
        mandateTreasury: chosen,
        mandateAsset: ctx.terms.asset,
        mandateValidUntil: validUntil,
      }))
    ) {
      return c.json({ error: 'this session is no longer active, so the mandate was not recorded' }, 401);
    }
    return c.json({ treasury: chosen, source: 'home', validUntil, ...consentOf(ctx.terms) });
  }

  // No delegation supplied: this only works when the Home holds the treasury's custodian key, which
  // it does for its own demo people and for nobody else.
  const persona = await personaFor(c.env, person ?? undefined);
  if (!persona) {
    return c.json(
      {
        error:
          'a buy-in mandate is signed by your treasury at your own Home — this card room cannot sign for you. ' +
          'Authorise the buy-in through your Home and send the signed mandate back.',
      },
      409,
    );
  }

  const signed = await signMandateAsPersona(c.env, session.playerId, chosen, persona, ctx, expectation, now);
  if ('error' in signed) return c.json({ error: signed.error }, signed.status);
  return c.json({ treasury: chosen, source: 'persona', validUntil: ctx.terms.validUntil, ...consentOf(ctx.terms) });
}

/**
 * Have the Home sign the buy-in mandate for one of its own demo people, and record it.
 *
 * Shared by `POST /treasury/mandate` and the quick-start flow so both ask for exactly the same
 * delegation and check it the same way. The card room builds the terms, the HOME signs the EIP-712
 * digest with the persona's own custodian key, and the result is re-checked against the expectation
 * before it is kept: a mandate this app has not verified is a mandate this app will not store.
 */
async function signMandateAsPersona(
  env: Env,
  playerId: string,
  treasury: string,
  persona: DemoPersona,
  ctx: MandateContext,
  expectation: Parameters<typeof checkBuyInMandate>[1],
  now: number,
): Promise<{ ok: true } | { error: string; status: 401 | 502 | 503 }> {
  let config;
  try {
    config = homeApi(env);
  } catch (e) {
    return { error: configFailure(e), status: 503 };
  }

  let signIn;
  try {
    signIn = await demoSignIn(config, persona.handle);
  } catch (e) {
    const reason = e instanceof HomeApiError ? e.reason : e instanceof Error ? e.message : String(e);
    return { error: `your Home would not authorise a buy-in mandate: ${reason}`, status: 502 };
  }

  const unsigned = unsignedBuyInMandate({
    treasury: treasury as Address,
    houseDelegate: ctx.houseDelegate,
    terms: ctx.terms,
    salt: BigInt(now),
  });
  const digest = buyInMandateDigest(unsigned, ctx.chainId, ctx.delegationManager);

  let signature;
  try {
    signature = await personaSignDigest(config, signIn.homeSession, digest);
  } catch (e) {
    const reason = e instanceof HomeApiError ? e.reason : e instanceof Error ? e.message : String(e);
    return { error: `your Home did not sign the buy-in mandate: ${reason}`, status: 502 };
  }

  const mandate = { ...unsigned, salt: unsigned.salt.toString(), signature };
  const problem = checkBuyInMandate(mandate, expectation);
  if (problem) return { error: `the mandate your Home signed does not authorise this table: ${problem}`, status: 502 };

  if (
    !(await patchSessionRecord(env, playerId, {
      buyInMandate: mandate,
      mandateTreasury: treasury,
      // The currency the card room ASKED for, which is the one it built the terms in. Recorded so a
      // table pinned to a different coin refuses this authority instead of spending under it.
      mandateAsset: ctx.terms.asset,
      mandateValidUntil: ctx.terms.validUntil,
    }))
  ) {
    return { error: 'this session is no longer active, so the mandate was not recorded', status: 401 };
  }
  return { ok: true };
}

/**
 * What a mandate must satisfy to be accepted: whose treasury it spends from, who may redeem it, who
 * is paid, IN WHAT, under which enforcer, and for how long.
 *
 * The asset is in here deliberately. The card room settles in one currency, so a mandate that named
 * another would be a mandate for money this table never takes — the check should never fire, and
 * that is exactly why it is worth keeping.
 */
function mandateExpectation(ctx: MandateContext, treasury: string, now: number, assetSymbol?: string): Parameters<typeof checkBuyInMandate>[1] {
  return {
    treasury: treasury as Address,
    houseDelegate: ctx.houseDelegate,
    payee: ctx.terms.payee,
    asset: ctx.terms.asset,
    paymentEnforcer: ctx.terms.enforcers.payment,
    openDelegate: OPEN_DELEGATE,
    ...(assetSymbol ? { assetSymbol } : {}),
    now,
  };
}

/** The numbers a player is agreeing to, as strings, exactly as the consent screen showed them. */
function consentOf(terms: BuyInMandateTerms): {
  maxPerBuyIn: string;
  sessionTotal: string;
  maxBuyIns: number;
  payee: string;
  asset: string;
} {
  const consent = describeBuyInMandate(terms);
  return {
    maxPerBuyIn: consent.maxAmountPerCharge.toString(),
    sessionTotal: consent.sessionBudget.toString(),
    maxBuyIns: consent.maxRedemptionsPerWindow,
    payee: consent.recipient,
    asset: consent.asset,
  };
}

/* ----------------------------------------------------------- POST /treasury/fund */

/**
 * `POST /treasury/fund` — mint Sheqels into the chosen treasury.
 *
 * This exists because the card room's own coin has an open `mint`, and a demo with no money in it
 * demonstrates nothing. It is gated on the asset ITSELF answering "anyone may mint me" — a simulated
 * `mint` from an address with no standing here (see `isTestAsset`) — and never on a name or a config
 * flag: if this deployment is ever pointed at a real asset, the button disappears rather than
 * reverting in a player's face.
 */
export async function fundTreasury(c: Ctx, session: SessionClaims, amountRaw: string | undefined): Promise<Response> {
  const money = moneyName(c.env);
  const record = await readSessionRecord(c.env, session.playerId);
  const chosen = record?.treasury && isAddress(record.treasury) ? record.treasury.toLowerCase() : null;
  if (!chosen) return c.json({ error: 'choose a treasury before funding one' }, 409);

  const faucet = await isTestAsset(c.env);
  if (!faucet.ok) return c.json({ error: faucet.reason }, 403);

  let amount: bigint;
  try {
    amount = parseAmount(amountRaw ?? '100');
  } catch (e) {
    return c.json({ error: e instanceof TreasuryError ? e.message : `"${amountRaw}" is not an amount of ${money}` }, 400);
  }
  if (amount <= 0n) return c.json({ error: `the amount must be greater than zero, got ${formatAmount(amount)}` }, 400);
  if (amount > MAX_FUND) {
    return c.json({ error: `${formatAmount(amount)} is more than the ${formatAmount(MAX_FUND)} ${money} the test faucet will mint at once` }, 400);
  }

  let client;
  try {
    client = custodialTreasury(c.env);
  } catch (e) {
    return c.json({ error: configFailure(e) }, 503);
  }

  let txHash: string;
  try {
    txHash = await client.mintTestAsset(chosen as Address, amount);
  } catch (e) {
    return c.json({ error: `the test mint did not land: ${e instanceof Error ? e.message : String(e)}` }, 502);
  }

  let balance: string | null = null;
  let balanceText: string | null = null;
  try {
    const b = await client.readBalance(chosen as Address);
    balance = b.toString();
    balanceText = formatAmount(b);
  } catch {
    /* the mint landed; a stale read replica must not turn that into a failure */
  }
  return c.json({
    treasury: chosen,
    minted: amount.toString(),
    mintedText: formatAmount(amount),
    txHash,
    balance,
    balanceText,
    asset: faucet.name,
    note: `Test ${money} on faithchain. It has no value anywhere else.`,
  });
}

/* ----------------------------------------------------- POST /treasury/quick-start */

/**
 * The seed a new player starts with, as a decimal amount of the card room's own coin.
 *
 * Test money on faithchain, and enough of it that nobody has to think about topping up on their
 * first night. There is ONE currency, so this is one number and one mint — nothing is seeded "in
 * every settled currency" and nothing is converted. It only ever tops a treasury up TO this floor:
 * a player who already has money is not given more, because that would be the card room deciding to
 * change somebody's balance behind their back.
 */
export const SEED_AMOUNT = '10000';

/** One thing the card room did, or could not do, said in money rather than machinery. */
export interface QuickStartStep {
  step: 'treasury' | 'stake' | 'authority';
  /** `done` we did it · `kept` it was already so · `blocked` someone else must act · `failed` it broke. */
  status: 'done' | 'kept' | 'blocked' | 'failed';
  /** One plain sentence. Shown as-is; it is the whole progress line. */
  said: string;
  /** The address or transaction behind it. For the details disclosure ONLY — never the headline. */
  detail?: string;
}

/** What the player must do next, when the card room cannot do it for them. */
export interface QuickStartNext {
  action: 'none' | 'create-at-home' | 'authorise-at-home' | 'retry';
  said: string;
  /** Their Home's own page, for `create-at-home`. Ours never appears here. */
  portalUrl?: string | null;
}

export interface QuickStartView {
  /** True only when a settled seat would actually be allowed right now. Never optimistic. */
  ready: boolean;
  treasury: string | null;
  /** `<label>.treasury`, or '' — what a player should be shown instead of an address. */
  treasuryName: string | null;
  balance: string | null;
  balanceText: string | null;
  steps: QuickStartStep[];
  next: QuickStartNext;
}

/** How many candidate balances quick-start will read before it just takes the first one. */
const BALANCE_READS = 8;

/** A short label for a new treasury, from the person's own handle. `a–z0–9-`, 2–24 chars. */
function labelFor(handle: string): string {
  const base = handle.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
  return base.length >= 2 ? base.slice(0, 20) : '';
}

/**
 * `POST /treasury/quick-start` — everything between signing in and sitting down, in one call.
 *
 * A new player does not have a mental model of chartered Smart Agents, delegation caveats or an
 * open-mint test token, and should not need one to play a hand. So this does the whole sequence and
 * reports it as three sentences about money: they have somewhere to keep it, they have some, and
 * they have said how much this table may take.
 *
 * It never fakes a leg. Each step says `done`, `kept`, `blocked` or `failed`, and a failure carries
 * the reason forward so the same button can be pressed again. `ready` is true only when a settled
 * seat would actually be allowed — the same four conditions `authorizeBuyIn` checks on the way in.
 *
 * Two of the three steps belong to the player's Home when the player is a real person: their Home
 * creates and custodies their treasury, and their Home signs the buy-in mandate. Those come back as
 * `blocked` with the place to go, which is a step in the flow rather than a dead end.
 */
export async function quickStart(c: Ctx, session: SessionClaims): Promise<Response> {
  const now = Date.now();
  const money = moneyName(c.env);
  const record = await readSessionRecord(c.env, session.playerId);
  const person = record?.address && isAddress(record.address) ? record.address.toLowerCase() : null;
  if (!person) {
    return c.json({ error: 'this session has no Smart Agent, so there is no person to set anything up for' }, 403);
  }

  const steps: QuickStartStep[] = [];
  const persona = await personaFor(c.env, person);
  let portalUrl: string | null = null;
  try {
    portalUrl = treasuryHandoffUrl(homeApi(c.env));
  } catch {
    /* named below by whichever step needs it */
  }

  const answer = (ready: boolean, treasury: string | null, name: string | null, balance: bigint | null, next: QuickStartNext): Response =>
    c.json({
      ready,
      treasury,
      treasuryName: name,
      balance: balance === null ? null : balance.toString(),
      balanceText: balance === null ? null : formatAmount(balance),
      steps,
      next,
    } satisfies QuickStartView);

  /* ------------------------------------------------------- 1. somewhere to keep it */

  const found = await discover(c.env, record?.idToken);
  if (found.error) {
    steps.push({ step: 'treasury', status: 'failed', said: `We could not read your account: ${found.error}` });
    return answer(false, null, null, null, { action: 'retry', said: 'Try again in a moment.' });
  }

  const held = record?.treasury && isAddress(record.treasury) ? record.treasury.toLowerCase() : null;
  // Prefer what this session already spends from; otherwise the one with the most in it, so a
  // returning player lands on the money they actually have rather than on an empty account. The
  // Home's answer carries no balances, so they are read here — bounded, because a player who has
  // made a dozen accounts should not turn one button into a dozen round trips.
  let match = (held ? found.treasuries.find((t) => t.address === held) : null) ?? null;
  if (!match && found.treasuries.length > 0) {
    match = found.treasuries[0] ?? null;
    let best = -1n;
    // One client for the whole sweep, and a deployment that cannot reach the chain simply takes the
    // first account the Home listed rather than failing a step that has nothing to do with balances.
    let reader: TreasuryClient | null = null;
    try {
      reader = readOnlyTreasury(c.env);
    } catch {
      reader = null;
    }
    const sweep = reader ? found.treasuries.slice(0, BALANCE_READS) : [];
    for (const candidate of sweep) {
      try {
        const b = await (reader as TreasuryClient).readBalance(candidate.address as Address);
        if (b > best) {
          best = b;
          match = candidate;
        }
      } catch {
        /* an unreadable balance is not a reason to reject an account the Home says is theirs */
      }
    }
  }
  let created = false;

  if (!match) {
    if (!persona) {
      steps.push({
        step: 'treasury',
        status: 'blocked',
        said: 'Your money is kept by you, at your own Home — the card room never holds it, so it cannot make the account for you.',
      });
      return answer(false, null, null, null, {
        action: 'create-at-home',
        said: 'Open your Home and create your personal treasury. Come back here afterwards and the rest happens on its own.',
        portalUrl,
      });
    }

    // A demo person's Home holds their key, so the card room can ask it to make the account. A name
    // is worth having: it is what a player sees instead of forty characters of address.
    let label = labelFor(persona.handle);
    if (label && treasuryNaming(c.env)) {
      try {
        const check = await checkTreasuryLabel(homeApi(c.env), label);
        if (check.status !== 'free') label = `${label.slice(0, 15)}-${Math.random().toString(16).slice(2, 6)}`;
      } catch {
        label = '';
      }
    } else {
      label = '';
    }

    try {
      const config = homeApi(c.env);
      const signIn = await demoSignIn(config, persona.handle);
      if (signIn.agent !== person) throw new Error('your Home answered for a different person than this session');
      const naming = treasuryNaming(c.env);
      const out = await createTreasuryForPersona(
        { home: config, nameRegistry: naming?.nameRegistry ?? '0x', treasurySubregistry: naming?.treasurySubregistry ?? '0x' },
        { persona, homeSession: signIn.homeSession, ...(label ? { label } : {}) },
      );
      match = { address: out.address.toLowerCase(), name: out.name, label: out.name || short(out.address), balance: '0', balanceText: '0' };
      created = true;
    } catch (e) {
      const reason = e instanceof TreasuryCreationError ? e.reason : e instanceof Error ? e.message : String(e);
      steps.push({ step: 'treasury', status: 'failed', said: `Your account was not created: ${reason}` });
      return answer(false, null, null, null, { action: 'retry', said: 'Nothing was set up. Try again.' });
    }
  }

  const chosen = match.address;
  if (chosen !== held && !(await setSessionTreasury(c.env, session.playerId, chosen, match.name))) {
    steps.push({ step: 'treasury', status: 'failed', said: 'This sign-in is no longer active, so nothing was recorded.' });
    return answer(false, null, null, null, { action: 'retry', said: 'Sign in again.' });
  }
  steps.push({
    step: 'treasury',
    status: created ? 'done' : 'kept',
    // "Found" rather than "you already had": for a person who made it at their Home thirty seconds
    // ago, "already" would be wrong, and the card room cannot tell that case from a returning
    // player's. Both are true of "found", and both are true of who holds the key.
    said: created
      ? 'Your own money account is ready — it is yours, and your Home holds the key.'
      : 'Found your money account — it is yours, and your Home holds the key.',
    detail: match.name ? `${match.name} · ${chosen}` : chosen,
  });

  /* ------------------------------------------------------------------ 2. a stake */

  // ONE currency, so one stake: 10 000 Sheqels, and no branching about which coin a player might
  // need for which table. There is nothing to convert and nothing to top up in a second asset.
  const floor = parseAmount(SEED_AMOUNT);
  let balance: bigint;
  try {
    balance = await readOnlyTreasury(c.env).readBalance(chosen as Address);
  } catch (e) {
    steps.push({ step: 'stake', status: 'failed', said: `We could not read your balance: ${e instanceof Error ? e.message : String(e)}` });
    return answer(false, chosen, match.name, null, { action: 'retry', said: 'Try again in a moment.' });
  }
  // The invariant is a floor, not "is it empty". A treasury the player CHOSE can hold less than a
  // buy-in, and a player who arrives with 3 at a table with a 40 minimum is stuck with no way
  // forward — the same dead end as having no treasury at all.
  let funded = false;
  let lastTx = '';
  if (balance < floor) {
    // Gated on the ASSET ITSELF answering "anyone may mint me", never on a flag or a name: real
    // money is never minted, and the refusal names the token rather than pretending money arrived.
    const faucet = await isTestAsset(c.env);
    if (!faucet.ok) {
      steps.push({ step: 'stake', status: 'blocked', said: `Nothing was added: ${faucet.reason}` });
    } else {
      try {
        // Mint the SHORTFALL, so a partly-funded treasury lands exactly on the floor rather than
        // being handed another full seed on top of what it already had.
        lastTx = await custodialTreasury(c.env).mintTestAsset(chosen as Address, floor - balance);
        balance = await readOnlyTreasury(c.env)
          .readBalance(chosen as Address)
          .catch(() => floor);
        funded = true;
      } catch (e) {
        const reason = e instanceof TreasuryConfigError ? configFailure(e) : e instanceof Error ? e.message : String(e);
        steps.push({ step: 'stake', status: 'failed', said: `The ${SEED_AMOUNT} ${money} did not arrive: ${reason}` });
        return answer(false, chosen, match.name, null, { action: 'retry', said: 'Your account is set up. Try adding the money again.' });
      }
    }
  }
  if (funded) {
    steps.push({
      step: 'stake',
      status: 'done',
      said: `You're set up with ${formatMoney(balance)} ${money} to play with.`,
      ...(lastTx ? { detail: lastTx } : {}),
    });
  } else {
    steps.push({ step: 'stake', status: 'kept', said: `You already have ${formatMoney(balance)} ${money} to play with.` });
  }

  /* -------------------------------------------------------------- 3. the authority */

  const ctx = mandateContext(c.env, now);
  if ('error' in ctx) {
    steps.push({ step: 'authority', status: 'blocked', said: `Buy-ins cannot be authorised here: ${ctx.error}` });
    return answer(false, chosen, match.name, balance, { action: 'none', said: 'Play-money tables are unaffected.' });
  }
  const expectation = mandateExpectation(ctx, chosen, now, money);
  const consent = describeBuyInMandate(ctx.terms);
  const cap = `up to ${formatMoney(consent.maxAmountPerCharge)} ${money} a time, ${formatMoney(consent.sessionBudget)} ${money} in all`;
  const boundTo = record?.mandateTreasury?.toLowerCase();
  // Re-asking for an authority the player already holds is the errand this whole route exists to
  // remove, so a standing mandate that still passes every check is kept as it is.
  const standing = boundTo === chosen && record?.buyInMandate ? checkBuyInMandate(record.buyInMandate, expectation) === null : false;

  if (standing) {
    steps.push({ step: 'authority', status: 'kept', said: `This table may already take ${cap}. You can undo that at your Home whenever you like.` });
  } else if (!persona) {
    steps.push({
      step: 'authority',
      status: 'blocked',
      said: `The last thing is your say-so: how much this table may take from your money — ${cap}.`,
    });
    return answer(false, chosen, match.name, balance, {
      action: 'authorise-at-home',
      said: 'Your Home asks you this and signs it, not the card room. You can undo it there whenever you like.',
    });
  } else {
    const signed = await signMandateAsPersona(c.env, session.playerId, chosen, persona, ctx, expectation, now);
    if ('error' in signed) {
      steps.push({ step: 'authority', status: 'failed', said: `Buy-ins were not authorised: ${signed.error}` });
      return answer(false, chosen, match.name, balance, { action: 'retry', said: 'Your money is set up. Try authorising again.' });
    }
    steps.push({ step: 'authority', status: 'done', said: `This table may take ${cap}. You can undo that at your Home whenever you like.` });
  }

  const ready = balance > 0n;
  return answer(ready, chosen, match.name, balance, {
    action: ready ? 'none' : 'retry',
    said: ready ? 'You are ready to sit down.' : 'There is no money in your account yet.',
  });
}
