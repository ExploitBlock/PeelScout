/**
 * One-layer email-security wrapper unwrap.
 * Readable form: decode the vendor wrapper once, leave inner %xx intact.
 */
(function (root, factory) {
  var inflate =
    (typeof inflateZlib === "function" && inflateZlib) ||
    (typeof module === "object" && module.exports && require("./inflate-zlib.js").inflateZlib);
  if (typeof module === "object" && module.exports) module.exports = factory(inflate);
  else root.WrapperUnwrap = factory(inflate);
})(typeof globalThis !== "undefined" ? globalThis : this, function (inflateZlibFn) {
  "use strict";
  function safeDecode(s) {
    if (s == null) return s;
    try { return decodeURIComponent(s.replace(/\+/g, " ")); }
    catch (_) { try { return unescape(s); } catch (_) { return s; } }
  }
  function parseUrl(href) { try { return new URL(href); } catch (_) { return null; } }
  function looksLikeUrl(s) { return typeof s === "string" && /^https?:\/\//i.test(s.trim()); }
  function b64urlDecode(s) {
    if (!s) return "";
    let t = String(s).replace(/-/g, "+").replace(/_/g, "/");
    while (t.length % 4) t += "=";
    try { return atob(t); } catch (_) { return ""; }
  }
  function param(u, names) {
    for (const n of names) { const v = u.searchParams.get(n); if (v) return v; }
    return null;
  }
  function microsoftSafeLinks(href) {
    const u = parseUrl(href);
    if (!u) return null;
    if (!/(^|\.)safelinks\.protection\.outlook\.com$/i.test(u.hostname)) return null;
    const inner = u.searchParams.get("url");
    return inner && looksLikeUrl(inner) ? { vendor: "Microsoft Safe Links", url: inner } : null;
  }
  function proofpointV2orV1(href) {
    const u = parseUrl(href);
    if (!u) return null;
    if (!/(^|\.)urldefense(\.proofpoint)?\.com$/i.test(u.hostname) && !/(^|\.)urldefense\.us$/i.test(u.hostname)) return null;
    if (/\/v3\//i.test(u.pathname)) return null;
    const raw = u.searchParams.get("u");
    if (!raw) return null;
    let decoded = safeDecode(raw.replace(/-/g, "%").replace(/_/g, "/"));
    if (!looksLikeUrl(decoded)) {
      const plain = safeDecode(raw);
      if (looksLikeUrl(plain)) decoded = plain;
    }
    return looksLikeUrl(decoded) ? { vendor: "Proofpoint URL Defense", url: decoded } : null;
  }
  function proofpointV3(href) {
    if (!/urldefense(\.proofpoint)?\.com|urldefense\.us/i.test(href)) return null;
    const m = href.match(/\/v3\/__(.+?)__;([^!]*)/i);
    if (!m) return null;
    let url = m[1];
    try { url = decodeURIComponent(url); } catch (_) {}
    const enc = m[2] || "";
    if (!enc) {
      return looksLikeUrl(url.replace(/\*/g, "")) ? { vendor: "Proofpoint URL Defense v3", url: url.replace(/\*/g, "") } : null;
    }
    const bytes = b64urlDecode(enc);
    if (!bytes) return looksLikeUrl(url) ? { vendor: "Proofpoint URL Defense v3", url: url } : null;
    const map = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let i = 0;
    url = url.replace(/\*\*([A-Za-z0-9\-_])|\*/g, function (tok, run) {
      if (run != null) {
        const n = map.indexOf(run) + 2;
        const slice = bytes.slice(i, i + Math.max(n, 0));
        i += Math.max(n, 0);
        return slice;
      }
      return bytes.charAt(i++) || "";
    });
    return looksLikeUrl(url) ? { vendor: "Proofpoint URL Defense v3", url: url } : null;
  }
  function barracuda(href) {
    const u = parseUrl(href);
    if (!u || !/(^|\.)linkprotect\.cudasvc\.com$/i.test(u.hostname)) return null;
    const inner = u.searchParams.get("a");
    return inner && looksLikeUrl(inner) ? { vendor: "Barracuda Link Protect", url: inner } : null;
  }
  function zlibToText(b64) {
    if (!inflateZlibFn || !b64) return "";
    try {
      const bin = b64urlDecode(b64);
      if (!bin) return "";
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const out = inflateZlibFn(bytes);
      let s = "";
      for (let i = 0; i < out.length; i++) s += String.fromCharCode(out[i]);
      return s;
    } catch (_) { return ""; }
  }
  function egress(href) {
    const u = parseUrl(href);
    if (!u || !/(^|\.)defend\.egress\.com$/i.test(u.hostname)) return null;
    const b64 = u.searchParams.get("Base64Url") || u.searchParams.get("base64Url");
    if (b64) {
      const inner = zlibToText(b64);
      if (looksLikeUrl(inner)) return { vendor: "Egress Defend", url: inner };
    }
    const direct = param(u, ["url", "u"]);
    if (direct && looksLikeUrl(direct)) return { vendor: "Egress Defend", url: direct };
    const hostHint = u.searchParams.get("Domain") || u.searchParams.get("@OriginalLink") || u.searchParams.get("OriginalLink");
    return { vendor: "Egress Defend", url: null, note: hostHint ? "Token / warning wrapper; destination host is " + hostHint : "Wrapper found; destination is not in a readable parameter." };
  }
  function symantec(href) {
    const u = parseUrl(href);
    if (!u) return null;
    const h = u.hostname.toLowerCase();
    if (!/(^|\.)clicktime\.symantec\.com$/i.test(h) && !/(^|\.)clicktime\.symanteccloud\.com$/i.test(h) && !/(^|\.)clicktime\.broadcom\.com$/i.test(h)) return null;
    const inner = param(u, ["u", "url"]);
    if (inner && looksLikeUrl(inner)) return { vendor: "Symantec Click-time", url: inner };
    return { vendor: "Symantec Click-time", url: null, note: "Wrapper found but the destination was not in u=." };
  }
  function sophos(href) {
    const u = parseUrl(href);
    if (!u || !/(^|\.)protection\.sophos\.com$/i.test(u.hostname)) return null;
    const rawU = u.searchParams.get("u");
    if (rawU) {
      let inner = rawU;
      if (!looksLikeUrl(inner)) {
        const b64 = b64urlDecode(rawU);
        inner = looksLikeUrl(b64) ? b64 : safeDecode(rawU);
      }
      if (looksLikeUrl(inner)) return { vendor: "Sophos Email", url: inner };
    }
    const d = u.searchParams.get("d");
    if (d) return { vendor: "Sophos Email", url: null, note: "Token wrapper; destination host is " + d };
    return { vendor: "Sophos Email", url: null, note: "Token wrapper; original URL is not in the link." };
  }
  function cisco(href) {
    const u = parseUrl(href);
    if (!u || !/(^|\.)secure-web\.cisco\.com$/i.test(u.hostname)) return null;
    const parts = u.pathname.split("/").filter(Boolean);
    const inner = safeDecode(parts[parts.length - 1] || "");
    return looksLikeUrl(inner) ? { vendor: "Cisco Secure Email", url: inner } : null;
  }
  function mimecast(href) {
    const u = parseUrl(href);
    if (!u) return null;
    const h = u.hostname;
    if (!/(^|\.)mimecastprotect\.com$/i.test(h) && !/(^|\.)mimecast\.com$/i.test(h)) return null;
    if (!/mimecastprotect|protect-[a-z0-9-]+\.mimecast\.com/i.test(h)) return null;
    const domain = u.searchParams.get("domain");
    return { vendor: "Mimecast URL Protect", url: null, note: domain ? "Token wrapper; destination host is " + domain : "Token wrapper; original URL is not in the link." };
  }
  function trendMicro(href) {
    const u = parseUrl(href);
    if (!u) return null;
    if (!/(urlprotect|ctp)\.trendmicro\.com$/i.test(u.hostname) && !/clicktime\.trendmicro\.com$/i.test(u.hostname)) return null;
    const inner = param(u, ["destination", "url", "r", "u"]);
    if (inner && looksLikeUrl(inner)) return { vendor: "Trend Micro URL Protect", url: inner };
    const maybe = inner ? safeDecode(inner) : null;
    if (maybe && looksLikeUrl(maybe)) return { vendor: "Trend Micro URL Protect", url: maybe };
    return { vendor: "Trend Micro URL Protect", url: null, note: "Could not extract destination offline." };
  }
  function libraesva(href) {
    const u = parseUrl(href);
    if (!u || !/(^|\.)urlsand\.esvalabs\.com$/i.test(u.hostname)) return null;
    const inner = u.searchParams.get("u") || u.searchParams.get("url");
    return inner && looksLikeUrl(inner) ? { vendor: "Libraesva URLSand", url: inner } : null;
  }
  function intermediaVipre(href) {
    const u = parseUrl(href);
    if (!u) return null;
    if (!/(^|\.)url\.emailprotection\.link$/i.test(u.hostname) && !/(^|\.)safe\.intermedia\.net$/i.test(u.hostname)) return null;
    const inner = param(u, ["u", "url"]);
    if (inner && looksLikeUrl(inner)) return { vendor: "Intermedia / VIPRE LinkSafe", url: inner };
    if (inner) {
      const b64 = b64urlDecode(inner);
      if (looksLikeUrl(b64)) return { vendor: "Intermedia / VIPRE LinkSafe", url: b64 };
    }
    return { vendor: "Intermedia / VIPRE LinkSafe", url: null, note: "Token wrapper; original URL is not in the link." };
  }
  function genericQuery(href) {
    const u = parseUrl(href);
    if (!u) return null;
    const known = [
      [/(^|\.)fortimailcloud\.com$/i, "FortiMail"],
      [/(^|\.)atpscan\.global\.hornetsecurity\.com$/i, "Hornetsecurity"],
      [/(^|\.)urlshield\.synaq\.com$/i, "SYNAQ"],
      [/(^|\.)linklock\.titanhq\.com$/i, "TitanHQ"]
    ];
    let vendor = null;
    for (const [re, name] of known) { if (re.test(u.hostname)) { vendor = name; break; } }
    if (!vendor) return null;
    const inner = param(u, ["url", "u", "destination", "dest", "a", "target"]);
    if (inner && looksLikeUrl(inner)) return { vendor, url: inner };
    if (inner) {
      const b64 = b64urlDecode(inner);
      if (looksLikeUrl(b64)) return { vendor, url: b64 };
    }
    return { vendor, url: null, note: "Wrapper detected; destination not embedded in a known parameter." };
  }
  const DETECTORS = [microsoftSafeLinks, proofpointV3, proofpointV2orV1, barracuda, symantec, egress, sophos, cisco, mimecast, trendMicro, libraesva, intermediaVipre, genericQuery];
  function unwrapOnce(href) {
    if (!href || typeof href !== "string") return { changed: false, url: href };
    const trimmed = href.trim();
    for (const det of DETECTORS) {
      let hit = null;
      try { hit = det(trimmed); } catch (_) { hit = null; }
      if (!hit) continue;
      if (hit.url && hit.url !== trimmed) return { changed: true, url: hit.url, vendor: hit.vendor, original: trimmed };
      return { changed: false, url: trimmed, vendor: hit.vendor, note: hit.note || "Wrapper found but cannot be decoded offline.", original: trimmed };
    }
    return { changed: false, url: trimmed };
  }
  function meetRedirect(href) {
    const u = parseUrl(href);
    if (!u || !/(^|\.)meet\.google\.com$/i.test(u.hostname) || !/linkredirect/i.test(u.pathname)) return null;
    const dest = u.searchParams.get("dest");
    return dest && looksLikeUrl(dest) ? { vendor: "Google Meet linkredirect", url: dest } : null;
  }
  function googleUrlRedirect(href) {
    const u = parseUrl(href);
    if (!u) return null;
    if (!/(^|\.)google\.[a-z.]+$/i.test(u.hostname) && !/(^|\.)google\.com$/i.test(u.hostname)) return null;
    if (!/^\/url$/i.test(u.pathname)) return null;
    const inner = param(u, ["q", "url", "dest"]);
    return inner && looksLikeUrl(inner) ? { vendor: "Google /url redirect", url: inner } : null;
  }
  function unwrapStep(href, includeRedirects) {
    const first = unwrapOnce(href);
    if (first.changed || !includeRedirects) return first;
    const trimmed = (href || "").trim();
    for (const det of [meetRedirect, googleUrlRedirect]) {
      let hit = null;
      try { hit = det(trimmed); } catch (_) { hit = null; }
      if (hit && hit.url && hit.url !== trimmed) return { changed: true, url: hit.url, vendor: hit.vendor, original: trimmed };
    }
    return first;
  }
  return { unwrapOnce, unwrapStep, host: function (href) { const u = parseUrl(href); return u ? u.hostname.toLowerCase() : ""; } };
});
