# PeelScout

Thunderbird add-on that removes the **first** email-security URL wrapper when you open a message, and shows URLs hidden in calendar invites (`.ics`).

A normal click uses the inner URL. The stored `.eml` is not changed.

## What it does

- Peels one wrapper on every `https` link in the displayed message (Safe Links, Proofpoint, Barracuda, and others)
- Keeps inner `%2` / `%25` encoding so nested redirects still work
- Right-click a peeled link: show original wrapper, copy it, or keep unwrapping
- If the message has `invite.ics` / `text/calendar`, a banner lists those URLs (AWS/S3 rows highlighted)

Not in this version: nested EML / QR body display.

## Install for testing

```bash
git clone https://github.com/ExploitBlock/PeelScout.git
```

1. Thunderbird → Settings → Add-ons and Themes
2. Gear next to Manage Your Extensions → **Debug Add-ons**
3. **Load Temporary Add-on…** → pick `manifest.json` in this folder
4. Open a message that has Safe Links or an `.ics`

Temporary add-ons unload when Thunderbird restarts. Load it again the same way.

Requires Thunderbird 128+.

## Vendors

Decoded offline when the destination is in the URL:

- Microsoft Defender Safe Links
- Proofpoint URL Defense v1 / v2 / v3
- Barracuda Link Protect
- Symantec Click-time
- Egress Defend (`Base64Url`)
- Sophos, Cisco, Trend Micro, Libraesva, FortiMail, Hornetsecurity, TitanHQ, Intermedia/VIPRE when the target is in a query parameter

Token-only wrappers (Mimecast `protect-*`, some Sophos/VIPRE) stay as-is.
