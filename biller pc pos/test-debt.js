/**
 * Self-check for the Biller debt flow. No framework, no browser.
 *
 * Stubs just enough DOM/localStorage for core.js to load, then drives the
 * same code the phone runs: add to cart -> completeSale({method:"debt"}) ->
 * customer ledger. Also replays the exact regex the debt form uses, because
 * a double-escaped regex there was what broke "Add to debt" on the device.
 *
 *   node counter/test-debt.js
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const CORE = path.join(__dirname, "js", "core.js");

/* ---------- minimal browser shims ---------- */
const store = new Map();
const sandbox = {
  console,
  Intl,
  Date,
  Math,
  Number,
  String,
  Array,
  Object,
  JSON,
  Set,
  Map,
  setTimeout,
  clearTimeout,
  crypto: { randomUUID: () => "uuid-" + Math.random().toString(36).slice(2) },
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k)
  },
  document: {
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
    addEventListener: () => {}
  },
  navigator: { vibrate: () => {} },
  AudioContext: undefined
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;

vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(CORE, "utf8"), sandbox, { filename: CORE });
const T = sandbox.window.Till;

/* ---------- the regex the debt form validates with ---------- */
// Pulled straight out of sheets.js so the test breaks if it regresses.
const sheetsSrc = fs.readFileSync(path.join(__dirname, "js", "sheets.js"), "utf8");
const dateReLine = sheetsSrc.split("\n").find((l) => l.includes('test(dueDate)'));
assert.ok(dateReLine, "debt form date regex not found in sheets.js");
const dateRe = eval(dateReLine.match(/(\/\^.*?\$\/)/)[1]);

/* ---------- 1. the due-date regex must accept a real date ---------- */
const today = T.isoDay();
assert.strictEqual(dateRe.test(today), true, `due-date regex rejected ${today}`);
assert.strictEqual(dateRe.test("2026-11-16"), true, "due-date regex rejected 2026-11-16");
assert.strictEqual(dateRe.test("not-a-date"), false, "due-date regex accepted junk");
console.log("ok  due-date regex accepts YYYY-MM-DD");

/* ---------- 2. phone normalising used by the debt form ---------- */
const digitsOf = (phone) => String(phone).replace(/\D/g, "");
assert.strictEqual(digitsOf("+254 700 000 000").length, 12, "phone digits not extracted");
assert.ok(digitsOf("0712345678").length >= 7, "phone too short");
console.log("ok  phone number normalises to digits");

/* ---------- 3. product -> cart ---------- */
const product = {
  id: "p1", name: "Unga 2kg", detail: "", barcode: "6001234567890",
  price: 15000, stock: 10, lowStockAt: 2, unit: "pcs", category: "Pantry"
};
T.state.products.push(product);
assert.strictEqual(T.addToCart(product, 2), true, "addToCart failed");
assert.strictEqual(T.itemCount(), 2, "cart count wrong");
const totals = T.cartTotals();
assert.strictEqual(totals.subtotal, 30000, "subtotal wrong");
console.log("ok  cart totals compute");

/* ---------- 4. the debt sale itself ---------- */
const dueDate = T.debtDefaultDueDate(7);
assert.ok(dateRe.test(dueDate), "default due date fails the form regex");

const tx = T.completeSale({
  method: "debt",
  customerName: "Mary Wanjiku",
  customerPhone: "+254 700 000 000",
  dueDate,
  note: "Pay Friday"
});
assert.ok(tx, "completeSale returned null — the debt sale was rejected");
assert.strictEqual(tx.payment.method, "debt", "payment method not debt");
assert.strictEqual(tx.total, 30000, "debt total wrong");
assert.strictEqual(tx.payment.dueDate, dueDate, "due date not stored");
assert.strictEqual(tx.payment.customerName, "Mary Wanjiku", "customer name not stored");
console.log("ok  debt sale stores a receipt");

/* ---------- 5. stock came down, cart cleared, receipt numbered ---------- */
assert.strictEqual(T.findProduct("p1").stock, 8, "stock not decremented");
assert.strictEqual(T.itemCount(), 0, "cart not cleared after sale");
assert.strictEqual(tx.receiptNo, 1, "receipt number wrong");
assert.strictEqual(T.state.nextReceipt, 2, "next receipt not incremented");
console.log("ok  stock, cart and receipt counter updated");

/* ---------- 6. customer ledger sees the debt ---------- */
const customer = T.findCustomerByPhone("+254700000000");
assert.ok(customer, "customer not created / not matched by phone");
assert.strictEqual(customer.name, "Mary Wanjiku", "customer name wrong");
const summary = T.customerSummary(customer);
assert.strictEqual(summary.billed, 30000, "billed amount wrong");
assert.strictEqual(summary.balance, 30000, "balance wrong");
assert.strictEqual(summary.open.length, 1, "open debt not listed");
assert.strictEqual(summary.open[0].remaining, 30000, "remaining wrong");
assert.strictEqual(summary.status, "open", "status should be open (due in 7 days)");
console.log("ok  customer debt ledger is correct");

/* ---------- 7. a second credit sale pools onto the same customer ---------- */
T.addToCart(T.findProduct("p1"), 1);
const tx2 = T.completeSale({
  method: "debt", customerName: "Mary Wanjiku",
  // Same digits as the first sale. Matching is on digits alone, so a
  // differently formatted but identical number still finds her.
  customerPhone: "254700000000", dueDate: T.debtDefaultDueDate(3)
});
assert.ok(tx2, "second debt sale rejected");
assert.strictEqual(T.state.customers.length, 1, "second sale created a duplicate customer");
assert.strictEqual(T.customerSummary(customer).balance, 45000, "pooled balance wrong");
console.log("ok  repeat customer is matched, not duplicated");

/* ---------- 8. a payment reduces the balance ---------- */
const payment = T.recordCustomerPayment(customer.id, { amount: 20000, method: "mpesa" });
assert.ok(payment, "payment not recorded");
const after = T.customerSummary(customer);
assert.strictEqual(after.paid, 20000, "paid amount wrong");
assert.strictEqual(after.balance, 25000, "balance not reduced by payment");
assert.strictEqual(after.mpesa, 20000, "mpesa total wrong");
// 20000 lands on the oldest 30000 debt, leaving 10000 there plus the
// untouched 15000 one — so both stay open, oldest first.
assert.strictEqual(after.open.length, 2, "partial payment should leave both debts open");
assert.strictEqual(after.open[0].remaining, 10000, "payment did not go to the oldest debt first");
assert.strictEqual(after.open[1].remaining, 15000, "newer debt should be untouched");
console.log("ok  payment settles the oldest debt first");

/* ---------- 9. debt needs a name and a phone ---------- */
// Put something in the cart first, so a null here is the name check and not
// just an empty-cart early return.
T.addToCart(T.findProduct("p1"), 1);
assert.ok(T.itemCount() > 0, "cart should not be empty for this check");
assert.strictEqual(T.completeSale({ method: "debt", customerName: "", customerPhone: "0700000000" }), null,
  "debt sale accepted without a customer name");
assert.strictEqual(T.completeSale({ method: "debt", customerName: "No Phone", customerPhone: "" }), null,
  "debt sale accepted without a phone number");
assert.ok(T.state.cart.items.length > 0, "a rejected debt sale must not empty the cart");
console.log("ok  debt sale refuses a missing name or phone, and keeps the cart");

console.log("\nall debt checks passed");
