# Home-side setup for Pokernight

What lives in the estate's Home (`~/agenticprimitives/apps/demo-sso-next`, deployed to Vercel as
www.faithnet.me) rather than in this repo. Only the Home's operator can change any of it.

Verified against the live Home on 2026-09-08:
- `pokernight` is in the Home's **curated** registry, with redirect_uris `https://poker.faithnet.io/`
  and `http://localhost:5173/`, scopes `openid agent`, and delegation templates `site-login` and
  **`poker-buyin`**.
- `POST /connect/demo-signin` with `client_id: "pokernight"` succeeds and returns
  `{id_token, delegation, homeSession, agent, handle}`.
- `GET /connect/demo-personas` is open and publishes each demo person's **custodian EOA**.
- `GET /connect/related-orgs` with a `pokernight` id_token (and NO `client_id` parameter) returns the
  person's own agent tree; `?client_id=pokernight` returns only links this app created, which is empty.
- `GET /connect/name?exact=1&label=<l>&tld=treasury` answers `{label,name,node}` or `409 {taken:true}`.

## 1. What the card room can do with that, today

**Discovery** — `GET /connect/related-orgs`, filtered to `kind === 'person-treasury'`, is the ONLY
source of treasury candidates (`apps/tables/src/home-api.ts`). A person agent is never in that list,
which is exactly why it can never be offered as somewhere to spend from.

**Creation, for one of the Home's demo people** — the Home lends the identity and holds its custodian
key, so the whole ceremony runs server-side:

```
GET  /a2a/auth/csrf                     (Origin: https://www.faithnet.me → token)
POST /a2a/session/deploy                {initMethod:'eoa', owner:<persona custodian>, salt, callData?}
POST /connect/persona-sign              {digest:<userOpHash>}   Authorization: Bearer <homeSession>
POST /a2a/session/deploy/submit         {userOp}
POST /connect/related-orgs              {person, orgAgent, orgName, purpose, kind:'person-treasury', parent}
```

`/a2a/*` is CSRF-gated on a signed token bound to an allowlisted Origin (the Home's own), not on a
cookie or a session. `POST /connect/related-orgs` needs the **homeSession** bearer (aud `demo-sso`),
not the relying id_token. Proven end to end by `pnpm settle:persona`.

**A name** is optional and off by default. When a label is given, `register(label, treasury)` on the
`.treasury` PermissionlessSubregistry plus `setPrimaryName(node)` ride inside the deploy UserOp, so
the account is never half-named.

**The mandate, for a demo person** — the card room builds the delegation (delegator = the treasury,
delegate = the house agent, caveats from `buildPaymentMandateCaveats`), hashes it with
`hashDelegation`, and asks `POST /connect/persona-sign {digest}`. The signature is EIP-191 over the
32-byte digest, which `AgentAccount._verifyEcdsa` accepts on its second branch.

## 2. What a REAL (non-persona) player still needs from the Home

**Creating a treasury.** `POST /a2a/custody/oidc/bootstrap-agent` requires a session with
`principal.kind === 'oidc'`, `role === 'custody-grade'`, `assurance === 'onchain-confirmed'` and
`aud === 'demo-sso'`. A relying app's id_token is none of those, by construction. So the card room
hands the player to their Home's own portal at **`https://www.faithnet.me/treasuries`** ("Create
personal treasury"), and re-runs discovery when they come back. That page takes no return URL, so the
return leg is ours: a "check again" control beside the hand-off.

**Signing a buy-in mandate.** `poker-buyin` is curated for this client, so the authorize request is
accepted (`delegation_template=poker-buyin` on the Home's authorize URL). What the card room cannot
do from here is make the Home's ceremony MINT a payment delegation: on the Home side that behaviour
is selected by the client's registered `paymentConfig` and by branches that test for the `x402-pay`
template by name. Until the Home wires `poker-buyin` the same way, the ceremony completes as an
ordinary sign-in and returns no `paymentDelegation`.

The card room does not guess about any of that. `POST /treasury/mandate` accepts a delegation the
player's Home issued and CHECKS it — delegator is this session's treasury, delegate is the house
agent (or the open sentinel), payee is the house treasury, asset and window are right — and stores it
only if it passes. If the Home returns none, the seat is refused with "you have not authorised a
buy-in yet", which is what is observably true.

## 3. Optional: a Poker Site persona

To offer a "Poker Site" custodian in the demo roster the operator sets `DEMO_PERSONA_KEYS` on the
demo-sso-next Vercel project and redeploys; the roster is read from that env var and cached by its raw
string, so a deploy alone changes nothing. The house does NOT need it: Pokernight provisions its own
Service Agent and Treasury on faithchain (`scripts/provision-house.mts`).

## 4. Nothing else is required

Payments do not need `PaymentEscrow`: it is not deployed on faithchain, so settlement uses direct
mandate-authorised transfers between treasuries instead.
