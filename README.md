# PeelScout

Thunderbird add-on that removes the **first** email-security URL wrapper when you open a message, and shows URLs hidden in calendar invites (`.ics`).

A normal click uses the inner URL. The stored `.eml` is not changed. PeelScout does not need internet to run.

Not in this version: nested EML / QR body display.

## Install — two options

### Option A — Permanent from a local `.xpi` (try this first)

Works fully offline. Thunderbird keeps the add-on after restart **if** it accepts an unsigned file.

```bash
git clone https://github.com/ExploitBlock/PeelScout.git
cd PeelScout
zip -r ../PeelScout.xpi manifest.json background.js unwrap.js inflate-zlib.js ics.js message-script.js message-style.css popup.html popup.js
```

1. Thunderbird → Settings → Add-ons and Themes
2. Gear → **Install Add-on From File…**
3. Choose `PeelScout.xpi` → Add
4. Restart Thunderbird
5. Confirm PeelScout is still listed and enabled

If Thunderbird says the add-on could not be verified, use Option B.

### Option B — Signed permanent (AMO, one-time online)

Current Thunderbird release builds often require a signed `.xpi`. Signing is done on any computer with internet. Daily use can stay offline.

1. Zip the same files as Option A (`manifest.json` at the top of the zip)
2. On a machine with internet open https://addons.thunderbird.net/developers/
3. Sign in with a Mozilla account
4. Submit PeelScout as **unlisted** (only you get the file)
5. Download the signed `.xpi`
6. Copy that file to the offline Thunderbird PC
7. Add-ons → gear → **Install Add-on From File…**

### Temporary (not permanent)

Debug Add-ons → **Load Temporary Add-on…** → pick `manifest.json`. Fine for testing. It unloads when Thunderbird restarts.

Requires Thunderbird 128+.

## What it does

- Peels one wrapper on every `https` link in the displayed message
- Keeps inner `%2` / `%25` encoding so nested redirects still work
- Right-click a peeled link: show original wrapper, copy it, or keep unwrapping
- If the message has `invite.ics` / `text/calendar`, a banner lists those URLs (AWS/S3 rows highlighted)

## Vendors

Decoded offline when the destination is in the URL:

- Microsoft Defender Safe Links
- Proofpoint URL Defense v1 / v2 / v3
- Barracuda Link Protect
- Symantec Click-time
- Egress Defend (`Base64Url`)
- Sophos, Cisco, Trend Micro, Libraesva, FortiMail, Hornetsecurity, TitanHQ, Intermedia/VIPRE when the target is in a query parameter

Token-only wrappers (Mimecast `protect-*`, some Sophos/VIPRE) stay as-is.
