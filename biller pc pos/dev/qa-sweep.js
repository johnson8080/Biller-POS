const puppeteer = require('puppeteer-core');
const path = require('path');

function seed() {
  const now = new Date().toISOString();
  const state = {
    version: 1,
    store: {
      name: 'J&J LTD CO.', address: '44 st. Kenyatta', phone: '0724067632', staff: 'Johnson', taxRate: 0.5, currency: 'KES',
      theme: 'forest', colorScheme: 'light', textSize: 'small', sellView: 'grid', sellSort: 'new', shopCode: 'JJLTDC-9961',
      mpesa: { paybill: '247247', till: '', mode: 'paybill', account: 'ACC1', environment: 'sandbox', consumerKey: '', consumerSecret: '', passkey: '', backend: '', backendKey: '' },
      footer: 'Thank you for shopping with us.'
    },
    categories: ['Coffee', 'Bakery', 'Drinks', 'Fresh', 'Pantry'],
    products: [
      { id: 'p1', name: 'Black Coffee 500g', price: 65000, cost: 40000, stock: 10, lowStockAt: 5, unit: 'pcs', category: 'Coffee' },
      { id: 'p2', name: 'Mandazi 2pc', price: 4000, cost: 2200, stock: 24, lowStockAt: 6, unit: 'pcs', category: 'Bakery' },
      { id: 'p3', name: 'Colgate 250 ml', price: 25500, cost: 18000, stock: 3, lowStockAt: 5, unit: 'pcs', category: 'Fresh' }
    ],
    suppliers: [{ id: 's1', name: 'Kibuki Traders', phone: '0722000000', entries: [], createdAt: now }],
    customers: [{ id: 'c1', name: 'Jane Wanjiku', phone: '0712345678', createdAt: now, entries: [{ id: 'e1', type: 'debt', method: null, amount: 65000, note: '', txId: null, dueDate: '2026-12-01', date: '2026-11-01', createdAt: now }] }],
    transactions: [{ id: 't1', receiptNo: 'POS-1', items: [{ productId: 'p1', name: 'Black Coffee 500g', qty: 1, price: 65000, cost: 40000 }], subtotal: 65000, tax: 32500, discount: null, total: 97500, paid: 97500, change: 0, method: 'cash', at: new Date().toISOString(), staff: 'Johnson', createdAt: new Date().toISOString() }],
    cart: { items: [], discount: null }, nextReceipt: 2, pro: false, createdAt: now
  };
  const raw = JSON.stringify(state);
  localStorage.setItem('biller.pos.shop.dev-uid-123', raw);
  localStorage.setItem('biller.pos.v1', raw);
  localStorage.setItem('biller.pos.ownerOf', 'dev-uid-123');
  localStorage.setItem('biller.pos.auth', JSON.stringify({ email: 'johnsonommala1@gmail.com', uid: 'dev-uid-123', at: now }));
}

const wait = (ms) => new Promise(r => setTimeout(r, ms));

const ROUTES = ['sell', 'orders', 'debt', 'stock', 'suppliers', 'reports', 'more', 'store', 'account', 'plans'];

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: 'new', args: ['--no-sandbox', '--disable-gpu'],
    defaultViewport: { width: 390, height: 844, deviceScaleFactor: 2 }
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('[console] ' + m.text()); });
  await page.setRequestInterception(true);
  await page.setCacheEnabled(false);
  page.on('request', (req) => { if (req.url().includes('gstatic.com/firebasejs')) req.abort(); else req.continue(); });
  await page.evaluateOnNewDocument(seed);
  await page.goto('http://127.0.0.1:4173/index.html#/sell', { waitUntil: 'networkidle2', timeout: 30000 });
  await wait(1200);

  const out = { errors, routes: [], palettes: [], notifications: {} };

  // 1. Every route renders something, with no errors.
  for (const route of ROUTES) {
    await page.evaluate((r) => { window.Till.go('#/' + r); }, route);
    await wait(700);
    const info = await page.evaluate(() => {
      const screen = document.querySelector('.screen');
      const ids = [...document.querySelectorAll('[id]')].map((e) => e.id);
      const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
      return {
        hash: location.hash,
        hasScreen: !!screen,
        text: (screen?.textContent || '').replace(/\s+/g, ' ').trim().length,
        buttons: document.querySelectorAll('.screen button, .screen a').length,
        duplicateIds: [...new Set(dupes)]
      };
    });
    out.routes.push({ route, ...info });
  }

  // 2. Every palette, both schemes: contrast and overflow.
  const themes = ['forest', 'ocean', 'clay', 'plum', 'black'];
  for (const theme of themes) {
    for (const scheme of ['light', 'dark']) {
      await page.evaluate((t, s) => {
        window.Till.setTheme(t);
        window.Till.setColorScheme(s);
        window.Till.go('#/sell');
      }, theme, scheme);
      await wait(500);
      const check = await page.evaluate(() => {
        const parse = (c) => (c.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
        const lum = (rgb) => { const s = rgb.map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }); return 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2]; };
        const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); const hi = Math.max(l1, l2), lo = Math.min(l1, l2); return (hi + 0.05) / (lo + 0.05); };
        const bgOf = (el) => {
          const stack = [];
          let n = el;
          while (n && n !== document.documentElement) {
            const bg = getComputedStyle(n).backgroundColor;
            if (bg && bg !== 'rgba(0, 0, 0, 0)') {
              const parts = (bg.match(/[\d.]+/g) || []).map(Number);
              stack.push({ rgb: parts.slice(0, 3), a: parts.length > 3 ? parts[3] : 1 });
              if ((parts.length > 3 ? parts[3] : 1) >= 0.999) break;
            }
            n = n.parentElement;
          }
          let base = parse(getComputedStyle(document.body).backgroundColor);
          if (base.length < 3) base = [255, 255, 255];
          for (let i = stack.length - 1; i >= 0; i -= 1) {
            const layer = stack[i];
            base = layer.rgb.map((c, k) => c * layer.a + base[k] * (1 - layer.a));
          }
          return base;
        };
        const bad = [];
        document.querySelectorAll('.screen *').forEach((el) => {
          const text = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join('');
          if (!text) return;
          const style = getComputedStyle(el);
          if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) < 0.5) return;
          const r = ratio(parse(style.color), bgOf(el));
          if (r < 3) bad.push(text.slice(0, 24) + ' (' + r.toFixed(1) + ')');
        });
        // Anything sticking out of the screen is a layout bug.
        const wide = [...document.querySelectorAll('.screen *')].filter((el) => el.getBoundingClientRect().right > window.innerWidth + 2).length;
        return { bad: bad.slice(0, 6), badCount: bad.length, overflowing: wide, paper: getComputedStyle(document.documentElement).getPropertyValue('--paper').trim() };
      });
      out.palettes.push({ theme, scheme, ...check });
    }
  }

  // 3. The notification module.
  out.notifications = await page.evaluate(async () => {
    const T = window.Till;
    return {
      present: !!T.notify,
      native: T.notify ? T.notify.native() : null,
      ids: T.notify ? Object.keys(T.notify.ids).length : 0,
      granted: T.notify ? await T.notify.granted() : null
    };
  });

  // 4. Interactions: the stock stepper and the reminders row.
  out.interactions = {};
  await page.evaluate(() => { window.Till.go('#/stock'); });
  await wait(700);
  out.interactions.stockDec = await page.evaluate(() => {
    const T = window.Till;
    const before = T.state.products.map((p) => p.stock);
    const button = document.querySelector('[data-act="stock-dec"]');
    if (button) button.click();
    const after = T.state.products.map((p) => p.stock);
    return { button: !!button, before, after, changed: JSON.stringify(before) !== JSON.stringify(after) };
  });

  await page.evaluate(() => { window.Till.go('#/more'); });
  await wait(900);
  await page.evaluate(() => document.querySelector('.settings-group-head[data-value="subscription"]')?.click());
  await wait(600);
  out.interactions.reminders = await page.evaluate(() => ({
    row: !!document.querySelector('.plan-reminders'),
    status: document.getElementById('notify-status')?.textContent?.trim(),
    onButton: document.getElementById('notify-on')?.textContent?.trim(),
    testButton: !!document.getElementById('notify-test'),
    duplicateIds: (() => {
      const ids = [...document.querySelectorAll('[id]')].map((e) => e.id);
      return [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
    })()
  }));

  // 5. The pay sheet and the lock still work.
  await page.evaluate(() => { window.Till.go('#/sell'); });
  await wait(600);
  out.interactions.lock = await page.evaluate(() => {
    const T = window.Till;
    const realStatus = T.cloud.status;
    const realIsDev = T.isDeveloperAccount;
    T.cloud.status = () => Object.assign({}, realStatus(), { isOwner: false });
    T.isDeveloperAccount = () => false;
    window.render();
    const locked = T.subscriptionLocked();
    const panel = !!document.querySelector('.plan-lock');
    const pay = !!document.querySelector('[data-act="pay-subscription"]');
    T.cloud.status = realStatus;
    T.isDeveloperAccount = realIsDev;
    window.render();
    return { locked, panel, pay };
  });

  // The developer's own account is never limited by the plan.
  out.interactions.developer = await page.evaluate(() => {
    const T = window.Till;
    return {
      isDeveloper: T.isDeveloperAccount(),
      status: T.subscriptionStatus(),
      locked: T.subscriptionLocked()
    };
  });

  await page.evaluate(() => { window.Till.setTheme('forest'); window.Till.setColorScheme('light'); });
  await page.screenshot({ path: path.join(__dirname, 'shots', 'sweep-final.png') });

  console.log(JSON.stringify(out, null, 2));
  await browser.close();
})().catch((e) => { console.error('PROBE-FAIL', e); process.exit(1); });
