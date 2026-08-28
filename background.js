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
      await messenger.tabs.executeScript(tab.id, { file: "message-script.js" });
      await messenger.tabs.insertCSS(tab.id, { file: "message-style.css" });
    } catch (_) {}
  }
}

messenger.messageDisplayScripts.register({
  js: [{ file: "inflate-zlib.js" }, { file: "unwrap.js" }, { file: "message-script.js" }],
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

async function pushIcsToTab(tabId, messageId) {
  const urls = await collectIcsUrls(messageId);
  try {
    await messenger.tabs.sendMessage(tabId, { type: "ics-links", urls: urls });
  } catch (_) {
    setTimeout(async () => {
      try {
        await messenger.tabs.sendMessage(tabId, { type: "ics-links", urls: urls });
      } catch (_) {}
    }, 400);
  }
}

if (messenger.messageDisplay && messenger.messageDisplay.onMessageDisplayed) {
  messenger.messageDisplay.onMessageDisplayed.addListener(async (tab, message) => {
    if (!tab || !message) return;
    await pushIcsToTab(tab.id, message.id);
  });
}

injectIntoOpenTabs();
