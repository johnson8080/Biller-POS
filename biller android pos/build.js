/**
 * Build script — bundles CDN libraries locally for offline use
 * Run: node build.js
 */
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const libs = [
  {
    url: 'https://cdn.jsdelivr.net/npm/mammoth@1.6.0/mammoth.browser.min.js',
    dest: 'www/js/lib/mammoth.browser.min.js',
  },
  {
    // NOTE: html2pdf.js 0.10.1 (bundled copy) was verified to render blank
    // pages even for plain visible content in Nov 2026. Use standalone
    // html2canvas + jsPDF instead and slice pages in convertWordToPdf().
    url: 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
    dest: 'www/js/lib/html2canvas.min.js',
  },
  {
    url: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
    dest: 'www/js/lib/jspdf.umd.min.js',
  },
  {
    url: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
    dest: 'www/js/lib/pdf.min.js',
  },
  {
    url: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
    dest: 'www/js/lib/pdf.worker.min.js',
  },
  {
    // The package's UMD build exposes the global `docx` (build/index.js does not exist)
    url: 'https://unpkg.com/docx@8.5.0/build/index.umd.js',
    dest: 'www/js/lib/docx.min.js',
  },
];

const libDir = path.join(__dirname, 'www', 'js', 'lib');
if (!fs.existsSync(libDir)) {
  fs.mkdirSync(libDir, { recursive: true });
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const filePath = path.join(__dirname, dest);
    const tmpPath = filePath + '.download';
    const client = url.startsWith('https') ? https : http;

    const request = client.get(url, (response) => {
      // Handle redirects (resolve relative Location headers)
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        response.resume();
        const location = response.headers.location;
        if (!location) {
          reject(new Error('Redirect response without a Location header'));
          return;
        }
        download(new URL(location, url).toString(), dest).then(resolve, reject);
        return;
      }

      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }

      const file = fs.createWriteStream(tmpPath);
      let bytes = 0;

      response.on('data', (chunk) => {
        bytes += chunk.length;
      });

      response.pipe(file);

      file.on('finish', () => {
        file.close(() => {
          // A CDN error page is tiny; treat it as a failed download instead of
          // silently replacing a working file with a broken one.
          if (bytes < 1024) {
            fs.rm(tmpPath, { force: true }, () => {});
            reject(new Error(`Downloaded file is suspiciously small (${bytes} bytes)`));
            return;
          }

          // Only replace the destination after a complete, valid download
          fs.rename(tmpPath, filePath, (err) => {
            if (err) {
              fs.rm(tmpPath, { force: true }, () => {});
              reject(err);
              return;
            }
            console.log(`✓ Downloaded: ${dest} (${(bytes / 1024).toFixed(0)} KB)`);
            resolve();
          });
        });
      });

      file.on('error', (err) => {
        fs.rm(tmpPath, { force: true }, () => {});
        reject(err);
      });
    });

    request.on('error', (err) => {
      fs.rm(tmpPath, { force: true }, () => {});
      reject(err);
    });

    request.setTimeout(30000, () => {
      request.destroy(new Error('Request timed out'));
    });
  });
}

async function build() {
  console.log('📦 Downloading libraries for offline use...\n');

  let failures = 0;
  const downloaded = new Set();

  for (const lib of libs) {
    try {
      await download(lib.url, lib.dest);
      downloaded.add(lib.dest);
    } catch (err) {
      failures++;
      console.error(`✗ Failed to download ${lib.url}:`, err.message);
    }
  }

  // Create offline version of index.html
  console.log('\n📄 Creating offline index.html...');
  let html = fs.readFileSync(path.join(__dirname, 'www', 'index.html'), 'utf8');

  // Replace CDN URLs with local paths (only for files we actually downloaded)
  const replacements = [
    ['https://cdn.jsdelivr.net/npm/mammoth@1.6.0/mammoth.browser.min.js', 'www/js/lib/mammoth.browser.min.js', 'js/lib/mammoth.browser.min.js'],
    ['https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js', 'www/js/lib/html2canvas.min.js', 'js/lib/html2canvas.min.js'],
    ['https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js', 'www/js/lib/jspdf.umd.min.js', 'js/lib/jspdf.umd.min.js'],
    ['https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js', 'www/js/lib/pdf.min.js', 'js/lib/pdf.min.js'],
    ['https://unpkg.com/docx@8.5.0/build/index.js', 'www/js/lib/docx.min.js', 'js/lib/docx.min.js'],
    ['https://unpkg.com/docx@8.5.0/build/index.umd.js', 'www/js/lib/docx.min.js', 'js/lib/docx.min.js'],
    ['https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js', 'www/js/lib/pdf.worker.min.js', 'js/lib/pdf.worker.min.js'],
  ];

  for (const [cdnUrl, dest, webPath] of replacements) {
    if (downloaded.has(dest)) {
      html = html.replace(cdnUrl, webPath);
    }
  }

  fs.writeFileSync(path.join(__dirname, 'www', 'index.html'), html);

  // Update worker path in app.js
  let appJs = fs.readFileSync(path.join(__dirname, 'www', 'js', 'app.js'), 'utf8');
  if (downloaded.has('www/js/lib/pdf.worker.min.js')) {
    appJs = appJs.replace(
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
      'js/lib/pdf.worker.min.js'
    );
  }
  fs.writeFileSync(path.join(__dirname, 'www', 'js', 'app.js'), appJs);

  if (failures > 0) {
    console.error(`\n⚠️  ${failures} library download(s) failed. The app will fall back to CDN URLs for those files.`);
    process.exitCode = 1;
  }

  console.log('\n✅ Build complete! Run the following to set up Android:\n');
  console.log('  npm install');
  console.log('  npx cap init "File Converter" com.fileconverter.app --web-dir www');
  console.log('  npx cap add android');
  console.log('  npx cap sync');
  console.log('  npx cap open android');
}

build();
