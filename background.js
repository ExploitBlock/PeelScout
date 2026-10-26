async function injectIntoOpenTabs() {
  const tabs = await messenger.tabs.query({});
  for (const tab of tabs) {
    if (!["mail", "messageDisplay"].includes(tab.type)) continue;
    try {
      if (tab.type === "mail") {
        const messages = await messenger.messageDisplay.getDisplayedMessages(tab.id);
        if (!messages || messages.length !== 1) continue;
      }
      await messenger.tabs.executeScript(tab.id, { file: "inflate-zlib.js" });
      await messenger.tabs.executeScript(tab.id, { file: "unwrap.js" });
      await messenger.tabs.executeScript(tab.id, { file: "jsqr.min.js" });
      await messenger.tabs.executeScript(tab.id, { file: "message-script.js" });
      await messenger.tabs.insertCSS(tab.id, { file: "message-style.css" });
    } catch (_) {}
  }
}

messenger.messageDisplayScripts.register({
  js: [
    { file: "inflate-zlib.js" },
    { file: "unwrap.js" },
    { file: "jsqr.min.js" },
    { file: "message-script.js" },
  ],
  css: [{ file: "message-style.css" }],
});

messenger.menus.create({
  id: "wrapper-show-original",
  title: "Show original wrapper",
  contexts: ["link"],
});
messenger.menus.create({
  id: "wrapper-copy-original",
  title: "Copy original wrapped URL",
  contexts: ["link"],
});
messenger.menus.create({
  id: "wrapper-keep-unwrapping",
  title: "Keep unwrapping…",
  contexts: ["link"],
});

messenger.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "copy-text") {
    try {
      return navigator.clipboard.writeText(String(msg.text || "")).then(
        () => true,
        () => false
      );
    } catch (_) {
      return Promise.resolve(false);
    }
  }
  if (!msg || msg.type !== "wrapper-context") return;
  const visibleOrig = !!msg.hasOriginal;
  const visibleLink = !!msg.hasLink;
  messenger.menus.update("wrapper-show-original", { visible: visibleOrig });
  messenger.menus.update("wrapper-copy-original", { visible: visibleOrig });
  messenger.menus.update("wrapper-keep-unwrapping", { visible: visibleLink });
});

messenger.menus.onClicked.addListener(async (info, tab) => {
  if (!tab || tab.id == null) return;
  const allowed = {
    "wrapper-copy-original": "wrapper-copy-original",
    "wrapper-show-original": "wrapper-show-original",
    "wrapper-keep-unwrapping": "wrapper-keep-unwrapping",
  };
  const type = allowed[info.menuItemId];
  if (!type) return;
  try {
    await messenger.tabs.sendMessage(tab.id, { type });
  } catch (_) {}
});

function walkParts(part, acc) {
  if (!part) return;
  acc.push(part);
  if (Array.isArray(part.parts)) {
    for (const child of part.parts) walkParts(child, acc);
  }
}

async function sendWithRetry(tabId, payload) {
  try {
    await messenger.tabs.sendMessage(tabId, payload);
  } catch (_) {
    setTimeout(async () => {
      try {
        await messenger.tabs.sendMessage(tabId, payload);
      } catch (_) {}
    }, 400);
  }
}

async function collectIcsUrls(messageId) {
  const urls = [];
  const seen = Object.create(null);
  function addAll(list) {
    for (const u of list) {
      if (u && !seen[u]) {
        seen[u] = true;
        urls.push(u);
      }
    }
  }
  try {
    const atts = await messenger.messages.listAttachments(messageId);
    for (const att of atts) {
      if (!IcsLinks.isCalendarPart(att.name, att.contentType)) continue;
      const file = await messenger.messages.getAttachmentFile(messageId, att.partName);
      addAll(IcsLinks.parseIcsUrls(await file.text()));
    }
  } catch (_) {}
  try {
    const full = await messenger.messages.getFull(messageId);
    const parts = [];
    walkParts(full, parts);
    for (const part of parts) {
      if (!IcsLinks.isCalendarPart(part.name || part.filename, part.contentType)) continue;
      if (part.body) addAll(IcsLinks.parseIcsUrls(part.body));
      else if (part.partName) {
        try {
          const file = await messenger.messages.getAttachmentFile(messageId, part.partName);
          addAll(IcsLinks.parseIcsUrls(await file.text()));
        } catch (_) {}
      }
    }
  } catch (_) {}
  return urls;
}

async function collectNested(messageId) {
  const list = [];
  const seen = Object.create(null);
  async function addFile(partName, name, contentType) {
    if (!partName || seen[partName]) return;
    if (!NestedEml.isRfc822(name, contentType)) return;
    seen[partName] = true;
    try {
      const file = await messenger.messages.getAttachmentFile(messageId, partName);
      const raw = await NestedEml.fileToRaw(file);
      const parsed = NestedEml.parse(raw, name || "message.eml");
      for (const msg of parsed) list.push(msg);
    } catch (_) {}
  }
  try {
    const atts = await messenger.messages.listAttachments(messageId);
    for (const att of atts) {
      await addFile(att.partName, att.name, att.contentType);
    }
  } catch (_) {}
  try {
    const full = await messenger.messages.getFull(messageId);
    const parts = [];
    walkParts(full, parts);
    for (const part of parts) {
      await addFile(part.partName, part.name || part.filename, part.contentType);
    }
  } catch (_) {}
  return list.slice(0, 5);
}

let scanToken = 0;
const tabTokens = new Map();

function isPdfPart(name, contentType) {
  const n = name || "";
  const ct = (contentType || "").toLowerCase();
  return ct.indexOf("application/pdf") === 0 || /\.pdf$/i.test(n);
}

function withoutPdfs(messages) {
  const out = [];
  for (const msg of messages) {
    out.push({
      filename: msg.filename || "",
      subject: msg.subject || "",
      from: msg.from || "",
      html: msg.html || "",
      text: msg.text || "",
      images: msg.images || [],
    });
  }
  return out;
}

async function collectOuterPdfs(messageId) {
  const list = [];
  const seen = Object.create(null);
  async function add(partName, name, contentType) {
    if (!partName || seen[partName]) return;
    if (!isPdfPart(name, contentType)) return;
    seen[partName] = true;
    try {
      const file = await messenger.messages.getAttachmentFile(messageId, partName);
      const buf = await file.arrayBuffer();
      if (buf.byteLength > 8000000) return;
      list.push({
        nestedIndex: -1,
        name: name || "attachment.pdf",
        size: buf.byteLength,
        data: new Uint8Array(buf),
      });
    } catch (_) {}
  }
  try {
    const atts = await messenger.messages.listAttachments(messageId);
    for (const att of atts) await add(att.partName, att.name, att.contentType);
  } catch (_) {}
  try {
    const full = await messenger.messages.getFull(messageId);
    const parts = [];
    walkParts(full, parts);
    for (const part of parts) await add(part.partName, part.name || part.filename, part.contentType);
  } catch (_) {}
  return list;
}

async function scanMessagePdfs(tabId, token, nested, messageId) {
  function stale() {
    return tabTokens.get(tabId) !== token;
  }
  const jobs = [];
  for (let i = 0; i < nested.length; i++) {
    const pdfs = nested[i].pdfs || [];
    for (const pdf of pdfs) {
      if (!pdf || !pdf.bytes) continue;
      jobs.push({
        nestedIndex: i,
        name: pdf.name || "attachment.pdf",
        size: pdf.bytes.length,
        bytes: pdf.bytes,
      });
    }
  }
  const outers = await collectOuterPdfs(messageId);
  if (stale()) return;
  for (const outer of outers) {
    let dup = false;
    for (const job of jobs) {
      if (job.name === outer.name && job.size === outer.size) {
        dup = true;
        break;
      }
    }
    if (!dup) jobs.push(outer);
  }
  async function postPdf(job, result, phase) {
    if (stale()) return;
    await sendWithRetry(tabId, {
      type: "pdf-preview",
      phase: phase,
      token: token,
      nestedIndex: job.nestedIndex,
      name: job.name,
      pageCount: result.pageCount || 0,
      pages: result.pages || [],
      qr: result.qr || [],
      links: result.links || [],
      locked: !!result.locked,
      scanned: result.scanned || 0,
      scanLimit: phase === "links" ? 0 : result.scanLimit || 0,
    });
  }
  const limited = jobs.slice(0, 3);
  for (const job of limited) {
    if (stale()) return;
    let result = { pageCount: 0, pages: [], qr: [], links: [], locked: false, scanned: 0, scanLimit: 0 };
    try {
      const data = job.data || Uint8Array.from(job.bytes, function (c) { return c.charCodeAt(0); });
      result = await PeelPdf.scan(data, {
        cancelled: stale,
        onProgress: function (partial) {
          return postPdf(job, partial, "links");
        },
      });
    } catch (_) {}
    if (stale()) return;
    await postPdf(job, result, "done");
  }
}

async function pushExtrasToTab(tabId, messageId) {
  const token = ++scanToken;
  tabTokens.set(tabId, token);
  const nested = await collectNested(messageId);
  if (tabTokens.get(tabId) !== token) return;
  await sendWithRetry(tabId, { type: "nested-eml", token: token, messages: withoutPdfs(nested) });
  const urls = await collectIcsUrls(messageId);
  if (tabTokens.get(tabId) !== token) return;
  await sendWithRetry(tabId, { type: "ics-links", urls: urls });
  if (tabTokens.get(tabId) !== token) return;
  await scanMessagePdfs(tabId, token, nested, messageId);
}

if (messenger.messageDisplay && messenger.messageDisplay.onMessageDisplayed) {
  messenger.messageDisplay.onMessageDisplayed.addListener(async (tab, message) => {
    if (!tab || !message) return;
    await pushExtrasToTab(tab.id, message.id);
  });
}

injectIntoOpenTabs();
