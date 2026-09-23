/**
 * Phone numbers from nested-EML text and inner images (OCRAD if loaded).
 */
(function (root) {
  "use strict";

  function extractPhones(text) {
    var s = String(text || "").replace(/\u00a0/g, " ");
    var out = [];
    var seen = Object.create(null);
    var re =
      /(?:\+|00)\d{1,3}[\s./-]*\(?\d{2,4}\)?[\s./-]*\d{2,4}[\s./-]*\d{2,4}(?:[\s./-]*\d{2,4})?|\(?\d{2,4}\)?[\s./-]\d{2,4}[\s./-]\d{3,4}(?:[\s./-]\d{3,4})?|\b\d{3}[\s.-]\d{3}[\s.-]\d{4}\b|\b\d{2}[\s.-]\d{4}[\s.-]\d{4}\b|\b\d{10,13}\b/g;
    var m;
    while ((m = re.exec(s))) {
      var raw = m[0].trim().replace(/[.]{2,}/g, " ");
      var digits = raw.replace(/\D/g, "");
      if (digits.length < 10 || digits.length > 15) continue;
      if (/^(.)\1+$/.test(digits)) continue;
      if (/^20(1[6-9]|2[0-9])/.test(digits) && digits.length === 8) continue;
      if (seen[digits]) continue;
      seen[digits] = true;
      out.push(raw.replace(/\s+/g, " "));
    }
    return out;
  }

  function ocrDataUrl(dataUrl) {
    return new Promise(function (resolve) {
      var fn = root.OCRAD;
      if (typeof fn !== "function" || !dataUrl) {
        resolve("");
        return;
      }
      var img = new Image();
      img.onload = function () {
        try {
          var w = img.naturalWidth || img.width;
          var h = img.naturalHeight || img.height;
          if (w < 24 || h < 24 || w * h > 16000000) {
            resolve("");
            return;
          }
          var scale = 1;
          if (Math.max(w, h) < 900) scale = Math.min(2.2, 900 / Math.max(w, h));
          var c = document.createElement("canvas");
          c.width = Math.max(1, Math.round(w * scale));
          c.height = Math.max(1, Math.round(h * scale));
          var ctx = c.getContext("2d");
          ctx.fillStyle = "#fff";
          ctx.fillRect(0, 0, c.width, c.height);
          ctx.drawImage(img, 0, 0, c.width, c.height);
          var mixed = "";
          try {
            mixed = fn(c) || "";
          } catch (_) {}
          var nums = "";
          try {
            nums = fn(c, { numeric: true }) || "";
          } catch (_) {}
          resolve(String(mixed) + "\n" + String(nums));
        } catch (_) {
          resolve("");
        }
      };
      img.onerror = function () {
        resolve("");
      };
      img.src = dataUrl;
    });
  }

  root.PeelPhones = { extractPhones: extractPhones, ocrDataUrl: ocrDataUrl };
})(typeof globalThis !== "undefined" ? globalThis : this);
