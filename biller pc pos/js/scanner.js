/* ============================================================
   Till — camera barcode scanning
   Uses BarcodeDetector where available, ZXing otherwise.
   ============================================================ */
(() => {
  "use strict";
  const T = window.Till;
  if (!T) throw new Error("Till core must load before scanner.");
  const { esc } = T;

  const state = {
    active: false,
    paused: false,
    starting: false,
    stream: null,
    track: null,
    detector: null,
    reader: null,
    timer: null,
    mode: null,
    busy: false,
    torchOn: false,
    torchCapable: false,
    torchManualOff: false,
    lightTimer: null,
    darkStreak: 0,
    brightCanvas: null,
    lastCode: "",
    lastAt: 0,
    // "screen" = the full-screen scanner route, "bar" = the little camera
    // window that opens inside the product entry form.
    host: "screen"
  };

  const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf", "qr_code"];

  function overlay() {
    return document.getElementById("scan-overlay");
  }
  function overlayContent() {
    return document.getElementById("scan-overlay-content");
  }
  function hideOverlay() {
    overlay()?.classList.add("is-hidden");
    document.querySelector(".scan-screen")?.classList.remove("is-veiled");
  }
  function showOverlay(html) {
    const el = overlay();
    const content = overlayContent();
    if (el) el.classList.remove("is-hidden");
    if (content) content.innerHTML = html;
    document.querySelector(".scan-screen")?.classList.add("is-veiled");
  }

  function startOverlay() {
    showOverlay(`<div class="scan-start" aria-hidden="true"></div>
      <h2>Starting camera</h2>
      <p>If your browser asks, allow camera access for Biller.</p>`);
  }

  function errorOverlay(kind, detail = "") {
    const messages = {
      permission: {
        icon: "i-camera-off", tone: "warn", title: "Camera access is off",
        body: "Allow camera access for this site in your browser settings, then try again. You can still enter barcodes by hand."
      },
      notfound: {
        icon: "i-camera-off", tone: "warn", title: "No camera found",
        body: "This device doesn’t seem to have a camera available to the browser. You can enter barcodes manually."
      },
      busy: {
        icon: "i-camera-off", tone: "warn", title: "Camera is in use",
        body: "Another app may be using the camera. Close it, then try again — or enter the barcode manually."
      },
      insecure: {
        icon: "i-lock", tone: "warn", title: "Camera needs a secure connection",
        body: "Open Biller over HTTPS or localhost to use the camera. Manual barcode entry still works here."
      },
      unsupported: {
        icon: "i-barcode", tone: "", title: "Scanning isn’t available here",
        body: "This browser can’t decode barcodes from the camera. Enter the barcode manually instead."
      },
      failed: {
        icon: "i-alert", tone: "warn", title: "Camera couldn’t start",
        body: detail || "Something interrupted the camera. Try again, or enter the barcode manually."
      }
    };
    const message = messages[kind] || messages.failed;
    const canRetry = kind !== "unsupported" && kind !== "insecure";
    showOverlay(`<div class="sheet-icon ${message.tone}"><svg class="ico" aria-hidden="true"><use href="#${message.icon}"></use></svg></div>
      <h2>${esc(message.title)}</h2>
      <p>${esc(message.body)}</p>
      <div class="sheet-actions">
        <button class="btn btn-primary" data-act="manual-entry">Enter barcode</button>
        ${canRetry ? `<button class="btn btn-ghost" data-act="retry-camera">Try again</button>` : `<button class="btn btn-ghost" data-act="close-scan">Close</button>`}
      </div>`);
  }

  async function getMedia() {
    const constraints = {
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    };
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (error) {
      if (error.name === "OverconstrainedError") {
        return await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
      }
      throw error;
    }
  }

  async function startNativeDecoder(video) {
    if (!("BarcodeDetector" in window)) return false;
    try {
      let supported = [];
      try { supported = await BarcodeDetector.getSupportedFormats(); } catch { /* optional */ }
      const formats = supported.length ? FORMATS.filter((format) => supported.includes(format)) : FORMATS;
      state.detector = new BarcodeDetector(formats.length ? { formats } : undefined);
      state.mode = "native";
      decodeNative(video);
      return true;
    } catch (error) {
      console.warn("BarcodeDetector unavailable, falling back to ZXing:", error);
      state.detector = null;
      return false;
    }
  }

  function decodeNative(video) {
    if (!state.active || state.mode !== "native") return;
    if (video.readyState >= 2 && !state.paused) {
      state.detector.detect(video).then((codes) => {
        if (codes?.length && state.active && !state.paused && !state.busy) {
          onValue(codes[0].rawValue);
        }
      }).catch(() => { /* a frame can fail while the camera settles */ }).finally(() => {
        if (state.active) state.timer = setTimeout(() => decodeNative(video), 190);
      });
    } else {
      state.timer = setTimeout(() => decodeNative(video), 190);
    }
  }

  async function startZXing(video) {
    const ZX = window.ZXing;
    if (!ZX?.BrowserMultiFormatReader) return false;
    try {
      const hints = new Map();
      const formats = FORMATS.map((format) => ({
        ean_13: "EAN_13", ean_8: "EAN_8", upc_a: "UPC_A", upc_e: "UPC_E",
        code_128: "CODE_128", code_39: "CODE_39", itf: "ITF", qr_code: "QR_CODE"
      }[format])).map((name) => ZX.BarcodeFormat?.[name]).filter(Boolean);
      if (formats.length) hints.set(ZX.DecodeHintType.POSSIBLE_FORMATS, formats);
      hints.set(ZX.DecodeHintType.TRY_HARDER, true);
      state.reader = new ZX.BrowserMultiFormatReader(hints, 160);
      state.mode = "zxing";
      await state.reader.decodeFromStream(state.stream, video, (result) => {
        if (result && state.active && !state.paused && !state.busy) onValue(result.getText());
      });
      return true;
    } catch (error) {
      console.warn("ZXing could not start:", error);
      state.reader = null;
      return false;
    }
  }

  /** Whether this camera can light up. */
  function torchSupported() {
    try {
      return Boolean(state.track?.getCapabilities?.().torch);
    } catch {
      return false;
    }
  }

  function setupTorch() {
    const button = document.getElementById("torchBtn");
    if (!button) return;
    const capable = torchSupported();
    state.torchCapable = capable;
    button.hidden = !capable;
  }

  function hideTorchButton() {
    const button = document.getElementById("torchBtn");
    if (button) {
      button.hidden = true;
      button.setAttribute("aria-pressed", "false");
    }
  }

  /** Turn the flashlight on or off and keep the button in step. */
  async function setTorch(next) {
    if (!state.track) return false;
    try {
      await state.track.applyConstraints({ advanced: [{ torch: next }] });
      state.torchOn = next;
      const button = document.getElementById("torchBtn");
      if (button) {
        button.setAttribute("aria-pressed", String(next));
        button.setAttribute("aria-label", next ? "Turn flashlight off" : "Turn flashlight on");
      }
      return true;
    } catch {
      return false;
    }
  }

  async function toggleTorch() {
    if (!state.track) return;
    const next = !state.torchOn;
    // If the shopkeeper turns the light off by hand, leave it off.
    if (!next) state.torchManualOff = true;
    const ok = await setTorch(next);
    if (!ok) T.toast("Flashlight isn’t available on this camera", "i-alert");
  }

  /* ---------- Dark detection ----------
     A dim shop makes barcodes hard to read, so the flashlight comes on by
     itself when the camera sees a dark scene. The shopkeeper can still turn
     it off by hand, and the app then leaves it alone. */

  const DARK_LUMA = 70;        // 0-255, lower means darker
  const DARK_STREAK = 2;       // samples in a row before the light comes on

  function sampleBrightness(video) {
    if (!video || video.readyState < 2 || !video.videoWidth) return null;
    const canvas = state.brightCanvas || (state.brightCanvas = document.createElement("canvas"));
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    try {
      ctx.drawImage(video, 0, 0, 32, 32);
      const { data } = ctx.getImageData(0, 0, 32, 32);
      let sum = 0;
      for (let i = 0; i < data.length; i += 4) {
        sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      }
      return sum / (data.length / 4);
    } catch {
      return null;
    }
  }

  function monitorLight(video) {
    clearTimeout(state.lightTimer);
    state.lightTimer = null;
    state.darkStreak = 0;
    const tick = async () => {
      if (!state.active || !state.track) return;
      const luma = sampleBrightness(video);
      if (luma !== null) {
        if (luma < DARK_LUMA) state.darkStreak += 1;
        else state.darkStreak = 0;
        if (state.darkStreak >= DARK_STREAK && !state.torchOn && !state.torchManualOff && torchSupported()) {
          const ok = await setTorch(true);
          if (ok) {
            state.darkStreak = 0;
            T.toast("Flashlight on — it’s dark in here", "i-flash");
          }
        }
      }
      state.lightTimer = setTimeout(tick, 900);
    };
    state.lightTimer = setTimeout(tick, 1400);
  }

  function onValue(raw) {
    if (state.busy) return;
    const code = T.cleanBarcode(raw);
    if (!code) return;
    const now = Date.now();
    // Ignore a repeat of the same code straight away — the camera often
    // decodes the same label several times in a row.
    if (code === state.lastCode && now - state.lastAt < 1200) return;
    state.lastCode = code;
    state.lastAt = now;
    state.busy = true;
    state.paused = true;
    T.vibrate(18);
    T.beep();
    if (state.host === "bar") {
      // The barcode goes straight into the open entry form.
      T.app.editorBarcode(code);
      stopBar();
      return;
    }
    if (state.host === "quick") {
      // The compact sale scanner: add the item and keep the camera going.
      T.app.handleBarcode(code, { source: "quick" });
      setTimeout(() => {
        if (state.active && state.host === "quick") {
          state.paused = false;
          state.busy = false;
        }
      }, 700);
      return;
    }
    if (T.ui.scanPurpose === "editor") {
      T.app.editorBarcode(code);
    } else {
      T.app.handleBarcode(code, { source: "scan" });
    }
  }

  async function start() {
    stop();
    state.host = "screen";
    if (T.ui.route.name !== "scan") return;
    const video = document.getElementById("scan-video");
    if (!video) return;
    state.active = true;
    state.paused = false;
    state.starting = true;
    startOverlay();

    if (location.protocol === "file:") {
      state.starting = false;
      errorOverlay("insecure");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      state.starting = false;
      errorOverlay("unsupported");
      return;
    }
    if (!window.isSecureContext) {
      state.starting = false;
      errorOverlay("insecure");
      return;
    }

    let stream;
    try {
      stream = await getMedia();
    } catch (error) {
      state.starting = false;
      if (["NotAllowedError", "SecurityError"].includes(error.name)) errorOverlay("permission");
      else if (["NotFoundError", "OverconstrainedError"].includes(error.name)) errorOverlay("notfound");
      else if (error.name === "NotReadableError") errorOverlay("busy");
      else errorOverlay("failed", "The camera returned an unexpected error. Try again, or enter the barcode manually.");
      return;
    }

    if (!state.active) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }

    state.stream = stream;
    state.track = stream.getVideoTracks()[0] || null;
    video.srcObject = stream;
    video.muted = true;
    try { await video.play(); } catch { /* autoplay may need the tap that opened this screen */ }

    let decoderStarted = await startNativeDecoder(video);
    if (!decoderStarted) decoderStarted = await startZXing(video);
    if (!state.active) return;
    if (!decoderStarted) {
      state.starting = false;
      errorOverlay("unsupported");
      return;
    }

    state.starting = false;
    hideOverlay();
    setupTorch();
    monitorLight(video);
  }

  function stop() {
    state.active = false;
    state.paused = false;
    state.starting = false;
    state.busy = false;
    clearTimeout(state.timer);
    state.timer = null;
    clearTimeout(state.lightTimer);
    state.lightTimer = null;
    state.darkStreak = 0;
    if (state.reader) {
      try { state.reader.reset(); } catch { /* ignore */ }
      state.reader = null;
    }
    if (state.stream) {
      state.stream.getTracks().forEach((track) => { try { track.stop(); } catch { /* ignore */ } });
      state.stream = null;
    }
    state.track = null;
    state.detector = null;
    state.mode = null;
    state.torchOn = false;
    state.torchManualOff = false;
    const video = document.getElementById("scan-video");
    if (video) {
      try { video.pause(); } catch { /* ignore */ }
      video.srcObject = null;
    }
    hideTorchButton();
  }

  function pause() {
    state.paused = true;
  }
  function resume() {
    if (state.active) {
      state.paused = false;
      state.busy = false;
    }
  }
  function restart() {
    if (T.ui.route.name === "scan") start();
  }

  /* ---------- Inline scan bar ---------- */

  function barStatus(text, tone = "") {
    const status = document.getElementById("mini-scan-status");
    if (!status) return;
    status.textContent = text;
    status.classList.toggle("is-error", tone === "error");
  }

  /**
   * Open the camera in the small window that sits under the barcode field.
   * The rest of the form keeps running, so the shopkeeper never has to type
   * the details again after scanning.
   */
  async function startInline(host) {
    stop();
    state.host = host;
    const video = document.getElementById("mini-scan-video");
    if (!video) return;
    state.active = true;
    state.paused = false;
    state.starting = true;
    barStatus("Starting the camera…");

    if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) {
      state.starting = false;
      barStatus("The camera is not available here — type the barcode instead.", "error");
      return;
    }

    let stream;
    try {
      stream = await getMedia();
    } catch (error) {
      state.starting = false;
      const message = ["NotAllowedError", "SecurityError"].includes(error.name)
        ? "Camera access is off — type the barcode instead."
        : "The camera could not start — type the barcode instead.";
      barStatus(message, "error");
      return;
    }

    if (!state.active) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }

    state.stream = stream;
    state.track = stream.getVideoTracks()[0] || null;
    video.srcObject = stream;
    video.muted = true;
    try { await video.play(); } catch { /* autoplay may need the tap that opened it */ }

    let decoderStarted = await startNativeDecoder(video);
    if (!decoderStarted) decoderStarted = await startZXing(video);
    if (!state.active) return;
    state.starting = false;
    if (!decoderStarted) {
      barStatus("This device cannot read barcodes — type it instead.", "error");
      return;
    }
    barStatus("Point the camera at the barcode");
    monitorLight(video);
  }

  function startBar() { return startInline("bar"); }
  function startQuick() { return startInline("quick"); }

  function stopBar() {
    if (state.host !== "bar" && state.host !== "quick") return;
    stop();
    state.host = "screen";
    // Take the little camera window away with the camera.
    const bar = document.getElementById("mini-scan");
    if (bar) {
      bar.hidden = true;
      bar.classList.remove("is-open");
    }
  }

  /** Only stops the full-screen camera, never the inline one. */
  function stopScreen() {
    if (state.host !== "screen") return;
    stop();
  }

  T.scanner = {
    start, stop, pause, resume, restart, toggleTorch,
    startBar, startQuick, stopBar, stopScreen,
    isActive: () => state.active,
    isPaused: () => state.paused,
    host: () => state.host
  };
})();
