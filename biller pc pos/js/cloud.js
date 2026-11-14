/* ============================================================
   Biller — cloud storage (Firebase Firestore)
   ------------------------------------------------------------
   The shop keeps working with no connection: everything lives in
   localStorage. When the owner is signed in, the same state is
   mirrored to Firestore so another device can pick it up, and a
   presence record shows which accounts are online right now.

   Nothing here is required for selling: if Firebase is missing,
   disabled, or unreachable, the app simply stays local.
   ============================================================ */
(() => {
  "use strict";
  const T = window.Till;
  if (!T) throw new Error("Till core must load before cloud.");

  const SHOP_COLLECTION = "billerShops";
  const PRESENCE_COLLECTION = "billerPresence";
  const PAYMENT_COLLECTION = "billerPayments";
  const SAVED_AT_KEY = "biller.pos.savedAt";

  // The one account that sees the developer tools: the shop owner.
  const DEV_EMAILS = (window.Till?.DEV_EMAILS || ["johnsonommala1@gmail.com"]).slice();

  const PUSH_DELAY = 1200;
  const HEARTBEAT = 60000;
  const ONLINE_WINDOW = 150000;

  let fs = null;
  let user = null;
  let pushTimer = null;
  let presenceTimer = null;
  let unsubscribers = [];
  let accounts = [];
  let accountsError = "";
  let paymentRequests = [];
  let myPayment = null;
  let paymentUnsub = null;
  let paymentRulesError = "";
  let onPaymentPrompt = null;
  let lastError = "";
  let phase = "signed-out";
  let lastSyncAt = 0;
  const listeners = new Set();

  /* ---------- Small helpers ---------- */

  function setPhase(next, message = "") {
    phase = next;
    if (message) lastError = message;
    notify();
  }

  function notify() {
    const snapshot = status();
    listeners.forEach((fn) => {
      try { fn(snapshot); } catch (error) { console.warn(error); }
    });
  }

  /**
   * The developer tools belong to one account only: the shop owner. Nobody
   * else sees the panel, and there is no switch to turn it on.
   */
  function isOwner() {
    const email = String(user?.email || T.getSession()?.email || "").trim().toLowerCase();
    return DEV_EMAILS.includes(email);
  }

  function localSavedAt() {
    // The stamp of the shop this account is using, not a global one.
    const own = window.Till?.savedAtFor?.();
    if (own) return own;
    return Number(localStorage.getItem(SAVED_AT_KEY) || 0);
  }

  function friendlyError(error) {
    const code = String(error?.code || "");
    const text = String(error?.message || "").toLowerCase();
    if (code === "permission-denied") return "Firebase rules are blocking this device.";
    if (code === "unavailable" || code === "deadline-exceeded") return "No connection to Firebase.";
    if (code === "failed-precondition" || code === "unimplemented") return "Firestore is not enabled for this project.";
    if (code === "not-found") return "No cloud copy found yet.";
    if (text.includes("has not been used") || text.includes("has not been enabled") || text.includes("not enabled")) {
      return "Firestore is not enabled for this project.";
    }
    return code ? code.replace(/^firestore\//, "") : "Cloud sync stopped.";
  }

  /** Is the whole service turned off, rather than just this request failing? */
  function serviceDisabled(error) {
    const code = String(error?.code || "").toLowerCase();
    const text = String(error?.message || "").toLowerCase();
    return code.includes("unimplemented")
      || code.includes("failed-precondition")
      || text.includes("has not been used")
      || text.includes("has not been enabled")
      || text.includes("not enabled");
  }

  /* ---------- Status ---------- */

  function status() {
    return {
      mode: fs ? "cloud" : "local",
      phase,
      error: lastError,
      lastSyncAt,
      accounts: accounts.slice(),
      accountsError,
      isOwner: isOwner(),
      email: user?.email || T.getSession()?.email || ""
    };
  }

  function onChange(fn) {
    listeners.add(fn);
    try { fn(status()); } catch (error) { console.warn(error); }
    return () => listeners.delete(fn);
  }

  /* ---------- Start up ---------- */

  function init() {
    try {
      if (!window.firebase?.firestore) return false;
      fs = window.firebase.firestore();
      try { fs.settings({ ignoreUndefinedProperties: true }); } catch { /* older SDK */ }
      try { fs.enablePersistence({ synchronizeTabs: true }).catch(() => {}); } catch { /* private mode */ }
      setPhase(user ? "syncing" : "signed-out");
      return true;
    } catch (error) {
      console.warn("Cloud storage is not available:", error);
      fs = null;
      return false;
    }
  }

  /* ---------- Signing in and out ---------- */

  function attach(nextUser) {
    detach();
    user = nextUser || null;
    if (!user) {
      setPhase("signed-out");
      return;
    }
    if (!fs) {
      setPhase("local");
      return;
    }
    setPhase("syncing");
    // Say hello so the developer panel can see this device.
    beat();
    presenceTimer = setInterval(beat, HEARTBEAT);
    document.addEventListener("visibilitychange", onVisible);
    // Pull the cloud copy down, then keep the device in step.
    pull({ silent: true }).finally(() => {
      if (isOwner()) watchPresence();
      if (isOwner()) watchPayments();
      watchMyPayment();
      notify();
    });
  }

  function detach() {
    clearInterval(presenceTimer);
    presenceTimer = null;
    clearTimeout(pushTimer);
    pushTimer = null;
    document.removeEventListener("visibilitychange", onVisible);
    unsubscribers.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
    unsubscribers = [];
    accounts = [];
    accountsError = "";
    if (user && fs) beatOff();
    user = null;
    setPhase("signed-out");
  }

  function onVisible() {
    if (document.visibilityState !== "visible") return;
    beat();
    if (isOwner()) pull({ silent: true });
  }

  /* ---------- Saving and loading ---------- */

  /**
   * Copy the shop state to the cloud. Saves are debounced so a burst of
   * changes travels as one write.
   */
  function push({ immediate = false } = {}) {
    if (!fs || !user) return Promise.resolve(false);
    clearTimeout(pushTimer);
    const run = async () => {
      try {
        const snapshot = JSON.parse(JSON.stringify(T.state));
        const size = JSON.stringify(snapshot).length;
        if (size > 900000) {
          // Firestore documents stop at 1 MB. The shop keeps working on the
          // device, but the cloud copy is left alone.
          lastError = "The shop is too large for the cloud copy — it stays on this device.";
          setPhase("error", lastError);
          return false;
        }
        await fs.collection(SHOP_COLLECTION).doc(user.uid).set({
          state: snapshot,
          // The device's own clock, so it can be compared with the stamp the
          // device keeps locally. The server time is kept alongside it.
          updatedAt: Date.now(),
          serverAt: window.firebase.firestore.FieldValue.serverTimestamp(),
          updatedBy: user.email || "",
          version: window.ASSET_VERSION || ""
        }, { merge: true });
        lastSyncAt = Date.now();
        // The device and the cloud now agree, so remember when.
        try { localStorage.setItem(SAVED_AT_KEY, String(Date.now())); } catch { /* ignore */ }
        window.Till?.setSavedAt?.(Date.now());
        setPhase("synced");
        return true;
      } catch (error) {
        lastError = friendlyError(error);
        setPhase("error", lastError);
        return false;
      }
    };
    if (immediate) return run();
    pushTimer = setTimeout(run, PUSH_DELAY);
    return Promise.resolve(false);
  }

  /**
   * Bring the cloud copy down. The newer copy wins, so two devices that
   * both had the shop open do not fight each other.
   */
  async function pull({ silent = false, force = false } = {}) {
    if (!fs || !user) {
      if (!silent) T.toast("Sign in to sync with the cloud", "i-info");
      return { ok: false, applied: false, reason: "signed-out" };
    }
    try {
      const snap = await fs.collection(SHOP_COLLECTION).doc(user.uid).get();
      const data = snap.exists ? snap.data() : null;
      if (!data || !data.state) {
        // Nothing in the cloud yet — send this device's copy up.
        await push({ immediate: true });
        return { ok: true, applied: false, reason: "empty" };
      }
      const remoteAt = Number(data.updatedAt) || (data.serverAt?.toMillis?.() || 0);
      const localAt = localSavedAt();
      if (!force && remoteAt && remoteAt <= localAt) {
        lastSyncAt = Date.now();
        setPhase("synced");
        return { ok: true, applied: false, reason: "local-newer" };
      }
      applyRemote(data.state, remoteAt);
      lastSyncAt = Date.now();
      setPhase("synced");
      return { ok: true, applied: true };
    } catch (error) {
      lastError = friendlyError(error);
      if (serviceDisabled(error)) {
        // The project has no Firestore database — stay local and say why.
        fs = null;
        setPhase("local", lastError);
      } else {
        setPhase("error", lastError);
      }
      if (!silent) T.toast(`Could not reach the cloud — ${lastError}`, "i-alert");
      return { ok: false, applied: false, error };
    }
  }

  /** Put the cloud copy in place on this device. */
  function applyRemote(remote, stamp = 0) {
    const merged = T.normalizeState(remote);
    T.state = merged;
    try {
      // Save it under the account that owns it without touching the
      // "last edited" stamp: receiving a copy is not a local change, and
      // pushing it straight back would make two devices ping-pong forever.
      T.save({ quiet: true, stamp: false, sync: false });
      T.setSavedAt?.(stamp || Date.now());
    } catch (error) {
      console.warn("Could not save the cloud copy locally:", error);
    }
    window.render?.();
  }

  /** The shop's payment request, if it is waiting for the developer. */
  function pendingPayment() {
    try {
      const sub = window.Till?.subscription?.() || {};
      if (!sub.awaiting) return null;
      return {
        at: Date.now(),
        amount: window.Till?.planSummary?.().amountCents || 0,
        reference: sub.reference || "",
        status: "pending"
      };
    } catch {
      return null;
    }
  }

  /**
   * The shop asks the developer to confirm a payment. The request is written
   * to its own payment document; the developer answers it from the panel.
   * The M-Pesa transaction code the shop typed in rides along, so the developer
   * can match the payment without asking the shop again.
   */
  async function requestPayment(mpesaCode = "") {
    if (!fs || !user) return { ok: false, error: "Sign in to send the request." };
    const sub = window.Till?.subscription?.() || {};
    const plan = window.Till?.planSummary?.() || {};
    const request = {
      code: window.Till?.shopCode?.() || "",
      shop: window.Till?.state?.store?.name || "",
      email: user.email || "",
      phone: String(window.Till?.state?.store?.phone || "").trim(),
      amount: plan.amountCents || 0,
      currency: plan.currency || "KES",
      reference: sub.reference || "",
      mpesaCode: String(mpesaCode || sub.mpesaCode || "").trim(),
      at: Date.now(),
      status: "pending"
    };
    try {
      try {
        await fs.collection(PAYMENT_COLLECTION).doc(user.uid).set(request, { merge: true });
      } catch (firstError) {
        // Older rules only let a shop create its request once. A shop that
        // has paid again can clear the old answered request and create a
        // fresh pending one.
        await fs.collection(PAYMENT_COLLECTION).doc(user.uid).delete();
        await fs.collection(PAYMENT_COLLECTION).doc(user.uid).set(request);
      }
      myPayment = request;
      notify();
      return { ok: true, request };
    } catch (error) {
      // The rules may not be deployed yet; the request still reaches the
      // developer through the presence record.
      return { ok: false, error: friendlyError(error) };
    }
  }

  /** The developer confirms a payment. The shop unlocks on its next poll. */
  async function confirmPayment(uid) {
    if (!fs || !user || !isOwner()) return { ok: false, error: "Not allowed." };
    try {
      const ref = fs.collection(PAYMENT_COLLECTION).doc(uid);
      const snap = await ref.get();
      // Confirming is not a renewal. A double tap (or a stale button) must
      // not add a second month to the shop.
      if (snap.exists && (snap.data() || {}).status === "confirmed") {
        return { ok: true, already: true };
      }
      await ref.set({
        status: "confirmed",
        confirmedAt: Date.now()
      }, { merge: true });
      paymentRequests = paymentRequests.map((item) => (item.id === uid ? { ...item, status: "confirmed" } : item));
      notify();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: friendlyError(error) };
    }
  }

  /** The developer declines a payment request. */
  async function declinePayment(uid) {
    if (!fs || !user || !isOwner()) return { ok: false, error: "Not allowed." };
    try {
      await fs.collection(PAYMENT_COLLECTION).doc(uid).set({
        status: "declined",
        declinedAt: Date.now()
      }, { merge: true });
      paymentRequests = paymentRequests.map((item) => (item.id === uid ? { ...item, status: "declined" } : item));
      notify();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: friendlyError(error) };
    }
  }

  /** The developer deletes an account. */
  async function deleteAccount(uid) {
    if (!fs || !user || !isOwner()) return { ok: false, error: "Not allowed." };
    try {
      await fs.collection("accounts").doc(uid).delete();
      await fs.collection(PAYMENT_COLLECTION).doc(uid).delete();
      accounts = accounts.filter((item) => item.id !== uid);
      paymentRequests = paymentRequests.filter((item) => item.id !== uid);
      notify();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: friendlyError(error) };
    }
  }

  /** Watch the payment requests. Only the developer reads this list. */
  function watchPayments() {
    if (!fs) return;
    try {
      const unsub = fs.collection(PAYMENT_COLLECTION).onSnapshot((snap) => {
        const list = [];
        snap.forEach((doc) => {
          const data = doc.data() || {};
          list.push({ id: doc.id, ...data });
        });
        list.sort((a, b) => (b.at || 0) - (a.at || 0));
        const fresh = list.find((item) => item.status === "pending" && !paymentRequests.some((old) => old.id === item.id));
        paymentRequests = list;
        notify();
        if (fresh && onPaymentPrompt) onPaymentPrompt(fresh);
      }, (error) => {
        paymentRulesError = friendlyError(error);
        notify();
      });
      unsubscribers.push(unsub);
    } catch { /* the rules may not allow reading yet */ }
  }

  /** Watch this shop's own payment document, so a confirmation unlocks it. */
  function watchMyPayment() {
    if (!fs || !user) return;
    try {
      if (paymentUnsub) paymentUnsub();
      paymentUnsub = fs.collection(PAYMENT_COLLECTION).doc(user.uid).onSnapshot((snap) => {
        const data = snap.data() || {};
        myPayment = Object.keys(data).length ? { id: user.uid, ...data } : null;
        notify();
        if (data.status === "confirmed") {
          const confirmedAt = Number(data.confirmedAt) || 0;
          const sub = window.Till?.subscription?.() || {};
          const applied = Number(sub.lastConfirmedAt) || 0;
          const lastPaid = Date.parse(sub.lastPaidAt || "") || 0;
          // A confirmation snapshot fires on every reconnect. Only apply a
          // confirmation that has not already extended this shop's plan.
          // The lastPaidAt check also covers shops that were confirmed
          // before this guard existed.
          if (confirmedAt > applied) {
            if (confirmedAt > lastPaid + 60000) {
              window.Till?.markSubscriptionPaid?.({ method: "manual", reference: data.reference || "" });
              window.Till?.toast?.("Your plan is on. Welcome back.", "i-check");
            }
            if (window.Till?.state?.store?.subscription) {
              window.Till.state.store.subscription.lastConfirmedAt = confirmedAt;
              window.Till.save?.({ quiet: true });
            }
          }
        }
      }, () => { /* the rules may not allow it yet */ });
    } catch { /* ignore */ }
  }

  /* ---------- Presence ---------- */

  async function beat() {
    if (!fs || !user) return;
    try {
      await fs.collection(PRESENCE_COLLECTION).doc(user.uid).set({
        name: user.email || "user",
        v: window.ASSET_VERSION || "",
        t: window.firebase.firestore.FieldValue.serverTimestamp(),
        off: false,
        // The plan state rides along so the developer can see who has paid
        // without a second collection or extra permissions.
        sub: subscriptionSummary(),
        // The shop's permanent code, so a payment can be matched to a shop.
        code: window.Till?.shopCode?.() || "",
        // A pending payment request, if the shop says it has paid.
        payment: pendingPayment(),
        // The payment request as the developer sees it.
        request: pendingPayment()
      });
      lastError = "";
    } catch (error) {
      lastError = friendlyError(error);
    }
  }

  /** A small summary of the shop's monthly plan for the developer view. */
  function subscriptionSummary() {
    try {
      const sub = window.Till?.subscription?.() || {};
      const plan = window.Till?.planSummary?.() || {};
      return {
        status: window.Till?.subscriptionStatus?.() || "active",
        amount: plan.amountCents || sub.amountCents || 0,
        currency: plan.currency || sub.currency || "KES",
        paidUntil: sub.paidUntil || "",
        awaiting: Boolean(sub.awaiting),
        reference: sub.reference || "",
        mpesaCode: sub.mpesaCode || "",
        phone: sub.phone || String(window.Till?.state?.store?.phone || ""),
        paidAt: sub.lastPaidAt || "",
        shop: window.Till?.state?.store?.name || "",
        at: Date.now()
      };
    } catch {
      return { status: "active", at: Date.now() };
    }
  }

  async function beatOff() {
    if (!fs || !user) return;
    try {
      await fs.collection(PRESENCE_COLLECTION).doc(user.uid).set({
        name: user.email || "user",
        v: window.ASSET_VERSION || "",
        t: window.firebase.firestore.FieldValue.serverTimestamp(),
        off: true
      }, { merge: true });
    } catch { /* the account may simply be gone */ }
  }

  /** Watch who else is signed in. Only the developer sees this list. */
  function watchPresence() {
    if (!fs) return;
    try {
      const unsub = fs.collection(PRESENCE_COLLECTION).onSnapshot((snap) => {
        const list = [];
        snap.forEach((doc) => {
          if (user && doc.id === user.uid) return;
          const data = doc.data() || {};
          list.push({
            id: doc.id,
            name: data.name || "user",
            v: data.v || "",
            t: data.t?.toMillis?.() || 0,
            off: Boolean(data.off),
            sub: data.sub || null
          });
        });
        list.sort((a, b) => b.t - a.t);
        accounts = list;
        accountsError = "";
        notify();
      }, (error) => {
        accountsError = friendlyError(error);
        notify();
      });
      unsubscribers.push(unsub);
    } catch (error) {
      console.warn("Could not watch the account list:", error);
    }
  }

  /** Is this account online right now? */
  function isOnline(account) {
    if (!account || !account.t) return false;
    if (account.off) return false;
    return Date.now() - account.t < ONLINE_WINDOW;
  }

  T.cloud = {
    init,
    attach,
    detach,
    push,
    pull,
    status,
    onChange,
    isOwner,
    isOnline,
    accounts: () => accounts.slice(),
    paymentRequests: () => paymentRequests.slice(),
    paymentRulesError: () => paymentRulesError,
    myPayment: () => myPayment,
    requestPayment,
    confirmPayment,
    declinePayment,
    deleteAccount,
    onPaymentPrompt: (fn) => { onPaymentPrompt = fn; },
    devEmails: () => DEV_EMAILS.slice()
  };
})();
