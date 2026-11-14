/*
 * Biller POS - plan reminders.
 *
 * Notifications are local to the phone: nothing is sent anywhere. On the
 * installed Android app they go through the native bridge (a real Android
 * notification, scheduled with an alarm so they arrive even if the app is
 * closed). In a browser they use the browser's own notifications.
 *
 * What the user is told about:
 *   - the free week is nearly over
 *   - the plan renews in three days
 *   - the plan is due and the shop is locked
 *   - the payment has been sent and is being checked
 *   - the plan is on again
 *   - for the developer: a shop says it has paid, and a daily list of shops
 *     to chase
 */
(function () {
  "use strict";

  const T = window.Till;
  if (!T) return;

  const DAY = 24 * 60 * 60 * 1000;
  const FLAG_KEY = "biller.pos.notified";

  // The notification ids the app uses.
  const IDS = {
    trial: 9001,
    renew: 9002,
    due: 9003,
    awaiting: 9004,
    awaitingCheck: 9005,
    confirmed: 9006,
    request: 9007,
    digest: 9008,
    test: 9009
  };

  const nativePlugin = () => window.Capacitor?.Plugins?.TillNotify || null;
  const webApi = () => (typeof Notification !== "undefined" ? Notification : null);

  function native() {
    return !!(window.Capacitor?.isNativePlatform?.() && nativePlugin());
  }

  /** Has the user allowed notifications? */
  async function granted() {
    const plugin = nativePlugin();
    if (native() && plugin?.granted) {
      try {
        const result = await plugin.granted();
        return !!result?.granted;
      } catch {
        return false;
      }
    }
    const api = webApi();
    return !!api && api.permission === "granted";
  }

  /** Ask for permission. Returns the new state. */
  async function request() {
    const plugin = nativePlugin();
    if (native() && plugin?.request) {
      try {
        const result = await plugin.request();
        return !!result?.granted;
      } catch {
        return false;
      }
    }
    const api = webApi();
    if (!api) return false;
    try {
      const result = await api.requestPermission();
      return result === "granted";
    } catch {
      return false;
    }
  }

  /** Post a notification now. */
  async function show({ id = IDS.test, title = "Biller POS", body = "" } = {}) {
    const plugin = nativePlugin();
    if (native() && plugin?.show) {
      try {
        await plugin.show({ id, title, body });
        return true;
      } catch {
        return false;
      }
    }
    const api = webApi();
    if (!api || api.permission !== "granted") return false;
    try {
      new api(title, { body, icon: "./assets/icon-192.png", tag: String(id) });
      return true;
    } catch {
      return false;
    }
  }

  /** Plan a notification for later. */
  async function schedule({ id = IDS.test, title = "Biller POS", body = "", at = 0 } = {}) {
    if (!at) return false;
    const plugin = nativePlugin();
    if (native() && plugin?.schedule) {
      try {
        await plugin.schedule({ id, title, body, at });
        return true;
      } catch {
        return false;
      }
    }
    // In a browser a timer only lives while the page is open, so it is a
    // best effort there.
    const delay = Math.max(1000, Math.min(at - Date.now(), 2147483647));
    setTimeout(() => { show({ id, title, body }); }, delay);
    return true;
  }

  async function cancel(id) {
    const plugin = nativePlugin();
    if (native() && plugin?.cancel) {
      try {
        await plugin.cancel({ id });
      } catch { /* nothing planned */ }
    }
    if (typeof Notification !== "undefined") {
      try {
        const list = Notification.getNotifications?.({ includeTriggered: true });
        if (list) list.then((items) => items.filter((n) => n.tag === String(id)).forEach((n) => n.close()));
      } catch { /* not supported */ }
    }
  }

  /** Post a notification once only, so it is not repeated every time. */
  async function showOnce(key, payload) {
    let seen = {};
    try {
      seen = JSON.parse(localStorage.getItem(FLAG_KEY) || "{}");
    } catch { seen = {}; }
    const today = new Date().toDateString();
    if (seen[key] === today) return false;
    seen[key] = today;
    try {
      localStorage.setItem(FLAG_KEY, JSON.stringify(seen));
    } catch { /* ignore */ }
    return show(payload);
  }

  function money(cents) {
    try {
      return T.money(cents);
    } catch {
      return `KES ${(Number(cents || 0) / 100).toFixed(2)}`;
    }
  }

  function dayLabel(date) {
    try {
      return T.shortDateFmt.format(date);
    } catch {
      return date.toDateString();
    }
  }

  /** The next 9am, used for the daily reminders. */
  function nextMorning() {
    const at = new Date();
    at.setHours(9, 0, 0, 0);
    if (at.getTime() <= Date.now()) at.setTime(at.getTime() + DAY);
    return at.getTime();
  }

  /** The developer's morning list: who is waiting and who is late. */
  async function scheduleDeveloperDigest() {
    if (!T.isDeveloperAccount?.()) return;
    const waiting = (T.cloud.paymentRequests?.() || []).filter((r) => r.status === "pending").length;
    const chasing = (T.cloud.accounts?.() || []).filter((a) => {
      const sub = a.sub?.status;
      return sub === "due" || sub === "overdue";
    }).length;
    if (!waiting && !chasing) return;
    await schedule({
      id: IDS.digest,
      title: waiting ? `${waiting} payment${waiting === 1 ? "" : "s"} waiting` : `${chasing} shops need chasing`,
      body: waiting
        ? "A shop says it has paid. Open the subscription panel to confirm it."
        : "Some shops have not paid yet. Open the subscription panel to see who.",
      at: nextMorning()
    });
  }

  /**
   * Work out what the user should be told about and make sure the right
   * notifications are planned. Runs on start and whenever the plan changes.
   */
  async function syncPlan() {
    if (!(await granted())) return { ok: false, reason: "no-permission" };
    const plan = T.planSummary?.() || { amountCents: 60000, trialDays: 7, label: "Biller POS monthly plan" };
    const status = T.subscriptionStatus?.() || "active";
    const amount = money(plan.amountCents);
    const now = Date.now();

    // Clear the plan reminders, they are set again below.
    await cancel(IDS.trial);
    await cancel(IDS.renew);
    await cancel(IDS.due);
    await cancel(IDS.awaiting);
    await cancel(IDS.awaitingCheck);
    await cancel(IDS.digest);

    const isDeveloper = T.isDeveloperAccount?.() === true;
    if (isDeveloper) {
      // Only the shops that need chasing, never a reminder about our own plan.
      await scheduleDeveloperDigest();
      return { ok: true, status };
    }

    if (status === "trial") {
      const sub = T.subscription?.() || {};
      const started = new Date(sub.startedAt || Date.now()).getTime();
      const ends = started + (plan.trialDays || 7) * DAY;
      if (ends > now) {
        await schedule({
          id: IDS.trial,
          title: "Your free week is nearly over",
          body: `Your first ${plan.trialDays} days end on ${dayLabel(new Date(ends))}. After that the plan is ${amount} a month.`,
          at: ends - DAY
        });
      }
    } else if (status === "active") {
      const due = T.subscriptionDueDate?.();
      if (due) {
        const at = due.getTime() - 3 * DAY;
        if (at > now) {
          await schedule({
            id: IDS.renew,
            title: "Your plan renews in three days",
            body: `${amount} is due on ${dayLabel(due)}. Open Settings to pay.`,
            at
          });
        }
      }
    } else if (status === "due" || status === "overdue") {
      await showOnce(`due-${status}`, {
        id: IDS.due,
        title: status === "overdue" ? "Your Biller POS plan is overdue" : "Your Biller POS plan is due",
        body: `Your shop is locked until the ${amount} plan is paid. Tap to open Settings.`
      });
      await schedule({
        id: IDS.due,
        title: status === "overdue" ? "Your Biller POS plan is still overdue" : "Your Biller POS plan is due",
        body: `Pay ${amount} to carry on selling. Open Settings to pay.`,
        at: nextMorning()
      });
    } else if (status === "awaiting") {
      await schedule({
        id: IDS.awaitingCheck,
        title: "Still checking your payment",
        body: "Your plan is waiting for confirmation. Call us if it takes longer than five minutes.",
        at: now + 10 * 60 * 1000
      });
    }

    return { ok: true, status };
  }

  T.notify = {
    ids: IDS,
    native,
    granted,
    request,
    show,
    schedule,
    cancel,
    syncPlan
  };
})();
