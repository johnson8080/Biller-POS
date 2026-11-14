/* Biller POS — bundled Safaricom Daraja connection.
   ---------------------------------------------------------------------------
   TWO ways to ship M-Pesa in this app:

   1. SANDBOX DEMO (safe to share) — the values below let any new user try the
      PIN prompt immediately, with fake money. The passkey and the sandbox
      Paybill are published in Safaricom's own sandbox docs. The consumer key
      and secret belong to YOUR sandbox app: create one at
      https://developer.safaricom.co.ke (tick "Lipa Na M-Pesa Sandbox") and
      paste it here. Sandbox money is not real, so sharing it is fine.

   2. PRODUCTION — leave the top block empty. Each shop uses its own Daraja
      credentials, which they paste into the app once (self-serve), or you
      keep them on your own server (see server/README.md) and the app only
      needs your backend URL and key.

   Anything written here ships inside the app and can be read by anyone who
   unpacks the APK or opens the PWA — so only put SANDBOX values here.
   --------------------------------------------------------------------------- */
window.TillDaraja = {
  /* Production / live connection. Leave empty unless you run the shop
     yourself and want the app to charge into your own Till. In production
     these are the values the app falls back to. */
  consumerKey: "",
  consumerSecret: "",
  passkey: "",
  backend: "",
  backendKey: "",

  /* One-tap sandbox demo. The passkey and Paybill below are Safaricom's
     published sandbox values; the consumer key and secret are from your own
     sandbox app. Sandbox money is not real, so sharing these is fine. */
  sandbox: {
    paybill: "174379",
    till: "",
    passkey: "bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919",
    consumerKey: "7UNkMRExnpg3gsvdLC9fC2E1JCnqACIFMgLZGSdwQskrlYjr",
    consumerSecret: "j8xiIPAbJSUc4kmuV57mGWW6yZT1bC2ZkM6KpmKkSgT8OAWvnQEpHfgd1rNs8hMJ"
  },

  /* The monthly plan every shop pays.
     ---------------------------------------------------------------------------
     Safaricom can only push a payment prompt into a *shortcode* - a Paybill
     or a Till - never into a personal M-Pesa number or a bank account. So the
     instant route needs a shortcode you control:

       shortcode: your Till (e.g. "TIL0001") or Paybill number
       mode:      "till" or "paybill"
       environment: "sandbox" while testing, "production" when it is live

     Until you have one, leave shortcode empty: the app then asks the shop to
     pay by M-Pesa to the number below or by bank transfer, and marks the
     payment as "waiting for confirmation" until you confirm it.

     mpesaNumber and bank are shown to the shop as the fallback instructions.
  */
  fee: {
    enabled: true,
    amountCents: 60000,
    currency: "KES",
    // 0 means every shop starts due, so the lock can be tested straight away.
    // Put it back to 7 for a free first week.
    trialDays: 0,
    shortcode: "",
    mode: "till",
    environment: "sandbox",
    account: "",
    label: "Biller POS monthly plan",
    mpesaNumber: "0724067632",
    contact: "Biller POS support",
    bank: {
      name: "",
      number: "",
      bank: ""
    }
  }
};
