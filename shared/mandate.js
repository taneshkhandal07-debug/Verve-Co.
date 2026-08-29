/**
 * VERVE & CO. — AP2-Inspired Buyer Authorization Mandate Helper
 * -------------------------------------------------------------
 * Note for judges: This implements an AP2-inspired Buyer Authorization
 * Mandate concept. The HMAC-SHA256 signature provides deterministic
 * tamper-evidence for this buildathon demonstration; it is not a claim
 * of production AP2 cryptographic protocol compliance.
 */

// Universal minimal SHA-256 implementation for deterministic signature across Node & Browser
function sha256(ascii) {
  function rightRotate(value, amount) {
    return (value >>> amount) | (value << (32 - amount));
  }

  const mathPow = Math.pow;
  const maxWord = mathPow(2, 32);
  let lengthProperty = "length";
  let i, j;
  let result = "";

  const words = [];
  const asciiBitLength = ascii[lengthProperty] * 8;

  let hash = (sha256.h = sha256.h || []);
  const k = (sha256.k = sha256.k || []);
  let primeCounter = k[lengthProperty];

  const isComposite = {};
  for (let candidate = 2; primeCounter < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (i = 0; i < 300; i += candidate) {
        isComposite[i] = candidate;
      }
      hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
      k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
    }
  }

  ascii += "\x80";
  while ((ascii[lengthProperty] % 64) - 56) ascii += "\x00";
  for (i = 0; i < ascii[lengthProperty]; i++) {
    j = ascii.charCodeAt(i);
    if (j >> 8) return;
    words[i >> 2] |= j << (((3 - i) % 4) * 8);
  }
  words[words[lengthProperty]] = (asciiBitLength / maxWord) | 0;
  words[words[lengthProperty]] = asciiBitLength;

  for (j = 0; j < words[lengthProperty]; ) {
    const w = words.slice(j, (j += 16));
    const oldHash = hash;
    hash = hash.slice(0, 8);

    for (i = 0; i < 64; i++) {
      const w15 = w[i - 15],
        w2 = w[i - 2];
      const s0 = rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3);
      const s1 = rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10);
      const ch = (hash[4] & hash[5]) ^ (~hash[4] & hash[6]);
      const maj = (hash[0] & hash[1]) ^ (hash[0] & hash[2]) ^ (hash[1] & hash[2]);
      const temp1 =
        hash[7] +
        (rightRotate(hash[4], 6) ^ rightRotate(hash[4], 11) ^ rightRotate(hash[4], 25)) +
        ch +
        k[i] +
        (w[i] =
          i < 16
            ? w[i]
            : (w[i - 16] + s0 + w[i - 7] + s1) | 0);
      const temp2 =
        (rightRotate(hash[0], 2) ^ rightRotate(hash[0], 13) ^ rightRotate(hash[0], 22)) +
        maj;

      hash = [(temp1 + temp2) | 0].concat(hash);
      hash[4] = (hash[4] + temp1) | 0;
    }

    for (i = 0; i < 8; i++) {
      hash[i] = (hash[i] + oldHash[i]) | 0;
    }
  }

  for (i = 0; i < 8; i++) {
    for (j = 3; j + 1; j--) {
      const b = (hash[i] >> (j * 8)) & 255;
      result += (b < 16 ? 0 : "") + b.toString(16);
    }
  }
  return result;
}

function hmacSha256(key, message) {
  const blockSize = 64;
  let k = key;
  if (k.length > blockSize) {
    k = sha256(k);
  }
  while (k.length < blockSize) {
    k += "\x00";
  }

  let oKeyPad = "";
  let iKeyPad = "";
  for (let i = 0; i < blockSize; i++) {
    oKeyPad += String.fromCharCode(k.charCodeAt(i) ^ 0x5c);
    iKeyPad += String.fromCharCode(k.charCodeAt(i) ^ 0x36);
  }

  return sha256(oKeyPad + hexToAscii(sha256(iKeyPad + message)));
}

function hexToAscii(hex) {
  let str = "";
  for (let i = 0; i < hex.length; i += 2) {
    str += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
  }
  return str;
}

const MANDATE_SECRET = "verve_mandate_signing_secret_demo";

function getCanonicalMandateString({ mandateId, buyerId, sessionId, maxAmount, allowedCategories, validUntil, issuedAt }) {
  const sortedCategories = [...allowedCategories].sort().join(",");
  return `${mandateId}|${buyerId}|${sessionId}|${maxAmount}|${sortedCategories}|${validUntil}|${issuedAt}`;
}

function createMandate({
  buyerId = "BUYER-01",
  sessionId,
  maxAmount = 5000,
  allowedCategories = ["audio", "home", "accessories", "wearables", "stationery", "outdoor", "tech", "food", "kitchen"],
  validityMinutes = 30,
}) {
  const issuedAt = new Date().toISOString();
  const validUntil = new Date(Date.now() + validityMinutes * 60 * 1000).toISOString();
  const mandateId = "MND-" + Math.random().toString(36).substring(2, 8).toUpperCase();
  const sId = sessionId || "sess_" + Math.random().toString(36).substring(2, 10);

  const payload = {
    mandateId,
    buyerId,
    sessionId: sId,
    maxAmount,
    allowedCategories,
    validUntil,
    issuedAt,
  };

  const canonicalString = getCanonicalMandateString(payload);
  const signature = hmacSha256(MANDATE_SECRET, canonicalString);

  return {
    ...payload,
    signature,
    type: "AP2_INSPIRED_AUTHORIZATION_MANDATE",
  };
}

function verifyMandate(mandate, expectedSessionId = null) {
  if (!mandate || !mandate.mandateId || !mandate.signature) {
    return { valid: false, reason: "Missing mandate structure or signature" };
  }

  const now = new Date();
  const expiry = new Date(mandate.validUntil);
  if (now > expiry) {
    return { valid: false, reason: `Mandate expired at ${mandate.validUntil}` };
  }

  if (expectedSessionId && mandate.sessionId && mandate.sessionId !== expectedSessionId) {
    return { valid: false, reason: `Mandate session mismatch (expected ${expectedSessionId}, got ${mandate.sessionId})` };
  }

  const canonicalString = getCanonicalMandateString(mandate);
  const expectedSignature = hmacSha256(MANDATE_SECRET, canonicalString);

  if (expectedSignature !== mandate.signature) {
    return { valid: false, reason: "Tamper detected: mandate signature does not match canonical contents" };
  }

  return { valid: true, reason: "Signature verified & unexpired" };
}

// Support both CommonJS and ES module environments
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    createMandate,
    verifyMandate,
    getCanonicalMandateString,
    hmacSha256,
  };
}

if (typeof window !== "undefined") {
  window.__VERVE_MANDATE__ = {
    createMandate,
    verifyMandate,
    getCanonicalMandateString,
    hmacSha256,
  };
}
