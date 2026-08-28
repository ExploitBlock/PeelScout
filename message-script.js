(function () {
  if (!globalThis.WrapperUnwrap) return;
  const api = globalThis.browser || globalThis.messenger;
  let lastLink = null;
  function rewriteAnchors(root) {
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
      a.setAttribute("title", "Unwrapped " + (out.vendor || "security wrapper") + "\nRight-click for original or keep unwrapping");
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
    try { document.execCommand("copy"); } catch (_) {}
    ta.remove();
  }
  function showOriginal(info) {
    closePanel();
    if (!info || !info.original) return;
    const panel = document.createElement("div");
    panel.id = "wrapper-unwrap-panel";
    const vendor = info.vendor || "security wrapper";
    panel.innerHTML = '<div class="wup-card"><h3>Original wrapper</h3><p class="wup-vendor">' + vendor + '</p><label>Wrapped URL</label><textarea readonly id="wup-orig"></textarea><label>Unwrapped URL</label><textarea readonly id="wup-clean"></textarea><div class="wup-actions"><button type="button" id="wup-copy-orig">Copy wrapped</button><button type="button" id="wup-copy-clean">Copy unwrapped</button><button type="button" id="wup-more">Keep unwrapping…</button><button type="button" id="wup-close">Close</button></div></div>';
    document.documentElement.appendChild(panel);
    panel.querySelector("#wup-orig").value = info.original;
    panel.querySelector("#wup-clean").value = info.unwrapped || "";
    panel.querySelector("#wup-copy-orig").addEventListener("click", function () { copyText(info.original); });
    panel.querySelector("#wup-copy-clean").addEventListener("click", function () { copyText(info.unwrapped || ""); });
    panel.querySelector("#wup-more").addEventListener("click", function () { showStepper(info); });
    panel.querySelector("#wup-close").addEventListener("click", closePanel);
    panel.addEventListener("click", function (e) { if (e.target === panel) closePanel(); });
  }
  function showStepper(info) {
    closePanel();
    if (!info) return;
    const start = info.unwrapped || info.original || "";
    const steps = [];
    if (info.original && info.unwrapped && info.original !== info.unwrapped) steps.push((info.vendor || "First wrapper") + " (automatic)");
    const panel = document.createElement("div");
    panel.id = "wrapper-unwrap-panel";
    panel.innerHTML = '<div class="wup-card"><h3>Keep unwrapping</h3><p class="wup-vendor" id="wup-status">Current URL after the first automatic unwrap. Click Unwrap again to peel the next layer.</p><ol class="wup-steps" id="wup-steps"></ol><label>Current URL</label><textarea id="wup-current"></textarea><div class="wup-actions"><button type="button" id="wup-again">Unwrap again</button><button type="button" id="wup-copy">Copy</button><button type="button" id="wup-open">Open</button><button type="button" id="wup-close">Close</button></div></div>';
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
    panel.querySelector("#wup-copy").addEventListener("click", function () { copyText(currentEl.value.trim()); });
    panel.querySelector("#wup-open").addEventListener("click", function () {
      const href = currentEl.value.trim();
      if (href) window.open(href, "_blank", "noopener,noreferrer");
    });
    panel.querySelector("#wup-close").addEventListener("click", closePanel);
    panel.addEventListener("click", function (e) { if (e.target === panel) closePanel(); });
  }
  document.addEventListener("contextmenu", function (e) {
    const a = e.target && e.target.closest && e.target.closest("a[href]");
    if (!a) lastLink = null;
    else {
      const href = a.getAttribute("href") || "";
      lastLink = {
        original: a.getAttribute("data-wrapper-original") || href,
        unwrapped: href,
        vendor: a.getAttribute("data-wrapper-vendor") || ""
      };
    }
    if (api && api.runtime && api.runtime.sendMessage) {
      api.runtime.sendMessage({ type: "wrapper-context", hasOriginal: !!(lastLink && lastLink.original !== lastLink.unwrapped), hasLink: !!lastLink }).catch(function () {});
    }
  }, true);
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
      try { host = new URL(href).hostname; } catch (_) {}
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
    const root = document.body || document.documentElement;
    root.insertBefore(bar, root.firstChild);
  }
  if (api && api.runtime && api.runtime.onMessage) {
    api.runtime.onMessage.addListener(function (msg) {
      if (!msg) return;
      if (msg.type === "wrapper-show-original") showOriginal(lastLink);
      if (msg.type === "wrapper-keep-unwrapping") showStepper(lastLink);
      if (msg.type === "wrapper-copy-original" && lastLink && lastLink.original) copyText(lastLink.original);
      if (msg.type === "ics-links") showIcsBanner(msg.urls || []);
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
})();
