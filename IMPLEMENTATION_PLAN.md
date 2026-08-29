# Verve & Co. — Implementation Plan

## Razorpay AI Buildathon — Track 01: AI Growth & Agentic Commerce

### Purpose

This document is the implementation handoff for turning the existing Verve & Co. agentic checkout prototype into a polished, fully functional website suitable for deployment and Razorpay buildathon judging.

The implementation is additive.

The existing frontend and backend already contain the core agent-to-agent checkout experience, catalog, upsell flow, policy gate, audit trail, Razorpay test-mode simulation, and deliberate decline/recovery sequence.

**The existing working code must remain present. Do not rewrite the project into a different product.**

---

# 1. Primary Product Objective

The finished system must convincingly demonstrate:

> An AI buyer can transact with a merchant through a bounded, explainable and auditable agentic-commerce flow, while a merchant-side agent can increase order value through a controlled upsell.

The demo must visibly connect:

```text
Human intent
→ Buyer Agent
→ Merchant Agent
→ Buyer Authorization
→ Canonical Catalog / Pricing
→ Policy Gate
→ Human Escalation when required
→ Razorpay Test Mode
→ One Graceful Payment Failure
→ Bounded Recovery
→ Receipt
→ Audit Trail
→ Revenue Attribution
```

---

# 2. HARD CONSTRAINTS — MUST FOLLOW

## 2.1 Preserve all existing functionality

Do not remove or break:

- existing buyer-agent behavior,
- existing merchant-agent behavior,
- existing catalog,
- existing upsell catalog,
- existing preset scenarios,
- existing transcript,
- existing visible reasoning,
- existing policy rules,
- existing policy-gate sequence,
- existing audit ledger,
- existing receipt,
- existing Razorpay test-mode simulation,
- existing deliberate decline,
- existing automatic recovery sequence,
- existing reset behavior except where explicitly extended,
- existing server routes.

The existing user journey should still work after every implementation phase.

---

## 2.2 Preserve the existing visual design

Do not change:

- color palette,
- typography,
- glassmorphism treatment,
- card style,
- layout grid,
- spacing system,
- Razorpay navy/blue surfaces,
- Verve & Co. teal identity,
- existing status colors,
- existing animations,
- overall visual hierarchy.

New UI must use the existing design tokens and `glass()` helper.

No new design system should be introduced.

---

## 2.3 Add features; do not replace architecture without need

Use additive components, state, utilities and routes.

It is acceptable to:

- add a new field to an existing object,
- add a new helper,
- add a new component,
- add a new server route,
- extend an existing policy context,
- centralize duplicated constants.

Do not casually delete, rename or restructure working functions.

---

# 3. PRE-IMPLEMENTATION FOUNDATION FIXES

These are mandatory because they close correctness gaps in the current prototype.

They should be treated as prerequisites to the feature work.

---

## 3.1 Create a canonical catalog source

### Current problem

The frontend contains the full 24-item catalog, including prices and stock.

The backend does not currently use the same canonical catalog to independently calculate checkout totals.

### Required behavior

Create one authoritative merchant catalog source that can be safely imported by the backend and reused by the ACP feed.

Preferred structure:

```text
shared/catalog.json
```

or an equivalent shared JavaScript module if the deployment/runtime supports it cleanly.

The canonical catalog must include:

```text
id
name/title
price
currency
category
stock
availability
```

Do not change existing product IDs, names, prices or stock numbers.

### Why

ACP-style commerce requires the merchant to remain authoritative for pricing and inventory.

The buyer/client should submit product identifiers and quantities; the merchant should calculate the actual amounts.

---

## 3.2 Make the server authoritative for price calculation

### Current weakness

The existing backend `/agent/checkout` accepts a client-supplied `subtotal`.

A modified client could theoretically lie about the amount.

### Required behavior

The server should derive:

```text
product IDs + quantities
        ↓
canonical catalog lookup
        ↓
canonical prices
        ↓
subtotal calculation
        ↓
upsell validation
        ↓
final total
```

The server should not trust a client-provided subtotal as the source of truth.

The UI may continue displaying totals as before.

---

## 3.3 Add quantity and stock validation

For every cart line:

```text
quantity >= 1
quantity <= available stock
```

Reject:

- unknown product IDs,
- invalid quantities,
- zero/negative quantities,
- quantities above stock.

This check must happen before order creation.

The frontend can continue showing stock exactly as it does today.

---

## 3.4 Unify frontend/backend policy definitions

### Current mismatch

Frontend allowed categories:

```text
audio
home
accessories
wearables
stationery
outdoor
tech
food
kitchen
```

Backend currently permits only a subset.

This means frontend and backend can disagree on whether a transaction is valid.

### Required behavior

Use one canonical policy source or otherwise guarantee exact parity.

The effective policy should remain:

```text
budget
merchant hard cap = ₹6,000
allowed categories
max one upsell
upsell <= 20% of subtotal
escalation threshold = ₹5,000
```

Do not weaken any existing rule.

---

## 3.5 Keep deterministic policy enforcement outside the LLM

The AI can recommend.

The AI cannot grant itself permission.

Keep all money-moving authorization checks deterministic code.

The expected pattern is:

```text
LLM decision
   ↓
deterministic validation
   ↓
policy gate
   ↓
approval/escalation
   ↓
Razorpay
```

This is one of the most important architecture principles in the project.

---

# 4. PRIORITY 1 — AP2-INSPIRED BUYER AUTHORIZATION

## Goal

Represent the human buyer's authorization as an explicit signed object that constrains autonomous purchasing.

This should strengthen the "bounded + gated" story.

---

## 4.1 Terminology

Use:

> **AP2-inspired Buyer Authorization Mandate**

Do not claim full AP2 compliance unless the exact AP2 version/schema is implemented and validated.

AP2 itself defines distinct mandate concepts and deterministic verification responsibilities. The demo should use the concept without falsely claiming protocol conformance.

---

## 4.2 Mandate shape

Minimum demo object:

```js
{
  mandateId,
  buyerId,
  sessionId,
  maxAmount,
  allowedCategories,
  validUntil,
  issuedAt,
  signature
}
```

Adding `sessionId` is recommended so the authorization is bound to the current shopping session.

---

## 4.3 Signature

For a buildathon demo:

- HMAC/hash-based signing is acceptable.
- No real key management is required.
- The signature must cover the other mandate fields.
- Verification must be deterministic.

The UI should make the tamper-evidence concept visible.

Do not describe a simple demo HMAC as production cryptographic authorization.

---

## 4.4 Mandate generation

Before the agent session starts:

```text
create session
→ issue mandate
→ show mandate
→ run buyer agent
```

The mandate should represent:

> "The human authorized this agent session within these bounds."

Suggested data shown in the card:

```text
MANDATE
ID: MND-XXXXXX
Buyer: BUYER-01
Max: ₹2,000
Categories: audio · home
Status: SIGNED
Valid until: HH:MM
```

Use the existing glass style.

---

## 4.5 Mandate policy rule

Add a new deterministic rule:

```text
transaction total <= mandate.maxAmount
```

and:

```text
all purchased item categories ∈ mandate.allowedCategories
```

Both are mandatory.

Do not replace existing merchant policies.

The final gate should effectively enforce:

```text
existing merchant policy
+
buyer mandate
```

---

## 4.6 Server-side mandate verification

The backend must verify:

- signature,
- expiry,
- session binding,
- maximum amount,
- categories.

The client should not be the final authority.

The strongest architecture is:

```text
Frontend displays mandate
        ↓
Frontend sends mandate
        ↓
Server verifies mandate
        ↓
Server recalculates cart
        ↓
Server evaluates policies
        ↓
Razorpay only after approval
```

---

## 4.7 Audit trail integration

Every `POLICY GATE` ledger event must identify the mandate.

Example concept:

```text
POLICY GATE
GATE DECISION: APPROVED

total ₹1,548
rules passed 7/7
mandate MND-71A2 checked
```

The backend audit entry must also preserve the mandate ID.

---

## 4.8 Reasoning integration

Existing "Why" reasoning should mention the mandate.

Examples:

```text
All merchant rules passed and the transaction remains within the buyer's signed mandate.
```

or:

```text
Blocked because the transaction exceeds the buyer's signed mandate amount.
```

The exact prose can vary, but the mandate should be explicitly visible in the explanation.

---

# 5. PRIORITY 2 — ACP-SHAPED / ACP-COMPATIBLE CHECKOUT SURFACE

## Goal

Make the merchant programmatically understandable and transact-able by an AI buyer.

ACP is the right protocol direction for this.

Do not invent a custom protocol and call it ACP-compliant.

---

## 5.1 Follow the targeted ACP version

Before implementation, confirm the ACP schema/version being targeted.

Current ACP documentation describes a checkout-session lifecycle with REST endpoints including:

```text
POST /checkout_sessions
GET  /checkout_sessions/{id}
POST /checkout_sessions/{id}
POST /checkout_sessions/{id}/complete
POST /checkout_sessions/{id}/cancel
```

and authoritative merchant-controlled pricing/inventory.

Therefore, the implementation should either:

1. implement the current ACP paths/schema directly, or
2. clearly expose a namespaced adapter such as `/acp/...` while documenting that it is an ACP-shaped adapter rather than native protocol conformance.

Preferred approach for this buildathon:

```text
canonical merchant API/state
        ↓
ACP-compatible adapter
        ↓
existing policy / Razorpay payment engine
```

---

## 5.2 Capability declaration

Add:

```text
GET /.well-known/acp/config.json
```

It should declare merchant capabilities such as:

- checkout supported,
- cart support,
- currency INR,
- supported payment method(s),
- catalog feed location,
- any supported interventions/extensions used by the demo.

Do not claim unsupported features.

---

## 5.3 Agent-readable catalog endpoint

Add:

```text
GET /acp/catalog
```

The feed should expose canonical merchant data:

```text
id
title
price
currency
category
availability
```

Do not maintain a second hard-coded set of prices if a shared source is available.

---

## 5.4 Checkout-session lifecycle

Implement the appropriate ACP-shaped/current-version session lifecycle.

Minimum conceptual states:

```text
not_ready_for_payment
ready_for_payment
requires_escalation / pending_approval
in_progress
completed
canceled
```

The exact status names should follow the targeted ACP version where applicable.

---

## 5.5 Create session

The create route should:

1. authenticate the caller,
2. validate payload,
3. resolve canonical products,
4. validate quantities,
5. calculate price,
6. validate availability,
7. store session state,
8. return authoritative checkout state.

The server remains the merchant source of truth.

---

## 5.6 Retrieve session

Add the ability for an AI buyer to retrieve current session state.

This is important because the merchant must be able to return authoritative current pricing/checkout state.

---

## 5.7 Update session

Support additive/update semantics as required by the targeted ACP schema.

Whenever cart state changes:

```text
recalculate totals
revalidate stock
revalidate mandate
revalidate policy
return current state
```

Do not assume an old total remains valid after cart mutation.

---

## 5.8 Complete session

The complete operation must reuse the same core logic as the existing checkout path.

Do not duplicate policy logic.

Preferred architecture:

```text
ACP complete
       ↓
canonical checkout/session state
       ↓
shared policy evaluation
       ↓
human approval if required
       ↓
Razorpay order creation
       ↓
payment
       ↓
final state
```

---

## 5.9 Cancellation

Add a cancel path.

A canceled/expired session must not later create a payment.

---

## 5.10 Authentication

ACP requests should be authenticated.

Use an environment-configured bearer/token mechanism for the demo.

Do not hard-code secrets.

---

## 5.11 Idempotency

Implement idempotent order/session operations where money creation can be retried.

At minimum:

```text
Idempotency-Key
```

should prevent accidental duplicate order creation for repeated requests.

This turns a current "production hardening note" into a visible safety property.

---

# 6. PRIORITY 3 — HUMAN ESCALATION APPROVAL UI

## Goal

Turn the current `ESCALATED` pause into a real human checkpoint.

---

## 6.1 Current issue

The frontend currently recognizes escalation but simply delays and continues.

That does not actually represent human oversight.

---

## 6.2 New state

Add a state such as:

```text
awaitingApproval
```

The exact variable name may differ, but it must be clear and isolated.

---

## 6.3 Escalation flow

Required:

```text
Policy Gate
    ↓
ESCALATED
    ↓
AWAITING HUMAN APPROVAL
    ↓
Approve / Deny
```

---

## 6.4 Approval card

Add a glass card showing:

- escalation status,
- order/cart items,
- total,
- mandate ID,
- failed/triggered rule reason,
- buyer budget,
- merchant threshold,
- Approve button,
- Deny button.

Use existing `Stamp` / escalated amber styling.

Do not introduce a different design language.

---

## 6.5 Approve behavior

On approval:

```text
human approval logged
→ resume transaction
→ create order
→ continue existing payment sequence
```

No duplicate transaction.

Do not restart the complete agent scenario.

Resume from the escalation point.

---

## 6.6 Deny behavior

On denial:

```text
human denial logged
→ BLOCKED
→ stop flow
→ no Razorpay order created
→ run ends gracefully
```

Add a clear ledger event such as:

```text
HUMAN REVIEW
BLOCKED — HUMAN DENIED
```

---

## 6.7 Fix final transaction state

Do not leave the completed payment labeled `ESCALATED`.

Recommended state model:

```text
ESCALATED
    ↓
HUMAN_APPROVED
    ↓
PAYMENT
    ↓
PAID
```

The escalation remains visible in the audit trail, but the final receipt should accurately reflect the final financial outcome.

---

# 7. PRIORITY 4 — REVENUE ATTRIBUTION

## Goal

Prove that the merchant agent is not merely "chatting" — it can increase merchant revenue.

---

## 7.1 Session-persistent metrics

Track across repeated demo runs:

```text
upsellOffers
upsellsAccepted
realizedUpsellRevenue
```

Also calculate:

```text
takeRate = accepted / offers * 100
```

---

## 7.2 Important accounting rule

Only count **realized** incremental revenue.

Do not count an upsell as revenue merely because:

- it was offered,
- the buyer accepted,
- the cart contained it.

Count it after the transaction is successfully captured/completed.

Examples:

```text
offered + accepted + payment captured
    → count revenue
```

```text
offered + accepted + gate blocked
    → do not count revenue
```

```text
offered + accepted + payment failed permanently
    → do not count revenue
```

---

## 7.3 UI card

Add one compact glass card near the receipt.

Suggested metrics:

```text
UPSELL PERFORMANCE

Offers        8
Accepted      5
Take rate     62.5%
Incremental   ₹443
```

Do not redesign the existing grid.

---

## 7.4 Reset behavior

The revenue counter must NOT reset when the existing run reset is used.

The existing `reset()` should continue resetting the current demo state.

Revenue analytics should have its own explicit reset control.

Only an explicit user action resets cumulative revenue metrics.

---

## 7.5 Optional additional metric

Recommended:

```text
Incremental revenue / completed order
```

This helps explain merchant impact.

Use only if it fits the existing layout without redesign.

---

# 8. CLAUDE API ARCHITECTURE

## Current issue

The current React source invokes the Anthropic API from the browser.

This is not appropriate for a public production-style deployment if it requires exposing a secret.

---

## Required target architecture

Move model calls behind the server:

```text
Browser
   ↓
Merchant backend
   ↓
Claude API
```

The browser must never contain the Anthropic secret.

---

## Preserve current AI behavior

Do not replace the prompts or agent roles unless required.

The buyer agent should continue selecting products.

The merchant agent should continue selecting an upsell.

The buyer agent should continue evaluating upsell acceptance.

The visible "Why" output should remain.

---

# 9. SHARED CORE SERVICES

To avoid frontend/backend logic drift, create small shared/core helpers where appropriate.

Recommended conceptual services:

```text
catalogService
policyService
mandateService
checkoutSessionService
auditService
razorpayService
```

Do not create an over-engineered framework.

Keep the project simple enough to understand during a buildathon demo.

---

# 10. RECOMMENDED TRANSACTION OBJECT

Use a consistent transaction/session shape internally.

Conceptually:

```js
{
  sessionId,
  buyerId,
  mandateId,
  items,
  subtotal,
  upsell,
  total,
  budget,
  policyResult,
  humanApproval,
  razorpayOrderId,
  paymentId,
  paymentStatus,
  finalStatus
}
```

This makes audit/debugging much easier.

---

# 11. AUDIT TRAIL REQUIREMENTS

The ledger should make this sequence obvious:

```text
SESSION STARTED
↓
CATALOG QUERY + SELECTION
↓
UPSELL OFFER
↓
UPSELL DECISION
↓
POLICY GATE
↓
HUMAN REVIEW (when escalated)
↓
ORDER CREATED
↓
PAYMENT ATTEMPT — DECLINED
↓
RECOVERY ACTION
↓
PAYMENT CAPTURED
```

Every important event should carry enough identifiers to correlate it to:

- session,
- mandate,
- order,
- payment where available.

---

# 12. FAILURE HANDLING

## Keep the existing deliberate failure

Do not remove the existing:

```text
Payment attempt #1
→ DECLINED
→ backup method
→ retry
→ CAPTURED
```

This is one of the strongest direct matches to the buildathon requirement for one gracefully handled failure.

---

## Keep retry bounded

Maximum:

```text
1 automatic retry
```

No infinite retry loops.

No amount increase during retry.

No new upsell during retry.

No silent policy bypass.

The same approved cart/order context should be reused.

---

# 13. FRONTEND STATE MACHINE

The eventual frontend should conceptually support:

```text
IDLE
  ↓
RUNNING
  ↓
CATALOG_SELECTION
  ↓
UPSELL_OFFER
  ↓
UPSELL_DECISION
  ↓
POLICY_EVALUATION
  ├── BLOCKED → DONE
  ├── ESCALATED → AWAITING_APPROVAL
  │                   ├── DENIED → DONE
  │                   └── APPROVED
  ↓
ORDER_CREATED
  ↓
PAYMENT_ATTEMPT_1
  ↓
DECLINED
  ↓
RECOVERY
  ↓
PAYMENT_CAPTURED
  ↓
DONE
```

The existing user experience should still feel like the same application.

---

# 14. TEST SCENARIOS

A complete implementation must be tested with at least these scenarios.

## Scenario A — Normal autonomous checkout

Expected:

```text
selection
→ upsell
→ mandate passes
→ policy passes
→ order created
→ decline
→ retry
→ captured
→ revenue attributed
```

---

## Scenario B — Budget violation

Force a total above buyer budget.

Expected:

```text
BLOCKED
```

No order.

---

## Scenario C — Mandate amount violation

Use a mandate with a lower `maxAmount`.

Expected:

```text
BLOCKED
```

The audit trail names the mandate.

No order.

---

## Scenario D — Mandate category violation

Use a mandate that excludes one selected category.

Expected:

```text
BLOCKED
```

No order.

---

## Scenario E — Merchant hard cap violation

Transaction > ₹6,000.

Expected:

```text
BLOCKED
```

---

## Scenario F — Escalation

Transaction passes all ordinary rules but exceeds ₹5,000 and is within hard cap.

Expected:

```text
ESCALATED
→ visible approval card
```

Then test both:

```text
Approve → order/payment continues
Deny    → blocked, no order
```

---

## Scenario G — Stock violation

Request quantity above stock.

Expected:

```text
checkout/session rejected
```

No order.

---

## Scenario H — Payment decline/recovery

Use existing deliberate failure.

Expected:

```text
DECLINED
→ RECOVERY
→ CAPTURED
```

---

## Scenario I — Permanent payment failure

For a negative test, ensure a permanently failed payment does not count as revenue.

---

## Scenario J — Duplicate request / idempotency

Send the same checkout completion request twice with the same idempotency key.

Expected:

```text
one financial action
```

not two orders.

---

## Scenario K — Tampered mandate

Modify one signed field without updating signature.

Expected:

```text
mandate verification failure
→ BLOCKED
```

---

# 15. ACP TESTING

Validate:

```text
/.well-known/acp/config.json
/acp/catalog
checkout session create
checkout session retrieve
checkout session update
checkout session complete
checkout session cancel
```

Check that responses:

- are valid JSON,
- contain authoritative prices,
- contain current session state,
- use the targeted ACP schema/version consistently,
- reject unauthenticated requests,
- respect idempotency,
- never bypass the normal policy gate.

Do not publish "ACP compliant" wording unless validation supports it.

---

# 16. SECURITY REQUIREMENTS

Never expose in browser code:

```text
ANTHROPIC_API_KEY
RAZORPAY_KEY_SECRET
RAZORPAY_WEBHOOK_SECRET
ACP bearer secrets
```

Public values such as a Razorpay publishable/test key ID may be exposed where required.

Webhook verification must remain server-side.

Razorpay webhook signatures must remain verified.

---

# 17. VERCEL / DEPLOYMENT ARCHITECTURE

Important:

A Vercel-hosted React frontend does not automatically make a standalone Express backend deployable by simply putting both files in the same static page.

Use one of:

```text
Option A
Vercel frontend
+
Vercel/Node API backend

Option B
Vercel frontend
+
separate HTTPS Express backend
```

The exact hosting choice can remain simple, but the browser must have a stable HTTPS API target.

---

## Environment variables

Recommended conceptual variables:

```text
ANTHROPIC_API_KEY
RAZORPAY_KEY_ID
RAZORPAY_KEY_SECRET
RAZORPAY_WEBHOOK_SECRET
ACP_API_TOKEN
FRONTEND_ORIGIN
PORT
```

Use the exact naming that the implementation adopts.

Never commit secrets.

---

# 18. DEPLOYMENT CHECKLIST

Before the final buildathon submission:

```text
[ ] Frontend builds successfully
[ ] Backend starts successfully
[ ] No browser console fatal errors
[ ] No server startup errors
[ ] Claude requests work through server
[ ] Catalog loads
[ ] Buyer agent works
[ ] Merchant agent works
[ ] Upsell works
[ ] Mandate displays
[ ] Mandate verifies
[ ] Policy gate includes mandate
[ ] Escalation UI works
[ ] Approve works
[ ] Deny works
[ ] Razorpay test-mode order path works
[ ] Webhook verification works
[ ] Failure/recovery works
[ ] Revenue metrics work
[ ] Revenue survives demo reset
[ ] Explicit revenue reset works
[ ] ACP capability route works
[ ] ACP catalog route works
[ ] ACP session lifecycle works
[ ] Idempotency works
[ ] Stock validation works
[ ] Server calculates totals
[ ] Frontend/backend policy parity confirmed
[ ] Secrets are not exposed
[ ] Production URLs use HTTPS
[ ] README updated
```

---

# 19. BUILDATHON DEMO REQUIREMENTS

The final website should be optimized for judges, not just for technical completeness.

The first screen should communicate:

```text
AI buyer
+
merchant agent
+
bounded payment
+
Razorpay
```

The demo should make these visible without requiring code inspection:

### Revenue
The merchant agent made an upsell.

### Authorization
A signed mandate constrained what the AI could do.

### Safety
The deterministic gate evaluated the transaction.

### Human control
A high-value transaction stopped for approval.

### Payments
Razorpay test mode processed the order.

### Failure handling
One payment failed and recovered.

### Evidence
The audit ledger proves the sequence.

---

# 20. RECOMMENDED PITCH FLOW

Suggested five-minute narrative:

## 0:00–0:30 — Problem

Normal AI shopping agents can recommend products, but the hard problem is letting them transact without giving them uncontrolled authority over money.

## 0:30–1:15 — Agentic purchase

Enter a natural-language shopping goal.

Buyer Agent selects from the merchant's machine-readable catalog.

## 1:15–2:00 — Merchant growth

Merchant Agent offers one bounded upsell.

Buyer Agent decides whether to accept.

Show revenue/upsell attribution.

## 2:00–2:45 — Authorization + policy

Show the buyer mandate.

Show deterministic policy evaluation.

Explain:

```text
AI decides what to buy.
Policy decides whether it is allowed.
```

## 2:45–3:30 — Human escalation

Demonstrate a >₹5,000 transaction.

Show:

```text
ESCALATED
```

Approve it.

## 3:30–4:15 — Razorpay + failure

Create order.

Show deliberate decline.

Show one bounded recovery.

Show successful capture.

## 4:15–5:00 — Evidence

Show audit trail and explain:

- mandate,
- policy,
- human approval,
- Razorpay transaction,
- recovery,
- incremental merchant revenue.

---

# 21. IMPLEMENTATION ORDER

Use this exact order so incomplete features do not leave the project in a half-working state.

### Phase 0 — Foundation
1. Canonical catalog.
2. Canonical policy.
3. Server-side amount calculation.
4. Stock validation.
5. Frontend/backend parity.

### Phase 1 — Mandate
6. Mandate creation.
7. Mandate display.
8. Deterministic signature verification.
9. Mandate policy rules.
10. Audit linkage.
11. Reasoning linkage.

### Phase 2 — Human escalation
12. Awaiting-approval state.
13. Approval card.
14. Approve path.
15. Deny path.
16. Final-state correction.
17. Audit events.

### Phase 3 — ACP
18. Capability declaration.
19. Canonical ACP catalog.
20. Session creation.
21. Session retrieval.
22. Session update.
23. Session completion.
24. Session cancellation.
25. Authentication.
26. Idempotency.
27. Reuse shared policy/payment logic.

### Phase 4 — Revenue
28. Offer counter.
29. Acceptance counter.
30. Take rate.
31. Realized incremental revenue.
32. Explicit reset.
33. Optional revenue/order metric.

### Phase 5 — Security/deployment
34. Move Claude calls server-side.
35. Configure secrets.
36. Deploy backend.
37. Deploy Vercel frontend.
38. Configure HTTPS API URL.
39. Configure Razorpay webhook.
40. Validate all end-to-end scenarios.

---

# 22. IMPLEMENTATION RULE FOR ANTI-GRAVITY

Anti-Gravity should be treated as an implementation agent, not a redesign agent.

Use this instruction throughout development:

> **Preserve the existing application exactly as the foundation. Implement the requested capabilities additively. Do not rewrite the existing product, remove existing functions, replace the catalog, alter the visual identity, or change the existing buyer/merchant flow unless a specific correctness or security fix in this implementation plan requires it.**

For every change, ask:

```text
Does this add the requested capability?
Does this preserve the existing demo?
Does this strengthen the money-safety story?
Does this remain deterministic where money authorization is concerned?
```

If the answer to any is "no", stop and reconsider the change.

---

# 23. Definition of Done

The project is complete only when all of these are true:

### Product
- Existing experience still works.
- New features feel native to the existing UI.
- Website is usable without developer intervention.

### Agentic commerce
- Buyer agent can shop.
- Merchant agent can upsell.
- Merchant is machine-readable.
- Checkout can be driven by a programmatic buyer surface.

### Safety
- Mandate is visible and verifiable.
- Merchant policies remain deterministic.
- Prices/inventory are server authoritative.
- Escalation requires actual human approval.
- Payment retry is bounded.
- Duplicate payment creation is prevented.

### Payments
- Razorpay test mode remains integrated.
- Webhook verification remains active.
- Final financial state is accurate.

### Evidence
- Audit trail contains session/mandate/order/payment context.
- Revenue metrics show actual realized upsell revenue.

### Deployment
- Website deploys cleanly.
- Backend is reachable over HTTPS.
- Secrets remain server-side.
- No fatal runtime errors.

---

# 24. Important Final Constraint

**Do not sacrifice the existing working core for protocol polish.**

The winning version of this project is not the one with the most endpoints or most code.

It is the version where a judge can watch one transaction and immediately understand:

> **The AI can sell, but it cannot spend outside the buyer's authorization or the merchant's rules. When risk increases, a human can take over. When a payment fails, the system recovers within a defined bound. And the audit trail proves what happened.**

That should remain the central product philosophy.
