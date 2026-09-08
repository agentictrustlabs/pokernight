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
 *   POST /treasury/select {address}    choose one — refused unless the Home says it is theirs
 *   POST /treasury/create {label?}     make one (server-side for a demo persona; a hand-off otherwise)
 *   POST /treasury/fund {amount}       mint test USDC, faithchain's open-mint MockUSDC only
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
  formatUsdc,
  parseUsdc,
  unsignedBuyInMandate,
  type Address,
  type BuyInMandateTerms,
} from '@pokernight/treasury';
import { patchSessionRecord, readSessionRecord, setSessionTreasury, type SessionClaims } from './auth.js';
import type { Env } from './env.js';
import {
  HomeApiError,
  demoPersonaFor,
  demoSignIn,
  listRelatedAgents,
  managedAgentsUrl,
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
import { TreasuryCreationError, createTreasuryForPersona } from './treasury-create.js';

export const SelectTreasurySchema = z.object({ address: z.string().trim().min(1).max(64) });
/** A decimal USDC amount, e.g. "100" or "12.50". Capped so a demo faucet stays a demo faucet. */
export const FundTreasurySchema = z.object({ amount: z.string().trim().min(1).max(32).optional() });
/** Nameless is the default; a label is a request for `<label>.treasury`. */
export const CreateTreasurySchema = z.object({ label: z.string().trim().max(32).optional() });
/**
 * The mandate route takes either nothing (a demo persona, whose Home signs server-side) or a
 * delegation the player's own Home issued to them in the browser.
 */
export const MandateSchema = z.object({ delegation: z.unknown().optional() });

/** Biggest single faucet grant. Test money, but an unbounded mint button is still a bad button. */
export const MAX_FUND_USDC = 100_000_000_000n; // 100_000 USDC in base units

/** One treasury the player could choose. Every candidate is a `person-treasury` at their own Home. */
export interface TreasuryCandidate {
  address: string;
  /** `<label>.treasury`, or '' — a treasury is allowed to be nameless. */
  name: string;
  /** What the panel calls it: the name if it has one, else a short address. */
  label: string;
  balance: string | null;
  balanceUsdc: string | null;
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
  /** Asset base units per chip, as a decimal string (bigints do not survive JSON). */
  chipValue: string;
  /** The player's PERSON agent — their identity. Shown so they can see it is not on the list. */
  person: string | null;
  personName: string | null;
  /** The treasury this session funds play from, or null when the player has not chosen yet. */
  chosen: string | null;
  chosenName: string | null;
  balance: string | null;
  balanceUsdc: string | null;
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
  if (e instanceof TreasuryConfigError) return `the card room is not configured to settle in USDC: ${e.message}`;
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
        balanceUsdc: null,
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

/** The mandate half of `GET /treasury`: what is authorised, and whether it still covers this session. */
function mandateView(env: Env, stored: unknown, boundTo: string | undefined, chosen: string | null, now: number): MandateView {
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
  const record = await readSessionRecord(c.env, session.playerId);
  const person = record?.address && isAddress(record.address) ? record.address.toLowerCase() : null;
  let chosen = record?.treasury && isAddress(record.treasury) ? record.treasury.toLowerCase() : null;

  const persona = await personaFor(c.env, person ?? undefined);
  let create: TreasuryCreationOffer;
  try {
    create = {
      mode: persona ? 'server' : 'home-portal',
      portalUrl: persona ? null : managedAgentsUrl(homeApi(c.env)),
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
      chipValue: chipValue(c.env).toString(),
      person,
      personName: record?.agentName ?? null,
      chosen,
      chosenName: record?.treasuryName ?? null,
      balance: null,
      balanceUsdc: null,
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
        chipValue: '0',
        person,
        personName: record?.agentName ?? null,
        chosen,
        chosenName: record?.treasuryName ?? null,
        balance: null,
        balanceUsdc: null,
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

  const client = readOnlyTreasury(c.env);
  for (const candidate of base.candidates) {
    try {
      const balance = await client.readUsdcBalance(candidate.address as Address);
      candidate.balance = balance.toString();
      candidate.balanceUsdc = formatUsdc(balance);
      if (candidate.address === chosen) {
        base.balance = candidate.balance;
        base.balanceUsdc = candidate.balanceUsdc;
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
  let balanceUsdc: string | null = null;
  try {
    const b = await readOnlyTreasury(c.env).readUsdcBalance(lower as Address);
    balance = b.toString();
    balanceUsdc = formatUsdc(b);
  } catch {
    /* the choice is recorded either way; the balance is a nicety */
  }
  return c.json({
    chosen: lower,
    name: match.name,
    balance,
    balanceUsdc,
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
        portalUrl: managedAgentsUrl(config),
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

  const expectation = {
    treasury: chosen as Address,
    houseDelegate: ctx.houseDelegate,
    payee: ctx.terms.payee,
    asset: ctx.terms.asset,
    paymentEnforcer: ctx.terms.enforcers.payment,
    openDelegate: OPEN_DELEGATE,
    now,
  };

  // A delegation the player's own Home issued. Checked, never trusted.
  if (supplied !== undefined && supplied !== null) {
    const problem = checkBuyInMandate(supplied, expectation);
    if (problem) return c.json({ error: problem }, 400);
    const validUntil = ctx.terms.validUntil;
    if (!(await patchSessionRecord(c.env, session.playerId, { buyInMandate: supplied, mandateTreasury: chosen, mandateValidUntil: validUntil }))) {
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

  let config;
  try {
    config = homeApi(c.env);
  } catch (e) {
    return c.json({ error: configFailure(e) }, 503);
  }

  let signIn;
  try {
    signIn = await demoSignIn(config, persona.handle);
  } catch (e) {
    const reason = e instanceof HomeApiError ? e.reason : e instanceof Error ? e.message : String(e);
    return c.json({ error: `your Home would not authorise a buy-in mandate: ${reason}` }, 502);
  }

  const unsigned = unsignedBuyInMandate({
    treasury: chosen as Address,
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
    return c.json({ error: `your Home did not sign the buy-in mandate: ${reason}` }, 502);
  }

  const mandate = { ...unsigned, salt: unsigned.salt.toString(), signature };
  const problem = checkBuyInMandate(mandate, expectation);
  if (problem) return c.json({ error: `the mandate your Home signed does not authorise this table: ${problem}` }, 502);

  if (!(await patchSessionRecord(c.env, session.playerId, { buyInMandate: mandate, mandateTreasury: chosen, mandateValidUntil: ctx.terms.validUntil }))) {
    return c.json({ error: 'this session is no longer active, so the mandate was not recorded' }, 401);
  }
  return c.json({ treasury: chosen, source: 'persona', validUntil: ctx.terms.validUntil, ...consentOf(ctx.terms) });
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
 * `POST /treasury/fund` — mint test USDC into the chosen treasury.
 *
 * This exists because faithchain's settlement asset is MockUSDC with an open `mint`, and a demo with
 * no money in it demonstrates nothing. It is gated on the asset ITSELF saying it is a mock (see
 * `isTestAsset`), not on a config flag: if this deployment is ever pointed at a real stablecoin, the
 * button disappears rather than reverting in a player's face.
 */
export async function fundTreasury(c: Ctx, session: SessionClaims, amountRaw: string | undefined): Promise<Response> {
  const record = await readSessionRecord(c.env, session.playerId);
  const chosen = record?.treasury && isAddress(record.treasury) ? record.treasury.toLowerCase() : null;
  if (!chosen) return c.json({ error: 'choose a treasury before funding one' }, 409);

  const faucet = await isTestAsset(c.env);
  if (!faucet.ok) return c.json({ error: faucet.reason }, 403);

  let amount: bigint;
  try {
    amount = parseUsdc(amountRaw ?? '100');
  } catch (e) {
    return c.json({ error: e instanceof TreasuryError ? e.message : `"${amountRaw}" is not a USDC amount` }, 400);
  }
  if (amount <= 0n) return c.json({ error: `the amount must be greater than zero, got ${formatUsdc(amount)}` }, 400);
  if (amount > MAX_FUND_USDC) {
    return c.json({ error: `${formatUsdc(amount)} is more than the ${formatUsdc(MAX_FUND_USDC)} USDC the test faucet will mint at once` }, 400);
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
  let balanceUsdc: string | null = null;
  try {
    const b = await client.readUsdcBalance(chosen as Address);
    balance = b.toString();
    balanceUsdc = formatUsdc(b);
  } catch {
    /* the mint landed; a stale read replica must not turn that into a failure */
  }
  return c.json({
    treasury: chosen,
    minted: amount.toString(),
    mintedUsdc: formatUsdc(amount),
    txHash,
    balance,
    balanceUsdc,
    asset: faucet.name,
    note: 'Test USDC on faithchain. It has no value anywhere else.',
  });
}
