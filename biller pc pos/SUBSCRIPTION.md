# Biller POS — the monthly plan (KES 600)

## The idea in one paragraph

Every shop that installs Biller POS gets a **7 day free trial**, then a
**monthly plan of KES 600**. The app shows the plan in Settings, reminds the
shop when it is due, and takes the money over M-Pesa — so the shop pays you
without anyone having to chase them, and without you touching each shop.

Your other income does not come out of the app: the **free activation**, plus
the **one-off onboarding fee** when you scan a shop's items into the stock for
them, and then this monthly plan for the ongoing service.

> The money a shop's *customers* pay for goods goes straight into that shop's
> own Paybill or Till — the app never takes a cut of their sales. The KES 600
> is for the software, charged separately.

## What the shop sees

1. **Settings → Monthly plan** — the price, the status (Free trial / Active /
   Payment due / Overdue / Waiting for confirmation), the next due date and
   the payments so far.
2. A gentle banner on the Sell screen when the plan is due, which opens the
   plan straight away.
3. A **Pay KES 600** button that either sends an M-Pesa prompt or shows the
   payment details, depending on how you have set the app up.

## The three ways a shop can pay

### 1. M-Pesa prompt into your Till or Paybill (the automatic one)

This is the one you want. Put your shortcode in `js/daraja.js`:

```js
fee: {
  enabled: true,
  amountCents: 60000,          // KES 600
  currency: "KES",
  trialDays: 7,
  shortcode: "TIL0001",        // your Till, or your Paybill number
  mode: "till",                // "till" or "paybill"
  environment: "production",   // "sandbox" while testing
  account: "",                 // account reference on the statement
  label: "Biller POS monthly plan",
  mpesaNumber: "0724067632",
  contact: "Biller POS support",
  bank: { name: "", number: "", bank: "" }
}
```

Rebuild, and every shop that taps **Pay KES 600** gets a normal M-Pesa PIN
prompt. The money lands in your Till or Paybill, the app marks the plan paid
and moves it forward a month. Nobody confirms anything by hand.

**This needs a shortcode, because that is all Safaricom can push a payment
prompt to.** See the next section.

### 2. M-Pesa to your personal number or your bank account (the interim)

If you have no Till or Paybill yet, leave `shortcode` empty. The shop's plan
falls due, **the shop is locked**, and the panel shows them the price, your
M-Pesa number and their own shop code. They send the money and tap
**I have sent the payment**; you confirm it from your subscription panel and
their app unlocks by itself.

This works today and needs no extra setup — but it does need you to tap
**Confirm payment** each month, so treat it as the bridge, not the
destination.

### 3. Your own server

If you run `server/mpesa-server.js`, the plan payment can go through it too:
the Daraja secrets stay on the server and each shop is keyed by its own
backend key.

## How the manual flow works, step by step

1. The plan falls due and **the shop is locked**: the products disappear from
   the Sell screen and a panel explains what to do.
2. The panel shows the **KES 600**, your **M-Pesa number** and the shop's own
   **code** (for example `JLLTDC-9961`). The shop sends the money and puts
   the code in the message.
3. The shop taps **I have sent the payment**. Their app shows *Waiting for
   your payment*, and a request lands in your subscription panel.
4. You open **Settings → Developer → Subscription panel**, see the shop at
   the top marked *Waiting*, and tap **Confirm payment**.
5. The shop's app unlocks by itself — the plan moves forward a month and
   selling continues.

If activation takes longer than about 5 minutes, the shop taps **Call the
developer** in the panel, which dials your number straight from the app.

> **One Firebase step is needed for steps 4 and 5.** The confirmation travels
> through a new collection, so the rules have to allow it. Open the Firebase
> console → Firestore → Rules and add this block (the file
> `firestore.rules` in this project already contains it):
>
> ```
> match /billerPayments/{uid} {
>   allow read: if signedIn() && (request.auth.uid == uid || isOwner());
>   allow create: if signedIn() && request.auth.uid == uid;
>   allow update: if signedIn() && isOwner();
>   allow delete: if signedIn() && (request.auth.uid == uid || isOwner());
> }
> ```
>
> Until that is live the shop's request still shows up in your panel (it
> travels through the presence record), but the one-tap confirm cannot write
> back — in that case tell the shop to tap **The payment has arrived** in the
> plan screen and it switches on straight away.

## The shop code

Every account gets a permanent code the first time the app runs: the shop
name plus four digits, for example `JLLTDC-9961`. It is:

- shown in the locked screen and in the payment sheet, so the shop always
  knows which code to quote,
- stored in Firebase next to the account (in the shop document and in the
  presence record),
- listed in your subscription panel next to every shop, so you can tell at a
  glance who has paid.

## Your subscription panel

**Settings → Developer → Subscription panel** (only your account sees it).

- **Shops / Paid / To chase / Waiting** counters and the monthly recurring
  total.
- One row per shop: name, email, code, amount, reference and last seen.
- **Confirm payment** and **Not paid** buttons on anything waiting for you.

A shop that has paid shows as *Paid*, one that is late as *Due* or
*Overdue*, and one that says it has sent the money as *Waiting*.

## About the email prompt

The request reaches you **inside the app**, on the phone you are signed in
with — a toast appears the moment a shop taps *I have sent the payment*, and
the request waits in the panel.

Sending it as a real email needs an email service (SendGrid, Mailgun, or the
Firebase "Trigger Email" extension), which needs an account and an API key.
Say the word and I will add that bridge — with it the request lands in your
inbox as well as in the app.

## Reminders (notifications on the phone)

The app can warn the shop on the phone, without the app being open. Turn them
on in **Settings → Monthly plan → Reminders**.

**What a shop is told**

| When | What they see |
| --- | --- |
| The free week is nearly over | *"Your free week is nearly over - your first 7 days end on [date]. After that the plan is KES 600 a month."* |
| Three days before the plan renews | *"Your plan renews in three days - KES 600 is due on [date]."* |
| The plan falls due | *"Your Biller POS plan is due - your shop is locked until the plan is paid."* (and again the next morning) |
| They have sent the payment | A check ten minutes later: *"Still checking your payment - call us if it takes longer than five minutes."* |
| The developer confirms | *"Your plan is on - welcome back."* |

**What the developer is told**

| When | What they see |
| --- | --- |
| A shop says it has paid | *"J&J LTD CO. has paid - open the subscription panel and tap Confirm payment."* |
| Every morning | A count of the shops that are waiting or late. |

Turn them on with the **Turn on** button (it asks the phone for permission
once), test them with **Test**, and turn them off again with the same button.

The reminders are local to the phone: nothing is sent to a server, and the
Android app posts real notifications through the operating system, so they
arrive even when the app is closed.

## Getting a shortcode so you can collect without help

Safaricom pushes payment prompts to a **shortcode** only — never to a
personal M-Pesa number or a bank account. These are your routes:

| Option | What you need | Money lands in |
| --- | --- | --- |
| **M-Pesa Agent Till** | Your national ID and phone; open an agent account at any Safaricom shop. You get a till number and passkey. | Your M-Pesa |
| **Business Till / Paybill** | A registered business (sole proprietor with a KRA PIN is enough for a till) + Daraja Go Live. | Your M-Pesa |
| **Payment aggregator** | An account with an aggregator such as GoPay, Paystack, Flutterwave, Cellulant or Paybill Kenya. They give you a shortcode and API keys, and settle to your **bank account**. | Your bank account |

The agent Till is the quickest: no business registration, and you can start
using it the same week. A business Till or Paybill is the better fit once the
service is running properly, because the statement shows your business name.

Once you have the shortcode and passkey:

1. Put the shortcode in `js/daraja.js` → `fee.shortcode`.
2. Set `fee.environment` to `"production"` and `fee.mode` to `"till"` or
   `"paybill"`.
3. Add your Daraja production consumer key, secret and passkey to the **top
   level** of `js/daraja.js` (not the `sandbox` block).
4. Rebuild and install.

The app then collects the fee by itself, with no message and no confirmation.

> The production key and secret inside the APK can be read by anyone who
> unpacks it. That is a smaller risk here than it sounds: a leaked key can
> only push payments **into your Till**, not out of it. Still, rotate it if a
> build leaks, and keep the amounts small.

## The developer's view

Only your account (`johnsonommala1@gmail.com`) sees the developer panel, and
it now lists **every shop's plan state** under *Monthly plans*: the shop name,
the amount, the reference they quoted and whether they are paid, due,
overdue or waiting for you. Each shop writes this with its usual heartbeat,
so no extra permissions are needed.

## Notes

- The trial is per shop and starts the first time the shop opens the app.
- A payment always adds a month to the plan, so paying early never shortens
  it.
- The plan never blocks selling. The banner is a reminder, not a lock — if
  you want to lock a shop that is three months late, that is a decision to
  add later.
- Prices live in `js/daraja.js` → `fee.amountCents`. Change it there and
  rebuild to change the price for everyone.
