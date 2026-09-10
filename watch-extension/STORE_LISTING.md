# Twitchify Watch Sync — store listing

## Name

Twitchify Watch Sync

## Short description (Chrome: 132 characters max)

Shows the chat of the Twitch channel you are watching on your XENEON EDGE, together with the Twitchify iCUE widget.

## Description

Twitchify Watch Sync is the optional companion for the Twitchify widget on the CORSAIR XENEON EDGE.

Open a Twitch channel in your browser and its chat appears on the EDGE. Switch tabs and the chat can follow the one you are watching. Nothing to type, nothing to search for.

What It Does

- Lists the Twitch channels you have open in your browser inside the Twitchify widget.

- Lets the widget follow the tab you are watching, so the chat on your EDGE always matches your screen.

- Shows in its toolbar badge how many channels are being shared, and in its popup whether the helper and the widget are connected.

How It Works

The extension reads the addresses of your open Twitch tabs and sends the channel names to a small helper app on your own PC. The Twitchify widget listens to that helper. That is the whole chain, and all of it stays on your computer.

Privacy

- Only channel names are shared. No page content, no cookies, no messages, no account details.

- The only destination is 127.0.0.1, your own PC. Nothing is sent to any server.

- No data is collected, stored, or sold.

Requirements

- The Twitchify widget on a CORSAIR XENEON EDGE, with iCUE 5.45 or newer.

- The Twitchify Watch Sync helper app on Windows, which runs with iCUE.

- Turn on "Channels open in my browser" in the widget's Preferences.

Notes

- The extension does nothing on its own. Without the widget and the helper it simply stays idle.

- Chrome, Edge, Brave, Opera, and other Chromium-based browsers use this extension. Firefox has its own add-on.

## Category

Productivity (or Social & Communication)

## Single purpose (Chrome review)

Report the Twitch channels open in the browser to the Twitchify iCUE widget on the user's own PC, so the widget can show that channel's chat.

## Permission justifications (Chrome review)

- tabs: to read the URL and title of open Twitch tabs and know which one is focused. Only twitch.tv tabs are looked at, and only the channel name is used.

- alarms: to re-send the tab list once a minute, because the background service worker is suspended when idle.

- Host permission *://*.twitch.tv/*: to match Twitch tabs by URL. No content scripts run on the page.

- Host permission http://127.0.0.1/*: to send the channel names to the helper app on the user's own computer.

- Remote code: none. No code is loaded from the web.

## Data usage disclosure (Chrome)

Tick **Web history**, and nothing else.

- **Web history** — yes. The form defines it as "the list of web pages a user has visited, as well as associated data such as page title", and the policy's own wording covers "the domains or URLs the browser interacts with". The extension reads the URL of Twitch tabs to work out the channel, so this is the category that applies.

- **Website content** — no. The policy's example for that category is "clipping or scraping content from a website that the user visits, such as taking screenshots or capturing data from a web page". This extension registers no content scripts and never reads the page.

- Everything else on the list — no.

Local-only handling does **not** exempt the disclosure. The User Data FAQ says extensions must disclose how they handle user data "even when data is processed or stored locally on a user's device and is not transmitted to external servers or third parties", so leaving every box unticked would be an under-disclosure.

All three certifications at the bottom of the form are true and should be ticked: no selling or transferring to third parties, no use unrelated to the single purpose, and no use for creditworthiness or lending.

## Assets

- Store icon: store/icon-128.png (128×128, 96 px art with padding).

- Screenshots (1280×800): store/shot-1-follow.png, store/shot-2-how.png, store/shot-3-popup.png — rendered from ../remotion (`npm run ext-shots`).

- Small promo tile (440×280): optional, not produced.
