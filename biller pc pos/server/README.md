# Biller POS — M-Pesa payment server

A small Node server that keeps the Safaricom Daraja secrets **off the shop's
phone**. Each shop gets its own backend key and its own Daraja credentials;
the app sends the payment request to this server, the server calls Safaricom.

No npm install needed — Node 18 or newer (it uses the built-in `fetch`).

## 1. Start it

```bash
cd server
cp config.example.json config.json     # then edit config.json
node mpesa-server.js --config ./config.json --port 8787
```

`--help` lists the flags. `PORT` and `MPESA_CONFIG` work as environment
variables too.

## 2. Add a shop

1. Generate a key for the shop:

   ```bash
   node mpesa-server.js --gen-key
   ```

2. Put the shop in `config.json` under `shops`:

   ```json
   "shops": {
     "<the key you just generated>": {
       "name": "Mwangaza Mini Mart",
       "environment": "sandbox",
       "consumerKey": "daraja consumer key",
       "consumerSecret": "daraja consumer secret",
       "passkey": "lipa na mpesa passkey",
       "defaultShortcode": "174379",
       "shortcodes": ["174379"]
     }
   }
   ```

   - `environment` — `sandbox` while testing, `production` for real money.
   - `shortcodes` — optional allow-list. A shop can only charge the Paybill
     or Till numbers listed here, even if the app asks for another one.

3. Restart the server.

## 3. Point the app at it

In Biller POS: **Settings → Shop & receipts → M-Pesa → Connection details**

- **Backend URL** — `https://your-domain.example/mpesa`
- **Backend key** — the key you generated for that shop

Leave the Consumer Key, Consumer Secret and passkey **blank in the app** — the
server holds them. The app then never needs them and they cannot be read off
the phone.

## 4. What the server answers

All requests are `POST` with a JSON body and
`Authorization: Bearer <backend key>`.

| Action | Body | Answer |
| --- | --- | --- |
| `ping` | `{ "action": "ping", "shortcode": "174379", "environment": "sandbox" }` | `{ "ok": true }` |
| `stkpush` | `{ "action": "stkpush", "phone": "2547...", "amount": 650, "accountReference": "POS-12", "description": "Sale", "shortcode": "174379", "mode": "paybill", "environment": "sandbox" }` | `{ "ok": true, "checkoutRequestId": "ws_CO_...", "customerMessage": "..." }` |
| `status` | `{ "action": "status", "checkoutRequestId": "ws_CO_..." }` | `{ "ok": true, "status": "success", "receipt": "QK12345678" }` |

`status` returns `pending` while the customer is still on the PIN prompt,
`success` with the M-Pesa receipt number, or `failed` with a reason.

`GET /health` answers `{ "ok": true }` — use it for uptime checks.

`POST /mpesa/callback` is where Safaricom posts the result. The app polls
instead, but the callback means a payment that completes while the app is
closed is still on record.

## 5. Before real money

- Serve it over **HTTPS** (Caddy, nginx, or a platform that terminates TLS).
  Safaricom also wants an HTTPS callback URL — set `callbackUrl` in
  `config.json` to your public `/mpesa/callback` address.
- Keep `config.json` out of version control and readable only by the service
  account (`chmod 600 config.json`).
- Rotate a shop's key by generating a new one and updating that shop in the
  app — the old key stops working immediately.
- The server rate-limits each shop to 60 requests a minute and never logs
  secrets.
