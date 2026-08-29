# Verve & Co. — Agentic Checkout Console

## Razorpay AI Buildathon — Track 01: AI Growth & Agentic Commerce

Verve & Co. is an agentic commerce prototype designed around Razorpay test-mode payments. The project demonstrates a buyer agent and merchant agent collaborating on a purchase while deterministic policy controls, visible reasoning, an audit trail, and bounded payment recovery keep every money action explainable and constrained.

The buildathon target is **Track 01 — AI Growth & Agentic Commerce**: grow merchant revenue and/or make the merchant transactable by an AI buyer. Razorpay's stated bar emphasizes money actions that are **explainable, bounded, and gated**, with an **audit trail** and **one failure handled gracefully**.

> **Important handoff constraint:** The existing frontend and backend are already functional prototypes. Future implementation must preserve the existing product flow, catalog, styling, visual identity, and working demo behavior. New capabilities are additive unless a change is explicitly required to close a correctness/security gap identified in the implementation plan.

---

## 1. Current Project Goal

The current prototype demonstrates this core flow:

```text
Human shopping intent
        ↓
Buyer Agent
        ↓
Agent-readable merchant catalog
        ↓
Merchant Agent
        ↓
Upsell / cross-sell proposal
        ↓
Deterministic policy gate
        ↓
Razorpay test-mode payment simulation
        ↓
Intentional payment decline
        ↓
Bounded automatic recovery
        ↓
Successful capture
        ↓
Visible receipt + audit ledger
```

The next implementation phase will extend this flow with buyer authorization, ACP-shaped interoperability, real human escalation handling, stronger server-side trust boundaries, and merchant revenue attribution.

---

## 2. Files That Already Exist

### `agentic-checkout-demo.jsx`

This is the main React artifact / website UI.

It currently contains:

- Verve & Co. merchant branding.
- Razorpay test-mode branding and payment surfaces.
- Glassmorphism UI.
- A 24-item agent-readable catalog.
- Four preset shopping scenarios.
- Free-text shopping goal input.
- Buyer budget input.
- Buyer-agent product selection using Claude.
- Merchant-agent upsell selection using Claude.
- Buyer-agent upsell acceptance decision.
- Deterministic frontend policy rules.
- Visible "Why" reasoning text.
- Agent-to-agent transcript.
- Visual policy-gate status.
- Audit ledger.
- Simulated Razorpay order creation.
- One deliberate payment decline.
- One bounded retry with a backup test instrument.
- Successful simulated payment capture.
- Receipt card.

The catalog and current policy definitions are visible in the source. The existing 24-item catalog is `p1` through `p24`, and the frontend allowlist intentionally excludes the `kids` category. The current UI uses Verve teal for the merchant identity and Razorpay navy/blue for payment infrastructure. Do not redesign these choices.

### `razorpay-agent-server.js`

This is the Express backend / Razorpay integration layer.

It currently contains:

- Razorpay test-mode SDK setup.
- Server-side policy gate.
- Merchant hard cap.
- Escalation threshold.
- Allowed-category rules.
- Upsell count and value limits.
- `POST /agent/checkout`.
- `POST /webhook/razorpay`.
- `GET /audit-log`.
- Razorpay test-mode order creation.
- Webhook signature verification.
- In-memory append-only audit log for the demo.

The current backend intentionally keeps the policy gate ahead of Razorpay order creation.

---

## 3. Current Catalog

The frontend currently exposes 24 products:

| ID | Product | Price | Category | Stock |
|---|---|---:|---|---:|
| p1 | Wireless Earbuds Pro | ₹1,499 | audio | 14 |
| p2 | Scented Candle Trio | ₹399 | home | 32 |
| p3 | Leather Wallet | ₹899 | accessories | 20 |
| p4 | Smartwatch Lite | ₹2,999 | wearables | 8 |
| p5 | Ceramic Mug Set | ₹549 | home | 25 |
| p6 | Bluetooth Speaker Mini | ₹1,299 | audio | 11 |
| p7 | Silk Scarf | ₹749 | accessories | 18 |
| p8 | Desk Organizer | ₹429 | stationery | 22 |
| p9 | Insulated Water Bottle | ₹599 | outdoor | 27 |
| p10 | Aromatherapy Diffuser | ₹899 | home | 15 |
| p11 | Fitness Tracker Band | ₹1,799 | wearables | 12 |
| p12 | Leather Journal | ₹349 | stationery | 30 |
| p13 | Portable Phone Stand | ₹249 | tech | 40 |
| p14 | Woollen Beanie | ₹399 | accessories | 24 |
| p15 | Gourmet Chocolate Box | ₹599 | food | 20 |
| p16 | Herbal Tea Sampler | ₹449 | food | 26 |
| p17 | Classic Sunglasses | ₹1,199 | accessories | 16 |
| p18 | Mini Succulent Planter | ₹299 | home | 35 |
| p19 | Travel Neck Pillow | ₹549 | outdoor | 19 |
| p20 | Wireless Charging Pad | ₹999 | tech | 21 |
| p21 | Cotton Throw Blanket | ₹1,299 | home | 14 |
| p22 | Leather Keychain | ₹199 | accessories | 44 |
| p23 | Bamboo Cutlery Set | ₹349 | kitchen | 28 |
| p24 | Kids Puzzle Set | ₹449 | kids | 17 |

The existing frontend allowlist is:

```text
audio, home, accessories, wearables, stationery,
outdoor, tech, food, kitchen
```

`kids` is intentionally excluded from autonomous purchasing and exists as a guardrail demonstration.

---

## 4. Current Upsell Catalog

The frontend currently defines:

| ID | Upsell | Price |
|---|---|---:|
| u1 | Premium Gift Box | ₹149 |
| u2 | Handwritten Card | ₹49 |
| u3 | Express Wrap & Ribbon | ₹99 |
| u4 | Personalised Gift Tag | ₹39 |
| u5 | Scented Sachet | ₹59 |

Current merchant policy permits at most one upsell, and an upsell cannot exceed 20% of cart subtotal.

---

## 5. Current Policy Model

The frontend currently evaluates:

1. Order total is within stated buyer budget.
2. Order total is under the ₹6,000 merchant hard cap.
3. All items are in allowed categories.
4. At most one upsell is offered.
5. Upsell price is no more than 20% of cart subtotal.

The current escalation threshold is ₹5,000.

Conceptually:

```text
if any deterministic rule fails
    → BLOCKED

else if total > ₹5,000
    → ESCALATED

else
    → APPROVED
```

The backend has the same broad policy concept, but its current allowed-category list is narrower than the frontend list. This mismatch must be removed in the next implementation phase.

---

## 6. Existing Visual Identity — Must Preserve

The current product intentionally separates:

### Verve & Co.
- Teal merchant identity.
- Merchant-facing accents.
- Glass cards and merchant-agent surfaces.

### Razorpay
- Navy + dodger blue payment-rail identity.
- Test-mode badge.
- Policy-gate / payment infrastructure surfaces.
- Razorpay audit entries.

### Typography
- Space Grotesk for display.
- IBM Plex Mono for ledger / data.
- Inter for body copy.

### UI treatment
- Glassmorphism.
- Deep navy background.
- Existing ambient blue/teal glow.
- Existing status colors.
- Existing card spacing and layout.

**Do not replace, restyle, or modernize this visual system during feature implementation.**

---

## 7. Existing Money-Safety Story

The current product already demonstrates:

### Explainable
Agent actions have visible reasoning.

### Bounded
The system enforces:
- buyer budget,
- merchant hard cap,
- category allowlist,
- upsell count,
- upsell value cap,
- bounded payment retry.

### Gated
The policy engine evaluates the transaction before order creation.

### Auditable
Every meaningful action is added to the visible ledger.

### Graceful failure
The demo intentionally declines payment once and recovers using one bounded retry.

This should remain the backbone of the experience.

---

## 8. Current Backend Route Surface

### Existing

```text
POST /agent/checkout
POST /webhook/razorpay
GET  /audit-log
```

These existing routes are part of the current functional prototype and should not be removed, renamed, or casually restructured.

### Planned additive routes

```text
GET  /.well-known/acp/config.json
GET  /acp/catalog
POST /acp/checkout-sessions
GET  /acp/checkout-sessions/:id
POST /acp/checkout-sessions/:id
POST /acp/checkout-sessions/:id/complete
POST /acp/checkout-sessions/:id/cancel
```

The exact external ACP surface should follow the current ACP specification/version being targeted rather than claiming protocol compliance for a merely similar custom API.

---

## 9. Target Product Story After the Next Implementation Phase

The finished experience should communicate:

```text
Human intent
   ↓
Buyer Agent
   ↓
Merchant Agent
   ↓
Signed buyer authorization
   ↓
Canonical merchant catalog + price/inventory validation
   ↓
Deterministic policy gate
   ↓
        ┌───────────────┐
        │ > threshold?  │
        └───────┬───────┘
                ↓ yes
        Human approval
          ↙           ↘
      Approve          Deny
        ↓               ↓
     payment          blocked
        ↓
Razorpay test mode
        ↓
failure
        ↓
one bounded recovery
        ↓
success
        ↓
receipt + audit trail
        ↓
merchant revenue attribution
```

---

## 10. Deployment Target

The intended production/demo deployment is:

```text
Frontend / website → Vercel
Backend API        → separately deployed HTTPS server/API
Razorpay           → Test Mode
Claude             → server-side API call
```

The React website should not require a browser-exposed secret for the Claude API.

Environment secrets should stay server-side.

The final Vercel deployment must communicate with an HTTPS backend through environment-configured API URLs.

---

## 11. README Scope

This README describes the starting point and intended architecture. It is deliberately not a replacement for the implementation plan.

See:

**`IMPLEMENTATION_PLAN.md`**

for the exact additive feature work, safety constraints, protocol considerations, testing checklist, deployment requirements, and non-negotiable preservation rules.

---

## 12. Buildathon Alignment

Razorpay Track 01 is explicitly about:

- AI Growth & Agentic Commerce.
- Growing merchant revenue.
- Making merchants sellable to AI buyers.
- Razorpay test-mode APIs.
- Agent-readable commerce.
- Upsell / cross-sell.
- Explainable, bounded and gated money actions.
- Auditability.
- Graceful failure handling.

This project is intentionally built to demonstrate both sides:

1. **Merchant growth:** autonomous but bounded upsell.
2. **AI-buyability:** agent-readable catalog + protocol-shaped checkout surface.

The final demo should make these two outcomes immediately visible.

---

## 13. Important Terminology

The implementation should use careful protocol language.

Preferred:

- **AP2-inspired buyer authorization mandate**
- **ACP-shaped checkout adapter**
- **ACP-compatible surface** when the implementation actually follows the targeted schema/version.

Avoid claiming:

- "fully AP2 compliant"
- "fully ACP compliant"

unless the implementation has been explicitly validated against the exact protocol version and schema.

---

## 14. Current Source Files

```text
verve-agentic-commerce/
├── agentic-checkout-demo.jsx
├── razorpay-agent-server.js
├── README.md
└── IMPLEMENTATION_PLAN.md
```

Optional future supporting files may include:

```text
catalog.json
policy.json
shared/
server/
api/
```

but additions should only be made where they reduce duplication and improve correctness without unnecessarily restructuring the existing prototype.

---

## 15. Non-Negotiable Preservation Rule

The existing demo is the foundation, not a throwaway prototype.

**Do not replace the existing flow with a completely different application.**

The goal is:

> **existing working product + carefully integrated safety/protocol/revenue capabilities**

not:

> **rewrite the entire project from scratch.**
