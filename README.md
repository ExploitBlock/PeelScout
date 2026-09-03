# PeelScout

Thunderbird add-on that removes the **first** email-security URL wrapper when you open a message, shows nested `.eml` content (and QR URLs), and lists URLs hidden in calendar invites (`.ics`).

A normal click uses the inner URL. The stored `.eml` is not changed. PeelScout does not need internet to run.

Not in this version: QR inside PDF attachments. Translator is not included.

## Install in Thunderbird

**Use the Release.** Do not download the source ZIP.

1. Open https://github.com/ExploitBlock/PeelScout/releases/latest
2. Download **PeelScout.xpi** (under Assets — not “Source code”)
3. Thunderbird → Settings → Add-ons and Themes → gear → **Install Add-on From File…**
4. Choose `PeelScout.xpi` → Add
5. Restart Thunderbird and confirm PeelScout is still listed and enabled

If Thunderbird says the add-on could not be verified, sign that same `.xpi` once at https://addons.thunderbird.net/developers/ (submit as **unlisted**), then Install From File with the signed file.

### Temporary test only

Debug Add-ons → **Load Temporary Add-on…** → `manifest.json` from a source checkout. Unloads when Thunderbird restarts.

Requires Thunderbird 128+.

## What it does

- Peels one wrapper on every `https` link in the displayed message
- Keeps inner `%2` / `%25` encoding so nested redirects still work
- Right-click a peeled link: show original wrapper, copy it, or keep unwrapping
- If the message contains another `.eml` (`message/rfc822`), the inner subject, body, and images are shown automatically
- QR codes in that inner (and outer) HTML are decoded; the URL is listed **raw** (not peeled)
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
