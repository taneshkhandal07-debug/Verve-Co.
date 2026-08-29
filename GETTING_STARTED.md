# Getting Started with Verve & Co. Agentic Commerce

Welcome to the **Verve & Co. Agentic Commerce Platform** (Razorpay AI Buildathon — Track 01: AI Growth & Agentic Commerce).

This guide walks you through setup, running the demo locally, and exploring the 7 key interactive scenarios.

---

## 1. Quick Start in 2 Minutes

### Prerequisites
- **Node.js**: v18.0.0 or higher
- **npm**: v8.0.0 or higher

### Step 1: Install Dependencies
```bash
npm install
```

### Step 2: Start the Express Backend Server
In Terminal 1:
```bash
npm run server
```
*Backend runs on `http://localhost:4000`.*

### Step 3: Start the Vite Frontend Console
In Terminal 2:
```bash
npm run dev
```
*Console opens at `http://localhost:3000`.*

### Step 4: Run Automated Endpoint Tests (Optional)
In Terminal 3:
```bash
node test-server-endpoints.js
```
*Executes all 9 end-to-end endpoint tests for ACP, AP2 mandates, Policy Gate, Human Escalation, and Idempotency.*

---

## 2. Interactive Scenarios Walkthrough

Select any of the preset scenario pills at the top of the console or type your own natural language query. You can press **Run agent** or hit **Enter** on your keyboard:

### 🎵 Scenario 1: Audio Setup for a Party (Catalog Cross-Sell)
- **Goal**: *"I want all the audio options you have for a party"* | **Budget**: ₹4,500
- **What happens**:
  1. **Buyer Agent**: Semantically searches the 120-product catalog and selects `p2` (*Desktop Soundbar Compact* ₹1,899).
  2. **Merchant Agent**: Identifies party audio context; searches catalog for complements under the policy cap. Offers `p31` (*Braided Hi-Fi Audio Cable* ₹299) tagged with `🔁 CROSS-SELL`.
  3. **Buyer Agent**: Evaluates remaining budget headroom (₹4,500 − ₹1,899 = ₹2,601) and accepts.
  4. **Policy Gate**: All 7 rules pass autonomously.
  5. **Razorpay Payments**: Attempt #1 simulated decline → automatic bounded recovery → capture.
  6. **Attribution**: Incremental merchant revenue increases by ₹299 upon capture.

### 💼 Scenario 2: Upgrade WFH Desk (Multi-Item Selection + Tech Cross-Sell)
- **Goal**: *"Upgrade my work-from-home desk with useful things under ₹4,500"* | **Budget**: ₹4,500
- **What happens**:
  1. **Buyer Agent**: Assembles a multi-item workspace setup (`p14` Desk Organizer + `p12` Wireless Charging Pad = ₹1,428).
  2. **Merchant Agent**: Recommends `p13` (*Portable Phone Stand* ₹249) as a workspace power and organization complement.
  3. **Result**: Buyer accepts; order clears gate autonomously at ₹1,677.

### 🎁 Scenario 3: Birthday Gift for Sister (Gifting Add-on Upsell)
- **Goal**: *"I need a birthday gift for my sister who likes cozy things"* | **Budget**: ₹2,000
- **What happens**:
  1. **Buyer Agent**: Selects cozy items (`p1` Bluetooth Speaker Mini + `p3` Scented Candle Trio = ₹1,698).
  2. **Merchant Agent**: Detects birthday gifting context; evaluates canonical gift add-ons (`u1`–`u5`). Offers `u1` (*Premium Gift Box* ₹149) tagged with `🎁 GIFT UPSELL`.
  3. **Result**: Buyer accepts; order passes gate and completes at ₹1,847.

### 🎒 Scenario 4: Weekend Travel Trip (Transit Gear Cross-Sell)
- **Goal**: *"I need something useful for a weekend trip"* | **Budget**: ₹2,500
- **What happens**:
  1. **Buyer Agent**: Selects travel gear (`p8` Travel Neck Pillow + `p51` Weekender Canvas Duffle = ₹2,448).
  2. **Merchant Agent**: Recommends `p53` (*Merino Wool Comfort Socks* ₹349) or `p85` (*Kayak Dry Bag 10L*).
  3. **Result**: Buyer evaluates headroom and completes purchase.

### 💳 Scenario 5: Single Item (Intelligent NO OFFER Decision)
- **Goal**: *"Just need a simple leather wallet, nothing fancy"* | **Budget**: ₹1,200
- **What happens**:
  1. **Buyer Agent**: Selects `p6` (*Minimalist Leather Wallet* ₹899).
  2. **Merchant Agent**: Evaluates catalog for accessories within the 20% cap (₹179). Confirms no item adds meaningful value within ₹179.
  3. **Outcome**: Confidently outputs `🛡️ NO ADD-ON NEEDED` with contextual reasoning. Avoids spamming the buyer with irrelevant items.

### ⚠️ Scenario 6: High-Value Executive Bundle (Human Escalation Checkpoint)
- **Goal**: *"Executive bundle with smartwatch, audio speaker, and leather accessories"* | **Budget**: ₹5,800
- **What happens**:
  1. **Buyer Agent**: Selects high-value items totaling > ₹5,000 (e.g. ₹5,297).
  2. **Policy Gate**: Passes merchant hard cap (₹6,000) and signed mandate, but triggers `ESCALATED` because total > ₹5,000 autonomous threshold.
  3. **Human Review Modal**: Renders an interactive sign-off card:
     - Click **Approve Transaction**: Execution resumes and Razorpay test-mode payment captures.
     - Click **Deny Order**: Execution aborts safely with `BLOCKED — human supervisor denied` in the audit ledger.

---

## 3. Interactive Controls & Features

### 🎛️ Configurable Policy Guardrail Threshold
- Located in the controls bar: `Add-on Cap: 10% | 15% | 20% (Default) | 25%`.
- Clicking a cap dynamically re-binds both the Merchant Recommendation Engine and the Policy Gate rule `RULES[upsell_value]`.

### 📋 1-Click Copy Helpers
- Click the **Copy** button on any Mandate ID (`MND-XXXXXX`), Order ID (`order_TESTMODEXXXX`), or Payment ID (`pay_TESTMODEXXXX`) to copy directly to your clipboard.

### 📊 "My Agent" Dashboard (Zero Synthetic History)
- Click the **My Agent Dashboard** tab in the top navigation.
- Starts cleanly at ₹0 on initial launch.
- Tracks real spending across calendar months, years, and lifetime.
- Displays the **Behavioral Trust Score (100/100)**: Click **How it's computed** to inspect the 5 deterministic security pillars.

---

## 4. Machine-Readable API Surfaces

| Route | Protocol | Description |
|---|---|---|
| `GET /.well-known/acp/config.json` | ACP Specification | Declares merchant checkout capabilities and catalog feed location. |
| `GET /acp/catalog` | ACP Specification | Machine-readable JSON product feed of all 120 canonical catalog items. |
| `POST /acp/checkout-sessions` | ACP Specification | Creates an external checkout session from an AI buyer's cart payload. |
| `POST /acp/checkout-sessions/:id/complete` | ACP Specification | Completes session with Bearer auth and `Idempotency-Key` header enforcement. |
| `POST /agent/checkout` | Agent Gateway | Internal checkout endpoint verifying AP2-inspired signed mandates. |
| `GET /audit-log` | Audit Trail | Tamper-evident, chronological server audit log. |
