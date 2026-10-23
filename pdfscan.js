(function (root) {
  "use strict";

  var MAX_BYTES = 8000000;
  var MAX_PAGES = 8;
  var TIME_BUDGET_MS = 20000;
  var RENDER_LONG = 2200;
  var PREVIEW_LONG = 1600;
  var MAX_CODES = 4;
  var MAX_LINKS = 25;
  var MAX_PREVIEWS = 4;

  var pdfPromise = null;

  function emptyResult() {
    return { pageCount: 0, pages: [], qr: [], links: [], locked: false, scanned: 0, scanLimit: 0 };
  }

  function loadPdfJs() {
    if (pdfPromise) return pdfPromise;
    var workerUrl = messenger.runtime.getURL("pdfjs/pdf.worker.min.mjs");
    pdfPromise = import(messenger.runtime.getURL("pdfjs/pdf.min.mjs"))
      .then(function (lib) {
        if (lib.GlobalWorkerOptions) lib.GlobalWorkerOptions.workerSrc = workerUrl;
        // Module Worker never becomes ready in the Thunderbird background, so import it here and parse on this page.
        return import(workerUrl).then(function () {
          return lib;
        });
      })
      .catch(function (err) {
        pdfPromise = null;
        throw err;
      });
    return pdfPromise;
  }

  function hasPdfHeader(bytes) {
    var n = Math.min(1024, bytes.length);
    var s = "";
    for (var i = 0; i < n; i++) s += String.fromCharCode(bytes[i]);
    return s.indexOf("%PDF-") !== -1;
  }

  function wasmDir() {
    var url = messenger.runtime.getURL("pdfjs/wasm/");
    if (url.charAt(url.length - 1) !== "/") url += "/";
    return url;
  }

  function withBudget(promise, deadline) {
    var left = deadline - Date.now();
    if (left <= 0) return Promise.reject(new Error("timeout"));
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        reject(new Error("timeout"));
      }, left);
      promise.then(
        function (value) {
          clearTimeout(timer);
          resolve(value);
        },
        function (err) {
          clearTimeout(timer);
          reject(err);
        }
      );
    });
  }

  // Boxes are page-relative so the same code can be masked on every pass size.
  function relativeBox(location, width, height) {
    var corners = [
      location.topLeftCorner,
      location.topRightCorner,
      location.bottomRightCorner,
      location.bottomLeftCorner,
    ];
    var minX = Infinity;
    var minY = Infinity;
    var maxX = -Infinity;
    var maxY = -Infinity;
    var i;
    var corner;
    if (!width || !height) return null;
    for (i = 0; i < corners.length; i++) {
      corner = corners[i];
      if (!corner) continue;
      if (corner.x < minX) minX = corner.x;
      if (corner.y < minY) minY = corner.y;
      if (corner.x > maxX) maxX = corner.x;
      if (corner.y > maxY) maxY = corner.y;
    }
    if (minX === Infinity) return null;
    return { x0: minX / width, y0: minY / height, x1: maxX / width, y1: maxY / height };
  }

  // Masks decoded codes in the pixel copy, never on the canvas the preview is made from.
  function whiteOut(image, box) {
    var margin = Math.max(image.width, image.height) * 0.01;
    var x0 = Math.max(0, Math.floor(box.x0 * image.width - margin));
    var y0 = Math.max(0, Math.floor(box.y0 * image.height - margin));
    var x1 = Math.min(image.width, Math.ceil(box.x1 * image.width + margin));
    var y1 = Math.min(image.height, Math.ceil(box.y1 * image.height + margin));
    var data;
    var y;
    var from;
    if (x1 <= x0 || y1 <= y0) return;
    data = image.data;
    for (y = y0; y < y1; y++) {
      from = (y * image.width + x0) * 4;
      data.fill(255, from, from + (x1 - x0) * 4);
    }
  }

  function paintKnown(image, known) {
    var i;
    for (i = 0; i < known.length; i++) whiteOut(image, known[i]);
  }

  // Returns false when the pass stops early. A finished pass with no further code returns true.
  function readPass(image, pageNum, qr, seen, known, deadline, cancelled, inversion) {
    var fn = root.jsQR;
    var hits = 0;
    var code;
    var payload;
    var box;
    if (!fn || !image) return false;
    paintKnown(image, known);
    while (hits < MAX_CODES) {
      if (Date.now() >= deadline || cancelled()) return false;
      try {
        code = fn(image.data, image.width, image.height, { inversionAttempts: inversion });
      } catch (_) {
        return false;
      }
      if (!code || !code.data) return true;
      payload = String(code.data);
      if (!seen[payload]) {
        seen[payload] = true;
        qr.push({ page: pageNum, payload: payload });
      }
      hits++;
      box = code.location ? relativeBox(code.location, image.width, image.height) : null;
      if (!box) return true;
      known.push(box);
      whiteOut(image, box);
    }
    return true;
  }

  function scaledImage(canvas, longSide) {
    var longer = Math.max(canvas.width, canvas.height) || 1;
    if (longer <= longSide) return null;
    var scale = longSide / longer;
    var out = document.createElement("canvas");
    out.width = Math.max(1, Math.round(canvas.width * scale));
    out.height = Math.max(1, Math.round(canvas.height * scale));
    var image = null;
    try {
      var ctx = out.getContext("2d");
      ctx.drawImage(canvas, 0, 0, out.width, out.height);
      image = ctx.getImageData(0, 0, out.width, out.height);
    } catch (_) {}
    out.width = 0;
    out.height = 0;
    return image;
  }

  function pause() {
    return new Promise(function (resolve) {
      setTimeout(resolve, 0);
    });
  }

  // Three sizes, every pass. A hit at 1100 px must not hide a smaller code.
  async function collectQr(canvas, pageNum, qr, seen, deadline, cancelled) {
    var ctx = canvas.getContext("2d");
    var known = [];
    var passes = [
      { longSide: 1100, inversion: "attemptBoth" },
      { longSide: 1600, inversion: "dontInvert" },
      { longSide: 0, inversion: "dontInvert" },
    ];
    var i;
    var pass;
    var image;
    var finished;
    if (!ctx) return false;
    if (canvas.width < 8 || canvas.height < 8) return true;
    for (i = 0; i < passes.length; i++) {
      if (Date.now() >= deadline || cancelled()) return false;
      pass = passes[i];
      image = null;
      if (pass.longSide) {
        image = scaledImage(canvas, pass.longSide);
        if (!image) {
          await pause();
          continue;
        }
      } else {
        try {
          image = ctx.getImageData(0, 0, canvas.width, canvas.height);
        } catch (_) {
          return false;
        }
      }
      finished = readPass(image, pageNum, qr, seen, known, deadline, cancelled, pass.inversion);
      image = null;
      await pause();
      if (!finished) return false;
    }
    return true;
  }

  async function collectLinks(page, pageNum, links, seen) {
    var anns = await page.getAnnotations();
    for (var i = 0; i < anns.length && links.length < MAX_LINKS; i++) {
      var ann = anns[i];
      if (!ann || ann.subtype !== "Link") continue;
      var raw = String(ann.unsafeUrl || ann.url || "").trim();
      if (!raw || raw.charAt(0) === "#") continue;
      if (/^javascript:/i.test(raw)) continue;
      if (seen[raw]) continue;
      seen[raw] = true;
      links.push({ page: pageNum, url: raw });
    }
  }

  async function renderPage(page, deadline) {
    var base = page.getViewport({ scale: 1 });
    var longer = Math.max(base.width, base.height) || 1;
    var viewport = page.getViewport({ scale: RENDER_LONG / longer });
    var canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil(viewport.width));
    canvas.height = Math.max(1, Math.ceil(viewport.height));
    var task = page.render({
      canvas: canvas,
      viewport: viewport,
      background: "#ffffff",
    });
    await withBudget(task.promise, deadline);
    return canvas;
  }

  function toPreview(canvas) {
    var longer = Math.max(canvas.width, canvas.height) || 1;
    var scale = longer > PREVIEW_LONG ? PREVIEW_LONG / longer : 1;
    var w = Math.max(1, Math.round(canvas.width * scale));
    var h = Math.max(1, Math.round(canvas.height * scale));
    var out = document.createElement("canvas");
    out.width = w;
    out.height = h;
    var ctx = out.getContext("2d");
    if (!ctx) return "";
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(canvas, 0, 0, w, h);
    try {
      return out.toDataURL("image/jpeg", 0.82);
    } catch (_) {
      return "";
    }
  }

  function previewPages(canvases, qr) {
    var qrPage = Object.create(null);
    for (var i = 0; i < qr.length; i++) qrPage[qr[i].page] = true;
    var pages = [];
    for (var j = 0; j < canvases.length && pages.length < MAX_PREVIEWS; j++) {
      var item = canvases[j];
      if (!qrPage[item.num]) continue;
      var dataUrl = toPreview(item.canvas);
      if (dataUrl) pages.push({ num: item.num, dataUrl: dataUrl });
    }
    for (var k = 0; k < canvases.length; k++) {
      try {
        canvases[k].canvas.width = 0;
        canvases[k].canvas.height = 0;
      } catch (_) {}
    }
    return pages;
  }

  async function scan(bytes, opts) {
    var result = emptyResult();
    var loadingTask = null;
    var cancelled = opts && typeof opts.cancelled === "function" ? opts.cancelled : function () { return false; };
    try {
      if (!bytes || !bytes.length || bytes.length > MAX_BYTES) return result;
      if (!hasPdfHeader(bytes)) return result;
      var lib = await loadPdfJs();
      var deadline = Date.now() + TIME_BUDGET_MS;
      loadingTask = lib.getDocument({
        data: bytes,
        isEvalSupported: false,
        enableXfa: false,
        useSystemFonts: true,
        wasmUrl: wasmDir(),
      });
      var doc;
      try {
        doc = await withBudget(loadingTask.promise, deadline);
      } catch (err) {
        if (err && err.name === "PasswordException") result.locked = true;
        return result;
      }
      result.pageCount = doc.numPages || 0;
      var seenQr = Object.create(null);
      var seenLink = Object.create(null);
      var canvases = [];
      var limit = Math.min(MAX_PAGES, result.pageCount);
      var n;
      var linkPage;
      var page;
      var canvas;
      var done;
      result.scanLimit = limit;
      for (n = 1; n <= limit; n++) {
        if (cancelled()) break;
        if (result.links.length >= MAX_LINKS) break;
        try {
          linkPage = await doc.getPage(n);
          await collectLinks(linkPage, n, result.links, seenLink);
        } catch (_) {}
      }
      for (n = 1; n <= limit; n++) {
        if (Date.now() >= deadline || cancelled()) break;
        try {
          page = await withBudget(doc.getPage(n), deadline);
          canvas = await renderPage(page, deadline);
          done = await collectQr(canvas, n, result.qr, seenQr, deadline, cancelled);
          canvases.push({ num: n, canvas: canvas });
          if (done) result.scanned++;
        } catch (err) {
          if (err && err.message === "timeout") break;
        }
      }
      result.pages = previewPages(canvases, result.qr);
    } catch (_) {
    } finally {
      if (loadingTask) {
        try {
          await loadingTask.destroy();
        } catch (_) {}
      }
    }
    return result;
  }

  root.PeelPdf = { scan: scan };
})(typeof globalThis !== "undefined" ? globalThis : this);
