# M-Pesa setup

Biller POS can ask a customer for an M-Pesa payment while you are checking them
out. The customer gets the usual Safaricom PIN prompt on their phone; when they
enter the PIN, the money goes to **your** Paybill or Till and the sale is saved
as an M-Pesa payment with their number on the receipt.

This uses Safaricom's **Daraja / Lipa na M-Pesa Online (STK Push)** API. You
need a Daraja account for your own Paybill or Till; the app cannot use somebody
else's shortcode.

---

## 1. Get your Daraja details

1. Open <https://developer.safaricom.co.ke> and sign in (or create an account).
2. Go to **My Apps → Add New App**. Tick **Lipa Na M-Pesa Sandbox** while you
   are testing.
3. Open the app and copy the **Consumer Key** and **Consumer Secret**.
4. Get the **Lipa na M-Pesa passkey** for your shortcode:
   - Sandbox: use the shared test passkey shown in the Daraja sandbox docs.
   - Production: request your passkey with your Go Live application.
5. Copy the **Paybill number** (Business Short Code) or **Till number** you want
   the money to land in. For a Till, the transaction type is *Buy Goods*; for a
   Paybill it is *Pay Bill*.

> The credentials are stored in your shop's private Firestore document
> (`billerShops/<your uid>`), which only your signed-in account can read. They
> are never put on receipts or in the developer panel.

### Sandbox values (testing only)

| Field | Value |
| --- | --- |
| Paybill | `174379` |
| Passkey | `bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919` |
| Test phone | `254708374149` |
| Environment | Sandbox |

Use your own Consumer Key/Secret from the sandbox app you created. Sandbox
money is not real.

---

## 2. Fill it in on the phone (self-serve, nobody else involved)

Open **Settings → Shop & receipts → M-Pesa**. The M-Pesa block starts with the
two choices that decide how the money moves:

- **Send payments to** — Paybill or Till. The number you are not using is
  greyed out (and cannot be typed in), so it is always clear which shortcode
  the till is charging. Both numbers are still remembered.
- **Daraja environment** — Sandbox while testing, Production for real money.
- **Paybill number** and/or **Till number** — the shortcode that receives the
  money. For a Till the transaction type is *Buy Goods*; for a Paybill it is
  *Pay Bill*.
- **Paybill account number** — optional. This is the account number that shows
  in your M-Pesa statement. The cashier can change it on each sale; if it is
  left blank, the receipt number (`POS-12`) is used.

Then the three steps the screen lists:

1. **Your shortcode** — the Paybill or Till number that should receive money.
2. **Your Daraja app** — open **Connection details** and paste the Consumer
   Key, Consumer Secret and the Lipa na M-Pesa passkey that Safaricom issued
   for that shortcode. This is the shop's own Daraja app, so nobody else has to
   do it for them, and it is saved with their shop once.
3. **Check it** — type your own phone number and tap **Send KES 1 test
   prompt**. Approve the prompt on your phone. If it works, the shortcode and
   passkey match and the till is ready for customers.
4. Tap **Save store settings**.

Then: add items to the cart, tap **Checkout**, choose **M-Pesa**, type the
customer's number (`07…`, `01…` or `254…`), and tap **Send M-Pesa request**.
For a Paybill, check the **Account number** field first — that is what the
customer is paying into on your statement. A Till (Buy Goods) has no account
number. Keep the checkout screen open until it says the payment was received.

The same M-Pesa request works for customer debt: open **Debt → a customer →
Record payment**, enter the amount, choose **M-Pesa**, and send the request.
When the customer enters their PIN the payment is added to their account with
the M-Pesa code — no manual entry needed.

**Test connection** only proves the consumer key and secret (it calls the
Daraja token endpoint). The **KES 1 test prompt** is the real check, because
it also proves the passkey belongs to the shortcode — the most common setup
mistake.

> **The direct connection needs the installed Android app.** Safaricom does not
> allow browsers to call the payment API (no CORS). In a normal browser the app
> shows a setup message instead of sending a request. Use the Android build, or
> configure a backend URL (below).

### Trying it before you have a Daraja account

Tap **Try the Safaricom sandbox** in Connection details. It fills the form with
Safaricom's published sandbox Paybill (`174379`) and sandbox passkey, plus the
sandbox consumer key and secret from `js/daraja.js` (section 5) — which are
already filled in, so the button works out of the box. The money is fake, so
this is safe to leave in the app you hand out: a new user sees the whole
PIN-prompt flow in a minute.

Sandbox prompts are answered in Safaricom's sandbox simulator rather than on a
real phone, so the app waits for the customer and then says *"No confirmation
yet…"*. Use the shop's own live credentials for a real test.

---

## 3. Going live

1. Finish Safaricom's **Go Live** process for your app and shortcode.
2. Switch **Daraja environment** to **Production**.
3. Paste the production Consumer Key, Consumer Secret and passkey.
4. Run one small real payment to confirm the money arrives.

Requests are limited by Safaricom to **250,000 KES** each. The app rounds the
cart total to whole shillings because M-Pesa does not charge cents.

---

## 4. Optional backend (web version)

If you also use Biller POS in a browser, or you would rather keep the Daraja
secrets on a server, set **Backend URL** (and optionally **Backend key**) in the
M-Pesa settings. The app then sends JSON `POST` requests to that URL instead of
calling Safaricom directly. Set the key as an `Authorization: Bearer <key>`
header.

> **Ready-made server included.** `server/mpesa-server.js` implements this whole
> contract, keeps one Daraja login per shop on the server, and never puts a
> secret on a phone. See `server/README.md` for setup.

The server must answer these three actions:

### `ping`
Request:
```json
{ "action": "ping", "shortcode": "247247", "environment": "production" }
```
Response:
```json
{ "ok": true }
```

### `stkpush`
Request:
```json
{
  "action": "stkpush",
  "phone": "254712345678",
  "amount": 650,
  "accountReference": "POS-42",
  "description": "Mwangaza sale",
  "shortcode": "247247",
  "mode": "paybill",
  "environment": "production"
}
```
The server obtains the Daraja OAuth token, builds the password from
`shortcode + passkey + timestamp`, and calls
`/mpesa/stkpush/v1/processrequest` with
`TransactionType` = `CustomerPayBillOnline` (paybill) or
`CustomerBuyGoodsOnline` (till). Response:
```json
{ "ok": true, "checkoutRequestId": "ws_CO_...", "customerMessage": "Check your phone" }
```
On failure return `{ "ok": false, "error": "human readable reason" }`.

### `status`
Request:
```json
{ "action": "status", "checkoutRequestId": "ws_CO_..." }
```
Response:
```json
{ "ok": true, "status": "pending" }
```
then later:
```json
{ "ok": true, "status": "success", "receipt": "QK12345678" }
```
or:
```json
{ "ok": true, "status": "failed", "message": "Request cancelled by user" }
```

`status` can call `/mpesa/stkpushquery/v1/query`. While the customer is still
on the PIN screen Daraja answers `errorCode: 500.001.1001` ("being processed");
treat that as `pending`.

The Daraja STK Push request also needs a public **CallBackURL**. If your server
receives that callback, it can store the real M-Pesa receipt number and return
it from `status`; otherwise the app records the checkout ID as the reference and
the cashier can read the code from the customer's SMS. The direct connection
uses `https://biller-91aaf.web.app/mpesa/callback` as a placeholder and relies
on status polling.

---

## 5. Selling Biller POS as a service — the three ways to wire M-Pesa

This matters if you hand the app to other shop owners. The short answer: a
passkey belongs to one shortcode, so **your** Daraja credentials cannot charge
**their** Paybill or Till. Each shop has to use its own Daraja login — but that
does not have to involve you.

### A. Self-serve (recommended)

The shop owner creates their own Daraja app, pastes the Consumer Key, Secret
and their own passkey into **Connection details** once, and the app saves it
with their shop. You are never involved. Use the **Send KES 1 test prompt**
button so they can verify it themselves.

### B. Your server (keeps secrets off the phone)

Run `server/mpesa-server.js`. Each shop gets a **backend key**; you store that
shop's Daraja credentials in the server's `config.json`. The app only needs
**Backend URL** and **Backend key** — the shop owner fills in their Paybill or
Till number and nothing else, and no secret ever reaches the phone. This is
the right route when you resell the app, because you can also rotate keys,
watch failures and add your own per-shop rules.

### C. Your own Till (aggregator)

You collect the money into *your* Till and settle it to the shop afterwards.
Then your credentials work for everyone, but you hold customer money, do the
reconciliation, and carry the compliance for it.

### What not to do

Do not put production credentials in `js/daraja.js`. Anything written there
ships inside the app and can be read by anyone who unpacks the APK or opens
the PWA — treat the consumer key and secret as public the moment you release
it, and never put a live passkey there.

The only values that are safe to ship are **sandbox** ones: the sandbox Paybill
(`174379`), the published sandbox passkey, and a sandbox consumer key from your
own sandbox app. Those go in the `sandbox` block of `js/daraja.js` and power
the **Try the Safaricom sandbox** button. A shop in sandbox mode that leaves
the connection fields empty still works — the app falls back to the sandbox
preset, so all they type is a Paybill or Till number.

In **production** the fallback is the empty top level block, so a shop that
has not entered its own Daraja details is told to do so instead of silently
using yours.

---

## Troubleshooting

| Message | What it means |
| --- | --- |
| *Add your Paybill or Till number…* | Fill the shortcode in Store & receipts. |
| *Add your Daraja consumer key, secret and passkey…* | The shop still needs its own Daraja login (section 2) or a Backend URL. |
| *Invalid Passkey* | The passkey belongs to a different shortcode. Get the passkey Safaricom issued for that Paybill or Till. |
| *Invalid ShortCode* / *shortcode not allowed* | The Daraja app is not authorised for that number yet. |
| *Unknown backend key* | The server did not recognise that shop's key. Check the key in the app against `config.json`. |
| *This shop is not allowed to charge that shortcode.* | The shortcode is not in that shop's `shortcodes` list on the server. |
| *Safaricom blocks payment prompts sent straight from a browser…* | Use the installed app, or set a backend URL. |
| *Safaricom rejected the consumer key or secret.* | Check for a copy/paste mistake and the Sandbox/Production choice. |
| *Invalid Password* / *Invalid Access Token* | The passkey or shortcode is wrong, or the environment is wrong. |
| *The transaction is being processed* | Normal while the customer is on the PIN prompt. Wait. |
| *DS timeout user cannot be reached* | The customer's phone is off or has no signal. Retry. |
| *Request cancelled by user* | The customer dismissed the prompt. Retry if they still want to pay. |
| *No confirmation yet…* | Check the M-Pesa SMS. If money left the customer, do **not** charge again; record the sale with the M-Pesa code. |

**Money safety:** if the app times out but the customer received a confirmation
SMS, the payment may still have gone through. Check the M-Pesa statement before
retrying. The app never retries a charge on its own.
