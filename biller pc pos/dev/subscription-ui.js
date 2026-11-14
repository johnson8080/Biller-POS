  /* ---------- Subscription ---------- */

  const SUB_STATUS = {
    trial: { label: "Free trial", tone: "good" },
    active: { label: "Active", tone: "good" },
    due: { label: "Payment due", tone: "warn" },
    overdue: { label: "Overdue", tone: "bad" },
    awaiting: { label: "Waiting for confirmation", tone: "warn" }
  };

  function subscriptionSection() {
    const sub = T.subscription();
    const plan = T.planSummary();
    const status = T.subscriptionStatus();
    const meta = SUB_STATUS[status] || SUB_STATUS.active;
    const fee = T.feeConfig();
    const due = T.subscriptionDueDate();
    const days = T.subscriptionDaysLeft();
    const amount = T.money(plan.amountCents);
    const reference = sub.reference || T.subscriptionReference();

    const history = (sub.payments || []).slice(-3).reverse().map((entry) => `
      <div class="data-row">
        <span class="data-icon">${icon("i-check")}</span>
        <span class="data-copy">
          <strong>${esc(T.money(entry.amountCents || plan.amountCents))}</strong>
          <small>${esc(entry.method === "mpesa" ? "Paid by M-Pesa" : "Paid")}${entry.at ? ` · ${esc(T.shortDateFmt.format(new Date(entry.at)))}` : ""}${entry.reference ? ` · ${esc(entry.reference)}` : ""}</small>
        </span>
      </div>`).join("");

    return `<div class="sub-card">
      <div class="sub-top">
        <div>
          <p class="card-sub" style="margin-top:0">${esc(plan.label)}</p>
          <div class="sub-price">${esc(amount)} <small>/ month</small></div>
        </div>
        <span class="sub-pill is-${esc(meta.tone)}">${esc(meta.label)}</span>
      </div>
      <p class="field-small" style="margin-top:8px">
        ${status === "trial"
          ? `Your first ${plan.trialDays} days are free. Pay ${esc(amount)} when the trial ends.`
          : status === "active" && due
            ? `Next payment ${esc(T.shortDateFmt.format(due))}${days !== null ? ` - ${days} day${days === 1 ? "" : "s"} left` : ""}.`
            : status === "due" && due
              ? `Payment of ${esc(amount)} was due ${esc(T.shortDateFmt.format(due))}.`
              : status === "awaiting"
                ? `You told us the payment is on its way (ref ${esc(reference)}). We will switch it on once it arrives.`
                : status === "overdue"
                  ? `The ${esc(amount)} payment is overdue.`
                  : `Monthly plan of ${esc(amount)}.`}
      </p>
      ${status !== "active" && status !== "trial" ? `
        <button class="btn btn-primary btn-block" data-act="pay-subscription" style="margin-top:12px">
          ${icon("i-phone")} ${status === "awaiting" ? "Payment details" : `Pay ${esc(amount)}`}
        </button>` : ""}
      ${status === "awaiting" ? `
        <button class="btn btn-ghost btn-block" data-act="subscription-confirm" style="margin-top:8px">
          ${icon("i-check")} The payment has arrived - activate my plan
        </button>` : ""}
      ${fee.mpesaNumber || fee.bank.number ? `
        <p class="field-small" style="margin-top:10px">Reference <strong>${esc(reference)}</strong> - include it with the payment so we can match it to your shop.</p>` : ""}
      <div class="plan-reminders">
        <div class="plan-reminders-copy">
          <strong>Reminders</strong>
          <small id="notify-status">Checking...</small>
        </div>
        <div class="plan-reminders-actions">
          <button class="btn btn-ghost" data-act="notify-request" id="notify-on">Turn on</button>
          <button class="btn btn-ghost" data-act="notify-test" id="notify-test">Test</button>
        </div>
      </div>
      ${history ? `<div class="section-head" style="margin-top:14px"><h2>Payments</h2></div><div class="data-list">${history}</div>` : ""}
    </div>`;
  }

