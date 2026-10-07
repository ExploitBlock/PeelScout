/**
 * Phone numbers from nested-EML text.
 * PeelPhones.extractPhones(text, opts) → up to 3 display strings.
 */
(function (root) {
  "use strict";

  var PHONE_NEAR =
    /\b(?:whatsapp|telephone|helpline|hotline|support|contact|mobile|phone|cell|call|dial|tel)\b|\bhelp\s+desk\b|\btoll[\s-]+free\b|\bcustomer\s+(?:care|service)\b/i;
  var ID_WORD =
    /^(?:invoice|order|reference|transaction|account|tracking|ticket|acct|case|ref|id|no)$/i;
  var BLOB = /(?:\+)?(?:[().\-\s]{0,3}\d){10,}/g;
  var TOLL_FREE = /^(?:800|833|844|855|866|877|888)/;

  function fixOcrText(text) {
    return text.split(/(\s+)/).map(function (part) {
      if (!part || /^\s+$/.test(part)) return part;
      return fixOcrToken(part);
    }).join("");
  }

  function fixOcrToken(token) {
    var digits = 0;
    var letters = 0;
    var i;
    var c;
    for (i = 0; i < token.length; i++) {
      c = token.charAt(i);
      if (c >= "0" && c <= "9") digits++;
      else if ((c >= "A" && c <= "Z") || (c >= "a" && c <= "z")) letters++;
    }
    if (digits === 0 || digits <= letters) return token;
    return token
      .replace(/[Oo]/g, "0")
      .replace(/[lI|]/g, "1")
      .replace(/S/g, "5")
      .replace(/B/g, "8");
  }

  function hasKeyword(line, prev) {
    return PHONE_NEAR.test(line) || PHONE_NEAR.test(prev || "");
  }

  function hasIdLabel(line, start) {
    var i = start;
    var j;
    while (i > 0 && /[\s#:.\-]/.test(line.charAt(i - 1))) i--;
    if (line.slice(i, start).indexOf("#") !== -1) return true;
    j = i;
    while (j > 0 && /[A-Za-z]/.test(line.charAt(j - 1))) j--;
    if (j === i) return false;
    return ID_WORD.test(line.slice(j, i));
  }

  function isDate(raw) {
    var t = raw.replace(/\s+/g, " ").trim();
    if (/^\d{4}-\d{2}-\d{2}(?: \d{1,2}(?::\d{2}(?::\d{2})?)?)?$/.test(t)) return true;
    if (/^\d{2}[-/.]\d{2}[-/.]\d{4}(?: \d{1,2}(?::\d{2}(?::\d{2})?)?)?$/.test(t)) return true;
    return false;
  }

  function isCurrency(line, start, raw) {
    var i = start;
    while (i > 0 && line.charAt(i - 1) === " ") i--;
    if (i > 0 && /[$€£₹]/.test(line.charAt(i - 1))) return true;
    if (raw.indexOf(",") !== -1) return true;
    return /\.\d{1,2}$/.test(raw);
  }

  function isIp(raw) {
    var parts = raw.split(".");
    var i;
    var n;
    if (parts.length !== 4) return false;
    for (i = 0; i < 4; i++) {
      if (!/^\d{1,3}$/.test(parts[i])) return false;
      n = +parts[i];
      if (n > 255) return false;
    }
    return true;
  }

  function isBoring(digits) {
    var up = true;
    var down = true;
    var i;
    var prev;
    var cur;
    if (/^(.)\1+$/.test(digits)) return true;
    for (i = 1; i < digits.length; i++) {
      prev = digits.charCodeAt(i - 1) - 48;
      cur = digits.charCodeAt(i) - 48;
      if (cur !== (prev + 1) % 10) up = false;
      if (cur !== (prev + 9) % 10) down = false;
    }
    return up || down;
  }

  function failsNanp(digits) {
    var n = digits;
    if (digits.length === 11 && digits.charAt(0) === "1") n = digits.slice(1);
    else if (digits.length !== 10) return false;
    return n.charAt(0) < "2" || n.charAt(3) < "2";
  }

  function isTollFree(digits) {
    var n = digits;
    if (digits.length === 11 && digits.charAt(0) === "1") n = digits.slice(1);
    if (n.length !== 10) return false;
    return TOLL_FREE.test(n);
  }

  function isBare(raw) {
    return raw.charAt(0) !== "+" && !/[,().\-\s]/.test(raw);
  }

  function collectLine(line, prev, found, seen) {
    var re = new RegExp(BLOB.source, "g");
    var m;
    while ((m = re.exec(line))) {
      var start = m.index;
      var raw = m[0];
      var lead = /^\s+/.exec(raw);
      var end;
      var before;
      var after;
      var digits;
      var display;
      var score;
      if (lead) {
        start += lead[0].length;
        raw = raw.slice(lead[0].length);
      }
      raw = raw.replace(/\s+$/, "");
      end = start + raw.length;
      before = start > 0 ? line.charAt(start - 1) : "";
      after = end < line.length ? line.charAt(end) : "";
      if (/[A-Za-z0-9]/.test(before) || /[A-Za-z0-9]/.test(after)) continue;
      digits = raw.replace(/\D/g, "");
      if (digits.length < 10 || digits.length > 15) continue;
      if (hasIdLabel(line, start)) continue;
      if (isDate(raw) || isCurrency(line, start, raw) || isIp(raw) || isBoring(digits)) continue;
      if (isBare(raw) && !hasKeyword(line, prev)) continue;
      if (failsNanp(digits)) continue;
      display = raw.trim();
      score = 0;
      if (hasKeyword(line, prev)) score += 4;
      if (display.charAt(0) === "+" || display.indexOf("(") !== -1) score += 2;
      if (isTollFree(digits)) score += 1;
      if (seen[digits] != null) {
        if (score > found[seen[digits]].score) {
          found[seen[digits]].score = score;
          found[seen[digits]].display = display;
        }
        continue;
      }
      seen[digits] = found.length;
      found.push({ score: score, display: display });
    }
  }

  function extractPhones(text, opts) {
    var src = String(text || "").replace(/\u00a0/g, " ").replace(/\t/g, " ");
    var lines;
    var found;
    var seen;
    var i;
    var out;
    if (opts && opts.ocr === true) src = fixOcrText(src);
    lines = src.split(/\r\n|\n|\r/);
    found = [];
    seen = Object.create(null);
    for (i = 0; i < lines.length; i++) {
      collectLine(lines[i], i > 0 ? lines[i - 1] : "", found, seen);
    }
    found.sort(function (a, b) {
      return b.score - a.score;
    });
    out = [];
    for (i = 0; i < found.length && out.length < 3; i++) out.push(found[i].display);
    return out;
  }

  root.PeelPhones = { extractPhones: extractPhones };
})(typeof globalThis !== "undefined" ? globalThis : this);
