# Executor Invoke — a generic runtime primitive

**Status:** proposed 2026-10-03. A request to the Agentic Primitives runtime (`~/agenticprimitives/apps/demo-a2a`), written game-agnostic. It carries no `fieldops`, no Field Circles, no domain names. Field Rails ([FIELD-RAILS.md](FIELD-RAILS.md)) is the first consumer; it is not the subject.

**One line.** Let a persona's agent *perform a write* by calling a named executor over A2A `message/send`, as itself, **by declaration** — so a new write capability is a line of config, never a new hand-written tool in the runtime.

---

## 1 · The problem

Today the harness planner only acts through `HARNESS_ACTION_TOOLS` — a fixed, hand-written array of `ToolSpec`s — with a matching branch per tool in `harnessInvoker`. Every real write (Library save, Build run, GitHub PR, calendar event, a message) is a bespoke adapter. That is correct for a platform act with its own on-chain authority. It is **wrong** for "this agent should call that app the way a person using that app would": it forces a copy of the app's client into the runtime, one per app, forever. The two generic external tools (`external.agent.ask`, `engagement.agent.invoke`) do not fill the gap — they are **read-only** and cannot carry `metadata.skill`, so the receiver cannot tell which of its skills to run.

The missing piece is one neutral capability: **"call executor E's skill S as me, and hand me back its receipt."**

---

## 2 · What it is (and is not)

**It is** a single generic tool in the runtime that:
- reads an *invoke declaration* off the capability's own contract,
- resolves the named executor to a URL + client id through **operator config** (never a hardcoded host),
- obtains a session for the **run's principal** (self-acting),
- sends one JSON-RPC `message/send` carrying `metadata.skill`,
- records the applied capability + the executor's receipt in `run.provenance`.

**It is not** a module per app. It has no app's name in it. Any domain uses it by declaring an executor and an intent on its own skill; nothing in the runtime changes per domain. A domain's executor (its A2A service), its skills, and its verbs stay in the domain's own trees.

---

## 3 · The capability declaration (the contract)

A skill that performs a write declares, in its contract/frontmatter, an **invoke block** beside the capability it already declares:

```yaml
capability: <capability.id>            # e.g. a dotted id the skill advertises
selfAuthorized: true                   # the session is the authority; no mandate is minted
invoke:
  transport: a2a.message-send          # the only transport in v1
  executor: <executor-ref>             # a NAME resolved by operator config, never a URL
  intent: <skill id at the executor>   # becomes metadata.skill — which skill the executor runs
  args:                                 # how the capability's args map onto the message
    goal: <argName>                    # the free-text part (the "what happened, in my words")
    metadata: [<argName>, <argName>]   # args passed through as message metadata
resourceArg: <argName>                 # the record's subject (for the authority shape / provenance)
authorityArg: holder                   # self-acting ⇒ "holder" = the principal
risk: <R0..R4>
establishes: submission | authoritative | lookup
```

Rules:
- **`executor` is a reference, not a URL.** The compiler and the runtime both see only the name; the operator maps it. This is what keeps domains out of the substrate and hosts out of `packages/*`.
- **`selfAuthorized: true` is required for v1.** The write is to the principal's *own* domain (its records, authored by it), so the session is the authority and no `urn:ap:rar` mandate is minted. A cross-principal or value-moving invoke is **out of scope** for v1 (it would need a mandate and a different gate).
- The compiler emits this as an ordinary act tool whose `capability` object carries `{ action, resourceArg, authorityArg }`, plus the `invoke` block the runtime reads. A capability with an `invoke` block needs **no** row in the built-in capability profile.

---

## 4 · Executor resolution (operator config)

The operator registers each executor once, the way a connector is registered:

```
EXECUTORS = {
  "<executor-ref>": {
    url: "https://…",          // the executor's A2A base; its /a2a is the door
    client: "<oidc-client-id>" // the client the principal's session is minted for
  },
  …
}
```

- Resolution is **fail-closed**: an unknown `executor-ref` refuses the step ("no executor is configured for <ref>"), it does not guess.
- The URL and the client id live only here (and/or a connector registry). No domain module, no hardcoded host anywhere in `packages/*` or a skill.

---

## 5 · The principal and the session seam

The invoke runs as the **run's principal** — the agent whose run this is. **The principal is a real agent acting as itself.** The primitive has no notion of a "character," a "persona", a "player" or a "game": those are a *caller's* content. `naomi-elena.me` here is not a puppet — it is a real smart agent with its own vault and its own skills (attached by whatever archetype it was assigned), and this write is its own, exactly as it would be for an agent that was never in any game. What makes it "Naomi in a season" lives entirely in the caller (pokernight) that assigned the archetype and keeps score; the runtime, the invoke and the executor see only a real agent writing its own record.

Obtaining the session is the one genuinely new runtime concern.

The runtime needs a session (an id_token) for that principal, scoped to the executor's `client`. Obtain it through one injected seam:

```
session(principal, client) -> idToken | null
```

- **Production:** the principal's own credential mints the id_token (the same login the executor already accepts from a browser).
- **Demo estate:** `demo-signin { client_id: <client>, handle: <custodian>, as: <principal> }` — the custodian→principal map the host already holds. A demo shortcut, named as one.
- `null` ⇒ the step is **refused** (never a silent success). The caller treats a refused invoke as "not performed."

The runtime **presents the principal's session to the executor**; it never presents the operator's or the house's identity. "The write is the character's own" is enforced here.

---

## 6 · The call and the receipt

One request, the shape the executor already serves to its browser client:

```http
POST <executor.url>/a2a
Authorization: Bearer <idToken>
Content-Type: application/json

{ "jsonrpc":"2.0", "id":"<uuid>", "method":"message/send",
  "params": { "message": {
    "role":"user",
    "parts":[{ "kind":"text", "text": "<goal arg>" }],
    "metadata": { "skill":"<intent>", <mapped metadata args> }
  } } }
```

The executor validates (its own rules), performs the write in the principal's/subject's vault, and answers `{ result }` or `{ error:{ message, data } }`.

- On `result`: the tool returns `{ answer, receipt }`, where **`receipt`** carries whatever the executor returned that identifies the write — a store pointer, a record id, the subject it landed under. The receipt is opaque to the runtime; it is for the *caller* to verify.
- On `error` (or non-2xx): the tool **refuses** with the executor's own reason. No fallback.

---

## 7 · Provenance (why a caller can trust it)

The harness already writes `run.provenance` naming the tools a run applied. The generic invoke records, per applied step:

```
{ capability: "<capability.id>", executor: "<executor-ref>", intent: "<intent>", receipt: { … }, at: "<iso>" }
```

A caller that drives the agent (e.g. a game, a workflow) can then enforce **apply-iff-proof**: accept a result only when provenance names the expected capability as *applied* (a tool step, not planner prose) **and** the receipt is present (and, if it wants, re-reads the executor to confirm the record exists). This is the whole point: the runtime's word for "it happened" is a provenance entry plus a receipt, not a sentence the model wrote.

---

## 8 · Boundaries (what it must not become)

- **Writes to the principal's own domain only** (v1, `selfAuthorized`). Not cross-principal, not value-moving, not platform authority — those keep their bespoke, mandate-gated tools.
- **The executor is operator-vouched** (first-party, registered in §4), so this is not the read-only `external.agent.ask` lane and is not subject to `externalExecutorsReadOnly`. An *unregistered* executor is never reachable this way.
- **No generated code runs** in the runtime; the executor does its own work behind its own door.
- **No domain vocabulary** enters the runtime. The runtime sees `executor` + `intent` strings and a principal; it never learns what they mean.

---

## 9 · Where the pieces live

| Concern | Tree |
|---|---|
| The generic invoke tool + the `session` seam + executor resolution | `~/agenticprimitives/apps/demo-a2a` (the ONLY runtime change; neutral) |
| An executor (its A2A service) | the executor's own repo (e.g. `~/engage/apps/field-a2a`) |
| A skill's `invoke` declaration (executor-ref + intent) | the domain's skills (`~/skills/…`) |
| Operator config: executor-ref → url + client | deployment config / a connector registry |
| The caller's apply-iff-proof check | the caller (e.g. `~/pokernight`) |

---

## 10 · Acceptance

1. A skill declaring `invoke {executor, intent}` + `selfAuthorized` compiles to an act tool and is **offered** to the planner when the agent advertises the capability — with **no** new code in the runtime per capability.
2. A live run applies it: the runtime `message/send`s to the resolved executor as the principal, `metadata.skill = intent`; the executor's record lands with the principal as author; `run.provenance` names the capability, executor, intent and receipt.
3. An unknown `executor-ref` refuses, fail-closed. A null session refuses. An executor error refuses — never a silent success.
4. Removing the capability from the agent's playbook makes the planner answer `unknown_tool` for it — the capability, not the runtime, is the gate.
5. A second, unrelated executor (any domain) works by declaration alone, with the same tool and no further runtime change.

---

## 11 · v1 scope line

In: self-acting writes to the principal's own domain over A2A `message/send`, executor resolved by operator config, provenance + receipt. Out: mandate-gated / cross-principal / value-moving invokes, non-A2A transports, and anything that would teach the runtime a domain's vocabulary.
