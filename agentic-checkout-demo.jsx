import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";
import {
  ShoppingBag, Bot, Store, ShieldCheck, Receipt, Loader2, CreditCard,
  RotateCcw, CheckCircle2, XCircle, Lock, Radio, PlayCircle, Braces,
  Lightbulb, FileCheck2, UserCheck, AlertTriangle, TrendingUp, Check,
  Search, SlidersHorizontal, ArrowUpRight, BarChart3, Clock, Sparkles,
  Shield, DollarSign, PieChart, RefreshCw, Layers, Download, FileText,
  FileSpreadsheet, MessageSquare, ExternalLink, X, ChevronRight
} from "lucide-react";
import catalogData from "./shared/catalog.json";
import {
  loadHistory,
  recordCompletedPurchase,
  recordLifecycleEvent,
  computeDashboardMetrics,
  clearStoredHistory,
  exportHistoryJSON,
  exportHistoryCSV,
  triggerDownload,
  getFilteredHistory,
} from "./src/analytics.js";

/* ---------------------------------------------------------------
   VERVE & CO — Agentic Checkout Console & My Agent Dashboard
   v2.4 — Razorpay AI Buildathon Track 01
   
   Refined Intelligence & UX:
     - Intent Understanding: exploration vs. focused buy vs. multi-item bundle.
     - Whole-Catalog Semantic Search & Relevance Ranking (across all 120 items).
     - Intelligent Merchant Upsell: strictly checks for genuine contextual fit;
       legitimate NO OFFER when no gifting add-on is relevant.
     - Natural, conversational explanations (no repetitive canned text).
     - Denser Catalog Rail: 7–8+ products visible simultaneously on desktop.
     - All safety boundaries, AP2 mandate, Razorpay failure recovery, and
       My Agent dashboard preserved 100%.
----------------------------------------------------------------*/

const CATALOG = catalogData.products;
const UPSELLS = catalogData.upsells;

const PRESETS = [
  { label: "Audio for a party, under ₹4,500", goal: "I want all the audio options you have for a party", budget: 4500 },
  { label: "Wireless earbuds, under ₹2,000", goal: "I need a good pair of wireless earbuds under ₹2,000", budget: 2000 },
  { label: "Upgrade WFH desk, under ₹4,500", goal: "Upgrade my work-from-home desk with useful things under ₹4,500", budget: 4500 },
  { label: "Weekend trip gear, under ₹2,500", goal: "I need something useful for a weekend trip", budget: 2500 },
  { label: "Sister cozy birthday gift, under ₹2,000", goal: "I need a birthday gift for my sister who likes cozy things", budget: 2000 },
  { label: "Quick wallet, under ₹1,200", goal: "Just need a simple leather wallet, nothing fancy", budget: 1200 },
  { label: "High-value bundle (Escalation demo)", goal: "Executive bundle with smartwatch, audio speaker, and leather accessories", budget: 5800 },
];

// Unified canonical categories (kids excluded from autonomous purchasing)
const ALLOWED_CATEGORIES = ["audio", "home", "accessories", "wearables", "stationery", "outdoor", "tech", "food", "kitchen"];

/* ---------- AP2-inspired Mandate Helper (Deterministic HMAC) ---------- */
function generateDemoMandate(buyerId = "BUYER-01", maxBudget = 5000, sessionId) {
  const sId = sessionId || "sess_" + Math.random().toString(36).slice(2, 8);
  const mandateId = "MND-" + Math.random().toString(36).slice(2, 8).toUpperCase();
  const issuedAt = new Date().toLocaleTimeString("en-IN", { hour12: false });
  const validUntil = new Date(Date.now() + 30 * 60000).toLocaleTimeString("en-IN", { hour12: false });

  const raw = `${mandateId}|${buyerId}|${sId}|${maxBudget}|${ALLOWED_CATEGORIES.join(",")}|${validUntil}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = ((hash << 5) - hash) + raw.charCodeAt(i);
    hash |= 0;
  }
  const signature = "sig_hmac_" + Math.abs(hash).toString(16);

  return {
    mandateId,
    buyerId,
    sessionId: sId,
    maxAmount: maxBudget,
    allowedCategories: ALLOWED_CATEGORIES,
    issuedAt,
    validUntil,
    signature,
    type: "AP2_INSPIRED_AUTHORIZATION_MANDATE",
  };
}

const RULES = [
  { id: "budget", label: "Order total within stated budget", check: (ctx) => ctx.total <= ctx.budget },
  { id: "cap", label: "Order total under merchant hard cap (₹6,000)", check: (ctx) => ctx.total <= 6000 },
  { id: "category", label: "All items within allowed categories", check: (ctx) => ctx.items.every((i) => ALLOWED_CATEGORIES.includes(i.category)) },
  { id: "upsell_count", label: "At most one upsell offer per session", check: (ctx) => ctx.upsellCount <= 1 },
  { id: "upsell_value", label: "Upsell value ≤ 20% of cart subtotal", check: (ctx) => !ctx.upsellPrice || ctx.upsellPrice <= ctx.subtotal * 0.2 },
  { id: "mandate_cap", label: "Within signed buyer mandate limit", check: (ctx) => !ctx.mandate || ctx.total <= ctx.mandate.maxAmount },
  { id: "mandate_category", label: "Items permitted by buyer mandate", check: (ctx) => !ctx.mandate || ctx.items.every((i) => ctx.mandate.allowedCategories.includes(i.category)) },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const inr = (n) => "₹" + (n || 0).toLocaleString("en-IN");
const nowStamp = () => new Date().toLocaleTimeString("en-IN", { hour12: false });

/**
 * Calls server-side proxy to protect API keys.
 * If server is unreachable or offline, falls back to deterministic reasoning safely.
 */
async function callClaude(system, user, fallback) {
  try {
    const response = await fetch("/api/agent/claude", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ system, user, fallback }),
    });
    if (response.ok) {
      const res = await response.json();
      if (res && res.data) return res.data;
    }
  } catch (e) {
    // Graceful offline demo fallback
  }
  return fallback;
}

/* ---------- Semantic Search & Whole-Catalog Intent Analyzer ---------- */
function semanticSearchCatalog(goal, budget) {
  const g = goal.toLowerCase();

  // 1. Detect Intent Mode
  const isExploration = /all the.*options|show me|what options|what (audio|products)|choices|explore|available options/i.test(g);
  const isSingle = /simple|just need|quick|a pair of|good pair of|single|only|just a/i.test(g) && !isExploration;
  const isBundle = /setup|bundle|upgrade|wfh|kit|collection|work from home|pack/i.test(g) && !isSingle;
  const isGift = /gift|sister|birthday|present|anniversary|friend|family|celebrate/i.test(g);

  // 2. Detect Target Categories from Goal
  const categoryKeywords = {
    audio: ["audio", "sound", "speaker", "headphones", "earbuds", "earphones", "music", "party", "soundbar", "radio", "microphone", "tunes", "listen"],
    tech: ["tech", "wfh", "mouse", "keyboard", "numpad", "charger", "usb", "hub", "laptop", "riser", "monitor", "screen", "webcam", "light bar"],
    stationery: ["stationery", "notebook", "journal", "pen", "fountain pen", "pencil", "desk mat", "paperclip", "desk organizer", "file tray"],
    outdoor: ["outdoor", "travel", "hiking", "trip", "camp", "camping", "hammock", "spork", "trekking", "backpack", "dry bag", "water bottle", "pillow"],
    wearables: ["wearable", "watch", "smartwatch", "fitness", "tracker", "band", "ring", "oximeter", "jump rope"],
    kitchen: ["kitchen", "coffee", "grinder", "pour-over", "skillet", "cutting board", "oil", "scale", "cups", "shaker", "cutlery"],
    food: ["food", "chocolate", "tea", "honey", "almonds", "matcha", "snack", "trio", "gourmet"],
    home: ["home", "candle", "diffuser", "throw", "blanket", "cushion", "clock", "lamp", "planter", "humidifier", "bookends", "shelf", "cozy"],
    accessories: ["accessory", "wallet", "scarf", "sunglasses", "beanie", "belt", "cardholder", "flask", "umbrella", "tote", "duffle", "keychain"],
  };

  const detectedCategories = new Set();
  for (const [cat, words] of Object.entries(categoryKeywords)) {
    if (words.some((w) => g.includes(w))) {
      detectedCategories.add(cat);
    }
  }

  // 3. Score every product across all 120 items in CATALOG
  const scored = CATALOG.map((p) => {
    let score = 0;
    const pName = p.name.toLowerCase();
    const pCat = p.category;

    // Disqualify over-budget products
    if (p.price > budget) {
      return { product: p, score: -99999 };
    }

    // Category match bonus / penalty
    if (detectedCategories.size > 0) {
      if (detectedCategories.has(pCat)) {
        score += 3000;
      } else {
        score -= 2000; // Strong penalty for unrelated category
      }
    }

    // Keyword matching in product title
    const wordsInGoal = g.split(/\W+/).filter((w) => w.length > 2);
    for (const word of wordsInGoal) {
      if (pName.includes(word)) score += 200;
    }

    // Context-specific use case boosters
    if (g.includes("party") && pCat === "audio") {
      if (p.id === "p27") score += 1500; // Desktop Soundbar Compact
      if (p.id === "p6") score += 1200;  // Bluetooth Speaker Mini
      if (p.id === "p28") score += 1000; // Retro Wooden Radio
      if (p.id === "p32") score += 800;  // Shower Speaker
    }

    if ((g.includes("earbuds") || g.includes("earphones")) && (p.id === "p1" || p.id === "p26")) {
      score += 2500;
    }

    if ((g.includes("desk") || g.includes("wfh")) && ["tech", "stationery", "home"].includes(pCat)) {
      if (p.id === "p8") score += 1200;  // Desk Organizer
      if (p.id === "p20") score += 1000; // Wireless Charging Pad
      if (p.id === "p35") score += 900;  // LED Desk Lamp
      if (p.id === "p5") score += 800;   // Ceramic Mug Set
    }

    if ((g.includes("trip") || g.includes("travel")) && ["outdoor", "accessories"].includes(pCat)) {
      if (p.id === "p19") score += 1800; // Travel Neck Pillow
      if (p.id === "p9") score += 1500;  // Insulated Water Bottle
      if (p.id === "p54") score += 1200; // Weekender Duffle
    }

    if (g.includes("cozy") && ["home", "food"].includes(pCat)) {
      if (p.id === "p2") score += 1500;  // Scented Candle Trio
      if (p.id === "p21") score += 1200; // Cotton Throw Blanket
      if (p.id === "p16") score += 900;  // Herbal Tea Sampler
    }

    if (g.includes("wallet") && (p.id === "p3" || p.id === "p47")) {
      score += 2500;
    }

    if (g.includes("executive") || g.includes("smartwatch")) {
      if (p.id === "p4") score += 2000;
      if (p.id === "p11") score += 1500;
      if (p.id === "p6") score += 1000;
    }

    return { product: p, score };
  });

  // Sort descending by score
  scored.sort((a, b) => b.score - a.score);
  const eligible = scored.filter((s) => s.score > 0).map((s) => s.product);
  const topCandidates = eligible.length > 0 ? eligible : CATALOG.filter((p) => p.price <= budget);

  // 4. Intent-Dependent Product Selection
  let selection = [];
  let conversationalWhy = "";

  if (isExploration) {
    // Present top options, choose the #1 most suitable centerpiece (do NOT purchase all!)
    const primary = topCandidates[0];
    selection = [{ id: primary.id, qty: 1 }];
    const otherOptions = topCandidates.slice(1, 3).map((p) => `${p.name} (${inr(p.price)})`).join(", ");
    conversationalWhy = `Exploration query evaluated across all ${CATALOG.length} products. Found strong matching options including ${primary.name} and ${otherOptions}. Selected ${primary.name} as the premier centerpiece for the party.`;
  } else if (isSingle || !isBundle) {
    // 1 best product
    const primary = topCandidates[0];
    selection = [{ id: primary.id, qty: 1 }];
    conversationalWhy = `Selected ${primary.name} which directly fulfills the specific shopping goal within budget.`;
  } else {
    // 2-3 complementary products for setup/bundle
    let currentTotal = 0;
    const bundle = [];
    const usedCategories = new Set();

    for (const cand of topCandidates) {
      if (bundle.length >= 3) break;
      if (currentTotal + cand.price <= budget && !usedCategories.has(cand.category)) {
        bundle.push(cand);
        currentTotal += cand.price;
        usedCategories.add(cand.category);
      }
    }

    if (bundle.length === 0 && topCandidates.length > 0) {
      bundle.push(topCandidates[0]);
    }

    selection = bundle.map((p) => ({ id: p.id, qty: 1 }));
    conversationalWhy = `Assembled a balanced ${bundle.length}-item setup (${bundle.map((i) => i.name).join(" + ")}) delivering complementary functionality within budget.`;
  }

  return {
    selection,
    conversationalWhy,
    topCandidates: topCandidates.slice(0, 30),
    isGift,
    isExploration,
  };
}

/* ---------- Context-Aware Merchant Cross-Sell & Upsell Engine ---------- */
function findMerchantComplementaryRecommendation(goal, cartItems, subtotal, budget, mandate, upsellCapPercent = 0.20) {
  const g = goal.toLowerCase();
  const headroom = Math.min(budget, mandate ? mandate.maxAmount : 5000) - subtotal;
  const maxPriceAllowed = subtotal * upsellCapPercent; // Configurable policy cap
  const capPercentLabel = `${Math.round(upsellCapPercent * 100)}%`;

  const cartIds = new Set(cartItems.map((i) => i.id));
  const isGift = /gift|sister|birthday|present|anniversary|friend|family|celebrate/i.test(g);
  const isAudio = /audio|speaker|sound|music|party|earbuds|headphones/i.test(g) || cartItems.some((i) => i.category === "audio");
  const isDesk = /desk|wfh|work from home|setup|office/i.test(g) || cartItems.some((i) => ["tech", "stationery"].includes(i.category));
  const isTravel = /travel|trip|weekend|hiking|camp|outdoor/i.test(g) || cartItems.some((i) => i.category === "outdoor");
  const isKitchen = /kitchen|coffee|cook|food/i.test(g) || cartItems.some((i) => ["kitchen", "food"].includes(i.category));

  // Build candidate pool: canonical upsells (u1-u5) + 500-product catalog items not in cart
  const allCandidates = [
    ...UPSELLS.map((u) => ({ ...u, isGiftingAddon: true })),
    ...CATALOG.filter((p) => !cartIds.has(p.id)).map((p) => ({ ...p, isGiftingAddon: false })),
  ];

  // Filter candidates that clear both policy cap and budget headroom
  const eligible = allCandidates.filter((cand) => cand.price <= maxPriceAllowed && cand.price <= headroom);

  if (eligible.length === 0) {
    return {
      recommendation: null,
      type: "NONE",
      reasoning: `Evaluated the ${CATALOG.length}-product catalog and store add-ons, but no complementary item satisfies the ${capPercentLabel} cart policy cap (${inr(Math.floor(maxPriceAllowed))}) within remaining budget. Keeping order focused.`,
    };
  }

  // Score eligible candidates based on semantic use case
  const scored = eligible.map((cand) => {
    let score = 0;
    const cId = cand.id;

    if (isGift) {
      if (cand.isGiftingAddon) {
        score += 3000;
        if (cId === "u1") score += 500; // Premium Gift Box
        if (cId === "u2") score += 400; // Handwritten Card
      } else if (["home", "food", "accessories"].includes(cand.category)) {
        score += 1200; // Giftable catalog add-on
      }
    } else {
      // Non-gift: Gifting wrap/cards are irrelevant (-5000)
      if (cand.isGiftingAddon) {
        score -= 5000;
      }

      if (isAudio) {
        if (cId === "p31") score += 3500; // Braided Hi-Fi Audio Cable (₹299)
        if (cId === "p30") score += 3200; // Headphone Desk Stand (₹499)
        if (cId === "p34") score += 2800; // Vinyl Record Care Kit (₹599)
        if (cand.category === "audio") score += 1500;
      }

      if (isDesk) {
        if (cId === "p91") score += 3500; // Braided USB-C Cable (₹399)
        if (cId === "p13") score += 3200; // Portable Phone Stand (₹249)
        if (cId === "p93") score += 3000; // Cable Management Box (₹499)
        if (cId === "p70") score += 2800; // Mechanical Drafting Pencil (₹399)
        if (cId === "p95") score += 2500; // Precision Screen Cleaner Kit (₹249)
        if (["tech", "stationery"].includes(cand.category)) score += 1400;
      }

      if (isTravel) {
        if (cId === "p85") score += 3500; // Waterproof Kayak Dry Bag 10L (₹499)
        if (cId === "p53") score += 3200; // Merino Wool Comfort Socks (₹349)
        if (cId === "p83") score += 3000; // Insulated Stainless Camp Mug (₹399)
        if (cId === "p55") score += 2800; // Compact Key Organizer (₹399)
        if (cand.category === "outdoor") score += 1400;
      }

      if (isKitchen) {
        if (cId === "p104") score += 3500; // Aromatic Masala Chai Tin (₹299)
        if (cId === "p103") score += 3200; // Himalayan Pink Salt Grinder (₹349)
        if (cId === "p23") score += 3000;  // Bamboo Cutlery Set (₹349)
        if (cId === "p111") score += 2800; // Ceramic Drip-Free Oil Cruet (₹449)
        if (["kitchen", "food"].includes(cand.category)) score += 1400;
      }
    }

    return { candidate: cand, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];

  if (!best || best.score <= 0) {
    return {
      recommendation: null,
      type: "NONE",
      reasoning: `I evaluated the ${CATALOG.length}-product catalog for meaningful complements to your selection, but no additional product provides sufficient contextual value within the ${capPercentLabel} policy cap. Keeping the cart unchanged.`,
    };
  }

  const rec = best.candidate;
  const isCrossSell = !rec.isGiftingAddon;
  const type = isCrossSell ? "CROSS_SELL" : "GIFT_UPSELL";

  let reasoning = "";
  if (isGift) {
    reasoning = `Since this order is a special gift, the ${rec.name} (${inr(rec.price)}) provides an elegant finishing presentation within the ${capPercentLabel} cap.`;
  } else if (isAudio) {
    reasoning = `The ${cartItems[0]?.name || "audio selection"} is ready for the party. Adding the ${rec.name} (${inr(rec.price)}) provides reliable direct connection without pushing your cart over budget.`;
  } else if (isDesk) {
    reasoning = `Your work-from-home desk setup has the core items. The ${rec.name} (${inr(rec.price)}) is a practical workspace complement for power and device organization within the ${capPercentLabel} cap.`;
  } else if (isTravel) {
    reasoning = `To complement your travel gear, the ${rec.name} (${inr(rec.price)}) provides essential weather protection for valuables during transit.`;
  } else {
    reasoning = `The ${rec.name} (${inr(rec.price)}) provides a functional, complementary addition to your cart within the ${capPercentLabel} policy cap.`;
  }

  return {
    recommendation: rec,
    type,
    reasoning,
    topEligible: scored.slice(0, 8).map((s) => s.candidate),
  };
}


/* ---------- shared glass style helper ---------- */
const glass = (extra = {}) => ({
  background: "rgba(255,255,255,0.055)",
  backdropFilter: "blur(20px) saturate(140%)",
  WebkitBackdropFilter: "blur(20px) saturate(140%)",
  border: "1px solid rgba(255,255,255,0.13)",
  boxShadow: "0 8px 28px rgba(3,10,25,0.35)",
  ...extra,
});

function Stamp({ status }) {
  const map = {
    APPROVED: { color: "#8FE0A8", bg: "rgba(78,205,131,0.14)", border: "rgba(78,205,131,0.4)", label: "APPROVED" },
    BLOCKED: { color: "#FF9C9C", bg: "rgba(229,72,77,0.14)", border: "rgba(229,72,77,0.4)", label: "BLOCKED" },
    ESCALATED: { color: "#F5C171", bg: "rgba(232,163,61,0.16)", border: "rgba(232,163,61,0.45)", label: "ESCALATED" },
    DECLINED: { color: "#FF9C9C", bg: "rgba(229,72,77,0.14)", border: "rgba(229,72,77,0.4)", label: "DECLINED" },
    PAID: { color: "#7FC0FF", bg: "rgba(51,149,255,0.16)", border: "rgba(51,149,255,0.45)", label: "PAID" },
    LOGGED: { color: "#B7BEC9", bg: "rgba(255,255,255,0.08)", border: "rgba(255,255,255,0.18)", label: "LOGGED" },
    SIGNED: { color: "#2DD4BF", bg: "rgba(45,212,191,0.15)", border: "rgba(45,212,191,0.4)", label: "SIGNED" },
  };
  const s = map[status] || map.LOGGED;
  return (
    <span
      style={{
        display: "inline-block",
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: "10px",
        fontWeight: 700,
        letterSpacing: "0.12em",
        color: s.color,
        border: `1px solid ${s.border}`,
        borderRadius: "5px",
        padding: "2px 8px",
        background: s.bg,
        whiteSpace: "nowrap",
      }}
    >
      {s.label}
    </span>
  );
}

function StampPaper({ status }) {
  const map = {
    APPROVED: { color: "#27500A", bg: "#EAF3DE", label: "APPROVED" },
    BLOCKED: { color: "#791F1F", bg: "#FCEBEB", label: "BLOCKED" },
    ESCALATED: { color: "#854F0B", bg: "#FAEEDA", label: "ESCALATED" },
    DECLINED: { color: "#791F1F", bg: "#FCEBEB", label: "DECLINED" },
    PAID: { color: "#0C2451", bg: "#E6F1FB", label: "PAID" },
    LOGGED: { color: "#444441", bg: "#F1EFE8", label: "LOGGED" },
    SIGNED: { color: "#04342C", bg: "#D5F7F2", label: "SIGNED" },
  };
  const s = map[status] || map.LOGGED;
  return (
    <span
      style={{
        display: "inline-block",
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: "10px",
        fontWeight: 700,
        letterSpacing: "0.12em",
        color: s.color,
        border: `1.5px solid ${s.color}`,
        borderRadius: "3px",
        padding: "2px 7px",
        transform: "rotate(-3deg)",
        background: s.bg,
        whiteSpace: "nowrap",
      }}
    >
      {s.label}
    </span>
  );
}

function RuleRow({ rule, result }) {
  const pass = result === true;
  const pending = result === undefined;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
      {pending ? (
        <div style={{ width: 13, height: 13, borderRadius: "50%", border: "1.5px solid var(--textLo)", flexShrink: 0 }} />
      ) : pass ? (
        <CheckCircle2 size={14} color="#4ADE80" strokeWidth={2.5} style={{ flexShrink: 0 }} />
      ) : (
        <XCircle size={14} color="var(--red)" strokeWidth={2.5} style={{ flexShrink: 0 }} />
      )}
      <span style={{ fontSize: 11.5, color: pending ? "var(--textLo)" : "var(--textHi)", fontFamily: "Inter, sans-serif" }}>
        {rule.label}
      </span>
    </div>
  );
}

/* Denser, compact CatalogCard: 7–8 cards visible simultaneously */
const CatalogCard = React.memo(function CatalogCard({ product, highlighted }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      style={glass({
        border: `1px solid ${highlighted ? "var(--teal)" : "rgba(255,255,255,0.11)"}`,
        borderRadius: 8,
        padding: "7px 10px",
        transition: "all 0.2s ease",
        background: highlighted ? "rgba(45,212,191,0.09)" : "rgba(255,255,255,0.04)",
      })}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ minWidth: 0, flex: 1, paddingRight: 6 }}>
          <div
            style={{
              fontFamily: "'Space Grotesk', sans-serif",
              fontSize: 12.5,
              fontWeight: 600,
              color: highlighted ? "#8FEFE2" : "var(--textHi)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {product.name}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11.5, color: "var(--teal)", fontWeight: 600 }}>
              {inr(product.price)}
            </span>
            <span style={{ fontSize: 9.5, color: "var(--textLo)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              {product.category} · {product.stock} left
            </span>
          </div>
        </div>
        <button
          onClick={() => setOpen(!open)}
          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--textLo)", padding: 2, flexShrink: 0 }}
          aria-label="Toggle schema"
        >
          <Braces size={12} />
        </button>
      </div>
      {open && (
        <pre
          style={{
            marginTop: 6,
            fontSize: 9.5,
            fontFamily: "'IBM Plex Mono', monospace",
            background: "rgba(3,10,25,0.6)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 6,
            padding: "6px 8px",
            color: "#8FD6A8",
            overflowX: "auto",
          }}
        >
{JSON.stringify(
  { id: product.id, name: product.name, price_inr: product.price, category: product.category, stock: product.stock, agent_purchasable: ALLOWED_CATEGORIES.includes(product.category) },
  null,
  2
)}
        </pre>
      )}
    </div>
  );
});

function ReasoningChip({ text }) {
  if (!text) return null;
  return (
    <div
      style={glass({
        display: "flex",
        alignItems: "flex-start",
        gap: 6,
        marginTop: 5,
        padding: "6px 10px",
        borderRadius: 8,
        background: "rgba(45,212,191,0.07)",
        border: "1px solid rgba(45,212,191,0.22)",
        boxShadow: "none",
        maxWidth: "100%",
      })}
    >
      <Lightbulb size={12} color="var(--teal)" style={{ marginTop: 2, flexShrink: 0 }} />
      <span style={{ fontSize: 11, color: "#BFEFE8", lineHeight: 1.4, fontFamily: "Inter, sans-serif" }}>
        <span style={{ fontWeight: 600, color: "var(--teal)" }}>Why: </span>
        {text}
      </span>
    </div>
  );
}

function CopyButton({ text, label = "Copy" }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = (e) => {
    e.stopPropagation();
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };
  return (
    <button
      onClick={handleCopy}
      title={`Copy ${text}`}
      aria-label={`Copy ${text}`}
      style={{
        background: copied ? "rgba(78,205,131,0.2)" : "rgba(255,255,255,0.06)",
        border: `1px solid ${copied ? "rgba(78,205,131,0.4)" : "rgba(255,255,255,0.12)"}`,
        color: copied ? "#4ADE80" : "var(--textLo)",
        borderRadius: 4,
        padding: "2px 5px",
        fontSize: 9.5,
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        marginLeft: 6,
        fontFamily: "'IBM Plex Mono', monospace",
        transition: "all 0.2s ease",
      }}
    >
      {copied ? <Check size={10} /> : <FileCheck2 size={10} />}
      {copied ? "Copied" : label}
    </button>
  );
}

function ChatBubble({ role, text, reasoning, badge }) {
  const isBuyer = role === "buyer";
  const isGate = role === "gate";
  const isSystem = role === "system";
  if (isGate || isSystem) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", margin: "10px 0" }}>
        <div
          style={glass({
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 11,
            color: isGate ? "var(--rzpBlue)" : "var(--textLo)",
            border: `1px dashed ${isGate ? "rgba(51,149,255,0.5)" : "rgba(255,255,255,0.16)"}`,
            borderRadius: 20,
            padding: "5px 14px",
            display: "flex",
            alignItems: "center",
            gap: 6,
            boxShadow: "none",
          })}
        >
          {isGate ? <ShieldCheck size={13} /> : <Radio size={13} />}
          {text}
        </div>
        {reasoning && <ReasoningChip text={reasoning} />}
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: isBuyer ? "row" : "row-reverse", gap: 10, marginBottom: 16, animation: "slideIn 0.4s ease" }}>
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: "50%",
          background: isBuyer ? "rgba(51,149,255,0.18)" : "rgba(45,212,191,0.18)",
          border: `1px solid ${isBuyer ? "rgba(51,149,255,0.4)" : "rgba(45,212,191,0.4)"}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {isBuyer ? <Bot size={14} color="var(--rzpBlue)" /> : <Store size={14} color="var(--teal)" />}
      </div>
      <div style={{ maxWidth: "80%" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: isBuyer ? "flex-start" : "flex-end", gap: 6, marginBottom: 3 }}>
          <span style={{ fontSize: 10.5, color: "var(--textLo)", fontFamily: "'IBM Plex Mono', monospace", letterSpacing: "0.04em" }}>
            {isBuyer ? "BUYER AGENT" : "MERCHANT AGENT"}
          </span>
          {badge && (
            <span
              style={{
                fontSize: 9.5,
                fontFamily: "'IBM Plex Mono', monospace",
                fontWeight: 700,
                letterSpacing: "0.06em",
                padding: "1px 6px",
                borderRadius: 4,
                background: badge.type === "cross-sell" ? "rgba(51,149,255,0.15)" : badge.type === "upsell" ? "rgba(45,212,191,0.15)" : "rgba(255,255,255,0.08)",
                color: badge.type === "cross-sell" ? "#8ECCFF" : badge.type === "upsell" ? "#8FEFE2" : "var(--textLo)",
                border: `1px solid ${badge.type === "cross-sell" ? "rgba(51,149,255,0.4)" : badge.type === "upsell" ? "rgba(45,212,191,0.4)" : "rgba(255,255,255,0.15)"}`,
              }}
            >
              {badge.label}
            </span>
          )}
        </div>
        <div
          style={glass({
            borderRadius: 12,
            borderTopLeftRadius: isBuyer ? 2 : 12,
            borderTopRightRadius: isBuyer ? 12 : 2,
            padding: "9px 13px",
            fontSize: 13,
            color: "var(--textHi)",
            fontFamily: "Inter, sans-serif",
            lineHeight: 1.45,
            border: `1px solid ${isBuyer ? "rgba(51,149,255,0.25)" : "rgba(45,212,191,0.25)"}`,
          })}
        >
          {text}
        </div>
        <div style={{ display: "flex", justifyContent: isBuyer ? "flex-start" : "flex-end" }}>
          <ReasoningChip text={reasoning} />
        </div>
      </div>
    </div>
  );
}

function LedgerEntry({ entry }) {
  const isRazorpay = entry.actor && entry.actor.startsWith("RAZORPAY");
  const isGate = entry.actor === "POLICY GATE";
  const isHuman = entry.actor === "HUMAN REVIEW";
  const stripe = isRazorpay || isGate ? "#3395FF" : isHuman ? "#E8A33D" : entry.actor === "MERCHANT AGENT" ? "#2DD4BF" : entry.actor === "BUYER AGENT" ? "#3395FF" : "transparent";
  return (
    <div
      style={{
        borderBottom: "1px dashed #C9C4B4",
        borderLeft: `3px solid ${stripe}`,
        padding: "10px 4px 10px 10px",
        marginBottom: 1,
        animation: "feedIn 0.5s ease",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, color: isRazorpay ? "#0C2451" : "#6B6656", fontWeight: isRazorpay ? 700 : 400, letterSpacing: "0.05em" }}>
          {entry.time} · {entry.actor}
        </span>
        <StampPaper status={entry.status} />
      </div>
      <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12.5, color: "#1B2334", fontWeight: 600, marginBottom: entry.detail ? 3 : 0 }}>
        {entry.action}
      </div>
      {entry.detail && (
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "#4A4636", lineHeight: 1.5 }}>
          {entry.detail}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------
   DECISION & CHAT AUDIT MODAL (INTERACTIVE INSPECTOR)
----------------------------------------------------------------*/
function DecisionAuditModal({ event, onClose }) {
  const [copiedTranscript, setCopiedTranscript] = useState(false);
  const [copiedJson, setCopiedJson] = useState(false);

  if (!event) return null;

  const chat = Array.isArray(event.chatTranscript) ? event.chatTranscript : [];

  function handleCopyTranscript() {
    const text = chat.map((c) => `[${(c.role || "AGENT").toUpperCase()}] ${c.text} ${c.reasoning ? `(Why: ${c.reasoning})` : ""}`).join("\n\n");
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(text || event.title);
      setCopiedTranscript(true);
      setTimeout(() => setCopiedTranscript(false), 1500);
    }
  }

  function handleCopyJson() {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(JSON.stringify(event, null, 2));
      setCopiedJson(true);
      setTimeout(() => setCopiedJson(false), 1500);
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(2, 6, 18, 0.85)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        animation: "slideIn 0.2s ease",
      }}
      onClick={onClose}
    >
      <div
        style={glass({
          width: "100%",
          maxWidth: 840,
          maxHeight: "88vh",
          borderRadius: 16,
          border: "1px solid rgba(45,212,191,0.45)",
          background: "linear-gradient(135deg, rgba(8,16,36,0.98) 0%, rgba(4,8,22,0.99) 100%)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 24px 64px rgba(0,0,0,0.85)",
        })}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div style={{ padding: "16px 22px", borderBottom: "1px solid rgba(255,255,255,0.12)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <h3 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 16, fontWeight: 700, color: "var(--textHi)", margin: 0 }}>
                Audit Inspector · {event.title}
              </h3>
              <Stamp status={event.status} />
            </div>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "var(--textLo)", marginTop: 4 }}>
              Timestamp: {event.timestamp || event.timeFormatted} · ID: {event.id}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close modal"
            style={{
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.15)",
              color: "var(--textHi)",
              borderRadius: 8,
              padding: "6px 10px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
            }}
          >
            <X size={15} />
          </button>
        </div>

        {/* Modal Content */}
        <div style={{ padding: "18px 22px", overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Metadata Cards Grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
            <div style={{ background: "rgba(3,10,25,0.5)", borderRadius: 8, padding: "10px 12px", border: "1px solid rgba(255,255,255,0.08)" }}>
              <div style={{ fontSize: 10, color: "var(--textLo)", fontFamily: "'IBM Plex Mono', monospace" }}>MANDATE ID</div>
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12.5, color: "var(--teal)", fontWeight: 600, marginTop: 3, display: "flex", alignItems: "center" }}>
                {event.mandateId || "MND-DEMO"}
                <CopyButton text={event.mandateId || "MND-DEMO"} />
              </div>
            </div>

            <div style={{ background: "rgba(3,10,25,0.5)", borderRadius: 8, padding: "10px 12px", border: "1px solid rgba(255,255,255,0.08)" }}>
              <div style={{ fontSize: 10, color: "var(--textLo)", fontFamily: "'IBM Plex Mono', monospace" }}>EVENT AMOUNT</div>
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 13.5, color: event.status === "PAID" ? "#8FE0A8" : "var(--textHi)", fontWeight: 700, marginTop: 3 }}>
                {inr(event.amount)}
              </div>
            </div>

            {event.orderId && (
              <div style={{ background: "rgba(3,10,25,0.5)", borderRadius: 8, padding: "10px 12px", border: "1px solid rgba(255,255,255,0.08)" }}>
                <div style={{ fontSize: 10, color: "var(--textLo)", fontFamily: "'IBM Plex Mono', monospace" }}>ORDER ID</div>
                <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11.5, color: "var(--textHi)", marginTop: 3, display: "flex", alignItems: "center" }}>
                  {event.orderId}
                  <CopyButton text={event.orderId} />
                </div>
              </div>
            )}

            {event.paymentId && (
              <div style={{ background: "rgba(3,10,25,0.5)", borderRadius: 8, padding: "10px 12px", border: "1px solid rgba(255,255,255,0.08)" }}>
                <div style={{ fontSize: 10, color: "var(--textLo)", fontFamily: "'IBM Plex Mono', monospace" }}>PAYMENT ID</div>
                <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11.5, color: "#8FE0A8", marginTop: 3, display: "flex", alignItems: "center" }}>
                  {event.paymentId}
                  <CopyButton text={event.paymentId} />
                </div>
              </div>
            )}
          </div>

          {/* Reasoning context */}
          {(event.reasoning || event.detail) && (
            <div style={{ background: "rgba(45,212,191,0.08)", border: "1px solid rgba(45,212,191,0.25)", borderRadius: 10, padding: "12px 14px" }}>
              <div style={{ fontSize: 11, color: "var(--teal)", fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, marginBottom: 4, display: "flex", alignItems: "center", gap: 5 }}>
                <ShieldCheck size={14} /> DECISION REASONING &amp; GUARDRAIL CONTEXT
              </div>
              <div style={{ fontSize: 12.5, color: "var(--textHi)", lineHeight: 1.55 }}>
                {event.reasoning || event.detail}
              </div>
            </div>
          )}

          {/* Chat transcript */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ fontSize: 11.5, color: "var(--textLo)", fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                <Bot size={14} color="var(--teal)" /> ORIGINAL AI AGENT CONVERSATION ({chat.length} messages)
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  onClick={handleCopyTranscript}
                  aria-label="Copy transcript text"
                  style={{
                    background: "rgba(255,255,255,0.06)",
                    border: "1px solid rgba(255,255,255,0.15)",
                    color: copiedTranscript ? "#8FE0A8" : "var(--textLo)",
                    borderRadius: 6,
                    padding: "3px 8px",
                    fontSize: 10,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    fontFamily: "'IBM Plex Mono', monospace",
                  }}
                >
                  {copiedTranscript ? <Check size={10} /> : <FileText size={10} />}
                  {copiedTranscript ? "Copied" : "Copy Transcript"}
                </button>
                <button
                  onClick={handleCopyJson}
                  aria-label="Copy event JSON"
                  style={{
                    background: "rgba(255,255,255,0.06)",
                    border: "1px solid rgba(255,255,255,0.15)",
                    color: copiedJson ? "#8FE0A8" : "var(--textLo)",
                    borderRadius: 6,
                    padding: "3px 8px",
                    fontSize: 10,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    fontFamily: "'IBM Plex Mono', monospace",
                  }}
                >
                  {copiedJson ? <Check size={10} /> : <FileText size={10} />}
                  {copiedJson ? "Copied" : "Copy JSON"}
                </button>
              </div>
            </div>

            {chat.length === 0 ? (
              <div style={{ padding: "20px 12px", textAlign: "center", color: "var(--textLo)", fontSize: 12, background: "rgba(3,10,25,0.35)", borderRadius: 8 }}>
                Detailed transcript was captured at the policy gate and recorded directly into the audit ledger for this event.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, background: "rgba(3,10,25,0.45)", padding: "12px 14px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.06)" }}>
                {chat.map((t, idx) => (
                  <ChatBubble key={idx} role={t.role} text={t.text} reasoning={t.reasoning} badge={t.badge} />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div style={{ padding: "10px 22px", borderTop: "1px solid rgba(255,255,255,0.08)", background: "rgba(3,10,25,0.6)", display: "flex", justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            aria-label="Close inspector"
            style={{
              background: "var(--teal)",
              color: "#04342C",
              border: "none",
              borderRadius: 6,
              padding: "6px 16px",
              fontWeight: 600,
              fontSize: 12,
              cursor: "pointer",
              fontFamily: "'Space Grotesk', sans-serif",
            }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   MY AGENT DASHBOARD COMPONENT (ADDITIVE SECOND SURFACE)
----------------------------------------------------------------*/

function MyAgentDashboard({ history, currentMandate, onClearHistory }) {
  const [showTrustDetails, setShowTrustDetails] = useState(false);
  const [selectedEventForAudit, setSelectedEventForAudit] = useState(null);
  const [exportRange, setExportRange] = useState("all"); // "all" | "weekly" | "monthly" | "yearly"
  const [downloadSuccess, setDownloadSuccess] = useState(null);

  const metrics = useMemo(() => computeDashboardMetrics(history, currentMandate), [history, currentMandate]);
  const filteredExportData = useMemo(() => getFilteredHistory(history, exportRange), [history, exportRange]);

  function handleDownloadJSON() {
    const jsonStr = exportHistoryJSON(history, exportRange);
    const dateStamp = new Date().toISOString().slice(0, 10);
    const filename = `verve_audit_logs_${exportRange}_${dateStamp}.json`;
    triggerDownload(jsonStr, filename, "application/json");
    setDownloadSuccess("JSON");
    setTimeout(() => setDownloadSuccess(null), 2500);
  }

  function handleDownloadCSV() {
    const csvStr = exportHistoryCSV(history, exportRange);
    const dateStamp = new Date().toISOString().slice(0, 10);
    const filename = `verve_audit_logs_${exportRange}_${dateStamp}.csv`;
    triggerDownload(csvStr, filename, "text/csv");
    setDownloadSuccess("CSV");
    setTimeout(() => setDownloadSuccess(null), 2500);
  }

  return (
    <div style={{ padding: "20px 28px", minHeight: "calc(100vh - 75px)", animation: "slideIn 0.3s ease" }}>
      {/* 1. AGENT PASSPORT / IDENTITY AREA */}
      <div
        style={glass({
          borderRadius: 16,
          padding: "20px 24px",
          marginBottom: 20,
          border: "1px solid rgba(45,212,191,0.35)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 16,
        })}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 12,
              background: "rgba(45,212,191,0.15)",
              border: "1px solid rgba(45,212,191,0.4)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Bot size={24} color="var(--teal)" />
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 20, fontWeight: 700, color: "var(--textHi)" }}>
                Agent Verve-01
              </h2>
              <span
                style={{
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  color: "#2DD4BF",
                  border: "1px solid rgba(45,212,191,0.5)",
                  borderRadius: 20,
                  padding: "2px 8px",
                  background: "rgba(45,212,191,0.12)",
                }}
              >
                VERIFIED &amp; BOUNDED
              </span>
            </div>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "var(--textLo)", marginTop: 4 }}>
              Active Mandate: <span style={{ color: "var(--teal)" }}>{currentMandate ? currentMandate.mandateId : "MND-DEMO"}</span> · Authorized Since: {history.authorizedSince || "Session Start"} · Unauthorized Spending: <span style={{ color: "#4ADE80" }}>₹0</span>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 10, color: "var(--textLo)", letterSpacing: "0.08em" }}>BEHAVIORAL TRUST SCORE</div>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 24, fontWeight: 700, color: "#8FE0A8" }}>
              {metrics.trustScore.score} <span style={{ fontSize: 13, color: "var(--textLo)" }}>/ 100</span>
            </div>
          </div>
          <button
            onClick={onClearHistory}
            title="Reset history and analytics to clean zero state"
            aria-label="Reset history and analytics to clean zero state"
            style={glass({
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.14)",
              color: "var(--textLo)",
              borderRadius: 8,
              padding: "8px 12px",
              fontSize: 11,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 5,
              boxShadow: "none",
            })}
          >
            <RotateCcw size={12} /> Clear History
          </button>
        </div>
      </div>

      {/* 2. SPENDING OVERVIEW KPIS */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14, marginBottom: 20 }}>
        <div style={glass({ borderRadius: 12, padding: "16px 18px" })}>
          <div style={{ fontSize: 11, color: "var(--textLo)", letterSpacing: "0.06em", display: "flex", alignItems: "center", gap: 6 }}>
            <Clock size={13} color="var(--teal)" /> SPEND THIS MONTH
          </div>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 22, fontWeight: 700, color: "var(--textHi)", marginTop: 8 }}>
            {inr(metrics.spendThisMonth)}
          </div>
          <div style={{ fontSize: 10.5, color: "var(--textLo)", marginTop: 4 }}>Current calendar month</div>
        </div>

        <div style={glass({ borderRadius: 12, padding: "16px 18px" })}>
          <div style={{ fontSize: 11, color: "var(--textLo)", letterSpacing: "0.06em", display: "flex", alignItems: "center", gap: 6 }}>
            <BarChart3 size={13} color="var(--rzpBlue)" /> SPEND THIS YEAR
          </div>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 22, fontWeight: 700, color: "var(--textHi)", marginTop: 8 }}>
            {inr(metrics.spendThisYear)}
          </div>
          <div style={{ fontSize: 10.5, color: "var(--textLo)", marginTop: 4 }}>Annual total ({new Date().getFullYear()})</div>
        </div>

        <div style={glass({ borderRadius: 12, padding: "16px 18px" })}>
          <div style={{ fontSize: 11, color: "var(--textLo)", letterSpacing: "0.06em", display: "flex", alignItems: "center", gap: 6 }}>
            <ShieldCheck size={13} color="#8FE0A8" /> LIFETIME SPEND
          </div>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 22, fontWeight: 700, color: "#8FE0A8", marginTop: 8 }}>
            {inr(metrics.lifetimeSpend)}
          </div>
          <div style={{ fontSize: 10.5, color: "var(--textLo)", marginTop: 4 }}>{metrics.completedOrders} completed orders</div>
        </div>

        <div style={glass({ borderRadius: 12, padding: "16px 18px" })}>
          <div style={{ fontSize: 11, color: "var(--textLo)", letterSpacing: "0.06em", display: "flex", alignItems: "center", gap: 6 }}>
            <Receipt size={13} color="var(--teal)" /> AVERAGE ORDER VALUE
          </div>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 22, fontWeight: 700, color: "var(--textHi)", marginTop: 8 }}>
            {inr(metrics.averageOrderValue)}
          </div>
          <div style={{ fontSize: 10.5, color: "var(--textLo)", marginTop: 4 }}>Across captured purchases</div>
        </div>

        <div style={glass({ borderRadius: 12, padding: "16px 18px", border: "1px solid rgba(51,149,255,0.35)", background: "rgba(51,149,255,0.06)" })}>
          <div style={{ fontSize: 11, color: "var(--rzpBlue)", letterSpacing: "0.06em", display: "flex", alignItems: "center", gap: 6 }}>
            <Shield size={13} /> POTENTIAL SPEND PREVENTED
          </div>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 22, fontWeight: 700, color: "#7FC0FF", marginTop: 8 }}>
            {inr(metrics.potentialSpendPrevented)}
          </div>
          <div style={{ fontSize: 10.5, color: "var(--textLo)", marginTop: 4 }}>By deterministic guardrails</div>
        </div>
      </div>

      {/* 3. MIDDLE ROW: TRUST SCORE DETAILS & MANDATE UTILIZATION */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: 16, marginBottom: 20 }}>
        {/* TRUST SCORE DETAILS CARD */}
        <div style={glass({ borderRadius: 14, padding: "18px 20px" })}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 14, fontWeight: 600, color: "var(--textHi)", display: "flex", alignItems: "center", gap: 8 }}>
              <Sparkles size={16} color="var(--teal)" /> Behavioral Trust Analysis
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button
                onClick={() => setShowTrustDetails(!showTrustDetails)}
                style={{
                  background: showTrustDetails ? "rgba(45,212,191,0.2)" : "rgba(255,255,255,0.06)",
                  border: `1px solid ${showTrustDetails ? "rgba(45,212,191,0.5)" : "rgba(255,255,255,0.14)"}`,
                  color: showTrustDetails ? "#8FEFE2" : "var(--textLo)",
                  borderRadius: 6,
                  padding: "3px 8px",
                  fontSize: 10.5,
                  cursor: "pointer",
                  fontFamily: "'IBM Plex Mono', monospace",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
                aria-label="Toggle Trust Score Calculation breakdown"
              >
                <ShieldCheck size={11} /> {showTrustDetails ? "Hide Pillars" : "How it's computed"}
              </button>
              <span
                style={{
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 10.5,
                  fontWeight: 700,
                  color: "#8FE0A8",
                  border: "1px solid rgba(78,205,131,0.4)",
                  padding: "2px 8px",
                  borderRadius: 4,
                  background: "rgba(78,205,131,0.12)",
                }}
              >
                {metrics.trustScore.rating}
              </span>
            </div>
          </div>

          <div style={{ fontSize: 12.5, color: "var(--textHi)", lineHeight: 1.55, marginBottom: 14 }}>
            {metrics.trustScore.summary}
          </div>

          {/* Expandable Trust Pillars Breakdown */}
          {showTrustDetails && (
            <div
              style={{
                marginBottom: 14,
                padding: "12px 14px",
                borderRadius: 8,
                background: "rgba(3,10,25,0.6)",
                border: "1px solid rgba(45,212,191,0.3)",
                fontSize: 11,
                color: "var(--textHi)",
                lineHeight: 1.6,
                fontFamily: "'IBM Plex Mono', monospace",
                animation: "slideIn 0.2s ease",
              }}
            >
              <div style={{ color: "var(--teal)", fontWeight: 700, marginBottom: 6 }}>
                TRUST SCORE CALCULATION PILLARS (100 BASE):
              </div>
              <div>• 🛡️ Zero Unauthorized Spend: 100/100 (Instant -40 if breached)</div>
              <div>• 📜 Mandate Ceiling Adherence: Enforces hard limit before API call</div>
              <div>• ⚖️ Policy Guardrail Integrity: 7 synchronous boundary checks</div>
              <div>• 👤 Human Review Obedience: Immediate abort on supervisor denial</div>
              <div>• 🔁 Bounded Payment Recovery: Max 1 retry test card policy</div>
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {metrics.trustScore.factors.map((f, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5 }}>
                <CheckCircle2 size={13} color="#4ADE80" />
                <span style={{ color: "var(--textHi)" }}>{f.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* CURRENT MANDATE UTILIZATION CARD */}
        <div style={glass({ borderRadius: 14, padding: "18px 20px" })}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 14, fontWeight: 600, color: "var(--textHi)", display: "flex", alignItems: "center", gap: 8 }}>
              <FileCheck2 size={16} color="var(--teal)" /> Active Mandate Utilization
            </div>
            <span style={{ fontSize: 10.5, color: "var(--teal)", fontFamily: "'IBM Plex Mono', monospace", background: "rgba(45,212,191,0.12)", border: "1px solid rgba(45,212,191,0.3)", padding: "2px 8px", borderRadius: 4 }}>
              {metrics.mandateUtilizationPercent}% USED
            </span>
          </div>

          <div style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--textLo)", marginBottom: 6 }}>
              <span>Session Spend: {inr(metrics.currentMandateSpend)}</span>
              <span>Ceiling: {inr(metrics.mandateAuthorized)}</span>
            </div>
            <div style={{ width: "100%", height: 8, borderRadius: 4, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
              <div
                style={{
                  width: `${metrics.mandateUtilizationPercent}%`,
                  height: "100%",
                  background: metrics.mandateUtilizationPercent > 80 ? "var(--red)" : "var(--teal)",
                  borderRadius: 4,
                  transition: "width 0.4s ease",
                }}
              />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, textAlign: "center" }}>
            <div style={{ background: "rgba(3,10,25,0.4)", padding: "8px 10px", borderRadius: 8 }}>
              <div style={{ fontSize: 10, color: "var(--textLo)" }}>Authorized</div>
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 13.5, fontWeight: 600, color: "var(--textHi)", marginTop: 2 }}>
                {inr(metrics.mandateAuthorized)}
              </div>
            </div>
            <div style={{ background: "rgba(3,10,25,0.4)", padding: "8px 10px", borderRadius: 8 }}>
              <div style={{ fontSize: 10, color: "var(--textLo)" }}>Used (Session)</div>
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 13.5, fontWeight: 600, color: "var(--teal)", marginTop: 2 }}>
                {inr(metrics.currentMandateSpend)}
              </div>
            </div>
            <div style={{ background: "rgba(3,10,25,0.4)", padding: "8px 10px", borderRadius: 8 }}>
              <div style={{ fontSize: 10, color: "var(--textLo)" }}>Remaining</div>
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 13.5, fontWeight: 600, color: "#8FE0A8", marginTop: 2 }}>
                {inr(metrics.mandateRemaining)}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 5. DOWNLOAD AUDIT LOGS CONTROL CARD */}
      <div
        style={glass({
          borderRadius: 14,
          padding: "16px 20px",
          marginBottom: 20,
          border: "1px solid rgba(51,149,255,0.3)",
          background: "rgba(51,149,255,0.05)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 14,
        })}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              background: "rgba(51,149,255,0.15)",
              border: "1px solid rgba(51,149,255,0.4)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Download size={18} color="var(--rzpBlue)" />
          </div>
          <div>
            <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 14, fontWeight: 700, color: "var(--textHi)" }}>
              Download Audit History Logs
            </div>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "var(--textLo)", marginTop: 2 }}>
              {filteredExportData.events.length} event(s) · {filteredExportData.transactions.length} paid transaction(s) in selected range
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {/* Time Range Selector */}
          <div style={{ display: "flex", gap: 4, background: "rgba(3,10,25,0.45)", padding: "3px 4px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)" }}>
            {[
              { id: "all", label: "All Time (Since Reset)" },
              { id: "weekly", label: "Past 7 Days" },
              { id: "monthly", label: "Past 30 Days" },
              { id: "yearly", label: "This Year" },
            ].map((r) => (
              <button
                key={r.id}
                onClick={() => setExportRange(r.id)}
                style={{
                  background: exportRange === r.id ? "rgba(51,149,255,0.25)" : "transparent",
                  color: exportRange === r.id ? "#8ECCFF" : "var(--textLo)",
                  border: `1px solid ${exportRange === r.id ? "rgba(51,149,255,0.5)" : "transparent"}`,
                  borderRadius: 6,
                  padding: "4px 8px",
                  fontSize: 10.5,
                  cursor: "pointer",
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontWeight: exportRange === r.id ? 700 : 400,
                }}
              >
                {r.label}
              </button>
            ))}
          </div>

          {/* Download Buttons */}
          <button
            onClick={handleDownloadJSON}
            disabled={filteredExportData.events.length === 0}
            aria-label="Download Audit Logs in JSON format"
            style={{
              background: "rgba(51,149,255,0.18)",
              border: "1px solid rgba(51,149,255,0.45)",
              color: "#8ECCFF",
              borderRadius: 8,
              padding: "7px 12px",
              fontSize: 11,
              fontWeight: 600,
              cursor: filteredExportData.events.length === 0 ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              gap: 5,
              opacity: filteredExportData.events.length === 0 ? 0.5 : 1,
              fontFamily: "'Space Grotesk', sans-serif",
            }}
          >
            {downloadSuccess === "JSON" ? <Check size={13} /> : <FileText size={13} />}
            {downloadSuccess === "JSON" ? "Downloaded JSON" : "Download JSON"}
          </button>

          <button
            onClick={handleDownloadCSV}
            disabled={filteredExportData.events.length === 0}
            aria-label="Download Audit Logs in CSV format"
            style={{
              background: "rgba(45,212,191,0.18)",
              border: "1px solid rgba(45,212,191,0.45)",
              color: "#8FEFE2",
              borderRadius: 8,
              padding: "7px 12px",
              fontSize: 11,
              fontWeight: 600,
              cursor: filteredExportData.events.length === 0 ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              gap: 5,
              opacity: filteredExportData.events.length === 0 ? 0.5 : 1,
              fontFamily: "'Space Grotesk', sans-serif",
            }}
          >
            {downloadSuccess === "CSV" ? <Check size={13} /> : <FileSpreadsheet size={13} />}
            {downloadSuccess === "CSV" ? "Downloaded CSV" : "Download CSV"}
          </button>
        </div>
      </div>

      {/* 6. TRANSACTION TIMELINE (CLICKABLE WITH CHAT AUDIT MODAL) */}
      <div style={glass({ borderRadius: 14, padding: "18px 20px" })}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 14, fontWeight: 600, color: "var(--textHi)", display: "flex", alignItems: "center", gap: 8 }}>
            <Receipt size={16} color="var(--teal)" /> Chronological Decision Timeline
          </div>
          <span style={{ fontSize: 10.5, color: "var(--textLo)", fontFamily: "'IBM Plex Mono', monospace" }}>
            Click any entry to inspect the original AI chat &amp; decision audit
          </span>
        </div>

        {metrics.timeline.length === 0 ? (
          <div style={{ padding: "40px 10px", textAlign: "center", color: "var(--textLo)", fontSize: 13, lineHeight: 1.6 }}>
            No transaction history yet. Run your first agent checkout to start building your agent history.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {metrics.timeline.map((evt) => (
              <div
                key={evt.id}
                onClick={() => setSelectedEventForAudit(evt)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setSelectedEventForAudit(evt); }}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "11px 14px",
                  borderRadius: 8,
                  background: "rgba(3,10,25,0.38)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(45,212,191,0.08)";
                  e.currentTarget.style.borderColor = "rgba(45,212,191,0.35)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(3,10,25,0.38)";
                  e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)";
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "var(--textLo)" }}>
                    {evt.timeFormatted}
                  </span>
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--textHi)", fontFamily: "Inter, sans-serif", display: "flex", alignItems: "center", gap: 8 }}>
                      {evt.title}
                      {Array.isArray(evt.chatTranscript) && evt.chatTranscript.length > 0 && (
                        <span style={{ fontSize: 9.5, fontFamily: "'IBM Plex Mono', monospace", color: "var(--teal)", background: "rgba(45,212,191,0.12)", border: "1px solid rgba(45,212,191,0.3)", borderRadius: 4, padding: "1px 5px", display: "inline-flex", alignItems: "center", gap: 3 }}>
                          <MessageSquare size={9} /> {evt.chatTranscript.length} chats
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 10, color: "var(--textLo)", fontFamily: "'IBM Plex Mono', monospace", marginTop: 2, display: "flex", alignItems: "center", gap: 6 }}>
                      {evt.mandateId && <span>Mandate: {evt.mandateId} {evt.humanApproved && "· Supervisor Approved"} · </span>}
                      <span style={{ color: "#8FEFE2" }}>Click to view full transcript &rarr;</span>
                    </div>
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  {evt.amount > 0 && (
                    <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12.5, color: evt.status === "PAID" ? "var(--teal)" : "var(--textLo)" }}>
                      {inr(evt.amount)}
                    </span>
                  )}
                  <Stamp status={evt.status} />
                  <ChevronRight size={14} color="var(--textLo)" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Decision & Chat Audit Modal */}
      {selectedEventForAudit && (
        <DecisionAuditModal
          event={selectedEventForAudit}
          onClose={() => setSelectedEventForAudit(null)}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------
   MAIN APPLICATION
----------------------------------------------------------------*/

export default function AgenticCheckoutDemo() {
  const [activeTab, setActiveTab] = useState("checkout"); // "checkout" | "dashboard"
  const [goal, setGoal] = useState(PRESETS[0].goal);
  const [budget, setBudget] = useState(PRESETS[0].budget);
  const [upsellCapPercent, setUpsellCapPercent] = useState(0.20);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [transcript, setTranscript] = useState([]);
  const [ledger, setLedger] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [ruleResults, setRuleResults] = useState({});
  const [receipt, setReceipt] = useState(null);

  // Scalable Catalog Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");

  // Persistent Client-Side History (zero synthetic data on start)
  const [history, setHistory] = useState(() => loadHistory());

  // Additive Feature: AP2-inspired Mandate
  const [mandate, setMandate] = useState(() => generateDemoMandate("BUYER-01", PRESETS[0].budget));

  // Additive Feature: Human Escalation Checkpoint
  const [awaitingApproval, setAwaitingApproval] = useState(null);

  // Additive Feature: Merchant Revenue Attribution Metrics (Cumulative across runs)
  const [revenueStats, setRevenueStats] = useState({
    offers: 0,
    accepted: 0,
    realizedRevenue: 0,
    completedOrders: 0,
  });

  const ledgerEndRef = useRef(null);

  useEffect(() => {
    ledgerEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [ledger]);

  // Sync mandate with budget changes
  useEffect(() => {
    setMandate(generateDemoMandate("BUYER-01", budget));
  }, [budget]);

  // Dynamic policy rules based on configured upsell cap percent
  const activeRules = useMemo(() => [
    { id: "budget", label: "Order total within stated budget", check: (ctx) => ctx.total <= ctx.budget },
    { id: "cap", label: "Order total under merchant hard cap (₹6,000)", check: (ctx) => ctx.total <= 6000 },
    { id: "category", label: "All items within allowed categories", check: (ctx) => ctx.items.every((i) => ALLOWED_CATEGORIES.includes(i.category)) },
    { id: "upsell_count", label: "At most one upsell offer per session", check: (ctx) => ctx.upsellCount <= 1 },
    { id: "upsell_value", label: `Upsell value ≤ ${Math.round(upsellCapPercent * 100)}% of cart subtotal`, check: (ctx) => !ctx.upsellPrice || ctx.upsellPrice <= ctx.subtotal * (ctx.upsellCapPercent || upsellCapPercent) },
    { id: "mandate_cap", label: "Within signed buyer mandate limit", check: (ctx) => !ctx.mandate || ctx.total <= ctx.mandate.maxAmount },
    { id: "mandate_category", label: "Items permitted by buyer mandate", check: (ctx) => !ctx.mandate || ctx.items.every((i) => ctx.mandate.allowedCategories.includes(i.category)) },
  ], [upsellCapPercent]);

  // Scalable Catalog Filters
  const [visibleCatalogCount, setVisibleCatalogCount] = useState(48);

  const filteredCatalog = useMemo(() => {
    return CATALOG.filter((p) => {
      const matchCat = selectedCategory === "all" || p.category === selectedCategory;
      const matchSearch = !searchQuery || p.name.toLowerCase().includes(searchQuery.toLowerCase()) || p.category.toLowerCase().includes(searchQuery.toLowerCase());
      return matchCat && matchSearch;
    });
  }, [searchQuery, selectedCategory]);

  function addLedger(actor, action, detail, status) {
    setLedger((prev) => [...prev, { time: nowStamp(), actor, action, detail, status }]);
  }

  async function runScenario() {
    setRunning(true);
    setDone(false);
    setAwaitingApproval(null);
    setTranscript([]);
    setLedger([]);
    setSelectedIds([]);
    setRuleResults({});
    setReceipt(null);

    const localTranscript = [];
    function addChat(role, text, reasoning, badge) {
      const item = { role, text, reasoning, badge };
      localTranscript.push(item);
      setTranscript((prev) => [...prev, item]);
    }

    // Fresh session mandate
    const currentMandate = generateDemoMandate("BUYER-01", budget);
    setMandate(currentMandate);

    addLedger("SYSTEM", "SESSION STARTED", `goal="${goal}" · budget=${inr(budget)} · mandate=${currentMandate.mandateId}`, "LOGGED");
    await sleep(500);

    // STEP 1 — Whole-Catalog Semantic Search & Intent Understanding
    addChat("system", `buyer agent is searching all ${CATALOG.length} catalog items for matching domain, use-case & constraints…`);
    await sleep(600);

    // Run semantic ranking across the entire 500-item catalog
    const { selection: rankedFallbackSelection, conversationalWhy, topCandidates, isGift, isExploration } = semanticSearchCatalog(goal, budget);

    const candidateSummary = topCandidates
      .slice(0, 15)
      .map((p) => `${p.id}: ${p.name} — ${inr(p.price)} (${p.category}) [${p.description}]`)
      .join("\n");

    const buyerSel = await callClaude(
      `You are an autonomous AI buyer agent for Verve & Co.
Analyze the user's shopping goal, budget, and top relevant products from the 500-item catalog.
Choose the optimal product or complementary combination (max 3 items) that best fulfills the goal within budget.
Respond with JSON only:
{
  "selection": [{"id": "...", "qty": 1}],
  "reasoning": "1-2 concise sentences explaining why this specific product/combination was chosen based on the user's intent."
}`,
      `Goal: ${goal}\nBudget: ₹${budget}\nTop Relevant Catalog Items:\n${candidateSummary}`,
      {
        selection: rankedFallbackSelection,
        reasoning: conversationalWhy,
      }
    );

    const selection = (buyerSel.selection || []).filter((s) => CATALOG.find((p) => p.id === s.id));
    const finalSelection = selection.length > 0 ? selection : rankedFallbackSelection;
    setSelectedIds(finalSelection.map((s) => s.id));
    const cartItems = finalSelection.map((s) => ({ ...CATALOG.find((p) => p.id === s.id), qty: s.qty || 1 }));
    const subtotal = cartItems.reduce((sum, i) => sum + i.price * i.qty, 0);

    // Contextual chat message from buyer agent
    const buyerIntro = isExploration
      ? `After exploring the available options, I recommend ${cartItems.map((i) => i.name).join(", ")} — total ${inr(subtotal)}.`
      : `I'll go with ${cartItems.map((i) => i.name).join(", ")} — total ${inr(subtotal)}.`;

    addChat("buyer", buyerIntro, buyerSel.reasoning || conversationalWhy);
    addLedger("BUYER AGENT", "CATALOG QUERY + SELECTION", `chose [${cartItems.map((i) => i.id).join(", ")}] · subtotal ${inr(subtotal)} · why: ${buyerSel.reasoning || conversationalWhy}`, "LOGGED");
    await sleep(700);

    // STEP 2 — Merchant Agent Intelligent Cross-Sell & Upsell
    // Evaluates both the 500-product catalog and canonical gifting add-ons for genuine complementarity
    addChat("system", "merchant agent is evaluating the catalog for genuinely useful complementary items…");
    await sleep(600);

    const defaultMerchantRec = findMerchantComplementaryRecommendation(goal, cartItems, subtotal, budget, currentMandate, upsellCapPercent);
    const eligiblePool = defaultMerchantRec.topEligible || [];
    const capLabel = `${Math.round(upsellCapPercent * 100)}%`;
    const merchantCandidateSummary = eligiblePool.length > 0
      ? eligiblePool.map((c) => `${c.id}: ${c.name} — ${inr(c.price)} (${c.isGiftingAddon ? "gifting add-on" : c.category})`).join("\n")
      : `No items clear the ${capLabel} cart cap.`;

    const merchantOffer = await callClaude(
      `You are the merchant's selling agent for Verve & Co.
Analyze the buyer's cart and stated goal.
Ask: Is there exactly ONE genuinely useful complementary product or add-on (either a gift add-on or a complementary item from the catalog) that meaningfully improves this purchase?
Constraints:
- At most 1 item.
- Price must be <= ${capLabel} of cart subtotal (₹${Math.floor(subtotal * upsellCapPercent)}) AND fit within remaining budget.
- If there is NO genuinely useful complement, return {"offer": null, "reasoning": "contextual explanation why no recommendation was made"}.
- If there IS a genuinely useful complement, return {"offer": {"id": "..."}, "reasoning": "contextual sentence explaining why this complements the specific setup"}.
Do NOT force an offer if nothing genuinely adds value.`,
      `Goal: ${goal}\nCart: ${cartItems.map((i) => i.name).join(", ")}\nSubtotal: ₹${subtotal}\nEligible complementary items (≤${capLabel} cap):\n${merchantCandidateSummary}`,
      {
        offer: defaultMerchantRec.recommendation ? { id: defaultMerchantRec.recommendation.id } : null,
        reasoning: defaultMerchantRec.reasoning,
      }
    );

    // Look up the offered item in either UPSELLS or CATALOG
    let upsellItem = null;
    let isCrossSell = false;

    if (merchantOffer.offer && merchantOffer.offer.id) {
      const fromUpsells = UPSELLS.find((u) => u.id === merchantOffer.offer.id);
      const fromCatalog = CATALOG.find((p) => p.id === merchantOffer.offer.id && !cartItems.some((i) => i.id === p.id));
      
      if (fromUpsells && fromUpsells.price <= subtotal * upsellCapPercent) {
        upsellItem = { ...fromUpsells, isCrossSell: false };
        isCrossSell = false;
      } else if (fromCatalog && fromCatalog.price <= subtotal * upsellCapPercent) {
        upsellItem = { ...fromCatalog, isCrossSell: true };
        isCrossSell = true;
      }
    }

    let upsellAccepted = false;
    let upsellCount = upsellItem ? 1 : 0;

    if (upsellItem) {
      const offerTypeLabel = isCrossSell ? "CROSS-SELL OFFER" : "GIFT UPSELL OFFER";
      const offerBadge = {
        label: isCrossSell ? "🔁 CROSS-SELL" : "🎁 GIFT UPSELL",
        type: isCrossSell ? "cross-sell" : "upsell",
      };
      setRevenueStats((prev) => ({ ...prev, offers: prev.offers + 1 }));
      setHistory((prev) => recordLifecycleEvent(prev, {
        type: "UPSELL_OFFER",
        title: `${isCrossSell ? "Cross-sell" : "Upsell"} offered: ${upsellItem.name}`,
        amount: upsellItem.price,
        mandateId: currentMandate.mandateId,
        chatTranscript: [...localTranscript],
      }));

      addChat("merchant", `Would you like to add ${upsellItem.name} for ${inr(upsellItem.price)}?`, merchantOffer.reasoning, offerBadge);
      addLedger("MERCHANT AGENT", offerTypeLabel, `offered ${upsellItem.name} (${inr(upsellItem.price)}) · within ${capLabel} cap · why: ${merchantOffer.reasoning}`, "LOGGED");
      await sleep(700);

      addChat("system", "buyer agent is evaluating complementary value and remaining budget headroom…");
      await sleep(500);
      const headroom = Math.min(budget, currentMandate.maxAmount) - subtotal;

      // Buyer decision based on genuine relevance & headroom
      const buyerDecision = await callClaude(
        `You are the autonomous buyer agent. The merchant recommended a complementary item: "${upsellItem.name}" (${inr(upsellItem.price)}).
Decide whether to accept based on:
1. Does it genuinely help with the original goal?
2. Is it within the remaining headroom (₹${headroom})?
Respond with JSON: {"accept": true/false, "reasoning": "short natural sentence"}`,
        `Original goal: ${goal}\nOffered complement: ${upsellItem.name} — ₹${upsellItem.price}\nRemaining headroom: ₹${headroom}`,
        {
          accept: upsellItem.price <= headroom,
          reasoning: upsellItem.price <= headroom
            ? `Adding the ${upsellItem.name} completes the setup nicely within remaining budget.`
            : "Declining add-on as the main items already fulfill my goal.",
        }
      );

      upsellAccepted = !!buyerDecision.accept && upsellItem.price <= headroom;
      const decisionTypeLabel = isCrossSell ? "CROSS-SELL DECISION" : "UPSELL DECISION";
      const decisionBadge = {
        label: isCrossSell ? (upsellAccepted ? "🔁 CROSS-SELL ACCEPTED" : "🔁 CROSS-SELL SKIPPED") : (upsellAccepted ? "🎁 UPSELL ACCEPTED" : "🎁 UPSELL SKIPPED"),
        type: upsellAccepted ? (isCrossSell ? "cross-sell" : "upsell") : "neutral",
      };

      if (upsellAccepted) {
        setRevenueStats((prev) => ({ ...prev, accepted: prev.accepted + 1 }));
        setHistory((prev) => recordLifecycleEvent(prev, {
          type: "UPSELL_ACCEPT",
          title: `${isCrossSell ? "Cross-sell" : "Upsell"} accepted: ${upsellItem.name}`,
          amount: upsellItem.price,
          mandateId: currentMandate.mandateId,
          chatTranscript: [...localTranscript],
        }));
        addChat("buyer", `Sure, add the ${upsellItem.name}.`, buyerDecision.reasoning, decisionBadge);
        addLedger("BUYER AGENT", decisionTypeLabel, `accepted offer · why: ${buyerDecision.reasoning}`, "LOGGED");
      } else {
        setHistory((prev) => recordLifecycleEvent(prev, {
          type: "UPSELL_DECLINE",
          title: `${isCrossSell ? "Cross-sell" : "Upsell"} declined: ${upsellItem.name}`,
          amount: upsellItem.price,
          mandateId: currentMandate.mandateId,
          chatTranscript: [...localTranscript],
        }));
        addChat("buyer", `I'll skip the ${upsellItem.name} this time.`, buyerDecision.reasoning, decisionBadge);
        addLedger("BUYER AGENT", decisionTypeLabel, `declined offer · why: ${buyerDecision.reasoning}`, "LOGGED");
      }
      await sleep(700);
    } else {
      // Legitimate contextual NO OFFER outcome
      const noOfferReason = merchantOffer.reasoning || defaultMerchantRec.reasoning;
      addChat("merchant", noOfferReason, `Merchant agent evaluated catalog and confirmed current selection is optimal without add-ons within ${capLabel} cap.`, { label: "🛡️ NO ADD-ON NEEDED", type: "neutral" });
      addLedger("MERCHANT AGENT", "COMPLEMENTARY EVALUATION", `no offer made · why: ${noOfferReason}`, "LOGGED");
      await sleep(600);
    }

    const total = subtotal + (upsellAccepted ? upsellItem.price : 0);

    // STEP 3 — Policy gate with Mandate
    addChat("gate", `policy gate evaluating transaction against merchant rules & mandate ${currentMandate.mandateId}…`);
    await sleep(500);
    const ctx = { total, budget, items: cartItems, upsellCount, upsellPrice: upsellAccepted ? upsellItem.price : 0, subtotal, mandate: currentMandate, upsellCapPercent };
    const results = {};
    for (const rule of activeRules) {
      results[rule.id] = rule.check(ctx);
      setRuleResults((prev) => ({ ...prev, [rule.id]: results[rule.id] }));
      await sleep(200);
    }
    const allPass = Object.values(results).every(Boolean);
    const needsEscalation = total > 5000 && total <= 6000 && allPass;
    const finalGate = !allPass ? "BLOCKED" : needsEscalation ? "ESCALATED" : "APPROVED";
    const failedRules = activeRules.filter((r) => !results[r.id]).map((r) => r.label);

    const gateReasoning = !allPass
      ? `Blocked because: ${failedRules.join("; ")}.`
      : needsEscalation
      ? `All ${activeRules.length} guardrails passed, but total ${inr(total)} exceeds the ₹5,000 auto-approve threshold, routing to human reviewer under mandate ${currentMandate.mandateId}.`
      : `All ${activeRules.length} guardrails passed and total ${inr(total)} is within both buyer's signed mandate (${currentMandate.mandateId}) and merchant hard cap — cleared to transact autonomously.`;

    addLedger("POLICY GATE", `GATE DECISION: ${finalGate}`, `total ${inr(total)} · rules passed ${Object.values(results).filter(Boolean).length}/${activeRules.length} · mandate ${currentMandate.mandateId} verified`, finalGate);
    addChat("gate", `Gate result: ${finalGate}.`, gateReasoning);
    await sleep(700);

    if (finalGate === "BLOCKED") {
      setRunning(false);
      setDone(true);
      // Record real blocked event into analytics with full transcript
      setHistory((prev) =>
        recordLifecycleEvent(prev, {
          type: "BLOCKED",
          title: `Blocked: ${failedRules.join(", ")}`,
          amount: total,
          mandateId: currentMandate.mandateId,
          status: "BLOCKED",
          reasoning: gateReasoning,
          chatTranscript: [...localTranscript],
        })
      );
      return;
    }

    // STEP 3.5 — Human Escalation Interception
    if (finalGate === "ESCALATED") {
      setRunning(false);
      setAwaitingApproval({
        orderContext: {
          items: cartItems,
          upsellItem: upsellAccepted ? upsellItem : null,
          total,
          budget,
          mandate: currentMandate,
          chatTranscript: [...localTranscript],
          reasoning: gateReasoning,
        },
      });
      setHistory((prev) =>
        recordLifecycleEvent(prev, {
          type: "ESCALATED",
          title: `Escalated to supervisor (Order ${inr(total)})`,
          amount: total,
          mandateId: currentMandate.mandateId,
          status: "ESCALATED",
          reasoning: gateReasoning,
          chatTranscript: [...localTranscript],
        })
      );
      addChat("gate", "Paused awaiting human approval.", "Total exceeds autonomous limit (₹5,000). Human reviewer must sign off before payments API is called.");
      return;
    }

    // Normal Approved Path continues to payment
    await executePaymentFlow(cartItems, upsellAccepted ? upsellItem : null, total, "APPROVED", false, currentMandate, [...localTranscript], gateReasoning);
  }

  /* Continues execution after human approval */
  async function handleHumanDecision(approve) {
    if (!awaitingApproval) return;
    const { items, upsellItem, total, mandate: approvedMandate, chatTranscript: existingTranscript = [], reasoning = "" } = awaitingApproval.orderContext;
    setAwaitingApproval(null);

    if (approve) {
      setRunning(true);
      const approveChat = { role: "gate", text: "Human reviewer APPROVED the transaction.", reasoning: "Reviewer verified legitimate customer intent and authorized payment execution." };
      setTranscript((prev) => [...prev, approveChat]);
      addLedger("HUMAN REVIEW", "APPROVED BY HUMAN", `transaction cleared by supervisor · mandate ${approvedMandate.mandateId}`, "APPROVED");
      
      const updatedTranscript = [...existingTranscript, approveChat];
      setHistory((prev) =>
        recordLifecycleEvent(prev, {
          type: "HUMAN_APPROVE",
          title: `Approved by human supervisor (${inr(total)})`,
          amount: total,
          mandateId: approvedMandate.mandateId,
          status: "APPROVED",
          reasoning: "Reviewer verified legitimate customer intent and authorized payment execution.",
          chatTranscript: updatedTranscript,
        })
      );
      await sleep(600);
      await executePaymentFlow(items, upsellItem, total, "PAID", true, approvedMandate, updatedTranscript, reasoning);
    } else {
      setRunning(false);
      setDone(true);
      const denyChat = { role: "gate", text: "Human reviewer DENIED the transaction.", reasoning: "Transaction aborted by supervisor — no payment created." };
      setTranscript((prev) => [...prev, denyChat]);
      addLedger("HUMAN REVIEW", "BLOCKED — HUMAN DENIED", "high-value transaction rejected by reviewer", "BLOCKED");
      setHistory((prev) =>
        recordLifecycleEvent(prev, {
          type: "HUMAN_DENY",
          title: `Denied by human supervisor (${inr(total)})`,
          amount: total,
          mandateId: approvedMandate.mandateId,
          status: "BLOCKED",
          reasoning: "Transaction aborted by supervisor — no payment created.",
          chatTranscript: [...existingTranscript, denyChat],
        })
      );
    }
  }

  /* STEP 4 — Order + Payment with Deliberate Failure & Bounded Recovery */
  async function executePaymentFlow(cartItems, upsellItem, total, statusBadge, humanApproved = false, activeMandate = null, finalChats = [], decisionReasoning = "") {
    const orderId = "order_TESTMODE" + Math.random().toString(36).slice(2, 8).toUpperCase();
    const payChats = [...finalChats];

    function logPayChat(role, text, reasoning, badge) {
      const item = { role, text, reasoning, badge };
      payChats.push(item);
      setTranscript((prev) => [...prev, item]);
    }

    logPayChat("system", "creating Razorpay order in test mode…");
    addLedger("RAZORPAY (TEST MODE)", "ORDER CREATED", `${orderId} · amount ${inr(total)}${humanApproved ? " · (human approved)" : ""}`, "LOGGED");
    await sleep(700);

    logPayChat("system", "attempting payment — test card ending 1111…");
    await sleep(800);
    addLedger("RAZORPAY (TEST MODE)", "PAYMENT ATTEMPT #1 — DECLINED", "reason: test_card_declined (simulated insufficient funds)", "DECLINED");
    await sleep(700);

    logPayChat("merchant", "Payment didn't go through. Retrying with backup test payment method — no need to redo your order.", "Retry is within the bounded recovery policy (max one automatic retry, same order, no re-confirmation needed since cart is unchanged).");
    addLedger("MERCHANT AGENT", "RECOVERY ACTION", "auto-retry authorized within bounds · switching to backup test instrument", "LOGGED");
    await sleep(800);

    const paymentId = "pay_TESTMODE" + Math.random().toString(36).slice(2, 8).toUpperCase();
    addLedger("RAZORPAY (TEST MODE)", "PAYMENT ATTEMPT #2 — CAPTURED", `${paymentId} · amount ${inr(total)}`, "PAID");
    logPayChat("system", "payment captured successfully.");
    await sleep(500);

    // Attribute realized revenue only on successful capture
    if (upsellItem) {
      setRevenueStats((prev) => ({
        ...prev,
        realizedRevenue: prev.realizedRevenue + upsellItem.price,
        completedOrders: prev.completedOrders + 1,
      }));
    } else {
      setRevenueStats((prev) => ({ ...prev, completedOrders: prev.completedOrders + 1 }));
    }

    // Record real completed transaction into client-side analytics with full transcript
    setHistory((prev) =>
      recordCompletedPurchase(prev, {
        orderId,
        paymentId,
        items: cartItems,
        upsell: upsellItem,
        total,
        mandate: activeMandate || mandate,
        humanApproved,
        chatTranscript: payChats,
        reasoning: decisionReasoning,
      })
    );

    setReceipt({
      orderId,
      paymentId,
      items: cartItems,
      upsell: upsellItem,
      total,
      status: "PAID",
      humanApproved,
    });
    setRunning(false);
    setDone(true);
  }

  function reset() {
    setRunning(false);
    setDone(false);
    setAwaitingApproval(null);
    setTranscript([]);
    setLedger([]);
    setSelectedIds([]);
    setRuleResults({});
    setReceipt(null);
  }

  function resetRevenueMetrics() {
    setRevenueStats({ offers: 0, accepted: 0, realizedRevenue: 0, completedOrders: 0 });
  }

  function handleClearHistory() {
    if (window.confirm("Are you sure you want to clear the 'My Agent' dashboard history? All recorded purchases will be reset to ₹0.")) {
      const empty = clearStoredHistory();
      setHistory(empty);
    }
  }

  const takeRate = revenueStats.offers > 0 ? ((revenueStats.accepted / revenueStats.offers) * 100).toFixed(1) + "%" : "0.0%";

  return (
    <div
      style={{
        "--ink": "#081226",
        "--paper": "#F7F4EC",
        "--teal": "#2DD4BF",
        "--red": "#E5484D",
        "--rzpBlue": "#3395FF",
        "--rzpNavy": "#0C2451",
        "--textHi": "#EDF1F7",
        "--textLo": "#93A2BC",
        minHeight: "100vh",
        fontFamily: "Inter, sans-serif",
        backgroundColor: "#081226",
        backgroundImage:
          "radial-gradient(circle at 12% 18%, rgba(51,149,255,0.30), transparent 42%), radial-gradient(circle at 88% 12%, rgba(45,212,191,0.20), transparent 45%), radial-gradient(circle at 75% 85%, rgba(51,149,255,0.16), transparent 50%), radial-gradient(circle at 20% 90%, rgba(45,212,191,0.12), transparent 45%)",
        backgroundAttachment: "fixed",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500;600;700&family=Inter:wght@400;500;600&display=swap');
        @keyframes slideIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes feedIn { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        ::-webkit-scrollbar { width: 7px; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.18); border-radius: 4px; }
        .ledger-scroll::-webkit-scrollbar-thumb { background: #D3CDBC; }
        input[type="text"], input[type="number"] {
          background: rgba(255,255,255,0.06); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
          border: 1px solid rgba(255,255,255,0.16); color: var(--textHi);
          border-radius: 8px; padding: 9px 12px; font-family: 'Inter', sans-serif; font-size: 13.5px;
        }
        input::placeholder { color: var(--textLo); }
        input[type="text"]:focus, input[type="number"]:focus { outline: 2px solid var(--teal); outline-offset: 1px; }
        button:focus-visible { outline: 2px solid var(--teal); outline-offset: 2px; }
      `}</style>

      {/* HEADER WITH SURFACE NAVIGATION */}
      <div style={glass({ borderRadius: 0, borderLeft: "none", borderRight: "none", borderTop: "none", padding: "14px 28px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, position: "sticky", top: 0, zIndex: 10 })}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 34, height: 34, borderRadius: 8, background: "var(--teal)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <ShoppingBag size={18} color="#04342C" />
            </div>
            <div>
              <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 18, color: "var(--textHi)", letterSpacing: "0.01em" }}>
                VERVE &amp; CO.
              </div>
              <div style={{ fontSize: 10, color: "var(--textLo)", letterSpacing: "0.08em" }}>
                AGENTIC COMMERCE PLATFORM · TRACK 01
              </div>
            </div>
          </div>

          {/* Compact Top Navigation Tabs */}
          <div style={{ display: "flex", background: "rgba(3,10,25,0.45)", borderRadius: 8, padding: 3, border: "1px solid rgba(255,255,255,0.12)" }}>
            <button
              onClick={() => setActiveTab("checkout")}
              style={{
                background: activeTab === "checkout" ? "rgba(45,212,191,0.2)" : "transparent",
                color: activeTab === "checkout" ? "#8FEFE2" : "var(--textLo)",
                border: `1px solid ${activeTab === "checkout" ? "rgba(45,212,191,0.5)" : "transparent"}`,
                borderRadius: 6,
                padding: "6px 14px",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "'Space Grotesk', sans-serif",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <Bot size={13} /> Agentic Checkout
            </button>
            <button
              onClick={() => setActiveTab("dashboard")}
              style={{
                background: activeTab === "dashboard" ? "rgba(51,149,255,0.2)" : "transparent",
                color: activeTab === "dashboard" ? "#9ECCFF" : "var(--textLo)",
                border: `1px solid ${activeTab === "dashboard" ? "rgba(51,149,255,0.5)" : "transparent"}`,
                borderRadius: 6,
                padding: "6px 14px",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "'Space Grotesk', sans-serif",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <BarChart3 size={13} /> My Agent Dashboard
            </button>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={glass({ display: "flex", alignItems: "center", gap: 6, border: "1px dashed rgba(51,149,255,0.5)", borderRadius: 20, padding: "5px 14px", fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "var(--rzpBlue)", letterSpacing: "0.06em", boxShadow: "none" })}>
            <Lock size={12} /> RAZORPAY TEST MODE — NO LIVE FUNDS MOVE
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, background: "var(--rzpNavy)", border: "1px solid var(--rzpBlue)", borderRadius: 6, padding: "5px 10px" }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M17 2L7 14h6l-4 8L21 8h-7l3-6z" fill="var(--rzpBlue)" />
            </svg>
            <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 10.5, fontWeight: 600, color: "#EDF1F7", letterSpacing: "0.02em" }}>
              Payments by Razorpay
            </span>
          </div>
        </div>
      </div>

      {/* RENDER VIEW: EITHER MY AGENT DASHBOARD OR AGENTIC CHECKOUT */}
      {activeTab === "dashboard" ? (
        <MyAgentDashboard
          history={history}
          currentMandate={mandate}
          onClearHistory={handleClearHistory}
        />
      ) : (
        <>
          {/* CONTROLS & MANDATE SURFACE */}
          <div style={glass({ borderRadius: 0, borderLeft: "none", borderRight: "none", padding: "16px 28px" })}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 12 }}>
              {/* Preset Buttons */}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {PRESETS.map((p) => (
                  <button
                    key={p.label}
                    disabled={running || awaitingApproval}
                    onClick={() => { setGoal(p.goal); setBudget(p.budget); }}
                    style={glass({
                      background: goal === p.goal ? "rgba(45,212,191,0.16)" : "rgba(255,255,255,0.05)",
                      color: goal === p.goal ? "#8FEFE2" : "var(--textHi)",
                      border: `1px solid ${goal === p.goal ? "rgba(45,212,191,0.55)" : "rgba(255,255,255,0.14)"}`,
                      borderRadius: 20,
                      padding: "6px 14px",
                      fontSize: 12,
                      cursor: (running || awaitingApproval) ? "not-allowed" : "pointer",
                      fontFamily: "Inter, sans-serif",
                      opacity: (running || awaitingApproval) ? 0.6 : 1,
                      boxShadow: "none",
                    })}
                    aria-label={`Select preset: ${p.label}`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                {/* Configurable Complement / Upsell Policy Threshold */}
                <div style={{ display: "flex", alignItems: "center", gap: 5, background: "rgba(3,10,25,0.45)", borderRadius: 8, padding: "4px 8px", border: "1px solid rgba(255,255,255,0.12)" }}>
                  <SlidersHorizontal size={12} color="var(--textLo)" />
                  <span style={{ fontSize: 10.5, color: "var(--textLo)", fontFamily: "'IBM Plex Mono', monospace" }}>Add-on Cap:</span>
                  {[0.10, 0.15, 0.20, 0.25].map((pct) => (
                    <button
                      key={pct}
                      disabled={running || awaitingApproval}
                      onClick={() => setUpsellCapPercent(pct)}
                      style={{
                        background: upsellCapPercent === pct ? "rgba(45,212,191,0.25)" : "transparent",
                        color: upsellCapPercent === pct ? "#8FEFE2" : "var(--textLo)",
                        border: `1px solid ${upsellCapPercent === pct ? "rgba(45,212,191,0.5)" : "transparent"}`,
                        borderRadius: 4,
                        padding: "2px 6px",
                        fontSize: 10,
                        fontWeight: upsellCapPercent === pct ? 700 : 400,
                        cursor: (running || awaitingApproval) ? "not-allowed" : "pointer",
                        fontFamily: "'IBM Plex Mono', monospace",
                      }}
                      aria-label={`Set add-on cap to ${Math.round(pct * 100)}%`}
                    >
                      {Math.round(pct * 100)}%
                    </button>
                  ))}
                </div>

                {/* AP2-inspired Mandate Glass Card */}
                {mandate && (
                  <div
                    style={glass({
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "6px 12px",
                      borderRadius: 8,
                      border: "1px solid rgba(45,212,191,0.3)",
                      background: "rgba(45,212,191,0.06)",
                      boxShadow: "none",
                    })}
                  >
                    <FileCheck2 size={14} color="var(--teal)" />
                    <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "var(--textHi)", display: "flex", alignItems: "center" }}>
                      <span style={{ color: "var(--textLo)" }}>MANDATE: </span>
                      <span style={{ fontWeight: 600, color: "var(--teal)", marginLeft: 4 }}>{mandate.mandateId}</span>
                      <CopyButton text={mandate.mandateId} />
                      <span style={{ color: "var(--textLo)", marginLeft: 6 }}> · CAP: </span>
                      <span style={{ marginLeft: 3 }}>{inr(mandate.maxAmount)}</span>
                    </div>
                    <Stamp status="SIGNED" />
                  </div>
                )}
              </div>
            </div>

            {/* Input Row */}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <input
                type="text"
                value={goal}
                disabled={running || awaitingApproval}
                onChange={(e) => setGoal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !running && !awaitingApproval) {
                    runScenario();
                  }
                }}
                placeholder="Describe the shopping goal (press Enter to run)…"
                aria-label="Shopping goal input"
                style={{ flex: "1 1 320px", minWidth: 240 }}
              />
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 12, color: "var(--textLo)" }}>Budget ₹</span>
                <input
                  type="number"
                  value={budget}
                  disabled={running || awaitingApproval}
                  onChange={(e) => setBudget(Number(e.target.value))}
                  aria-label="Shopping budget"
                  style={{ width: 100 }}
                />
              </div>
              <button
                onClick={runScenario}
                disabled={running || awaitingApproval}
                aria-label={running ? "Agent running" : "Run agent checkout"}
                style={{
                  background: running ? "rgba(255,255,255,0.1)" : "var(--teal)",
                  color: running ? "var(--textLo)" : "#04342C",
                  border: "none",
                  borderRadius: 8,
                  padding: "9px 18px",
                  fontWeight: 600,
                  fontSize: 13.5,
                  cursor: (running || awaitingApproval) ? "not-allowed" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  fontFamily: "'Space Grotesk', sans-serif",
                  boxShadow: running ? "none" : "0 4px 18px rgba(45,212,191,0.35)",
                }}
              >
                {running ? <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> : <PlayCircle size={15} />}
                {running ? "Agent running…" : "Run agent"}
              </button>
              {done && (
                <button onClick={reset} aria-label="Reset demo" style={glass({ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.16)", color: "var(--textHi)", borderRadius: 8, padding: "9px 14px", fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, boxShadow: "none" })}>
                  <RotateCcw size={14} /> Reset
                </button>
              )}
            </div>
          </div>

          {/* MAIN GRID */}
          <div style={{ display: "grid", gridTemplateColumns: "minmax(270px, 320px) minmax(0, 1fr) minmax(300px, 330px)", gap: 16, padding: 16, minHeight: "calc(100vh - 210px)" }}>
            {/* CATALOG RAIL (DENSER UX: 7-8+ ITEMS VISIBLE) */}
            <div style={glass({ borderRadius: 14, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8, overflowY: "auto", maxHeight: "calc(100vh - 230px)" })}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: 11, color: "var(--textLo)", letterSpacing: "0.08em", display: "flex", alignItems: "center", gap: 6 }}>
                  <Braces size={12} /> CATALOG · {CATALOG.length} ITEMS
                </div>
                <span style={{ fontSize: 10, color: "var(--teal)", fontFamily: "'IBM Plex Mono', monospace" }}>
                  {filteredCatalog.length} shown
                </span>
              </div>

              {/* Compact Search Bar */}
              <div style={{ position: "relative" }}>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setVisibleCatalogCount(48);
                  }}
                  placeholder={`Filter ${CATALOG.length} items…`}
                  aria-label="Filter catalog products"
                  style={{ width: "100%", padding: "5px 8px 5px 26px", fontSize: 11.5, height: 28, borderRadius: 6 }}
                />
                <Search size={12} color="var(--textLo)" style={{ position: "absolute", left: 8, top: 8 }} />
              </div>

              {/* Compact Category Pills */}
              <div style={{ display: "flex", gap: 4, overflowX: "auto", paddingBottom: 2, flexShrink: 0 }}>
                {["all", ...ALLOWED_CATEGORIES].map((cat) => (
                  <button
                    key={cat}
                    onClick={() => {
                      setSelectedCategory(cat);
                      setVisibleCatalogCount(48);
                    }}
                    aria-label={`Filter by category: ${cat}`}
                    style={{
                      background: selectedCategory === cat ? "rgba(45,212,191,0.2)" : "rgba(255,255,255,0.04)",
                      color: selectedCategory === cat ? "#8FEFE2" : "var(--textLo)",
                      border: `1px solid ${selectedCategory === cat ? "rgba(45,212,191,0.4)" : "rgba(255,255,255,0.1)"}`,
                      borderRadius: 10,
                      padding: "2px 7px",
                      fontSize: 9.5,
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                      textTransform: "capitalize",
                    }}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              {/* Dense Items List: 7-8+ items visible simultaneously on desktop */}
              <div style={{ display: "flex", flexDirection: "column", gap: 5, overflowY: "auto", flex: 1, minHeight: 340 }}>
                {filteredCatalog.slice(0, visibleCatalogCount).map((p) => (
                  <CatalogCard key={p.id} product={p} highlighted={selectedIds.includes(p.id)} />
                ))}
                {filteredCatalog.length > visibleCatalogCount && (
                  <button
                    onClick={() => setVisibleCatalogCount((prev) => prev + 48)}
                    style={{
                      background: "rgba(45,212,191,0.12)",
                      border: "1px solid rgba(45,212,191,0.3)",
                      borderRadius: 6,
                      color: "#8FEFE2",
                      padding: "6px 10px",
                      fontSize: 10.5,
                      fontWeight: 600,
                      cursor: "pointer",
                      marginTop: 4,
                      fontFamily: "'IBM Plex Mono', monospace",
                    }}
                    aria-label="Load more catalog products"
                  >
                    + Show 48 more ({filteredCatalog.length - visibleCatalogCount} remaining)
                  </button>
                )}
              </div>

              <div style={{ marginTop: 2, fontSize: 10.5, color: "var(--textLo)", letterSpacing: "0.08em", display: "flex", alignItems: "center", gap: 6 }}>
                <ShieldCheck size={12} /> POLICY GATE GUARDRAILS
              </div>
              <div style={glass({ borderRadius: 8, padding: "6px 10px", boxShadow: "none" })}>
                {activeRules.map((r) => (
                  <RuleRow key={r.id} rule={r} result={ruleResults[r.id]} />
                ))}
              </div>
            </div>

            {/* TRANSCRIPT & HUMAN ESCALATION SURFACE */}
            <div style={glass({ borderRadius: 14, padding: 18, overflowY: "auto", display: "flex", flexDirection: "column", maxHeight: "calc(100vh - 230px)" })}>
              <div style={{ fontSize: 11, color: "var(--textLo)", letterSpacing: "0.08em", marginBottom: 14, display: "flex", alignItems: "center", gap: 6 }}>
                <Bot size={12} /> AGENT-TO-AGENT TRANSCRIPT
              </div>
              {transcript.length === 0 && !running && !awaitingApproval && (
                <div style={{ color: "var(--textLo)", fontSize: 13, marginTop: 40, textAlign: "center", lineHeight: 1.6 }}>
                  Choose a scenario above or enter any natural language shopping request, then press <em>Run agent</em> (or press Enter) to watch the buyer agent reason semantically across the 500-item catalog.
                </div>
              )}
              {transcript.map((t, i) => (
                <ChatBubble key={i} role={t.role} text={t.text} reasoning={t.reasoning} badge={t.badge} />
              ))}

              {/* Human Escalation Checkpoint Card */}
              {awaitingApproval && (
                <div
                  style={glass({
                    marginTop: 14,
                    marginBottom: 14,
                    borderRadius: 12,
                    padding: "16px 18px",
                    border: "1px solid rgba(232,163,61,0.5)",
                    background: "rgba(232,163,61,0.08)",
                    animation: "slideIn 0.3s ease",
                  })}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#F5C171", fontWeight: 700, fontSize: 13, fontFamily: "'Space Grotesk', sans-serif" }}>
                      <AlertTriangle size={16} /> HUMAN APPROVAL REQUIRED
                    </div>
                    <Stamp status="ESCALATED" />
                  </div>
                  <div style={{ fontSize: 12.5, color: "var(--textHi)", lineHeight: 1.5, marginBottom: 12 }}>
                    Order total <strong>{inr(awaitingApproval.orderContext.total)}</strong> exceeds autonomous approval limit of ₹5,000. Review and sign off before payment authorization:
                  </div>
                  <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "var(--textLo)", background: "rgba(3,10,25,0.4)", padding: "8px 12px", borderRadius: 6, marginBottom: 14 }}>
                    <div>Items: {awaitingApproval.orderContext.items.map((i) => `${i.name} (×${i.qty})`).join(", ")}</div>
                    {awaitingApproval.orderContext.upsellItem && <div>Upsell: {awaitingApproval.orderContext.upsellItem.name} ({inr(awaitingApproval.orderContext.upsellItem.price)})</div>}
                    <div style={{ display: "flex", alignItems: "center" }}>
                      Mandate: {awaitingApproval.orderContext.mandate.mandateId} · Cap {inr(awaitingApproval.orderContext.mandate.maxAmount)}
                      <CopyButton text={awaitingApproval.orderContext.mandate.mandateId} />
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 10 }}>
                    <button
                      onClick={() => handleHumanDecision(true)}
                      style={{
                        flex: 1,
                        background: "var(--teal)",
                        color: "#04342C",
                        border: "none",
                        borderRadius: 6,
                        padding: "8px 12px",
                        fontWeight: 600,
                        fontSize: 12.5,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 6,
                        fontFamily: "'Space Grotesk', sans-serif",
                      }}
                    >
                      <Check size={14} /> Approve Transaction
                    </button>
                    <button
                      onClick={() => handleHumanDecision(false)}
                      style={{
                        flex: 1,
                        background: "rgba(229,72,77,0.15)",
                        color: "#FFA2A2",
                        border: "1px solid rgba(229,72,77,0.4)",
                        borderRadius: 6,
                        padding: "8px 12px",
                        fontWeight: 600,
                        fontSize: 12.5,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 6,
                        fontFamily: "'Space Grotesk', sans-serif",
                      }}
                    >
                      <XCircle size={14} /> Deny Order
                    </button>
                  </div>
                </div>
              )}

              {/* Receipt Card */}
              {receipt && (
                <div style={glass({ marginTop: 18, borderRadius: 14, padding: 18, border: "1px solid rgba(45,212,191,0.4)" })}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                    <Receipt size={16} color="var(--teal)" />
                    <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: 14, color: "var(--textHi)" }}>Receipt — Test Mode</span>
                    <span style={{ marginLeft: "auto" }}>
                      <Stamp status={receipt.status} />
                    </span>
                  </div>
                  {receipt.items.map((i) => (
                    <div key={i.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: "var(--textHi)", padding: "3px 0", fontFamily: "'IBM Plex Mono', monospace" }}>
                      <span>{i.name} × {i.qty}</span>
                      <span>{inr(i.price * i.qty)}</span>
                    </div>
                  ))}
                  {receipt.upsell && (
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: "var(--teal)", padding: "3px 0", fontFamily: "'IBM Plex Mono', monospace" }}>
                      <span>{receipt.upsell.name} ({receipt.upsell.isCrossSell ? "cross-sell" : "upsell"})</span>
                      <span>{inr(receipt.upsell.price)}</span>
                    </div>
                  )}
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, color: "var(--textHi)", fontWeight: 700, padding: "8px 0 0", marginTop: 6, borderTop: "1px solid rgba(255,255,255,0.14)", fontFamily: "'IBM Plex Mono', monospace" }}>
                    <span>Total</span>
                    <span>{inr(receipt.total)}</span>
                  </div>
                  <div style={{ fontSize: 10.5, color: "var(--textLo)", marginTop: 10, fontFamily: "'IBM Plex Mono', monospace", display: "flex", alignItems: "center", flexWrap: "wrap", gap: 4 }}>
                    <span>{receipt.orderId}</span>
                    <CopyButton text={receipt.orderId} label="Copy" />
                    <span style={{ margin: "0 4px" }}>·</span>
                    <span>{receipt.paymentId}</span>
                    <CopyButton text={receipt.paymentId} label="Copy" />
                    {receipt.humanApproved && <span style={{ color: "#F5C171", marginLeft: 8 }}>· HUMAN APPROVED</span>}
                  </div>
                </div>
              )}
            </div>

            {/* AUDIT TRAIL & REVENUE ATTRIBUTION */}
            <div style={{ display: "flex", flexDirection: "column", gap: 12, maxHeight: "calc(100vh - 230px)" }}>
              {/* Realized Merchant Revenue Attribution Card */}
              <div style={glass({ borderRadius: 14, padding: "14px 16px" })}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <div style={{ fontSize: 11, color: "var(--teal)", letterSpacing: "0.08em", display: "flex", alignItems: "center", gap: 6, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif" }}>
                    <TrendingUp size={13} /> MERCHANT REVENUE ATTRIBUTION
                  </div>
                  <button
                    onClick={resetRevenueMetrics}
                    title="Reset cumulative revenue counter"
                    style={{ background: "none", border: "none", color: "var(--textLo)", fontSize: 10, cursor: "pointer", display: "flex", alignItems: "center", gap: 3, fontFamily: "'IBM Plex Mono', monospace" }}
                  >
                    <RotateCcw size={10} /> Reset
                  </button>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <div style={{ background: "rgba(3,10,25,0.4)", borderRadius: 8, padding: "8px 10px" }}>
                    <div style={{ fontSize: 10, color: "var(--textLo)", fontFamily: "Inter, sans-serif" }}>Upsell Offers</div>
                    <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 15, fontWeight: 700, color: "var(--textHi)", marginTop: 2 }}>{revenueStats.offers}</div>
                  </div>
                  <div style={{ background: "rgba(3,10,25,0.4)", borderRadius: 8, padding: "8px 10px" }}>
                    <div style={{ fontSize: 10, color: "var(--textLo)", fontFamily: "Inter, sans-serif" }}>Accepted / Take Rate</div>
                    <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 15, fontWeight: 700, color: "var(--teal)", marginTop: 2 }}>
                      {revenueStats.accepted} <span style={{ fontSize: 11, fontWeight: 400, color: "var(--textLo)" }}>({takeRate})</span>
                    </div>
                  </div>
                  <div style={{ gridColumn: "span 2", background: "rgba(45,212,191,0.08)", border: "1px solid rgba(45,212,191,0.25)", borderRadius: 8, padding: "8px 10px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{ fontSize: 10, color: "var(--teal)", fontFamily: "Inter, sans-serif", fontWeight: 600 }}>Realized Incremental Revenue</div>
                      <div style={{ fontSize: 9.5, color: "var(--textLo)", marginTop: 1 }}>Captured on paid orders only</div>
                    </div>
                    <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 16, fontWeight: 700, color: "#8FEFE2" }}>
                      {inr(revenueStats.realizedRevenue)}
                    </div>
                  </div>
                </div>
              </div>

              {/* LEDGER TAPE */}
              <div style={glass({ flex: 1, borderRadius: 14, display: "flex", flexDirection: "column", padding: "14px 14px 14px", overflow: "hidden" })}>
                <div style={{ fontSize: 11, color: "var(--textLo)", letterSpacing: "0.08em", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
                  <Receipt size={12} /> AUDIT TRAIL LEDGER
                </div>
                <div
                  className="ledger-scroll"
                  style={{
                    flex: 1,
                    background: "var(--paper)",
                    borderRadius: "4px 4px 10px 10px",
                    backgroundImage: "radial-gradient(circle, #D9D4C2 1.5px, transparent 1.5px)",
                    backgroundSize: "14px 10px",
                    backgroundPosition: "top center",
                    backgroundRepeat: "repeat-x",
                    paddingTop: 14,
                    overflowY: "auto",
                    boxShadow: "0 10px 30px rgba(3,10,25,0.4)",
                  }}
                >
                  <div style={{ padding: "0 14px" }}>
                    {ledger.length === 0 && (
                      <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11.5, color: "#9A9480", textAlign: "center", padding: "30px 10px" }}>
                        No transactions yet. The ledger prints as the agent acts — every entry timestamped, attributed, and explained.
                      </div>
                    )}
                    {ledger.map((e, i) => (
                      <LedgerEntry key={i} entry={e} />
                    ))}
                    <div ref={ledgerEndRef} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
