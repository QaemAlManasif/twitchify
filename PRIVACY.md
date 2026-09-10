# Privacy Policy — Twitchify

Last updated: 10 September 2026

This policy covers the **Twitchify Watch Sync** browser extension (Chrome and Firefox), the **Twitchify Watch Sync Helper** app for Windows, and the **Twitchify** iCUE widget for the CORSAIR XENEON EDGE.

**Summary: none of these send your data anywhere. There is no server, no account, and no analytics. Everything stays on your own computer, except for your own direct connection to Twitch.**

---

## Twitchify Watch Sync (browser extension)

### What it accesses

The extension asks the browser for the list of tabs whose address is on `twitch.tv`. It ignores every other tab. For each Twitch tab it reads:

- The **address (URL)**, only to work out which channel the tab is showing.
- The **page title**.
- Whether the tab is the **active** one, and whether it is in the **focused** window.

The extension registers no content scripts. It never reads the contents of any web page: no text, images, video, messages, form fields, or cookies.

### What it sends, and where

When your Twitch tabs change, the extension sends this to one destination only:

```
POST http://127.0.0.1:57123/tabs
{ "tabs": [ { "login": "somechannel", "title": "…", "active": true, "focused": true } ] }
```

`127.0.0.1` is your own computer. This request never leaves your machine and is not routed through any network or server. The extension contacts no other address.

### What it does not do

- It does not send anything to the developer, or to any server, website, or third party.
- It does not collect analytics, telemetry, crash reports, or usage statistics.
- It does not read, store, or transmit your Twitch account, login, password, cookies, or chat messages.
- It does not track which non-Twitch sites you visit.
- It does not sell or share any data with anyone, for any purpose.
- It stores nothing persistently. The current tab list is held in memory and is gone when the browser closes.

### Permissions, and why each is needed

| Permission | Why |
| :-- | :-- |
| `tabs` | To read the address and title of open Twitch tabs, and to know which one you are looking at. |
| `alarms` | To re-send the list about once a minute, because the browser suspends the extension when it is idle. |
| `*://*.twitch.tv/*` | To match Twitch tabs by address. No script runs on the page. |
| `http://127.0.0.1/*` | To send the channel names to the helper app on your own computer. |

The extension loads no remote code.

---

## Twitchify Watch Sync Helper (Windows app)

The helper is a small program that listens on `http://127.0.0.1:57123`, on your computer only. It accepts the tab list from the extension and passes it to the widget, which cannot receive it directly.

- It holds the current channel list **in memory** and does not save it to disk.
- It accepts connections only from your own computer. It is not reachable from your network or the internet.
- It writes a plain-text activity log to `%LOCALAPPDATA%\TwitchModeration\helper.log`, recording events such as when it started and stopped. This file stays on your computer and is deleted when you uninstall.
- It contacts no server and sends nothing anywhere.

---

## Twitchify (iCUE widget)

The widget talks directly to **Twitch** and to nobody else.

- Signing in uses Twitch's own OAuth device-code flow. You approve it on `twitch.tv`. The widget never sees or handles your Twitch password.
- The resulting access token is stored **locally**, in the widget's own browser storage on your PC. It is sent only to Twitch, to make the requests you ask for, such as loading chat or applying a moderation action.
- Chat messages, badges, and emotes come from Twitch and from the public BTTV, 7TV, and FrankerFaceZ emote APIs. Those requests carry no personal information.
- If you add a **custom panel**, the widget displays the web page at the address you entered. That page is loaded by your browser engine directly and is subject to its own operator's privacy policy. Choose links you trust.
- Signing out removes the stored token from your computer.

The developer receives nothing. There is no Twitchify server.

---

## Children

These products are not directed at children and do not knowingly handle data from anyone under 13.

## Changes

If this policy changes, the "last updated" date above changes with it, and the revision history is public in this repository.

## Contact

Questions or concerns: open an issue at
https://github.com/QaemAlManasif/twitchify/issues
