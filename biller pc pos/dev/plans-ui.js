  /* ---------- Lock and plans ---------- */

  /**
   * The shop cannot sell until the monthly plan is settled. This panel
   * replaces the products and explains exactly what to do.
   */
  function subscriptionLockPanel() {
    if (!T.subscriptionLocked()) return "";
    const status = T.subscriptionStatus();
    const plan = T.planSummary();
    const amount = money(plan.amountCents);
    const code = T.shopCode();
    const fee = T.feeConfig();
    const waiting = status === "awaiting";
    const overdue = status === "overdue";
    return `<div class="plan-lock">
      <span class="plan-lock-mark">${icon(waiting ? "i-clock" : "i-lock")}</span>
      <h2>${waiting ? "Waiting for your payment" : overdue ? "Your shop is paused" : "Your plan is due"}</h2>
      <p>${waiting
        ? `We are checking your ${esc(amount)} payment. This usually takes about 5 minutes. If it takes longer, call us and we will switch you straight on.`
        : `The ${esc(amount)} monthly plan for Biller POS is ${overdue ? "overdue" : "due"}. Pay it to carry on selling.`}</p>
      <div class="plan-lock-ref">
        <span>Your shop code</span>
        <strong>${esc(code)}</strong>
      </div>
      <div class="plan-lock-actions">
        <button class="btn btn-primary btn-block" data-act="pay-subscription">${icon("i-phone")} ${waiting ? "Payment details" : `Pay ${esc(amount)}`}</button>
        ${fee.mpesaNumber ? `<a class="btn btn-ghost btn-block" href="tel:${esc(fee.mpesaNumber.replace(/[^0-9+]/g, ""))}">${icon("i-phone")} Call the developer</a>` : ""}
        <button class="btn btn-ghost btn-block" data-act="open-developer-chat">${icon("i-chat")} Chat with developer</button>
      </div>
    </div>`;
  }

  /**
   * The developer's subscription panel: every shop, its code and its plan
   * state, with the payment requests waiting for an answer.
   */
  function plans() {
    const cloud = T.cloud?.status?.();
    if (!cloud?.isOwner) {
      return `<section class="screen">
        <div class="screen-head">
          <p class="eyebrow">Developer</p>
          <h1>Subscriptions</h1>
          <p class="sub">Only the developer account can open this page.</p>
        </div>
      </section>`;
    }

    const requests = T.cloud.paymentRequests?.() || [];
    const accounts = T.cloud.accounts?.() || [];
    const seen = (stamp) => {
      if (!stamp) return "not seen yet";
      const minutes = Math.floor((Date.now() - stamp) / 60000);
      if (minutes < 1) return "just now";
      if (minutes < 60) return `${minutes} min ago`;
      if (minutes < 1440) return `${Math.floor(minutes / 60)} h ago`;
      return T.shortDateFmt.format(new Date(stamp));
    };

    // One row per shop: the payment request first, then the plan state from
    // the presence records.
    const entries = [];
    const seenIds = new Set();
    requests.forEach((request) => {
      seenIds.add(request.id);
      entries.push({
        id: request.id,
        code: request.code || "",
        shop: request.shop || request.email || "Shop",
        email: request.email || "",
        status: request.status || "pending",
        amount: request.amount || 0,
        reference: request.reference || "",
        at: request.at || 0,
        pending: request.status === "pending"
      });
    });
    accounts.forEach((account) => {
      if (seenIds.has(account.id)) return;
      const sub = account.sub;
      if (!sub) return;
      // A shop that says it has paid also shows here through its presence
      // record, so the request is visible even before the new rules are live.
      const asked = account.payment && account.payment.status === "pending";
      entries.push({
        id: account.id,
        code: account.code || "",
        shop: sub.shop || account.name,
        email: account.name || "",
        status: asked ? "pending" : (sub.status || "active"),
        amount: sub.amount || 0,
        reference: sub.reference || account.payment?.reference || "",
        at: account.t || 0,
        pending: asked
      });
    });
    entries.sort((a, b) => (b.pending ? 1 : 0) - (a.pending ? 1 : 0) || (b.at || 0) - (a.at || 0));
    const rows = entries.map((entry) => planRow(entry, seen));

    const pendingCount = entries.filter((row) => row.pending).length;
    const paidCount = entries.filter((row) => row.status === "active" || row.status === "confirmed").length;
    const dueCount = entries.filter((row) => row.status === "due" || row.status === "overdue").length;
    const monthly = entries.filter((row) => row.status === "active" || row.status === "confirmed").reduce((sum, row) => sum + (row.amount || 0), 0);

    return `<section class="screen" aria-labelledby="plans-title">
      <div class="screen-head">
        <p class="eyebrow">Developer</p>
        <h1 id="plans-title">Subscriptions</h1>
        <p class="sub">Every shop, its code, and what has been paid.</p>
      </div>
      <div class="plan-stats">
        <div class="plan-stat"><span class="label">Shops</span><strong>${rows.length}</strong></div>
        <div class="plan-stat"><span class="label">Paid</span><strong>${paidCount}</strong></div>
        <div class="plan-stat is-warn"><span class="label">To chase</span><strong>${dueCount}</strong></div>
        <div class="plan-stat"><span class="label">Waiting</span><strong>${pendingCount}</strong></div>
      </div>
      <div class="plan-total">
        <span>Monthly recurring</span>
        <strong>${esc(T.money(monthly))}</strong>
      </div>
      ${rows.length ? `<div class="plan-list">${rows.join("")}</div>` : `<p class="report-empty">No shops yet. They show up here as soon as they sign in.</p>`}
      <p class="field-small" style="margin-top:12px">A shop that says it has paid appears at the top as "Waiting". Tap Confirm and their app unlocks by itself.</p>
    </section>`;
  }

  function planRow(row, seen) {
    const label = row.status === "active" ? "Paid"
      : row.status === "trial" ? "Trial"
        : row.status === "awaiting" ? "Waiting"
          : row.status === "overdue" ? "Overdue"
            : row.status === "declined" ? "Declined"
              : row.status === "confirmed" ? "Paid"
                : row.status === "pending" ? "Waiting"
                  : "Due";
    const tone = row.status === "active" || row.status === "confirmed" ? "is-good"
      : row.status === "trial" ? "is-good"
        : row.status === "overdue" ? "is-bad" : "is-warn";
    return `<div class="plan-row">
      <div class="plan-row-top">
        <span class="plan-row-name"><strong>${esc(row.shop || "Shop")}</strong><small>${esc(row.email || "")}</small></span>
        <span class="plan-row-pill is-${tone}">${esc(label)}</span>
      </div>
      <div class="plan-row-meta">
        <span class="plan-row-code">${esc(row.code || "no code")}</span>
        <span>${row.amount ? esc(T.money(row.amount)) : ""}</span>
        ${row.reference ? `<span>ref ${esc(row.reference)}</span>` : ""}
        <span>${esc(seen(row.at))}</span>
      </div>
      ${row.pending ? `<div class="plan-row-actions">
        <button class="btn btn-primary" data-act="confirm-payment" data-id="${esc(row.id)}">Confirm payment</button>
        <button class="btn btn-ghost" data-act="decline-payment" data-id="${esc(row.id)}">Not paid</button>
      </div>` : ""}
      ${row.email && row.email.includes("@") ? `<div class="plan-row-actions">
        <a class="btn btn-ghost" href="mailto:${esc(row.email)}?subject=${encodeURIComponent("Your Biller POS monthly plan")}">${icon("i-mail")} Email this shop</a>
        <button class="btn btn-ghost" data-act="copy-shop-code" data-code="${esc(row.code || "")}">${icon("i-check")} Copy code</button>
      </div>` : ""}
    </div>`;
  }

