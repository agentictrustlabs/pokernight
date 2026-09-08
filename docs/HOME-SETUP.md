# Home-side setup for Pokernight

Three changes live in the estate's Home (`~/agenticprimitives/apps/demo-sso-next`, deployed to Vercel as
www.faithnet.me), not in this repo. Only the Home's operator can apply them. Each is independent.

Verified state as of 2026-09-08:
- `pokernight` IS registered in the Home's **self-service** app registry (`POST /connect/apps`).
- `GET https://www.faithnet.me/connect/demo-personas` is open and returns 9 personas on faithchain 34348.
- `POST /connect/demo-signin` with `client_id: "pokernight"` returns
  `400 {"error":"a registered client_id is required"}`. The same call with `client_id: "demo-web"` succeeds.

## 1. Curate `pokernight` (unblocks demo users, and payments)

`demo-signin` and the privileged delegation templates both read the **curated** registry, which is static
config, not the self-service one. Static entries win and cannot be shadowed
(`apps/demo-sso-next/server/_lib/oidc-registry.ts`, `SELF_SERVICE_TEMPLATES = ['site-login','org-create']`).

Add to `relyingApps[]` in `apps/demo-sso-next/src/whitelabel/config.ts`:

```ts
{
  client_id: 'pokernight',
  name: 'Poker Night',
  redirect_uris: [
    'https://poker.faithnet.io/',
    'http://localhost:5173/',
  ],
  allowed_scopes: ['openid', 'agent'],
  // site-login signs a player in. The payment template is what lets a player authorise a buy-in
  // from their own treasury; reuse x402-pay, or add a poker-buyin entry beside it.
  allowed_delegation_templates: ['site-login', 'x402-pay'],
  delegate: '0x89D13c596c45E4eE80Af5ae06C727FE9A820ffD0',
}
```

Then redeploy the Home. This one change enables:
- the Home's demo users on the Pokernight sign-in page (`POST /connect/demo-signin` starts accepting us),
- `/connect/persona-sign`, so a demo person can sign a payment mandate with their real key,
- a curated payment template, so a real signed-in player can authorise a buy-in.

It also adds the localhost redirect, so sign-in works in local dev.

## 2. Optional: a Poker Site persona

To offer a "Poker Site" custodian in the demo roster the way Jordan Pike is offered, the operator sets the
`DEMO_PERSONA_KEYS` env var on the demo-sso-next Vercel project to the full JSON roster including the new
entry, then redeploys. The roster is read from that env var and cached by its raw string, so a deploy
alone changes nothing. There is no API and no script for this.

Note the house does NOT need a demo persona to function. Pokernight provisions its own Service Agent and
Treasury on faithchain, custodied by a key it holds (see `scripts/provision-house.mts`). The persona is
only for demonstrating the custodian relationship in the Home's UI.

## 3. Nothing else is required

Payments do not need `PaymentEscrow`: it is not deployed on faithchain, so settlement uses direct
mandate-authorised transfers between treasuries instead.
