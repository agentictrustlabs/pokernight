# The Mission Registry — a formal registry of mission organizations, and a guest at every game

**Status:** decided 2026-09-14; built in the phases at the end. Supersedes nothing — `docs/MISSION.md`
(what a mission may and may not do at a table) stands and this document is how a mission comes to be
known to the card room at all.

## 1. What this is

Game Night's missions are ORGANIZATIONS — Smart Agents with a `.org` name at a Home — that have
registered themselves in a registry the card room operates, so that any game (a club's night, or any
single table) can invite one as its guest. The registry is a **kit-built vertical registry** in the
sense of ADR-0038 / spec 279 / spec 346 §7 of the Agentic Primitives substrate: entries are facets of
the mission's own Smart Agent, admitted by a binding proof the mission's account signed, recorded on
chain in `AgentRegistryBase`, receipted and logged by a registry operator agent, and shown on a map.

It is NOT Gather27 (`~/engage`), and it touches nothing there. Gather27 was the worked example: a
host org registers at its Home, affirms a covenant, picks a place under a per-country ceiling, and is
listed. What Game Night keeps of it: the org-at-Home road, the affirmation, the place picker with
country ceilings, the map. What it drops: **the event.** A Gather27 listing is a dated gathering; a
Game Night mission is a standing presence — where it is and what it does — that a night invites.

## 2. The registry, formally

| | |
| --- | --- |
| Registry id | `urn:ap:registry:gamenight-missions` |
| Contract | `AgentRegistryBase` on faithchain 34348 — `0x0Be172F1b5cfD1d084CEc2cF2Af0A0cE9023Deb1` (`@agenticprimitives/contracts/deployments/faithchain`) |
| Controller / operator | `missions.registry` — a registry-typed service agent the house custodies (`house.faithchain.json → missionsRegistrySa`), provisioned by `pnpm provision:missions-registry`, which also executes `createRegistry(registryId, policy = 0x0)` from it. Open registry: the subject registers itself (RB-01); admission is the off-chain pipeline below, not an on-chain hook, so the policy can grow without a redeploy. |
| Entry id | `urn:ap:registry-entry:gamenight-missions/<org SA, lowercase>` — one entry per organization, ever |
| Subject | the mission's org SA; `msg.sender == subjectAgent` on `registerEntry`, executed by the org's own account, signed by its steward at their Home |
| Card | the agent-profile card `{ type: 'organization', displayName, description, url }` — `cardHash` |
| Claim slots | `urn:ap:registry-claim-slot:gamenight-missions/covenant` (attestation) · `…/presence` (string → the presence record's hash) |
| Lifecycle | `expiresAt` = one year; renew by running the same ceremony again; suspend / revoke by the operator; `expired` derived, never stored |
| Receipt | `RegistrationReceiptV1` signed by the operator (the house's session key, `scheme: 'session-key'`), stored beside the entry |
| Log | append-only, hash-chained `RegistryLifecycleEventV1` rows in the operator's own store (`MissionRegistryDO`) — a rebuild, never a bereavement |
| Profile | `RegistryKitProfile` published at `GET /missions/registry` so any consumer (or another registry) reads what this registry admits and how |

### 2.1 What a registration says

The **presence** (`MissionPresenceV1`, `packages/missions`):

```
name · blurb (≤ 600 chars) · website · languages[] ·
place { label, country (ISO-3166-1 α2), lat, lng, precise }
```

`place` is subject to the **country ceiling** ported from Gather27 (`packages/missions/src/ceilings.ts`):
a `none` country publishes no point at all (the mission is listed by name and country); an `adm2`
country publishes a point snapped to a ~110 km grid (the region — the card room keeps no district
boundaries); a `precise` country publishes the geocoded point unless the mission turned precision off,
in which case the point is snapped to a ~3 km grid. Applied at write time and again at read time
(`displayPoint`), so a ceiling change coarsens every registration on the next read. The exact point is
never served by the card room when it is not meant to be.

The **covenant** (`MissionCovenantAttestationV1`), three clauses the steward affirms and signs with
their own credential at the Home, bound to the org SA and the registry id:

1. This is a genuine mission organization and I am authorised to act for it.
2. People who reach us through a game night are contacted only about that night and what we told them
   we do — no list-building, no onward sharing.
3. Publishing where we are does not endanger anyone who works with us or comes to us.

The **contact** (an email for the card room's operators) is confidential: it goes into the org's own
vault (`cardroom.mission.contact`) and to the operator's store, and is never in a card, a claim, a
public read, or the map.

### 2.2 Where the records live

| Record | Where | Who writes it |
| --- | --- | --- |
| `cardroom.mission.presence` | the org's vault (`apctx:CardRoomMission`, `cr:Mission`) | the org's agent, at the Home, in the ceremony |
| `cardroom.mission.covenant` | the org's vault | same |
| `cardroom.mission.contact` | the org's vault | same |
| Entry (hashes, status, expiry) | `AgentRegistryBase` | the org SA, in the ceremony |
| Read grant `org → operator` on `vault:cardroom.mission.*` | the Home's delegation store | *phase 3* — the projection is rebuilt from the chain and the return legs until then |
| Projection (presence as published, coarse point, receipt, log) | `MissionRegistryDO` in the tables Worker | the registry operator, on the return leg |

The projection is what the map and the invitation pickers read. Losing it is a rebuild: walk the
contract's `RegistryEntryRegistered` events, read each org's presence under the grant, re-derive.

### 2.3 Admission (spec 346 §7.1, the checks this registry runs)

On the ceremony's return leg (`POST /missions/enrol`) the operator:

1. **derived-type** — resolves the subject's name; it must be an organization (`.org`, or a legacy root recorded as org).
2. **binding-proof** — recomputes `hashBindingProofBody` over what the entry says and compares it to the chain's `bindingProofHash`.
3. **entry** — `getEntry(registryId, entryId)`: exists, `subjectAgent` matches, `Active`, not expired.
4. **claim-slot: covenant** — the attestation's canonical message hashes to the claim; the signature verifies (ERC-1271 against the steward's SA, or the credential's EOA).
5. **claim-slot: presence** — the presence record the org's vault holds (read under the grant) hashes to the claim; shape-valid; the ceiling applied.
6. **delegation-live** — the read grant verifies and is not revoked (*phase 3*; `policy-skipped` until then).

Every line is in the receipt as `verified`, `failed`, or `notVerified` — "not verified" is an outcome,
never silently "verified". The receipt's `proof` is `scheme: 'session-key'`: the house session key under
the operator's wire (`MISSIONS_REGISTRY_WIRE`). The operator account's own `isValidSignature` does not
route that form, so a consumer verifies it the way the estate verifies any session-wrapped signature —
`verifySessionWrappedSignature` from `@agenticprimitives/a2a` (unwrap the wire, check it on chain, recover
the delegate over `receiptDigest`); `GET /missions/:id/receipt?verify=1` does exactly that and says so.

**Proven live 2026-09-14:** Elena registered "Hope for the City" — the Home created
`hope-for-the-city-….org`, she signed the covenant, the org signed its entry, the card room verified all
six mandatory lines (shape, claims, binding proof, the chain's entry, the covenant's signature, the
`.org` name) and receipted it; the receipt verifies on chain.

### 2.4 A mission steward's own door (2026-09-14)

A person registering a mission is not here to play, so they never see the card room's sign-in (play money,
a buy-in limit, a seat). `#/missions/new` is open to a visitor; its one trip is to their Home — sign in there
or make a Home on the way, choose or create the organization, sign the covenant, the organization signs its
entry — and `POST /missions/enrol` **signs them in as it admits the mission** (a session minted from the
ceremony's identity; no coach, no money account, no seat is set up, and the coach offer is not shown on the
missions' pages). The Home runs the registry step on both of its org-create paths (`withMissionRegistry`),
so a brand-new member's first organization is listed in the same trip. Proven live: a visitor, no session,
registered "Bread and Roses" as Dave and landed on its page signed in.

## 3. Inviting a mission

A mission is a **guest**, never a party to money (`docs/MISSION.md`): the invitation names it, shows
it, and gives its people a seat at the table's talk. Two places, every game:

- **A club's night.** `cardroom.club.schedule` gains `mission?: MissionRef` (the standing guest for the
  series) and a night's exception in `cardroom.club.nights` gains `mission?: MissionRef | null` (this
  night's guest, or none). `cr:ClubNight cr:guestMission cr:Mission`. The club page's schedule form and
  each night's row carry an "Invite a mission" picker over the registry.
- **A table.** `CreateTableRequest.mission?: string` (entry id); `TableSummary.mission?: MissionRef`.
  The table's top bar says who the guest is and links to its page; the lobby row shows it.

`MissionRef = { entryId, org, name }` — enough to show, and to look the rest up.

### 3.1 A night is an event; a mission's visit is its participation (2026-09-14)

In the card-room ontology a **club night is an `at:Event`** (`cr:ClubNight ⊑ at:Event ⊑ at:Activity`): a
scheduled, bounded occurrence with participants — produced by the series, or **added by hand as a one-time
night** (`cardroom.club.nights` → `oneOffs[one:<id>]`, `POST /clubs/:id/nights`). A night **hosts any number
of tables of its one game** (`cr:hostsTable`; `CreateTableRequest.night`, the table stamped with the night,
the night's game enforced, the night's guest the table's unless another is named).

A mission's presence at a night is a **`cr:MissionVisit ⊑ at:Participation`** — the reified "who, in what
role, with what status": `cr:visitingMission` (the `cr:Mission`), `cr:representedBy` (the individual attending
on its behalf — an `at:Person` by name, their agent when they have one, and how the host reaches them),
`cr:visitStatus` (invited · confirmed · declined · attended), a note. Kept per night in the club's own vault
(`cardroom.club.nights` → `visits[nightId]`; `null` = no guest tonight; absent = the series' standing guest as
an invited visit). A representative's email and phone are the host's to keep: `clubViewFor` strips them for
every other member. `PUT /clubs/:id/nights/:nightId/guest` takes the visit (`SetVisitRequest`).

## 4. Other registries

The projection reads ONE registry today. `MISSION_REGISTRIES` (env) may later name others — a
registry id + contract + chain — whose active entries are read by events and whose presence is read
from each subject's published card; entries from elsewhere show with their registry named, and are
invitable the same way. Nothing in §3 depends on which registry an entry came from.

## 5. Phases

1. **Registry** — `packages/missions`; `provision:missions-registry`; `MissionRegistryDO` + routes
   (`GET /missions`, `GET /missions/:id`, `GET /missions/registry`, `POST /missions/enrol`,
   `GET /geo/search`); the Home's org-create with `registry_entry`; the web's Missions map, register road and
   mission page; the rail row. *(done 2026-09-14)*
2. **Guests** — club schedule + nights, table creation, the pickers, the top-bar line, ontology terms. *(done
   2026-09-14: `PUT /clubs/:id/schedule/guest`, `PUT /clubs/:id/nights/:nightId/guest`, `CreateTableRequest.mission`,
   `MissionPicker`, `cr:guestMission` / `cr:standingGuest`, `apctx:CardRoomMission…`.)
3. **Operator** — suspend / revoke / renew, revalidation status, the ops list.
4. **Other registries** — §4.
