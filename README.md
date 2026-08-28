# PeelScout

Thunderbird add-on that removes the **first** email-security URL wrapper when you open a message, and shows URLs hidden in calendar invites (`.ics`).

A normal click uses the inner URL. The stored `.eml` is not changed. PeelScout does not need internet to run.

No Git required. Download the ZIP from this repository.

Not in this version: nested EML / QR body display.

## Get the files

1. Open https://github.com/ExploitBlock/PeelScout
2. Click the green **Code** button → **Download ZIP**
3. Unzip it. Open folders until you see `manifest.json`
   (usually `PeelScout-main`)

## Install — two options

### Option A — Permanent from a local `.xpi` (try this first)

Works offline. Thunderbird keeps the add-on after restart **if** it accepts an unsigned file.

On Windows:

1. In the folder that contains `manifest.json`, select these files:
   `manifest.json`, `background.js`, `unwrap.js`, `inflate-zlib.js`, `ics.js`, `message-script.js`, `message-style.css`, `popup.html`, `popup.js`
2. Right-click → **Send to** → **Compressed (zipped) folder**
3. Rename that zip to `PeelScout.xpi`
4. Open the `.xpi` and confirm `manifest.json` is at the **top**, not inside another folder
5. Thunderbird → Settings → Add-ons and Themes → gear → **Install Add-on From File…**
6. Choose `PeelScout.xpi` → Add
7. Restart Thunderbird and confirm PeelScout is still listed and enabled

If the zip only contains a folder (`PeelScout-main`), Thunderbird will reject it. Zip the files themselves.

If Thunderbird says the add-on could not be verified, use Option B.

### Option B — Signed permanent (AMO, one-time online)

Current Thunderbird release builds often require a signed `.xpi`. Sign on any computer with internet, then copy the file to the offline VM.

1. Make `PeelScout.xpi` the same way as Option A
2. On a machine with internet open https://addons.thunderbird.net/developers/
3. Sign in with a Mozilla account
4. Submit PeelScout as **unlisted**
5. Download the signed `.xpi`
6. Copy it into the offline VM
7. Add-ons → gear → **Install Add-on From File…**

### Temporary (not permanent)

Thunderbird → Settings → Add-ons and Themes → gear → **Debug Add-ons** → **Load Temporary Add-on…** → pick `manifest.json` in the unzipped folder.

Fine for testing. It unloads when Thunderbird restarts.

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
