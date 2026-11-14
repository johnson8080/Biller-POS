/*
 * Biller POS — M-Pesa payment server.
 * ---------------------------------------------------------------------------
 * A tiny, dependency-free Node server that holds the Safaricom Daraja
 * credentials for every shop that uses Biller POS, so the secrets never sit on
 * a shop owner's phone.
 *
 * The app talks to this server instead of Safaricom directly. Each shop has
 * its own key (the "Backend key" in Biller POS) and its own Daraja
 * credentials; the server looks the shop up by key and calls Safaricom with
 * that shop's credentials.
 *
 * Run:  node mpesa-server.js --config ./config.json --port 8787
 * Node 18 or newer (uses the built-in fetch). No npm install needed.
 */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const SANDBOX = "https://sandbox.safaricom.co.ke";
const PRODUCTION = "https://api.safaricom.co.ke";
const MAX_AMOUNT = 250000;
const TOKEN_TTL = 50 * 60 * 1000; // Daraja access tokens last 60 minutes.

// --------------------------------------------------------------------------
// Configuration
// --------------------------------------------------------------------------
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--config") out.config = argv[++i];
    else if (arg === "--port") out.port = Number(argv[++i]);
    else if (arg === "--gen-key") out.genKey = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
  }
  return out;
}

function loadConfig(args) {
  const file = args.config || process.env.MPESA_CONFIG || path.join(__dirname, "config.json");
  if (!fs.existsSync(file)) {
    if (fs.existsSync(`${file}.example`)) {
      console.error(`No config file at ${file}. Copy config.example.json to config.json and fill it in.`);
    } else {
      console.error(`No config file at ${file}.`);
    }
    process.exit(1);
  }
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (error) {
    console.error(`Could not read ${file}: ${error.message}`);
    process.exit(1);
  }
  let config;
  try {
    config = JSON.parse(raw);
  } catch (error) {
    console.error(`${file} is not valid JSON: ${error.message}`);
    process.exit(1);
  }
  config.port = Number(args.port || process.env.PORT || config.port || 8787);
  config.callbackUrl = config.callbackUrl || "";
  config.shops = config.shops && typeof config.shops === "object" ? config.shops : {};
  config.allowedOrigins = Array.isArray(config.allowedOrigins) && config.allowedOrigins.length
    ? config.allowedOrigins
    : ["*"];
  return config;
}

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log([
    "Biller POS M-Pesa server",
    "",
    "  node mpesa-server.js --config ./config.json --port 8787",
    "  node mpesa-server.js --gen-key        print a new random backend key",
    "",
    "Environment: MPESA_CONFIG (config path), PORT (port), DARAJA_CALLBACK_URL"
  ].join("\n"));
  process.exit(0);
}

if (args.genKey) {
  console.log(crypto.randomBytes(24).toString("hex"));
  process.exit(0);
}

const config = loadConfig(args);
const CALLBACK_URL = config.callbackUrl || process.env.DARAJA_CALLBACK_URL || "";

// --------------------------------------------------------------------------
// Small helpers
// --------------------------------------------------------------------------
const tokenCache = new Map();   // shopKey -> { token, at }
const results = new Map();      // checkoutRequestId -> last known result
const pending = new Map();      // checkoutRequestId -> { shortcode, environment }
const rateHits = new Map();     // shopKey -> { count, resetAt }

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function b64(value) {
  return Buffer.from(String(value ?? ""), "utf8").toString("base64");
}

function eatTimestamp(date = new Date()) {
  const eat = new Date(date.getTime() + 3 * 3600000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${eat.getUTCFullYear()}${pad(eat.getUTCMonth() + 1)}${pad(eat.getUTCDate())}${pad(eat.getUTCHours())}${pad(eat.getUTCMinutes())}${pad(eat.getUTCSeconds())}`;
}

function apiBase(environment) {
  return environment === "production" ? PRODUCTION : SANDBOX;
}

async function fetchJson(url, { method = "POST", headers = {}, body } = {}) {
  const finalHeaders = { Accept: "application/json", ...headers };
  if (body !== undefined) finalHeaders["Content-Type"] = "application/json";
  const response = await fetch(url, {
    method,
    headers: finalHeaders,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data };
}

/** The shop behind this request, by its backend key. */
function shopFor(req) {
  const header = String(req.headers.authorization || "");
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return null;
  const key = match[1].trim();
  const shop = config.shops[key];
  if (!shop) return null;
  return { key, shop };
}

function rateLimited(key) {
  const now = Date.now();
  const hit = rateHits.get(key);
  if (!hit || now > hit.resetAt) {
    rateHits.set(key, { count: 1, resetAt: now + 60000 });
    return false;
  }
  hit.count += 1;
  return hit.count > 60; // 60 requests a minute is plenty for a till.
}

/** Does this shop own the shortcode it wants to charge? */
function shortcodeAllowed(shop, shortcode) {
  const list = Array.isArray(shop.shortcodes) ? shop.shortcodes : [];
  if (!list.length) return true; // No allowlist: trust the key holder.
  return list.includes(String(shortcode));
}

function shopEnvironment(shop, requested) {
  // A shop may only use the environment it was set up for.
  const allowed = shop.environment === "production" ? "production" : "sandbox";
  if (requested && requested !== allowed) return null;
  return allowed;
}

async function oauthToken(shop, environment) {
  const cacheKey = `${environment}|${shop.consumerKey}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && Date.now() - cached.at < TOKEN_TTL) return cached.token;
  const { status, data } = await fetchJson(
    `${apiBase(environment)}/oauth/v1/generate?grant_type=client_credentials`,
    { method: "GET", headers: { Authorization: `Basic ${b64(`${shop.consumerKey}:${shop.consumerSecret}`)}` } }
  );
  const token = data?.access_token;
  if (!token) {
    const detail = data?.errorMessage || data?.error_description || data?.error || "Safaricom rejected the consumer key or secret.";
    const error = new Error(detail);
    error.status = status;
    throw error;
  }
  tokenCache.set(cacheKey, { token, at: Date.now() });
  return token;
}

// --------------------------------------------------------------------------
// Daraja calls
// --------------------------------------------------------------------------
async function darajaPing(shop, environment) {
  await oauthToken(shop, environment);
  return { ok: true, message: "Safaricom accepted the consumer key and secret." };
}

async function darajaStkPush(shop, environment, body) {
  const shortcode = String(body.shortcode || "").trim();
  if (!shortcode) throw new Error("No Paybill or Till number was sent.");
  if (!shortcodeAllowed(shop, shortcode)) {
    throw new Error("This shop is not allowed to charge that shortcode.");
  }
  const amount = Math.max(1, Math.round(Number(body.amount) || 0));
  if (amount > MAX_AMOUNT) throw new Error("Amounts above 250,000 KES are not allowed.");

  const token = await oauthToken(shop, environment);
  const timestamp = eatTimestamp();
  const password = b64(`${shortcode}${shop.passkey}${timestamp}`);
  const payload = {
    BusinessShortCode: shortcode,
    Password: password,
    Timestamp: timestamp,
    TransactionType: body.mode === "till" ? "CustomerBuyGoodsOnline" : "CustomerPayBillOnline",
    Amount: amount,
    PartyA: String(body.phone || ""),
    PartyB: shortcode,
    PhoneNumber: String(body.phone || ""),
    CallBackURL: CALLBACK_URL || "https://biller-91aaf.web.app/mpesa/callback",
    AccountReference: String(body.accountReference || "Biller POS").slice(0, 12),
    TransactionDesc: String(body.description || "Sale").slice(0, 13)
  };
  const { status, data } = await fetchJson(`${apiBase(environment)}/mpesa/stkpush/v1/processrequest`, {
    headers: { Authorization: `Bearer ${token}` },
    body: payload
  });
  if (String(data?.ResponseCode) !== "0" || !data?.CheckoutRequestID) {
    throw new Error(data?.errorMessage || data?.ResponseDescription || `Safaricom refused the request (HTTP ${status}).`);
  }
  const result = {
    ok: true,
    checkoutRequestId: data.CheckoutRequestID,
    customerMessage: data.CustomerMessage || "Check the customer's phone for the M-Pesa prompt."
  };
  // Remember which shortcode this request used, so the status call can
  // sign its query with the same passkey.
  pending.set(result.checkoutRequestId, { shortcode, environment });
  return result;
}

async function darajaStatus(shop, environment, checkoutRequestId) {
  const known = pending.get(checkoutRequestId);
  const shortcode = known?.shortcode || shop.defaultShortcode || (Array.isArray(shop.shortcodes) ? shop.shortcodes[0] : "") || "";
  const token = await oauthToken(shop, environment);
  const timestamp = eatTimestamp();
  const password = b64(`${shortcode}${shop.passkey}${timestamp}`);
  const { status, data } = await fetchJson(`${apiBase(environment)}/mpesa/stkpushquery/v1/query`, {
    headers: { Authorization: `Bearer ${token}` },
    body: { BusinessShortCode: shortcode, Password: password, Timestamp: timestamp, CheckoutRequestID: checkoutRequestId }
  });
  // Still waiting for the PIN: Safaricom answers HTTP 500 with 500.001.1001.
  if (data?.errorCode === "500.001.1001" || /being processed/i.test(String(data?.errorMessage || ""))) {
    return { ok: true, status: "pending" };
  }
  // Too many status queries: the payment is still alive, just slow.
  if (status === 429) {
    return { ok: true, status: "pending" };
  }
  if (data?.ResultCode !== undefined) {
    const code = String(data.ResultCode);
    const desc = String(data.ResultDesc || "");
    if (code === "0") {
      return { ok: true, status: "success", receipt: data.MpesaReceiptNumber || "", message: desc };
    }
    // The customer is still on the PIN prompt, so the payment is not done.
    if (code === "1032" || /under processing|still process|in progress|being processed/i.test(desc)) {
      return { ok: true, status: "pending" };
    }
    return { ok: true, status: "failed", message: desc || "The payment was not completed." };
  }
  if (status >= 500 && !data?.errorCode) return { ok: true, status: "pending" };
  throw new Error(data?.errorMessage || data?.ResponseDescription || `Could not check the payment (HTTP ${status}).`);
}

// --------------------------------------------------------------------------
// HTTP plumbing
// --------------------------------------------------------------------------
function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function corsFor(origin) {
  const allowed = config.allowedOrigins;
  if (allowed.includes("*")) return "*";
  return allowed.includes(origin) ? origin : allowed[0];
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 64 * 1024) {
        reject(new Error("Request body too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(new Error("Body is not valid JSON.")); }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || "";
  res.setHeader("Access-Control-Allow-Origin", corsFor(origin));
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Vary", "Origin");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && (url.pathname === "/health" || url.pathname === "/")) {
    return sendJson(res, 200, { ok: true, service: "biller-pos-mpesa", shops: Object.keys(config.shops).length });
  }

  // Safaricom's callback lands here. The app polls instead, but keeping the
  // callback means a payment that completes while the app is closed is still
  // on record.
  if (req.method === "POST" && url.pathname === "/mpesa/callback") {
    try {
      const body = await readBody(req);
      const id = body?.CheckoutRequestID || body?.checkoutRequestId;
      if (id) {
        const code = String(body?.ResultCode ?? body?.ResponseCode ?? "");
        results.set(id, {
          status: code === "0" ? "success" : "failed",
          receipt: body?.MpesaReceiptNumber || "",
          message: body?.ResultDesc || body?.ResponseDescription || ""
        });
        log("callback", id, code);
      }
      return sendJson(res, 200, { ok: true });
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: error.message });
    }
  }

  if (req.method !== "POST") {
    return sendJson(res, 405, { ok: false, error: "Use POST." });
  }

  const found = shopFor(req);
  if (!found) {
    return sendJson(res, 401, { ok: false, error: "Unknown backend key." });
  }
  const { key, shop } = found;
  if (rateLimited(key)) {
    return sendJson(res, 429, { ok: false, error: "Too many requests. Slow down." });
  }

  let body;
  try {
    body = await readBody(req);
  } catch (error) {
    return sendJson(res, 400, { ok: false, error: error.message });
  }

  const action = String(body.action || "").toLowerCase();

  try {
    if (action === "ping") {
      const environment = shopEnvironment(shop, body.environment);
      if (!environment) throw new Error("This shop is not set up for that environment.");
      const result = await darajaPing(shop, environment);
      log("ping", shop.name || key);
      return sendJson(res, 200, result);
    }

    if (action === "stkpush") {
      const environment = shopEnvironment(shop, body.environment);
      if (!environment) throw new Error("This shop is not set up for that environment.");
      const result = await darajaStkPush(shop, environment, body);
      log("stkpush", shop.name || key, body.shortcode, body.amount, body.phone, result.checkoutRequestId);
      return sendJson(res, 200, result);
    }

    if (action === "status") {
      const id = String(body.checkoutRequestId || "");
      const known = results.get(id);
      if (known && known.status === "success") return sendJson(res, 200, { ok: true, ...known });
      const environment = shopEnvironment(shop, body.environment);
      if (!environment) throw new Error("This shop is not set up for that environment.");
      const result = await darajaStatus(shop, environment, id);
      if (result.status === "success" || result.status === "failed") results.set(id, result);
      return sendJson(res, 200, result);
    }

    return sendJson(res, 400, { ok: false, error: `Unknown action "${body.action}".` });
  } catch (error) {
    log("error", shop.name || key, action, error.message);
    return sendJson(res, 200, { ok: false, error: error.message });
  }
});

server.listen(config.port, () => {
  log(`Biller POS M-Pesa server listening on port ${config.port}`);
  log(`shops configured: ${Object.keys(config.shops).length}`);
  if (!Object.keys(config.shops).length) {
    log("No shops yet — add one to config.json, then run: node mpesa-server.js --gen-key");
  }
});
