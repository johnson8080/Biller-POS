/*
 * Biller POS — M-Pesa (Safaricom Daraja) payments.
 *
 * A customer payment is an STK Push: Safaricom sends the PIN prompt to the
 * customer's phone, and the app polls Daraja until the payment settles. The
 * request can go out in two ways:
 *
 *   1. Straight from the installed Android app (Capacitor's native HTTP
 *      bridge, which is not limited by browser CORS).
 *   2. Through a small backend URL, for the web version. The backend holds
 *      the Daraja credentials and returns the shape documented in
 *      MPESA-SETUP.md.
 */
(function () {
  "use strict";

  const T = window.Till;
  if (!T) return;

  const SANDBOX = "https://sandbox.safaricom.co.ke";
  const PRODUCTION = "https://api.safaricom.co.ke";
  // Safaricom insists on an HTTPS callback. The app does not need the
  // callback itself (it polls the status API), but the field must be a
  // public URL. Point this at your backend's callback route if you run one.
  const CALLBACK_URL = "https://biller-91aaf.web.app/mpesa/callback";
  const POLL_MS = 3000;
  const TIMEOUT_MS = 95000;
  const TOKEN_TTL = 50 * 60 * 1000;
  const MAX_AMOUNT = 250000;

  let tokenCache = { key: "", token: "", at: 0 };
  // Bumping this stops a poll loop that the cashier abandoned.
  let generation = 0;
  // Daraja rate-limits the status query, so a 429 makes the next poll wait
  // a little longer instead of failing the payment.
  let slowUntil = 0;

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function b64(value) {
    const bytes = new TextEncoder().encode(String(value ?? ""));
    let binary = "";
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    return btoa(binary);
  }

  function nativeHttp() {
    const cap = window.Capacitor;
    if (!cap?.isNativePlatform?.()) return null;
    const plugin = cap.Plugins?.CapacitorHttp;
    return plugin?.request ? plugin : null;
  }

  /** JSON over the phone's native HTTP bridge, or fetch in a browser. */
  async function requestJson(url, { method = "POST", headers = {}, body } = {}) {
    const finalHeaders = { Accept: "application/json", ...headers };
    if (body !== undefined) finalHeaders["Content-Type"] = "application/json";
    const native = nativeHttp();
    if (native) {
      const result = await native.request({
        url,
        method,
        headers: finalHeaders,
        data: body,
        responseType: "json",
        connectTimeout: 20000,
        readTimeout: 40000
      });
      return { status: Number(result.status) || 0, data: result.data };
    }
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

  /** 0712 345 678 → 254712345678. Returns a friendly error when it isn't. */
  function normalizePhone(input) {
    let digits = String(input || "").replace(/[^\d+]/g, "").replace(/^\+/, "");
    if (digits.startsWith("00254")) digits = digits.slice(2);
    if (digits.startsWith("254")) {
      // already in international form
    } else if (digits.startsWith("0")) {
      digits = `254${digits.slice(1)}`;
    } else if (/^[17]\d{8}$/.test(digits)) {
      digits = `254${digits}`;
    }
    if (!/^254[17]\d{8}$/.test(digits)) {
      return { ok: false, error: "Enter a Safaricom number like 0712 345 678." };
    }
    return { ok: true, phone: digits };
  }

  function formatPhone(phone) {
    const digits = String(phone || "");
    if (!/^254[17]\d{8}$/.test(digits)) return String(phone || "");
    const local = `0${digits.slice(3)}`;
    return `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`;
  }

  function eatTimestamp(date = new Date()) {
    // Daraja wants Nairobi time (UTC+3) as YYYYMMDDHHmmss.
    const eat = new Date(date.getTime() + 3 * 3600000);
    const pad = (n) => String(n).padStart(2, "0");
    return `${eat.getUTCFullYear()}${pad(eat.getUTCMonth() + 1)}${pad(eat.getUTCDate())}${pad(eat.getUTCHours())}${pad(eat.getUTCMinutes())}${pad(eat.getUTCSeconds())}`;
  }

  function apiBase(cfg) {
    return cfg.environment === "production" ? PRODUCTION : SANDBOX;
  }

  /** What still has to be filled in before a prompt can be sent. */
  function readiness(cfg = T.mpesaConfig()) {
    if (!cfg.shortcode) {
      return { ok: false, reason: "no-shortcode", message: "Add your Paybill or Till number in Store & receipts." };
    }
    if (cfg.backend) return { ok: true, mode: "backend" };
    if (!cfg.consumerKey || !cfg.consumerSecret || !cfg.passkey) {
      return { ok: false, reason: "no-credentials", message: "Add your Daraja consumer key, secret and passkey in Store & receipts." };
    }
    if (!nativeHttp()) {
      return { ok: false, reason: "browser", message: "Safaricom blocks payment prompts sent straight from a browser. Use the installed Biller POS app, or set a backend URL." };
    }
    return { ok: true, mode: "direct" };
  }

  function friendlyError(error) {
    const message = String(error?.message || error || "").trim();
    if (!message) return "M-Pesa could not be reached. Check the connection and try again.";
    if (/failed to fetch|network|load failed/i.test(message)) {
      return "Could not reach Safaricom. Check the internet connection and try again.";
    }
    return message;
  }

  async function oauthToken(cfg, force = false) {
    const key = `${apiBase(cfg)}|${cfg.consumerKey}`;
    if (!force && tokenCache.key === key && tokenCache.token && Date.now() - tokenCache.at < TOKEN_TTL) {
      return tokenCache.token;
    }
    const auth = b64(`${cfg.consumerKey}:${cfg.consumerSecret}`);
    const { data } = await requestJson(`${apiBase(cfg)}/oauth/v1/generate?grant_type=client_credentials`, {
      method: "GET",
      headers: { Authorization: `Basic ${auth}` }
    });
    const token = data?.access_token;
    if (!token) {
      const detail = data?.errorMessage || data?.error_description || data?.error || "Safaricom rejected the consumer key or secret.";
      throw new Error(detail);
    }
    tokenCache = { key, token, at: Date.now() };
    return token;
  }

  function backendHeaders(cfg) {
    return cfg.backendKey ? { Authorization: `Bearer ${cfg.backendKey}` } : {};
  }

  /** Ask Safaricom to show the PIN prompt on the customer's phone. */
  async function stkPush(cfg, { phone, amount, accountRef, description }) {
    if (cfg.backend) {
      const { status, data } = await requestJson(cfg.backend, {
        headers: backendHeaders(cfg),
        body: {
          action: "stkpush",
          phone,
          amount,
          accountReference: accountRef,
          description,
          shortcode: cfg.shortcode,
          mode: cfg.mode,
          environment: cfg.environment
        }
      });
      if (data?.ok === false) throw new Error(data.error || data.message || "The payment server refused the request.");
      const checkoutId = data?.checkoutRequestId || data?.CheckoutRequestID;
      if (!checkoutId) {
        if (data?.ResponseCode && data.ResponseCode !== "0") throw new Error(data.ResponseDescription || "Safaricom refused the request.");
        throw new Error(`The payment server did not return a checkout ID (HTTP ${status}).`);
      }
      return {
        checkoutRequestId: checkoutId,
        customerMessage: data.customerMessage || data.CustomerMessage || "Check your phone for the M-Pesa prompt."
      };
    }

    let token = await oauthToken(cfg);
    const timestamp = eatTimestamp();
    const password = b64(`${cfg.shortcode}${cfg.passkey}${timestamp}`);
    const payload = {
      BusinessShortCode: cfg.shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: cfg.mode === "till" ? "CustomerBuyGoodsOnline" : "CustomerPayBillOnline",
      Amount: amount,
      PartyA: phone,
      PartyB: cfg.shortcode,
      PhoneNumber: phone,
      CallBackURL: CALLBACK_URL,
      AccountReference: String(accountRef || "Biller POS").slice(0, 12),
      TransactionDesc: String(description || "Sale").slice(0, 13)
    };

    let result = await requestJson(`${apiBase(cfg)}/mpesa/stkpush/v1/processrequest`, {
      headers: { Authorization: `Bearer ${token}` },
      body: payload
    });
    // A token that sat in the cache may have just expired; ask for another.
    if (result.data?.errorCode === "400.002.02") {
      token = await oauthToken(cfg, true);
      result = await requestJson(`${apiBase(cfg)}/mpesa/stkpush/v1/processrequest`, {
        headers: { Authorization: `Bearer ${token}` },
        body: payload
      });
    }
    const data = result.data || {};
    if (String(data.ResponseCode) !== "0" || !data.CheckoutRequestID) {
      throw new Error(data.errorMessage || data.ResponseDescription || `Safaricom refused the request (HTTP ${result.status}).`);
    }
    return {
      checkoutRequestId: data.CheckoutRequestID,
      customerMessage: data.CustomerMessage || "Check your phone for the M-Pesa prompt."
    };
  }

  /** Has the customer entered the PIN yet? */
  async function queryStatus(cfg, checkoutRequestId) {
    if (cfg.backend) {
      const { data } = await requestJson(cfg.backend, {
        headers: backendHeaders(cfg),
        body: { action: "status", checkoutRequestId }
      });
      if (data?.ok === false) {
        // A rate-limit is not a failure - keep the payment alive.
        if (/429|rate/i.test(String(data.error || data.message || ""))) return { status: "pending" };
        throw new Error(data.error || data.message || "The payment server could not check the request.");
      }
      const state = String(data?.status || "pending").toLowerCase();
      if (state === "success" || state === "completed") {
        return { status: "success", receipt: data.receipt || data.mpesaReceiptNumber || "", message: data.message || "" };
      }
      if (state === "failed" || state === "cancelled" || state === "canceled") {
        return { status: "failed", message: data.message || "The customer did not complete the payment." };
      }
      return { status: "pending" };
    }

    const token = await oauthToken(cfg);
    const timestamp = eatTimestamp();
    const password = b64(`${cfg.shortcode}${cfg.passkey}${timestamp}`);
    const { status, data } = await requestJson(`${apiBase(cfg)}/mpesa/stkpushquery/v1/query`, {
      headers: { Authorization: `Bearer ${token}` },
      body: {
        BusinessShortCode: cfg.shortcode,
        Password: password,
        Timestamp: timestamp,
        CheckoutRequestID: checkoutRequestId
      }
    });
    // While the customer is still on the prompt Safaricom answers HTTP 500
    // with errorCode 500.001.1001. That is not a failure.
    if (data?.errorCode === "500.001.1001" || /being processed/i.test(String(data?.errorMessage || ""))) {
      return { status: "pending" };
    }
    // Too many status queries: wait it out rather than lose the payment.
    if (status === 429) {
      slowUntil = Date.now() + 6000;
      return { status: "pending" };
    }
    if (data?.ResultCode !== undefined) {
      const code = String(data.ResultCode);
      const desc = String(data.ResultDesc || "");
      if (code === "0") {
        return { status: "success", receipt: data.MpesaReceiptNumber || "", message: desc };
      }
      // The customer is still on the PIN prompt. That is not a failure -
      // Daraja says 1032 while the payment waits to be approved.
      if (code === "1032" || /under processing|still process|in progress|being processed/i.test(desc)) {
        return { status: "pending" };
      }
      return { status: "failed", message: desc || "The payment was not completed." };
    }
    if (status >= 500 && !data?.errorCode) return { status: "pending" };
    throw new Error(data?.errorMessage || data?.ResponseDescription || `Could not check the payment (HTTP ${status}).`);
  }

  /**
   * Send one payment request and follow it until it settles.
   * `onStage` is called with { stage: "sending" | "waiting" | ... }.
   * `cfg` overrides the shop's own M-Pesa setup - the monthly plan uses it
   * to charge the developer, not the shop.
   */
  async function collect({ phone, amountCents, accountRef = "", description = "", onStage, cfg: override = null }) {
    const run = ++generation;
    const cfg = override || T.mpesaConfig();
    const ready = readiness(cfg);
    if (!ready.ok) return { ok: false, stage: "failed", message: ready.message };
    const normal = normalizePhone(phone);
    if (!normal.ok) return { ok: false, stage: "failed", message: normal.error };
    // Safaricom accepts whole shillings only. Round up so the shop is never
    // short-changed by a few cents, and report the exact charged amount back
    // to the caller so the receipt matches the M-Pesa statement.
    const amount = Math.max(1, Math.ceil((Number(amountCents) || 0) / 100));
    if (amount > MAX_AMOUNT) {
      return { ok: false, stage: "failed", message: `M-Pesa requests are limited to ${MAX_AMOUNT.toLocaleString()} KES. Split this sale or use cash.` };
    }

    onStage?.({ stage: "sending", phone: normal.phone });
    let push;
    try {
      push = await stkPush(cfg, { phone: normal.phone, amount, accountRef, description });
    } catch (error) {
      if (run !== generation) return { ok: false, stage: "cancelled" };
      return { ok: false, stage: "failed", message: friendlyError(error) };
    }
    if (run !== generation) return { ok: false, stage: "cancelled" };

    onStage?.({
      stage: "waiting",
      phone: normal.phone,
      amount,
      checkoutId: push.checkoutRequestId,
      message: push.customerMessage,
      startedAt: Date.now()
    });

    const started = Date.now();
    let misses = 0;
    while (Date.now() - started < TIMEOUT_MS) {
      // Wait longer when Safaricom asked us to slow down.
      await delay(Math.max(POLL_MS, slowUntil - Date.now()));
      if (run !== generation) return { ok: false, stage: "cancelled" };
      let result;
      try {
        result = await queryStatus(cfg, push.checkoutRequestId);
        misses = 0;
      } catch (error) {
        misses += 1;
        // Two hiccups are fine, but a wrong shortcode/passkey should not
        // keep the cashier waiting for a minute and a half.
        if (misses >= 3) return { ok: false, stage: "failed", message: friendlyError(error) };
        continue;
      }
      if (result.status === "success") {
        return {
          ok: true,
          stage: "success",
          phone: normal.phone,
          amount,
          amountCents: amount * 100,
          reference: result.receipt || "",
          checkoutId: push.checkoutRequestId
        };
      }
      if (result.status === "failed") {
        return { ok: false, stage: "failed", message: result.message || "The customer did not complete the payment." };
      }
    }
    return {
      ok: false,
      stage: "timeout",
      message: "No confirmation yet. Ask the customer to check their phone and M-Pesa messages before trying again."
    };
  }

  function cancel() {
    generation += 1;
  }

  /** Used by the "Test connection" button in Store settings. */
  async function testConnection(cfg = T.mpesaConfig()) {
    const ready = readiness(cfg);
    if (!ready.ok) return { ok: false, message: ready.message };
    try {
      if (cfg.backend) {
        const { status, data } = await requestJson(cfg.backend, {
          headers: backendHeaders(cfg),
          body: { action: "ping", shortcode: cfg.shortcode, environment: cfg.environment }
        });
        if (data?.ok === false) throw new Error(data.error || data.message || "The payment server refused the test.");
        if (status === 404) throw new Error("The backend URL was not found (HTTP 404).");
        return { ok: true, message: "The payment server answered." };
      }
      await oauthToken(cfg, true);
      return { ok: true, message: "Safaricom accepted the consumer key and secret." };
    } catch (error) {
      return { ok: false, message: friendlyError(error) };
    }
  }

  function isConfigured() {
    return readiness(T.mpesaConfig()).ok;
  }

  /**
   * A real end-to-end check: ask Safaricom for a KES 1 prompt on the given
   * phone. The "Test connection" button only proves the consumer key and
   * secret; this one also proves the shortcode and passkey belong together,
   * which is where most setups fail.
   */
  async function testPush(cfg = T.mpesaConfig(), { phone } = {}) {
    const ready = readiness(cfg);
    if (!ready.ok) return { ok: false, message: ready.message };
    const normal = normalizePhone(phone);
    if (!normal.ok) return { ok: false, message: normal.error };
    try {
      const push = await stkPush(cfg, {
        phone: normal.phone,
        amount: 1,
        accountRef: "TEST",
        description: "Biller test"
      });
      return {
        ok: true,
        message: `Safaricom accepted the request. The prompt should reach ${formatPhone(normal.phone)} — approve it to finish the test.`,
        checkoutId: push.checkoutRequestId
      };
    } catch (error) {
      return { ok: false, message: friendlyError(error) };
    }
  }

  T.mpesa = {
    normalizePhone,
    formatPhone,
    readiness,
    collect,
    cancel,
    testConnection,
    testPush,
    isConfigured,
    callbackUrl: CALLBACK_URL
  };
})();
