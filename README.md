# Twitchify — iCUE Widget for XENEON EDGE

Twitch mission control on the touchscreen: live chat with one-tap moderation, a channel
switcher covering **every channel you moderate**, and full broadcaster controls for your
own stream.

## Download

Everything ships from [Releases](https://github.com/QaemAlManasif/twitchify/releases):

| File | |
| :-- | :-- |
| `twitchify.icuewidget` | The widget. Import it in iCUE and place **Twitchify** on your EDGE. |
| `Twitchify-Watch-Sync-Setup.exe` | Optional. Installs the Watch Sync helper — see [Watch sync](#watch-sync-optional-add-on). |
| `twitchify-watch-sync-chrome-1.0.0.zip` | Optional. The browser extension, until the store listing is live. |
| `twitchify-watch-sync-firefox-1.0.0.zip` | Same, for Firefox. |

Privacy policy: [PRIVACY.md](PRIVACY.md). Nothing here has a server — see it for the detail.

## Architecture

Unlike Deckord, **there is no local IPC to bridge.** Discord needed `DeckordHelper.exe`
because the Discord desktop client speaks over a named pipe that a webview cannot open.
Twitch has no local API at all — it is entirely cloud HTTPS + WebSocket, both of which a
webview can do natively. So the target is a **fully standalone widget**: one `.icuewidget`
zip, no installer, no background process, no autostart entry, no uninstall entry.

| Layer | Choice |
| :-- | :-- |
| Auth | **OAuth Device Code Grant** — public client, no client secret anywhere |
| Events in | **One EventSub WebSocket** — `wss://eventsub.wss.twitch.tv/ws` |
| Actions out | **Helix REST** — `https://api.twitch.tv/helix/...` |
| Chat in | EventSub `channel.chat.message` |
| Chat out | `POST /helix/chat/messages` |
| IRC | **Not used** — see below |

### Why Device Code Grant

The other flows need something a widget cannot provide. Authorization Code needs a
loopback HTTP listener and a client secret; Implicit needs a redirect and returns no
refresh token. Device Code needs neither:

```
POST https://id.twitch.tv/oauth2/device
  client_id=<ours>&scopes=<space separated>
→ { device_code, user_code, verification_uri, interval, expires_in }

  show user_code on the LCD → user opens twitch.tv/activate on their phone

POST https://id.twitch.tv/oauth2/token          (poll every `interval` seconds)
  client_id=<ours>&device_code=<...>&scopes=<...>
  &grant_type=urn:ietf:params:oauth:grant-type:device_code
→ { access_token, refresh_token, expires_in }
```

Because there is no secret to protect, the widget can ship **our own Client ID baked in**.
The user's entire setup is: tap Connect, read a code, approve on their phone. No Twitch
dev console, no setup guide, nothing to paste — a large improvement on the Deckord flow.

In the Twitch dev console the app must be registered with **Client Type = Public**. The
redirect URL field is required but unused; `http://localhost` is fine.

### Registering the app (once, by us)

1. Open [dev.twitch.tv/console/apps](https://dev.twitch.tv/console/apps) → **Register Your Application**
2. **Name**: anything unique across Twitch. **OAuth Redirect URLs**: `http://localhost` —
   the field is required, but device flow never redirects, so the value is inert
3. **Category**: Application Integration. **Client Type**: **Public** ← enables device flow
   and means no secret is ever issued
4. **Create**, then **Manage** to copy the **Client ID**

Paste it into **`CLIENT_ID`** at the top of `twitch-widget/scripts/main.js`. That is the
whole publishing step. A Client ID is not a secret — it is public by design and rides in
every OAuth URL on the web — so shipping it inside the widget is the intended use of a
public client, not a compromise.

While `CLIENT_ID` is empty, the widget shows a test-build box with a field and these steps
so it can still be exercised. Setting `CLIENT_ID` removes that box automatically, and
**users then need no setup guide at all** — unlike Deckord, there is nothing for them to
register, paste, or configure.

Rate limits do not pool across users: the 800 points/min bucket is per client-id **and**
per user token, so one shared Client ID serving many installs costs nothing.

Three rules the token store must honour:

1. **Refresh tokens are single-use.** Each refresh returns a new one and invalidates the
   old. Persist the new token *before* using the new access token, or a crash mid-refresh
   locks the user out permanently.
2. **Refreshing needs no client secret** for public clients.
3. **30 days idle kills the refresh token.** Show a clean re-auth screen, not an error.

Access tokens last ~4h — refresh proactively and on any `401`.

### Why EventSub and not IRC

Twitch **removed moderation commands from IRC in February 2023** (`/ban`, `/timeout`,
`/clear` are Helix-only now). IRC would therefore be read-only, leaving two connections
and two auth paths for no benefit. EventSub delivers structured messages (fragments,
badges, emotes, cheers, reply threads) plus every moderation event on the same socket.

Limits to design around: **300 subscriptions per socket, 3 sockets per client-id/user**,
10s keepalive, and a `session_reconnect` message that must be handled. At ~7 subscriptions
per channel that is ~40 channels per socket — so subscribe **lazily** to pinned/visible
channels, not to every moderated channel at once.

Per channel we want:

| Subscription | For |
| :-- | :-- |
| `channel.chat.message` | the chat feed |
| `channel.chat.message_delete`, `channel.chat.clear_user_messages` | grey out deleted messages live |
| `channel.moderate` v2 | every mod action by anyone — ban, timeout, delete, warn, vip, slow, automod |
| `automod.message.hold` / `automod.message.update` v2 | the AutoMod approve/deny queue |
| `channel.chat.notification` | subs, gifts, raids, announcements |
| `channel.chat_settings.update` | keep the settings toggles honest |
| `stream.online` / `stream.offline`, `channel.update` | live badge, title, category |

### Moderating any channel you mod

`GET /helix/moderation/channels` (scope `user:read:moderated_channels`) returns every
channel the user has mod powers in — that is the channel switcher.

Every moderator endpoint takes **`broadcaster_id`** (target channel) + **`moderator_id`**
(the signed-in user); Twitch verifies mod status server-side. **One token covers all N
channels** — no per-channel auth, no re-consent, nothing stored per channel. EventSub is
the same shape: `broadcaster_user_id` = target, `moderator_user_id` = self.

This gives the UI two capability tiers, which should be visually distinct:

| Tier | Actions |
| :-- | :-- |
| **Any moderated channel** (`moderator:*`) | ban/timeout/unban, delete message, warn, chat settings, announcements, shoutouts, Shield Mode, AutoMod queue, blocked terms, unban requests, chatters |
| **Own channel only** (`channel:*`) | title/category/tags, raid, commercial, clips, markers, polls, predictions, channel-point rewards, add/remove mods & VIPs |

### Endpoints and scopes

Verified against Twitch's scopes reference — a lot of third-party docs get these wrong.

| Action | Endpoint | Scope |
| :-- | :-- | :-- |
| List moderated channels | `GET /helix/moderation/channels` | `user:read:moderated_channels` |
| Ban / timeout / unban | `POST` + `DELETE /helix/moderation/bans` | `moderator:manage:banned_users` |
| Delete message / clear chat | `DELETE /helix/moderation/chat` | `moderator:manage:chat_messages` |
| Warn user | `POST /helix/moderation/warnings` | `moderator:manage:warnings` |
| Chat settings | `PATCH /helix/chat/settings` | `moderator:manage:chat_settings` |
| Send message | `POST /helix/chat/messages` | `user:write:chat` |
| Announcement | `POST /helix/chat/announcements` | `moderator:manage:announcements` |
| Shoutout | `POST /helix/chat/shoutouts` | `moderator:manage:shoutouts` |
| Shield Mode | `PUT /helix/moderation/shield_mode` | `moderator:manage:shield_mode` |
| AutoMod allow/deny | `POST /helix/moderation/automod/message` | `moderator:manage:automod` |
| Blocked terms | `/helix/moderation/blocked_terms` | `moderator:manage:blocked_terms` |
| Unban requests | `/helix/moderation/unban_requests` | `moderator:manage:unban_requests` |
| Chatters | `GET /helix/chat/chatters` | `moderator:read:chatters` |
| Read chat (EventSub) | — | `user:read:chat` |
| Title / category | `PATCH /helix/channels` | `channel:manage:broadcast` |
| Raid | `POST /helix/raids` | `channel:manage:raids` |
| Commercial | `POST /helix/channels/commercial` | `channel:edit:commercial` |
| Clip | `POST /helix/clips` | `clips:edit` |
| Stream marker | `POST /helix/streams/markers` | `channel:manage:broadcast` |

Rate limits: Helix is an **800 points/min** bucket per client-id + token — watch the
`Ratelimit-Remaining` header. Chat sends are 20 per 30s, or 100 per 30s as a moderator.

## Status

| Step | State |
| :-- | :-- |
| **1. Connectivity** | **Settled — direct access works, no helper needed** |
| **2. Auth + token store** | **Done and verified live** — device sign-in, persisted token, single-use refresh, 401 retry, and the pending code survives a reload |
| **3. Chat feed + moderation** | **Done** — channel switcher, live chat, per-message actions, chat settings. Chat + settings confirmed against a real account; the moderation calls themselves are still untested for want of a target |
| **4. Broadcaster controls** | **Done** — title, category, clip, marker, commercial, raid |
| **5. Preferences** | **Done** — layouts, badges, density, quick actions, viewer list, appearance |
| 6. Optional watch-detection (extension + helper) | **Done** — opt-in add-on, widget stays standalone; extension and helper still unsigned |
| 7. Pinned channels, AutoMod queue, mod action log | **Done** — pins, AutoMod queue with alerts, `channel.moderate` narrated in chat |
| **8. Widget roles** | **Done** — Everything / Chat / Activity feed / Quick actions / Stats / Custom, per placed instance; section placements; cross-widget sync |
| 9. On-device pass | **Open** — everything above is verified in a browser against a live account; iCUE's property panel, `uniqueId`, cross-instance storage events and any injected CSP are confirmed only on the EDGE itself |

### Step 1 — settled

The open risk was whether the webview could reach Twitch at all. Deckord's widget only
ever loaded **images** cross-origin and websocketed to `127.0.0.1`, so neither CORS nor a
public `wss://` was proven — and Helix requires `Client-Id` and `Authorization`, both
non-simple headers, so every API call triggers an `OPTIONS` preflight first.

All five checks pass in Chromium:

| Check | Result |
| :-- | :-- |
| Device-code POST to `id.twitch.tv` | `HTTP 400`, `type: "cors"` |
| Preflighted Helix GET with both headers | `HTTP 401`, body readable |
| **Same call from a `null` origin** | **accepted, `HTTP 401`** |
| EventSub WebSocket | `session_welcome` received |
| `static-cdn.jtvnw.net` image | loaded |

The 400/401 are the *correct* answers to deliberately-bogus credentials — what matters is
that the responses came back readable rather than as a CORS `TypeError`.

The null-origin check is the one that decides the architecture. A `sandbox="allow-scripts"`
iframe has an opaque origin, so its requests carry `Origin: null` — exactly what a `file://`
page sends. Twitch accepts it, so **it does not matter whether iCUE serves the widget over
a URL or straight off disk.** Build standalone.

Still worth confirming on the real device: iCUE could inject a Content-Security-Policy of
its own, which no browser test can predict. The diagnostic suite that established the
above has been removed from the UI now that the answer is known — a failed request simply
shows a "Can't reach Twitch" card with a retry, which is all a user can act on anyway.

## What ships today

| Area | |
| :-- | :-- |
| **Channel rail** | Your own channel plus every channel you moderate, with live dots refreshed each minute. Last channel is remembered across restarts. |
| **Live chat** | EventSub `channel.chat.message` with badges, per-user colours, emotes, mentions and sub/raid notices. Deletions grey out live, wherever they came from. |
| **Per-message moderation** | Tap any message: delete it, time the user out (1m / 10m / 1h / 24h), warn, or ban. |
| **Chat settings** | Emote-only, followers-only, subscribers-only, unique-messages and slow mode as live toggles, plus Clear all chat. Active modes show as chips in the header. |
| **Send** | Messages go out as the signed-in account, and a silent AutoMod drop is surfaced instead of vanishing. |
| **AutoMod queue** | A panel beside the chat listing every message AutoMod or a blocked term is holding, with the flagged words marked and Allow / Deny per card. A count rides on the header button and a tappable line lands in chat for each hold. |
| **Alerts** | Messages that mention you, or contain any of your keywords, get a highlighted row and, if wanted, a short sound picked from a dropdown. Purely local. |

| **Activity feed** | Follows, subs, resubs, gifts, cheers, raids, announcements and the stream going live or offline, newest first, with filters. Tap a person to moderate them. |
| **Stats** | Live state with an uptime clock, viewers, followers, subscribers and sub points (own channel), chat pace, what this session brought in, and the current title and category. |
| **Quick actions** | Large touch tiles: the chat modes, Shield Mode and Clear chat on any channel you moderate; stream info, clip, marker, ad break and raid on your own. |

## One widget, several jobs

Twitchify can be added to a screen more than once, and each copy can take a job — the way
the Twitch dashboard puts chat, the activity feed, quick actions and the stats bar in
separate panels:

| Mode | Shows | Live connection |
| :-- | :-- | :-- |
| **Everything** | Chat plus the three sections, each placed where you like (see below) | yes |
| **Chat & controls** | The chat widget as it was | yes |
| **Activity feed** | Just the feed, filling the tile | yes |
| **Quick actions** | Just the tiles | no — polls |
| **Stats** | Just the numbers, large | no — polls |
| **Custom** | A page of your own, framed — see *Custom panels* | no |

In Everything mode each section has a placement of its own (Preferences → This widget),
so the dashboard can be a separate column or fold into the chat layout that was already
there:

| Section | Side panel | Built in |
| :-- | :-- | :-- |
| Stats | tiles in the column | **Top strip** — one row of pills across the top of the chat, the way the dashboard header does it |
| Activity feed | list with filters | **In chat** — follows, cheers and the stream going live land in the chat as rows, beside Twitch's own sub and raid notices (those aren't duplicated) |
| Action tiles | large tiles, with the chat modes | **Bottom bar** — Shield, Info, Clip, Marker, Ad and Raid as chips on a row of their own under the quick-actions bar |

Both bars use an auto-fit grid: one row while the chips fit, folding onto a second row on a
Medium or Large tile rather than squeezing the buttons until their labels vanish.

The column only exists while something is placed in it. Older saved preferences (the
on/off switches from earlier builds) are converted on load.

Two places set the type. iCUE shows a **Widget type** control in the widget's own
settings when it is placed — that is an `x-icue-property` declared in `index.html`, so it is
per placed instance, and it wins whenever it says anything other than *Chosen in the
widget*. Otherwise the choice is made in **Preferences → This widget**, and stored per
instance too: iCUE injects a `uniqueId` for every placed widget, and every instance shares
one `localStorage`, so the key carries the id. In a browser, `?mode=feed` (and `?inst=x` to
tell tabs apart) does the same.

### iCUE's own settings panel

Every preference in the widget's dialog is also declared as an `x-icue-property`, so the
panel iCUE shows for a placed widget carries the same Dashboard, Layout, Chat, Moderation
and Appearance settings. `gen_mirror.py` generates those declarations and the panel groups
from one table, and writes the matching `ICUE_MIRROR` table into `main.js`, so the two
cannot drift — edit the table, re-run it. Three names are renamed on the way
(`twAccent`, `twBackground`, `twTransparency`) because iCUE reserves the obvious ones.

iCUE has no API to write a value back into its panel, so the two editors are reconciled
by *diffing*, Deckord's approach: a property whose panel value moved since this copy last
looked wins; everything else keeps what the dialog last set. The first look is the one
refinement — the panel shows its declared defaults, which say nothing about what the user
chose in the dialog before this update, so only values already moved off their default
count as edits then. Preferences are shared across copies while the panel is per copy, so
the "last seen" snapshot is per copy; the last edit anywhere wins and every copy follows.
Not mirrored: the timeout buttons, the header-button set, the custom-panel list and the
saved layouts, which are lists rather than single values.

Besides those, the panel carries a **Text size** group and a **Colours** group, as
Deckord's does. Both are per placed
instance and read live — a Stats copy can run at 150% while the chat copy stays dense —
and neither is duplicated in the widget's Preferences, so there is nothing to reconcile.

Text size is an overall multiplier plus one per area (chat, channel list and header,
buttons and tiles, feed and stats), stacking. Every size in the stylesheet is in pixels,
so it is applied as **region `zoom`** rather than a font-size cascade. That has one
consequence worth knowing: `getBoundingClientRect()` answers in screen pixels while a
zoomed element's own `left`/`top` are in its zoomed space, so everything placed by
coordinates — the header's search popover, the body-level menus and the tooltip —
converts through `zoomOf()`. Only leaf regions are zoomed for the per-area sliders;
overlays and menus take the overall multiplier alone.

*Follow iCUE screen colours* reads the four names iCUE reserves for the screen's own
personalisation (`accentColor`, `backgroundColor`, `textColor`, `transparency`) — Deckord
learned that any property using those names is overwritten by iCUE, so they are declared
only to be read, and only override the Preferences colours while the switch is on.

How iCUE hands values over, per Deckord's notes from the device: one global **`let`** per
property (so `window[name]` never sees them; `icueProp()` reads through an indirect eval
that does), and `icueEvents` is a `let` as well, so the handlers are merged into the
existing object with `Object.assign` from the inline script rather than replacing it.

### Custom panels (optional)

The OBS idea of a *browser source*: paste a link, get it framed. Preferences → **Custom
panels** holds up to six, each a name plus an `https://` link. A panel shows either as the
whole widget (type **Custom**, with a per-instance **Panel** picker) or beside the chat in
Everything mode (**Custom panel → Side panel**). iCUE's settings for a placed widget also
carry a **Custom panel link** field; a link there turns that copy into the panel outright,
unless the type control says otherwise, so a copy can be set up without opening the
widget at all.

What works is whatever was built to be embedded: StreamElements and Streamlabs overlays
and alert boxes, goal bars, the Twitch player embed. Ordinary pages — the Twitch dashboard
included — send `X-Frame-Options` and stay blank inside a frame; the browser gives no
signal a page can read, so the editor says so up front rather than pretending to detect
it. The frame is sandboxed to scripts, its own storage, forms and popups; a cross-origin
frame can reach nothing of the widget's regardless. It is unloaded whenever its section
is hidden, since an overlay keeps sockets open for as long as it exists. Off by default
and empty by default: leave the list alone and nothing changes.

### What sharing one localStorage buys

Every copy shares the sign-in automatically — connect once, and the others come up signed
in. The `storage` event, which fires in every *other* instance when a key changes, carries
the rest: a preference changed in one widget applies in all; a channel switched in one
switches the others (*Widgets follow each other*, on by default, and a widget running
several chats side by side is left alone); a sign-out anywhere signs out everywhere; a
device-code sign-in begun in one widget shows its code in all of them, and whichever
polls it in first hands the token to the rest.

The refresh token is the one hazard. It is single-use, so two widgets refreshing at once
would strand the second. `refresh()` therefore re-reads the store first (another widget may
already have refreshed), then takes a 15-second lock key while it works, and a widget that
finds the lock waits for the new token to land instead of spending a dead one.

### Sockets

Twitch allows **three EventSub websockets per user per client-id**. Chat and the feed need
one each; Quick actions and Stats deliberately poll Helix instead (every 30s), so a screen
holding chat + feed + actions + stats uses two. A fourth chat-bearing widget would fail to
connect.

The feed's extras cost little: subs, gifts and raids already arrive on
`channel.chat.notification` and cheers ride on the message itself, so only
`stream.online`, `stream.offline` and `channel.follow` (v2, `moderator:read:followers`, mod
powers required) are added. A feed-only widget subscribes to messages and notifications
alone, not the deletion and settings traffic. Recent follows are seeded from
`/channels/followers` on open so the feed isn't blank; live arrivals dedupe against them.

### Scopes an older sign-in lacks

`moderator:read:followers`, `moderator:manage:shield_mode` and `channel:read:subscriptions`.
An older sign-in lacks them, so the feed notes *Sign out and connect again to see follows*,
the followers tile reads *Reconnect to enable*, and the Shield Mode tile says the same;
everything else keeps working.

Only the open channel holds EventSub subscriptions — six of them, torn down on switch. That
is deliberate: it keeps a wide margin under the 300-per-socket cap, at the cost of losing
scrollback when switching. Pinned multi-channel subscriptions are a later step.

### Signing in has to survive a reload

Opening the verification link can reload or navigate the widget, depending on what the
host allows — which silently killed the flow: the user approved on Twitch and nothing
happened, because nothing was left polling. So the pending device code is persisted and
resumed on boot, and the link is opened at most once per code (the "opened" flag is
written *before* the attempt, so a reload mid-open resumes instead of reopening forever).

`window.open` was the first attempt and it reset the widget outright. A detached
`<a target="_blank">` is gentler: a host that refuses it simply does nothing. Both the
**Open Twitch** and **Copy link** buttons plus the printed code stay on screen regardless,
so there is always a way through even if the host blocks external navigation entirely.

### Scopes and re-consent

Adding a scope does not upgrade an existing token — the user must approve again. So scope
additions are worth batching. The current set covers chat, moderation, the viewer list and
the broadcaster tier; anything asking for a scope the stored token predates fails with
`Missing scope`, which the UI turns into a "sign out and connect again" prompt rather than
a dead end.

### EventSub subscriptions leak without pruning

A websocket subscription outlives the socket that owned it. Reload the widget and Twitch
keeps the old ones in `websocket_disconnected`, counting against the account's limits until
they age out — testing accumulated 33 of them, 27 dead. They can only be removed from a
later session, so `pruneStaleSubscriptions()` runs on every start. Two things it must get
right: collect every page *before* deleting (deleting mid-pagination shifts the cursor and
skips entries), and treat `409 already exists` as success while aborting on
`session does not exist`, since six sequential creates can outlive their own session.

### Third-party emotes

BTTV, 7TV and FrankerFaceZ all serve open, CORS-enabled JSON, so the widget reads them
directly — no helper, no key:

| Provider | Global | Per channel |
| :-- | :-- | :-- |
| BTTV | `api.betterttv.net/3/cached/emotes/global` | `/3/cached/users/twitch/{id}` |
| 7TV | `7tv.io/v3/emote-sets/global` | `7tv.io/v3/users/twitch/{id}` |
| FFZ | `api.frankerfacez.com/v1/set/global` | `/v1/room/id/{id}` |

Channel endpoints return `404` for streamers not registered with a provider, which is the
normal case and is swallowed. Twitch's own emotes arrive as message *fragments*; third-party
ones are just words, so plain-text fragments are scanned token by token against the map.

### Icons

One family, defined once as `<symbol>`s in `index.html`: 24px grid, **stroke-only**,
2px weight, round caps and joins. The first pass drew each glyph ad hoc — some filled,
some stroked, at different weights — which is what made the chrome look assembled from
spare parts.

Because of that, CSS must never set `fill` on an icon: an author rule beats the
presentation attributes on the symbol and would flood the outline shapes. A single
`svg { fill: none; stroke: currentColor; ... }` rule owns it, and per-icon rules only
change `stroke`, size and weight.

### Built for a touchscreen, not a mouse

The EDGE has no cursor, so the widget is sized and behaved for fingers:

- **Targets have a floor.** `--ctl-min` is 44px at Medium (36 Small, 54 Large) and is
  enforced with `min-height`/`min-width`, not left to padding arithmetic. A
  `@media (pointer: coarse)` bump exists on top, but it is a bonus — an embedded webview
  may report a *fine* pointer, and relying on the query alone left 33px targets.
- **Hover is scoped.** `@media (hover: none)` neutralises hover styles, which otherwise
  latch after a tap and look stuck. `:active` carries the feedback instead.
- **No tap delay, highlight or callout** — `touch-action: manipulation`,
  `-webkit-tap-highlight-color: transparent`, `-webkit-touch-callout: none`.
- **Momentum scrolling** with `overscroll-behavior: contain`, so reaching the end of chat
  doesn't drag the whole widget, and 10px scrollbar thumbs you can actually grab.
- **A short-screen pass** (`@media (max-height: 480px)`) trims chrome for small widget
  placements; at the EDGE's full 720px there is room to spare.

Measured at 2560x720: no overflow on either axis, rail 208px, chat area 2340x550.

## Watch sync (optional add-on)

Shows the chat of Twitch channels you have **open in your browser**. Entirely opt-in — the
widget works without it, and nothing here touches the Twitch token.

Twitch has no "what am I watching" API and a sandboxed widget cannot see the browser, so
this needs two small pieces:

```
Chrome extension ──POST /tabs──▶ helper (127.0.0.1:57123) ──SSE /events──▶ widget
```

The widget cannot listen on a port and an extension cannot be dialled into, so something
has to hold the connection in the middle. **Server-Sent Events** carry the widget leg: the
push is one-way, so there is no WebSocket framing to hand-roll, and both legs are plain
HTTP with CORS headers.

Only channel logins travel — no cookies, no page content, no credentials — and the only
destination is loopback.

| Piece | |
| :-- | :-- |
| `watch-extension/` | MV3 extension for Chrome and Firefox. Reads Twitch tab URLs, resolves the channel, POSTs on change (debounced). An alarm re-syncs each minute because the background worker is evicted when idle. |
| `watch-helper/` | Loopback HTTP server, C# / .NET 8, single-file and self-contained. `POST /tabs`, `GET /events` (SSE), `GET /health`, `POST /autostart`. No window, single instance, logs to `%LOCALAPPDATA%\TwitchModeration\helper.log`. |
| `watch-helper/setup/` | One-click installer (WinForms) embedding the helper: installs it, registers autostart, adds a Settings → Apps entry, launches it. `/silent` and `/uninstall` supported. |

Channels appear under a **Watching** heading in the rail, with the focused tab marked.
Two preferences control it: *Channels open in my browser*, and *Follow the focused tab*
to switch automatically.

### One codebase, two manifests

Firefox runs MV3 background scripts as an event page (`background.scripts`) rather than
a service worker, and needs an add-on id under `browser_specific_settings.gecko` (plus
the newer `data_collection_permissions` declaration, which is "none" here). Everything
else — `chrome.*` calls, the popup, the alarm — runs unchanged, so only the manifest
differs and `build.py` swaps it. One behavioural difference: Firefox MV3 treats
`host_permissions` as optional and doesn't grant them at install. That's fine here —
the `tabs` permission alone exposes tab URLs, and the helper answers with permissive
CORS headers, so the loopback POST needs no host grant.

### It runs with iCUE

The same pattern as Deckord's helper. Windows offers no "when iCUE launches" trigger
without something already resident (the WMI event-subscription trick that can do it needs
admin rights and is a textbook malware-persistence pattern, so it's out), so the helper is
resident — a per-user Run entry, set by the installer — but **asleep**: no port, no
listener, nothing, until `iCUE.exe` is running. It polls for it every 5s. Once iCUE is
up it serves, and keeps serving through page switches on the EDGE; when iCUE has been
gone for two checks in a row (30s, so a restart doesn't count) and no widget is attached,
it closes the port and goes back to sleep. Deckord's equivalent is its activity gate.

The second way in is the `twitchify-helper://` URL scheme, which the helper registers for
itself (per user, in `HKCU\Software\Classes`, no elevation) and re-points at its own exe
on every launch. The widget opens `twitchify-helper://start` through the same
detached-anchor route as the sign-in link whenever watch sync is on and `/health` doesn't
answer, at most once a minute, and Preferences has a **Start helper** button beside the
status tiles. A helper started that way exits, rather than sleeps, once iCUE is gone —
unless a widget is still attached, which is the browser preview, where there is no iCUE
at all. Installing with `/noautostart` makes that the only mode: no Run entry, started by
the widget, gone with iCUE.

One caveat carries over from the sign-in link: whether the iCUE host lets a widget open
an external scheme is confirmed only on the device. The Run entry doesn't depend on it.

### Running it

1. Run **`Twitch Watch Sync Setup.exe`** once. It installs the helper to
   `%LOCALAPPDATA%\TwitchModeration`, sets it to run with iCUE (a Run entry that sleeps
   until iCUE is open), registers the scheme and launches it.
   Portable alternative: run `TwitchWatchHelper.exe` directly — it registers the scheme
   on every launch, so one manual start is enough for the widget to find it afterwards.
2. Load the extension. Chrome: **chrome://extensions** → Developer mode → **Load
   unpacked** → select `watch-extension/`. Firefox: **about:debugging** → This Firefox →
   **Load Temporary Add-on** → pick `manifest.firefox.json` in the same folder (a
   temporary add-on is gone after a restart; the signed AMO build is permanent).
3. In the widget, turn on **Channels open in my browser** in Preferences.

The extension's toolbar badge shows how many channels are shared; its popup reports
whether the helper and the widget are connected. Uninstall from Settings → Apps, or
`"Twitch Watch Sync Setup.exe" /uninstall`.

Build (needs the .NET 8 SDK) — helper first, since the installer embeds it:

```bash
cd watch-helper && dotnet publish -c Release -o publish && cd setup && dotnet publish -c Release -o publish
```

Both builds come out as one self-contained exe each (`publish/TwitchWatchHelper.exe` and
`setup/publish/Twitch Watch Sync Setup.exe`), with the Twitchify icon and version info
embedded. Neither is code-signed — see Publishing.

### Subscriptions must be reconciled, not tracked

Locally tracked subscription ids drift out of sync: a `409` hands back an id that was never
stored, a reconnect orphans a set, a swallowed `DELETE` leaves a ghost. Testing accumulated
**18 enabled subscriptions across three channels** when there should have been six.

Twitch is the only authority on what exists, so after settling on a channel the widget asks
it and deletes anything of its own that isn't for that channel — matched on
`transport.session_id`, so a second widget on another screen keeps its own. Steady state is
exactly six enabled subscriptions.

### Badges are keyed by `id`, not `version`

EventSub sends `{set_id, id, info}` — `id` *is* the version. Looking up `b.version` missed
every time and fell through to the text label, which only covers five known sets, so
prediction, premium, sub and event badges silently vanished. Nothing errored; they just
weren't there.

Text mode has the same blind spot by design: it can only label sets it has names for.
**Real** badge art is the default for that reason.

### Moderation is hidden where it doesn't apply

Watch sync means you can open a channel you have no powers in. `canMod()` gates the quick
actions, the chat-settings button and the whole action set in the user sheet, and chat
settings aren't even requested — a moderator call on someone else's channel just 401s.
The sheet shows a plain note instead of buttons that would fail on tap.

### AutoMod queue

Held messages never reach chat, so the queue is the only sight of them: `automod.message.hold`
v2 carries the message, the sender, and either AutoMod's category and level or the blocked
term that fired — each with inclusive character boundaries, which the panel uses to mark
the offending span. `automod.message.update` v2 says how it was resolved, by anyone, so a
card vanishes the moment another moderator on the web acts on it. Both subscriptions take
`moderator_user_id` and need `moderator:manage:automod`; a token that predates the scope
fails the subscription with an authorization error, which the panel turns into a "sign out
and connect again" note rather than an empty list. Resolving is
`POST /helix/moderation/automod/message` with `ALLOW` or `DENY`; a 404 means someone got
there first, and the card is dropped instead of retried.

### Alerts are local

A mention is either a `mention` fragment resolving to the signed-in user, or a plain
`@login` in the text — Twitch only tags the mentions it could resolve. Keywords are a
comma-separated, case-insensitive list. The sounds are synthesised with WebAudio at the
moment they play (no files ship), rate-limited to one every two seconds, and marked on the
event so replaying a channel's buffer on switch never replays the chime. Browsers only
start audio after a gesture, so the first tap anywhere unlocks it.

### Timeout buttons

Each button is a value plus a unit (`s`/`m`/`h`/`d`), edited as its own row, up to six.
**Milliseconds aren't offered** because Twitch takes a timeout in whole seconds — the API
has no way to express less. The maximum is 14 days. Older builds stored a comma-separated
list of seconds; that is migrated on load, so `86400` becomes `1d`.

### Per-channel loads must be tagged

Switching channels fires several async loads. A request for the *previous* channel can
resolve after the switch and repaint the new view with the old channel's data — the viewer
list showed the previous channel's chatters this way. Every per-channel load now captures
the channel id it was made for and drops its result if the user has moved on.

## Demo mode and marketing

`?demo` on the URL boots the widget into a fully offline, believable stream — an own channel
live with a full chat, two moderated channels, followed channels, an activity feed and the
numbers to match. Every Helix call is refused up front (`api()` throws in demo), so nothing
reaches Twitch. iCUE's widget-gallery preview (`iCUE.isPreview`) gets the same when no
sign-in is stored, so the gallery shows a stream rather than a Connect button.

`remotion/` holds the marketing set, in the same shape as Deckord's: `shots.py` drives the
installed Chrome through Playwright to capture the demo at 2x in every widget type into
`public/`; `npm run thumbs` renders four marketplace stills; `npm run promo` renders the
27-second promo video. Renders pass `--browser-executable` pointing at the installed
Chrome so Remotion never downloads its own. The copy for the listing is
`MARKETPLACE_DESCRIPTION.md`.

## Building

### Validating

Corsair's CLI checks the manifest and HTML the way iCUE's importer does. It ships as an
npm package; run it without installing:

```bash
npx --yes icuewidget-cli validate twitch-widget
```

Two of its warnings are worth knowing about. *translation.json is missing* — every `tr()`
key in the `x-icue-property` labels must appear in `twitch-widget/translation.json`
(`en` is required and is the fallback). *Scripts do not reference icueEvents* — the
validator only reads scripts **inlined in `index.html`**, not linked files, and it wants
a bare `icueEvents = {...}`; that assignment lives in a small non-strict inline script
there, forwarding to `onIcueData()` in `main.js`, whose own strict code could not make it.
Both are clean now; a rewrite that moves either would bring the warning back.

Marketplace publishing is not open yet — Corsair says a creators portal for the Elgato
Marketplace is coming, with free and paid widgets. Until then distribution is the
`.icuewidget` file itself.

Zip the **contents** of `twitch-widget/` (files at the archive root, not the folder).
Copy to a temp folder first if a dev server has the files open — `Compress-Archive` fails
on locked files:

```bash
rm -rf /tmp/tw && cp -r twitch-widget /tmp/tw && rm -f twitchify.icuewidget && (cd /tmp/tw && powershell -NoProfile -Command "Compress-Archive -Path '.\*' -DestinationPath 'w.zip' -Force") && mv /tmp/tw/w.zip twitchify.icuewidget
```

To preview in a browser instead, `.claude/launch.json` serves `twitch-widget/` on
port 5599. Note that gives it an `http://localhost` origin — iCUE may use `file://`
instead, which is why the widget checks the null-origin case explicitly.

## Publishing

What ships, and what each store still needs from us:

| Piece | Artifact | State |
| :-- | :-- | :-- |
| Widget | `twitchify.icuewidget` | Ready — rebuild from `twitch-widget/` before every release (see Building) |
| Extension | `twitchify-watch-sync-chrome-<v>.zip`, `twitchify-watch-sync-firefox-<v>.zip` | Ready to upload; need a Chrome Web Store listing and a Firefox Add-ons (AMO) listing |
| Helper + installer | `watch-helper/setup/publish/Twitch Watch Sync Setup.exe` | Ready to distribute; unsigned |

Release checklist:

1. **Versions.** The widget and the extension move together (`twitch-widget/manifest.json`,
   `watch-extension/manifest.json`, `watch-extension/manifest.firefox.json`). The helper
   has its own version in both `.csproj` files and `DisplayVersion` in `SetupProgram.cs`,
   bumped only when it changes.
2. **Widget.** Rebuild the `.icuewidget` (Building, above). Import it into iCUE once to
   confirm it opens — the packaged zip is the only thing users get.
3. **Extension.** `python watch-extension/build.py` writes one zip per browser. Upload
   the Chrome one to the
   [Chrome Web Store developer dashboard](https://chrome.google.com/webstore/devconsole)
   (one-off developer registration fee) and the Firefox one to
   [addons.mozilla.org](https://addons.mozilla.org/developers/) (free; AMO signs it).
   Both listings need: a 128px icon (in the zip), at least one screenshot, a
   privacy-policy URL, and a justification for the `tabs` permission — "reads the URL of
   open twitch.tv tabs to tell a local widget which channels you have open; nothing
   leaves the machine" is the honest one. Chrome may review the use of "Twitch" in the
   name; the description already states it is not affiliated. Until a listing is
   approved, Chrome users can Load unpacked and Firefox users can load it temporarily
   from `about:debugging`.
4. **Helper.** Publish helper then installer (Building). Distribute the setup exe from a
   GitHub release. Without an Authenticode signature Windows SmartScreen will warn on
   first run; a code-signing certificate removes that and is the one open item. Don't
   ship the `publish/` folders in git — they're ignored.

```bash
python watch-extension/build.py
```

## Files

| Path | |
| :-- | :-- |
| `twitch-widget/` | Widget source (HTML/CSS/JS) |
| `twitchify.icuewidget` | Packaged widget — import this in iCUE |
| `serve.py` | Dev static server — `no-store`, threaded (single-threaded stalls the whole server on one held connection) |
| `watch-extension/` | Extension source. `manifest.json` is Chrome's, `manifest.firefox.json` Firefox's (event-page background, add-on id); `build.py` zips both |
| `watch-helper/` | Helper and installer source; `app.ico` is the shared exe icon |
| `.claude/launch.json` | Points the browser preview at `serve.py` |
