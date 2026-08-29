# ⚡ Verve & Co. — Agentic Commerce & Checkout Engine

<div align="center">

[![Live Demo](https://img.shields.io/badge/Live_Demo-verve--co--eight.vercel.app-00C49F?style=for-the-badge&logo=vercel&logoColor=white)](https://verve-co-eight.vercel.app/)
![Razorpay Buildathon](https://img.shields.io/badge/Razorpay_Buildathon-Track_01:_AI_Growth_%26_Agentic_Commerce-0C2340?style=for-the-badge&logo=razorpay&logoColor=3395FF)
![Status](https://img.shields.io/badge/Status-Production--Grade_Live_Demo-00C49F?style=for-the-badge)
![Catalog Scale](https://img.shields.io/badge/Catalog-500_Curated_Products-teal?style=for-the-badge)

<br/>

**An autonomous, bounded, and auditable agentic commerce system where AI buyers and merchant agents collaborate within strict deterministic guardrails.**

[🌐 Live Deployment](https://verve-co-eight.vercel.app/) • [Architecture & Flow](#-architecture--transaction-flow) • [Quick Start](#-quick-start-guide) • [Interactive Auditing](#-interactive-inspection--audit-features) • [ACP Endpoints](#-acp-adapter--api-endpoints)

</div>

---

> 🚀 **Live Evaluator Deployment:** [https://verve-co-eight.vercel.app/](https://verve-co-eight.vercel.app/)  
> 📦 **GitHub Repository:** [https://github.com/taneshkhandal07-debug/Verve-Co.](https://github.com/taneshkhandal07-debug/Verve-Co.)  
> 📡 **ACP Protocol Discovery:** [https://verve-co-eight.vercel.app/.well-known/acp/config.json](https://verve-co-eight.vercel.app/.well-known/acp/config.json)  
> 🛒 **Live ACP Catalog Feed:** [https://verve-co-eight.vercel.app/acp/catalog](https://verve-co-eight.vercel.app/acp/catalog)

---

## 🎯 Executive Summary for Judges & Evaluators

**Verve & Co.** is built for **Track 01: AI Growth & Agentic Commerce** in the Razorpay AI Buildathon. It delivers on Razorpay's high-bar criteria: every financial action is **explainable, bounded, gated, and auditable**, featuring **deliberate payment decline with one bounded recovery** and **real merchant revenue attribution**.

### 🌟 Key Scorecard & Feature Highlights

| Buildathon Evaluator Criteria | How Verve & Co. Delivers It |
|---|---|
| **AI Growth & Merchant Revenue** | Context-aware merchant agent proposes relevant complementary cross-sells within a configurable policy budget cap (10%, 15%, 20%, 25%). Realized incremental revenue is tracked in real-time. |
| **Agentic Buyability (ACP-Compatible)** | Exposes machine-readable discovery (`/.well-known/acp/config.json`) and checkout adapters (`/acp/catalog`, `/acp/checkout-sessions`), enabling external AI buyers to discover and purchase programmatically. |
| **AP2-Inspired Buyer Mandate** | Implements cryptographically verifiable, signed Buyer Authorization Mandates (HMAC-SHA256) binding the agent to an authorized spend cap, expiry, and allowed merchant categories. |
| **Deterministic Policy Gate** | Pre-flight policy gate strictly precedes order creation. Validates buyer budget, merchant hard cap (₹6,000), 9 allowed categories (barring restricted safety categories like `kids`), and mandate validity. |
| **Human-in-the-Loop Escalation** | Orders exceeding ₹5,000 automatically pause and escalate to an interactive **Human Approval Checkpoint** before any payment capture can proceed. |
| **Deliberate Failure & Bounded Auto-Recovery** | Simulates a realistic payment decline on the primary instrument followed by **exactly one bounded recovery retry** using a backup test card, successfully completing the capture. |
| **Dual-Surface Architecture** | **Surface 1:** Verve & Co. Storefront & Agentic Checkout Console.<br/>**Surface 2:** "My Agent" Oversight Dashboard with real-time spending KPIs, category breakdown, mandate utilization, and behavioral Trust Score (0–100). |
| **Interactive Decision Timeline & Inspector** | Every decision in the chronological timeline is clickable, opening a **Full AI Chat & Decision Audit Modal** with complete prompt/reasoning transcripts, timestamps, and policy gate rule checks. |
| **Exportable Audit Logs** | Comprehensive CSV and JSON export options with time filters (*Since Last Reset*, *Weekly*, *Monthly*, *Yearly*). |
| **500-Item Domain-Rich Catalog** | Full 500-product curated catalog (`shared/catalog.json`) across 9 retail categories, featuring instant search, filtering, and responsive load-more capabilities. |

---

## 🏗 Architecture & Transaction Flow

```mermaid
sequenceDiagram
    autonumber
    actor User as Human Buyer
    participant BuyerAgent as Autonomous Buyer Agent
    participant MerchAgent as Merchant Recommendation Agent
    participant PolicyGate as Deterministic Policy Gate
    participant HumanReview as Human Approval Checkpoint
    participant RazorpayAPI as Razorpay Payment Adapter
    participant Ledger as Audit Trail Ledger & Dashboard

    User->>BuyerAgent: Issue shopping goal & budget (e.g. "Desk setup under ₹4,000")
    BuyerAgent->>BuyerAgent: Issue AP2-inspired signed mandate (HMAC-SHA256)
    BuyerAgent->>MerchAgent: Query 500-item ACP catalog & select primary items
    MerchAgent->>BuyerAgent: Propose complementary cross-sell (≤ 20% cap)
    BuyerAgent->>BuyerAgent: Evaluate upsell utility against remaining budget
    BuyerAgent->>PolicyGate: Submit basket for deterministic verification
    
    alt Policy Violation (Budget exceeded, restricted category, or invalid mandate)
        PolicyGate-->>BuyerAgent: BLOCKED (No payment attempt permitted)
        PolicyGate->>Ledger: Append BLOCKED event with rule failures
    else Order Value > ₹5,000
        PolicyGate->>HumanReview: ESCALATED for human sign-off
        User->>HumanReview: Review order & Approve/Deny
    end

    PolicyGate->>RazorpayAPI: POST /agent/checkout (Create order)
    RazorpayAPI->>RazorpayAPI: Attempt #1 (Deliberate test-card decline)
    RazorpayAPI->>RazorpayAPI: Bounded Recovery #2 (Fallback test instrument)
    RazorpayAPI->>User: Payment Captured & Receipt Issued
    RazorpayAPI->>Ledger: Record transaction, upsell revenue & full chat transcript
```

---

## 🗂 Project Structure

```text
├── agentic-checkout-demo.jsx     # Full-featured React Console & "My Agent" Dashboard
├── razorpay-agent-server.js      # Canonical Express backend, Policy Gate & Razorpay SDK
├── api/
│   └── index.js                  # Vercel Serverless Function entry point
├── shared/
│   ├── catalog.json              # Curated 500-item catalog + 5 canonical upsells
│   ├── policy.json               # Deterministic merchant policy thresholds
│   └── mandate.js                # AP2-inspired mandate signing & verification
├── src/
│   ├── main.jsx                  # Vite React root mount
│   └── index.css                 # Glassmorphic CSS tokens & typography
├── test-server-endpoints.js      # Automated backend validation suite (9/9 pass)
├── vercel.json                   # Vercel routing, CORS & serverless rewrites
├── vite.config.js                # Vite configuration with local API proxy
├── package.json                  # Dependencies and execution scripts
└── .env.example                  # Environment configuration template
```

---

## 🚀 Quick Start Guide (Local Setup)

### Prerequisites
- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- `npm` or `yarn`

### 1. Clone & Install Dependencies
```bash
git clone https://github.com/taneshkhandal07-debug/Verve-Co..git
cd Verve-Co.
npm install
```

### 2. Configure Environment (Optional)
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
*(The application runs out-of-the-box with intelligent simulated fallbacks if API keys are left unset.)*

### 3. Start Development Servers

You can run both the frontend and backend simultaneously:

**Terminal 1 — Start the Backend API & ACP Adapter:**
```bash
npm run server
# Runs on http://localhost:4000
```

**Terminal 2 — Start the Vite Frontend:**
```bash
npm run dev
# Runs on http://localhost:3000
```

Visit **`http://localhost:3000`** in your browser to interact with the full agentic commerce console.

### 4. Run Automated Test Suite
To verify the deterministic policy gate, ACP feeds, mandate signatures, and payment recovery:
```bash
node test-server-endpoints.js
```
*(Output: 9/9 tests pass with 100% compliance).*

---

## ☁️ Production Deployment on Vercel

Verve & Co. is live and deployed in production on **Vercel**:

🔗 **Production URL:** [https://verve-co-eight.vercel.app/](https://verve-co-eight.vercel.app/)

### Deployment Architecture on Vercel
- **Frontend SPA:** Built via `vite build` into static assets in `dist/` with instant global Edge CDN caching.
- **Serverless API:** Routes all machine-readable discovery (`/.well-known/*`), ACP endpoints (`/acp/*`), checkout (`/agent/*`), and ledger (`/audit-log`) automatically to Node.js serverless functions in `api/index.js`.
- **CORS & Security:** Configured via `vercel.json` for secure cross-origin agent interactions.

---

## 🔍 Interactive Inspection & Audit Features

### 1. Clickable Chronological Decision Timeline
Navigate to the **"My Agent" Dashboard** surface. Every card in the decision timeline is clickable:
- Clicking any event opens the **Decision & Chat Audit Inspector Modal**.
- Displays the complete multi-turn dialogue between the Buyer Agent and Merchant Agent.
- Shows timestamp, transaction ID, mandate reference, and policy gate compliance.
- Includes a 1-click **"Copy Transcript"** button for audit logs.

### 2. Multi-Format History Log Downloads
Export compliance logs at any time from the dashboard:
- **Export Formats:** `JSON` (raw structured telemetry) or `CSV` (formatted tabular spreadsheet).
- **Time Filters:** *Since Last Reset*, *Past Week*, *Past Month*, or *Past Year*.

### 3. Behavioral Trust Score (0–100)
A dynamic, 5-pillar mathematical model quantifying agent safety:
- **Pillar 1: Budget Adherence** (Weight: 25%)
- **Pillar 2: Policy Compliance** (Weight: 25%)
- **Pillar 3: Mandate Integrity** (Weight: 20%)
- **Pillar 4: Recovery Success** (Weight: 15%)
- **Pillar 5: Goal Fidelity** (Weight: 15%)

---

## 📡 ACP Adapter & API Endpoints

| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `GET` | `/.well-known/acp/config.json` | Machine-readable ACP capability discovery | No |
| `GET` | `/acp/catalog` | ACP catalog feed (filterable by `category` and `search`) | Bearer Token |
| `POST` | `/acp/checkout-sessions` | Create a programmatic checkout session with mandate | Bearer Token |
| `GET` | `/acp/checkout-sessions/:id` | Query state of an ACP checkout session | Bearer Token |
| `POST` | `/acp/checkout-sessions/:id/complete` | Complete ACP session (requires `Idempotency-Key`) | Bearer Token |
| `POST` | `/agent/checkout` | Main policy-gated checkout endpoint | No (Demo) |
| `POST` | `/agent/escalate` | Human-in-the-loop approval resolution | No (Demo) |
| `POST` | `/webhook/razorpay` | Razorpay webhook signature verification | X-Razorpay-Signature |
| `GET` | `/audit-log` | Full tamper-evident server audit ledger | No |

---

## 🧪 Preset Evaluator Scenarios

Use the interactive scenario buttons in the console to evaluate edge cases immediately:

1. **Desk Setup Upgrade (Multi-item + Complementary Cross-sell):**
   - Buyer picks Ergonomic Mesh Chair (`p1`) and LED Desk Lamp (`p3`).
   - Merchant agent identifies office category and recommends Felt Desk Mat (`p5`).
   - Upsell accepted within budget; policy passes; payment captured.
2. **Weekend Coffee Routine (Kitchen & Pantry):**
   - Buyer selects French Press Coffee Maker (`p6`).
   - Merchant recommends Artisanal Whole Bean Coffee (`p7`).
   - Demonstrates category-relevant complementary bundling.
3. **Executive Travel Kit (High-Value Human Escalation > ₹5,000):**
   - Cart subtotal exceeds the ₹5,000 threshold.
   - Automatically pauses at the **Human Approval Checkpoint**.
   - Review modal allows evaluator to click **Approve** or **Deny**.
4. **Restricted Category Block (Safety Rule Test):**
   - Attempting to purchase items from restricted categories (`kids`) triggers an immediate **POLICY GATE: BLOCKED** decision with zero fund exposure.
5. **Deliberate Failure & Bounded Recovery:**
   - Primary test card triggers `test_card_declined`.
   - Agent triggers single bounded recovery retry with backup card, capturing payment safely.

---

## 🛡️ Trust, Security & Deterministic Boundaries

- **Price Authority:** The server never trusts client-submitted totals or prices. Cart values are calculated strictly from the server-side catalog.
- **Tamper Evidence:** Buyer mandates are cryptographically signed and verified prior to any authorization.
- **Idempotency:** Completion requests require unique UUID idempotency keys to prevent double-charging.
- **Zero Hallucinated Spends:** Policy gates run deterministically in code, ensuring LLMs cannot bypass budget or category constraints.

---

## 👥 Authors & Buildathon Track
- **Project:** Verve & Co. — Agentic Commerce & Checkout Engine
- **Track:** Track 01 — AI Growth & Agentic Commerce
- **Target Event:** Razorpay AI Buildathon
- **Live Demo:** [https://verve-co-eight.vercel.app/](https://verve-co-eight.vercel.app/)
- **Repository:** [https://github.com/taneshkhandal07-debug/Verve-Co.](https://github.com/taneshkhandal07-debug/Verve-Co.)
