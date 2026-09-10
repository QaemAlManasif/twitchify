"use strict";

// ══════════════════════════════════════════════════════════════════
// Twitchify — Watch Sync
//
// Reports which Twitch channels are open in this browser to the local
// helper, which relays them to the widget. Nothing else is collected and
// nothing leaves the machine: the only destination is 127.0.0.1.
// ══════════════════════════════════════════════════════════════════

const HELPER = "http://127.0.0.1:57123/tabs";
const DEBOUNCE_MS = 400;

// twitch.tv/<login> is a channel, but plenty of first-level paths aren't.
const RESERVED = new Set([
  "directory", "settings", "videos", "subscriptions", "wallet", "drops",
  "friends", "inventory", "store", "prime", "downloads", "jobs", "turbo",
  "search", "following", "team", "p", "u", "login", "signup", "activate",
  "products", "payments", "broadcast", "dashboard", "creatorcamp", "bits",
]);

// Returns the channel login a Twitch URL is showing, or null.
function channelOf(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (!/(^|\.)twitch\.tv$/.test(u.hostname)) return null;

  const parts = u.pathname.split("/").filter(Boolean);
  if (!parts.length) return null;

  // /popout/<login>/chat and /moderator/<login> both name the channel second.
  if (parts[0] === "popout" || parts[0] === "moderator") {
    return parts[1] ? parts[1].toLowerCase() : null;
  }
  // /videos/123 and /directory/... are not a channel.
  if (RESERVED.has(parts[0].toLowerCase())) return null;
  // A bare /<login> is the channel page; /<login>/about etc. still is.
  return parts[0].toLowerCase();
}

let timer = null;
let lastBody = "";

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(report, DEBOUNCE_MS);
}

async function report() {
  let tabs, focusedWindowId;
  try {
    tabs = await chrome.tabs.query({ url: ["*://*.twitch.tv/*"] });
    const win = await chrome.windows.getLastFocused().catch(() => null);
    focusedWindowId = win ? win.id : -1;
  } catch {
    return;
  }

  const seen = new Map();
  for (const t of tabs) {
    const login = channelOf(t.url || "");
    if (!login) continue;
    const entry = {
      login,
      title: t.title || login,
      active: !!t.active,
      focused: !!t.active && t.windowId === focusedWindowId,
    };
    // The same channel can be open twice; keep the most prominent copy.
    const prev = seen.get(login);
    if (!prev || (entry.focused && !prev.focused) || (entry.active && !prev.active)) {
      seen.set(login, entry);
    }
  }

  const body = JSON.stringify({ tabs: [...seen.values()] });
  // Tab events fire in bursts; only speak when something actually changed.
  if (body === lastBody) return;

  try {
    await fetch(HELPER, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    lastBody = body;
    await chrome.action.setBadgeText({ text: seen.size ? String(seen.size) : "" });
    await chrome.action.setBadgeBackgroundColor({ color: "#9146ff" });
  } catch {
    // Helper not running — retry on the next event rather than looping.
    lastBody = "";
    await chrome.action.setBadgeText({ text: "" });
  }
}

for (const ev of [
  chrome.tabs.onCreated, chrome.tabs.onRemoved, chrome.tabs.onUpdated,
  chrome.tabs.onActivated, chrome.tabs.onAttached, chrome.tabs.onDetached,
  chrome.windows.onFocusChanged, chrome.windows.onRemoved,
]) {
  ev.addListener(schedule);
}

chrome.runtime.onStartup.addListener(schedule);
chrome.runtime.onInstalled.addListener(schedule);

// A service worker is evicted when idle, which would stop the reporting.
// An alarm wakes it often enough to keep the widget's list honest.
chrome.alarms.create("resync", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(() => { lastBody = ""; schedule(); });

// The popup asks for the current picture.
chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
  if (msg === "status") {
    fetch("http://127.0.0.1:57123/health")
      .then((r) => r.json())
      .then((j) => respond({ helper: true, ...j }))
      .catch(() => respond({ helper: false }));
    return true;   // respond asynchronously
  }
});

schedule();
