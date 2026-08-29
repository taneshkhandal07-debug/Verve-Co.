/**
 * Automated Verification Script for Verve & Co.
 * Tests all routes and behaviors in razorpay-agent-server.js
 */

const http = require("http");
const app = require("./razorpay-agent-server.js");
const { createMandate, verifyMandate } = require("./shared/mandate.js");

const server = http.createServer(app);

server.listen(4001, async () => {
  console.log("Test server listening on port 4001...");

  try {
    // 1. Test /.well-known/acp/config.json
    console.log("\n[TEST 1] Testing /.well-known/acp/config.json...");
    const configRes = await fetch("http://localhost:4001/.well-known/acp/config.json");
    const configData = await configRes.json();
    console.log("Config response status:", configRes.status);
    console.log("Declared capabilities:", Object.keys(configData.capabilities));
    if (configData.protocol !== "ACP") throw new Error("Expected protocol ACP");

    // 2. Test /acp/catalog
    console.log("\n[TEST 2] Testing /acp/catalog...");
    const catRes = await fetch("http://localhost:4001/acp/catalog");
    const catData = await catRes.json();
    console.log(`Loaded ${catData.items.length} products and ${catData.upsells.length} upsells`);
    if (catData.items.length !== 500) throw new Error(`Catalog item count mismatch: expected 500, got ${catData.items.length}`);
    for (let i = 1; i <= 24; i++) {
      if (!catData.items.find((p) => p.id === `p${i}`)) throw new Error(`Original product p${i} missing from catalog!`);
    }
    console.log("Verified all 500 products and original 24 products (p1-p24) are present and preserved.");

    // 3. Test Mandate Generation and Verification
    console.log("\n[TEST 3] Testing AP2-inspired Mandate creation and verification...");
    const testMandate = createMandate({ buyerId: "BUYER-TEST", maxAmount: 2500 });
    const verifyResult = verifyMandate(testMandate);
    console.log("Mandate generated:", testMandate.mandateId, "Valid:", verifyResult.valid);
    if (!verifyResult.valid) throw new Error("Mandate verification failed");

    // Test tamper detection
    const tamperedMandate = { ...testMandate, maxAmount: 9999 };
    const tamperResult = verifyMandate(tamperedMandate);
    console.log("Tampered mandate verification expected to fail. Result:", tamperResult.valid, "-", tamperResult.reason);
    if (tamperResult.valid) throw new Error("Tamper detection failed to flag modified mandate");

    // 4. Test /agent/checkout with valid cart & mandate
    console.log("\n[TEST 4] Testing POST /agent/checkout with mandate...");
    const checkoutRes = await fetch("http://localhost:4001/agent/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: testMandate.sessionId,
        items: [{ id: "p1", qty: 1 }], // Earbuds: ₹1499
        upsell: { id: "u3" }, // Wrap: ₹99
        budget: 2000,
        mandate: testMandate,
      }),
    });
    const checkoutData = await checkoutRes.json();
    console.log("Checkout response status:", checkoutRes.status, "Decision:", checkoutData.status);
    if (checkoutData.status !== "APPROVED") throw new Error("Normal checkout failed to approve");

    // 5. Test Policy Gate Rejection (budget / mandate violation)
    console.log("\n[TEST 5] Testing POST /agent/checkout with mandate cap violation...");
    const lowMandate = createMandate({ buyerId: "BUYER-LOW", maxAmount: 1000 });
    const blockRes = await fetch("http://localhost:4001/agent/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: lowMandate.sessionId,
        items: [{ id: "p1", qty: 1 }], // ₹1499 > ₹1000
        budget: 2000,
        mandate: lowMandate,
      }),
    });
    const blockData = await blockRes.json();
    console.log("Block response status:", blockRes.status, "Decision:", blockData.status);
    if (blockRes.status !== 403 || blockData.status !== "BLOCKED") throw new Error("Cap violation was not blocked");

    // 6. Test Category Guardrail (kids category excluded from autonomous purchase)
    console.log("\n[TEST 6] Testing Category Guardrail for kids category...");
    const catBlockRes = await fetch("http://localhost:4001/agent/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ id: "p24", qty: 1 }], // Kids Puzzle Set
        budget: 2000,
      }),
    });
    const catBlockData = await catBlockRes.json();
    console.log("Kids category block status:", catBlockRes.status, "Reason:", catBlockData.reason);
    if (catBlockRes.status !== 403) throw new Error("Excluded category was not blocked");

    // 7. Test Escalation Threshold (> ₹5000, <= ₹6000) & Human Approval
    console.log("\n[TEST 7] Testing Escalation threshold and Human Approval...");
    const highValMandate = createMandate({ buyerId: "BUYER-HIGH", maxAmount: 6000 });
    const escRes = await fetch("http://localhost:4001/agent/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: highValMandate.sessionId,
        items: [
          { id: "p4", qty: 1 }, // Smartwatch: ₹2999
          { id: "p11", qty: 1 }, // Fitness band: ₹1799
          { id: "p5", qty: 1 }, // Ceramic mug: ₹549 -> total = ₹5347
        ],
        budget: 6000,
        mandate: highValMandate,
      }),
    });
    const escData = await escRes.json();
    console.log("Escalation status:", escRes.status, "Decision:", escData.status);
    if (escRes.status !== 202 || escData.status !== "ESCALATED") throw new Error("Order > ₹5000 did not escalate");

    // Approve the escalated order
    console.log("Testing human review approval endpoint...");
    const reviewRes = await fetch("http://localhost:4001/agent/escalation/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: highValMandate.sessionId,
        decision: "APPROVE",
        reason: "Reviewer signed off on executive order",
      }),
    });
    const reviewData = await reviewRes.json();
    console.log("Human review approval response:", reviewData.status);

    // Re-check checkout after approval
    const postApproveRes = await fetch("http://localhost:4001/agent/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: highValMandate.sessionId,
        items: [
          { id: "p4", qty: 1 },
          { id: "p11", qty: 1 },
          { id: "p5", qty: 1 },
        ],
        budget: 6000,
        mandate: highValMandate,
      }),
    });
    const postApproveData = await postApproveRes.json();
    console.log("Checkout after human approval:", postApproveData.status, "Order ID:", postApproveData.orderId);
    if (postApproveData.status !== "APPROVED") throw new Error("Order did not proceed after human approval");

    // 8. Test ACP Authenticated Checkout Sessions
    console.log("\n[TEST 8] Testing ACP Checkout Session Lifecycle with Bearer Auth & Idempotency...");
    // Without token: expected 401
    const unauthRes = await fetch("http://localhost:4001/acp/checkout-sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [{ id: "p1", qty: 1 }] }),
    });
    console.log("Unauthenticated ACP request status:", unauthRes.status);
    if (unauthRes.status !== 401) throw new Error("Expected 401 on unauthenticated ACP route");

    // With bearer token:
    const authSessionRes = await fetch("http://localhost:4001/acp/checkout-sessions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer verve_acp_demo_bearer_token",
      },
      body: JSON.stringify({
        items: [{ id: "p1", qty: 1 }],
        upsell: { id: "u1" },
        budget: 2000,
      }),
    });
    const sessionData = await authSessionRes.json();
    console.log("ACP Session created:", sessionData.id, "Status:", sessionData.status, "Total:", sessionData.cart.total);

    // Complete session with Idempotency Key
    const idempotencyKey = "test_key_" + Date.now();
    const completeRes1 = await fetch(`http://localhost:4001/acp/checkout-sessions/${sessionData.id}/complete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer verve_acp_demo_bearer_token",
        "Idempotency-Key": idempotencyKey,
      },
    });
    const completeData1 = await completeRes1.json();
    console.log("ACP Complete 1 status:", completeData1.status, "Order ID:", completeData1.order_id);

    // Duplicate call with same idempotency key
    const completeRes2 = await fetch(`http://localhost:4001/acp/checkout-sessions/${sessionData.id}/complete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer verve_acp_demo_bearer_token",
        "Idempotency-Key": idempotencyKey,
      },
    });
    const completeData2 = await completeRes2.json();
    console.log("ACP Complete 2 status:", completeData2.status, "Order ID (must match):", completeData2.order_id);
    if (completeData1.order_id !== completeData2.order_id) throw new Error("Idempotency failed to return same order");

    // 9. Test /audit-log
    console.log("\n[TEST 9] Testing GET /audit-log...");
    const auditRes = await fetch("http://localhost:4001/audit-log");
    const auditData = await auditRes.json();
    console.log(`Audit log contains ${auditData.length} entries.`);
    console.log("Recent audit entries:");
    auditData.slice(-4).forEach((e) => console.log(` - [${e.actor}] ${e.action}: ${e.status}`));

    console.log("\n>>> ALL TESTS PASSED SUCCESSFULLY! <<<\n");
  } catch (err) {
    console.error("\nTEST FAILED:", err);
    process.exitCode = 1;
  } finally {
    server.close();
  }
});
