const fs = require('fs');
const base = 'C:\\Users\\user\\Omniroute-Claude\\biller pc pos\\';

const read = (f) => fs.readFileSync(base + f, 'utf8');
const jsFiles = ['js/app.js', 'js/core.js', 'js/screens.js', 'js/sheets.js', 'js/cloud.js', 'js/mpesa.js', 'js/auth.js', 'js/scanner.js', 'js/daraja.js', 'js/notify.js'];
const html = read('index.html');
const sw = read('sw.js');
const allJs = jsFiles.map(read).join('\n');

const findings = [];
const ok = [];

// 1. Every icon used must exist in the sprite.
const usedIcons = new Set([...allJs.matchAll(/icon\(\s*["'`]([a-z0-9-]+)["'`]/g)].map((m) => m[1]));
const spriteIds = new Set([...html.matchAll(/<symbol id="([a-z0-9-]+)"/g)].map((m) => m[1]));
const missingIcons = [...usedIcons].filter((id) => !spriteIds.has(id)).sort();
missingIcons.length
  ? findings.push(`icons used but not in the sprite: ${missingIcons.join(', ')}`)
  : ok.push(`icons: all ${usedIcons.size} used icons exist in the sprite`);

// 2. Every data-act must have a handler (either in runAction or wired directly).
const acts = new Set([...allJs.matchAll(/data-act="([a-z0-9-]+)"/g)].map((m) => m[1]));
const handled = new Set([...allJs.matchAll(/act === "([a-z0-9-]+)"/g)].map((m) => m[1]));
const direct = new Set([...allJs.matchAll(/\[data-act=['"]([a-z0-9-]+)['"]\]/g)].map((m) => m[1]));
const unhandled = [...acts].filter((a) => !handled.has(a) && !direct.has(a)).sort();
unhandled.length
  ? findings.push(`data-act without a handler: ${unhandled.join(', ')}`)
  : ok.push(`actions: all ${acts.size} data-act values have handlers`);

// 3. Handlers with no button anywhere (dead code). Some actions are swapped
//    in at runtime, so count those too.
const runtime = new Set([...allJs.matchAll(/dataset\.act\s*=[^;]*?["']([a-z0-9-]+)["']/g)].map((m) => m[1]));
const unused = [...handled].filter((a) => !acts.has(a) && !runtime.has(a)).sort();
unused.length
  ? findings.push(`handlers with no button anywhere: ${unused.join(', ')}`)
  : ok.push('actions: no dead handlers');

// 4. Every linked route must be in the router.
const navRoutes = new Set([...allJs.matchAll(/data-nav="#([a-z0-9-]+)/g)].map((m) => m[1]));
const routerRoutes = new Set([...allJs.matchAll(/screenName === "([a-z0-9-]+)"/g)].map((m) => m[1]));
[...allJs.matchAll(/route\.name === "([a-z0-9-]+)"/g)].forEach((m) => routerRoutes.add(m[1]));
const badRoutes = [...navRoutes].filter((r) => !routerRoutes.has(r)).sort();
badRoutes.length
  ? findings.push(`linked routes the router does not know: ${badRoutes.join(', ')}`)
  : ok.push(`routes: all ${navRoutes.size} linked routes are in the router`);

// 5. The service worker must cache every script.
const shell = sw.slice(sw.indexOf('const SHELL'), sw.indexOf('];', sw.indexOf('const SHELL')));
const missingShell = jsFiles.map((f) => './' + f).filter((f) => !shell.includes(f));
missingShell.length
  ? findings.push(`scripts missing from the service worker cache: ${missingShell.join(', ')}`)
  : ok.push('service worker: every script is cached');

// 6. index.html must load every script, one version only.
const versions = new Set([...html.matchAll(/\?v=(\d+)/g)].map((m) => m[1]));
const scriptTags = [...html.matchAll(/<script src="(js\/[a-z0-9.-]+\.js)\?v=\d+"/g)].map((m) => m[1]);
const notLoaded = jsFiles.filter((f) => !scriptTags.includes(f));
notLoaded.length
  ? findings.push(`scripts never loaded by index.html: ${notLoaded.join(', ')}`)
  : ok.push(`index.html: all ${scriptTags.length} scripts are loaded`);
versions.size > 1
  ? findings.push(`index.html mixes asset versions: ${[...versions].join(', ')}`)
  : ok.push(`index.html: one asset version (${[...versions].join(', ')})`);

// 7. Development leftovers must not sit in the served folder.
const leftovers = fs.readdirSync(base + 'js').filter((f) => !jsFiles.includes('js/' + f));
leftovers.length
  ? findings.push(`extra files in js/ that the web app serves: ${leftovers.join(', ')}`)
  : ok.push('js/: only the shipped scripts');

// 8. No debug logging in the shipped code.
const logs = jsFiles.filter((f) => /\bconsole\.log\(/.test(read(f)));
logs.length
  ? findings.push(`console.log in shipped files: ${logs.join(', ')}`)
  : ok.push('no console.log in shipped files');

// 9. The notification ids must not clash with anything else.
const notifyIds = [...read('js/notify.js').matchAll(/^\s+(\w+): (\d{4}),/gm)].map((m) => Number(m[2]));
const clashes = notifyIds.filter((id, i) => notifyIds.indexOf(id) !== i);
clashes.length
  ? findings.push(`duplicate notification ids: ${clashes.join(', ')}`)
  : ok.push(`notifications: ${notifyIds.length} unique ids`);

console.log('=== PASSED ===');
ok.forEach((line) => console.log('  ok  ' + line));
console.log('\n=== FINDINGS ===');
if (!findings.length) console.log('  none');
findings.forEach((line) => console.log('  !!  ' + line));
