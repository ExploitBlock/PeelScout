(function () {
  if (!globalThis.WrapperUnwrap) return;
  if (globalThis.__peelScoutMessageScript) return;
  globalThis.__peelScoutMessageScript = true;
  const api = globalThis.browser || globalThis.messenger;
  let lastLink = null;
  const qrShown = Object.create(null);
  let outerQrGen = 0;
  let outerQrKeys = [];
  let pdfToken = null;
  let pdfTokenKnown = false;
  const pdfQueue = [];
  let nestInners = [];

  function clearQrShown() {
    for (const k of Object.keys(qrShown)) delete qrShown[k];
    outerQrKeys = [];
  }

  function rewriteAnchors(root) {
    if (!root || !root.querySelectorAll) return;
    const links = root.querySelectorAll("a[href], area[href]");
    for (const a of links) {
      const href = a.getAttribute("href");
      if (!href || href.startsWith("mailto:") || href.startsWith("#")) continue;
      if (a.hasAttribute("data-wrapper-original")) continue;
      const out = WrapperUnwrap.unwrapOnce(href);
      if (!out.changed) continue;
      a.setAttribute("data-wrapper-original", href);
      a.setAttribute("data-wrapper-vendor", out.vendor || "");
      a.setAttribute("href", out.url);
      a.setAttribute(
        "title",
        "Unwrapped " + (out.vendor || "security wrapper") + "\nRight-click for original or keep unwrapping"
      );
      a.classList.add("wrapper-unwrapped");
    }
  }

  function closePanel() {
    const el = document.getElementById("wrapper-unwrap-panel");
    if (el) el.remove();
  }

  function copyLocal(text) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    (document.body || document.documentElement).appendChild(ta);
    let ok = false;
    try {
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      ok = !!document.execCommand("copy");
    } catch (_) {}
    ta.remove();
    return ok;
  }

  function copyText(text) {
    const value = String(text == null ? "" : text);
    if (!api || !api.runtime || !api.runtime.sendMessage) return Promise.resolve(copyLocal(value));
    let sent;
    try {
      sent = api.runtime.sendMessage({ type: "copy-text", text: value });
    } catch (_) {
      return Promise.resolve(copyLocal(value));
    }
    return Promise.resolve(sent).then(
      function (ok) {
        return ok === true || copyLocal(value);
      },
      function () {
        return copyLocal(value);
      }
    );
  }

  function showOriginal(info) {
    closePanel();
    if (!info || !info.original) return;
    const panel = document.createElement("div");
    panel.id = "wrapper-unwrap-panel";
    const vendor = info.vendor || "security wrapper";
    panel.innerHTML =
      '<div class="wup-card"><h3>Original wrapper</h3><p class="wup-vendor">' +
      vendor +
      '</p><label>Wrapped URL</label><textarea readonly id="wup-orig"></textarea><label>Unwrapped URL</label><textarea readonly id="wup-clean"></textarea><div class="wup-actions"><button type="button" id="wup-copy-orig">Copy wrapped</button><button type="button" id="wup-copy-clean">Copy unwrapped</button><button type="button" id="wup-more">Keep unwrapping…</button><button type="button" id="wup-close">Close</button></div></div>';
    document.documentElement.appendChild(panel);
    panel.querySelector("#wup-orig").value = info.original;
    panel.querySelector("#wup-clean").value = info.unwrapped || "";
    panel.querySelector("#wup-copy-orig").addEventListener("click", function () {
      copyText(info.original);
    });
    panel.querySelector("#wup-copy-clean").addEventListener("click", function () {
      copyText(info.unwrapped || "");
    });
    panel.querySelector("#wup-more").addEventListener("click", function () {
      showStepper(info);
    });
    panel.querySelector("#wup-close").addEventListener("click", closePanel);
    panel.addEventListener("click", function (e) {
      if (e.target === panel) closePanel();
    });
  }

  function showStepper(info) {
    closePanel();
    if (!info) return;
    const start = info.unwrapped || info.original || "";
    const steps = [];
    if (info.original && info.unwrapped && info.original !== info.unwrapped)
      steps.push((info.vendor || "First wrapper") + " (automatic)");
    const panel = document.createElement("div");
    panel.id = "wrapper-unwrap-panel";
    panel.innerHTML =
      '<div class="wup-card"><h3>Keep unwrapping</h3><p class="wup-vendor" id="wup-status">Current URL after the first automatic unwrap. Click Unwrap again to peel the next layer.</p><ol class="wup-steps" id="wup-steps"></ol><label>Current URL</label><textarea id="wup-current"></textarea><div class="wup-actions"><button type="button" id="wup-again">Unwrap again</button><button type="button" id="wup-copy">Copy</button><button type="button" id="wup-open">Open</button><button type="button" id="wup-close">Close</button></div></div>';
    document.documentElement.appendChild(panel);
    const currentEl = panel.querySelector("#wup-current");
    const stepsEl = panel.querySelector("#wup-steps");
    const statusEl = panel.querySelector("#wup-status");
    currentEl.value = start;
    function renderSteps() {
      stepsEl.innerHTML = "";
      for (const label of steps) {
        const li = document.createElement("li");
        li.textContent = label;
        stepsEl.appendChild(li);
      }
    }
    renderSteps();
    panel.querySelector("#wup-again").addEventListener("click", function () {
      const cur = currentEl.value.trim();
      const out = WrapperUnwrap.unwrapStep(cur, true);
      if (!out.changed) {
        statusEl.textContent = out.note ? out.vendor + " — " + out.note : "No more known wrappers on this URL.";
        return;
      }
      steps.push("Removed " + (out.vendor || "wrapper"));
      currentEl.value = out.url;
      statusEl.textContent = "Removed " + out.vendor + ". Unwrap again, copy, or open.";
      renderSteps();
    });
    panel.querySelector("#wup-copy").addEventListener("click", function () {
      copyText(currentEl.value.trim());
    });
    panel.querySelector("#wup-open").addEventListener("click", function () {
      const href = currentEl.value.trim();
      if (href) window.open(href, "_blank", "noopener,noreferrer");
    });
    panel.querySelector("#wup-close").addEventListener("click", closePanel);
    panel.addEventListener("click", function (e) {
      if (e.target === panel) closePanel();
    });
  }

  document.addEventListener(
    "contextmenu",
    function (e) {
      const a = e.target && e.target.closest && e.target.closest("a[href]");
      if (!a) lastLink = null;
      else {
        const href = a.getAttribute("href") || "";
        lastLink = {
          original: a.getAttribute("data-wrapper-original") || href,
          unwrapped: href,
          vendor: a.getAttribute("data-wrapper-vendor") || "",
        };
      }
      if (api && api.runtime && api.runtime.sendMessage) {
        api.runtime
          .sendMessage({
            type: "wrapper-context",
            hasOriginal: !!(lastLink && lastLink.original !== lastLink.unwrapped),
            hasLink: !!lastLink,
          })
          .catch(function () {});
      }
    },
    true
  );

  function showIcsBanner(urls) {
    const old = document.getElementById("wrapper-ics-banner");
    if (old) old.remove();
    if (!urls || !urls.length) return;
    const bar = document.createElement("div");
    bar.id = "wrapper-ics-banner";
    const title = document.createElement("div");
    title.className = "ics-title";
    title.textContent = "Calendar invite links (" + urls.length + ")";
    bar.appendChild(title);
    for (const raw of urls) {
      const out = WrapperUnwrap.unwrapOnce(raw);
      const href = out.changed ? out.url : raw;
      let host = href;
      try {
        host = new URL(href).hostname;
      } catch (_) {}
      const row = document.createElement("div");
      row.className = "ics-row";
      const a = document.createElement("a");
      a.href = href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = href;
      if (out.changed) {
        a.setAttribute("data-wrapper-original", raw);
        a.setAttribute("data-wrapper-vendor", out.vendor || "");
        a.classList.add("wrapper-unwrapped");
      }
      if (/amazonaws\.com|cloudfront\.net|\.aws\b/i.test(host + href)) row.classList.add("ics-aws");
      const meta = document.createElement("div");
      meta.className = "ics-meta";
      meta.textContent = host + (out.changed ? " · unwrapped " + out.vendor : "");
      row.appendChild(meta);
      row.appendChild(a);
      bar.appendChild(row);
    }
    insertBanner(bar);
  }

  function insertBanner(el) {
    const root = document.body || document.documentElement;
    const ics = document.getElementById("wrapper-ics-banner");
    const nest = document.getElementById("wrapper-nested-eml");
    if (el.id === "wrapper-nested-eml") {
      root.insertBefore(el, root.firstChild);
      return;
    }
    if (el.id === "wrapper-ics-banner") {
      if (nest && nest.nextSibling) root.insertBefore(el, nest.nextSibling);
      else if (nest) nest.after(el);
      else root.insertBefore(el, root.firstChild);
      return;
    }
    const after = ics || nest;
    if (after) after.after(el);
    else root.insertBefore(el, root.firstChild);
  }

  function cidMap(images) {
    const map = Object.create(null);
    for (const im of images || []) {
      if (im.cid && im.dataUrl) map[im.cid.toLowerCase()] = im.dataUrl;
    }
    return map;
  }

  function sanitizeHtml(html, images) {
    const map = cidMap(images);
    const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
    doc.querySelectorAll("script, iframe, object, embed, form, link, meta, base, svg[onload]").forEach(function (el) {
      el.remove();
    });
    const all = doc.querySelectorAll("*");
    for (const el of all) {
      const attrs = Array.from(el.attributes);
      for (const attr of attrs) {
        const n = attr.name;
        const v = attr.value || "";
        if (/^on/i.test(n) || n === "srcdoc") el.removeAttribute(n);
        if ((n === "href" || n === "src" || n === "xlink:href") && /^\s*javascript:/i.test(v)) el.removeAttribute(n);
      }
    }
    for (const a of doc.querySelectorAll("a[href]")) {
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener noreferrer");
    }
    for (const img of doc.querySelectorAll("img[src]")) {
      const src = img.getAttribute("src") || "";
      const m = src.match(/^cid:(.+)$/i);
      if (m) {
        const key = m[1].replace(/[<>]/g, "").toLowerCase();
        if (map[key]) img.setAttribute("src", map[key]);
      }
    }
    return "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><style>body{margin:8px;font:13px/1.45 sans-serif;color:#1c2430;background:#fff}img{max-width:220px;height:auto}a{color:#0b57d0}</style></head><body>" +
      (doc.body ? doc.body.innerHTML : "") +
      "</body></html>";
  }

  function decodeQr(dataUrl) {
    return new Promise(function (resolve) {
      const fn = globalThis.jsQR;
      if (!fn || !dataUrl) {
        resolve(null);
        return;
      }
      const img = new Image();
      img.onload = function () {
        try {
          const w = img.naturalWidth || img.width;
          const h = img.naturalHeight || img.height;
          if (w < 8 || h < 8 || w * h > 16000000) {
            resolve(null);
            return;
          }
          const c = document.createElement("canvas");
          c.width = w;
          c.height = h;
          const ctx = c.getContext("2d");
          ctx.drawImage(img, 0, 0);
          const data = ctx.getImageData(0, 0, w, h);
          const code = fn(data.data, data.width, data.height);
          resolve(code && code.data ? String(code.data) : null);
        } catch (_) {
          resolve(null);
        }
      };
      img.onerror = function () {
        resolve(null);
      };
      img.src = dataUrl;
    });
  }

  function looksLikeUrl(s) {
    const t = String(s || "").trim();
    return /^(https?:\/\/|www\.)/i.test(t) || /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(:\d+)?[/?#]/i.test(t);
  }

  function qrRow(payload, label) {
    payload = String(payload || "").trim();
    const row = document.createElement("div");
    row.className = "nest-qr";
    const lbl = document.createElement("div");
    lbl.className = "nest-qr-lbl";
    lbl.textContent = label || "QR URL (extracted, not peeled)";
    row.appendChild(lbl);
    if (looksLikeUrl(payload)) {
      const href = /^https?:\/\//i.test(payload) ? payload : "http://" + payload;
      const a = document.createElement("a");
      a.href = href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = payload;
      row.appendChild(a);
    } else {
      const pre = document.createElement("div");
      pre.className = "nest-qr-text";
      pre.textContent = payload;
      row.appendChild(pre);
    }
    return row;
  }

  function takeQr(payload) {
    const key = String(payload || "").trim();
    if (!key || qrShown[key]) return false;
    qrShown[key] = true;
    return true;
  }

  async function fillQr(box, images, imgByUrl) {
    for (const im of images || []) {
      if (!im.dataUrl) continue;
      const data = await decodeQr(im.dataUrl);
      if (!data) continue;
      if (imgByUrl && imgByUrl[im.dataUrl]) {
        imgByUrl[im.dataUrl].classList.remove("nest-img-photo");
        imgByUrl[im.dataUrl].classList.add("nest-img-qr");
      }
      if (!takeQr(data)) continue;
      box.appendChild(qrRow(data));
    }
  }

  function htmlToText(html) {
    const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
    doc.querySelectorAll("style, script, head").forEach(function (el) {
      el.remove();
    });
    return (doc.body && doc.body.textContent) || "";
  }

  function thinText(s) {
    return String(s || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;|&#160;/gi, " ")
      .replace(/[\u00a0\r\n\t]+/g, " ")
      .replace(/[-_=.*~]{3,}/g, " ")
      .replace(/\\r\\n/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function hasMeaningfulBody(msg) {
    const t = thinText(msg.text) + " " + thinText(htmlToText(msg.html));
    const compact = t.replace(/\s+/g, " ").trim();
    if (compact.length < 16) return false;
    if (/^(confiance|confidential|disclaimer)(\s|$)/i.test(compact) && compact.length < 40) return false;
    return true;
  }

  function showZoom(src) {
    closePanel();
    if (!src) return;
    const panel = document.createElement("div");
    panel.id = "wrapper-unwrap-panel";
    panel.className = "wup-zoom";
    panel.innerHTML =
      '<div class="wup-zoom-card"><img alt="Nested image"><div class="wup-actions"><button type="button" id="wup-close">Close</button></div></div>';
    panel.querySelector("img").src = src;
    document.documentElement.appendChild(panel);
    panel.querySelector("#wup-close").addEventListener("click", closePanel);
    panel.addEventListener("click", function (e) {
      if (e.target === panel) closePanel();
    });
  }

  function showPdf(msg) {
    if (!pdfTokenKnown) {
      pdfQueue.push(msg);
      return;
    }
    if (!msg || msg.token !== pdfToken) return;
    const section = document.createElement("section");
    section.className = "nest-pdf";
    const title = document.createElement("div");
    title.className = "nest-pdf-title";
    const total = msg.pageCount || 0;
    title.textContent = "PDF: " + (msg.name || "attachment.pdf");
    section.appendChild(title);
    if (msg.locked) {
      const note = document.createElement("div");
      note.className = "nest-pdf-note";
      note.textContent = "Password-protected PDF, not previewed";
      section.appendChild(note);
    } else {
      const media = document.createElement("div");
      media.className = "nest-media";
      for (const page of msg.pages || []) {
        if (!page || !page.dataUrl) continue;
        const shot = document.createElement("figure");
        shot.className = "nest-pdf-shot";
        const img = document.createElement("img");
        img.src = page.dataUrl;
        img.alt = "PDF page " + (page.num || "");
        img.className = "nest-img nest-img-photo";
        img.addEventListener("click", function () {
          showZoom(page.dataUrl);
        });
        shot.appendChild(img);
        const cap = document.createElement("figcaption");
        cap.className = "nest-pdf-page";
        cap.textContent = total ? "Page " + page.num + " of " + total : "Page " + page.num;
        shot.appendChild(cap);
        media.appendChild(shot);
      }
      if (media.childElementCount) section.appendChild(media);
      const seen = Object.create(null);
      for (const item of msg.qr || []) {
        const payload = String((item && item.payload) || "");
        if (!payload) continue;
        seen[payload] = true;
        if (!takeQr(payload)) continue;
        section.appendChild(qrRow(payload, "QR URL in PDF, page " + item.page + " (extracted, not peeled)"));
      }
      for (const item of msg.links || []) {
        const url = String((item && item.url) || "").trim();
        if (!url || seen[url]) continue;
        seen[url] = true;
        section.appendChild(qrRow(url, "Link in PDF, page " + item.page + " (not peeled)"));
      }
      if (msg.scanLimit > 0 && msg.scanned < msg.scanLimit) {
        const note = document.createElement("div");
        note.className = "nest-pdf-note";
        note.textContent =
          "QR scan covered " + (msg.scanned || 0) + " of " + msg.scanLimit + " pages (time limit)";
        section.appendChild(note);
      }
    }
    if (msg.nestedIndex >= 0) {
      const inner = nestInners[msg.nestedIndex];
      if (inner) inner.appendChild(section);
      return;
    }
    let banner = document.getElementById("wrapper-pdf-banner");
    if (!banner) {
      banner = document.createElement("div");
      banner.id = "wrapper-pdf-banner";
      insertBanner(banner);
    }
    banner.appendChild(section);
  }

  function flushPdfQueue() {
    const queued = pdfQueue.splice(0, pdfQueue.length);
    for (const item of queued) showPdf(item);
  }

  function showNested(messages, token) {
    pdfToken = token;
    pdfTokenKnown = true;
    nestInners = [];
    const oldPdf = document.getElementById("wrapper-pdf-banner");
    if (oldPdf) oldPdf.remove();
    const old = document.getElementById("wrapper-nested-eml");
    if (old) old.remove();
    clearQrShown();
    if (!messages || !messages.length) {
      scanOuterQr();
      flushPdfQueue();
      return;
    }
    const wrap = document.createElement("div");
    wrap.id = "wrapper-nested-eml";
    const pending = [];
    messages.forEach(function (msg, idx) {
      const art = document.createElement("article");
      art.className = "nest-block";
      const h = document.createElement("div");
      h.className = "nest-title";
      h.textContent = "Nested message (" + (idx + 1) + ")";
      const who = document.createElement("div");
      who.className = "nest-who";
      who.textContent =
        (msg.filename ? msg.filename + " · " : "") +
        "Subject: " +
        (msg.subject || "(no subject)") +
        " · From: " +
        (msg.from || "(unknown)");
      const inner = document.createElement("div");
      nestInners[idx] = inner;
      const hasBody = hasMeaningfulBody(msg);
      inner.className = "nest-inner" + (hasBody ? "" : " nest-tight");
      if (hasBody) {
        const body = document.createElement("iframe");
        body.className = "nest-frame";
        body.setAttribute("sandbox", "allow-popups allow-popups-to-escape-sandbox allow-same-origin");
        body.setAttribute("referrerpolicy", "no-referrer");
        if (!msg.html && msg.text) {
          const preDoc = new DOMParser().parseFromString("<pre></pre>", "text/html");
          preDoc.querySelector("pre").textContent = msg.text;
          body.srcdoc = sanitizeHtml(preDoc.body.innerHTML, []);
        } else {
          body.srcdoc = sanitizeHtml(msg.html, msg.images);
        }
        body.addEventListener("load", function () {
          try {
            if (body.contentDocument) {
              rewriteAnchors(body.contentDocument);
              const h = Math.min(420, Math.max(40, body.contentDocument.documentElement.scrollHeight || 0));
              body.style.height = h + "px";
            }
          } catch (_) {}
        });
        inner.appendChild(body);
      }
      const media = document.createElement("div");
      media.className = "nest-media" + (hasBody ? "" : " nest-img-only");
      const imgByUrl = Object.create(null);
      for (const im of msg.images || []) {
        if (!im.dataUrl) continue;
        const img = document.createElement("img");
        img.src = im.dataUrl;
        img.alt = im.name || "Inner image";
        img.className = "nest-img nest-img-photo";
        img.addEventListener("click", function () {
          showZoom(im.dataUrl);
        });
        media.appendChild(img);
        imgByUrl[im.dataUrl] = img;
      }
      if (media.childElementCount) inner.appendChild(media);
      const qrBox = document.createElement("div");
      qrBox.className = "nest-qr-box";
      pending.push(
        fillQr(qrBox, msg.images, imgByUrl).then(function () {
          if (qrBox.childElementCount) inner.appendChild(qrBox);
        })
      );
      art.appendChild(h);
      art.appendChild(who);
      art.appendChild(inner);
      wrap.appendChild(art);
    });
    insertBanner(wrap);
    flushPdfQueue();
    Promise.all(pending).then(function () {
      scanOuterQr();
    });
  }

  async function scanOuterQr() {
    const gen = ++outerQrGen;
    const mine = Object.create(null);
    for (const key of outerQrKeys) mine[key] = true;
    const imgs = document.querySelectorAll("img");
    const found = [];
    const localSeen = Object.create(null);
    for (const img of imgs) {
      if (gen !== outerQrGen) return;
      if (img.closest("#wrapper-nested-eml") || img.closest("#wrapper-pdf-banner") || img.closest("#wrapper-qr-banner")) continue;
      const src = img.currentSrc || img.src;
      if (!src || (src.indexOf("data:") !== 0 && src.indexOf("mailbox:") !== 0 && src.indexOf("cid:") !== 0 && src.indexOf("http") !== 0)) continue;
      const data = await decodeQr(src);
      if (gen !== outerQrGen) return;
      const key = String(data || "").trim();
      if (!key || localSeen[key]) continue;
      if (qrShown[key] && !mine[key]) continue;
      localSeen[key] = true;
      found.push(key);
    }
    if (gen !== outerQrGen) return;
    const old = document.getElementById("wrapper-qr-banner");
    if (old) old.remove();
    for (const key of Object.keys(mine)) {
      if (!localSeen[key]) delete qrShown[key];
    }
    outerQrKeys = [];
    if (!found.length) return;
    for (const payload of found) {
      qrShown[payload] = true;
      outerQrKeys.push(payload);
    }
    const bar = document.createElement("div");
    bar.id = "wrapper-qr-banner";
    const title = document.createElement("div");
    title.className = "ics-title";
    title.textContent = "QR in this message (" + found.length + ") — extracted, not peeled";
    bar.appendChild(title);
    for (const payload of found) bar.appendChild(qrRow(payload));
    insertBanner(bar);
  }

  if (api && api.runtime && api.runtime.onMessage) {
    api.runtime.onMessage.addListener(function (msg) {
      if (!msg) return;
      if (msg.type === "wrapper-show-original") showOriginal(lastLink);
      if (msg.type === "wrapper-keep-unwrapping") showStepper(lastLink);
      if (msg.type === "wrapper-copy-original" && lastLink && lastLink.original) copyText(lastLink.original);
      if (msg.type === "ics-links") showIcsBanner(msg.urls || []);
      if (msg.type === "nested-eml") showNested(msg.messages || [], msg.token);
      if (msg.type === "pdf-preview") showPdf(msg);
    });
  }

  rewriteAnchors(document);
  const mo = new MutationObserver(function (muts) {
    for (const m of muts) {
      for (const node of m.addedNodes) {
        if (node.nodeType === 1) rewriteAnchors(node);
      }
    }
  });
  mo.observe(document.documentElement || document.body, { childList: true, subtree: true });
  setTimeout(function () {
    if (!document.getElementById("wrapper-nested-eml")) scanOuterQr();
  }, 800);
})();
