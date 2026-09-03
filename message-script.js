(function () {
  if (!globalThis.WrapperUnwrap) return;
  const api = globalThis.browser || globalThis.messenger;
  let lastLink = null;

  function rewriteAnchors(root) {
    if (!root || !root.querySelectorAll) return;
    const links = root.querySelectorAll("a[href]");
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

  function copyText(text) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.documentElement.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
    } catch (_) {}
    ta.remove();
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
    return /^(https?:\/\/|www\.)/i.test(String(s || "").trim());
  }

  function qrRow(payload, peeled) {
    const row = document.createElement("div");
    row.className = "nest-qr";
    const lbl = document.createElement("div");
    lbl.className = "nest-qr-lbl";
    lbl.textContent = peeled ? "QR URL (extracted, not peeled)" : "QR content (extracted, not peeled)";
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

  async function fillQr(box, images) {
    const seen = Object.create(null);
    for (const im of images || []) {
      if (!im.dataUrl) continue;
      const data = await decodeQr(im.dataUrl);
      if (!data || seen[data]) continue;
      seen[data] = true;
      box.appendChild(qrRow(data, looksLikeUrl(data)));
    }
    if (!box.childElementCount) {
      const empty = document.createElement("div");
      empty.className = "nest-qr-lbl";
      empty.textContent = images && images.length ? "No QR code decoded from inner images." : "";
      if (empty.textContent) box.appendChild(empty);
    }
  }

  function showNested(messages) {
    const old = document.getElementById("wrapper-nested-eml");
    if (old) old.remove();
    if (!messages || !messages.length) return;
    const wrap = document.createElement("div");
    wrap.id = "wrapper-nested-eml";
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
      inner.className = "nest-inner";
      const body = document.createElement("iframe");
      body.className = "nest-frame";
      body.setAttribute("sandbox", "allow-popups allow-popups-to-escape-sandbox allow-same-origin");
      body.setAttribute("referrerpolicy", "no-referrer");
      const srcdoc = msg.html
        ? sanitizeHtml(msg.html, msg.images)
        : sanitizeHtml("<pre></pre>", []);
      if (!msg.html && msg.text) {
        const preDoc = new DOMParser().parseFromString("<pre></pre>", "text/html");
        preDoc.querySelector("pre").textContent = msg.text;
        body.srcdoc = sanitizeHtml(preDoc.body.innerHTML, []);
      } else {
        body.srcdoc = srcdoc;
      }
      body.addEventListener("load", function () {
        try {
          if (body.contentDocument) rewriteAnchors(body.contentDocument);
        } catch (_) {}
      });
      const media = document.createElement("div");
      media.className = "nest-media";
      for (const im of msg.images || []) {
        if (!im.dataUrl) continue;
        const img = document.createElement("img");
        img.src = im.dataUrl;
        img.alt = im.name || "Inner image";
        img.className = "nest-img";
        media.appendChild(img);
      }
      const qrBox = document.createElement("div");
      qrBox.className = "nest-qr-box";
      fillQr(qrBox, msg.images);
      inner.appendChild(body);
      if (media.childElementCount) inner.appendChild(media);
      inner.appendChild(qrBox);
      art.appendChild(h);
      art.appendChild(who);
      art.appendChild(inner);
      wrap.appendChild(art);
    });
    insertBanner(wrap);
  }

  async function scanOuterQr() {
    const old = document.getElementById("wrapper-qr-banner");
    if (old) old.remove();
    const imgs = document.querySelectorAll("img");
    const seen = Object.create(null);
    const found = [];
    for (const img of imgs) {
      if (img.closest("#wrapper-nested-eml")) continue;
      const src = img.currentSrc || img.src;
      if (!src || src.indexOf("data:") !== 0 && src.indexOf("mailbox:") !== 0 && src.indexOf("cid:") !== 0 && src.indexOf("http") !== 0) continue;
      const data = await decodeQr(src);
      if (!data || seen[data]) continue;
      seen[data] = true;
      found.push(data);
    }
    if (!found.length) return;
    const bar = document.createElement("div");
    bar.id = "wrapper-qr-banner";
    const title = document.createElement("div");
    title.className = "ics-title";
    title.textContent = "QR in this message (" + found.length + ") — extracted, not peeled";
    bar.appendChild(title);
    for (const payload of found) bar.appendChild(qrRow(payload, looksLikeUrl(payload)));
    insertBanner(bar);
  }

  if (api && api.runtime && api.runtime.onMessage) {
    api.runtime.onMessage.addListener(function (msg) {
      if (!msg) return;
      if (msg.type === "wrapper-show-original") showOriginal(lastLink);
      if (msg.type === "wrapper-keep-unwrapping") showStepper(lastLink);
      if (msg.type === "wrapper-copy-original" && lastLink && lastLink.original) copyText(lastLink.original);
      if (msg.type === "ics-links") showIcsBanner(msg.urls || []);
      if (msg.type === "nested-eml") showNested(msg.messages || []);
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
  setTimeout(scanOuterQr, 600);
})();
