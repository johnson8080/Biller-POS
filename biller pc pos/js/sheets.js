/* ============================================================
   Till — sheets and dialogs
   ============================================================ */
(() => {
  "use strict";
  const T = window.Till;
  if (!T) throw new Error("Till core must load before sheets.");
  const { esc, money } = T;
  const icon = (name) => `<svg class="ico" aria-hidden="true"><use href="#${name}"></use></svg>`;

  // Quick-pick sizes and units for the product editor. Shopkeepers can still
  // type anything else; these just cover the everyday cases.
  const COMMON_VARIANTS = [
    "Small", "Medium", "Large",
    "250 ml", "500 ml", "1 L", "1.5 L",
    "500 g", "1 kg", "Pack", "Piece", "Dozen"
  ];

  // How stock is counted. The short code is stored with the product and shown
  // next to the stock number on the Sell cards.
  const STOCK_UNITS = [
    ["pcs", "Pieces"],
    ["pack", "Pack"],
    ["box", "Box"],
    ["bottle", "Bottle"],
    ["sachet", "Sachet"],
    ["kg", "Kg"],
    ["g", "g"],
    ["L", "L"],
    ["ml", "ml"],
    ["dozen", "Dozen"]
  ];

  let closeTimer = null;
  let closeToken = 0;
  let active = false;
  let onCloseCallback = null;
  let lastFocus = null;
  let dialogEl = null;
  let confirmCallback = null;

  function layers() {
    return document.getElementById("layers");
  }

  function isOpen() {
    return active;
  }

  function open({ title, subtitle = "", iconName = "", tone = "", body = "", focus = "", onClose = null, head = true }) {
    const root = layers();
    if (!root) return;
    close(true);
    lastFocus = document.activeElement;
    active = true;
    onCloseCallback = onClose;
    root.innerHTML = `
      <div class="scrim" data-act="close-sheet"></div>
      <section class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title" tabindex="-1">
        <div class="sheet-grabber" aria-hidden="true"></div>
        ${head ? `<div class="sheet-head">
          <div>
            <h2 id="sheet-title">${esc(title)}</h2>
            ${subtitle ? `<p>${esc(subtitle)}</p>` : ""}
          </div>
          <button class="sheet-close" data-act="close-sheet" aria-label="Close">${icon("i-close")}</button>
        </div>` : ""}
        <div class="sheet-body">${body}</div>
      </section>`;
    root.classList.add("is-open");
    dialogEl = root.querySelector(".sheet");
    // A sheet can open outside a render pass, so wire its buttons here.
    window.TillActions?.wireActions?.(root);
    requestAnimationFrame(() => {
      root.classList.add("is-open");
      const target = (focus && root.querySelector(focus)) || dialogEl;
      target?.focus({ preventScroll: true });
    });
  }

  function close(immediate = false) {
    const root = layers();
    if (!root) return;
    if (!active && !root.innerHTML) return;
    active = false;
    const callback = onCloseCallback;
    onCloseCallback = null;
    // Any camera window that belongs to this sheet goes with it.
    T.scanner?.stopBar?.();
    root.classList.remove("is-open");
    document.getElementById("app")?.classList.remove("sheet-open");
    if (callback) {
      try { callback(); } catch (error) { console.warn(error); }
    }
    if (immediate) {
      closeToken += 1;
      root.innerHTML = "";
      dialogEl = null;
    } else {
      const token = ++closeToken;
      clearTimeout(closeTimer);
      closeTimer = setTimeout(() => {
        if (token === closeToken && !active) {
          root.innerHTML = "";
          dialogEl = null;
        }
      }, 320);
    }
    if (lastFocus?.isConnected) {
      try { lastFocus.focus({ preventScroll: true }); } catch { /* ignore */ }
    }
    lastFocus = null;
  }

  function setFormError(form, message) {
    const box = form.querySelector(".form-error");
    if (!box) return;
    box.textContent = message;
    box.classList.toggle("show", Boolean(message));
  }

  /* ---------- Manual barcode entry ---------- */

  function openManual({ onClose = null } = {}) {
    open({
      title: "Enter a barcode",
      subtitle: "Type the number printed under the barcode.",
      iconName: "i-barcode",
      focus: "#manual-code",
      onClose,
      body: `<form class="manual-form" id="manual-form" novalidate>
        <input class="input" id="manual-code" name="code" inputmode="text" autocomplete="off" autocapitalize="characters"
          spellcheck="false" placeholder="e.g. 6001234567890" aria-label="Barcode">
        <div class="form-error" role="alert"></div>
        <button class="btn btn-primary btn-block" type="submit">Look up barcode ${icon("i-arrow")}</button>
      </form>
      <p class="manual-hint">The number printed under the barcode. It has to match a product in your stock.</p>`
    });

    const form = document.getElementById("manual-form");
    form?.addEventListener("submit", (event) => {
      event.preventDefault();
      const code = String(new FormData(form).get("code") || "").trim();
      if (!code) {
        manualError("Enter the barcode number.");
        return;
      }
      manualError("");
      T.app?.handleBarcode?.(code, { source: "manual" });
      close(true);
    });
  }

  function manualError(message) {
    const form = document.getElementById("manual-form");
    if (form) setFormError(form, message);
  }

  /* ---------- Unknown barcode ---------- */

  function openUnknown(code, { onClose = null } = {}) {
    open({
      title: "No product found",
      subtitle: "This barcode isn’t in your catalog yet.",
      iconName: "i-barcode",
      tone: "warn",
      onClose,
      body: `<div class="code-pill">${icon("i-barcode")}${esc(code)}</div>
        <p style="margin-top:14px">Add it once and you can scan it every time. The barcode will be filled in for you.</p>
        <div class="sheet-actions">
          <button class="btn btn-primary" data-act="add-unknown" data-code="${esc(code)}">Add as new product ${icon("i-arrow")}</button>
          <button class="btn btn-ghost" data-act="scan-again">Scan again</button>
        </div>`
    });
  }

  /* ---------- Out of stock ---------- */

  function openOutOfStock(product, { fromScan = false, onClose = null } = {}) {
    open({
      title: `${product.name} is out of stock`,
      subtitle: "It can’t be added to a sale until you restock it.",
      iconName: "i-box",
      tone: "danger",
      onClose,
      body: `<div class="product-preview">
          ${T.screens.productTile(product)}
          <div><div class="name">${esc(product.name)}</div><div class="meta">${esc(product.barcode)} · ${money(product.price)} · 0 in stock</div></div>
        </div>
        <p>Update the stock count in Inventory, then come back to the sale.</p>
        <div class="sheet-actions">
          <button class="btn btn-primary" data-act="restock-product" data-id="${esc(product.id)}">Restock product ${icon("i-arrow")}</button>
          <button class="btn btn-ghost" data-act="${fromScan ? "scan-again" : "close-sheet"}">${fromScan ? "Scan another item" : "Close"}</button>
        </div>`
    });
  }

  /* ---------- Discount ---------- */

  function openDiscount() {
    const current = T.state.cart.discount;
    T.ui.discountMode = current?.type === "amount" ? "amount" : "percent";
    const activeMode = T.ui.discountMode;
    open({
      title: "Add a discount",
      subtitle: "Discounts apply to the whole sale before tax.",
      iconName: "i-tag",
      body: `<div class="discount-grid" aria-label="Quick discounts">
          ${[5, 10, 15, 20].map((value) => `<button class="discount-opt ${current?.type === "percent" && current.value === value ? "is-active" : ""}" data-act="apply-discount" data-type="percent" data-value="${value}">${value}%</button>`).join("")}
        </div>
        <div class="custom-discount">
          <div class="segmented" role="tablist" aria-label="Discount type">
            <button class="seg-btn ${activeMode === "percent" ? "is-active" : ""}" data-act="set-discount-mode" data-value="percent" role="tab" aria-selected="${activeMode === "percent"}">Percent</button>
            <button class="seg-btn ${activeMode === "amount" ? "is-active" : ""}" data-act="set-discount-mode" data-value="amount" role="tab" aria-selected="${activeMode === "amount"}">Fixed amount</button>
          </div>
          <form id="discount-form" novalidate>
            <div class="input-affix">
              <input class="input" id="discount-input" name="value" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0" aria-label="Custom discount value">
              <span class="affix" id="discount-affix">${activeMode === "percent" ? "%" : T.currencySymbol()}</span>
            </div>
            <div class="form-error" role="alert"></div>
            <button class="btn btn-primary btn-block discount-apply" type="submit">Apply custom discount</button>
          </form>
        </div>
        ${current ? `<div class="sheet-actions"><button class="btn btn-danger" data-act="remove-discount">Remove current discount</button></div>` : ""}`
    });

    const form = document.getElementById("discount-form");
    form?.addEventListener("submit", (event) => {
      event.preventDefault();
      const raw = String(new FormData(form).get("value") || "").trim();
      const amount = Number(raw);
      if (!raw || !Number.isFinite(amount) || amount <= 0) {
        discountError("Enter a discount greater than zero.");
        return;
      }
      const type = T.ui.discountMode;
      if (type === "percent" && amount > 100) {
        discountError("A percentage discount cannot be more than 100.");
        return;
      }
      discountError("");
      T.state.cart.discount = { type, value: amount };
      T.save();
      close(true);
      T.toast(`${type === "percent" ? amount + "%" : T.money(amount)} discount applied`, "i-tag");
      window.render?.();
    });
  }

  function setDiscountMode(mode) {
    T.ui.discountMode = mode === "amount" ? "amount" : "percent";
    document.querySelectorAll("[data-act='set-discount-mode']").forEach((button) => {
      const isActive = button.dataset.value === T.ui.discountMode;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-selected", String(isActive));
    });
    const affix = document.getElementById("discount-affix");
    if (affix) affix.textContent = T.ui.discountMode === "percent" ? "%" : T.currencySymbol();
    const input = document.getElementById("discount-input");
    if (input) {
      input.max = T.ui.discountMode === "percent" ? "100" : "";
      input.step = T.ui.discountMode === "percent" ? "1" : "0.01";
      input.focus({ preventScroll: true });
    }
  }

  function discountError(message) {
    const form = document.getElementById("discount-form");
    if (form) setFormError(form, message);
  }

  /* ---------- Product editor ---------- */

  function emptyEditorValues() {
    const categories = T.categories();
    return {
      name: "", detail: "", price: "", cost: "", stock: "10", lowStockAt: "5",
      barcode: "", category: categories[0] || "General", unit: "pcs",
      soldByMass: false
    };
  }

  function editorFromProduct(product) {
    return {
      name: product.name,
      detail: product.detail,
      price: (product.price / 100).toFixed(2),
      cost: product.cost ? (product.cost / 100).toFixed(2) : "",
      // Weighed items keep stock in grams but the shop reads kilograms.
      stock: product.soldByMass ? (product.stock / 1000).toFixed(3).replace(/\.?0+$/, "") : String(product.stock),
      lowStockAt: String(product.lowStockAt),
      barcode: product.barcode,
      category: product.category,
      unit: product.unit || "pcs",
      soldByMass: product.soldByMass === true
    };
  }

  function openProductEditor(id = null, { barcode = "", source = "inventory", addToCart = false } = {}) {
    const product = id ? T.findProduct(id) : null;
    const values = product ? editorFromProduct(product) : emptyEditorValues();
    if (barcode) values.barcode = barcode;
    T.ui.editor = {
      id: product?.id || null,
      values,
      source,
      addToCart
    };
    renderProductEditor({ focusName: !product });
  }

  function renderProductEditor({ focusName = false } = {}) {
    const editor = T.ui.editor;
    if (!editor) return;
    const values = editor.values;
    const editing = Boolean(editor.id);
    open({
      title: editing ? "Edit product" : "New product",
      subtitle: editing ? "Changes apply to future sales." : "Add the details once — scan it forever.",
      iconName: editing ? "i-pencil" : "i-box",
      focus: focusName ? "#product-name" : "",
      body: `<form id="product-form" novalidate>
        <div class="product-preview">
          <span class="tile tile-lg tone-${T.toneFor(values.category)}" id="product-preview-tile" aria-hidden="true">${esc(T.initials(values.name || "New"))}</span>
          <div><div class="name" id="product-preview-name">${esc(values.name || "New product")}</div><div class="meta" id="product-preview-meta">${esc(values.category)}${values.barcode ? ` · ${esc(values.barcode)}` : ""}</div></div>
        </div>
        <div class="field">
          <label for="product-barcode">Barcode</label>
          <div class="barcode-field">
            <input class="input" id="product-barcode" name="barcode" value="${esc(values.barcode)}" placeholder="Scan or type a barcode" autocomplete="off" spellcheck="false">
            <button class="barcode-scan" type="button" data-act="scan-barcode-field" aria-label="Scan barcode with camera">${icon("i-scan")}</button>
          </div>
          <div class="scan-bar" id="mini-scan" hidden>
            <div class="scan-bar-head">
              <span class="scan-bar-title">${icon("i-scan")} Scan the barcode</span>
              <button class="scan-bar-close" type="button" data-act="close-mini-scan" aria-label="Close the camera">${icon("i-close")}</button>
            </div>
            <div class="scan-bar-stage">
              <video id="mini-scan-video" playsinline muted autoplay aria-label="Camera preview"></video>
              <span class="scan-bar-reticle" aria-hidden="true"></span>
              <span class="scan-bar-status" id="mini-scan-status">Starting the camera…</span>
            </div>
          </div>
          <p class="field-help">EAN-13, EAN-8, UPC-A, UPC-E, Code 128, and Code 39. Leave blank if the item has no barcode.</p>
        </div>
        <div class="field">
          <label for="product-name">Product name</label>
          <input class="input" id="product-name" name="name" value="${esc(values.name)}" placeholder="e.g. Oat Milk" required autocomplete="off">
        </div>
        <div class="field">
          <label for="product-detail">Size or variant <span class="muted" style="text-transform:none;letter-spacing:0">(optional)</span></label>
          <input class="input" id="product-detail" name="detail" value="${esc(values.detail)}" placeholder="e.g. 1 L" autocomplete="off">
          <div class="variant-chips" role="group" aria-label="Common sizes and units">
            ${COMMON_VARIANTS.map((variant) => `<button type="button" class="variant-chip ${values.detail === variant ? "is-active" : ""}" data-variant="${esc(variant)}">${esc(variant)}</button>`).join("")}
          </div>
          <p class="field-help">Tap a common size or unit, or type your own.</p>
        </div>
        <div class="field">
          <label>Sold by</label>
          <div class="segmented" id="product-mass-toggle" role="group" aria-label="Sold by each or by weight">
            <button type="button" class="seg-btn ${!values.soldByMass ? "is-active" : ""}" data-mass="off" aria-pressed="${!values.soldByMass}">Each</button>
            <button type="button" class="seg-btn ${values.soldByMass ? "is-active" : ""}" data-mass="on" aria-pressed="${values.soldByMass}">${icon("i-scale")} Weight (kg)</button>
          </div>
          <p class="field-help">Pick Weight for items the shop weighs: flour, produce, meat. You will type the weight at the till.</p>
        </div>
        <div class="field-row">
          <div class="field">
            <label for="product-cost">Buying price</label>
            <div class="input-affix"><input class="input" id="product-cost" name="cost" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(values.cost)}" placeholder="0.00"><span class="affix">${esc(T.currencySymbol())}</span></div>
            <p class="field-help" id="product-cost-help">${values.soldByMass ? "What you pay per kilogram." : "What you pay for each one."}</p>
          </div>
          <div class="field">
            <label for="product-price">Selling price</label>
            <div class="input-affix"><input class="input" id="product-price" name="price" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(values.price)}" placeholder="0.00" required><span class="affix">${esc(T.currencySymbol())}</span></div>
            <p class="field-help" id="product-price-help">${values.soldByMass ? "What the customer pays per kilogram." : "What the customer pays."}</p>
          </div>
        </div>
        <div class="field-row field-row-2">
          <div class="field">
            <label for="product-stock" id="product-stock-label">${values.soldByMass ? "In stock (kg)" : "In stock"}</label>
            <input class="input" id="product-stock" name="stock" type="number" min="0" step="${values.soldByMass ? "0.001" : "1"}" inputmode="decimal" value="${esc(values.stock)}" required>
          </div>
          <div class="field">
            <label for="product-unit">Unit</label>
            <select class="select" id="product-unit" name="unit" aria-label="Stock unit" ${values.soldByMass ? "disabled" : ""}>
              ${STOCK_UNITS.map(([value, label]) => `<option value="${esc(value)}" ${values.soldByMass ? value === "kg" : values.unit === value ? "selected" : ""}>${esc(label)}</option>`).join("")}
            </select>
          </div>
        </div>
        <div class="field-row">
          <div class="field">
            <label for="product-category">Category</label>
            <select class="select" id="product-category" name="category">
              ${T.categories().map((category) => `<option value="${esc(category)}" ${values.category === category ? "selected" : ""}>${esc(category)}</option>`).join("")}
            </select>
            <p class="field-help">Add or rename categories in More.</p>
          </div>
          <div class="field">
            <label for="product-low">Low-stock alert</label>
            <input class="input" id="product-low" name="lowStockAt" type="number" min="0" step="1" inputmode="numeric" value="${esc(values.lowStockAt)}">
          </div>
        </div>
        <div class="form-error" role="alert"></div>
        <div class="sheet-actions">
          <button class="btn btn-primary" type="submit">${editing ? "Save changes" : "Add product"} ${icon("i-check")}</button>
        </div>
        ${editing ? `<button class="btn btn-danger delete-product" type="button" data-act="delete-product" data-id="${esc(editor.id)}">Delete product</button>` : ""}
      </form>`
    });

    const form = document.getElementById("product-form");
    form?.addEventListener("input", () => {
      // Keep the saved copy in step with the form, so nothing the shopkeeper
      // has already typed is ever lost.
      const editor = T.ui.editor;
      if (editor) editor.values = { ...editor.values, ...readProductForm(form) };
      const name = form.querySelector("#product-name")?.value || "New product";
      const category = form.querySelector("#product-category")?.value || T.categories()[0] || "General";
      const tile = document.getElementById("product-preview-tile");
      const previewName = document.getElementById("product-preview-name");
      const meta = document.getElementById("product-preview-meta");
      if (tile) { tile.textContent = T.initials(name); tile.className = `tile tile-lg tone-${T.toneFor(category)}`; }
      if (previewName) previewName.textContent = name;
      if (meta) meta.textContent = `${category}${form.querySelector("#product-barcode")?.value ? ` · ${form.querySelector("#product-barcode").value}` : ""}`;
      // Keep the quick-pick chips in step with whatever is in the field.
      const detailValue = form.querySelector("#product-detail")?.value.trim() || "";
      form.querySelectorAll(".variant-chip").forEach((chip) => {
        chip.classList.toggle("is-active", chip.dataset.variant === detailValue);
      });
    });

    form?.addEventListener("click", (event) => {
      const chip = event.target.closest(".variant-chip");
      if (chip) {
        const input = form.querySelector("#product-detail");
        if (!input) return;
        input.value = chip.dataset.variant;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        return;
      }
      // The Each / Weight switch: it flips the stock and unit fields in
      // place, so nothing the shopkeeper typed is lost.
      const massBtn = event.target.closest("#product-mass-toggle .seg-btn");
      if (!massBtn) return;
      const wantMass = massBtn.dataset.mass === "on";
      const editor = T.ui.editor;
      if (!editor || editor.values.soldByMass === wantMass) return;
      editor.values.soldByMass = wantMass;
      const stockInput = form.querySelector("#product-stock");
      const stockLabel = form.querySelector("#product-stock-label");
      const unitSelect = form.querySelector("#product-unit");
      const costHelp = form.querySelector("#product-cost-help");
      const priceHelp = form.querySelector("#product-price-help");
      form.querySelectorAll("#product-mass-toggle .seg-btn").forEach((btn) => {
        const on = btn.dataset.mass === "on";
        btn.classList.toggle("is-active", on === wantMass);
        btn.setAttribute("aria-pressed", String(on === wantMass));
      });
      if (stockInput) {
        stockInput.step = wantMass ? "0.001" : "1";
        stockInput.inputMode = "decimal";
      }
      if (stockLabel) stockLabel.textContent = wantMass ? "In stock (kg)" : "In stock";
      if (unitSelect) {
        unitSelect.disabled = wantMass;
        if (wantMass) unitSelect.value = "kg";
      }
      if (costHelp) costHelp.textContent = wantMass ? "What you pay per kilogram." : "What you pay for each one.";
      if (priceHelp) priceHelp.textContent = wantMass ? "What the customer pays per kilogram." : "What the customer pays.";
    });

    form?.addEventListener("submit", (event) => {
      event.preventDefault();
      const values = readProductForm(form);
      if (!values) return;
      if (!values.name) {
        productEditorError("Give the product a name.");
        return;
      }
      const price = T.parsePriceToCents(values.price);
      if (!Number.isFinite(price) || price <= 0) {
        productEditorError("Enter a price greater than zero.");
        return;
      }
      const existing = editor.id ? T.findProduct(editor.id) : null;
      const mass = values.soldByMass === true;
      // Weighed stock is kept in grams: what the shop types as 2.5 kg is
      // stored as 2500 g so all the math stays in whole numbers.
      const rawStock = Number(values.stock);
      const stock = mass
        ? Math.max(0, Math.min(1000000, Math.round((Number.isFinite(rawStock) ? rawStock : 0) * 1000)))
        : T.clampInt(values.stock, 0, 999999);
      const lowStockAt = T.clampInt(values.lowStockAt, 0, 999999);
      const costRaw = String(values.cost || "").trim();
      const cost = costRaw === "" ? 0 : (T.parsePriceToCents(costRaw) || 0);

      if (existing) {
        existing.name = values.name;
        existing.detail = values.detail;
        existing.price = price;
        existing.cost = cost;
        existing.stock = stock;
        existing.lowStockAt = lowStockAt;
        existing.unit = mass ? "kg" : values.unit;
        existing.barcode = T.cleanBarcode(values.barcode);
        existing.category = values.category;
        existing.soldByMass = mass;
      } else {
        const product = {
          id: T.uid(),
          name: values.name,
          detail: values.detail,
          price,
          cost,
          stock,
          lowStockAt,
          unit: mass ? "kg" : values.unit,
          barcode: T.cleanBarcode(values.barcode),
          category: values.category,
          soldByMass: mass
        };
        T.state.products.unshift(product);
        if (editor.addToCart) {
          if (mass) T.sheets?.openWeigh?.(product, { fromEditor: true });
          else T.addToCart(product, 1);
        }
      }
      T.save();
      T.ui.editor = null;
      close(true);
      T.toast(existing ? "Product updated" : "Product added", "i-check");
      window.render?.();
    });
  }

  function readProductForm(form) {
    if (!form) return null;
    const data = new FormData(form);
    // The Each/Weight switch is not a form field, so it rides in from the
    // editor's own saved copy.
    const editorMass = T.ui?.editor?.values?.soldByMass === true;
    return {
      name: String(data.get("name") || "").trim(),
      detail: String(data.get("detail") || "").trim(),
      price: String(data.get("price") || "").trim(),
      cost: String(data.get("cost") || "").trim(),
      stock: String(data.get("stock") || "").trim(),
      lowStockAt: String(data.get("lowStockAt") || "5").trim(),
      barcode: String(data.get("barcode") || "").trim(),
      category: String(data.get("category") || T.categories()[0] || "General"),
      unit: String(data.get("unit") || "pcs").trim() || "pcs",
      soldByMass: editorMass
    };
  }

  function productEditorError(message) {
    const form = document.getElementById("product-form");
    if (form) setFormError(form, message);
  }

  /* ---------- Info / confirm ---------- */

  function openSaveInfo() {
    const bytes = new Blob([JSON.stringify(T.state)]).size;
    open({
      title: "Saved on this device",
      subtitle: "Signed-in data syncs with Firebase; local data is a fallback.",
      iconName: "i-lock",
      tone: "good",
      body: `<p>Products, stock, orders, and receipts are saved on this device. When you sign in with Firebase, your session syncs to the cloud.</p>
        <div class="data-list" style="margin-top:14px">
          <div class="data-row"><span class="data-icon">${icon("i-box")}</span><span class="data-copy"><strong>${T.state.products.length} products</strong><small>${T.state.transactions.length} receipts · ${(bytes / 1024).toFixed(1)} KB</small></span></div>
        </div>
        <p style="margin-top:14px">Clearing browser data or resetting the app erases this store. Export a JSON backup from Settings if you need one.</p>
        <div class="sheet-actions"><button class="btn btn-primary" data-act="close-sheet">Got it</button></div>`
    });
  }

  function confirm({ title, message, confirmLabel = "Confirm", danger = false, onConfirm }) {
    confirmCallback = onConfirm;
    open({
      title,
      iconName: danger ? "i-alert" : "i-info",
      tone: danger ? "danger" : "warn",
      body: `<p class="confirm-copy">${esc(message)}</p>
        <div class="sheet-actions pair">
          <button class="btn btn-quiet" data-act="close-sheet">Cancel</button>
          <button class="btn ${danger ? "btn-danger" : "btn-primary"}" data-act="confirm-sheet">${esc(confirmLabel)}</button>
        </div>`
    });
  }

  function runConfirm() {
    const callback = confirmCallback;
    confirmCallback = null;
    close(true);
    if (callback) callback();
  }

  /* ---------- Biller Pro ---------- */

  function openPro() {
    open({
      title: T.isPro() ? "Biller Pro" : "Upgrade to Biller Pro",
      subtitle: T.isPro() ? "You have the Pro unlock on this device." : "One-time unlock for this device.",
      iconName: "i-check",
      body: `<p style="margin:0 0 14px;font-size:calc(13px * var(--fs));line-height:1.5;color:var(--muted)">Biller Pro removes ads from the sale screen and unlocks advanced sales reports, receipt export, and multi-staff tills. This demo purchase is simulated - no real money moves.</p>
        <div class="sheet-actions">
          ${T.isPro()
            ? `<button class="btn btn-lime btn-block" data-act="close-sheet">Done</button>`
            : `<button class="btn btn-primary btn-block" data-act="buy-pro">Unlock · ${money(T.proPrice())}</button>`}
          <button class="btn btn-ghost btn-block" data-act="close-sheet">Maybe later</button>
        </div>`
    });
  }

  function buyPro() {
    T.setPro(true);
    T.ads.sync();
    close(true);
    T.toast("Biller Pro unlocked", "i-check");
  }

  /* ---------- Inline scan bar (inside the product editor) ---------- */

  /**
   * Open the little camera window under the barcode field. The entry form
   * stays exactly where it is, so nothing already typed is lost.
   */
  function openMiniScan() {
    const bar = document.getElementById("mini-scan");
    if (!bar) return;
    bar.hidden = false;
    bar.classList.add("is-open");
    T.scanner?.startBar?.();
  }

  function closeMiniScan() {
    T.scanner?.stopBar?.();
    const bar = document.getElementById("mini-scan");
    if (bar) {
      bar.hidden = true;
      bar.classList.remove("is-open");
    }
    const field = document.getElementById("product-barcode");
    if (field) field.focus({ preventScroll: true });
  }

  /* ---------- Quick scan (Sell screen) ---------- */

  function quickScanSummary() {
    const count = T.itemCount();
    if (!count) return `<span>No items yet</span><strong>${money(0)}</strong>`;
    const { total } = T.cartTotals();
    return `<span>${count} ${count === 1 ? "item" : "items"} in this sale</span><strong>${money(total)}</strong>`;
  }

  /** Refresh the running total while the compact scanner is open. */
  function refreshQuickScan() {
    const summary = document.getElementById("quick-scan-summary");
    if (summary) summary.innerHTML = quickScanSummary();
  }

  function openQuickScan() {
    open({
      title: "Scan barcode",
      subtitle: "Each scan goes straight into the current sale.",
      iconName: "i-scan",
      onClose: () => { window.render?.(); },
      body: `<div class="scan-bar is-open" id="mini-scan">
          <div class="scan-bar-head">
            <span class="scan-bar-title">${icon("i-scan")} Point at a barcode</span>
            <button class="scan-bar-close" type="button" data-act="close-quick-scan" aria-label="Close the camera">${icon("i-close")}</button>
          </div>
          <div class="scan-bar-stage">
            <video id="mini-scan-video" playsinline muted autoplay aria-label="Camera preview"></video>
            <span class="scan-bar-reticle" aria-hidden="true"></span>
            <span class="scan-bar-status" id="mini-scan-status">Starting the camera…</span>
          </div>
        </div>
        <div class="quick-scan-summary" id="quick-scan-summary">${quickScanSummary()}</div>
        <p class="quick-scan-hint">The camera stays open so you can scan the whole basket.</p>
        <div class="sheet-actions pair">
          <button class="btn btn-ghost" data-act="manual-entry">${icon("i-pencil")} Enter barcode</button>
          <button class="btn btn-primary" data-act="close-quick-scan">Done</button>
        </div>`
    });
    requestAnimationFrame(() => T.scanner?.startQuick?.());
  }

  /* ---------- Suppliers ---------- */

  function openSupplierEditor(id = null) {
    const supplier = id ? T.findSupplier(id) : null;
    const editing = Boolean(supplier);
    const selectedDays = new Set(supplier?.days || []);
    const values = {
      name: supplier?.name || "",
      contact: supplier?.contact || "",
      phone: supplier?.phone || "",
      email: supplier?.email || "",
      supplies: supplier?.supplies || "",
      address: supplier?.address || "",
      notes: supplier?.notes || ""
    };
    open({
      title: editing ? "Edit supplier" : "New supplier",
      subtitle: editing ? "Update this supplier's contact details." : "Save the contacts you order from.",
      iconName: editing ? "i-pencil" : "i-truck",
      focus: "#supplier-name",
      body: `<form id="supplier-form" novalidate>
        <div class="field">
          <label for="supplier-name">Supplier name</label>
          <input class="input" id="supplier-name" name="name" value="${esc(values.name)}" placeholder="e.g. Nairobi Fresh Produce" maxlength="80" autocomplete="organization" required>
        </div>
        <div class="field">
          <label for="supplier-contact">Contact person</label>
          <input class="input" id="supplier-contact" name="contact" value="${esc(values.contact)}" placeholder="e.g. Mary Wanjiku" maxlength="80" autocomplete="name">
        </div>
        <div class="field-row">
          <div class="field">
            <label for="supplier-phone">Phone</label>
            <input class="input" id="supplier-phone" name="phone" type="tel" value="${esc(values.phone)}" placeholder="+254 700 000 000" maxlength="40" inputmode="tel" autocomplete="tel">
          </div>
          <div class="field">
            <label for="supplier-email">Email</label>
            <input class="input" id="supplier-email" name="email" type="email" value="${esc(values.email)}" placeholder="orders@supplier.co.ke" maxlength="120" inputmode="email" autocomplete="email">
          </div>
        </div>
        <div class="field">
          <label for="supplier-supplies">What they supply</label>
          <input class="input" id="supplier-supplies" name="supplies" value="${esc(values.supplies)}" placeholder="e.g. Milk, bread, eggs" maxlength="120">
        </div>
        <div class="field">
          <label>Delivery days</label>
          <div class="supplier-days supplier-day-picker" id="supplier-days">
            ${T.SUPPLIER_DAYS.map(([code, label]) => `<button type="button" class="supplier-day ${selectedDays.has(code) ? "is-on" : ""}" data-day="${code}" aria-pressed="${selectedDays.has(code)}">${label}</button>`).join("")}
          </div>
          <p class="field-help">Tap the days this supplier delivers.</p>
        </div>
        <div class="field">
          <label for="supplier-address">Address</label>
          <input class="input" id="supplier-address" name="address" value="${esc(values.address)}" placeholder="Shop, street, town" maxlength="160" autocomplete="street-address">
        </div>
        <div class="field">
          <label for="supplier-notes">Notes</label>
          <textarea class="textarea" id="supplier-notes" name="notes" rows="2" maxlength="400" placeholder="Payment terms, delivery notes…">${esc(values.notes)}</textarea>
        </div>
        <div class="form-error" role="alert"></div>
        <div class="sheet-actions">
          <button class="btn btn-primary btn-block" type="submit">${editing ? "Save supplier" : "Add supplier"} ${icon("i-check")}</button>
          ${editing ? `<button class="btn btn-danger btn-block" type="button" data-act="delete-supplier" data-id="${esc(supplier.id)}">Delete supplier</button>` : ""}
        </div>
      </form>`
    });

    document.querySelectorAll("#supplier-days .supplier-day").forEach((button) => {
      button.addEventListener("click", () => {
        const on = button.classList.toggle("is-on");
        button.setAttribute("aria-pressed", String(on));
      });
    });

    const form = document.getElementById("supplier-form");
    form?.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const next = {
        name: String(data.get("name") || "").trim().replace(/\s+/g, " "),
        contact: String(data.get("contact") || "").trim().replace(/\s+/g, " "),
        phone: String(data.get("phone") || "").trim(),
        email: String(data.get("email") || "").trim(),
        supplies: String(data.get("supplies") || "").trim(),
        address: String(data.get("address") || "").trim(),
        notes: String(data.get("notes") || "").trim(),
        days: [...form.querySelectorAll("#supplier-days .supplier-day.is-on")].map((button) => button.dataset.day)
      };
      if (!next.name) {
        supplierError("Give the supplier a name.");
        return;
      }
      if (next.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next.email)) {
        supplierError("Enter a valid email address.");
        return;
      }
      const existing = id ? T.findSupplier(id) : null;
      if (existing) Object.assign(existing, next);
      else {
        T.state.suppliers.unshift({ id: T.uid("s"), ...next, ledger: [], createdAt: new Date().toISOString() });
        T.ui.supplierSearch = "";
      }
      T.save();
      close(true);
      T.toast(existing ? "Supplier updated" : "Supplier added", "i-check");
      window.render?.();
    });
  }

  function supplierError(message) {
    const form = document.getElementById("supplier-form");
    if (form) setFormError(form, message);
  }

  /* ---------- Supplier payments and bills ---------- */

  function supplierPayTarget(supplier) {
    const totals = T.supplierTotals(supplier);
    const balance = totals.balance > 0
      ? `You owe ${money(totals.balance)}`
      : totals.balance < 0
        ? `${money(-totals.balance)} credit`
        : "Account settled";
    return `<div class="supplier-pay-target">
      <span class="supplier-avatar" aria-hidden="true">${esc(T.initials(supplier.name))}</span>
      <div class="supplier-pay-target-copy"><strong>${esc(supplier.name)}</strong><small>${esc(balance)}</small></div>
    </div>`;
  }

  /* ---------- Stock received lines ----------
     A supplier bill means stock came in and the money is owed later. A
     payment can also carry stock, when the shop buys and pays on the spot.
     Both use this small line editor: pick an item, how many, and what each
     one cost. */

  function stockLineOptions() {
    return (T.state.products || []).map((product) => {
      const unit = product.unit || "pcs";
      return `<option value="${esc(product.id)}">${esc(product.name)} — ${product.stock} ${esc(unit)} in stock</option>`;
    }).join("");
  }

  function stockLineRow(options = "") {
    return `<div class="stock-line" data-line>
      <select class="select stock-line-product" aria-label="Item received">
        <option value="">Choose an item…</option>
        ${options}
      </select>
      <div class="stock-line-fields">
        <input class="input stock-line-qty" type="number" min="1" step="1" inputmode="numeric" placeholder="Qty" aria-label="Quantity received">
        <div class="input-affix"><input class="input stock-line-cost" type="number" min="0" step="0.01" inputmode="decimal" placeholder="Cost each" aria-label="Cost for each"><span class="affix">${esc(T.currencySymbol())}</span></div>
        <button type="button" class="stock-line-remove" data-remove-line aria-label="Remove this item">${icon("i-close")}</button>
      </div>
    </div>`;
  }

  function stockLinesField({ title, help }) {
    return `<div class="field stock-lines-field">
      <label>${title}</label>
      <div class="stock-lines" data-stock-lines>${stockLineRow(stockLineOptions())}</div>
      <div class="stock-lines-foot">
        <button type="button" class="btn btn-ghost btn-sm" data-add-line>${icon("i-plus")} Add item</button>
        <span class="stock-lines-total" data-stock-total>0 items</span>
      </div>
      <button type="button" class="stock-lines-use" data-use-total hidden>Use the stock total as the amount</button>
      <p class="field-help">${help}</p>
    </div>`;
  }

  /** Wires the line editor and returns a reader for the filled lines. */
  function wireStockLines(form) {
    const container = form?.querySelector("[data-stock-lines]");
    if (!container) return null;
    const options = stockLineOptions();
    const summary = form.querySelector("[data-stock-total]");
    const useButton = form.querySelector("[data-use-total]");

    const readLines = () => [...container.querySelectorAll("[data-line]")]
      .map((row) => {
        const productId = row.querySelector(".stock-line-product")?.value || "";
        const qty = T.clampInt(row.querySelector(".stock-line-qty")?.value, 0, 100000);
        const costRaw = row.querySelector(".stock-line-cost")?.value;
        const cost = String(costRaw ?? "").trim() === "" ? 0 : (T.parsePriceToCents(costRaw) || 0);
        return { productId, qty, cost };
      })
      .filter((line) => line.productId && line.qty > 0);

    const refresh = () => {
      const lines = readLines();
      const items = lines.reduce((sum, line) => sum + line.qty, 0);
      const total = lines.reduce((sum, line) => sum + line.qty * line.cost, 0);
      if (summary) summary.textContent = `${items} ${items === 1 ? "item" : "items"} · ${money(total)}`;
      if (useButton) {
        useButton.hidden = total <= 0;
        useButton.textContent = `Use ${money(total)} as the amount`;
      }
      return { lines, items, total };
    };

    container.addEventListener("input", refresh);
    container.addEventListener("change", refresh);
    container.addEventListener("click", (event) => {
      const remove = event.target.closest("[data-remove-line]");
      if (!remove) return;
      const row = remove.closest("[data-line]");
      const rows = container.querySelectorAll("[data-line]");
      if (rows.length > 1) {
        row.remove();
      } else {
        row.querySelector(".stock-line-product").value = "";
        row.querySelector(".stock-line-qty").value = "";
        row.querySelector(".stock-line-cost").value = "";
      }
      refresh();
    });

    form.querySelector("[data-add-line]")?.addEventListener("click", () => {
      container.insertAdjacentHTML("beforeend", stockLineRow(options));
      const rows = container.querySelectorAll("[data-line]");
      rows[rows.length - 1]?.querySelector(".stock-line-product")?.focus();
      refresh();
    });

    useButton?.addEventListener("click", () => {
      const { total } = refresh();
      const amountInput = form.querySelector("[data-amount-target]");
      if (amountInput && total > 0) {
        amountInput.value = (total / 100).toFixed(2);
        amountInput.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });

    refresh();
    return { readLines, refresh };
  }

  /** Unpaid bills, with a one-tap way to pay one of them. */
  function supplierOpenBillsField(supplier) {
    const open = T.supplierOpenBills?.(supplier) || [];
    if (!open.length) return "";
    const total = open.reduce((sum, bill) => sum + bill.remaining, 0);
    return `<div class="field supplier-open-bills">
      <label>Unpaid bills</label>
      <div class="supplier-bill-list">
        ${open.map((bill) => `<div class="supplier-bill-row">
          <span class="supplier-bill-copy"><strong>${money(bill.remaining)}</strong><small>${esc(bill.note || "Stock bill")}${bill.items?.length ? ` · ${bill.items.map((item) => `${item.qty} × ${item.name}`).join(", ")}` : ""}</small></span>
          <button type="button" class="btn btn-ghost btn-sm" data-pay-bill="${bill.remaining}">Pay this</button>
        </div>`).join("")}
      </div>
      <button type="button" class="supplier-pay-full" data-pay-full="${total}">Pay the full balance — ${money(total)}</button>
    </div>`;
  }

  function openSupplierPayment(id) {
    const supplier = T.findSupplier(id);
    if (!supplier) return;
    let method = "cash";
    open({
      title: "Record payment",
      subtitle: `Paying ${supplier.name}`,
      iconName: "i-cash",
      focus: "#supplier-payment-amount",
      body: `<form id="supplier-payment-form" novalidate>
        ${supplierPayTarget(supplier)}
        ${supplierOpenBillsField(supplier)}
        <div class="field">
          <label for="supplier-payment-amount">Amount paid</label>
          <div class="input-affix"><input class="input" id="supplier-payment-amount" name="amount" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0.00" required data-amount-target><span class="affix">${esc(T.currencySymbol())}</span></div>
          <p class="field-help">Settles the oldest unpaid bill first, or pays for stock you are taking right now.</p>
        </div>
        <div class="field">
          <label>Payment method</label>
          <div class="pay-method-picker" id="supplier-pay-method">
            <button type="button" class="pay-method is-active" data-method="cash" aria-pressed="true">${icon("i-cash")} Cash</button>
            <button type="button" class="pay-method" data-method="mpesa" aria-pressed="false">${icon("i-phone")} M-Pesa</button>
          </div>
        </div>
        ${stockLinesField({
          title: "Stock received with this payment",
          help: "Optional. Items taken now are added to your inventory and counted in this payment."
        })}
        <div class="field">
          <label for="supplier-payment-date">Date</label>
          <input class="input" id="supplier-payment-date" name="date" type="date" value="${T.isoDay()}">
        </div>
        <div class="field">
          <label for="supplier-payment-note">Reference or note <span class="field-optional">Optional</span></label>
          <input class="input" id="supplier-payment-note" name="note" placeholder="e.g. M-Pesa code QGH7X8Y2Z1" maxlength="120">
        </div>
        <div class="form-error" role="alert"></div>
        <div class="sheet-actions">
          <button class="btn btn-primary btn-block" type="submit">Record payment ${icon("i-check")}</button>
        </div>
      </form>`
    });

    document.querySelectorAll("#supplier-pay-method .pay-method").forEach((button) => {
      button.addEventListener("click", () => {
        method = button.dataset.method === "mpesa" ? "mpesa" : "cash";
        document.querySelectorAll("#supplier-pay-method .pay-method").forEach((item) => {
          const active = item.dataset.method === method;
          item.classList.toggle("is-active", active);
          item.setAttribute("aria-pressed", String(active));
        });
      });
    });

    const form = document.getElementById("supplier-payment-form");
    const stock = wireStockLines(form);
    const setAmount = (cents) => {
      const input = document.getElementById("supplier-payment-amount");
      if (!input || !Number.isFinite(cents) || cents <= 0) return;
      input.value = (cents / 100).toFixed(2);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    form?.querySelector("[data-pay-full]")?.addEventListener("click", (event) => {
      setAmount(Number(event.currentTarget.dataset.payFull));
    });
    form?.querySelectorAll("[data-pay-bill]").forEach((button) => {
      button.addEventListener("click", () => setAmount(Number(button.dataset.payBill)));
    });

    form?.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const lines = stock?.readLines() || [];
      const stockTotal = lines.reduce((sum, line) => sum + line.qty * line.cost, 0);
      const typed = T.parsePriceToCents(data.get("amount"));
      const amount = Number.isFinite(typed) && typed > 0 ? typed : stockTotal;
      if (!Number.isFinite(amount) || amount <= 0) {
        setFormError(form, "Enter an amount greater than zero.");
        return;
      }
      const date = /^\d{4}-\d{2}-\d{2}$/.test(String(data.get("date") || "")) ? String(data.get("date")) : T.isoDay();
      const items = T.applyStockLines(lines);
      supplier.ledger = supplier.ledger || [];
      supplier.ledger.unshift({
        id: T.uid("se"),
        type: "payment",
        method,
        amount,
        note: String(data.get("note") || "").trim(),
        items,
        date,
        createdAt: new Date().toISOString()
      });
      T.save();
      close(true);
      T.toast(items.length
        ? `Payment recorded · ${items.length} ${items.length === 1 ? "item" : "items"} in stock`
        : `${method === "mpesa" ? "M-Pesa" : "Cash"} payment recorded`, "i-check");
      window.render?.();
    });
  }

  function openSupplierBill(id) {
    const supplier = T.findSupplier(id);
    if (!supplier) return;
    open({
      title: "Add supplier bill",
      subtitle: `Stock from ${supplier.name} — you pay later`,
      iconName: "i-box",
      focus: "#supplier-bill-amount",
      body: `<form id="supplier-bill-form" novalidate>
        ${supplierPayTarget(supplier)}
        <div class="field">
          <label for="supplier-bill-amount">Amount owed</label>
          <div class="input-affix"><input class="input" id="supplier-bill-amount" name="amount" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0.00" required data-amount-target><span class="affix">${esc(T.currencySymbol())}</span></div>
          <p class="field-help">This bill is added to what you owe ${esc(supplier.name)}. Nothing is paid yet.</p>
        </div>
        ${stockLinesField({
          title: "Stock received",
          help: "Items received now are added to your inventory straight away."
        })}
        <div class="field">
          <label for="supplier-bill-date">Date</label>
          <input class="input" id="supplier-bill-date" name="date" type="date" value="${T.isoDay()}">
        </div>
        <div class="field">
          <label for="supplier-bill-note">What was supplied <span class="field-optional">Optional</span></label>
          <input class="input" id="supplier-bill-note" name="note" placeholder="e.g. 2 crates of milk" maxlength="120">
        </div>
        <div class="form-error" role="alert"></div>
        <div class="sheet-actions">
          <button class="btn btn-primary btn-block" type="submit">Add bill ${icon("i-check")}</button>
        </div>
      </form>`
    });

    const form = document.getElementById("supplier-bill-form");
    const stock = wireStockLines(form);
    form?.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const lines = stock?.readLines() || [];
      const stockTotal = lines.reduce((sum, line) => sum + line.qty * line.cost, 0);
      const typed = T.parsePriceToCents(data.get("amount"));
      const amount = Number.isFinite(typed) && typed > 0 ? typed : stockTotal;
      if (!Number.isFinite(amount) || amount <= 0) {
        setFormError(form, "Enter an amount greater than zero.");
        return;
      }
      const date = /^\d{4}-\d{2}-\d{2}$/.test(String(data.get("date") || "")) ? String(data.get("date")) : T.isoDay();
      const items = T.applyStockLines(lines);
      supplier.ledger = supplier.ledger || [];
      supplier.ledger.unshift({
        id: T.uid("se"),
        type: "bill",
        method: null,
        amount,
        note: String(data.get("note") || "").trim(),
        items,
        date,
        createdAt: new Date().toISOString()
      });
      T.save();
      close(true);
      T.toast(items.length
        ? `Bill added · ${items.length} ${items.length === 1 ? "item" : "items"} in stock`
        : "Supplier bill added", "i-check");
      window.render?.();
    });
  }

  /* ---------- Categories ---------- */

  function openCategoryEditor(name = "") {
    const editing = Boolean(name);
    open({
      title: editing ? "Rename category" : "Add a category",
      subtitle: editing
        ? "Products in this category follow the new name."
        : "Categories group your products on the Sell screen.",
      iconName: "i-tag",
      focus: "#category-name",
      body: `<form id="category-form" novalidate>
        <div class="field">
          <label for="category-name">Category name</label>
          <input class="input" id="category-name" name="name" value="${esc(name)}" placeholder="e.g. Beverages" maxlength="40" autocomplete="off">
        </div>
        <div class="form-error" role="alert"></div>
        <div class="sheet-actions">
          <button class="btn btn-primary btn-block" type="submit">${editing ? "Save name" : "Add category"} ${icon("i-check")}</button>
        </div>
      </form>`
    });

    const form = document.getElementById("category-form");
    form?.addEventListener("submit", (event) => {
      event.preventDefault();
      const value = String(new FormData(form).get("name") || "").trim();
      const result = editing ? T.renameCategory(name, value) : T.addCategory(value);
      if (!result.ok) {
        categoryError(result.error);
        return;
      }
      close(true);
      T.toast(editing ? `Category renamed to ${result.name}` : "Category added", "i-check");
      window.render?.();
    });
  }

  function categoryError(message) {
    const form = document.getElementById("category-form");
    if (form) setFormError(form, message);
  }

  /* ---------- Account ---------- */

  function openAccount() {
    const session = T.getSession();
    if (!session) {
      open({
        title: "Account",
        subtitle: "Sign in to keep your shop in sync.",
        iconName: "i-lock",
        body: `<p class="confirm-copy">No account is signed in on this device. Sign in to sync your shop settings across devices.</p>
          <div class="account-actions">
            <button class="btn btn-primary btn-block" data-act="open-auth">Sign in ${icon("i-arrow")}</button>
          </div>`
      });
      return;
    }
    const initial = session.email.slice(0, 1).toUpperCase();
    open({
      title: "Account",
      subtitle: "Signed in on this device.",
      iconName: "i-lock",
      body: `<div class="account-hero">
          <span class="avatar avatar-lg" aria-hidden="true">${esc(initial)}<span class="avatar-status">${icon("i-check")}</span></span>
          <div class="account-copy">
            <strong>${esc(session.email)}</strong>
            <small><span class="account-dot"></span>Signed in</small>
          </div>
        </div>
        <div class="account-actions">
          <button class="btn btn-primary btn-block" data-act="open-account-settings">Account settings ${icon("i-arrow")}</button>
          <button class="btn btn-ghost btn-block" data-act="sign-out">Sign out</button>
        </div>
        <p class="account-note">${icon("i-lock", "ico ico-sm")}<span>Your account keeps shop settings in sync. Products, stock and orders stay saved on this device.</span></p>`
    });
  }

  /* ---------- Customer debt ---------- */

  function openDebtCheckout() {
    const totals = T.cartTotals();
    if (!totals.lines.length) { T.toast("There is nothing to sell", "i-alert"); return; }
    const count = T.itemCount();
    const defaultDue = T.debtDefaultDueDate(7);
    let matched = null;
    open({
      title: "Add to debt",
      subtitle: "Customer takes goods now, pays later.",
      iconName: "i-user",
      tone: "warn",
      focus: "#debt-customer-name",
      body: `<form id="debt-form" novalidate>
        <div class="debt-sale-summary">
          <span class="debt-sale-icon">${icon("i-user")}</span>
          <div class="debt-sale-copy">
            <strong>${money(totals.total)} on credit</strong>
            <small>${count} ${count === 1 ? "item" : "items"} added to this customer's debt.</small>
          </div>
        </div>
        <div class="field">
          <label for="debt-customer-name">Customer name</label>
          <input class="input" id="debt-customer-name" name="name" placeholder="e.g. Mary Wanjiku" maxlength="80" autocomplete="name" required>
        </div>
        <div class="field">
          <label for="debt-customer-phone">Phone number</label>
          <input class="input" id="debt-customer-phone" name="phone" type="tel" placeholder="+254 700 000 000" maxlength="40" inputmode="tel" autocomplete="tel" required>
          <p class="field-help" id="debt-customer-hint">New customer — a debt account will be created.</p>
        </div>
        <div class="field">
          <label for="debt-due-date">Payment date</label>
          <input class="input" id="debt-due-date" name="dueDate" type="date" value="${defaultDue}" min="${T.isoDay()}">
          <p class="field-help">When the customer should settle this debt.</p>
        </div>
        <div class="field">
          <label for="debt-note">Note <span class="field-optional">Optional</span></label>
          <input class="input" id="debt-note" name="note" placeholder="e.g. Paid next Friday" maxlength="120">
        </div>
        <div class="form-error" role="alert"></div>
        <div class="sheet-actions">
          <button class="btn btn-primary btn-block" type="submit">Add to debt ${icon("i-check")}</button>
        </div>
      </form>`
    });
    const form = document.getElementById("debt-form");
    const nameInput = form?.querySelector('[name="name"]');
    const phoneInput = form?.querySelector('[name="phone"]');
    const hint = document.getElementById("debt-customer-hint");
    const updateHint = () => {
      const phone = phoneInput?.value || "";
      const match = T.findCustomerByPhone(phone);
      if (match) {
        matched = match;
        if (hint) {
          const summary = T.customerSummary(match);
          hint.textContent = `Existing customer: ${match.name} · ${money(summary.balance >= 0 ? summary.balance : -summary.balance)} ${summary.balance >= 0 ? "owed" : "credit"}`;
          hint.classList.add("is-existing");
        }
        if (nameInput && !nameInput.value.trim()) nameInput.value = match.name;
      } else {
        matched = null;
        if (hint) {
          hint.textContent = "New customer — a debt account will be created.";
          hint.classList.remove("is-existing");
        }
      }
    };
    phoneInput?.addEventListener("input", updateHint);
    phoneInput?.addEventListener("blur", updateHint);

    form?.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const name = String(data.get("name") || "").trim();
      const phone = String(data.get("phone") || "").trim();
      const dueDate = String(data.get("dueDate") || "").trim();
      const note = String(data.get("note") || "").trim();
      if (!name) { setFormError(form, "Give the customer a name."); return; }
      if (!phone || phone.replace(/\D/g, "").length < 7) { setFormError(form, "Enter a valid phone number."); return; }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) { setFormError(form, "Choose a payment date."); return; }
      const tx = T.completeSale({ method: "debt", customerName: name, customerPhone: phone, customerId: matched?.id || null, dueDate, note });
      if (!tx) { setFormError(form, "Could not add this sale to debt."); return; }
      close(true);
      T.toast(`Added to ${name}'s debt`, "i-check");
      T.ui.justPaidId = tx.id;
      if (T.go) T.go(`#/receipt/${tx.id}`, { user: false, reset: true }); else { location.hash = `#/receipt/${tx.id}`; window.render?.(); }
    });
  }

  function openCustomerPayment(id) {
    const customer = T.findCustomer(id);
    if (!customer) return;
    const summary = T.customerSummary(customer);
    const mpesaApi = T.mpesa;
    const cfg = T.mpesaConfig();
    const ready = mpesaApi
      ? mpesaApi.readiness(cfg)
      : { ok: false, reason: "unavailable", message: "M-Pesa is not available on this device." };
    // The account number on a Paybill statement: the shop default, or the
    // customer's number so the payment is easy to trace back.
    const phoneGuess = mpesaApi?.normalizePhone(customer.phone);
    const suggestedAccount = (cfg.account || (phoneGuess?.ok ? phoneGuess.phone : "")).slice(0, 12);
    let method = "cash";
    let busy = false;

    open({
      title: "Record payment",
      subtitle: `Paying ${customer.name}`,
      iconName: "i-cash",
      focus: "#customer-payment-amount",
      onClose: () => { if (busy) T.mpesa?.cancel?.(); },
      body: `<form id="customer-payment-form" novalidate>
        <div class="supplier-pay-target">
          <span class="debt-avatar" aria-hidden="true">${esc(T.initials(customer.name))}</span>
          <div class="supplier-pay-target-copy"><strong>${esc(customer.name)}</strong><small>${money(summary.balance >= 0 ? summary.balance : -summary.balance)} ${summary.balance >= 0 ? "owed" : "credit"}</small></div>
        </div>
        <div class="field">
          <label for="customer-payment-amount">Amount paid</label>
          <div class="input-affix"><input class="input" id="customer-payment-amount" name="amount" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0.00" required><span class="affix">${esc(T.currencySymbol())}</span></div>
        </div>
        <div class="field">
          <label>Payment method</label>
          <div class="pay-method-picker" id="customer-pay-method">
            <button type="button" class="pay-method is-active" data-method="cash" aria-pressed="true">${icon("i-cash")} Cash</button>
            <button type="button" class="pay-method" data-method="mpesa" aria-pressed="false">${icon("i-phone")} M-Pesa</button>
          </div>
        </div>
        <div id="customer-mpesa-fields" class="customer-mpesa-fields" hidden>
          <div class="field">
            <label for="customer-payment-phone">Customer's M-Pesa number</label>
            <input class="input" id="customer-payment-phone" name="mpesaPhone" type="tel" inputmode="tel" autocomplete="tel"
                   placeholder="0712 345 678" value="${esc(customer.phone || "")}">
            <p class="field-small">The customer gets a PIN prompt on this number.</p>
          </div>
          ${cfg.mode === "paybill" ? `<div class="field">
            <label for="customer-payment-account">Account number</label>
            <input class="input" id="customer-payment-account" name="mpesaAccount" autocomplete="off" maxlength="12"
                   placeholder="e.g. customer number" value="${esc(suggestedAccount)}">
            <p class="field-small">This is what appears on your M-Pesa statement for this payment.</p>
          </div>` : ""}
          ${ready.ok ? "" : `<div class="mpesa-alert is-setup">${icon("i-info", "ico ico-sm")}<span>${esc(ready.message)}</span></div>
            <button type="button" class="btn btn-ghost btn-block" id="customer-mpesa-settings">Open store settings</button>`}
          <div class="mpesa-inline-wait" id="customer-mpesa-wait" hidden aria-live="polite">
            <span class="mpesa-wait-mark"><span class="spinner"></span></span>
            <div class="mpesa-inline-wait-copy">
              <strong id="customer-mpesa-wait-title">Sending the request…</strong>
              <small id="customer-mpesa-wait-text">Talking to Safaricom.</small>
            </div>
            <button type="button" class="btn btn-ghost btn-sm" id="customer-mpesa-cancel">Cancel</button>
          </div>
        </div>
        <div class="field">
          <label for="customer-payment-date">Date</label>
          <input class="input" id="customer-payment-date" name="date" type="date" value="${T.isoDay()}">
        </div>
        <div class="field">
          <label for="customer-payment-note">Reference or note <span class="field-optional">Optional</span></label>
          <input class="input" id="customer-payment-note" name="note" placeholder="e.g. M-Pesa code QGH7X8Y2Z1" maxlength="120">
        </div>
        <div class="form-error" role="alert"></div>
        <div class="sheet-actions">
          <button class="btn btn-primary btn-block" type="submit" id="customer-payment-submit">Record payment ${icon("i-check")}</button>
        </div>
      </form>`
    });

    const form = document.getElementById("customer-payment-form");
    const mpesaFields = document.getElementById("customer-mpesa-fields");
    const waitEl = document.getElementById("customer-mpesa-wait");
    const waitTitle = document.getElementById("customer-mpesa-wait-title");
    const waitText = document.getElementById("customer-mpesa-wait-text");
    const submit = document.getElementById("customer-payment-submit");

    function setWaiting(active, title = "", text = "") {
      busy = active;
      if (waitEl) waitEl.hidden = !active;
      if (waitTitle && title) waitTitle.textContent = title;
      if (waitText && text) waitText.textContent = text;
      form?.querySelectorAll("input").forEach((input) => { input.disabled = active; });
      document.querySelectorAll("#customer-pay-method .pay-method").forEach((button) => { button.disabled = active; });
      if (submit) submit.disabled = active;
    }

    function refreshMethod() {
      const isMpesa = method === "mpesa";
      if (mpesaFields) mpesaFields.hidden = !isMpesa;
      if (submit) {
        submit.innerHTML = isMpesa
          ? `${icon("i-phone")} Send M-Pesa request`
          : `Record payment ${icon("i-check")}`;
        submit.disabled = busy || (isMpesa && !ready.ok);
      }
    }

    document.querySelectorAll("#customer-pay-method .pay-method").forEach((button) => {
      button.addEventListener("click", () => {
        method = button.dataset.method === "mpesa" ? "mpesa" : "cash";
        document.querySelectorAll("#customer-pay-method .pay-method").forEach((item) => {
          const active = item.dataset.method === method;
          item.classList.toggle("is-active", active);
          item.setAttribute("aria-pressed", String(active));
        });
        refreshMethod();
      });
    });
    refreshMethod();

    document.getElementById("customer-mpesa-settings")?.addEventListener("click", () => {
      close(true);
      window.Till.go?.("#/store");
    });

    document.getElementById("customer-mpesa-cancel")?.addEventListener("click", () => {
      T.mpesa?.cancel?.();
      setWaiting(false);
      setFormError(form, "");
    });

    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (busy) return;
      const data = new FormData(form);
      const amount = T.parsePriceToCents(data.get("amount"));
      if (!Number.isFinite(amount) || amount <= 0) {
        setFormError(form, "Enter an amount greater than zero.");
        return;
      }
      const date = /^\d{4}-\d{2}-\d{2}$/.test(String(data.get("date") || "")) ? String(data.get("date")) : T.isoDay();
      const typedNote = String(data.get("note") || "").trim();

      if (method === "mpesa") {
        if (!mpesaApi) { setFormError(form, "M-Pesa is not available on this device."); return; }
        if (!ready.ok) { setFormError(form, ready.message); return; }
        const phone = String(data.get("mpesaPhone") || customer.phone || "").trim();
        const check = mpesaApi.normalizePhone(phone);
        if (!check.ok) { setFormError(form, check.error); return; }
        const accountRef = String(data.get("mpesaAccount") || "").trim().slice(0, 12) || check.phone.slice(0, 12);

        setFormError(form, "");
        setWaiting(true, "Sending the request…", "Talking to Safaricom.");
        const result = await mpesaApi.collect({
          phone: check.phone,
          amountCents: amount,
          accountRef,
          description: `Debt ${customer.name}`.slice(0, 13),
          onStage: (stage) => {
            if (stage.stage !== "waiting") return;
            setWaiting(
              true,
              "Waiting for the customer",
              `Prompt sent to ${mpesaApi.formatPhone(stage.phone)}. Ask them to enter their M-Pesa PIN.`
            );
          }
        });

        if (result.stage === "cancelled") { setWaiting(false); return; }
        if (!result.ok) {
          setWaiting(false);
          setFormError(form, result.message || "The payment was not completed.");
          return;
        }
        const reference = result.reference || "";
        const checkoutId = result.checkoutId || "";
        const charged = Number(result.amountCents) > 0 ? Number(result.amountCents) : amount;
        const mpesaNote = reference ? `M-Pesa ${reference}` : checkoutId ? `M-Pesa request ${checkoutId}` : "M-Pesa";
        const entry = T.recordCustomerPayment(customer.id, {
          amount: charged,
          method: "mpesa",
          date,
          note: typedNote ? `${typedNote} · ${mpesaNote}` : mpesaNote,
          reference,
          checkoutId,
          accountRef
        });
        if (!entry) { setWaiting(false); setFormError(form, "Could not record this payment."); return; }
        setWaiting(false);
        close(true);
        T.toast(`M-Pesa payment received · ${money(charged)}`, "i-check");
        window.render?.();
        return;
      }

      const entry = T.recordCustomerPayment(customer.id, { amount, method, date, note: typedNote });
      if (!entry) { setFormError(form, "Could not record this payment."); return; }
      close(true);
      T.toast(`Cash payment recorded · ${money(amount)}`, "i-check");
      window.render?.();
    });
  }

  function openDebtReminder() {
    const due = T.debtReminders();
    if (!due.length) return false;
    T.markDebtReminderSeen();
    const total = due.reduce((sum, { summary }) => sum + summary.balance, 0);
    open({
      title: "Payments due",
      subtitle: `${due.length} ${due.length === 1 ? "customer has" : "customers have"} a payment date today or overdue.`,
      iconName: "i-alert",
      tone: "warn",
      body: `<p class="confirm-copy">${money(total)} outstanding from ${due.length} ${due.length === 1 ? "customer" : "customers"}.</p>
        <div class="debt-reminder-list">
          ${due.slice(0, 5).map(({ customer, summary }) => {
            const info = T.debtDueInfo(summary.nextDue);
            return `<button class="debt-reminder-row" data-act="view-debt" data-id="${esc(customer.id)}">
              <span class="debt-reminder-icon">${icon("i-clock")}</span>
              <span class="debt-reminder-copy">
                <strong>${esc(customer.name)}</strong>
                <small>${esc(info.label)}${customer.phone ? ` · ${esc(customer.phone)}` : ""}</small>
              </span>
              <span class="debt-reminder-amount">${money(summary.balance)}</span>
            </button>`;
          }).join("")}
          ${due.length > 5 ? `<p class="field-help" style="text-align:center;">And ${due.length - 5} more customers.</p>` : ""}
        </div>
        <div class="sheet-actions">
          <button class="btn btn-primary btn-block" data-act="view-debt">View debt ${icon("i-arrow")}</button>
          <button class="btn btn-ghost btn-block" data-act="close-sheet">Remind me later</button>
        </div>`
    });
    return true;
  }

  /* ---------- Closing the app ---------- */

  function openExitPrompt() {
    if (T.ui.exitPromptOpen) return;
    T.ui.exitPromptOpen = true;
    open({
      title: "Close Biller POS?",
      subtitle: "Your stock and orders are saved on this device.",
      iconName: "i-alert",
      tone: "warn",
      onClose: () => { T.ui.exitPromptOpen = false; },
      body: `<p class="confirm-copy">You are on the Sell screen, the home of the app. Close to leave Biller POS, or keep selling to stay.</p>
        <div class="sheet-actions pair">
          <button class="btn btn-quiet" data-act="close-sheet">Keep selling</button>
          <button class="btn btn-danger" data-act="exit-app">Close app</button>
        </div>`
    });
  }

  /* ---------- Stock in and prices ---------- */

  /**
   * Receive stock: how many arrived, what each one cost, and what it sells
   * for. The buying price is what the profit is worked out from.
   */
  function openStockIn(id) {
    const product = T.findProduct(id);
    if (!product) return;
    const unit = product.unit || "pcs";
    const mass = product.soldByMass === true;
    const costValue = product.cost ? (product.cost / 100).toFixed(2) : "";
    const priceValue = product.price ? (product.price / 100).toFixed(2) : "";
    open({
      title: mass ? "Add weight" : "Add stock",
      subtitle: `${product.name}${product.detail ? ` · ${product.detail}` : ""}`,
      iconName: "i-box",
      focus: "#stock-in-qty",
      body: `<form id="stock-in-form" novalidate>
        <div class="supplier-pay-target">
          <span class="supplier-avatar" aria-hidden="true">${esc(T.initials(product.name))}</span>
          <div class="supplier-pay-target-copy"><strong>${esc(product.name)}</strong><small>${mass ? esc(T.massLabel(product.stock)) : `${product.stock} ${esc(unit)}`} in stock now</small></div>
        </div>
        <div class="field">
          <label for="stock-in-qty">${mass ? "How many kilograms did you receive?" : "How many did you receive?"}</label>
          <input class="input" id="stock-in-qty" name="qty" type="number" min="${mass ? "0.001" : "1"}" step="${mass ? "0.001" : "1"}" inputmode="${mass ? "decimal" : "numeric"}" value="${mass ? "1" : "1"}" required>
          <div class="variant-chips" role="group" aria-label="Common quantities">
            ${mass
              ? [0.5, 1, 5, 10, 25].map((n) => `<button type="button" class="variant-chip" data-qty="${n}">+${n} kg</button>`).join("")
              : [1, 6, 12, 24, 50].map((n) => `<button type="button" class="variant-chip" data-qty="${n}">+${n}</button>`).join("")}
          </div>
        </div>
        <div class="field-row">
          <div class="field">
            <label for="stock-in-cost">Buying price</label>
            <div class="input-affix"><input class="input" id="stock-in-cost" name="cost" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(costValue)}" placeholder="0.00"><span class="affix">${esc(T.currencySymbol())}</span></div>
            <p class="field-help">What you pay for each one.</p>
          </div>
          <div class="field">
            <label for="stock-in-price">Selling price</label>
            <div class="input-affix"><input class="input" id="stock-in-price" name="price" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(priceValue)}" placeholder="0.00" required><span class="affix">${esc(T.currencySymbol())}</span></div>
            <p class="field-help">What the customer pays.</p>
          </div>
        </div>
        <div class="field">
          <label for="stock-in-note">Note <span class="field-optional">Optional</span></label>
          <input class="input" id="stock-in-note" name="note" placeholder="e.g. Delivery from Nairobi Wholesalers" maxlength="120">
        </div>
        ${(T.state.suppliers || []).length ? `<div class="field">
          <label for="stock-in-supplier">Supplier <span class="field-optional">Optional</span></label>
          <select class="input" id="stock-in-supplier" name="supplier">
            <option value="">No supplier bill</option>
            ${(T.state.suppliers || []).map((supplier) => `<option value="${esc(supplier.id)}">${esc(supplier.name)}</option>`).join("")}
          </select>
          <p class="field-help">Pick a supplier only if you are taking this stock on credit. The buying cost is added to what you owe them.</p>
        </div>` : ""}
        <div class="form-error" role="alert"></div>
        <div class="sheet-actions">
          <button class="btn btn-primary btn-block" type="submit">Add to stock ${icon("i-check")}</button>
        </div>
      </form>`
    });

    const form = document.getElementById("stock-in-form");
    form?.querySelectorAll("[data-qty]").forEach((chip) => {
      chip.addEventListener("click", () => {
        const input = form.querySelector("#stock-in-qty");
        if (!input) return;
        input.value = Number(chip.dataset.qty) || 1;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    });

    form?.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(form);
      // Weighed deliveries are typed in kilograms and stored in grams.
      const rawQty = Number(data.get("qty"));
      const qty = mass
        ? Math.max(0, Math.min(1000000, Math.round((Number.isFinite(rawQty) ? rawQty : 0) * 1000)))
        : T.clampInt(data.get("qty"), 0, 1000000);
      if (qty <= 0) {
        setFormError(form, mass ? "Enter how much you received." : "Enter how many you received.");
        return;
      }
      const price = T.parsePriceToCents(data.get("price"));
      if (!Number.isFinite(price) || price <= 0) {
        setFormError(form, "Enter the price you sell it for.");
        return;
      }
      const costRaw = String(data.get("cost") || "").trim();
      const cost = costRaw === "" ? null : T.parsePriceToCents(costRaw);
      const supplierId = String(data.get("supplier") || "");
      if (supplierId && (!Number.isFinite(cost) || cost <= 0)) {
        setFormError(form, "Enter the buying price to record a supplier bill, or choose No supplier bill.");
        return;
      }
      // The bill is the price per kilogram times the kilograms received.
      const billAmount = mass ? Math.round(cost * qty / 1000) : cost * qty;
      const result = T.receiveStock(id, { qty, cost: Number.isFinite(cost) ? cost : null, price });
      if (!result.ok) {
        setFormError(form, result.error || "Could not add that stock.");
        return;
      }
      const note = String(data.get("note") || "").trim();
      const supplier = T.findSupplier(supplierId);
      if (supplier && Number.isFinite(cost) && cost > 0) {
        // Only a supplier the shopkeeper picked gets a bill. Guessing the
        // first supplier silently corrupted somebody else's account.
        supplier.ledger = supplier.ledger || [];
        supplier.ledger.unshift({
          id: T.uid("se"),
          type: "bill",
          method: null,
          amount: billAmount,
          note: note || `Stock: ${product.name}`,
          items: [{ productId: product.id, name: product.name, unit, qty, cost }],
          date: T.isoDay(),
          createdAt: new Date().toISOString()
        });
        T.save();
      }
      close(true);
      T.toast(`${mass ? T.massLabel(qty) : `${qty} ${unit}`} added to stock`, "i-check");
      window.render?.();
    });
  }

  /* ---------- M-Pesa code on a receipt ---------- */

  function openMpesaCode(txId) {
    const tx = T.state.transactions.find((entry) => entry.id === txId);
    if (!tx || tx.payment?.method !== "mpesa") return;
    open({
      title: "Add M-Pesa code",
      subtitle: "The code in the customer's M-Pesa confirmation SMS.",
      iconName: "i-phone",
      focus: "#mpesa-code",
      body: `<form class="manual-form" id="mpesa-code-form" novalidate>
        <input class="input" id="mpesa-code" name="code" autocomplete="off" autocapitalize="characters"
          spellcheck="false" placeholder="e.g. QK12345678" maxlength="20"
          value="${esc(tx.payment.reference || "")}">
        <div class="form-error" role="alert"></div>
        <button class="btn btn-primary btn-block" type="submit">Save code ${icon("i-arrow")}</button>
      </form>
      <p class="manual-hint">Optional. This lets you match the sale to your M-Pesa statement later.</p>`
    });

    const form = document.getElementById("mpesa-code-form");
    form?.addEventListener("submit", (event) => {
      event.preventDefault();
      const code = String(new FormData(form).get("code") || "").trim().toUpperCase().replace(/\s+/g, "");
      if (!/^[A-Z0-9]{6,20}$/.test(code)) {
        setFormError(form, "Enter the code from the M-Pesa message.");
        return;
      }
      tx.payment.reference = code;
      T.save();
      close(true);
      window.render?.();
      T.toast("M-Pesa code saved", "i-check");
    });
  }

  /* ---------- Sort options for the Sell screen ---------- */

  function openSellSort() {
    const current = T.sellSort?.() || "new";
    const options = [
      { id: "new", label: "Newest first", hint: "Recently added items on top" },
      { id: "az", label: "A to Z", hint: "Item names in alphabetical order" },
      { id: "za", label: "Z to A", hint: "Item names in reverse order" }
    ];
    open({
      title: "Sort items",
      subtitle: "How the items are ordered on the Sell screen.",
      iconName: "i-sort",
      body: `<div class="sort-options">
        ${options.map((option) => `<button class="sort-option ${current === option.id ? "is-active" : ""}" data-act="set-sell-sort" data-value="${option.id}" aria-pressed="${current === option.id}">
          <span class="sort-option-copy"><strong>${option.label}</strong><small>${option.hint}</small></span>
          ${current === option.id ? `<span class="sort-option-check">${icon("i-check")}</span>` : ""}
        </button>`).join("")}
      </div>`
    });
  }

  /**
   * Collect the monthly plan. When the developer has a Till or Paybill
   * configured, the shop pays with an M-Pesa prompt like any other sale.
   * Without one - which is now - the sheet walks the shop through sending the
   * money straight to the developer's M-Pesa number, adding the shop code, and
   * then marking the payment as sent for the developer to confirm.
   */
  function openSubscriptionPayment() {
    const T = window.Till;
    let busy = false;
    const sub = T.subscription();
    const plan = T.planSummary();
    const fee = T.feeConfig();
    const amount = plan.amountCents;
    const amountText = T.money(amount);
    const reference = sub.reference || T.subscriptionReference();

    if (!T.feeReady()) {
      const code = T.shopCode();
      const mpesaCode = String(document.getElementById("subscription-mpesa-code")?.value || "").trim().toUpperCase();
      open({
        title: "Pay the monthly plan",
        subtitle: amountText + " per month",
        iconName: "i-card",
        body: `<div class="plan-amount"><strong>${esc(amountText)}</strong><small>per month</small></div>
          <p>Send <strong>${esc(amountText)}</strong> to the developer to activate <strong>${esc(T.state.store?.name || "your till")}</strong>. Selling stays paused until the payment is confirmed.</p>
          <div class="plan-steps">
            <div class="plan-step"><span class="plan-step-num">1</span><span class="plan-step-copy"><strong>Send the money</strong><small>Open M-Pesa on the shop's phone and send ${esc(amountText)} to the number below.</small></span></div>
            <div class="plan-step"><span class="plan-step-num">2</span><span class="plan-step-copy"><strong>Add your shop code</strong><small>Put <strong>${esc(code)}</strong> in the payment message so we know which shop paid.</small></span></div>
            <div class="plan-step"><span class="plan-step-num">3</span><span class="plan-step-copy"><strong>Tell us it arrived</strong><small>Tap the button and the developer checks the payment. That is usually minutes.</small></span></div>
          </div>
          ${fee.mpesaNumber ? `<div class="data-row" style="margin-top:12px"><span class="data-icon">${icon("i-phone")}</span><span class="data-copy"><strong>M-Pesa number</strong><small>${esc(fee.mpesaNumber)}</small></span></div>
            <button class="btn btn-ghost btn-block" data-act="copy-value" data-value="${esc(fee.mpesaNumber)}" style="margin-top:8px">${icon("i-copy")} Copy the M-Pesa number</button>` : ""}
          ${fee.bank.number ? `<div class="data-row" style="margin-top:8px"><span class="data-icon">${icon("i-store")}</span><span class="data-copy"><strong>Bank transfer</strong><small>${esc(fee.bank.bank)}${fee.bank.name ? " · " + esc(fee.bank.name) : ""} · ${esc(fee.bank.number)}</small></span></div>` : ""}
          <div class="plan-code-box">
            <span>Your shop code</span>
            <strong>${esc(code)}</strong>
            <small>Put this in the payment message so we know which shop it is.</small>
            <button class="btn btn-ghost btn-block" data-act="copy-shop-code" data-code="${esc(code)}" style="margin-top:10px">${icon("i-copy")} Copy the shop code</button>
          </div>
          <div class="field" style="margin-top:14px">
            <label for="subscription-mpesa-code">M-Pesa transaction code</label>
            <input class="input" id="subscription-mpesa-code" name="mpesaCode" inputmode="text" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="20" placeholder="e.g. QK12345678">
            <p class="field-small">From the confirmation SMS. Optional, but it helps the developer confirm faster.</p>
          </div>
          <p class="field-small" style="margin-top:12px">Activation usually takes up to 5 minutes. If it takes longer, call us and we will switch you on straight away.</p>
          <div class="sheet-actions">
            <button class="btn btn-primary btn-block" data-act="subscription-sent" data-ref="${esc(reference)}">${icon("i-check")} I have sent the payment</button>
            ${fee.mpesaNumber ? `<a class="btn btn-ghost btn-block" href="tel:${esc(fee.mpesaNumber.replace(/[^0-9+]/g, ""))}">${icon("i-phone")} Call the developer</a>` : ""}
            <button class="btn btn-ghost" data-act="open-developer-chat" data-code="${esc(code)}" data-amount="${esc(String(amount))}" data-mpesa="${esc(mpesaCode)}">${icon("i-chat")} Tell the developer</button>
            <button class="btn btn-ghost" data-act="close-sheet">${icon("i-close")} Not now</button>
          </div>`
      });
      return;
    }

    const mpesaApi = T.mpesa;
    open({
      title: "Pay the monthly plan",
      subtitle: amountText + " per month",
      iconName: "i-phone",
      body: `<form id="subscription-pay-form" novalidate>
        <div class="field">
          <label for="subscription-phone">M-Pesa number to charge</label>
          <input class="input" id="subscription-phone" name="phone" inputmode="tel" autocomplete="off" placeholder="07xx xxx xxx" value="${esc(T.state.store?.phone || "")}">
          <p class="field-small">The prompt lands on this number. It should be the one the shop uses for M-Pesa.</p>
        </div>
        <div class="mpesa-inline-wait" id="subscription-mpesa-wait" hidden aria-live="polite">
          <span class="mpesa-wait-mark"><span class="spinner"></span></span>
          <div><strong id="subscription-mpesa-wait-title">Sending the request.</strong><small id="subscription-mpesa-wait-text">Talking to Safaricom.</small></div>
        </div>
        <div class="form-error" role="alert"></div>
        <div class="sheet-actions">
          <button class="btn btn-primary btn-block" type="submit" id="subscription-pay-submit">${icon("i-phone")} Send M-Pesa request</button>
          <button class="btn btn-ghost" data-act="close-sheet">Not now</button>
        </div>
      </form>`
    });

    const form = document.getElementById("subscription-pay-form");
    const waitEl = document.getElementById("subscription-mpesa-wait");
    const waitTitle = document.getElementById("subscription-mpesa-wait-title");
    const waitText = document.getElementById("subscription-mpesa-wait-text");
    const submit = document.getElementById("subscription-pay-submit");

    const setWaiting = (active, title = "", text = "") => {
      busy = active;
      if (waitEl) waitEl.hidden = !active;
      if (waitTitle && title) waitTitle.textContent = title;
      if (waitText && text) waitText.textContent = text;
      form?.querySelectorAll("input").forEach((input) => { input.disabled = active; });
      if (submit) submit.disabled = active;
    };

    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (busy || !mpesaApi) return;
      const data = new FormData(form);
      const phone = String(data.get("phone") || "").trim();
      const check = mpesaApi.normalizePhone(phone);
      if (!check.ok) { setFormError(form, check.error); return; }
      setFormError(form, "");
      setWaiting(true, "Sending the request…", "Talking to Safaricom.");
      const result = await mpesaApi.collect({
        phone: check.phone,
        amountCents: amount,
        accountRef: reference.slice(0, 12),
        description: String(plan.label || "Plan").slice(0, 13),
        cfg: {
          paybill: fee.mode === "paybill" ? fee.shortcode : "",
          till: fee.mode === "till" ? fee.shortcode : "",
          mode: fee.mode,
          shortcode: fee.shortcode,
          account: fee.account,
          environment: fee.environment,
          consumerKey: fee.consumerKey,
          consumerSecret: fee.consumerSecret,
          passkey: fee.passkey,
          backend: fee.backend,
          backendKey: fee.backendKey
        },
        onStage: (stage) => {
          if (stage.stage === "waiting") setWaiting(true, "Waiting for approval.", "The customer must enter their PIN on the phone.");
        }
      });
      if (!result.ok) {
        setWaiting(false);
        setFormError(form, result.message || "The payment could not be sent.");
        return;
      }
      T.markSubscriptionPaid({ method: "mpesa", reference: result.reference || result.checkoutId || "" });
      close(true);
      T.toast("Monthly plan paid. Thank you.", "i-check");
      window.render?.();
    });
  }

  /* ---------- Weigh a product ---------- */

  /**
   * The scale for weighed products: the shop taps or types what the
   * customer is taking, sees the price it comes to, and the weight goes
   * into the sale. Also used to reweigh a line that is already in the cart.
   */
  function openWeigh(product, { fromScan = false, fromEditor = false, editLine = false } = {}) {
    if (!product || product.soldByMass !== true) return;
    const existing = T.state.cart.items.find((item) => item.productId === product.id);
    const editing = editLine && existing;
    const currentGrams = editing ? existing.qty : 1000;
    const pricePerKg = product.price;
    open({
      title: editing ? "Reweigh" : "Weigh",
      subtitle: product.name + (product.detail ? ` · ${product.detail}` : ""),
      iconName: "i-scale",
      focus: "#weigh-kg",
      onClose: null,
      body: `<div class="supplier-pay-target">
          <span class="supplier-avatar" aria-hidden="true">${esc(T.initials(product.name))}</span>
          <div class="supplier-pay-target-copy"><strong>${esc(product.name)}</strong><small>${esc(T.massLabel(product.stock))} in stock · ${esc(T.money(pricePerKg))} per kg</small></div>
        </div>
        <form id="weigh-form" novalidate>
          <div class="field">
            <label for="weigh-kg">Weight (kg)</label>
            <input class="input weigh-input" id="weigh-kg" name="kg" type="number" min="0.001" step="0.001" inputmode="decimal" value="${(currentGrams / 1000).toFixed(3).replace(/\.?0+$/, "")}" required>
            <div class="variant-chips" role="group" aria-label="Common weights">
              ${[[100, "100 g"], [250, "250 g"], [500, "500 g"], [1000, "1 kg"], [2000, "2 kg"]].map(([g, label]) => `<button type="button" class="variant-chip" data-grams="${g}">${label}</button>`).join("")}
            </div>
          </div>
          <div class="weigh-total">
            <span class="weigh-total-label">Comes to</span>
            <strong class="weigh-total-amount" id="weigh-total">${esc(T.money(Math.round(pricePerKg * currentGrams / 1000)))}</strong>
            <small class="weigh-total-note" id="weigh-note">${esc(T.massLabel(currentGrams))} × ${esc(T.money(pricePerKg))}/kg</small>
          </div>
          <div class="form-error" role="alert"></div>
          <div class="sheet-actions">
            <button class="btn btn-primary btn-block" type="submit">${editing ? "Update the weight" : "Add to the sale"} ${icon("i-check")}</button>
          </div>
        </form>`
    });

    const form = document.getElementById("weigh-form");
    const input = form?.querySelector("#weigh-kg");
    const totalEl = document.getElementById("weigh-total");
    const noteEl = document.getElementById("weigh-note");

    const gramsFromInput = () => {
      const kg = Number(input?.value);
      return Number.isFinite(kg) ? Math.round(kg * 1000) : 0;
    };

    const paintTotal = () => {
      const grams = gramsFromInput();
      if (totalEl) totalEl.textContent = T.money(Math.round(pricePerKg * grams / 1000));
      if (noteEl) noteEl.textContent = `${T.massLabel(grams)} × ${T.money(pricePerKg)}/kg`;
    };
    input?.addEventListener("input", paintTotal);
    paintTotal();

    form?.querySelectorAll("[data-grams]").forEach((chip) => {
      chip.addEventListener("click", () => {
        if (!input) return;
        const grams = Number(chip.dataset.grams) || 1000;
        input.value = (grams / 1000).toFixed(3).replace(/\.?0+$/, "");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    });

    form?.addEventListener("submit", (event) => {
      event.preventDefault();
      const grams = gramsFromInput();
      if (grams <= 0) {
        setFormError(form, "Enter the weight on the scale.");
        return;
      }
      if (grams > product.stock) {
        setFormError(form, `Only ${T.massLabel(product.stock)} in stock.`);
        return;
      }
      if (editing) {
        existing.qty = grams;
        T.save();
        close(true);
        T.toast(`${product.name}: ${T.massLabel(grams)}`, "i-check");
        window.render?.();
        return;
      }
      if (fromEditor) {
        // Straight after adding the product, the cart is not rendered yet.
        T.state.cart.items.push({ productId: product.id, qty: grams });
        T.save();
        close(true);
        T.toast(`${product.name}: ${T.massLabel(grams)} added`, "i-check");
        window.render?.();
        return;
      }
      if (T.addToCart(product, grams)) {
        T.confirmAdded(product, grams);
        close(true);
        if (fromScan) T.scanner?.resume?.();
        window.render?.();
      }
    });
  }

  /* ---------- Wastage ---------- */

  /**
   * Record stock that left the shelf without a sale and show what has
   * already been written off lately.
   */
  function openWastage() {
    const products = [...T.state.products].sort((a, b) => a.name.localeCompare(b.name));
    const recent = (T.state.wastage || []).slice(0, 6);
    const defaultEmployee = String(T.state.store?.staff || T.getSession?.()?.email?.split("@")[0] || "").trim();
    const reasons = T.WASTAGE_REASONS || ["Spoiled", "Damaged", "Expired", "Spilled", "Missing", "Other"];
    open({
      title: "Record wastage",
      subtitle: "Stock that spoiled, broke or went missing",
      iconName: "i-alert",
      focus: products.length ? "#wastage-product" : "",
      body: `${products.length ? `<form id="wastage-form" novalidate>
        <div class="field">
          <label for="wastage-product">Product</label>
          <select class="select" id="wastage-product" name="productId">
            ${products.map((product) => `<option value="${esc(product.id)}">${esc(product.name)}${product.detail ? ` · ${esc(product.detail)}` : ""}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label for="wastage-qty" id="wastage-qty-label">How many were wasted?</label>
          <input class="input" id="wastage-qty" name="qty" type="number" min="1" step="1" inputmode="numeric" value="1" required>
          <div class="variant-chips" id="wastage-chips" role="group" aria-label="Common quantities"></div>
        </div>
        <div class="field">
          <label>Why</label>
          <div class="chip-row" id="wastage-reasons" role="group" aria-label="Reason for the wastage">
            ${reasons.map((reason) => `<button type="button" class="chip ${reason === reasons[0] ? "is-active" : ""}" data-reason="${esc(reason)}">${esc(reason)}</button>`).join("")}
          </div>
        </div>
        <div class="field">
          <label for="wastage-employee">Recorded by <span class="field-optional">Optional</span></label>
          <input class="input" id="wastage-employee" name="employee" value="${esc(defaultEmployee)}" placeholder="Who is writing this off?" maxlength="60">
        </div>
        <div class="field">
          <label for="wastage-note">Note <span class="field-optional">Optional</span></label>
          <input class="input" id="wastage-note" name="note" placeholder="e.g. Power cut spoiled the milk" maxlength="140">
        </div>
        <div class="form-error" role="alert"></div>
        <div class="sheet-actions">
          <button class="btn btn-primary btn-block" type="submit">${icon("i-check")} Record the wastage</button>
        </div>
      </form>` : `<div class="empty-state"><div class="empty-icon">${icon("i-box")}</div><h3>No products yet</h3><p>Add products to your inventory first, then wastage can be recorded against them.</p></div>`}
        ${recent.length ? `<div class="report-card-head" style="margin-top:16px"><h2>Latest wastage</h2></div>
        <div class="report-list">${recent.map((entry) => {
          const mass = entry.unit === "kg";
          const product = T.findProduct(entry.productId);
          const showQty = mass && product?.soldByMass ? T.massLabel(entry.qty) : `${entry.qty} ${esc(entry.unit)}`;
          return `<div class="report-row">
            <span class="report-row-copy"><strong>${esc(entry.name)}</strong><small>${esc(T.dayLabel(`${entry.date}T00:00:00`))} · ${esc(entry.reason)}${entry.employee ? ` · ${esc(entry.employee)}` : ""}${entry.note ? ` · ${esc(entry.note)}` : ""}</small></span>
            <span class="report-amount">${esc(showQty)}</span>
          </div>`;
        }).join("")}</div>` : ""}`
    });

    if (!products.length) return;
    const form = document.getElementById("wastage-form");
    const productSelect = form.querySelector("#wastage-product");
    const qtyInput = form.querySelector("#wastage-qty");
    const qtyLabel = form.querySelector("#wastage-qty-label");
    const chipsRow = form.querySelector("#wastage-chips");
    let reason = reasons[0];

    const paintProduct = () => {
      const product = T.findProduct(productSelect.value);
      const mass = product?.soldByMass === true;
      if (qtyLabel) qtyLabel.textContent = mass ? "How much was wasted (kg)?" : "How many were wasted?";
      if (qtyInput) {
        qtyInput.step = mass ? "0.001" : "1";
        qtyInput.min = mass ? "0.001" : "1";
        qtyInput.inputMode = mass ? "decimal" : "numeric";
        qtyInput.value = mass ? "0.5" : "1";
      }
      if (chipsRow) {
        chipsRow.innerHTML = mass
          ? [[100, "100 g"], [250, "250 g"], [500, "500 g"], [1000, "1 kg"]].map(([g, label]) => `<button type="button" class="variant-chip" data-grams="${g}">${label}</button>`).join("")
          : [1, 2, 6, 12].map((n) => `<button type="button" class="variant-chip" data-qty="${n}">${n}</button>`).join("");
      }
    };
    productSelect?.addEventListener("change", paintProduct);
    paintProduct();

    chipsRow?.addEventListener("click", (event) => {
      const chip = event.target.closest(".variant-chip");
      if (!chip || !qtyInput) return;
      if (chip.dataset.grams) {
        const grams = Number(chip.dataset.grams) || 1000;
        qtyInput.value = (grams / 1000).toFixed(3).replace(/\.?0+$/, "");
      } else {
        qtyInput.value = chip.dataset.qty;
      }
    });

    form.querySelector("#wastage-reasons")?.addEventListener("click", (event) => {
      const chip = event.target.closest(".chip");
      if (!chip) return;
      reason = chip.dataset.reason;
      form.querySelectorAll("#wastage-reasons .chip").forEach((btn) => btn.classList.toggle("is-active", btn === chip));
    });

    form?.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const product = T.findProduct(String(data.get("productId") || ""));
      const mass = product?.soldByMass === true;
      const rawQty = Number(data.get("qty"));
      const qty = mass
        ? Math.round((Number.isFinite(rawQty) ? rawQty : 0) * 1000)
        : T.clampInt(data.get("qty"), 0, 1000000);
      const result = T.recordWastage(product?.id, {
        qty,
        reason,
        note: String(data.get("note") || ""),
        employee: String(data.get("employee") || "")
      });
      if (!result.ok) {
        setFormError(form, result.error || "Could not record that.");
        return;
      }
      close(true);
      T.toast(mass ? `Wastage recorded: ${T.massLabel(qty)} of ${product.name}` : `Wastage recorded: ${qty} ${product.name}`, "i-check");
      window.render?.();
    });
  }

  /* ---------- Monthly sales target ---------- */

  /** The sheet where the shop sets what the month should make. */
  function openTarget() {
    const now = new Date();
    const current = T.state.store?.target || {};
    const amount = Number(current.amountCents) > 0 ? (current.amountCents / 100).toFixed(0) : "";
    const month = Number.isFinite(Number(current.month)) && Number(current.month) >= 1 ? Number(current.month) : now.getMonth() + 1;
    const year = Number.isFinite(Number(current.year)) && Number(current.year) >= 2020 ? Number(current.year) : now.getFullYear();
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    open({
      title: "Monthly sales target",
      subtitle: "A goal to chase this month",
      iconName: "i-chart",
      focus: "#target-amount",
      body: `<form id="target-form" novalidate>
        <div class="field">
          <label for="target-amount">Target amount</label>
          <div class="input-affix"><input class="input" id="target-amount" name="amount" type="number" min="0" step="1" inputmode="numeric" value="${esc(amount)}" placeholder="e.g. 60000"><span class="affix">${esc(T.currencySymbol())}</span></div>
          <p class="field-help">The total the shop wants to sell for the whole month.</p>
        </div>
        <div class="field-row">
          <div class="field">
            <label for="target-month">Month</label>
            <select class="select" id="target-month" name="month">
              ${monthNames.map((name, index) => `<option value="${index + 1}" ${month === index + 1 ? "selected" : ""}>${name}</option>`).join("")}
            </select>
          </div>
          <div class="field">
            <label for="target-year">Year</label>
            <input class="input" id="target-year" name="year" type="number" min="2020" max="2100" step="1" inputmode="numeric" value="${esc(year)}">
          </div>
        </div>
        <div class="form-error" role="alert"></div>
        <div class="sheet-actions">
          <button class="btn btn-primary btn-block" type="submit">${icon("i-check")} Save the target</button>
          ${Number(current.amountCents) > 0 ? `<button class="btn btn-ghost btn-block" type="button" id="target-clear">${icon("i-trash")} Remove the target</button>` : ""}
        </div>
      </form>`
    });

    const form = document.getElementById("target-form");
    form?.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const cents = T.parsePriceToCents(String(data.get("amount") || "0"));
      const month = Number(data.get("month"));
      const year = Number(data.get("year"));
      if (!Number.isFinite(cents) || cents <= 0) {
        setFormError(form, "Enter an amount above zero.");
        return;
      }
      T.setTarget(cents, { month, year });
      close(true);
      const name = monthNames[(month || 1) - 1];
      T.toast(`Target set: ${T.money(cents)} for ${name} ${year}`, "i-check");
      window.render?.();
    });
    document.getElementById("target-clear")?.addEventListener("click", () => {
      T.setTarget(0);
      close(true);
      T.toast("Target removed", "i-check");
      window.render?.();
    });
  }

  /* ---------- Daily opening & closing stock ---------- */

  /** One day from the stock book, product by product. */
  function openStockDay(date) {
    const detail = T.stockDayDetail?.(date);
    if (!detail) return;
    const rows = detail.rows.map((row) => {
      const qtyText = (value) => row.mass ? T.massLabel(value) : `${value} ${esc(row.unit)}`;
      const moved = row.sold || row.wasted;
      return `<div class="report-row">
        <span class="report-row-copy"><strong>${esc(row.name)}</strong><small>${qtyText(row.opening)} → ${qtyText(row.closing)}${moved ? ` · sold ${row.mass ? T.massLabel(row.sold) : row.sold}${row.wasted ? ` · wasted ${row.mass ? T.massLabel(row.wasted) : row.wasted}` : ""}` : ""}</small></span>
        <span class="report-amount ${row.closing < row.opening ? "is-profit" : ""}">${row.closing === row.opening ? "same" : `${row.closing > row.opening ? "+" : "−"}${qtyText(Math.abs(row.closing - row.opening))}`}</span>
      </div>`;
    }).join("");
    const openedAt = detail.openingAt ? T.timeFmt.format(new Date(detail.openingAt)) : "";
    const closedAt = detail.closingAt ? T.timeFmt.format(new Date(detail.closingAt)) : "";
    open({
      title: "Stock on " + T.dayLabel(`${date}T00:00:00`),
      subtitle: `${detail.rows.length} ${detail.rows.length === 1 ? "product" : "products"} counted${openedAt ? ` · opened ${openedAt}` : ""}${closedAt ? ` · closed ${closedAt}` : ""}`,
      iconName: "i-box",
      body: rows
        ? `<div class="report-list">${rows}</div><p class="report-note">The opening count is taken at the first save of the day; the closing count is the last level seen that day.</p>`
        : `<div class="empty-state"><div class="empty-icon">${icon("i-box")}</div><h3>Nothing counted</h3><p>This day has no stock levels saved for it.</p></div>`
    });
  }


  T.sheets = {
    open, close, isOpen, openManual, manualError, openUnknown, openOutOfStock,
    openWeigh, openWastage, openTarget, openStockDay,
    openDiscount, setDiscountMode, discountError, openProductEditor, renderProductEditor,
    readProductForm, productEditorError, openSaveInfo, confirm, runConfirm,
    openPro, buyPro, openMiniScan, closeMiniScan,
    openQuickScan, refreshQuickScan,
    openCategoryEditor, categoryError, openExitPrompt, openAccount,
    openSupplierEditor, supplierError, openSupplierPayment, openSupplierBill,
    openDebtCheckout, openCustomerPayment, openDebtReminder, openSellSort,
    openStockIn, openMpesaCode, openSubscriptionPayment,
    setFormError
  };
})();
