  function more() {
    const store = T.state.store;
    const session = T.getSession();
    const themeName = T.THEMES.find((theme) => theme.id === T.themeId())?.name || "Forest";
    const isDeveloper = Boolean(T.cloud?.status?.().isOwner);
    const openGroups = T.ui.settingsOpen && typeof T.ui.settingsOpen === "object" ? T.ui.settingsOpen : {};
    const settingsGroup = (id, iconName, title, sub, body) => `
      <section class="settings-group ${openGroups[id] ? "is-open" : ""}">
        <button type="button" class="settings-group-head" data-act="toggle-settings-group" data-value="${id}" aria-expanded="${openGroups[id] ? "true" : "false"}">
          <span class="data-icon">${icon(iconName)}</span>
          <span class="data-copy"><strong>${esc(title)}</strong><small>${esc(sub)}</small></span>
          <span class="chev">${icon("i-chevron")}</span>
        </button>
        <div class="settings-group-body" ${openGroups[id] ? "" : "hidden"}>${body}</div>
      </section>`;
    const shopBody = `
      <div class="data-list">
        <button class="data-row" data-nav="#/store">
          <span class="data-icon">${icon("i-store")}</span>
          <span class="data-copy"><strong>Store &amp; receipts</strong><small>${esc(store.name)} · ${esc(store.currency)} · tax ${esc(store.taxRate)}%</small></span>
          <span class="chev">${icon("i-chevron")}</span>
        </button>
        <button class="data-row" data-nav="#/suppliers">
          <span class="data-icon">${icon("i-truck")}</span>
          <span class="data-copy"><strong>Suppliers</strong><small>${(T.state.suppliers || []).length} ${(T.state.suppliers || []).length === 1 ? "restock contact" : "restock contacts"}</small></span>
          <span class="chev">${icon("i-chevron")}</span>
        </button>
      </div>`;
    const catalogBody = categorySection();
    const subscriptionBody = subscriptionSection();
    const appearanceBody = `
      <div class="theme-card">
        <p class="card-sub">Pick the palette for this till.</p>
        <div class="field" style="margin-bottom:11px">
          <label>Light or dark</label>
          <div class="segmented" role="group" aria-label="Light or dark theme">
            <button type="button" class="seg-btn ${T.colorScheme() === "light" ? "is-active" : ""}" data-act="set-color-scheme" data-value="light" aria-pressed="${T.colorScheme() === "light"}">${icon("i-eye")} Light</button>
            <button type="button" class="seg-btn ${T.colorScheme() === "dark" ? "is-active" : ""}" data-act="set-color-scheme" data-value="dark" aria-pressed="${T.colorScheme() === "dark"}">${icon("i-lock")} Dark</button>
          </div>
          <p class="field-small">Your choice wins over the phone's own setting, so the till always looks the same.</p>
        </div>
        <div class="theme-grid" role="group" aria-label="App theme">
          ${T.THEMES.map((theme) => {
            const active = T.themeId() === theme.id;
            return `<button class="theme-swatch theme-${theme.id} ${active ? "is-active" : ""}" data-act="set-theme" data-value="${theme.id}" aria-pressed="${active}" aria-label="${theme.name} theme, ${theme.hint}">
              <span class="theme-preview" aria-hidden="true"><span class="bar"></span><span class="bar accent"></span><span class="bar dot"></span></span>
              <span class="theme-name">${theme.name}</span>
            </button>`;
          }).join("")}
        </div>
        <div class="field" style="margin-top:10px">
          <label>Text size</label>
          <div class="chip-row" role="group" aria-label="Text size">
            ${["small", "medium", "large"].map((size) => `<button class="chip ${T.textSizeId() === size ? "is-active" : ""}" data-act="set-text-size" data-value="${size}">${size[0].toUpperCase() + size.slice(1)}</button>`).join("")}
          </div>
        </div>
      </div>`;
    const accountBody = `
      <div class="data-list">
        <button class="data-row" data-nav="#/account">
          <span class="data-icon">${icon("i-user")}</span>
          <span class="data-copy"><strong>Account &amp; sign-in</strong><small>${session ? session.email : "Not signed in"}</small></span>
          <span class="chev">${icon("i-chevron")}</span>
        </button>
        <button class="data-row" data-act="open-pro">
          <span class="data-icon">${icon("i-flash")}</span>
          <span class="data-copy"><strong>Biller Pro</strong><small>${T.isPro() ? "Active on this device" : `Ad-free, reports and receipt tools · ${money(T.proPrice())}`}</small></span>
          <span class="chev">${icon("i-chevron")}</span>
        </button>
      </div>`;
    const developerBody = `
      <div class="data-list">
        <button class="data-row" data-nav="#/plans">
          <span class="data-icon">${icon("i-card")}</span>
          <span class="data-copy"><strong>Subscription panel</strong><small>Every shop, its code and what has been paid</small></span>
          <span class="chev">${icon("i-chevron")}</span>
        </button>
      </div>`;
    const dataBody = `
      <div class="data-list">
        <button class="data-row" data-act="export-data">
          <span class="data-icon">${icon("i-download")}</span>
          <span class="data-copy"><strong>Export data</strong><small>Products, orders and settings as JSON</small></span>
          <span class="chev">${icon("i-chevron")}</span>
        </button>
        <button class="data-row" data-act="save-info">
          <span class="data-icon">${icon("i-lock")}</span>
          <span class="data-copy"><strong>Saved on this device</strong><small>Products, orders and settings are stored locally</small></span>
          <span class="save-chip" id="saveState" aria-label="Data saved on this device">
            <span class="dot"></span><span class="save-label">Saved</span>
          </span>
        </button>
        <button class="data-row danger" data-act="reset-data">
          <span class="data-icon">${icon("i-refresh")}</span>
          <span class="data-copy"><strong>Reset all data</strong><small>Clear products, orders and settings</small></span>
          <span class="chev">${icon("i-chevron")}</span>
        </button>
      </div>`;
    const aboutBody = `
      <div class="about-card">
        <div class="about-top">
          <span class="about-mark">${icon("i-store")}</span>
          <div><div class="about-name">Biller POS</div><div class="about-version">Version 1.0 · cloud-synced till</div></div>
        </div>
        <p><strong>Cash is recorded on this device.</strong> M-Pesa sends a real PIN prompt to the customer once your Paybill or Till is connected in Store &amp; receipts. The card reader is a demo and moves no money.</p>
      </div>`;
    return `<section class="screen">
      <div class="screen-head">
        <p class="eyebrow">Your shop</p>
        <h1 id="more-title">Settings</h1>
        <p class="sub">Everything in one place, grouped.</p>
      </div>

      <div class="settings-groups">
        ${settingsGroup("shop", "i-store", "Shop & receipts", `${store.name} · ${store.currency} · tax ${store.taxRate}%`, shopBody)}
        ${settingsGroup("subscription", "i-card", "Monthly plan", (T.subscriptionStatus() === "active" ? "Active" : T.subscriptionStatus() === "trial" ? "Free trial" : T.subscriptionStatus() === "awaiting" ? "Awaiting confirmation" : "Payment due"), subscriptionBody)}
        ${settingsGroup("catalog", "i-grid", "Catalog", `${T.categories().length} categories · ${T.state.products.length} products`, catalogBody)}
        ${settingsGroup("appearance", "i-pencil", "Appearance", `${themeName} · ${T.colorScheme() === "dark" ? "Dark" : "Light"}`, appearanceBody)}
        ${settingsGroup("account", "i-user", "Account", session ? session.email : "Not signed in", accountBody)}
        ${settingsGroup("data", "i-lock", "Data & privacy", "Export, backup and reset", dataBody)}
        ${settingsGroup("about", "i-info", "About", "Version 1.0 · cloud-synced till", aboutBody)}
        ${isDeveloper ? settingsGroup("developer", "i-chat", "Developer", "Subscriptions and support", developerBody) : ""}
      </div>

      <button type="button" class="account-card support-card" data-act="open-developer-chat">
        <span class="data-icon">${icon("i-chat")}</span>
        <span class="account-card-copy">
          <strong>Chat with developer</strong>
          <small>Spotted a bug or need help setting up? Send a message.</small>
        </span>
        <span class="chev">${icon("i-chevron")}</span>
      </button>
    </section>`;
  }

