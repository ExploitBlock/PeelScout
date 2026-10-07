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
    return { pageCount: 0, pages: [], qr: [], links: [], locked: false };
  }

  function loadPdfJs() {
    if (pdfPromise) return pdfPromise;
    pdfPromise = import(messenger.runtime.getURL("pdfjs/pdf.min.mjs"))
      .then(function (lib) {
        if (lib.GlobalWorkerOptions) {
          lib.GlobalWorkerOptions.workerSrc = messenger.runtime.getURL("pdfjs/pdf.worker.min.mjs");
        }
        return lib;
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

  function paintWhite(ctx, location, ox, oy) {
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
    for (var i = 0; i < corners.length; i++) {
      var corner = corners[i];
      if (!corner) continue;
      var x = corner.x + ox;
      var y = corner.y + oy;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    if (minX === Infinity) return;
    var margin = 16;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(minX - margin, minY - margin, maxX - minX + margin * 2, maxY - minY + margin * 2);
  }

  function scanRegion(ctx, x, y, w, h, pageNum, qr, seen, deadline) {
    if (w < 8 || h < 8) return 0;
    var fn = root.jsQR;
    if (!fn) return 0;
    var hits = 0;
    while (hits < MAX_CODES) {
      if (Date.now() >= deadline) return hits;
      var image;
      try {
        image = ctx.getImageData(x, y, w, h);
      } catch (_) {
        return hits;
      }
      var code;
      try {
        code = fn(image.data, image.width, image.height);
      } catch (_) {
        return hits;
      }
      if (!code || !code.data) return hits;
      var payload = String(code.data);
      if (!seen[payload]) {
        seen[payload] = true;
        qr.push({ page: pageNum, payload: payload });
      }
      if (!code.location) return hits + 1;
      paintWhite(ctx, code.location, x, y);
      hits++;
    }
    return hits;
  }

  function collectQr(canvas, pageNum, qr, seen, deadline) {
    var ctx = canvas.getContext("2d");
    if (!ctx) return;
    var hits = scanRegion(ctx, 0, 0, canvas.width, canvas.height, pageNum, qr, seen, deadline);
    if (hits > 0) return;
    var tw = Math.floor(canvas.width / 2);
    var th = Math.floor(canvas.height / 2);
    if (tw < 8 || th < 8) return;
    var xs = [0, Math.floor((canvas.width - tw) / 2), canvas.width - tw];
    var ys = [0, Math.floor((canvas.height - th) / 2), canvas.height - th];
    for (var yi = 0; yi < ys.length; yi++) {
      for (var xi = 0; xi < xs.length; xi++) {
        if (Date.now() >= deadline) return;
        scanRegion(ctx, xs[xi], ys[yi], tw, th, pageNum, qr, seen, deadline);
      }
    }
  }

  async function collectLinks(page, pageNum, links, seen, deadline) {
    var anns = await withBudget(page.getAnnotations(), deadline);
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
      if (item.num > 2 && !qrPage[item.num]) continue;
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

  async function scan(bytes) {
    var result = emptyResult();
    var loadingTask = null;
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
      for (var n = 1; n <= limit; n++) {
        if (Date.now() >= deadline) break;
        var page = null;
        try {
          page = await withBudget(doc.getPage(n), deadline);
          var canvas = await renderPage(page, deadline);
          collectQr(canvas, n, result.qr, seenQr, deadline);
          canvases.push({ num: n, canvas: canvas });
        } catch (err) {
          if (err && err.message === "timeout") break;
          continue;
        }
        if (result.links.length >= MAX_LINKS) continue;
        try {
          await collectLinks(page, n, result.links, seenLink, deadline);
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
