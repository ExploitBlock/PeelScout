(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.NestedEml = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var MAX_IMAGE = 2500000;
  var MAX_HTML = 400000;
  var MAX_RAW = 8000000;

  function isRfc822(name, contentType) {
    var n = (name || "").toLowerCase();
    var ct = (contentType || "").toLowerCase();
    return ct.indexOf("message/rfc822") !== -1 || ct.indexOf("application/vnd.ms-outlook") !== -1 || /\.eml$/i.test(n);
  }

  function decodeQP(str) {
    return String(str || "")
      .replace(/=\r?\n/g, "")
      .replace(/=([0-9A-Fa-f]{2})/g, function (_, h) {
        return String.fromCharCode(parseInt(h, 16));
      });
  }

  function decodeB64(str) {
    try {
      return atob(String(str || "").replace(/\s+/g, ""));
    } catch (_) {
      return "";
    }
  }

  function toUtf8(bin) {
    try {
      return decodeURIComponent(escape(bin));
    } catch (_) {
      return bin;
    }
  }

  function decodeText(bin, charset) {
    var cs = (charset || "utf-8").toLowerCase();
    if (cs.indexOf("utf-8") !== -1 || cs.indexOf("utf8") !== -1) return toUtf8(bin);
    return bin;
  }

  function decodeWord(s) {
    return String(s || "").replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, function (_, cs, enc, data) {
      var bin = enc.toUpperCase() === "B" ? decodeB64(data) : decodeQP(data.replace(/_/g, " "));
      return decodeText(bin, cs);
    });
  }

  function parseParams(header) {
    var out = { value: "", params: {} };
    if (!header) return out;
    var parts = [];
    var cur = "";
    var q = false;
    for (var i = 0; i < header.length; i++) {
      var c = header[i];
      if (c === '"') q = !q;
      else if (c === ";" && !q) {
        parts.push(cur);
        cur = "";
        continue;
      }
      cur += c;
    }
    parts.push(cur);
    out.value = (parts[0] || "").trim().toLowerCase();
    for (var j = 1; j < parts.length; j++) {
      var p = parts[j];
      var eq = p.indexOf("=");
      if (eq < 0) continue;
      var k = p.slice(0, eq).trim().toLowerCase();
      var v = p.slice(eq + 1).trim().replace(/^"/, "").replace(/"$/, "");
      out.params[k] = v;
    }
    return out;
  }

  function parseHeaders(block) {
    var unfolded = String(block || "").replace(/\r\n/g, "\n").replace(/\n[ \t]+/g, " ");
    var headers = {};
    var lines = unfolded.split("\n");
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var idx = line.indexOf(":");
      if (idx < 0) continue;
      var name = line.slice(0, idx).trim().toLowerCase();
      var val = line.slice(idx + 1).trim();
      if (headers[name]) headers[name] += ", " + val;
      else headers[name] = val;
    }
    return headers;
  }

  function splitHeadBody(raw) {
    var n = String(raw || "").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
    var i = n.indexOf("\n\n");
    if (i < 0) return { head: n, body: "" };
    return { head: n.slice(0, i), body: n.slice(i + 2) };
  }

  function decodePartBody(body, te) {
    var t = (te || "7bit").toLowerCase();
    if (t.indexOf("base64") !== -1) return decodeB64(body);
    if (t.indexOf("quoted-printable") !== -1) return decodeQP(body);
    return String(body || "").replace(/\r\n/g, "\n");
  }

  function splitMultipart(body, boundary) {
    if (!boundary) return [];
    var text = String(body || "").replace(/\r\n/g, "\n");
    var delim = "--" + boundary;
    var chunks = text.split(delim);
    var parts = [];
    for (var i = 0; i < chunks.length; i++) {
      var c = chunks[i];
      if (!c || c.indexOf("--") === 0) continue;
      if (c.charAt(0) === "\n") c = c.slice(1);
      c = c.replace(/\n$/, "");
      if (!c.trim() || c.trim() === "--") continue;
      parts.push(c);
    }
    return parts;
  }

  function parseEntity(raw, depth) {
    depth = depth || 0;
    var hb = splitHeadBody(raw);
    var headers = parseHeaders(hb.head);
    var ct = parseParams(headers["content-type"] || "text/plain");
    var te = (headers["content-transfer-encoding"] || "7bit").toLowerCase();
    var cd = parseParams(headers["content-disposition"] || "");
    var cid = (headers["content-id"] || "").replace(/[<>]/g, "").trim();
    var name = cd.params.filename || ct.params.name || "";
    if (depth < 3 && (ct.value === "message/rfc822" || isRfc822(name, ct.value))) {
      return { kind: "rfc822", headers: headers, name: name, message: parseMessage(decodePartBody(hb.body, te), depth + 1) };
    }
    if (ct.value.indexOf("multipart/") === 0) {
      var kids = splitMultipart(hb.body, ct.params.boundary);
      var parts = [];
      for (var i = 0; i < kids.length; i++) parts.push(parseEntity(kids[i], depth));
      return { kind: "multipart", headers: headers, parts: parts };
    }
    return {
      kind: "leaf",
      contentType: ct.value,
      headers: headers,
      name: name,
      cid: cid,
      charset: ct.params.charset,
      bytes: decodePartBody(hb.body, te),
    };
  }

  function emptyMsg() {
    return { subject: "", from: "", html: "", text: "", images: [], nested: [] };
  }

  function parseMessage(raw, depth) {
    var msg = emptyMsg();
    if (!raw) return msg;
    var entity = parseEntity(raw, depth || 0);
    if (entity.kind === "rfc822" && entity.message) return entity.message;

    function takeHeaders(h) {
      if (!h) return;
      if (h.subject) msg.subject = decodeWord(h.subject);
      if (h.from) msg.from = decodeWord(h.from);
    }

    function addImage(ent) {
      if (!ent.bytes || ent.bytes.length > MAX_IMAGE) return;
      var mime = ent.contentType || "image/png";
      if (mime.indexOf("image/") !== 0) mime = "image/png";
      var dataUrl;
      try {
        dataUrl = "data:" + mime + ";base64," + btoa(ent.bytes);
      } catch (_) {
        return;
      }
      msg.images.push({ cid: ent.cid || "", name: ent.name || "", mime: mime, dataUrl: dataUrl });
    }

    function walk(ent) {
      if (!ent) return;
      if (ent.kind === "rfc822") {
        if (ent.message) msg.nested.push(ent.message);
        return;
      }
      if (ent.kind === "multipart") {
        for (var i = 0; i < ent.parts.length; i++) walk(ent.parts[i]);
        return;
      }
      var ct = ent.contentType || "";
      if (ct.indexOf("text/html") === 0) {
        if (!msg.html) msg.html = decodeText(ent.bytes, ent.charset).slice(0, MAX_HTML);
      } else if (ct.indexOf("text/plain") === 0) {
        if (!msg.text) msg.text = decodeText(ent.bytes, ent.charset).slice(0, MAX_HTML);
      } else if (ct.indexOf("image/") === 0) {
        addImage(ent);
      }
    }

    takeHeaders(entity.headers);
    walk(entity);
    return msg;
  }

  function flatten(msg, filename) {
    var list = [];
    function push(m, name) {
      if (!m) return;
      if (!m.html && !m.text && !(m.images && m.images.length)) {
        if (m.nested && m.nested.length) {
          for (var i = 0; i < m.nested.length; i++) push(m.nested[i], name);
        }
        return;
      }
      list.push({
        filename: name || "",
        subject: m.subject || "",
        from: m.from || "",
        html: m.html || "",
        text: m.text || "",
        images: m.images || [],
      });
      if (m.nested) {
        for (var j = 0; j < m.nested.length; j++) push(m.nested[j], name);
      }
    }
    push(msg, filename);
    return list.slice(0, 5);
  }

  function parse(raw, filename) {
    if (!raw || raw.length > MAX_RAW) return [];
    return flatten(parseMessage(raw, 0), filename || "");
  }

  async function fileToRaw(file) {
    var buf = await file.arrayBuffer();
    if (buf.byteLength > MAX_RAW) return "";
    var bytes = new Uint8Array(buf);
    var s = "";
    var chunk = 0x8000;
    for (var i = 0; i < bytes.length; i += chunk) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return s;
  }

  return { isRfc822: isRfc822, parse: parse, parseMessage: parseMessage, fileToRaw: fileToRaw };
});
