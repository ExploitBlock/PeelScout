(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.IcsLinks = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  function unfold(text) {
    return String(text || "").replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "");
  }
  function unescapeIcs(value) {
    return String(value || "").replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
  }
  function pullUrls(text) {
    const found = [];
    const re = /https?:\/\/[^\s<>"'\\]+/gi;
    let m;
    while ((m = re.exec(text))) {
      let u = m[0].replace(/[),.;]+$/, "");
      if (found.indexOf(u) === -1) found.push(u);
    }
    return found;
  }
  function parseIcsUrls(raw) {
    const text = unfold(raw);
    const urls = [];
    const lines = text.split(/\n/);
    const interesting = /^(URL|LOCATION|DESCRIPTION|SUMMARY|X-GOOGLE-CONFERENCE|X-MICROSOFT-SKYPETEAMSMEETINGURL|X-ALT-DESC|COMMENT)/i;
    for (const line of lines) {
      const idx = line.indexOf(":");
      if (idx < 0) continue;
      const name = line.slice(0, idx).split(";")[0];
      if (!interesting.test(name)) continue;
      const value = unescapeIcs(line.slice(idx + 1));
      for (const u of pullUrls(value)) {
        if (urls.indexOf(u) === -1) urls.push(u);
      }
    }
    if (!urls.length) {
      for (const u of pullUrls(text)) {
        if (urls.indexOf(u) === -1) urls.push(u);
      }
    }
    return urls;
  }
  function isCalendarPart(name, contentType) {
    const n = (name || "").toLowerCase();
    const ct = (contentType || "").toLowerCase();
    return ct.indexOf("text/calendar") !== -1 || ct.indexOf("application/ics") !== -1 || /\.ics$/i.test(n);
  }
  return { parseIcsUrls, isCalendarPart };
});
