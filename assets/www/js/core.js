/* ============================================================
   Biller — core data, money and persistence
   ============================================================ */
window.Till = (() => {
  "use strict";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyDipRanbHa1buRomPAF0SZdHoW9yS4Muqg",
  authDomain: "biller-91aaf.firebaseapp.com",
  projectId: "biller-91aaf",
  storageBucket: "biller-91aaf.firebasestorage.app",
  messagingSenderId: "1095063549316",
  appId: "1:1095063549316:web:50f46fbf89724e989499d1"
};

// Firebase is initialized in app.js using the compat SDK (loaded via CDN)
// window.firebaseAuth is set there after initializeApp()

  const STORAGE_KEY = "biller.pos.v1";
  const AUTH_KEY = "biller.pos.auth";
  const DEBT_REMINDER_KEY = "biller.pos.debtReminder";
  // Each account keeps its own till, so signing in as somebody else never
  // shows the previous shop.
  const SHOP_PREFIX = "biller.pos.shop.";
  // The one account that may look at everything. It is never limited by the
// plan itself: it is the account that manages the plans.
const DEV_EMAILS = ["johnsonommala1@gmail.com"];
const OWNER_STAMP_KEY = "biller.pos.ownerOf";
  const CLAIMED_KEY = "biller.pos.claimed";
  const CURRENCY = "KES";
  const CURRENCY_CODES = ["KES", "USD", "EUR", "GBP", "UGX", "TZS", "GHS", "NGN", "INR", "AUD", "CAD"];
  const LOCALES = { KES: "en-KE", USD: "en-US", EUR: "en-EE", GBP: "en-GB", UGX: "en-UG", TZS: "en-TZ", GHS: "en-GH", NGN: "en-NG", INR: "en-IN", AUD: "en-AU", CAD: "en-CA" };
  const moneyFmtCache = {};
  function localeFor(code) { return LOCALES[String(code || CURRENCY).toUpperCase()] || "en-US"; }
  function moneyFmtFor(code) {
    const key = String(code || CURRENCY).toUpperCase();
    if (!moneyFmtCache[key]) moneyFmtCache[key] = new Intl.NumberFormat(localeFor(key), { style: "currency", currency: key, currencyDisplay: "symbol" });
    return moneyFmtCache[key];
  }
  // Categories are part of the saved state — the shop adds, renames and
  // removes them from the More tab. This is only the starting list.
  const CATEGORIES = ["Coffee", "Bakery", "Drinks", "Fresh", "Pantry", "Goods"];
  // Delivery days for suppliers. Stored as short codes so the same data can be
  // shown as chips on the supplier account and picked in the editor.
  const SUPPLIER_DAYS = [
    ["mon", "Mon"], ["tue", "Tue"], ["wed", "Wed"], ["thu", "Thu"],
    ["fri", "Fri"], ["sat", "Sat"], ["sun", "Sun"]
  ];
  const SUPPLIER_DAY_CODES = SUPPLIER_DAYS.map(([code]) => code);
  const TONE_BY_CATEGORY = {
    Coffee: "coffee", Bakery: "bakery", Drinks: "drinks",
    Fresh: "fresh", Pantry: "pantry", Goods: "goods"
  };
  const CATEGORY_TONES = ["coffee", "bakery", "drinks", "fresh", "pantry", "goods"];
  // App palettes. The id is written to <html data-theme="...">; the CSS holds
  // the actual colours. The default keeps the warm paper + forest look.
  const THEMES = [
    { id: "forest", name: "Forest", hint: "Warm paper" },
    { id: "ocean", name: "Ocean", hint: "Cool aqua" },
    { id: "clay", name: "Clay", hint: "Soft terracotta" },
    { id: "plum", name: "Plum", hint: "Muted berry" },
    { id: "black", name: "Black", hint: "Pure monochrome" }
  ];

  const moneyFmt = new Intl.NumberFormat("en-US", { style: "currency", currency: CURRENCY });
  const timeFmt = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });
  const shortDateFmt = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" });
  const longDateFmt = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" });
  const receiptDateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
  const monthDayFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  function money(cents) {
    const fmt = moneyFmtFor(T.state?.store?.currency || CURRENCY);
    return fmt.format((Number(cents) || 0) / 100);
  }
  function compactMoney(cents) {
    const fmt = moneyFmtFor(T.state?.store?.currency || CURRENCY);
    const symbol = fmt.formatToParts(0).find((part) => part.type === "currency")?.value || "$";
    const dollars = Math.round((Number(cents) || 0) / 100);
    if (dollars >= 100000) return `${symbol}${(dollars / 1000).toFixed(1)}k`;
    return `${symbol}${dollars.toLocaleString("en-US")}`;
  }
  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[ch]));
  }
  function uid(prefix = "id") {
    if (globalThis.crypto?.randomUUID) return `${prefix}_${crypto.randomUUID()}`;
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
  }
  function clampInt(value, min, max) {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return min;
    return Math.min(max, Math.max(min, n));
  }
  function parsePriceToCents(value) {
    const cleaned = String(value ?? "").replace(/[^0-9.]/g, "");
    const n = Number.parseFloat(cleaned);
    return Number.isFinite(n) ? Math.max(0, Math.round(n * 100)) : NaN;
  }
  function initials(name) {
    const words = String(name || "").replace(/[^A-Za-z0-9& ]/g, " ").split(/\s+/)
      .filter((w) => w && !/^\d+$/.test(w));
    const letters = (words[0]?.[0] || "") + (words[1]?.[0] || "");
    return (letters || String(name || "").slice(0, 2)).toUpperCase();
  }
  function cleanBarcode(value) {
    return String(value ?? "").trim().replace(/[\s\-–—]/g, "").toUpperCase();
  }
  /** Keep only digits — used for Paybill and Till numbers. */
  function digitsOnly(value) {
    return String(value ?? "").replace(/\D/g, "");
  }
  function canonicalBarcode(value) {
    const clean = cleanBarcode(value);
    if (!clean) return "";
    if (/^\d+$/.test(clean) && clean.length <= 14) return clean.padStart(14, "0");
    return clean;
  }
  function toneFor(category) {
    const known = TONE_BY_CATEGORY[category];
    if (known) return known;
    // Categories the shop made up still get a steady colour, so the same
    // category always looks the same on every card.
    const name = String(category || "");
    if (!name) return "pantry";
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
    return CATEGORY_TONES[hash % CATEGORY_TONES.length];
  }
  function isToday(value) {
    const d = new Date(value);
    const now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  }

  /** Local calendar day as YYYY-MM-DD — avoids UTC drift on date inputs. */
  function isoDay(value = new Date()) {
    const d = value instanceof Date ? value : new Date(value);
    const safe = Number.isNaN(d.getTime()) ? new Date() : d;
    return `${safe.getFullYear()}-${String(safe.getMonth() + 1).padStart(2, "0")}-${String(safe.getDate()).padStart(2, "0")}`;
  }
  function dayLabel(value) {
    const d = new Date(value);
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diff = Math.round((start - target) / 86400000);
    if (diff === 0) return "Today";
    if (diff === 1) return "Yesterday";
    if (diff < 7 && diff > 1) return new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(d);
    return monthDayFmt.format(d);
  }

  /* ---------- Default store data ---------- */

  function defaultStore() {
    return {
      name: "My Store",
      address: "",
      phone: "",
      staff: "",
      taxRate: 0,
      currency: "KES",
      theme: "forest",
      colorScheme: "light",
      textSize: "small",
      sellView: "grid",
      sellSort: "new",
      mpesa: {
        paybill: "",
        till: "",
        mode: "paybill",
        account: "",
        environment: "sandbox",
        consumerKey: "",
        consumerSecret: "",
        passkey: "",
        backend: ""
      },
      footer: "Thank you for shopping with us.",
      subscription: defaultSubscription(),
      // The monthly sales target the shop set for itself: an amount plus the
      // month and year it counts for. Blank until the shop picks one.
      target: { amountCents: 0, month: 0, year: 0 }
    };
  }

  /**
   * The shop's monthly plan. Every shop keeps its own copy, so the developer
   * can see who has paid and the app can nudge the ones who have not.
   */
  function defaultSubscription() {
    return {
      plan: "monthly",
      amountCents: 60000,
      currency: "KES",
      startedAt: "",
      paidUntil: "",
      lastPaidAt: "",
      lastReference: "",
      lastMethod: "",
      awaiting: false,
      reference: "",
      lastConfirmedAt: 0,
      payments: [],
      // The M-Pesa code the shop last sent to the developer, plus the codes
      // sent before it. Used to warn when the same code is sent twice.
      mpesaCode: "",
      codeHistory: []
    };
  }

  /** Clean a saved category list: trim, drop blanks, remove duplicates. */
  function normalizeCategories(list) {
    const source = Array.isArray(list) && list.length ? list : CATEGORIES;
    const out = [];
    const seen = new Set();
    for (const raw of source) {
      const name = String(raw ?? "").trim().replace(/\s+/g, " ");
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(name);
    }
    return out.length ? out : [...CATEGORIES];
  }

  /**
   * A brand new install starts empty: no products, no stock, no orders.
   * The shop fills the catalog from the Stock tab.
   */
  function seedState() {
    return {
      version: 1,
      store: defaultStore(),
      categories: [...CATEGORIES],
      products: [],
      suppliers: [],
      customers: [],
      transactions: [],
      cart: { items: [], discount: null },
      nextReceipt: 1,
      pro: false,
      // Wastage records: what spoiled, broke or went missing, and why.
      wastage: [],
      // Daily stock snapshots: the shelf counted at the start of a day and
      // the last level seen that day, keyed by YYYY-MM-DD.
      stockDays: {},
      createdAt: new Date().toISOString()
    };
  }

  function normalizeState(data) {
    if (!data || typeof data !== "object") return seedState();
    const fallback = defaultStore();
    const store = { ...fallback, ...(data.store || {}) };
    store.taxRate = Number.isFinite(Number(store.taxRate)) ? Number(store.taxRate) : fallback.taxRate;
    store.currency = CURRENCY_CODES.includes(String(store.currency || "").toUpperCase()) ? String(store.currency).toUpperCase() : (fallback.currency || CURRENCY);
    store.theme = THEMES.some((theme) => theme.id === store.theme) ? store.theme : (fallback.theme || "forest");
    // Light and dark are forced by the shop, never taken from the phone.
    store.colorScheme = store.colorScheme === "dark" ? "dark" : "light";
    store.textSize = ["small", "medium", "large"].includes(String(store.textSize || "small")) ? store.textSize : "small";
    store.sellView = store.sellView === "list" ? "list" : "grid";
    store.sellSort = ["new", "az", "za"].includes(store.sellSort) ? store.sellSort : "new";
    // The permanent shop code, used to identify paid accounts.
    store.shopCode = String(store.shopCode || "").trim().slice(0, 24);
    // The monthly plan: keep only sane values, never trust a half-saved copy.
    const savedSub = data.store && typeof data.store.subscription === "object" ? data.store.subscription : {};
    store.subscription = {
      plan: "monthly",
      amountCents: Number.isFinite(Number(savedSub.amountCents)) ? Math.max(0, Math.round(Number(savedSub.amountCents))) : fallback.subscription.amountCents,
      currency: CURRENCY_CODES.includes(String(savedSub.currency || "").toUpperCase()) ? String(savedSub.currency).toUpperCase() : fallback.subscription.currency,
      startedAt: String(savedSub.startedAt || "").slice(0, 40),
      paidUntil: String(savedSub.paidUntil || "").slice(0, 40),
      lastPaidAt: String(savedSub.lastPaidAt || "").slice(0, 40),
      lastReference: String(savedSub.lastReference || "").slice(0, 60),
      lastMethod: String(savedSub.lastMethod || "").slice(0, 20),
      awaiting: savedSub.awaiting === true,
      reference: String(savedSub.reference || "").slice(0, 24),
      lastConfirmedAt: Number.isFinite(Number(savedSub.lastConfirmedAt)) ? Number(savedSub.lastConfirmedAt) : 0,
      payments: Array.isArray(savedSub.payments)
        ? savedSub.payments.slice(-12).map((entry) => ({
            at: String(entry?.at || "").slice(0, 40),
            method: String(entry?.method || "").slice(0, 20),
            reference: String(entry?.reference || "").slice(0, 60),
            mpesaCode: String(entry?.mpesaCode || "").trim().toUpperCase().slice(0, 24),
            amountCents: Number.isFinite(Number(entry?.amountCents)) ? Math.round(Number(entry.amountCents)) : 0
          }))
        : [],
      mpesaCode: String(savedSub.mpesaCode || "").trim().toUpperCase().slice(0, 24),
      // Every M-Pesa code this shop has sent the developer, newest first.
      // Kept short so the warning "you already sent this code" stays honest.
      codeHistory: (Array.isArray(savedSub.codeHistory) ? savedSub.codeHistory : [])
        .slice(0, 24)
        .map((entry) => ({
          code: String(entry?.code || "").trim().toUpperCase().slice(0, 24),
          at: Number.isFinite(Number(entry?.at)) ? Number(entry.at) : 0
        }))
        .filter((entry) => entry.code)
    };
    // The monthly sales target: an amount for one month of one year.
    const savedTarget = typeof store.target === "object" && store.target ? store.target : {};
    store.target = {
      amountCents: clampInt(savedTarget.amountCents, 0, 1000000000),
      month: Number.isFinite(Number(savedTarget.month)) ? Math.min(12, Math.max(1, Math.round(Number(savedTarget.month)))) : 0,
      year: Number.isFinite(Number(savedTarget.year)) ? Math.min(2100, Math.max(2020, Math.round(Number(savedTarget.year)))) : 0
    };
    // M-Pesa settings live with the shop. Older saves have none, so keep
    // safe blanks rather than trusting a partly-shaped object.
    const savedMpesa = data.store && typeof data.store.mpesa === "object" ? data.store.mpesa : {};
    store.mpesa = {
      paybill: digitsOnly(savedMpesa.paybill).slice(0, 12),
      till: digitsOnly(savedMpesa.till).slice(0, 12),
      mode: savedMpesa.mode === "till" ? "till" : "paybill",
      // The default Paybill account number shows in the M-Pesa statement.
      account: String(savedMpesa.account || "").trim().slice(0, 12),
      environment: savedMpesa.environment === "production" ? "production" : "sandbox",
      consumerKey: String(savedMpesa.consumerKey || "").trim().slice(0, 200),
      consumerSecret: String(savedMpesa.consumerSecret || "").trim().slice(0, 300),
      passkey: String(savedMpesa.passkey || "").trim().slice(0, 300),
      backend: String(savedMpesa.backend || "").trim().slice(0, 300),
      backendKey: String(savedMpesa.backendKey || "").trim().slice(0, 300)
    };
    const categories = normalizeCategories(data.categories);
    const products = (Array.isArray(data.products) ? data.products : []).filter((p) => p && typeof p === "object").map((p, index) => {
      const wanted = String(p.category || "").trim().toLowerCase();
      const match = categories.find((category) => category.toLowerCase() === wanted);
      return {
        id: p.id || `p_${index}`,
        name: String(p.name || "Untitled item"),
        detail: String(p.detail || ""),
        barcode: cleanBarcode(p.barcode),
        price: clampInt(p.price, 0, 100000000),
        cost: clampInt(p.cost, 0, 100000000),
        stock: clampInt(p.stock, 0, 1000000),
        lowStockAt: clampInt(p.lowStockAt ?? 5, 0, 1000000),
        unit: String(p.unit || "pcs").trim().slice(0, 12) || "pcs",
        // Weighed items (fruit, ugali flour, meat): every quantity for this
        // product is grams, and the price is per kilogram.
        soldByMass: p.soldByMass === true,
        category: match || categories[0]
      };
    });
    const suppliers = (Array.isArray(data.suppliers) ? data.suppliers : []).filter((s) => s && typeof s === "object").map((s, index) => {
      const days = Array.isArray(s.days)
        ? [...new Set(s.days.map((day) => String(day || "").toLowerCase()))].filter((day) => SUPPLIER_DAY_CODES.includes(day))
        : [];
      const ledger = (Array.isArray(s.ledger) ? s.ledger : [])
        .map((entry, entryIndex) => {
          const type = entry.type === "payment" ? "payment" : "bill";
          const amount = clampInt(entry.amount, 0, 100000000);
          const date = /^\d{4}-\d{2}-\d{2}$/.test(String(entry.date || ""))
            ? String(entry.date)
            : isoDay(entry.createdAt || Date.now());
          return {
            id: entry.id || `se_${index}_${entryIndex}`,
            type,
            method: type === "payment" ? (String(entry.method || "").toLowerCase() === "mpesa" ? "mpesa" : "cash") : null,
            amount,
            note: String(entry.note || ""),
            date,
            createdAt: entry.createdAt || new Date().toISOString()
          };
        })
        .filter((entry) => entry.amount > 0);
      return {
        id: s.id || `s_${index}`,
        name: String(s.name || "Unnamed supplier"),
        contact: String(s.contact || ""),
        phone: String(s.phone || ""),
        email: String(s.email || ""),
        supplies: String(s.supplies || ""),
        address: String(s.address || ""),
        notes: String(s.notes || ""),
        days,
        ledger,
        createdAt: s.createdAt || new Date().toISOString()
      };
    });
    const productIds = new Set(products.map((p) => p.id));
    const customers = (Array.isArray(data.customers) ? data.customers : []).filter((c) => c && typeof c === "object").map((c, index) => {
      const entries = (Array.isArray(c.entries) ? c.entries : [])
        .map((entry, entryIndex) => {
          const type = entry.type === "payment" ? "payment" : "debt";
          const amount = clampInt(entry.amount, 0, 100000000);
          const date = /^\d{4}-\d{2}-\d{2}$/.test(String(entry.date || ""))
            ? String(entry.date)
            : isoDay(entry.createdAt || Date.now());
          const dueDate = /^\d{4}-\d{2}-\d{2}$/.test(String(entry.dueDate || ""))
            ? String(entry.dueDate)
            : null;
          return {
            id: entry.id || `ce_${index}_${entryIndex}`,
            type,
            method: type === "payment" ? (String(entry.method || "").toLowerCase() === "mpesa" ? "mpesa" : "cash") : null,
            amount,
            note: String(entry.note || ""),
            reference: String(entry.reference || ""),
            checkoutId: String(entry.checkoutId || ""),
            accountRef: String(entry.accountRef || "").slice(0, 12),
            txId: entry.txId || null,
            dueDate,
            date,
            createdAt: entry.createdAt || new Date().toISOString()
          };
        })
        .filter((entry) => entry.amount > 0);
      return {
        id: c.id || `c_${index}`,
        name: String(c.name || "Unnamed customer"),
        phone: String(c.phone || ""),
        entries,
        createdAt: c.createdAt || new Date().toISOString()
      };
    });
    const cart = data.cart && Array.isArray(data.cart.items) ? data.cart : { items: [], discount: null };
    cart.items = cart.items
      .filter((item) => item && productIds.has(item.productId) && Number(item.qty) > 0)
      .map((item) => {
        const product = products.find((p) => p.id === item.productId);
        // Weighed items carry grams; everything else carries whole units.
        const max = product?.soldByMass ? Math.min(product.stock, 1000000) : Math.min(product.stock, 1000);
        return { productId: item.productId, qty: Math.min(clampInt(item.qty, 1, max), product.stock) };
      })
      .filter((item) => item.qty > 0);
    cart.discount = cart.items.length && cart.discount && typeof cart.discount === "object" ? cart.discount : null;
    // Older carts and receipts can be missing fields the screens assume
    // exist. Fill them in here so one bad record cannot blank the whole app.
    const transactions = (Array.isArray(data.transactions) ? data.transactions : []).filter((tx) => tx && typeof tx === "object").map((tx, index) => {
      const items = (Array.isArray(tx.items) ? tx.items : []).map((item) => ({
        productId: item.productId || "",
        name: String(item.name || "Item"),
        detail: String(item.detail || ""),
        barcode: cleanBarcode(item.barcode),
        price: clampInt(item.price, 0, 100000000),
        cost: clampInt(item.cost, 0, 100000000),
        qty: clampInt(item.qty, 1, 1000000),
        // Weighed lines remember how they were counted, so old receipts and
        // new ones both print the right "1.5 kg".
        unit: String(item.unit || "").slice(0, 12),
        soldByMass: item.soldByMass === true
      }));
      const method = ["cash", "card", "mpesa", "debt"].includes(tx.payment?.method) ? tx.payment.method : "cash";
      return {
        id: tx.id || `tx_${index}`,
        receiptNo: Number(tx.receiptNo) || index + 1,
        createdAt: tx.createdAt || new Date().toISOString(),
        items,
        subtotal: clampInt(tx.subtotal, 0, 1000000000),
        discount: tx.discount && typeof tx.discount === "object" ? tx.discount : null,
        discountAmount: clampInt(tx.discountAmount, 0, 1000000000),
        taxRate: Number.isFinite(Number(tx.taxRate)) ? Number(tx.taxRate) : 0,
        tax: clampInt(tx.tax, 0, 1000000000),
        total: clampInt(tx.total, 0, 1000000000),
        payment: {
          method,
          tendered: clampInt(tx.payment?.tendered, 0, 1000000000),
          change: clampInt(tx.payment?.change, -1000000000, 1000000000),
          reference: tx.payment?.reference || null,
          checkoutId: String(tx.payment?.checkoutId || ""),
          account: String(tx.payment?.account || ""),
          accountRef: String(tx.payment?.accountRef || ""),
          customerId: tx.payment?.customerId || null,
          customerName: String(tx.payment?.customerName || ""),
          customerPhone: String(tx.payment?.customerPhone || ""),
          dueDate: tx.payment?.dueDate || null,
          note: String(tx.payment?.note || "")
        },
        store: tx.store && typeof tx.store === "object" ? { ...defaultStore(), ...tx.store } : { ...fallback }
      };
    });
    const maxReceipt = transactions.reduce((max, tx) => Math.max(max, Number(tx.receiptNo) || 0), 0);
    // Wastage: what the shop threw away, with a reason and who recorded it.
    const wastage = (Array.isArray(data.wastage) ? data.wastage : [])
      .filter((entry) => entry && typeof entry === "object")
      .map((entry, index) => ({
        id: entry.id || `w_${index}`,
        productId: String(entry.productId || ""),
        name: String(entry.name || "Item"),
        unit: String(entry.unit || "pcs").slice(0, 12) || "pcs",
        qty: clampInt(entry.qty, 1, 1000000),
        reason: String(entry.reason || "").slice(0, 40),
        note: String(entry.note || "").slice(0, 140),
        employee: String(entry.employee || "").slice(0, 60),
        date: /^\d{4}-\d{2}-\d{2}$/.test(String(entry.date || "")) ? String(entry.date) : isoDay(entry.createdAt || Date.now()),
        createdAt: entry.createdAt || new Date().toISOString()
      }))
      .filter((entry) => entry.qty > 0)
      .slice(0, 300);
    // Daily stock snapshots, keyed by YYYY-MM-DD. Only the last 45 days are
    // kept so the saved copy stays small even after months of trading.
    const stockDays = {};
    const savedDays = data.stockDays && typeof data.stockDays === "object" ? data.stockDays : {};
    const validDay = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
    const snapshotOf = (raw) => {
      if (!raw || typeof raw !== "object") return null;
      const out = {};
      for (const [pid, qty] of Object.entries(raw)) {
        const amount = clampInt(qty, 0, 1000000);
        if (pid && amount > 0) out[pid] = amount;
      }
      return Object.keys(out).length ? out : null;
    };
    for (const [day, value] of Object.entries(savedDays)) {
      if (!validDay(day) || !value || typeof value !== "object") continue;
      const opening = snapshotOf(value.opening);
      const latest = snapshotOf(value.latest);
      if (!opening && !latest) continue;
      stockDays[day] = {
        openingAt: Number.isFinite(Number(value.openingAt)) ? Number(value.openingAt) : 0,
        opening: opening,
        latestAt: Number.isFinite(Number(value.latestAt)) ? Number(value.latestAt) : 0,
        latest: latest
      };
    }
    const dayKeys = Object.keys(stockDays).sort();
    for (const stale of dayKeys.slice(0, Math.max(0, dayKeys.length - 45))) delete stockDays[stale];
    return {
      version: 1,
      store,
      categories,
      products,
      suppliers,
      customers,
      transactions,
      cart,
      nextReceipt: Math.max(Number(data.nextReceipt) || 0, maxReceipt + 1, 1),
      pro: data.pro === true,
      wastage,
      stockDays,
      createdAt: data.createdAt || new Date().toISOString()
    };
  }

  /* ---------- One till per account ---------- */

  const ownerKey = (owner) => `${SHOP_PREFIX}${owner || "local"}`;
  /** The account that owns the shop on screen ("local" while signed out). */
  let stateOwner = "local";

  function savedAtKey(owner) {
    return "biller.pos.savedAt." + (owner || "local");
  }

  function readStateFor(owner) {
    try {
      const raw = localStorage.getItem(ownerKey(owner));
      if (raw) return normalizeState(JSON.parse(raw));
    } catch (error) {
      console.warn("Could not read saved Biller data:", error);
    }
    return null;
  }

  /** Keep the shop on screen under the account that owns it. */
  function persistState(owner, { stamp = true } = {}) {
    try {
      const raw = JSON.stringify(T.state);
      localStorage.setItem(ownerKey(owner), raw);
      localStorage.setItem(STORAGE_KEY, raw);
      localStorage.setItem(OWNER_STAMP_KEY, owner || "local");
      // Each shop keeps its own timestamp, so saving one shop never makes
      // another shop look newer than the cloud copy it belongs to.
      if (stamp) localStorage.setItem(savedAtKey(owner), String(Date.now()));
    } catch (error) {
      console.warn("Could not save Biller data:", error);
    }
  }

  /** When this shop was last saved on this device. */
  function savedAtFor(owner) {
    const key = savedAtKey(owner || stateOwner);
    try {
      const stamp = Number(localStorage.getItem(key) || 0);
      return stamp || 0;
    } catch {
      return 0;
    }
  }

  function loadState() {
    const session = getSession();
    const owner = session?.uid || "local";
    stateOwner = owner;
    try {
      // Older versions kept one shop for the whole device. Mark it as
      // belonging to nobody, so another account can never claim it.
      if (!localStorage.getItem(OWNER_STAMP_KEY) && localStorage.getItem(STORAGE_KEY)) {
        localStorage.setItem(OWNER_STAMP_KEY, "unknown");
      }
    } catch { /* ignore */ }
    const own = readStateFor(owner);
    if (own) return own;
    if (owner === "local") {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) return normalizeState(JSON.parse(raw));
      } catch (error) {
        console.warn("Could not read saved Biller data:", error);
      }
    }
    return seedState();
  }

  /**
   * Switch the till over to another account. Signing out keeps the shop
   * safe under the account that owned it; signing in brings back that
   * account's own shop.
   */
  function activateAccount(user) {
    const nextOwner = String(user?.uid || "local");
    if (nextOwner === stateOwner) return { changed: false };
    const own = readStateFor(nextOwner);
    const stamp = (() => { try { return String(localStorage.getItem(OWNER_STAMP_KEY) || ""); } catch { return ""; } })();
    const claimed = (() => { try { return localStorage.getItem(CLAIMED_KEY) === "1"; } catch { return false; } })();
    if (own) {
      // This account has a till of its own.
      persistState(stateOwner);
      T.state = own;
    } else if (stateOwner === "local" && !claimed && !stamp) {
      // A shop that has never belonged to an account: the first account to
      // sign in takes it over.
      try { localStorage.setItem(CLAIMED_KEY, "1"); } catch { /* ignore */ }
    } else {
      // Somebody else's shop is on screen. Keep it safe and start a fresh
      // till for the account that just signed in.
      persistState(stateOwner);
      T.state = seedState();
    }
    stateOwner = nextOwner;
    persistState(nextOwner);
    // The saved stamp belonged to the shop we just left, so the cloud copy
    // for this account is free to win the next comparison.
    try { localStorage.removeItem("biller.pos.savedAt"); } catch { /* ignore */ }
    return { changed: true };
  }

  const getSession = () => {
    try {
      const raw = localStorage.getItem(AUTH_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      return data && typeof data.email === "string"
        ? { email: data.email, at: String(data.at || ""), uid: String(data.uid || "") }
        : null;
    } catch {
      return null;
    }
  };

  const setSession = (email, uid) => {
    try {
      const previous = getSession();
      const nextEmail = String(email || "").trim().toLowerCase() || previous?.email || "";
      // A blank uid must never wipe a good one, or the app loses track of
      // which shop belongs to the account. Keep the old uid only when it is
      // the same person signing in again.
      const samePerson = !!nextEmail && !!previous?.email && nextEmail === previous.email;
      const nextUid = String(uid || "").trim() || (samePerson ? String(previous?.uid || "") : "");
      localStorage.setItem(AUTH_KEY, JSON.stringify({
        email: nextEmail,
        uid: nextUid,
        at: new Date().toISOString()
      }));
      return true;
    } catch {
      return false;
    }
  };

  const clearSession = () => {
    try {
      localStorage.removeItem(AUTH_KEY);
      return true;
    } catch {
      return false;
    }
  };

  /* ---------- Public object ---------- */

  const T = {
    STORAGE_KEY, AUTH_KEY, CURRENCY, CATEGORIES, THEMES, SUPPLIER_DAYS, TONE_BY_CATEGORY,
    $, $$, money, compactMoney, esc, uid, clampInt, parsePriceToCents,
    initials, cleanBarcode, canonicalBarcode, toneFor, isoDay,
    isToday, dayLabel, timeFmt, shortDateFmt, longDateFmt, receiptDateFmt,
    defaultStore, seedState, normalizeState, normalizeCategories, defaultSubscription,
    getSession, setSession, clearSession, activateAccount, savedAtFor, DEV_EMAILS,
    state: loadState(),
    /** The categories the shop currently has. */
    categories: () => [...(T.state?.categories || [])],
    currencyCode: () => String((T.state && T.state.store && T.state.store.currency) || CURRENCY).toUpperCase(),
    currencySymbol: () => {
      const key = T.currencyCode();
      if (!moneyFmtCache[key]) moneyFmtCache[key] = moneyFmtFor(key);
      const part = moneyFmtCache[key].formatToParts(0).find((p) => p.type === "currency");
      return part?.value || "$";
    },
    setCurrency: (code) => {
      const next = String(code || CURRENCY).toUpperCase();
      if (!CURRENCY_CODES.includes(next)) return false;
      T.state.store.currency = next;
      T.save({ quiet: true });
      return true;
    },
    themeId: () => THEMES.some((theme) => theme.id === T.state.store.theme) ? T.state.store.theme : "forest",
    applyTheme: (id) => {
      const theme = THEMES.find((item) => item.id === String(id || T.themeId())) || THEMES[0];
      if (document?.documentElement) document.documentElement.setAttribute("data-theme", theme.id);
      return theme.id;
    },
    setTheme: (id) => {
      const theme = THEMES.find((item) => item.id === String(id || ""));
      if (!theme) return false;
      T.state.store.theme = theme.id;
      T.applyTheme(theme.id);
      T.save({ quiet: true });
      return true;
    },
    /** Light or dark. The shop picks it, so the phone's own setting is ignored. */
    colorScheme: () => (T.state.store?.colorScheme === "dark" ? "dark" : "light"),
    applyColorScheme: (id) => {
      const scheme = String(id || T.colorScheme()) === "dark" ? "dark" : "light";
      if (document?.documentElement) document.documentElement.setAttribute("data-color-scheme", scheme);
      return scheme;
    },
    setColorScheme: (id) => {
      const scheme = String(id || "") === "dark" ? "dark" : "light";
      T.state.store.colorScheme = scheme;
      T.applyColorScheme(scheme);
      T.save({ quiet: true });
      return true;
    },
    textSizeId: () => ["small", "medium", "large"].includes(String(T.state.store?.textSize || "small")) ? String(T.state.store.textSize) : "small",
    applyTextSize: (id) => {
      const size = ["small", "medium", "large"].includes(String(id || "")) ? String(id) : T.textSizeId();
      if (document?.documentElement) document.documentElement.setAttribute("data-text-size", size);
      return size;
    },
    setTextSize: (id) => {
      const size = ["small", "medium", "large"].includes(String(id || "")) ? String(id) : "small";
      T.state.store.textSize = size;
      T.applyTextSize(size);
      T.save({ quiet: true });
      return true;
    },
    /** How the Sell screen lays out its items: "grid" (3 across) or "list". */
    sellView: () => (T.state.store.sellView === "list" ? "list" : "grid"),
    setSellView: (view) => {
      const next = view === "list" ? "list" : "grid";
      if (T.state.store.sellView === next) return false;
      T.state.store.sellView = next;
      T.save({ quiet: true });
      return true;
    },
    /** How the Sell screen orders its items: "new", "az" or "za". */
    sellSort: () => (["new", "az", "za"].includes(T.state.store.sellSort) ? T.state.store.sellSort : "new"),
    setSellSort: (sort) => {
      const next = ["new", "az", "za"].includes(sort) ? sort : "new";
      if (T.state.store.sellSort === next) return false;
      T.state.store.sellSort = next;
      T.save({ quiet: true });
      return true;
    },
    isPro: () => T.state.pro === true,
    setPro: (value) => {
      T.state.pro = value === true;
      T.save({ quiet: true });
      return T.state.pro;
    },
    proPrice: () => 150000, // one-time Biller Pro unlock, in the smallest currency unit (KES cents)
    ads: {
      clientId: "ca-pub-0000000000000000",
      unitId: "PL-BILLER-0000",
      loading: false,
      async load() {
        if (T.ads.loading) return;
        T.ads.loading = true;
        try {
          await new Promise((resolve) => {
            if (window.googletag?.cmd) { resolve(); return; }
            const script = document.createElement("script");
            script.src = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js";
            script.async = true;
            script.onload = () => resolve();
            script.onerror = () => resolve();
            document.head.appendChild(script);
          });
        } catch { /* ad loading is best effort */ } finally { T.ads.loading = false; }
      },
      sync() {
        const slot = document.getElementById("ad-banner");
        if (!slot) return;
        if (T.isPro()) {
          slot.style.display = "none";
          slot.innerHTML = "";
          return;
        }
        slot.style.display = "block";
        if (!slot.firstElementChild) {
          const ins = document.createElement("ins");
          ins.className = "adsbygoogle";
          ins.setAttribute("data-ad-client", T.ads.clientId);
          ins.setAttribute("data-ad-slot", T.ads.unitId);
          ins.setAttribute("data-ad-format", "banner");
          ins.style.display = "block";
          slot.appendChild(ins);
        }
        if (!T.ads.loading) T.ads.load();
      }
    },
    ui: {
      route: { name: "sell", param: null },
      search: "",
      searchOpen: false,
      category: "All",
      stockSearch: "",
      supplierSearch: "",
      debtSearch: "",
      debtFilter: "all",
      ordersFilter: "all",
      payment: "cash",
      cash: "",
      cardBusy: false,
      mpesa: { stage: "idle", phone: "", account: "", error: "", checkoutId: "", startedAt: 0 },
      settingsOpen: {},
      justPaidId: null,
      scanPurpose: "sale",
      scanReturn: "#/sell",
      unknownCode: "",
      stockFilter: "all",
      discountMode: "percent",
      editor: null,
      exitPromptOpen: false,
      saveTimer: null,
      toastTimer: null
    }
  };

  T.findProduct = (id) => T.state.products.find((p) => p.id === id);
  T.findSupplier = (id) => (T.state.suppliers || []).find((s) => s.id === id);

  /** Money owed to a supplier: stock bills minus payments already made. */
  T.supplierTotals = (supplier) => {
    const ledger = supplier?.ledger || [];
    const bills = ledger.filter((entry) => entry.type === "bill").reduce((sum, entry) => sum + entry.amount, 0);
    const payments = ledger.filter((entry) => entry.type === "payment");
    const paid = payments.reduce((sum, entry) => sum + entry.amount, 0);
    const cash = payments.filter((entry) => entry.method === "cash").reduce((sum, entry) => sum + entry.amount, 0);
    const mpesa = payments.filter((entry) => entry.method === "mpesa").reduce((sum, entry) => sum + entry.amount, 0);
    return { bills, paid, cash, mpesa, balance: bills - paid };
  };

  /**
   * Bills that are still not fully paid. Payments are pooled and applied to
   * the oldest bill first, so the earliest invoice clears first.
   */
  T.supplierOpenBills = (supplier) => {
    const ledger = supplier?.ledger || [];
    const bills = ledger
      .map((entry, index) => ({ entry, index }))
      .filter((item) => item.entry.type === "bill")
      .sort((a, b) => {
        if (a.entry.date !== b.entry.date) return a.entry.date < b.entry.date ? -1 : 1;
        const at = new Date(a.entry.createdAt).getTime();
        const bt = new Date(b.entry.createdAt).getTime();
        if (at !== bt) return at - bt;
        // Entries are unshifted, so the later array position is the older
        // bill. This keeps two bills saved in the same millisecond in order.
        return b.index - a.index;
      })
      .map((item) => item.entry);
    let pool = ledger.filter((entry) => entry.type === "payment").reduce((sum, entry) => sum + entry.amount, 0);
    return bills.map((bill) => {
      const applied = Math.min(pool, bill.amount);
      pool -= applied;
      return { ...bill, applied, remaining: bill.amount - applied };
    }).filter((bill) => bill.remaining > 0);
  };

  /**
   * Add stock that was received to the catalog. Lines look like
   * { productId, qty, cost }. Returns the lines that were applied so they can
   * be stored on the supplier's ledger.
   */
  T.applyStockLines = (lines) => {
    const applied = [];
    (Array.isArray(lines) ? lines : []).forEach((line) => {
      const product = T.findProduct(line.productId);
      const qty = clampInt(line.qty, 0, 100000);
      if (!product || qty <= 0) return;
      product.stock = clampInt(product.stock + qty, 0, 1000000);
      const cost = clampInt(line.cost, 0, 100000000);
      // Stock that came in at a known price sets the buying price.
      if (cost > 0) product.cost = cost;
      applied.push({
        productId: product.id,
        name: product.name,
        unit: product.unit || "pcs",
        qty,
        cost
      });
    });
    return applied;
  };

  /**
   * Put received stock on the shelf and record the buying and selling prices.
   */
  T.receiveStock = (id, { qty = 0, cost = null, price = null } = {}) => {
    const product = T.findProduct(id);
    if (!product) return { ok: false, error: "That item is no longer in the catalog." };
    // Weighed items take grams; everything else takes whole units.
    const amount = clampInt(qty, 0, product.soldByMass ? 1000000 : 1000000);
    if (amount <= 0) return { ok: false, error: product.soldByMass ? "Enter how much you received." : "Enter how many you received." };
    if (cost !== null && cost !== undefined) {
      const value = clampInt(cost, 0, 100000000);
      if (value > 0) product.cost = value;
    }
    if (price !== null && price !== undefined) {
      const value = clampInt(price, 0, 100000000);
      if (value > 0) product.price = value;
    }
    product.stock = clampInt(product.stock + amount, 0, 1000000);
    T.save();
    return { ok: true, product };
  };

  /* ---------- Customer debt ---------- */

  const phoneKey = (value) => String(value || "").replace(/\D/g, "");

  T.findCustomer = (id) => (T.state.customers || []).find((customer) => customer.id === id);

  T.findCustomerByPhone = (phone) => {
    const key = phoneKey(phone);
    if (!key) return null;
    return (T.state.customers || []).find((customer) => phoneKey(customer.phone) === key) || null;
  };

  T.debtDefaultDueDate = (days = 7) => {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return isoDay(date);
  };

  /** Friendly wording for a payment date, including overdue and today. */
  T.debtDueInfo = (dueDate) => {
    if (!dueDate) return { status: "open", label: "No payment date", days: null };
    const due = new Date(`${dueDate}T00:00:00`);
    if (Number.isNaN(due.getTime())) return { status: "open", label: "No payment date", days: null };
    const today = new Date(`${isoDay()}T00:00:00`);
    const days = Math.round((due - today) / 86400000);
    if (days < 0) return { status: "overdue", label: days === -1 ? "Overdue 1 day" : `Overdue ${-days} days`, days };
    if (days === 0) return { status: "due", label: "Due today", days: 0 };
    if (days === 1) return { status: "scheduled", label: "Due tomorrow", days: 1 };
    return { status: "scheduled", label: `Due ${monthDayFmt.format(due)}`, days };
  };

  T.customerTotals = (customer) => {
    const entries = customer?.entries || [];
    const debts = entries.filter((entry) => entry.type === "debt");
    const payments = entries.filter((entry) => entry.type === "payment");
    const billed = debts.reduce((sum, entry) => sum + entry.amount, 0);
    const paid = payments.reduce((sum, entry) => sum + entry.amount, 0);
    const cash = payments.filter((entry) => entry.method === "cash").reduce((sum, entry) => sum + entry.amount, 0);
    const mpesa = payments.filter((entry) => entry.method === "mpesa").reduce((sum, entry) => sum + entry.amount, 0);
    return { billed, paid, cash, mpesa, balance: billed - paid };
  };

  /**
   * Open credit sales, oldest first. Payments are pooled and applied to the
   * oldest debt first, so a customer's earliest due date clears first.
   */
  T.customerOpenDebts = (customer) => {
    const entries = customer?.entries || [];
    const debts = entries
      .map((entry, index) => ({ entry, index }))
      .filter((item) => item.entry.type === "debt")
      .sort((a, b) => {
        if (a.entry.date !== b.entry.date) return a.entry.date < b.entry.date ? -1 : 1;
        const at = new Date(a.entry.createdAt).getTime();
        const bt = new Date(b.entry.createdAt).getTime();
        if (at !== bt) return at - bt;
        // Entries are unshifted, so the later array position is the older
        // debt. This keeps two debts saved in the same millisecond in order.
        return b.index - a.index;
      })
      .map((item) => item.entry);
    let pool = entries.filter((entry) => entry.type === "payment").reduce((sum, entry) => sum + entry.amount, 0);
    return debts.map((debt) => {
      const applied = Math.min(pool, debt.amount);
      pool -= applied;
      return { ...debt, applied, remaining: debt.amount - applied };
    }).filter((debt) => debt.remaining > 0);
  };

  T.customerSummary = (customer) => {
    const totals = T.customerTotals(customer);
    const open = T.customerOpenDebts(customer);
    const overdue = open.filter((debt) => T.debtDueInfo(debt.dueDate).status === "overdue");
    const due = open.filter((debt) => T.debtDueInfo(debt.dueDate).status === "due");
    const scheduled = open
      .filter((debt) => T.debtDueInfo(debt.dueDate).status === "scheduled")
      .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
    const dated = open
      .filter((debt) => debt.dueDate)
      .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
    return {
      ...totals,
      open,
      overdue,
      due,
      scheduled,
      nextDue: dated[0]?.dueDate || null,
      overdueAmount: overdue.reduce((sum, debt) => sum + debt.remaining, 0),
      dueAmount: due.reduce((sum, debt) => sum + debt.remaining, 0),
      status: totals.balance <= 0 ? "settled" : overdue.length ? "overdue" : due.length ? "due" : "open"
    };
  };

  T.customerLedger = (customer) => [...(customer?.entries || [])].sort((a, b) => {
    if (a.date === b.date) return new Date(b.createdAt) - new Date(a.createdAt);
    return a.date < b.date ? 1 : -1;
  });

  T.debtCustomers = () => (T.state.customers || []).map((customer) => ({
    customer,
    summary: T.customerSummary(customer)
  }));

  T.debtDueCount = () => T.debtCustomers()
    .filter(({ summary }) => summary.status === "due" || summary.status === "overdue")
    .length;

  /** Customers whose payment date is today or already past. */
  T.debtReminders = () => T.debtCustomers()
    .filter(({ summary }) => summary.status === "due" || summary.status === "overdue")
    .sort((a, b) => {
      if (a.summary.status !== b.summary.status) return a.summary.status === "overdue" ? -1 : 1;
      return b.summary.balance - a.summary.balance;
    });

  T.debtReminderSeenToday = () => {
    try {
      return localStorage.getItem(DEBT_REMINDER_KEY) === isoDay();
    } catch {
      return false;
    }
  };

  T.markDebtReminderSeen = () => {
    try {
      localStorage.setItem(DEBT_REMINDER_KEY, isoDay());
    } catch { /* reminders are best effort */ }
  };

  /** Add a cash or M-Pesa payment against a customer's debt account. */
  T.recordCustomerPayment = (id, { amount, method = "cash", date, note = "", reference = "", checkoutId = "", accountRef = "" } = {}) => {
    const customer = T.findCustomer(id);
    if (!customer) return null;
    const cents = clampInt(amount, 0, 100000000);
    if (!cents) return null;
    const day = /^\d{4}-\d{2}-\d{2}$/.test(String(date || "")) ? String(date) : isoDay();
    const entry = {
      id: uid("ce"),
      type: "payment",
      method: String(method || "").toLowerCase() === "mpesa" ? "mpesa" : "cash",
      amount: cents,
      note: String(note || "").trim(),
      reference: String(reference || "").trim(),
      checkoutId: String(checkoutId || "").trim(),
      accountRef: String(accountRef || "").trim().slice(0, 12),
      txId: null,
      dueDate: null,
      date: day,
      createdAt: new Date().toISOString()
    };
    customer.entries = customer.entries || [];
    customer.entries.unshift(entry);
    T.save();
    return entry;
  };

  T.findProductByBarcode = (value) => {
    const key = canonicalBarcode(value);
    if (!key) return null;
    return T.state.products.find((p) => canonicalBarcode(p.barcode) === key) || null;
  };
  T.cartLines = () => T.state.cart.items.map((item) => {
    const product = T.findProduct(item.productId);
    if (!product) return null;
    // A price set at the till wins over the catalog price.
    const price = item.price === undefined || item.price === null ? product.price : item.price;
    const unitCost = item.cost === undefined || item.cost === null ? (product.cost || 0) : item.cost;
    const mass = product.soldByMass === true;
    // Weighed lines are grams and the price is per kilogram: 750 g of a
    // KES 200/kg item costs KES 150. Everything else multiplies out plainly.
    const lineTotal = mass ? Math.round(price * item.qty / 1000) : price * item.qty;
    const lineCost = mass ? Math.round(unitCost * item.qty / 1000) : unitCost * item.qty;
    return {
      ...item,
      product,
      price,
      unitCost,
      lineTotal,
      lineCost
    };
  }).filter(Boolean);
  T.itemCount = () => T.state.cart.items.reduce((sum, item) => {
    // A weighed line is one item on the counter no matter how many grams,
    // so the "3 items" label keeps talking about things, not grams.
    const product = T.findProduct(item.productId);
    return sum + (product?.soldByMass ? 1 : item.qty);
  }, 0);
  T.cartTotals = () => {
    const lines = T.cartLines();
    const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);
    const cost = lines.reduce((sum, line) => sum + line.lineCost, 0);
    const discount = T.state.cart.discount;
    let discountAmount = 0;
    if (discount) {
      discountAmount = discount.type === "percent"
        ? Math.round(subtotal * Math.min(100, Math.max(0, discount.value)) / 100)
        : Math.min(subtotal, Math.max(0, discount.value));
    }
    const taxable = subtotal - discountAmount;
    const tax = Math.round(taxable * T.state.store.taxRate / 100);
    // Tax is collected for the government, so profit is worked out on the
    // sale price before tax, minus what the stock cost.
    const profit = taxable - cost;
    return {
      lines,
      subtotal,
      cost,
      discount,
      discountAmount,
      taxable,
      tax,
      total: taxable + tax,
      profit,
      margin: taxable > 0 ? profit / taxable : 0
    };
  };

  /**
   * Set the price of a line in the open sale. Passing null puts the catalog
   * price back.
   */
  T.setCartPrice = (productId, cents) => {
    const item = T.state.cart.items.find((entry) => entry.productId === productId);
    if (!item) return false;
    if (cents === null || cents === undefined) {
      delete item.price;
    } else {
      const value = clampInt(cents, 0, 100000000);
      if (!value) return false;
      item.price = value;
    }
    T.save();
    return true;
  };

  /* ---------- Weighed products ---------- */

  /** True when a product is sold by the kilogram (fruit, flour, meat…). */
  T.isMass = (product) => product?.soldByMass === true;
  /** The unit a weighed product is priced in: always the kilogram. */
  T.massUnit = () => "kg";

  /**
   * Grams as a shop-friendly label: 1500 g reads "1.5 kg", 250 g reads
   * "250 g". Used on tiles, carts and receipts so nothing shows "1500 kg".
   */
  T.massLabel = (grams) => {
    const value = Math.max(0, Math.round(Number(grams) || 0));
    if (value >= 1000) {
      const kg = value / 1000;
      const text = Number.isInteger(kg) ? String(kg) : kg.toFixed(kg >= 10 ? 1 : 2).replace(/\.?0+$/, "");
      return `${text} kg`;
    }
    return `${value} g`;
  };

  /**
   * How a quantity reads on screens and receipts: weighed lines say "1.5 kg",
   * everything else says the plain count.
   */
  T.qtyText = (item) => (item?.soldByMass ? T.massLabel(item.qty) : String(item?.qty ?? 0));

  /** The money a receipt line brought in, whatever way it was counted. */
  T.itemRevenue = (item) => (item?.soldByMass ? Math.round((item?.price || 0) * (item?.qty || 0) / 1000) : (item?.price || 0) * (item?.qty || 0));

  /** What a receipt line cost, falling back to the product's buying price. */
  T.itemCostOf = (item) => {
    const unit = item?.cost ?? (T.findProduct(item?.productId)?.cost || 0);
    return item?.soldByMass ? Math.round(unit * (item?.qty || 0) / 1000) : unit * (item?.qty || 0);
  };

  /**
   * What a receipt earned: the money in minus what the stock cost. Older
   * receipts fall back to the buying price on the product.
   */
  T.txProfit = (tx) => {
    const items = tx?.items || [];
    const revenue = Math.max(0, (tx?.subtotal ?? tx?.total ?? 0) - (tx?.discountAmount || 0));
    const cost = items.reduce((sum, item) => sum + T.itemCostOf(item), 0);
    const profit = revenue - cost;
    return { revenue, cost, profit, margin: revenue > 0 ? profit / revenue : 0 };
  };
  T.lowStockCount = () => T.state.products.filter((p) => p.stock > 0 && p.stock <= p.lowStockAt).length;
  T.outOfStockCount = () => T.state.products.filter((p) => p.stock === 0).length;
  T.stockValue = () => T.state.products.reduce((sum, p) => sum + p.price * (p.soldByMass ? p.stock / 1000 : p.stock), 0);
  /** What the stock on the shelf cost to buy. */
  T.stockCost = () => T.state.products.reduce((sum, p) => sum + (p.cost || 0) * (p.soldByMass ? p.stock / 1000 : p.stock), 0);

  /* ---------- Wastage ---------- */

  /** Why stock left the shelf without a sale. */
  T.WASTAGE_REASONS = ["Spoiled", "Damaged", "Expired", "Spilled", "Missing", "Other"];

  /**
   * Record stock that left the shelf without a sale: spoiled, broken,
   * expired, spilled or gone missing. The shelf goes down by the same
   * amount, so the books stay honest.
   */
  T.recordWastage = (productId, { qty = 0, reason = "", note = "", employee = "" } = {}) => {
    const product = T.findProduct(productId);
    if (!product) return { ok: false, error: "That item is no longer in the catalog." };
    const mass = product.soldByMass === true;
    const amount = clampInt(qty, 0, 1000000);
    if (amount <= 0) return { ok: false, error: mass ? "Enter how much was wasted." : "Enter how many were wasted." };
    if (amount > product.stock) {
      return { ok: false, error: mass
        ? `Only ${T.massLabel(product.stock)} in stock.`
        : `Only ${product.stock} in stock.` };
    }
    const cleanReason = T.WASTAGE_REASONS.includes(String(reason)) ? String(reason) : "Other";
    product.stock = clampInt(product.stock - amount, 0, 1000000);
    T.state.wastage = T.state.wastage || [];
    T.state.wastage.unshift({
      id: uid("w"),
      productId: product.id,
      name: product.name,
      unit: mass ? "kg" : (product.unit || "pcs"),
      qty: amount,
      reason: cleanReason,
      note: String(note || "").trim().slice(0, 140),
      employee: String(employee || "").trim().slice(0, 60),
      date: isoDay(),
      createdAt: new Date().toISOString()
    });
    if (T.state.wastage.length > 300) T.state.wastage.length = 300;
    T.save();
    return { ok: true, product };
  };

  /** Wastage within a window of days: entries, items and the cost of it. */
  T.wastageSince = (days) => {
    const entries = T.state.wastage || [];
    if (!days) return { entries, count: entries.length, qty: entries.reduce((s, e) => s + e.qty, 0) };
    const start = new Date();
    start.setDate(start.getDate() - days);
    start.setHours(0, 0, 0, 0);
    const picked = entries.filter((entry) => new Date(`${entry.date}T00:00:00`) >= start);
    return {
      entries: picked,
      count: picked.length,
      qty: picked.reduce((sum, entry) => sum + entry.qty, 0),
      cost: picked.reduce((sum, entry) => {
        const product = T.findProduct(entry.productId);
        const unit = product?.cost || 0;
        const mass = entry.unit === "kg" && product?.soldByMass;
        return sum + (mass ? Math.round(unit * entry.qty / 1000) : unit * entry.qty);
      }, 0)
    };
  };

  /* ---------- Daily stock days ---------- */

  const stockSnapshot = () => {
    const snap = {};
    for (const product of T.state.products) {
      if (product.stock > 0) snap[product.id] = product.stock;
    }
    return snap;
  };

  /**
   * Keep the daily stock book up to date: the first save of a new day counts
   * the shelf as the day's opening stock, and every save refreshes the last
   * level seen. When a new day opens, the old day's last level becomes its
   * closing stock. Only the last 45 days are kept.
   */
  T.markStockDay = () => {
    try {
      const today = isoDay();
      const days = T.state.stockDays || (T.state.stockDays = {});
      // Close any earlier day that never got a final count.
      for (const day of Object.keys(days).sort()) {
        if (day >= today) continue;
        const record = days[day];
        if (record.latest) { record.closing = record.latest; record.closingAt = record.latestAt; }
      }
      const record = days[today] || (days[today] = { openingAt: 0, opening: null, latestAt: 0, latest: null });
      const now = Date.now();
      if (!record.opening) {
        record.opening = stockSnapshot();
        record.openingAt = now;
      }
      record.latest = stockSnapshot();
      record.latestAt = now;
      // Keep the book short: 45 days is about six weeks of trading.
      const keys = Object.keys(days).sort();
      for (const stale of keys.slice(0, Math.max(0, keys.length - 45))) delete days[stale];
      return true;
    } catch { /* the stock book must never break a save */ }
    return false;
  };

  /** The stock book as a list, newest day first. */
  T.stockDaysList = () => Object.entries(T.state.stockDays || {})
    .map(([date, value]) => ({ date, ...value }))
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  /** One day's opening and closing levels, with what moved in between. */
  T.stockDayDetail = (date) => {
    const record = (T.state.stockDays || {})[date];
    if (!record) return null;
    const opening = record.opening || {};
    const closing = record.closing || record.latest || {};
    const dayStart = new Date(`${date}T00:00:00`).getTime();
    const dayEnd = dayStart + 86400000;
    const sold = {};
    const wasted = {};
    for (const tx of T.state.transactions || []) {
      const stamp = new Date(tx.createdAt).getTime();
      if (!(stamp >= dayStart && stamp < dayEnd)) continue;
      for (const item of tx.items || []) sold[item.productId] = (sold[item.productId] || 0) + (item.qty || 0);
    }
    for (const entry of T.state.wastage || []) {
      if (entry.date !== date) continue;
      wasted[entry.productId] = (wasted[entry.productId] || 0) + (entry.qty || 0);
    }
    const ids = [...new Set([...Object.keys(opening), ...Object.keys(closing)])];
    const rows = ids.map((productId) => {
      const product = T.findProduct(productId);
      const mass = product?.soldByMass === true || (product == null && false);
      return {
        productId,
        name: product?.name || "Removed item",
        mass: product?.soldByMass === true,
        unit: product?.soldByMass ? "kg" : (product?.unit || "pcs"),
        opening: opening[productId] || 0,
        closing: closing[productId] || 0,
        sold: sold[productId] || 0,
        wasted: wasted[productId] || 0
      };
    }).sort((a, b) => a.name.localeCompare(b.name));
    return { date, openingAt: record.openingAt, closingAt: record.closingAt || record.latestAt, rows };
  };

  /* ---------- Monthly sales target ---------- */

  /** The target the shop set, joined to what the month has made so far. */
  T.monthTarget = () => {
    const target = T.state.store?.target || {};
    const now = new Date();
    const active = Number(target.amountCents) > 0 && Number(target.month) === now.getMonth() + 1 && Number(target.year) === now.getFullYear();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const made = (T.state.transactions || [])
      .filter((tx) => new Date(tx.createdAt) >= monthStart)
      .reduce((sum, tx) => sum + (tx.total || 0), 0);
    const amountCents = active ? Number(target.amountCents) : 0;
    return {
      set: active,
      amountCents,
      made,
      percent: amountCents > 0 ? Math.min(999, Math.round(made / amountCents * 100)) : 0,
      remaining: Math.max(0, amountCents - made),
      met: amountCents > 0 && made >= amountCents
    };
  };

  /** Save the monthly target. Passing 0 clears it. */
  T.setTarget = (amountCents, { month, year } = {}) => {
    const now = new Date();
    const value = clampInt(amountCents, 0, 1000000000);
    const nextMonth = Number.isFinite(Number(month)) ? Math.min(12, Math.max(1, Math.round(Number(month)))) : now.getMonth() + 1;
    const nextYear = Number.isFinite(Number(year)) ? Math.min(2100, Math.max(2020, Math.round(Number(year)))) : now.getFullYear();
    T.state.store.target = value > 0 ? { amountCents: value, month: nextMonth, year: nextYear } : { amountCents: 0, month: 0, year: 0 };
    T.save();
    return T.state.store.target;
  };

  /* ---------- Monthly plan: duplicate M-Pesa code guard ---------- */

  /**
   * True when an M-Pesa code was already sent to the developer. M-Pesa
   * codes are unique per transaction, so the same code twice usually means
   * the same single payment being claimed twice.
   */
  T.subscriptionCodeSeen = (code) => {
    const clean = String(code || "").trim().toUpperCase();
    if (!clean) return null;
    const sub = T.state.store?.subscription;
    if (!sub) return null;
    const seen = (sub.codeHistory || []).find((entry) => entry.code === clean);
    if (seen) return { at: seen.at, source: "history" };
    if (sub.mpesaCode && sub.mpesaCode === clean && sub.awaiting) {
      return { at: sub.lastConfirmedAt || 0, source: "awaiting" };
    }
    const inPayments = (sub.payments || []).some((entry) => String(entry.mpesaCode || "").toUpperCase() === clean);
    if (inPayments) return { at: 0, source: "payments" };
    return null;
  };

  /** Remember a code the shop sent, so the next submission can be checked. */
  T.rememberSubscriptionCode = (code) => {
    const clean = String(code || "").trim().toUpperCase().slice(0, 24);
    if (!clean) return;
    const sub = T.state.store?.subscription;
    if (!sub) return;
    sub.mpesaCode = clean;
    sub.codeHistory = [{ code: clean, at: Date.now() }, ...(sub.codeHistory || []).filter((entry) => entry.code !== clean)].slice(0, 24);
  };

  /* ---------- CSV export ---------- */

  /**
   * Save a CSV file. On Android the native bridge writes it straight into
   * the phone's Downloads folder so the shop can find it; a plain browser
   * falls back to a normal file download.
   */
  T.exportCsv = async (fileName, rows) => {
    const table = Array.isArray(rows) ? rows : [];
    const cell = (value) => {
      const text = String(value ?? "");
      return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const body = table.map((row) => (Array.isArray(row) ? row : [row]).map(cell).join(",")).join("\r\n");
    const csv = `\uFEFF${body}`; // BOM keeps Excel reading commas right.
    // The native bridge first: it saves into Downloads/Biller POS/.
    try {
      const bridge = window.Capacitor?.Plugins?.TillReceipt;
      if (bridge?.saveCsv) {
        const result = await bridge.saveCsv({ fileName, text: csv });
        if (result?.saved) return { ok: true, where: result.path || "Downloads/Biller POS" };
      }
    } catch { /* fall through to the browser download */ }
    try {
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      return { ok: true, where: "download" };
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  };

  /** The shop's M-Pesa setup, with the shortcode that receives the money. */
  T.mpesaConfig = () => {
    const raw = T.state.store?.mpesa || {};
    let mode = raw.mode === "till" ? "till" : "paybill";
    if (mode === "till" && !raw.till && raw.paybill) mode = "paybill";
    if (mode === "paybill" && !raw.paybill && raw.till) mode = "till";
    const shortcode = String((mode === "till" ? raw.till : raw.paybill) || "");
    // Credentials shipped with the app (js/daraja.js) fill any blank field, so
    // a shop only has to type its own Paybill or Till number. Sandbox uses the
    // sandbox preset; production uses the top level values.
    const bundled = (typeof window !== "undefined" && window.TillDaraja) || {};
    const environment = raw.environment === "production" ? "production" : "sandbox";
    const preset = environment === "sandbox" ? (bundled.sandbox || {}) : bundled;
    const pick = (value, key) => String(value || preset[key] || "").trim();
    return {
      paybill: String(raw.paybill || ""),
      till: String(raw.till || ""),
      mode,
      shortcode,
      account: String(raw.account || "").trim().slice(0, 12),
      environment,
      consumerKey: pick(raw.consumerKey, "consumerKey"),
      consumerSecret: pick(raw.consumerSecret, "consumerSecret"),
      passkey: pick(raw.passkey, "passkey"),
      backend: String(raw.backend || bundled.backend || "").trim(),
      backendKey: String(raw.backendKey || bundled.backendKey || "").trim()
    };
  };

  /* ---------- Monthly plan ---------- */

  /** Is this the developer's own account? */
  T.isDeveloperAccount = () => {
    try {
      if (T.cloud?.status?.().isOwner) return true;
      const email = String(getSession()?.email || "").trim().toLowerCase();
      return !!email && DEV_EMAILS.includes(email);
    } catch {
      return false;
    }
  };


  const TRIAL_DAYS = 7;

  /**
   * A short code that identifies the shop for ever: it appears on the
   * developer's subscription panel, and the shop quotes it with a payment so
   * the developer can tell who paid.
   */
  T.shopCode = () => {
    const existing = String(T.state.store?.shopCode || "").trim();
    if (existing) return existing;
    const name = String(T.state.store?.name || "SHOP").replace(/[^a-z0-9]/gi, "").slice(0, 6).toUpperCase() || "SHOP";
    const digits = String(Math.floor(1000 + Math.random() * 9000));
    const code = `${name}-${digits}`;
    T.state.store.shopCode = code;
    return code;
  };

  /** True when the shop may not sell until the plan is settled. */
  T.subscriptionLocked = () => {
    // The developer account is never locked, so the tools that manage the
    // subscriptions always stay reachable.
    if (T.isDeveloperAccount()) return false;
    const status = T.subscriptionStatus();
    if (status !== "due" && status !== "overdue" && status !== "awaiting") return false;
    return true;
  };

  /** The plan details the app ships with (price, trial length). */
  function planConfig() {    const bundled = (typeof window !== "undefined" && window.TillDaraja) || {};
    const fee = bundled.fee || {};
    const amountCents = Number.isFinite(Number(fee.amountCents))
      ? Math.max(0, Math.round(Number(fee.amountCents)))
      : 60000;
    return {
      enabled: fee.enabled !== false,
      amountCents,
      currency: fee.currency || "KES",
      trialDays: Number.isFinite(Number(fee.trialDays)) ? Math.max(0, Math.round(Number(fee.trialDays))) : TRIAL_DAYS,
      // Where the developer collects the money.
      shortcode: String(fee.shortcode || "").trim(),
      mode: fee.mode === "paybill" ? "paybill" : "till",
      environment: fee.environment === "production" ? "production" : "sandbox",
      account: String(fee.account || "").trim().slice(0, 12),
      label: String(fee.label || "Biller POS monthly plan").slice(0, 60),
      mpesaNumber: String(fee.mpesaNumber || "").trim().slice(0, 20),
      bank: {
        name: String(fee.bank?.name || "").trim().slice(0, 60),
        number: String(fee.bank?.number || "").trim().slice(0, 40),
        bank: String(fee.bank?.bank || "").trim().slice(0, 60)
      },
      contact: String(fee.contact || "").trim().slice(0, 60)
    };
  }

  /** The shop's plan state, with the plan price folded in. */
  T.subscription = () => {
    const sub = { ...defaultSubscription(), ...(T.state.store?.subscription || {}) };
    const plan = planConfig();
    return { ...sub, planAmountCents: plan.amountCents, planCurrency: plan.currency };
  };

  /** The plan the app ships with: price, label and trial length. */
  T.planSummary = () => {
    const plan = planConfig();
    return {
      enabled: plan.enabled,
      amountCents: plan.amountCents,
      currency: plan.currency,
      label: plan.label,
      trialDays: plan.trialDays
    };
  };

  /** A stable reference the shop quotes when it pays. */
  T.subscriptionReference = () => {
    const sub = T.subscription();
    if (sub.reference) return sub.reference;
    const base = String(T.state.store?.name || "shop").replace(/[^a-z0-9]/gi, "").slice(0, 6).toUpperCase() || "SHOP";
    const tail = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `${base}-${tail}`;
  };

  const dayMs = 24 * 60 * 60 * 1000;

  /** Trial, active, due, overdue or waiting for confirmation. */
  T.subscriptionStatus = () => {
    const sub = T.subscription();
    const plan = planConfig();
    if (!plan.enabled) return "active";
    // The developer manages the plans, so the plan never restricts this account.
    if (T.isDeveloperAccount()) return "active";
    if (sub.awaiting) return "awaiting";
    const now = Date.now();
    if (!sub.startedAt) {
      // First run: the free trial starts today.
      T.state.store.subscription = { ...sub, startedAt: new Date().toISOString(), reference: T.subscriptionReference() };
      T.save({ quiet: true });
      if (plan.trialDays > 0) return "trial";
      return "due";
    }
    const started = new Date(sub.startedAt).getTime();
    if (!sub.paidUntil && plan.trialDays > 0 && Number.isFinite(started) && now - started < plan.trialDays * dayMs) return "trial";
    if (!sub.paidUntil) return "due";
    const until = new Date(sub.paidUntil).getTime();
    if (!Number.isFinite(until)) return "due";
    // A paid shop stays active right up to the end of the period it paid for.
    // The three-day reminder is scheduled from the active state; the shop is
    // only locked once the plan has actually fallen due.
    if (now < until) return "active";
    // A week late is labelled overdue for the stronger "shop is paused" copy.
    // Both due and overdue are locked until the payment is confirmed.
    if (now - until > 7 * dayMs) return "overdue";
    return "due";
  };

  /** The date the next payment is due, if there is one. */
  T.subscriptionDueDate = () => {
    const sub = T.subscription();
    if (!sub.paidUntil) return null;
    const date = new Date(sub.paidUntil);
    return Number.isFinite(date.getTime()) ? date : null;
  };

  T.subscriptionDaysLeft = () => {
    const due = T.subscriptionDueDate();
    if (!due) return null;
    return Math.ceil((due.getTime() - Date.now()) / dayMs);
  };

  /** Record a payment and move the plan forward by a month. */
  T.markSubscriptionPaid = ({ method = "mpesa", reference = "" } = {}) => {
    const sub = T.subscription();
    const base = sub.paidUntil ? new Date(sub.paidUntil) : new Date();
    if (!Number.isFinite(base.getTime())) base.setTime(Date.now());
    // One month from the current end date (or today), so a payment keeps the
    // plan running instead of eating into the time already paid for.
    const next = new Date(base.getTime());
    next.setMonth(next.getMonth() + 1);
    const entry = {
      at: new Date().toISOString(),
      method: String(method || "").slice(0, 20),
      reference: String(reference || "").slice(0, 60),
      amountCents: sub.amountCents || planConfig().amountCents
    };
    T.state.store.subscription = {
      ...sub,
      paidUntil: next.toISOString(),
      lastPaidAt: entry.at,
      lastReference: entry.reference,
      lastMethod: entry.method,
      awaiting: false,
      payments: [...(sub.payments || []), entry].slice(-12)
    };
    T.save();
    return T.state.store.subscription;
  };

  /** The shop says the money is on its way; the developer confirms later. */
  T.setSubscriptionAwaiting = (reference = "") => {
    const sub = T.subscription();
    T.state.store.subscription = {
      ...sub,
      awaiting: true,
      reference: String(reference || sub.reference || T.subscriptionReference()).slice(0, 24)
    };
    T.save();
    return T.state.store.subscription;
  };

  /** The Daraja setup used to collect the monthly fee. */
  T.feeConfig = () => {
    const plan = planConfig();
    const bundled = (typeof window !== "undefined" && window.TillDaraja) || {};
    const preset = plan.environment === "sandbox" ? (bundled.sandbox || {}) : bundled;
    return {
      ...plan,
      consumerKey: String(preset.consumerKey || "").trim(),
      consumerSecret: String(preset.consumerSecret || "").trim(),
      passkey: String(preset.passkey || "").trim(),
      backend: String(bundled.backend || "").trim(),
      backendKey: String(bundled.backendKey || "").trim()
    };
  };

  /** Can the fee be collected with an M-Pesa prompt right now? */
  T.feeReady = () => {
    const fee = T.feeConfig();
    if (!fee.enabled || !fee.shortcode) return false;
    if (fee.backend) return true;
    return !!(fee.consumerKey && fee.consumerSecret && fee.passkey);
  };

  /* ---------- Categories ---------- */

  /** Add a category. Names are compared without case. */
  T.addCategory = (name) => {
    const clean = String(name || "").trim().replace(/\s+/g, " ");
    if (!clean) return { ok: false, error: "Give the category a name." };
    if (T.state.categories.some((c) => c.toLowerCase() === clean.toLowerCase())) {
      return { ok: false, error: "That category already exists." };
    }
    T.state.categories.push(clean);
    T.save();
    return { ok: true, name: clean };
  };

  /** Rename a category. The products in it follow the new name. */
  T.renameCategory = (current, next) => {
    const clean = String(next || "").trim().replace(/\s+/g, " ");
    if (!clean) return { ok: false, error: "Give the category a name." };
    const index = T.state.categories.findIndex((c) => c === current);
    if (index < 0) return { ok: false, error: "That category no longer exists." };
    if (T.state.categories.some((c, i) => i !== index && c.toLowerCase() === clean.toLowerCase())) {
      return { ok: false, error: "That category already exists." };
    }
    T.state.categories[index] = clean;
    for (const product of T.state.products) {
      if (product.category === current) product.category = clean;
    }
    if (T.ui.category === current) T.ui.category = clean;
    T.save();
    return { ok: true, name: clean };
  };

  /** Remove a category. Its products move to the next category over. */
  T.removeCategory = (name) => {
    if (T.state.categories.length <= 1) {
      return { ok: false, error: "Keep at least one category." };
    }
    const index = T.state.categories.findIndex((c) => c === name);
    if (index < 0) return { ok: false, error: "That category no longer exists." };
    const fallback = T.state.categories[index === 0 ? 1 : 0];
    T.state.categories.splice(index, 1);
    for (const product of T.state.products) {
      if (product.category === name) product.category = fallback;
    }
    if (T.ui.category === name) T.ui.category = "All";
    T.save();
    return { ok: true, fallback };
  };

  T.countInCategory = (name) => T.state.products.filter((p) => p.category === name).length;

  /* ---------- Completing a sale ---------- */

  /**
   * Turn the open cart into a stored receipt, take the sold units off the
   * shelf and empty the cart. Returns the receipt, or null when the cart
   * was empty.
   */
  T.completeSale = ({ method = "cash", tendered = 0, amountCents = 0, reference = null, checkoutId = "", accountRef = "", customerName = "", customerPhone = "", customerId = null, dueDate = null, note = "" } = {}) => {
    const totals = T.cartTotals();
    if (!totals.lines.length) return null;
    // M-Pesa only accepts whole shillings. When the app had to round the
    // request, the receipt records the amount the customer actually paid,
    // not the cart total, so the books and the M-Pesa statement agree.
    const override = Math.round(Number(amountCents) || 0);
    const charged = override > 0 ? override : totals.total;
    const rounding = charged - totals.total;
    const isDebt = method === "debt";
    let customer = null;
    let debtDueDate = null;
    if (isDebt) {
      const name = String(customerName || "").trim().replace(/\s+/g, " ");
      const phone = String(customerPhone || "").trim();
      if (!name || !phone) return null;
      customer = (customerId && T.findCustomer(customerId)) || T.findCustomerByPhone(phone);
      if (customer) {
        customer.name = name || customer.name;
        customer.phone = phone || customer.phone;
      } else {
        customer = { id: uid("c"), name, phone, entries: [], createdAt: new Date().toISOString() };
        T.state.customers = T.state.customers || [];
        T.state.customers.unshift(customer);
      }
      debtDueDate = /^\d{4}-\d{2}-\d{2}$/.test(String(dueDate || "")) ? String(dueDate) : T.debtDefaultDueDate();
    }
    const store = { ...T.state.store };
    // Receipts keep the shop details, never the payment credentials.
    delete store.mpesa;
    const items = totals.lines.map((line) => ({
      productId: line.product.id,
      name: line.product.name,
      detail: line.product.detail,
      barcode: line.product.barcode,
      price: line.price,
      cost: line.unitCost,
      qty: line.qty,
      // Weighed lines remember how they were counted so the receipt reads
      // "1.5 kg" instead of a bare "1500".
      unit: line.product.soldByMass ? "kg" : (line.product.unit || "pcs"),
      soldByMass: line.product.soldByMass === true
    }));
    const receiptNo = Math.max(1, Number(T.state.nextReceipt) || 1);
    const paid = method === "cash" ? Math.max(Number(tendered) || 0, charged) : charged;
    const tx = {
      id: uid("tx"),
      receiptNo,
      createdAt: new Date().toISOString(),
      items,
      subtotal: totals.subtotal,
      discount: totals.discount ? { ...totals.discount } : null,
      discountAmount: totals.discountAmount,
      taxRate: store.taxRate,
      tax: totals.tax,
      rounding,
      total: charged,
      cost: totals.cost,
      profit: totals.profit + rounding,
      payment: isDebt
        ? {
            method: "debt",
            tendered: 0,
            change: 0,
            reference: null,
            customerId: customer.id,
            customerName: customer.name,
            customerPhone: customer.phone,
            dueDate: debtDueDate,
            note: String(note || "").trim()
          }
        : method === "cash"
          ? { method: "cash", tendered: paid, change: paid - charged, reference: null }
          : method === "mpesa"
            ? {
                method: "mpesa",
                tendered: charged,
                change: 0,
                reference: String(reference || "").trim() || null,
                checkoutId: String(checkoutId || "").trim(),
                accountRef: String(accountRef || "").trim().slice(0, 12),
                customerPhone: String(customerPhone || "").trim(),
                account: String(note || "").trim()
              }
            : { method: "card", tendered: charged, change: 0, reference: reference || `POS-${receiptNo}` },
      store
    };
    // The sold units leave the shelf.
    for (const line of totals.lines) {
      const product = T.findProduct(line.product.id);
      if (!product) continue;
      product.stock = Math.max(0, product.stock - line.qty);
    }
    T.state.transactions.unshift(tx);
    T.state.nextReceipt = receiptNo + 1;
    if (isDebt && customer) {
      customer.entries = customer.entries || [];
      customer.entries.unshift({
        id: uid("ce"),
        type: "debt",
        method: null,
        amount: totals.total,
        note: String(note || "").trim(),
        txId: tx.id,
        dueDate: debtDueDate,
        date: isoDay(),
        createdAt: new Date().toISOString()
      });
    }
    // The sale is done — the cart starts empty for the next customer.
    T.state.cart = { items: [], discount: null };
    T.save();
    return tx;
  };

  T.setSaveState = (mode) => {
    const el = document.getElementById("saveState");
    if (!el) return;
    el.classList.toggle("is-saving", mode === "saving");
    el.classList.toggle("is-error", mode === "error");
    const label = el.querySelector(".save-label");
    if (label) label.textContent = mode === "saving" ? "Saving" : mode === "error" ? "Not saved" : "Saved";
  };

  T.save = ({ quiet = false, stamp = true, sync = true } = {}) => {
    clearTimeout(T.ui.saveTimer);
    T.ui.saving = true;
    T.ui.saveError = false;
    T.setSaveState("saving");
    // The daily stock book rides along with every save: openings on the
    // first save of a day, the last level seen on every one.
    T.markStockDay();
    try {
      persistState(stateOwner, { stamp });
      if (stamp) {
        try { localStorage.setItem("biller.pos.savedAt", String(Date.now())); } catch { /* ignore */ }
      }
      // The cloud copy follows a moment later, so a burst of edits is one write.
      if (sync) T.cloud?.push?.();
      T.ui.saveTimer = setTimeout(() => {
        T.ui.saving = false;
        T.setSaveState("saved");
      }, 620);
      return true;
    } catch (error) {
      console.warn("Could not save Till data:", error);
      T.ui.saving = false;
      T.ui.saveError = true;
      T.setSaveState("error");
      if (!quiet) T.toast("Could not save on this device", "i-alert");
      return false;
    }
  };

  /** Remember that this device and the cloud now hold the same copy. */
  T.setSavedAt = (ms) => {
    const value = Number(ms) > 0 ? Number(ms) : Date.now();
    try {
      localStorage.setItem(savedAtKey(stateOwner), String(value));
    } catch { /* ignore */ }
    return value;
  };

  T.toast = (message, icon = "i-check") => {
    const el = document.getElementById("toast");
    if (!el) return;
    el.innerHTML = `<svg class="ico" aria-hidden="true"><use href="#${icon}"></use></svg><span>${esc(message)}</span>`;
    el.classList.add("show");
    clearTimeout(T.ui.toastTimer);
    T.ui.toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
  };

  T.dismissToast = () => {
    const el = document.getElementById("toast");
    if (!el) return;
    clearTimeout(T.ui.toastTimer);
    el.classList.remove("show");
  };

  T.vibrate = (pattern = 12) => {
    try { navigator.vibrate?.(pattern); } catch { /* ignore */ }
  };

  T.beep = () => {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 1180;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.055, ctx.currentTime + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.07);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.08);
      osc.addEventListener("ended", () => ctx.close().catch(() => {}));
    } catch { /* audio is optional */ }
  };

  /* ---------- Added-to-cart confirmations ---------- */

  const CONFIRM_MS = 3000;

  /** The stack of "item added" cards that sit at the top of the screen. */
  function confirmStack() {
    let stack = document.getElementById("cart-confirmations");
    if (!stack) {
      const app = document.getElementById("app");
      if (!app) return null;
      stack = document.createElement("div");
      stack.id = "cart-confirmations";
      stack.className = "cart-confirm-stack";
      stack.setAttribute("aria-live", "polite");
      app.appendChild(stack);
    }
    return stack;
  }

  /**
   * Confirm that a scanned item went into the cart. The card sits at the top
   * of the screen for three seconds; a quick second scan adds another card
   * below it, and every card counts down on its own.
   */
  T.confirmAdded = (product, qty = 1) => {
    if (!product) return;
    const stack = confirmStack();
    if (!stack) return;
    // Sit just under the app bar so the scan and cart buttons stay reachable.
    const bar = document.getElementById("appbar");
    const barHeight = bar && !bar.classList.contains("is-hidden") ? bar.getBoundingClientRect().height : 0;
    stack.style.top = `${Math.round(barHeight + 8)}px`;
    const card = document.createElement("div");
    card.className = "cart-confirm";
    const variant = product.detail ? `<small>${esc(product.detail)}</small>` : "";
    const mass = product.soldByMass === true;
    const addedMoney = mass ? Math.round(product.price * qty / 1000) : product.price * qty;
    const addedLabel = mass ? `${T.massLabel(qty)} added` : (qty > 1 ? `${qty} added` : "Added");
    card.innerHTML = `<span class="cart-confirm-tile tone-${T.toneFor(product.category)}" aria-hidden="true">${esc(T.initials(product.name))}</span>
      <span class="cart-confirm-copy"><strong>${esc(product.name)}</strong>${variant}</span>
      <span class="cart-confirm-price"><strong>${money(addedMoney)}</strong><small>${esc(addedLabel)}</small></span>`;
    stack.appendChild(card);
    requestAnimationFrame(() => card.classList.add("is-in"));
    setTimeout(() => {
      card.classList.add("is-out");
      setTimeout(() => card.remove(), 240);
    }, CONFIRM_MS);
  };

  /* ---------- Barcode handling (quick sell) ---------- */

  /** Put one unit of a product in the sale. Returns true when it went in. */
  T.addToCart = (product, qty = 1) => {
    if (!product) return false;
    const mass = product.soldByMass === true;
    if (product.stock <= 0) {
      T.toast(`${product.name} is out of stock`, "i-alert");
      return false;
    }
    const existing = T.state.cart.items.find((item) => item.productId === product.id);
    const wanted = (existing?.qty || 0) + qty;
    const allowed = Math.min(wanted, product.stock);
    if (allowed <= 0) {
      T.toast(`${product.name} is out of stock`, "i-alert");
      return false;
    }
    if (existing) existing.qty = allowed;
    else T.state.cart.items.push({ productId: product.id, qty: allowed });
    if (allowed < wanted) {
      T.toast(mass
        ? `Only ${T.massLabel(product.stock)} of ${product.name} left in stock`
        : `Only ${product.stock} ${product.name} left in stock`, "i-alert");
    }
    T.save();
    return true;
  };

  /**
   * A barcode came in from the camera. For a quick sale the product goes
   * straight into the cart and the scanner keeps going, so a whole basket can
   * be rung up one scan at a time.
   */
  T.app = {
    handleBarcode(code, { source = "scan" } = {}) {
      const product = T.findProductByBarcode(code);
      if (!product) {
        T.scanner?.pause?.();
        T.sheets?.openUnknown?.(code, {
          onClose: () => { T.scanner?.resume?.(); }
        });
        return { status: "unknown", product: null };
      }
      if (product.stock <= 0) {
        T.scanner?.pause?.();
        T.sheets?.openOutOfStock?.(product, {
          fromScan: true,
          onClose: () => { T.scanner?.resume?.(); }
        });
        return { status: "out-of-stock", product };
      }
      // A weighed item has no fixed "one": the scan opens the scale so the
      // shopkeeper types or taps the weight first.
      if (product.soldByMass === true) {
        T.scanner?.pause?.();
        T.sheets?.openWeigh?.(product, {
          fromScan: true,
          onClose: () => { T.scanner?.resume?.(); }
        });
        return { status: "weigh", product };
      }
      const added = T.addToCart(product, 1);
      if (!added) return { status: "failed", product };
      // Confirm at the top of the screen what just went into the cart.
      T.confirmAdded(product, 1);
      // If the compact scan window is open, update its running total and
      // refresh the Sell screen behind it so the cart bar keeps up.
      T.sheets?.refreshQuickScan?.();
      if (source === "quick") window.render?.();
      if (source === "scan") {
        // Keep the camera open so the next item can be scanned straight away.
        setTimeout(() => {
          if (T.ui.route?.name === "scan") T.scanner?.resume?.();
        }, 700);
      }
      return { status: "added", product };
    },

    /** A barcode was scanned while editing a product — drop it in the field. */
    editorBarcode(code) {
      const editor = T.ui.editor;
      if (!editor) return;
      const value = String(code || "");
      editor.values.barcode = value;
      const field = document.getElementById("product-barcode");
      if (field) {
        // Update the live field only. Re-rendering the sheet would throw away
        // everything the shopkeeper has already typed in.
        field.value = value;
        field.dispatchEvent(new Event("input", { bubbles: true }));
        return;
      }
      T.sheets?.renderProductEditor?.();
    }
  };

  return T;
})();
