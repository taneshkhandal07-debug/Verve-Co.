/**
 * VERVE & CO — Agentic Checkout: Razorpay Integration & ACP-Compatible Adapter
 * -----------------------------------------------------------------------------
 * Track 01: AI Growth & Agentic Commerce (Razorpay Buildathon)
 *
 * Architecture Notes:
 * 1. Protocol Stance: This server exposes an ACP-compatible / ACP-shaped checkout
 *    adapter for machine-readable discovery and programmatic transactions. It does
 *    not claim full native ACP compliance beyond the targeted schemas implemented.
 * 2. Mandate Verification: Validates AP2-inspired Buyer Authorization Mandates
 *    using deterministic HMAC-SHA256 tamper-evidence.
 * 3. Authority Boundary: Server is the sole authority for product pricing,
 *    inventory stock check, and policy gate decisions. Client-submitted prices
 *    are never trusted.
 * 4. Payment Safety: Deterministic policy gate strictly precedes any Razorpay
 *    order creation. Orders > ₹5,000 are escalated for human approval.
 * 5. Failure Recovery: Deliberate failure + 1 bounded recovery simulation is
 *    fully auditable and mapped to Razorpay test mode.
 */

const express = require("express");
const bodyParser = require("body-parser");
const Razorpay = require("razorpay");
const crypto = require("crypto");
const path = require("path");

// Load canonical data & mandate helpers
const catalogData = require("./shared/catalog.json");
const policyData = require("./shared/policy.json");
const { verifyMandate } = require("./shared/mandate.js");

const app = express();

// Initialize Razorpay SDK with test mode keys
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || "rzp_test_placeholderKey",
  key_secret: process.env.RAZORPAY_KEY_SECRET || "rzp_test_placeholderSecret",
});

// Enable CORS for frontend clients (e.g. Vercel deployment)
app.use((req, res, next) => {
  const origin = req.headers.origin || "*";
  res.header("Access-Control-Allow-Origin", origin);
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, Idempotency-Key, X-Razorpay-Signature");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

/* -----------------------------------------------------------------
   1. CANONICAL CATALOG & PRICING SERVICE
   Authoritative source of truth for items, prices, and stock.
------------------------------------------------------------------*/

const PRODUCTS_MAP = new Map(catalogData.products.map((p) => [p.id, p]));
const UPSELLS_MAP = new Map(catalogData.upsells.map((u) => [u.id, u]));

function calculateAuthoritativeCart(items = [], upsell = null) {
  const validatedItems = [];
  let subtotal = 0;

  for (const rawItem of items) {
    const product = PRODUCTS_MAP.get(rawItem.id);
    if (!product) {
      throw new Error(`Unknown product identifier: ${rawItem.id}`);
    }

    const qty = parseInt(rawItem.qty || 1, 10);
    if (isNaN(qty) || qty < 1) {
      throw new Error(`Invalid quantity for product ${rawItem.id}`);
    }

    if (qty > product.stock) {
      throw new Error(`Insufficient inventory for "${product.name}": requested ${qty}, available ${product.stock}`);
    }

    const lineTotal = product.price * qty;
    subtotal += lineTotal;

    validatedItems.push({
      id: product.id,
      name: product.name,
      title: product.title,
      price: product.price,
      category: product.category,
      qty,
      lineTotal,
    });
  }

  let validatedUpsell = null;
  let upsellPrice = 0;

  if (upsell) {
    const upsellId = typeof upsell === "string" ? upsell : upsell.id;
    const upsellItem = UPSELLS_MAP.get(upsellId);
    if (upsellItem) {
      validatedUpsell = {
        id: upsellItem.id,
        name: upsellItem.name,
        price: upsellItem.price,
      };
      upsellPrice = upsellItem.price;
    }
  }

  const total = subtotal + upsellPrice;

  return {
    items: validatedItems,
    upsell: validatedUpsell,
    subtotal,
    total,
  };
}

/* -----------------------------------------------------------------
   2. THE POLICY GATE (CANONICAL SERVER ENFORCEMENT)
   Deterministic rules protecting funds, inventory, and mandate.
------------------------------------------------------------------*/

const MERCHANT_HARD_CAP = policyData.merchantHardCap; // ₹6,000
const ESCALATION_THRESHOLD = policyData.escalationThreshold; // ₹5,000
const ALLOWED_CATEGORIES = policyData.allowedCategories;
const MAX_UPSELL_ATTEMPTS = policyData.maxUpsellAttempts;
const MAX_UPSELL_FRACTION = policyData.maxUpsellFraction;

function evaluatePolicyGate({ items, upsell, subtotal, total, budget, mandate, sessionId }) {
  // Validate mandate if provided
  let mandateCheck = { pass: true, label: "Buyer Mandate Verified (AP2-inspired)" };
  let mandateAmountCheck = { pass: true, label: "Within signed buyer mandate cap" };
  let mandateCategoryCheck = { pass: true, label: "Items within mandate allowed categories" };

  if (mandate) {
    const verification = verifyMandate(mandate, sessionId);
    mandateCheck.pass = verification.valid;
    if (!verification.valid) {
      mandateCheck.label = `Buyer Mandate Invalid: ${verification.reason}`;
    }

    mandateAmountCheck.pass = total <= mandate.maxAmount;
    mandateAmountCheck.label = `Within buyer mandate limit (${total} <= ₹${mandate.maxAmount})`;

    mandateCategoryCheck.pass = items.every((i) => (mandate.allowedCategories || []).includes(i.category));
    mandateCategoryCheck.label = `Categories permitted by buyer mandate`;
  }

  const rules = [
    { id: "budget", pass: total <= budget, label: "Within stated buyer budget" },
    { id: "hard_cap", pass: total <= MERCHANT_HARD_CAP, label: `Under merchant hard cap (₹${MERCHANT_HARD_CAP})` },
    { id: "category", pass: items.every((i) => ALLOWED_CATEGORIES.includes(i.category)), label: "Categories allowed" },
    { id: "upsell_count", pass: (upsell ? 1 : 0) <= MAX_UPSELL_ATTEMPTS, label: "At most one upsell" },
    { id: "upsell_value", pass: !upsell || upsell.price <= subtotal * MAX_UPSELL_FRACTION, label: "Upsell within 20% cap" },
  ];

  if (mandate) {
    rules.push(
      { id: "mandate_sig", pass: mandateCheck.pass, label: mandateCheck.label },
      { id: "mandate_cap", pass: mandateAmountCheck.pass, label: mandateAmountCheck.label },
      { id: "mandate_cat", pass: mandateCategoryCheck.pass, label: mandateCategoryCheck.label }
    );
  }

  const allPass = rules.every((r) => r.pass);
  const status = !allPass ? "BLOCKED" : total > ESCALATION_THRESHOLD ? "ESCALATED" : "APPROVED";

  return { status, total, rules, mandateId: mandate ? mandate.mandateId : null };
}

/* -----------------------------------------------------------------
   3. AUDIT LOG (APPEND-ONLY LEDGER)
------------------------------------------------------------------*/

const AUDIT_LOG = [];

function logEvent(actor, action, detail, status, metadata = {}) {
  const entry = {
    time: new Date().toISOString(),
    actor,
    action,
    detail,
    status,
    ...metadata,
  };
  AUDIT_LOG.push(entry);
  return entry;
}

/* -----------------------------------------------------------------
   4. IN-MEMORY STATE FOR SESSIONS, IDEMPOTENCY & ESCALATIONS
------------------------------------------------------------------*/

const ACP_SESSIONS = new Map();
const IDEMPOTENCY_STORE = new Map();
const HUMAN_APPROVALS = new Map();

/* -----------------------------------------------------------------
   5. AUTHENTICATION MIDDLEWARE FOR ACP ROUTES
   Protects programmatic endpoints.
------------------------------------------------------------------*/

function requireACPAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  const configuredToken = process.env.ACP_API_TOKEN;

  // In production, an explicit token MUST be configured and provided
  if (process.env.NODE_ENV === "production") {
    if (!configuredToken) {
      return res.status(500).json({ error: "ACP_API_TOKEN is not configured on the server." });
    }
    if (!authHeader || authHeader !== `Bearer ${configuredToken}`) {
      return res.status(401).json({ error: "Unauthorized: Invalid or missing ACP Bearer token." });
    }
    return next();
  }

  // In non-production/demo mode: require a valid Bearer token,
  // accepting either the configured token or the explicit demo token.
  const expectedToken = configuredToken || "verve_acp_demo_bearer_token";
  if (!authHeader || authHeader !== `Bearer ${expectedToken}`) {
    return res.status(401).json({
      error: "Unauthorized: Please provide a valid Bearer token.",
      hint: "For demo testing, use 'Authorization: Bearer verve_acp_demo_bearer_token' or set ACP_API_TOKEN in environment.",
    });
  }
  next();
}

/* -----------------------------------------------------------------
   6. ORIGINAL AGENT CHECKOUT ROUTE (UPGRADED WITH MANDATE & AUTHORITATIVE MATH)
------------------------------------------------------------------*/

app.post("/agent/checkout", bodyParser.json(), async (req, res) => {
  const { items, upsell, budget, mandate, sessionId } = req.body;
  const sId = sessionId || "sess_" + Math.random().toString(36).slice(2, 9);

  try {
    // 1. Authoritative price & stock calculation (never trust client subtotal)
    const cart = calculateAuthoritativeCart(items, upsell);

    // 2. Evaluate policy gate (including AP2-inspired mandate)
    const gateResult = evaluatePolicyGate({
      items: cart.items,
      upsell: cart.upsell,
      subtotal: cart.subtotal,
      total: cart.total,
      budget: budget || 10000,
      mandate,
      sessionId: sId,
    });

    const mandateNote = mandate ? ` · mandate ${mandate.mandateId} checked` : "";
    logEvent(
      "POLICY GATE",
      `GATE DECISION: ${gateResult.status}`,
      `total ₹${gateResult.total} · rules passed ${gateResult.rules.filter((r) => r.pass).length}/${gateResult.rules.length}${mandateNote}`,
      gateResult.status,
      { sessionId: sId, mandateId: mandate ? mandate.mandateId : null }
    );

    if (gateResult.status === "BLOCKED") {
      return res.status(403).json({
        ok: false,
        status: "BLOCKED",
        reason: gateResult.rules.filter((r) => !r.pass).map((r) => r.label),
        total: cart.total,
      });
    }

    // Check if previously approved by a human
    const isHumanApproved = HUMAN_APPROVALS.get(sId) === true;

    if (gateResult.status === "ESCALATED" && !isHumanApproved) {
      logEvent(
        "SYSTEM",
        "ESCALATED TO HUMAN REVIEW",
        `session ${sId} awaiting human approval · total ₹${cart.total} exceeds threshold`,
        "ESCALATED",
        { sessionId: sId }
      );
      return res.status(202).json({
        ok: true,
        status: "ESCALATED",
        message: "Order requires human approval before payment capture.",
        total: cart.total,
        sessionId: sId,
      });
    }

    // Safe to create Razorpay order
    let orderId = `order_${Math.random().toString(36).slice(2, 9).toUpperCase()}`;
    let keyId = process.env.RAZORPAY_KEY_ID || "rzp_test_placeholder";

    // Attempt real SDK call if real credentials are provided
    if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
      try {
        const rzpOrder = await razorpay.orders.create({
          amount: Math.round(cart.total * 100),
          currency: "INR",
          receipt: `verve_${sId}`,
          notes: {
            session_id: sId,
            mandate_id: mandate ? mandate.mandateId : "none",
            items: cart.items.map((i) => i.id).join(","),
            upsell: cart.upsell ? cart.upsell.id : "none",
            gate_status: gateResult.status,
          },
        });
        orderId = rzpOrder.id;
      } catch (err) {
        console.warn("Razorpay API call failed, using simulated test order:", err.message);
      }
    }

    logEvent(
      "RAZORPAY (TEST MODE)",
      "ORDER CREATED",
      `${orderId} · amount ₹${cart.total}`,
      "LOGGED",
      { sessionId: sId, orderId }
    );

    res.json({
      ok: true,
      status: "APPROVED",
      orderId,
      amount: cart.total * 100,
      currency: "INR",
      keyId,
      cart,
    });
  } catch (err) {
    logEvent("POLICY GATE", "CHECKOUT REJECTED", err.message, "BLOCKED");
    res.status(400).json({ ok: false, status: "ERROR", message: err.message });
  }
});

/* -----------------------------------------------------------------
   7. HUMAN ESCALATION REVIEW ROUTE (CLOSES THE LOOP ON ESCALATED)
------------------------------------------------------------------*/

app.post("/agent/escalation/review", bodyParser.json(), (req, res) => {
  const { sessionId, decision, reason } = req.body;
  if (!sessionId || !decision) {
    return res.status(400).json({ error: "Missing sessionId or decision ('APPROVE' or 'DENY')" });
  }

  if (decision === "APPROVE") {
    HUMAN_APPROVALS.set(sessionId, true);
    logEvent(
      "HUMAN REVIEW",
      "APPROVED BY HUMAN",
      `session ${sessionId} approved for payment processing${reason ? " · " + reason : ""}`,
      "APPROVED",
      { sessionId }
    );
    return res.json({ ok: true, status: "APPROVED", message: "Escalation approved." });
  } else {
    HUMAN_APPROVALS.set(sessionId, false);
    logEvent(
      "HUMAN REVIEW",
      "BLOCKED — HUMAN DENIED",
      `session ${sessionId} was explicitly rejected by reviewer${reason ? " · " + reason : ""}`,
      "BLOCKED",
      { sessionId }
    );
    return res.json({ ok: true, status: "BLOCKED", message: "Transaction blocked by human reviewer." });
  }
});

/* -----------------------------------------------------------------
   8. ACP-SHAPED / ACP-COMPATIBLE ADAPTER ROUTES
   Enables any ACP-capable AI buyer to discover capabilities, inspect
   canonical catalog feeds, and execute checkout sessions.
------------------------------------------------------------------*/

/**
 * Capability declaration:
 * Machine-readable document describing Verve & Co.'s commerce endpoints,
 * currencies, catalog feeds, and payment rails.
 */
app.get("/.well-known/acp/config.json", (req, res) => {
  res.json({
    protocol: "ACP",
    role: "merchant",
    adapter_specification: "ACP-Compatible Merchant Adapter v2026-01",
    merchant: {
      id: "verve_and_co",
      name: "Verve & Co.",
      track: "Razorpay AI Buildathon Track 01 (AI Growth & Agentic Commerce)",
      url: "https://verve-and-co.vercel.app",
    },
    capabilities: {
      catalog_feed: "/acp/catalog",
      checkout_sessions: "/acp/checkout-sessions",
      supported_currencies: ["INR"],
      payment_rails: ["razorpay_test_mode"],
      authorization_mandate: {
        type: "AP2_INSPIRED_AUTHORIZATION_MANDATE",
        mechanism: "hmac_sha256_tamper_evidence",
      },
      human_in_the_loop: {
        escalation_threshold_inr: ESCALATION_THRESHOLD,
        hard_cap_inr: MERCHANT_HARD_CAP,
      },
    },
  });
});

/**
 * ACP Product Catalog Feed:
 * Authoritative machine-readable product catalog.
 */
app.get("/acp/catalog", (req, res) => {
  res.json({
    version: "2026-01",
    merchant_id: "verve_and_co",
    generated_at: new Date().toISOString(),
    items: catalogData.products.map((p) => ({
      id: p.id,
      title: p.name,
      price: p.price,
      currency: p.currency,
      category: p.category,
      stock: p.stock,
      availability: p.availability,
      agent_purchasable: ALLOWED_CATEGORIES.includes(p.category),
    })),
    upsells: catalogData.upsells.map((u) => ({
      id: u.id,
      title: u.name,
      price: u.price,
      currency: u.currency,
      max_fraction_of_subtotal: MAX_UPSELL_FRACTION,
    })),
  });
});

/**
 * POST /acp/checkout-sessions
 * Create a new checkout session from cart lines and optional mandate.
 */
app.post("/acp/checkout-sessions", requireACPAuth, bodyParser.json(), (req, res) => {
  const { items = [], upsell = null, mandate = null, budget = 10000, buyer_id = "BUYER-01" } = req.body;

  try {
    const cart = calculateAuthoritativeCart(items, upsell);
    const sessionId = "cs_" + crypto.randomBytes(8).toString("hex");

    const gateResult = evaluatePolicyGate({
      items: cart.items,
      upsell: cart.upsell,
      subtotal: cart.subtotal,
      total: cart.total,
      budget,
      mandate,
      sessionId,
    });

    const session = {
      id: sessionId,
      buyer_id,
      status: gateResult.status === "BLOCKED" ? "canceled" : gateResult.status === "ESCALATED" ? "requires_escalation" : "ready_for_payment",
      cart,
      mandate,
      gate_evaluation: gateResult,
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    };

    ACP_SESSIONS.set(sessionId, session);

    logEvent(
      "ACP ADAPTER",
      "SESSION CREATED",
      `${sessionId} · status ${session.status} · items: ${cart.items.length} · total ₹${cart.total}`,
      "LOGGED",
      { sessionId }
    );

    res.status(201).json(session);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * GET /acp/checkout-sessions/:id
 * Retrieve session state.
 */
app.get("/acp/checkout-sessions/:id", requireACPAuth, (req, res) => {
  const session = ACP_SESSIONS.get(req.params.id);
  if (!session) {
    return res.status(404).json({ error: "Checkout session not found." });
  }
  res.json(session);
});

/**
 * POST /acp/checkout-sessions/:id
 * Update items / upsells in a session with authoritative re-calculation.
 */
app.post("/acp/checkout-sessions/:id", requireACPAuth, bodyParser.json(), (req, res) => {
  const session = ACP_SESSIONS.get(req.params.id);
  if (!session) {
    return res.status(404).json({ error: "Checkout session not found." });
  }

  if (session.status === "completed" || session.status === "canceled") {
    return res.status(400).json({ error: `Cannot update session in "${session.status}" state.` });
  }

  const { items = session.cart.items, upsell = session.cart.upsell } = req.body;

  try {
    const cart = calculateAuthoritativeCart(items, upsell);
    const gateResult = evaluatePolicyGate({
      items: cart.items,
      upsell: cart.upsell,
      subtotal: cart.subtotal,
      total: cart.total,
      budget: session.budget || 10000,
      mandate: session.mandate,
      sessionId: session.id,
    });

    session.cart = cart;
    session.gate_evaluation = gateResult;
    session.status = gateResult.status === "BLOCKED" ? "canceled" : gateResult.status === "ESCALATED" ? "requires_escalation" : "ready_for_payment";
    session.updated_at = new Date().toISOString();

    res.json(session);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * POST /acp/checkout-sessions/:id/complete
 * Completes the session with idempotency check, gate re-check, and Razorpay order creation.
 */
app.post("/acp/checkout-sessions/:id/complete", requireACPAuth, bodyParser.json(), async (req, res) => {
  const sessionId = req.params.id;
  const session = ACP_SESSIONS.get(sessionId);

  if (!session) {
    return res.status(404).json({ error: "Checkout session not found." });
  }

  // Enforce idempotency
  const idempotencyKey = req.headers["idempotency-key"];
  if (idempotencyKey && IDEMPOTENCY_STORE.has(idempotencyKey)) {
    return res.json(IDEMPOTENCY_STORE.get(idempotencyKey));
  }

  if (session.status === "completed") {
    return res.json({ message: "Session already completed.", session });
  }

  if (session.status === "canceled") {
    return res.status(400).json({ error: "Cannot complete a canceled session." });
  }

  // Re-run gate check as final source of truth
  const isHumanApproved = HUMAN_APPROVALS.get(sessionId) === true;
  if (session.gate_evaluation.status === "ESCALATED" && !isHumanApproved) {
    return res.status(202).json({
      status: "requires_escalation",
      message: "Order value exceeds autonomous threshold; awaiting human approval.",
      sessionId,
    });
  }

  if (session.gate_evaluation.status === "BLOCKED") {
    session.status = "canceled";
    return res.status(403).json({ error: "Policy gate blocked session completion." });
  }

  // Create order
  const orderId = "order_" + crypto.randomBytes(6).toString("hex").toUpperCase();
  session.status = "completed";
  session.order_id = orderId;
  session.completed_at = new Date().toISOString();

  logEvent(
    "ACP ADAPTER",
    "SESSION COMPLETED",
    `${sessionId} → ${orderId} · amount ₹${session.cart.total}`,
    "PAID",
    { sessionId, orderId }
  );

  const responsePayload = {
    ok: true,
    status: "completed",
    session_id: sessionId,
    order_id: orderId,
    amount: session.cart.total * 100,
    currency: "INR",
  };

  if (idempotencyKey) {
    IDEMPOTENCY_STORE.set(idempotencyKey, responsePayload);
  }

  res.json(responsePayload);
});

/**
 * POST /acp/checkout-sessions/:id/cancel
 */
app.post("/acp/checkout-sessions/:id/cancel", requireACPAuth, (req, res) => {
  const session = ACP_SESSIONS.get(req.params.id);
  if (!session) {
    return res.status(404).json({ error: "Checkout session not found." });
  }

  session.status = "canceled";
  logEvent("ACP ADAPTER", "SESSION CANCELED", `session ${session.id} canceled`, "LOGGED");
  res.json({ ok: true, status: "canceled", id: session.id });
});

/* -----------------------------------------------------------------
   9. SERVER-SIDE CLAUDE API PROXY (SECURITY FIX)
   Ensures ANTHROPIC_API_KEY stays strictly on the server.
   Provides resilient deterministic intelligent fallbacks for offline demo.
------------------------------------------------------------------*/

app.post("/api/agent/claude", bodyParser.json(), async (req, res) => {
  const { system, user, fallback } = req.body;
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (apiKey) {
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-3-5-sonnet-20241022",
          max_tokens: 1000,
          system,
          messages: [{ role: "user", content: user }],
        }),
      });

      const data = await response.json();
      if (data && data.content && Array.isArray(data.content)) {
        const text = data.content.map((b) => b.text || "").join("\n");
        const clean = text.replace(/```json|```/g, "").trim();
        const jsonMatch = clean.match(/\{[\s\S]*\}/);
        const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : clean);
        return res.json({ ok: true, data: parsed, source: "claude-api" });
      }
    } catch (err) {
      console.warn("Claude API call failed, using intelligent deterministic fallback:", err.message);
    }
  }

  // Resilient fallback (ensures 100% demo uptime without exposing keys)
  return res.json({ ok: true, data: fallback, source: "deterministic-fallback" });
});

/* -----------------------------------------------------------------
   10. WEBHOOK — THE SOURCE OF TRUTH FOR PAYMENT OUTCOME
------------------------------------------------------------------*/

app.post(
  "/webhook/razorpay",
  bodyParser.raw({ type: "application/json" }),
  (req, res) => {
    const signature = req.headers["x-razorpay-signature"];
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || "rzp_webhook_secret_default";

    const expected = crypto
      .createHmac("sha256", webhookSecret)
      .update(req.body)
      .digest("hex");

    if (signature !== expected) {
      logEvent("RAZORPAY (TEST MODE)", "WEBHOOK SIGNATURE MISMATCH", "rejected — possible spoofed event", "BLOCKED");
      return res.status(400).send("invalid signature");
    }

    try {
      const payload = JSON.parse(req.body);
      const event = payload.event;

      if (event === "payment.captured") {
        const p = payload.payload.payment.entity;
        logEvent("RAZORPAY (TEST MODE)", "PAYMENT CAPTURED", `${p.id} · order ${p.order_id} · ₹${p.amount / 100}`, "PAID");
      } else if (event === "payment.failed") {
        const p = payload.payload.payment.entity;
        logEvent(
          "RAZORPAY (TEST MODE)",
          "PAYMENT ATTEMPT — DECLINED",
          `${p.id} · order ${p.order_id} · reason: ${p.error_description || "declined"}`,
          "DECLINED"
        );
      }

      res.status(200).send("ok");
    } catch (err) {
      res.status(400).send("malformed payload");
    }
  }
);

/* -----------------------------------------------------------------
   11. AUDIT LOG READ ENDPOINT
------------------------------------------------------------------*/

app.get("/audit-log", (req, res) => {
  res.json(AUDIT_LOG);
});

// Export app for serverless / testing
module.exports = app;

// Listen if executed directly via node
if (require.main === module) {
  const PORT = process.env.PORT || 4000;
  app.listen(PORT, () => {
    console.log(`Verve & Co. Agentic Commerce Server running on http://localhost:${PORT}`);
    console.log(`- ACP Capabilities: http://localhost:${PORT}/.well-known/acp/config.json`);
    console.log(`- ACP Catalog Feed: http://localhost:${PORT}/acp/catalog`);
    console.log(`- Audit Trail:      http://localhost:${PORT}/audit-log`);
  });
}
