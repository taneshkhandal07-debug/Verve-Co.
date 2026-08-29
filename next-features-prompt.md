# Implementation Task — Verve & Co. Agentic Checkout (Feature Additions Only)

## Context

You are extending an existing working prototype for a Razorpay buildathon submission
("AI Growth & Agentic Commerce" track). Two files already exist and are fully
functional:

1. `agentic-checkout-demo.jsx` — a React artifact: a glassmorphic console UI where
   a buyer agent and merchant agent (both calling the Claude API) transact against
   a 24-item catalog, pass through a client-side policy gate, and complete a
   simulated Razorpay test-mode payment (including one deliberate decline +
   automatic recovery). Visual identity: navy/blue Razorpay-brand surfaces for the
   payments rail, teal for the Verve & Co. merchant brand, glass panels throughout.
2. `razorpay-agent-server.js` — an Express backend showing the real (non-simulated)
   Razorpay test-mode integration: a server-side policy gate, `POST /agent/checkout`,
   a signature-verified `POST /webhook/razorpay`, and `GET /audit-log`.

## Hard constraints — read before touching anything

- **Do not modify the existing visual design, color palette, fonts, layout, or
  glassmorphism styling in any way.** No new colors, no restyled components, no
  spacing changes. If a new feature needs UI, style it using the *existing* design
  tokens already defined in the file (`--teal`, `--rzpBlue`, `--rzpNavy`, `--ink`,
  `--textHi`, `--textLo`, the `glass()` helper, the same fonts) so it looks like it
  was always part of the product.
- **Do not remove, rename, or restructure any existing function, component, route,
  or state variable.** Only add new ones, or extend existing ones additively
  (e.g. adding a new field to an existing object is fine; deleting or renaming a
  field is not).
- **Do not change the existing agent flow, catalog, upsell logic, or the simulated
  decline/recovery payment sequence.** All four features below should sit *around*
  that flow, not replace parts of it.
- **Do not touch the Razorpay test-mode simulation semantics** (fake order/payment
  IDs, the deliberate decline-then-recover sequence) — that stays as-is in the
  frontend; feature 2 below extends the *server* file, not this behavior.
- If a requirement below is ambiguous, choose the interpretation that requires the
  least change to existing code, and note the assumption in a code comment.

## Features to add, in this priority order

Implement them in order. If you run out of time/budget, stop after finishing as
many as you can fully — do not leave a feature half-wired into the existing flow.

### Priority 1 — AP2-style signed Mandate feeding the policy gate

Currently the policy gate (`RULES` array in the JSX, `evaluatePolicyGate()` in the
server file) checks a transaction against hard-coded merchant policy numbers only.
Add a lightweight **Mandate** object that represents the *human buyer's own signed
authorization*, modeled loosely on Google's AP2 Mandate concept:

- A Mandate object shape: `{ mandateId, buyerId, maxAmount, allowedCategories,
  validUntil, issuedAt, signature }`. The "signature" can be a simple HMAC/hash
  over the other fields for this demo — do not implement real cryptographic key
  management, just make the tamper-evidence concept visible and verifiable.
- Before the agent run starts, generate one Mandate (client-side in the JSX is
  fine) representing "the human authorized this session," and display it as a
  small glass card (reuse existing `glass()` styling) — e.g. near the controls bar
  — showing mandate ID, max amount, allowed categories, and a "signed" badge.
- Add a new rule to the gate: the transaction must fall within the Mandate's
  `maxAmount` and `allowedCategories`, **in addition to** all existing rules (do
  not remove any existing rule). Add a matching rule check server-side in
  `evaluatePolicyGate()` in `razorpay-agent-server.js`.
- In the ledger/audit trail, every `POLICY GATE` entry should now reference the
  Mandate ID it checked against, so the audit trail shows *whose authorization*
  the transaction was cleared under, not just which numeric rule passed.
- Update the existing "Why" reasoning text for the gate decision (already present
  in `runScenario()`) to mention the Mandate explicitly when relevant.

### Priority 2 — ACP-shaped catalog & checkout endpoint

Add real Agentic Commerce Protocol (ACP)–shaped surfaces to
`razorpay-agent-server.js` (new routes only — do not touch the existing
`/agent/checkout`, `/webhook/razorpay`, or `/audit-log` routes):

- `GET /.well-known/acp/config.json` — a static capability-declaration document
  describing what this merchant supports (checkout, cart, supported payment
  methods, catalog feed location), shaped after the public ACP spec at
  agenticcommerce.dev / github.com/agentic-commerce-protocol.
- `GET /acp/catalog` — expose the existing `CATALOG` array (mirror the one in the
  JSX; keep both in sync or import from a shared JSON file if convenient) in an
  ACP-style product feed shape (id, title, price, currency, category, availability).
- `POST /acp/checkout-sessions` and `POST /acp/checkout-sessions/:id/complete` —
  minimal implementations of the ACP checkout-session lifecycle (create a session
  from a cart, then complete it), internally reusing the *existing*
  `evaluatePolicyGate()` and Razorpay order-creation logic already in the file
  rather than duplicating that logic.
- Add a short code comment block at the top of these new routes explaining that
  this is what lets any ACP-compliant AI buyer (e.g. ChatGPT's Instant Checkout)
  transact with this merchant without custom integration — this is documentation,
  not a UI change.

### Priority 3 — Escalation approval UI (closes the loop on the existing ESCALATED state)

The gate already produces an `ESCALATED` status in `runScenario()` in the JSX, but
nothing currently happens with it beyond a short pause. Add:

- When the gate result is `ESCALATED`, pause the flow (state flag, e.g.
  `awaitingApproval: true`) and render a glass card (again, reuse existing
  `glass()` + `Stamp`/amber-escalated styling already defined) showing the order
  details with **Approve** / **Deny** buttons standing in for a human reviewer.
- On Approve, resume `runScenario()` exactly where it left off (proceed to order
  creation). On Deny, log a `BLOCKED — human denied` ledger entry and end the run
  gracefully, the same way the existing `BLOCKED` path already does.
- No other part of the escalation logic (the threshold, the rule evaluation)
  should change — this is purely adding a human checkpoint UI on top of the
  existing `ESCALATED` branch.

### Priority 4 — Revenue attribution counter

Add a small, persistent (for the session — no backend storage needed) counter
that tracks, across multiple runs of `runScenario()` in the same session:

- Number of upsell offers made, number accepted, resulting incremental revenue
  (sum of accepted upsell prices), and take rate (%).
- Display this as one compact glass card, styled consistently with the existing
  receipt card, positioned near it — do not redesign the layout grid.
- Reset this counter only when the user explicitly resets it (add a small reset
  control next to it) — it should **not** reset on the existing `reset()` function
  used between demo runs, since the point is to show cumulative impact across
  multiple runs.

## Deliverable format

Return the two full updated files (`agentic-checkout-demo.jsx` and
`razorpay-agent-server.js`), plus any new supporting file you introduce (e.g. a
shared `catalog.json` if you choose that route for Priority 2). Do not return
diffs or partial snippets — return complete, ready-to-run files. Before finishing,
verify the JSX still compiles (no syntax errors) and the server file still starts
without errors, exactly as before these changes.
