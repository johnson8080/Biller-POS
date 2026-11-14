/*
 * Biller POS advertisement - the recorder.
 *
 * Serves the marketing folder and drives Chrome to record the film that
 * ad-builder.html draws, then writes Biller-POS-ad.mp4 next to it.
 *
 *   node record-ad.js
 */
const puppeteer = require(process.env.PUPPETEER_PATH || 'puppeteer-core');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = 8790;
const OUT = path.join(ROOT, 'Biller-POS-ad.mp4');

const types = {
  '.html': 'text/html; charset=utf-8',
  '.png': 'image/png',
  '.wav': 'audio/wav',
  '.json': 'application/json',
  '.mp4': 'video/mp4'
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const file = path.join(ROOT, decodeURIComponent(url.pathname).replace(/^\//, '') || 'ad-builder.html');
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (error, data) => {
    if (error) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, {
      'Content-Type': types[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(data);
  });
});

(async () => {
  await new Promise((resolve) => server.listen(PORT, resolve));
  console.log('serving ' + ROOT + ' on http://127.0.0.1:' + PORT);

  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: 'new',
    args: [
      '--no-sandbox', '--disable-gpu',
      '--autoplay-policy=no-user-gesture-required',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding'
    ],
    defaultViewport: { width: 1080, height: 1920 }
  });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('[page]', m.text()); });
  await page.goto('http://127.0.0.1:' + PORT + '/ad-builder.html', { waitUntil: 'networkidle2', timeout: 30000 });

  console.log('recording, this takes a couple of minutes...');
  const started = Date.now();
  await page.evaluate(() => window.buildAd());

  const meta = await page.evaluate(() => window.__videoMeta);
  const base64 = await page.evaluate(() => window.__video);
  fs.writeFileSync(OUT, Buffer.from(base64, 'base64'));
  console.log('written:', OUT, (fs.statSync(OUT).size / 1048576).toFixed(2) + ' MB',
    'in', ((Date.now() - started) / 1000).toFixed(0) + 's');
  console.log('meta:', JSON.stringify(meta));

  await browser.close();
  server.close();
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
