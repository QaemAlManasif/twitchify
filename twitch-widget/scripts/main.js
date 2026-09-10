"use strict";

// ══════════════════════════════════════════════════════════════════
// Twitchify — iCUE widget for XENEON EDGE
//
// Standalone: talks to Twitch directly over HTTPS + WebSocket, with no
// background helper. Sign-in is OAuth Device Code Grant, a *public
// client* flow — there is no client secret, so the Client ID below
// ships inside the widget and users never see or enter it.
//
//   chat + events in  →  one EventSub WebSocket
//   every action out  →  Helix REST
//
// One user token covers every channel the user moderates: each Helix
// moderation call carries broadcaster_id (target) + moderator_id (self)
// and Twitch verifies mod status server-side. Nothing is stored or
// re-authorised per channel.
// ══════════════════════════════════════════════════════════════════

// ── The published app's Client ID ──────────────────────────────────
// Registered at dev.twitch.tv/console/apps as a Public client. A Client
// ID is not a secret — it is public by design, and a public client is
// issued none — so it ships in the widget and users never enter it.
const CLIENT_ID = "0mndjxioroyem1ttay3z8m0k5h5wzw";

const TOKEN_KEY = "twitchmod_token";
const LAST_CHANNEL_KEY = "twitchmod_last_channel";
const PENDING_KEY = "twitchmod_pending";
const PREFS_KEY = "twitchmod_prefs";
const RAID_KEY = "twitchmod_raid";
const PINS_KEY = "twitchmod_pins";
const SPLIT_KEY = "twitchmod_split";
const LAYOUTS_KEY = "twitchmod_layouts";
// Per placed widget: iCUE gives each instance a uniqueId, and every
// instance shares one localStorage, so the key carries the id.
const INST_PREFIX = "twitchmod_inst_";
const REFRESH_LOCK = "twitchmod_refresh_lock";

// Recovery hatch: opening with ?safe starts on a single chat instead of
// restoring the saved split. Four of the busiest chats at once can pin a
// slow machine hard enough that there is no way to close one by hand.
const SAFE_MODE = typeof location !== "undefined" && /[?&]safe\b/.test(location.search);
// Demo: a believable, fully offline stream — for iCUE's widget gallery
// preview (no sign-in there) and for screenshots. Nothing reaches Twitch.
const DEMO = (typeof location !== "undefined" && /[?&]demo\b/.test(location.search))
  || (typeof iCUE === "object" && iCUE && iCUE.isPreview === true && !localStorage.getItem("twitchmod_token"));
const MAX_SPLIT = 4;

const SCOPES = [
  "user:read:chat",                    // read chat over EventSub
  "user:write:chat",                   // send messages
  "user:read:moderated_channels",      // list channels you mod
  "user:read:follows",                 // list channels you follow + their live state
  "moderator:manage:banned_users",     // ban / timeout / unban
  "moderator:manage:chat_messages",    // delete a message, clear chat
  "moderator:manage:chat_settings",    // slow, followers, emote, sub, unique
  "moderator:manage:warnings",         // warn a chatter
  "moderator:read:chatters",           // viewer list
  // channel.moderate v2 needs read access across every moderation area,
  // even the ones this widget never writes to.
  "moderator:read:blocked_terms",
  "moderator:read:unban_requests",
  "moderator:read:moderators",
  "moderator:read:vips",
  "moderator:read:followers",          // follows in the activity feed, follower count
  "moderator:manage:shield_mode",      // Shield Mode tile
  "moderator:manage:automod",          // AutoMod queue: allow or deny held messages
  // Broadcaster tier — only ever applies to your own channel.
  "channel:read:subscriptions",        // subscriber count in stats
  "channel:manage:broadcast",          // title, category, stream markers
  "channel:manage:raids",              // start / cancel a raid
  "channel:edit:commercial",           // run an ad break
  "clips:edit",                        // create clips
].join(" ");

const ID_BASE = "https://id.twitch.tv/oauth2";
const HELIX = "https://api.twitch.tv/helix";
const EVENTSUB_WSS = "wss://eventsub.wss.twitch.tv/ws";

const MAX_MESSAGES = 200;       // rendered scrollback per channel
const MAX_BACKGROUND = 4;       // extra channels kept loaded behind the open one
const LIVE_POLL_MS = 60000;     // how often to refresh live badges

// ── Preferences ────────────────────────────────────────────────────
// Twitch takes a timeout in whole seconds, capped at 14 days, so the unit
// list stops at seconds — sub-second durations aren't expressible.
const UNITS = { s: 1, m: 60, h: 3600, d: 86400 };
const MAX_TIMEOUT = 1209600;

const DEFAULT_PREFS = {
  layout: "side",            // side | top | chat
  showQuickActions: true,
  qaLabels: true,            // text labels beside quick-action icons
  showComposer: true,
  buttonSize: "md",          // sm | md | lg
  selectedStyle: "border",   // border | fill
  scrollbars: true,
  showViewers: false,
  badgeStyle: "images",      // images | text | off
  thirdPartyEmotes: true,    // BTTV / 7TV / FFZ
  sharedChatSource: true,    // label Stream Together messages with their channel
  watchSync: false,          // read open Twitch tabs from the local helper
  preloadWatched: false,     // keep watched channels' chat loaded in the background
  showFollowed: true,        // list channels you follow
  followedOnlyLive: true,    // ...but only the ones currently live
  followActiveTab: false,    // and switch to whichever one is focused
  showTimestamps: false,
  clock: "12",               // 12 | 24
  showChannelAvatar: true,
  showChatAvatars: false,
  inlineModActions: false,
  showTabsInChat: false,
  channelSwitcher: true,
  splitAddOnClick: true,     // in split view, picking a channel adds a pane
  emoteSuggest: true,        // suggest emotes while typing a message
  defaultLayout: "",         // a saved layout to open on start
  jumpLatest: true,          // offer a jump back to the newest line
  // The dashboard column beside the chat, in Everything mode.
  // Where each section lives: in the side panel, folded into the chat
  // layout itself (a strip across the top, rows in the chat, chips in the
  // bottom bar), or off.
  statsPlace: "panel",       // panel | strip | off
  feedPlace: "panel",        // panel | chat | off
  actionsPlace: "off",       // panel | bar | off
  // Optional: pages of the user's own, framed like an OBS browser source.
  customPanels: [],          // [{id, name, url}]
  customPlace: "off",        // panel | off
  syncChannel: true,         // other Twitchify widgets follow a channel switch
  // Which header buttons to show. Preferences itself is never optional —
  // hiding it would strand you with no way back into this list.
  headerButtons: {
    status: true, search: true, filter: true, open: true,
    pins: true, split: true, viewers: true, settings: true, broadcast: true,
  },
  density: "cosy",           // cosy | compact
  fontSize: 14,
  accent: "#9146ff",
  bg: "#0a0a0c",
  transparency: 0,
  timeouts: [{ n: 1, u: "m" }, { n: 10, u: "m" }, { n: 1, u: "h" }, { n: 24, u: "h" }],
  confirmBan: true,
  confirmInlineActions: false,
  confirmQuickActions: false,
  confirmRow: true,
  // AutoMod queue and alerts.
  showAutomod: false,        // held-message queue beside the chat
  automodNotices: true,      // a line in chat when AutoMod holds a message
  alertMentions: true,       // highlight messages that mention you
  alertKeywords: "",         // comma-separated words that also highlight
  alertSound: "off",         // off | ping | pop | chime | knock
};
let prefs = { ...DEFAULT_PREFS };

function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) prefs = { ...DEFAULT_PREFS, ...JSON.parse(raw) };
    // Nested objects need merging too, or a build that adds a button
    // would find it missing from an older saved set.
    prefs.headerButtons = { ...DEFAULT_PREFS.headerButtons, ...(prefs.headerButtons || {}) };
    // The dashboard sections began as on/off switches; each is a
    // placement now.
    if ("showStats" in prefs && !("statsPlace" in JSON.parse(raw))) prefs.statsPlace = prefs.showStats ? "panel" : "off";
    if ("showFeed" in prefs && !("feedPlace" in JSON.parse(raw))) prefs.feedPlace = prefs.showFeed ? "panel" : "off";
    if ("showActionsGrid" in prefs && !("actionsPlace" in JSON.parse(raw))) prefs.actionsPlace = prefs.showActionsGrid ? "panel" : "off";
    delete prefs.showStats; delete prefs.showFeed; delete prefs.showActionsGrid;
  } catch {}
  migrateTimeouts();
}

// Timeouts used to be a comma-separated list of seconds. Convert once on
// load rather than making every reader handle both shapes.
function migrateTimeouts() {
  if (Array.isArray(prefs.timeouts)) {
    prefs.timeouts = prefs.timeouts.filter((t) => t && typeof t === "object" && t.u in UNITS);
  } else if (typeof prefs.timeouts === "string") {
    prefs.timeouts = prefs.timeouts.split(",")
      .map((n) => parseInt(n.trim(), 10))
      .filter((n) => n > 0)
      .map((n) => (n % 86400 === 0 ? { n: n / 86400, u: "d" }
        : n % 3600 === 0 ? { n: n / 3600, u: "h" }
        : n % 60 === 0 ? { n: n / 60, u: "m" }
        : { n, u: "s" }));
  }
  if (!Array.isArray(prefs.timeouts) || !prefs.timeouts.length) {
    prefs.timeouts = DEFAULT_PREFS.timeouts.map((t) => ({ ...t }));
  }
}
function savePrefs() {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch {}
}

function applyPrefs() {
  const st = document.documentElement.style;
  st.setProperty("--accent", prefs.accent);
  st.setProperty("--bg", prefs.bg);
  // Fading the sidebar against the same background changed nothing you
  // could see. Transparency belongs on the widget's own backdrop, so what
  // sits behind it shows through.
  st.setProperty("--panel-alpha", "1");
  st.setProperty("--stage-alpha", String(1 - Math.min(100, Number(prefs.transparency) || 0) / 100));
  st.setProperty("--msg-size", (Number(prefs.fontSize) || 14) + "px");

  // Text size from iCUE's settings for this placed widget: an overall
  // multiplier and one per area, applied as region zoom (see the CSS).
  st.setProperty("--fs", String(icueScale("textScale")));
  st.setProperty("--fs-chat", String(icueScale("fsChat")));
  st.setProperty("--fs-chan", String(icueScale("fsChannels")));
  st.setProperty("--fs-ctl", String(icueScale("fsControls")));
  st.setProperty("--fs-dash", String(icueScale("fsDash")));
  // The screen's own personalisation colours, when asked to follow them.
  if (icueBool("followIcueColors")) {
    const acc = icueColor("accentColor"), bg = icueColor("backgroundColor");
    const tr = Number(icueProp("transparency"));
    if (acc) st.setProperty("--accent", acc);
    if (bg) st.setProperty("--bg", bg);
    if (Number.isFinite(tr)) st.setProperty("--stage-alpha", String(1 - Math.min(90, Math.max(0, tr)) / 100));
  }

  applyMode();                       // the role decides what the layout applies to
  const layout = effectiveLayout();
  const b = document.body;
  b.classList.toggle("layout-side", layout === "side");
  b.classList.toggle("layout-top", layout === "top");
  b.classList.toggle("layout-chat", layout === "chat");
  b.classList.toggle("compact", prefs.density === "compact");
  b.classList.toggle("stamps", !!prefs.showTimestamps);

  b.classList.remove("size-sm", "size-md", "size-lg");
  b.classList.add("size-" + (prefs.buttonSize || "md"));
  b.classList.toggle("sel-fill", prefs.selectedStyle === "fill");
  b.classList.toggle("qa-nolabels", !prefs.qaLabels);
  b.classList.toggle("no-scrollbars", !prefs.scrollbars);

  // Stacked puts the channel tabs and the controls on a single bar; the
  // active tab already names the channel, so a second header row is dead
  // space on a screen this short.
  const controls = $("head-controls");
  const home = layout === "top" ? $("rail") : $("chat-head");
  if (controls.parentElement !== home) home.appendChild(controls);

  paintBars();
  applyHeaderButtons();
  document.body.classList.toggle("chat-avatars", !!prefs.showChatAvatars);
  document.body.classList.toggle("inline-mod", !!prefs.inlineModActions);
  document.body.classList.toggle("tabs-in-chat", !!prefs.showTabsInChat);
  $("chat-title").classList.toggle("switcher", !!prefs.channelSwitcher);
  // An <svg> has no `hidden` IDL property, so the attribute is the API.
  $("chat-title-chev").toggleAttribute("hidden", !prefs.channelSwitcher);
  paintChannelAvatar();
  if (prefs.watchSync && !watchSource) startWatchSync();
  if (!prefs.watchSync && watchSource) { stopWatchSync(); renderChannels(); }
  // Followed list is fetched lazily the first time the switch goes on.
  if (prefs.showFollowed && me && !followed.length && !followedLoading && !followedError) loadFollowed();
  if (active) eventsub.subscribeTo(active);
  $("composer").hidden = !prefs.showComposer || !chatSurface();
  $("viewers").hidden = !prefs.showViewers || !chatSurface();
  $("btn-viewers").classList.toggle("on", !!prefs.showViewers);
  $("automod").hidden = !prefs.showAutomod || !canMod() || !chatSurface();
  $("btn-automod").classList.toggle("on", !!prefs.showAutomod);
  renderAutomod();
  // The rail toggle only makes sense when a rail can be shown at all.
  $("btn-rail").hidden = layout !== "chat";
  if (layout !== "chat") toggleRail(false);

  renderQuickActions();
  if (prefs.showViewers && chatSurface()) loadViewers();
  renderDash();
}

function setPref(key, value) {
  prefs[key] = value;
  savePrefs();
  applyPrefs();
}

// ══ Header buttons ═════════════════════════════════════════════════
// Which controls ride in the chat header is a preference: the EDGE is
// short and every icon costs width that the channel name wants. Two are
// still gated by what the channel allows, whatever the preference says.
const HEADER_BUTTONS = [
  ["status", "Connection", "app-status", ""],
  ["search", "Find a channel", "btn-search", "i-search"],
  ["filter", "Filter messages", "btn-filter", "i-filter"],
  ["open", "Open on twitch.tv", "btn-open", "i-external"],
  ["pins", "Pin a channel", "btn-pins", "i-pin"],
  ["split", "Multi-chat", "btn-split", "i-split"],
  ["viewers", "Viewer list", "btn-viewers", "i-people"],
  ["automod", "AutoMod queue", "btn-automod", "i-automod"],
  ["settings", "Chat settings", "btn-settings", "i-gear"],
  ["broadcast", "Broadcast", "btn-broadcast", "i-cast"],
];

function headerButtonOn(key) {
  const hb = prefs.headerButtons || {};
  return hb[key] !== false;
}

function applyHeaderButtons() {
  for (const [key, , id] of HEADER_BUTTONS) {
    const el = $(id);
    if (!el) continue;
    let show = headerButtonOn(key);
    // Chat settings need moderator powers; the broadcast panel is your
    // own channel only.
    if (key === "settings" || key === "automod") show = show && canMod();
    if (key === "broadcast") show = show && !!(active && active.self);
    // A widget without a chat has nothing to filter, split or list
    // viewers for, and its tiles already cover the chat settings.
    if (!chatSurface() && ["filter", "split", "viewers", "pins", "settings", "automod"].includes(key)) show = false;
    el.hidden = !show;
  }
}

// Hand a channel to the OS browser, the same gentle way the sign-in link
// is opened — a host that refuses simply does nothing.
function openOnTwitch(login) {
  if (!login) return;
  try {
    const a = document.createElement("a");
    a.href = "https://twitch.tv/" + encodeURIComponent(login);
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch {}
}
// ══ Jump to latest ═════════════════════════════════════════════════
// Scrolling up to read something stops the auto-follow, and in fast chat
// there is no way back without a long drag. Each list gets its own
// button, so a split pane you scrolled up in is independent.
function jumpButtonFor(list) {
  if (!list) return null;
  if (list.id === "messages") return splitActive() ? null : $("jump-latest");
  const pane = list.closest(".pane");
  return pane ? pane.querySelector(".jump-latest") : null;
}

// Whether a list is still following new messages. This is a decision the
// reader made by scrolling, not something to re-measure: emotes have no
// width until they load, so a message can re-wrap and grow taller after
// it was added. Measuring position alone would read that as "the user
// scrolled up" and stop following a chat nobody touched.
function following(list) {
  return list && list._follow !== false;
}

function setFollowing(list, on) {
  if (!list) return;
  list._follow = on;
  updateJump(list);
}

function pinToBottom(list) {
  if (!list) return;
  list.scrollTop = list.scrollHeight;
}

function updateJump(list) {
  const b = jumpButtonFor(list);
  if (!b) return;
  b.hidden = !prefs.jumpLatest || following(list);
  // The single-view button has no business showing over the split grid.
  if (splitActive() && !$("jump-latest").hidden) $("jump-latest").hidden = true;
}

function watchScroll(list) {
  if (!list || list.dataset.watched) return;
  list.dataset.watched = "1";
  list._follow = true;
  list.addEventListener("scroll", () => {
    // Reaching the bottom again resumes following; leaving it stops.
    setFollowing(list, atBottom(list));
  }, { passive: true });
  // An emote finishing its download re-wraps the line it sits on. While
  // following, stay pinned instead of drifting up by that much.
  list.addEventListener("load", () => {
    if (following(list)) pinToBottom(list);
  }, true);
}

// ══ Emote suggestions ══════════════════════════════════════════════
// The emote map is already built for rendering chat, so the same names
// can answer "what am I typing" without another request.
let emoteSel = 0;
let emoteMatches = [];

function currentEmoteToken() {
  const inp = $("in-message");
  const upto = inp.value.slice(0, inp.selectionStart ?? inp.value.length);
  const m = upto.match(/(\S+)$/);
  return m ? m[1] : "";
}

function closeEmotePop() {
  $("emote-pop").hidden = true;
  emoteMatches = [];
  emoteSel = 0;
}

function updateEmotePop() {
  if (!prefs.emoteSuggest || !prefs.thirdPartyEmotes) return closeEmotePop();
  const token = currentEmoteToken();
  if (token.length < 2) return closeEmotePop();

  const q = token.toLowerCase();
  const starts = [], contains = [];
  for (const [code, hit] of emotes) {
    const lc = code.toLowerCase();
    if (lc === q) continue;                       // already typed in full
    if (lc.startsWith(q)) starts.push([code, hit]);
    else if (lc.includes(q)) contains.push([code, hit]);
    if (starts.length >= 12) break;
  }
  emoteMatches = [...starts, ...contains].slice(0, 8);
  if (!emoteMatches.length) return closeEmotePop();

  emoteSel = 0;
  renderEmotePop();
}

function renderEmotePop() {
  const pop = $("emote-pop");
  pop.textContent = "";
  emoteMatches.forEach(([code, hit], i) => {
    const row = h("div", "ep-item" + (i === emoteSel ? " on" : ""));
    row.appendChild(emoteImg(code, hit));
    row.appendChild(h("span", "ep-name", code));
    row.appendChild(h("span", "ep-src", hit.provider));
    row.addEventListener("pointerdown", (ev) => {
      ev.preventDefault();                        // keep the caret in the box
      insertEmote(code);
    });
    pop.appendChild(row);
  });
  pop.hidden = false;
}

function insertEmote(code) {
  const inp = $("in-message");
  const caret = inp.selectionStart ?? inp.value.length;
  const before = inp.value.slice(0, caret).replace(/(\S+)$/, "");
  const after = inp.value.slice(caret);
  inp.value = before + code + " " + after;
  const pos = (before + code + " ").length;
  inp.setSelectionRange(pos, pos);
  inp.focus();
  closeEmotePop();
}

function emoteKeydown(e) {
  if ($("emote-pop").hidden || !emoteMatches.length) return;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    emoteSel = (emoteSel + (e.key === "ArrowDown" ? 1 : -1) + emoteMatches.length) % emoteMatches.length;
    renderEmotePop();
  } else if (e.key === "Tab" || e.key === "Enter") {
    // Enter completes the emote rather than sending a half-typed name.
    e.preventDefault();
    e.stopPropagation();
    insertEmote(emoteMatches[emoteSel][0]);
  } else if (e.key === "Escape") {
    e.stopPropagation();
    closeEmotePop();
  }
}

// ══ Size adaptation ════════════════════════════════════════════════
// The widget can be placed at any tile size on any EDGE, landscape or
// portrait. Below ~460px of width neither the side rail nor the stacked
// strip physically fits, so the Chat arrangement (drawer rail) takes
// over regardless of the preference; the preference is honoured again
// the moment the widget is wide enough.
function effectiveLayout() {
  // A feed, actions or stats widget has no room for a rail either: the
  // channel is picked from the header dropdown or the drawer.
  if (!chatSurface()) return "chat";
  return innerWidth < 460 ? "chat" : prefs.layout;
}

let lastLayout = null;
function applySize() {
  const b = document.body;
  b.classList.toggle("w-narrow", innerWidth < 820);
  b.classList.toggle("w-tiny", innerWidth < 460);
  b.classList.toggle("h-short", innerHeight < 480);
  b.classList.toggle("portrait", innerHeight > innerWidth);

  if (splitActive()) layoutSplitGrid();

  const eff = effectiveLayout();
  if (eff !== lastLayout) {
    lastLayout = eff;
    if (!$("view-app").hidden) applyPrefs();
  }
}
window.addEventListener("resize", applySize);

function toSeconds(t) {
  return Math.round((Number(t.n) || 0) * (UNITS[t.u] || 1));
}

function timeoutPresets() {
  if (!Array.isArray(prefs.timeouts)) migrateTimeouts();
  return (prefs.timeouts || [])
    .filter((t) => toSeconds(t) > 0 && toSeconds(t) <= MAX_TIMEOUT)
    .slice(0, 6);
}

function labelOf(t) {
  return (Number(t.n) || 0) + t.u;
}
function humanDuration(sec) {
  if (sec >= 86400) return Math.round(sec / 86400) + "d";
  if (sec >= 3600) return Math.round(sec / 3600) + "h";
  if (sec >= 60) return Math.round(sec / 60) + "m";
  return sec + "s";
}

// ── State ──────────────────────────────────────────────────────────
let token = null;      // {access_token, refresh_token, expires_at, client_id}
let me = null;         // Helix user object for the signed-in account
let channels = [];     // [{id, login, name, self, live}]
let active = null;     // currently open channel
let settings = null;   // chat settings for the active channel
let polling = null;    // device-code poll timer
let livePoll = null;
let sheetTarget = null;
let banArmed = false;
let banTimer = null;
let verifyUrl = "";   // full verification_uri, device code included

const $ = (id) => document.getElementById(id);

function h(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
function svgUse(id, cls) {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  if (cls) svg.setAttribute("class", cls);
  const use = document.createElementNS(NS, "use");
  use.setAttribute("href", "#" + id);
  svg.appendChild(use);
  return svg;
}

// ══ Token store ════════════════════════════════════════════════════
// Twitch refresh tokens are SINGLE USE: each refresh returns a new one
// and invalidates the old. The new token is persisted *before* it is
// used — a crash between the two would otherwise lock the user out.
function loadToken() {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    token = raw ? JSON.parse(raw) : null;
  } catch { token = null; }
}
function saveToken(t) {
  token = t;
  try { localStorage.setItem(TOKEN_KEY, JSON.stringify(t)); } catch {}
}
function clearToken() {
  token = null;
  me = null;
  try { localStorage.removeItem(TOKEN_KEY); } catch {}
}
function storeGrant(j, id) {
  saveToken({
    access_token: j.access_token,
    refresh_token: j.refresh_token || (token && token.refresh_token) || "",
    // Refresh a minute early rather than discovering expiry mid-action.
    expires_at: Date.now() + Math.max(60, (Number(j.expires_in) || 14400) - 60) * 1000,
    client_id: id,
  });
}

// Several Twitchify widgets on one screen share the token, and a refresh
// token is single-use — two widgets refreshing at once would sign the
// second one out. So: re-read the store first (another widget may already
// have refreshed), and take a short lock while refreshing so the others
// wait for the result instead of spending a dead token.
function tokenRenewed(since) {
  return !!(token && token.access_token && token.access_token !== since
    && token.expires_at && Date.now() < token.expires_at);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function refresh() {
  if (!token || !token.refresh_token) throw new Error("no refresh token");
  const mine = token.access_token;
  loadToken();
  if (tokenRenewed(mine)) return;
  if (!token || !token.refresh_token) throw new Error("no refresh token");

  let lock = 0;
  try { lock = Number(localStorage.getItem(REFRESH_LOCK)) || 0; } catch {}
  if (Date.now() - lock < 15000) {
    for (let i = 0; i < 30; i++) {
      await sleep(500);
      loadToken();
      if (tokenRenewed(mine)) return;
    }
  }

  try { localStorage.setItem(REFRESH_LOCK, String(Date.now())); } catch {}
  try {
    const r = await fetch(ID_BASE + "/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: token.client_id,
        grant_type: "refresh_token",
        refresh_token: token.refresh_token,
      }).toString(),
    });
    const j = await r.json();
    if (!r.ok || !j.access_token) throw new Error(j.message || `refresh failed (HTTP ${r.status})`);
    storeGrant(j, token.client_id);
  } finally {
    try { localStorage.removeItem(REFRESH_LOCK); } catch {}
  }
}

// Every Helix call goes through here, so a 401 is retried once behind a
// refresh and token expiry is invisible to the user.
async function api(path, init, retried) {
  if (DEMO) throw new Error("Demo mode");
  if (!token) throw new Error("not connected");
  if (!retried && token.expires_at && Date.now() > token.expires_at) await refresh();

  const r = await fetch(HELIX + path, {
    ...init,
    headers: {
      ...(init && init.headers),
      "Client-Id": token.client_id,
      "Authorization": "Bearer " + token.access_token,
    },
  });

  if (r.status === 401 && !retried) {
    await refresh();
    return api(path, init, true);
  }
  const j = r.status === 204 || r.status === 202 ? {} : await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.message || `HTTP ${r.status}`);
  return j;
}
const apiJSON = (path, method, body) =>
  api(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

// ══ Views ══════════════════════════════════════════════════════════
function showApp(on) {
  $("view-auth").hidden = on;
  $("view-app").hidden = !on;
}
function stage(name) {
  $("stage-idle").hidden = name !== "idle";
  $("stage-code").hidden = name !== "code";
}
// Mirrored into the Connection section of Preferences.
let connState = "idle";

function setStatus(cls, text, tagline) {
  if (cls !== connState) {
    connState = cls;
    refreshPrefsIfOpen();
  }
  const s = $("status");
  s.className = "pill " + cls;
  s.textContent = text;
  $("tagline").textContent = tagline;

  // The pill above lives in the signed-out header. Mirror the state into
  // the chat header too, or a reconnect is invisible once you're in.
  const a = $("app-status");
  a.className = "conn " + cls;
  a.title = text;
  // Connected is the boring case — show the dot alone and keep the header
  // for the channel. Anything else gets spelled out.
  a.textContent = cls === "ok" ? "" : text;
}
function setCodeStatus(cls, text) {
  const s = $("code-status");
  s.className = "status " + cls;
  s.textContent = text;
}
function showTrouble(e) {
  // A fetch that rejects outright (no HTTP status) means the network
  // refused it — offline, a firewall, a VPN, or a blocking policy.
  const blocked = e instanceof TypeError;
  $("warn-title").textContent = blocked ? "Can't reach Twitch" : "Twitch returned an error";
  $("warn-body").textContent = blocked
    ? "The connection was refused. Check your internet, firewall or VPN."
    : e.message;
  $("net-warning").hidden = false;
}
const clearTrouble = () => { $("net-warning").hidden = true; };

let toastTimer = null;
function toast(text, bad) {
  const t = $("toast");
  t.textContent = text;
  t.className = bad ? "bad" : "";
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

// ══ Sign in ════════════════════════════════════════════════════════
// The pending device code is persisted, so an approval still lands if the
// widget reloads mid-flow — which opening the verification link in an
// external browser can cause, depending on the host.
function savePending(p) { try { localStorage.setItem(PENDING_KEY, JSON.stringify(p)); } catch {} }
function loadPending() {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function clearPending() { try { localStorage.removeItem(PENDING_KEY); } catch {} }

async function connect() {
  clearTimeout(polling);
  clearTrouble();
  clearPending();
  verifyUrl = "";
  stage("code");
  $("user-code").textContent = "————";
  setStatus("working", "Connecting…", "Requesting a code");
  setCodeStatus("", "Requesting a code…");

  let d;
  try {
    const r = await fetch(ID_BASE + "/device", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: CLIENT_ID, scopes: SCOPES }).toString(),
    });
    d = await r.json();
    if (!r.ok) throw new Error(d.message || `HTTP ${r.status}`);
  } catch (e) {
    stage("idle");
    setStatus("bad", "Sign-in failed", "Not signed in");
    showTrouble(e);
    return;
  }

  const p = {
    device_code: d.device_code,
    user_code: d.user_code || "?",
    // The URI carries the code as a query param, so the browser lands on
    // the consent screen already filled in.
    verify: d.verification_uri || "https://www.twitch.tv/activate",
    interval: Math.max(1, Number(d.interval) || 5) * 1000,
    deadline: Date.now() + (Number(d.expires_in) || 1800) * 1000,
    opened: false,
  };
  savePending(p);
  showPending(p);
  autoOpen(p);
  startPolling(p);
}

function showPending(p) {
  verifyUrl = p.verify;
  // Twitch appends ?device-code=… — useful in a browser, noise on a screen
  // you can't click, so show the bare host and let the big code carry it.
  $("verify-uri").textContent = p.verify.replace(/^https?:\/\/(www\.)?/, "").split("?")[0];
  $("user-code").textContent = p.user_code;
  stage("code");
  setStatus("working", "Waiting for approval", "Approve on Twitch");
  setCodeStatus("", "Waiting for you to approve…");
}

// Opened at most once per code. Marked before the attempt, so if opening
// does reload the widget we resume polling instead of opening forever.
function autoOpen(p) {
  if (p.opened) return;
  p.opened = true;
  savePending(p);
  openVerify();
}

// Hand the URL to the OS default browser. A detached <a target="_blank">
// is the gentlest way to ask: a host that refuses it simply does nothing,
// whereas window.open can reload or navigate the widget itself. Either
// way the buttons and the printed code stay on screen, so there is
// always a way through.
function openVerify() {
  if (!verifyUrl) return;
  try {
    const a = document.createElement("a");
    a.href = verifyUrl;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch {}
}

async function copyVerify() {
  if (!verifyUrl) return;
  const btn = $("btn-copy");
  let ok = false;
  try {
    await navigator.clipboard.writeText(verifyUrl);
    ok = true;
  } catch {
    // Clipboard API needs a secure context and permission; fall back to
    // the old selection trick, which works in more webviews.
    try {
      const ta = document.createElement("textarea");
      ta.value = verifyUrl;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      ok = document.execCommand("copy");
      ta.remove();
    } catch {}
  }
  btn.textContent = ok ? "Copied" : "Couldn't copy";
  setTimeout(() => { btn.textContent = "Copy link"; }, 1600);
}

function startPolling(p) {
  clearTimeout(polling);
  const poll = async () => {
    // Another widget on the screen finished the same sign-in.
    if (token && token.access_token) return;
    if (Date.now() > p.deadline) {
      clearPending();
      setStatus("bad", "Code expired", "Not signed in");
      setCodeStatus("bad", "That code expired — cancel and try again.");
      return;
    }
    try {
      const r = await fetch(ID_BASE + "/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: CLIENT_ID,
          device_code: p.device_code,
          scopes: SCOPES,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }).toString(),
      });
      const j = await r.json();
      if (r.ok && j.access_token) {
        clearPending();
        storeGrant(j, CLIENT_ID);
        return void start();
      }
    } catch (e) {
      if (token && token.access_token) return;   // landed elsewhere meanwhile
      stage("idle");
      setStatus("bad", "Sign-in failed", "Not signed in");
      showTrouble(e);
      return;
    }
    // authorization_pending is the normal "not yet" answer — keep polling.
    polling = setTimeout(poll, p.interval);
  };
  polling = setTimeout(poll, p.interval);
}

function signOut() {
  clearTimeout(polling);
  clearPending();
  stopWatchSync();
  clearInterval(livePoll);
  stopStatsPoll();
  eventsub.close();
  clearToken();
  channels = [];
  active = null;
  feeds.clear();
  sessions.clear();
  chatTimes.clear();
  stats.chan = null;
  showApp(false);
  stage("idle");
  setStatus("idle", "Not connected", "Not signed in");
}

// ══ Boot the signed-in app ═════════════════════════════════════════
async function start() {
  setStatus("working", "Connecting…", "Loading your account");
  try {
    const j = await api("/users");
    me = j.data && j.data[0];
    if (!me) throw new Error("no user returned");
  } catch (e) {
    showApp(false);
    stage("idle");
    if (e instanceof TypeError) {
      // Network trouble, not a bad token — keep the sign-in for a retry.
      setStatus("bad", "Offline", "Can't reach Twitch");
    } else {
      clearToken();
      setStatus("bad", "Signed out", "Sign in again");
    }
    showTrouble(e);
    return;
  }

  clearTrouble();
  showApp(true);
  setStatus("working", "Connecting…", me.display_name);
  applyPrefs();
  loadGlobalBadges();
  loadGlobalEmotes();
  pruneStaleSubscriptions();

  await loadChannels();
  if (prefs.showFollowed) loadFollowed();

  // A starred layout wins over whatever happened to be open last — on a
  // widget that shows chat at all.
  const preset = chatSurface() && !SAFE_MODE && prefs.defaultLayout
    && layouts.find((l) => l.key === prefs.defaultLayout);
  if (preset) applyLayout(preset);
  else if (splitActive()) {
    renderSplit();
    if (!active || !inSplit(active.id)) activateChannel(split[0]);
  }
  // Only chat and the activity feed need live events; the others poll.
  syncSocket();
  if (!wantsSocket()) setStatus("ok", "Connected", me.display_name);

  clearInterval(livePoll);
  livePoll = setInterval(refreshLive, LIVE_POLL_MS);

  if (prefs.watchSync) startWatchSync();
}

// Your own channel first, then everywhere you hold mod powers.
async function loadChannels() {
  channels = [{ id: me.id, login: me.login, name: me.display_name, self: true, mod: true, live: false }];
  try {
    const j = await api(`/moderation/channels?user_id=${me.id}&first=100`);
    for (const c of j.data || []) {
      channels.push({
        id: c.broadcaster_id,
        login: c.broadcaster_login,
        name: c.broadcaster_name,
        self: false,
        mod: true,
        live: false,
      });
    }
  } catch {
    toast("Couldn't load moderated channels", true);
  }

  renderChannels();
  refreshLive();
  fetchUsers([...channels.map((c) => c.id), ...pins.map((p) => p.id)]).then(renderChannels);

  let want = null;
  try { want = localStorage.getItem(LAST_CHANNEL_KEY); } catch {}
  const pick = channels.find((c) => c.id === want) || channels[0];
  if (pick) openChannel(pick);
}

async function refreshLive() {
  if (!channels.length) return;
  try {
    const q = channels.map((c) => "user_id=" + c.id).join("&");
    const j = await api(`/streams?${q}&first=100`);
    const byId = new Map((j.data || []).map((st) => [st.user_id, st]));
    for (const c of channels) {
      const st = byId.get(c.id);
      c.live = !!st;
      c.viewers = st ? st.viewer_count : null;
    }
    renderChannels();
    paintHeadLive();
    paintPaneLive();
  } catch {}
  if (prefs.showFollowed && followed.length) refreshFollowedLive();
}

// Live dot and viewer count beside the channel name in the header.
function paintHeadLive() {
  if (!active) return;
  $("live-dot").hidden = !active.live;
  const v = $("chat-viewers");
  v.hidden = !(active.live && active.viewers != null);
  v.textContent = active.viewers != null ? formatCount(active.viewers) : "";
}

// ══ Pinned channels ════════════════════════════════════════════════
// Nothing about reading a channel's chat requires it to be open in a
// browser — watch sync is only a way to discover what you're watching.
// A pin is just a channel the widget keeps in the list.
let pins = [];

function loadPins() {
  try {
    const raw = localStorage.getItem(PINS_KEY);
    pins = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(pins)) pins = [];
  } catch { pins = []; }
}
function savePins() {
  try { localStorage.setItem(PINS_KEY, JSON.stringify(pins)); } catch {}
  renderChannels();
  renderPinList();
  if (active) eventsub.subscribeTo(active);
}

function isPinned(id) { return pins.some((p) => p.id === id); }

function addPin(c) {
  if (isPinned(c.id) || pins.length >= 8) return;
  pins.push({ id: c.id, login: c.login, name: c.name });
  userCache.set(c.id, { login: c.login, name: c.name, avatar: c.avatar });
  savePins();
}
function removePin(id) {
  pins = pins.filter((p) => p.id !== id);
  savePins();
}

function renderPinList() {
  const list = $("pin-list");
  if (!list) return;
  list.textContent = "";
  if (!pins.length) {
    list.appendChild(h("li", "side-empty", "Nothing pinned yet."));
    return;
  }
  for (const p of pins) {
    const li = h("li", "pin-row");
    li.appendChild(avatarEl(p.id, "av-img small"));
    li.appendChild(h("span", "pin-name", p.name));
    const del = h("button", "pin-del");
    del.appendChild(svgUse("i-x"));
    del.title = "Unpin";
    del.addEventListener("click", () => removePin(p.id));
    li.appendChild(del);
    list.appendChild(li);
  }
}

// ══ Followed channels ══════════════════════════════════════════════
// Everything you follow on Twitch, straight from Helix — no pinning, no
// browser tabs needed. Live state comes from /streams/followed so the
// list can be trimmed to what's actually on air.
let followed = [];                 // [{id, login, name}]
const followedLive = new Map();    // id -> viewer_count
let followedLoading = false;
let followedError = null;

async function loadFollowed() {
  if (!me || followedLoading) return;
  followedLoading = true;
  followed = [];
  followedError = null;
  try {
    let cursor = "";
    // 400 covers almost everyone; past that the rail cap hides the rest anyway.
    for (let page = 0; page < 4; page++) {
      const j = await api(`/channels/followed?user_id=${me.id}&first=100` + (cursor ? "&after=" + cursor : ""));
      for (const f of j.data || []) {
        followed.push({ id: f.broadcaster_id, login: f.broadcaster_login, name: f.broadcaster_name });
      }
      cursor = j.pagination && j.pagination.cursor;
      if (!cursor) break;
    }
  } catch (e) {
    // Most likely a token from before the follows scope was added.
    followedError = /scope|401/i.test(e.message) ? "sign in again to enable" : "couldn't load";
  }
  followedLoading = false;
  await refreshFollowedLive();
  fetchUsers(followed.slice(0, 200).map((f) => f.id)).then(renderChannels);
}

async function refreshFollowedLive() {
  followedLive.clear();
  if (!prefs.showFollowed || !followed.length) { renderChannels(); return; }
  try {
    let cursor = "";
    for (let page = 0; page < 3; page++) {
      const j = await api(`/streams/followed?user_id=${me.id}&first=100` + (cursor ? "&after=" + cursor : ""));
      for (const st of j.data || []) followedLive.set(st.user_id, st.viewer_count);
      cursor = j.pagination && j.pagination.cursor;
      if (!cursor) break;
    }
  } catch {}
  renderChannels();
  paintPaneLive();
}

// Followed channels not already shown elsewhere, filtered by the live-only
// preference, live-and-biggest first.
function followedEntries(excludeIds) {
  const out = [];
  for (const f of followed) {
    if (excludeIds && excludeIds.has(f.id)) continue;
    const live = followedLive.has(f.id);
    if (prefs.followedOnlyLive && !live) continue;
    out.push({
      id: f.id, login: f.login, name: f.name, self: false,
      live, viewers: live ? followedLive.get(f.id) : null,
    });
  }
  out.sort((a, b) => (b.live - a.live)
    || ((b.viewers || 0) - (a.viewers || 0))
    || a.name.localeCompare(b.name));
  return out;
}

// Ids already listed by the rail's other sections.
function listedElsewhere() {
  const seen = new Set(channels.map((c) => c.id));
  for (const p of pins) seen.add(p.id);
  if (prefs.watchSync) {
    for (const t of watchTabs) {
      const id = loginToId.get(t.login);
      if (id) seen.add(id);
    }
  }
  return seen;
}

const FOLLOWED_CAP = 40;   // a 500-follow account shouldn't get a 500-row rail

function renderFollowedSection(list) {
  const entries = followedEntries(listedElsewhere());

  const head = h("li", "rail-section");
  head.appendChild(h("span", null, "Following"));
  if (followedError) head.appendChild(h("span", "rail-note", followedError));
  else if (!followed.length) head.appendChild(h("span", "rail-note", followedLoading ? "loading…" : "none"));
  else if (!entries.length) head.appendChild(h("span", "rail-note", prefs.followedOnlyLive ? "none live" : "all listed"));
  list.appendChild(head);

  for (const c of entries.slice(0, FOLLOWED_CAP)) {
    const li = h("li", "chan" + (active && active.id === c.id ? " on" : "") + (c.live ? " is-live" : ""));
    li.dataset.chan = c.id;
    const av = h("div", "chan-av");
    av.appendChild(avatarEl(c.id, "av-img"));
    if (c.live) av.appendChild(h("span", "av-live"));
    li.appendChild(av);
    const body = h("div", "chan-body");
    body.appendChild(h("div", "chan-name", c.name));
    body.appendChild(h("div", "chan-tag",
      c.live ? (c.viewers != null ? `${formatCount(c.viewers)} watching` : "Live") : "Offline"));
    li.appendChild(body);
    li.addEventListener("click", () => openChannel(c));
    list.appendChild(li);
  }
  if (entries.length > FOLLOWED_CAP) {
    list.appendChild(h("li", "side-empty", `+${entries.length - FOLLOWED_CAP} more not shown`));
  }
}

// ══ Split view ═════════════════════════════════════════════════════
// Up to four chats side by side in the same widget. `split` is the full
// set of channels on screen; the composer, quick actions and viewer list
// follow whichever pane is focused (`active`). Messages route straight
// into their pane, so nothing here counts as "background".
let split = [];   // [{id, login, name}]

// The split is shared storage, but only a widget with a chat surface
// shows it — a feed or stats widget ignores it.
function splitActive() { return chatSurface() && split.length >= 2; }

function loadSplit() {
  if (SAFE_MODE) { split = []; return; }
  try {
    const raw = localStorage.getItem(SPLIT_KEY);
    split = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(split)) split = [];
  } catch { split = []; }
}
function saveSplit() {
  try { localStorage.setItem(SPLIT_KEY, JSON.stringify(split)); } catch {}
}

function inSplit(id) { return split.some((s) => s.id === id); }

// `index` places the new pane at a drop position; omitted, it goes last.
function addToSplit(c, index) {
  if (inSplit(c.id)) return false;
  if (split.length >= MAX_SPLIT) { toast(`Up to ${MAX_SPLIT} chats`, true); return false; }
  // Starting a split from the single view brings the open channel along.
  if (!split.length && active && active.id !== c.id) {
    split.push({ id: active.id, login: active.login, name: active.name });
  }
  const entry = { id: c.id, login: c.login, name: c.name };
  if (index == null || index >= split.length) split.push(entry);
  else split.splice(Math.max(0, index), 0, entry);

  saveSplit();
  renderSplit();
  if (splitActive() && (!active || !inSplit(active.id))) activateChannel(split[0]);
  else if (active) eventsub.subscribeTo(active);   // subscription set changed
  return true;
}

// Swap one pane's channel for another, keeping its position.
function replaceInSplit(index, c) {
  if (index < 0 || index >= split.length || inSplit(c.id)) return;
  split[index] = { id: c.id, login: c.login, name: c.name };
  rememberChannel(c);
  saveSplit();
  renderSplit();
  if (active) eventsub.subscribeTo(active);
}

function removeFromSplit(id) {
  if (!inSplit(id)) return;
  split = split.filter((s) => s.id !== id);
  if (split.length === 1) {
    // One pane isn't a split — fold back into the single view.
    const last = split[0];
    split = [];
    saveSplit();
    renderSplit();
    openChannel(channels.find((x) => x.id === last.id) || last);
    return;
  }
  saveSplit();
  renderSplit();
  if (splitActive() && (!active || !inSplit(active.id))) activateChannel(split[0]);
  else if (active) eventsub.subscribeTo(active);
}

function toggleSplit(c) {
  if (inSplit(c.id)) removeFromSplit(c.id);
  else addToSplit(c);
}

// ══ Saved layouts ══════════════════════════════════════════════════
// A set of chats you use together, kept by name so it can be brought
// back in one tap — and optionally opened automatically on start.
let layouts = [];

function loadLayouts() {
  try {
    const raw = localStorage.getItem(LAYOUTS_KEY);
    layouts = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(layouts)) layouts = [];
  } catch { layouts = []; }
}
function persistLayouts() {
  try { localStorage.setItem(LAYOUTS_KEY, JSON.stringify(layouts)); } catch {}
}

// Identity is the set of channels, so saving the same pair twice is a
// no-op rather than a pile of duplicates.
function layoutKey(list) {
  return list.map((c) => c.id).sort().join("-");
}

function saveCurrentLayout() {
  if (!splitActive()) return;
  const entries = split.map((s) => ({ id: s.id, login: s.login, name: chanName(s.id) || s.name }));
  const key = layoutKey(entries);
  if (layouts.some((l) => l.key === key)) { toast("Already saved"); return; }
  if (layouts.length >= 12) { toast("Up to 12 layouts", true); return; }
  // Named after its channels to start with; long ones get renamed, which
  // is why the row offers it straight away.
  layouts.push({ key, name: entries.map((c) => c.name).join(" + "), channels: entries });
  persistLayouts();
  toast("Layout saved — tap the pencil to rename");
  return key;
}

function renameLayout(key, name) {
  const l = layouts.find((x) => x.key === key);
  if (!l) return;
  l.name = (name || "").trim().slice(0, 40) || l.channels.map((c) => c.name).join(" + ");
  persistLayouts();
}

function deleteLayout(key) {
  layouts = layouts.filter((l) => l.key !== key);
  if (prefs.defaultLayout === key) setPref("defaultLayout", "");
  persistLayouts();
}

function applyLayout(l) {
  split = l.channels.map((c) => ({ id: c.id, login: c.login, name: c.name }));
  for (const c of l.channels) rememberChannel(c);
  saveSplit();
  renderSplit();
  const first = split[0];
  if (first) activateChannel(channelById(first.id) || first);
}

// Drag-reorder: dropping one pane on another trades their places.
// Sliding it in and pushing the rest along was the other option, but it
// moves panes you never touched — dropping A on B should leave the other
// two chats exactly where they were.
function swapSplit(id, index) {
  const from = split.findIndex((s) => s.id === id);
  if (from < 0 || index < 0 || index >= split.length || from === index) return;
  const tmp = split[from];
  split[from] = split[index];
  split[index] = tmp;
  saveSplit();
  renderSplit();
}

function clearSplit() {
  split = [];
  saveSplit();
  renderSplit();
}

// Rebuild the grid from scratch: panes are cheap, scrollback replays from
// the same buffers the single view uses.
function renderSplit() {
  const grid = $("split-grid");
  const on = splitActive();
  grid.hidden = !on;
  $("messages").hidden = on;
  $("btn-split").classList.toggle("on", on);
  grid.textContent = "";
  if (!on) return;

  for (const s of split) {
    const pane = h("div", "pane" + (active && active.id === s.id ? " on" : ""));
    pane.dataset.id = s.id;

    const head = h("div", "pane-head");
    head.appendChild(avatarEl(s.id, "pane-av"));
    head.appendChild(h("span", "pane-name", chanName(s.id) || s.name));
    head.appendChild(h("span", "pane-live"));   // filled by paintPaneLive
    const x = h("button", "pane-x");
    x.appendChild(svgUse("i-x"));
    x.title = "Close this chat";
    x.addEventListener("click", (ev) => {
      ev.stopPropagation();
      toggleSplit(s);
    });
    head.appendChild(x);
    head.addEventListener("click", () => {
      if (!active || active.id !== s.id) activateChannel(s);
    });
    pane.appendChild(head);

    const list = h("ul", "pane-list");
    pane.appendChild(list);

    const jump = h("button", "jump-latest");
    jump.hidden = true;
    jump.appendChild(svgUse("i-down"));
    jump.appendChild(h("span", null, "Latest"));
    jump.addEventListener("click", (ev) => {
      ev.stopPropagation();
      setFollowing(list, true);
      pinToBottom(list);
    });
    pane.appendChild(jump);
    grid.appendChild(pane);

    watchScroll(list);                 // starts out following
    for (const past of buffer(s.id)) addMessage(past, list);
    pinToBottom(list);
    unread.delete(s.id);
  }
  layoutSplitGrid();
  paintPaneLive();
  renderChannels();
  updateComposerTarget();
  if (chatQuery) applyChatFilter();      // panes were rebuilt from scratch
}

// Auto-fit columns leave a hole when the pane count doesn't divide evenly
// — three panes in two columns left the third beside dead space. Size the
// columns to what fits and let a lone trailing pane span the whole row.
// While a channel is being dragged in, the grid is laid out for one more
// pane than exists: the others make room, so the empty cell shows the
// real size and place the new chat will have.
let dragPreview = false;

function splitColumns(n, gridWidth) {
  return Math.max(1, Math.min(n, Math.floor(gridWidth / 260) || 1));
}

function layoutSplitGrid() {
  const grid = $("split-grid");
  if (!splitActive()) return;
  const extra = dragPreview ? 1 : 0;
  const n = split.length + extra;
  const cols = splitColumns(n, grid.clientWidth || innerWidth);
  grid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
  // Rows must be declared during a preview, or the extra cell has no row
  // to live in: two panes becoming three keeps the same two columns, so
  // without this nothing makes room and the ghost lies over the panes.
  const rows = Math.ceil(n / cols);
  grid.style.gridTemplateRows = extra ? `repeat(${rows}, minmax(0, 1fr))` : "";

  const panes = [...grid.children];
  for (const p of panes) p.style.gridColumn = "";
  // A pane alone on the last row stretches — but during a preview that
  // lone slot belongs to the incoming chat, not to the last pane.
  if (cols > 1 && !extra && panes.length % cols === 1) {
    panes[panes.length - 1].style.gridColumn = `span ${cols}`;
  }
}

function setDragPreview(on) {
  if (dragPreview === on) return;
  dragPreview = on;
  document.body.classList.toggle("drag-preview", on);
  if (splitActive()) layoutSplitGrid();
}

// Live state for any channel we know about, wherever it came from.
function liveOf(id) {
  const c = channels.find((x) => x.id === id);
  if (c && c.live) return { live: true, viewers: c.viewers };
  if (followedLive.has(id)) return { live: true, viewers: followedLive.get(id) };
  return { live: false, viewers: null };
}

// Each pane says whether its channel is live and how many are watching,
// refreshed on the same minute cycle as the rail rather than by
// rebuilding the panes and losing their scrollback.
function paintPaneLive() {
  for (const pane of $("split-grid").children) {
    const el = pane.querySelector(".pane-live");
    if (!el) continue;
    const { live, viewers } = liveOf(pane.dataset.id);
    el.textContent = live && viewers != null ? formatCount(viewers) : live ? "Live" : "";
    el.hidden = !live;
  }
}

// Focus moved between panes — repaint the highlights without rebuilding.
function markPanes() {
  for (const p of $("split-grid").children) {
    p.classList.toggle("on", !!active && p.dataset.id === active.id);
  }
  updateComposerTarget();
}

// With several chats on screen, the message box says which one it feeds —
// and doubles as the switch between them, so you can retarget without
// leaving the keyboard area.
function updateComposerTarget() {
  const t = $("send-target");
  const on = splitActive() && !!active;
  t.hidden = !on;
  if (on) {
    t.textContent = "";
    t.appendChild(avatarEl(active.id, "st-av"));
    t.appendChild(h("span", "st-name", active.name));
    t.appendChild(svgUse("i-chev", "st-chev"));
  }
  $("in-message").placeholder = on ? `Message ${active.name}…` : "Send a message…";
}

// Pick which open chat the message box feeds.
function openSendTargetMenu() {
  const trigger = $("send-target");
  if (openMenu && openMenu.trigger === trigger) return closeMenu();
  closeMenu();

  const menu = h("div", "chan-menu");
  for (const s of split) {
    const item = h("div", "chan-item" + (active && active.id === s.id ? " on" : ""));
    item.appendChild(avatarEl(s.id, "ci-av"));
    item.appendChild(h("span", "ci-name", chanName(s.id) || s.name));
    item.addEventListener("click", (ev) => {
      ev.stopPropagation();
      closeMenu();
      activateChannel(s);
      $("in-message").focus();
    });
    menu.appendChild(item);
  }

  document.body.appendChild(menu);
  const z = zoomOf(menu);
  const r = trigger.getBoundingClientRect();
  const pad = 10;
  let left = Math.max(pad, Math.min(Math.round(r.left / z), innerWidth / z - menu.offsetWidth - pad));
  menu.style.left = left + "px";
  // It sits at the bottom of the screen, so the menu opens upward.
  menu.style.top = Math.round(r.top / z - menu.offsetHeight - 6) + "px";
  openMenu = { trigger, menu };
}
$("send-target").addEventListener("click", (ev) => {
  ev.stopPropagation();
  openSendTargetMenu();
});

// The list a channel's events render into right now, or null if it isn't
// on screen (buffered instead).
function listFor(id) {
  if (splitActive()) {
    return $("split-grid").querySelector(`.pane[data-id="${id}"] .pane-list`);
  }
  return active && id === active.id ? $("messages") : null;
}

// ══ Drag and drop ══════════════════════════════════════════════════
// Drag a channel out of the rail (or the tab strip) into the split view
// to open it beside the others, and drag a pane by its header to
// reorder. Pointer events cover mouse and touch in one path.
//
// Touch has to coexist with scrolling the rail, so a touch drag only
// begins after a hold; a finger that moves first is scrolling and the
// hold is cancelled. Once dragging, a non-passive touchmove listener
// cancels the scroll the browser would otherwise start.
const DRAG_HOLD_MS = 300;    // touch: hold this long to pick something up
const DRAG_SLOP = 8;         // mouse: move this far to start dragging

let drag = null;             // { kind, id, name, ghost, x, y, started }
let dragHoldTimer = null;
let suppressClickUntil = 0;

// A channel dragged out of the search results isn't in any of the local
// lists yet, so fall back to what the search cached about it.
function channelById(id) {
  const known = allSwitchableChannels().find((c) => c.id === id);
  if (known) return known;
  const u = userCache.get(id);
  return u ? { id, login: u.login, name: u.name, avatar: u.avatar, self: false, live: false } : null;
}

function dragChannelFrom(el) {
  return el.dataset.chan ? channelById(el.dataset.chan) : null;
}

function beginDrag() {
  if (!drag || drag.started) return;
  drag.started = true;
  document.body.classList.add("dragging");

  // In the Chat arrangement the rail is a drawer sitting on top of the
  // chats. Carrying a channel out of it means you're done with it — and
  // leaving it open would cover the very area being dropped into.
  if (drag.kind === "channel") toggleRail(false);

  // A pointerup that never arrived (released off-window, a cancelled
  // gesture) would otherwise leave its chip stuck on screen forever.
  for (const stale of document.querySelectorAll(".drag-ghost")) stale.remove();

  const ghost = h("div", "drag-ghost");
  ghost.appendChild(avatarEl(drag.id, "dg-av"));
  ghost.appendChild(h("span", null, drag.name));
  document.body.appendChild(ghost);
  drag.ghost = ghost;
  moveGhost();

  if (drag.kind === "pane") {
    const pane = $("split-grid").querySelector(`.pane[data-id="${drag.id}"]`);
    if (pane) pane.classList.add("dragging-pane");
  }
}

function moveGhost() {
  if (!drag || !drag.ghost) return;
  drag.ghost.style.left = drag.x + "px";
  drag.ghost.style.top = drag.y + "px";
}

// The pane the pointer is over. Dropping on a pane means "put it in this
// slot" — the others shift along — so no before/after halves to judge.
function paneUnder(x, y) {
  const panes = [...$("split-grid").children];
  for (let i = 0; i < panes.length; i++) {
    const r = panes[i].getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
      // The answer is which *slot* the pointer is over, not which pane
      // happens to sit there. A swap preview moves panes between slots
      // with `order`, so asking about the element instead would flip the
      // answer the moment the preview took effect — and back again the
      // moment it was undone.
      const slot = panes[i].style.order === "" ? i : Number(panes[i].style.order);
      return { index: slot, el: panes[i] };
    }
  }
  return null;
}

function overSplitArea(x, y) {
  const box = splitActive() ? $("split-grid") : $("stage");
  const r = box.getBoundingClientRect();
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

// A ghost of the pane being placed, snapped over the slot it would take.
// It carries the channel's own avatar and name, so what you're dropping
// and where it lands read as one thing.
function dropGhost() {
  let g = $("drop-ghost");
  if (!g) {
    g = h("div", "drop-ghost");
    g.id = "drop-ghost";
    document.body.appendChild(g);
  }
  return g;
}

function hideDropGhost() {
  const g = document.getElementById("drop-ghost");
  if (g) g.remove();
}

// The ghost is a see-through copy of the pane itself — header, name and
// the chat's recent lines — rather than an empty outline, so the drop
// shows what you're actually going to get.
function buildGhostPane(g, id, name, replacing) {
  // An outline of the space the chat will take, with its avatar and name
  // in the middle — nothing that pretends to be the pane itself.
  g.appendChild(avatarEl(id, "dgh-av"));
  g.appendChild(h("span", null, chanName(id) || name));
  if (replacing) g.appendChild(h("span", "dgh-swap", "replaces " + replacing));
}

// Why this channel can't be dropped, if it can't. Returning a reason
// here keeps the ghost and the drop itself agreeing about what will
// happen — the ghost used to promise a slot that would never exist.
// What dropping this channel would do, so the ghost and the drop can't
// disagree: add a pane, take over the one under the pointer, or nothing.
function channelDropPlan(d, hit) {
  if (!d || d.kind !== "channel") return { add: true };
  if (inSplit(d.id)) return { blocked: "Already open" };
  if (!splitActive() && active && active.id === d.id) return { blocked: "Already open" };
  if (splitActive() && split.length >= MAX_SPLIT) {
    // No room for another, but taking over one you point at is still a
    // sensible thing to want.
    if (hit) return { replace: hit.index, replacing: chanName(hit.el.dataset.id) };
    return { blocked: `Full — drop on a chat to replace it` };
  }
  return { add: true };
}

function dropBlockedReason(d) {
  return channelDropPlan(d || drag, paneUnder((d || drag).x, (d || drag).y)).blocked || null;
}

// Where to point when a drop can't happen: at the pane that already has
// this channel, or across the whole set when there's no room left.
function blockedRect() {
  if (inSplit(drag.id)) {
    const pane = $("split-grid").querySelector(`.pane[data-id="${drag.id}"]`);
    if (pane) return pane.getBoundingClientRect();
  }
  return (splitActive() ? $("split-grid") : $("messages")).getBoundingClientRect();
}

function paintDropHints() {
  const grid = $("split-grid");
  grid.classList.remove("drop-on");
  $("stage").classList.remove("drop-on");
  if (!drag || !drag.started) return hideDropGhost();

  const inArea = overSplitArea(drag.x, drag.y);
  const hit = paneUnder(drag.x, drag.y);
  const plan = channelDropPlan(drag, hit);
  const blocked = plan.blocked;
  const homeSlot = drag.kind === "pane" ? split.findIndex((s) => s.id === drag.id) : -1;

  // Room is opened only for a chat being added, and only once the
  // pointer is actually over the chats. Reordering moves nothing: the
  // ghost alone marks the pane being traded with.
  setDragPreview(drag.kind === "channel" && inArea && !!plan.add);

  // Nothing to show once the pointer leaves the chat area.
  if (!inArea && !hit) return hideDropGhost();

  // Back over its own slot: nothing would change.
  if (hit && drag.kind === "pane" && hit.index === homeSlot) return hideDropGhost();

  const g = dropGhost();
  const state = drag.id + "|" + (blocked || "") + "|" + (plan.replacing || "");
  if (g.dataset.for !== state) {
    g.dataset.for = state;
    g.textContent = "";
    if (blocked) {
      g.appendChild(avatarEl(drag.id, "dgh-av"));
      g.appendChild(h("span", null, drag.name));
      g.appendChild(h("span", "dgh-note", blocked));
    } else {
      buildGhostPane(g, drag.id, drag.name, plan.replacing);
    }
  }
  g.classList.toggle("blocked", !!blocked);

  // Adding outlines the slot the panes just made room for; replacing or
  // reordering outlines the pane being claimed.
  const r = blocked ? blockedRect()
    : plan.replace != null || drag.kind === "pane" ? hit.el.getBoundingClientRect()
    : addTargetRect();
  // Only write when the slot actually changes. Re-assigning the same
  // values every pointermove restarts the transition, which is what read
  // as flicker while the pointer moved inside one slot.
  const box = [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)].join(",");
  if (g.dataset.box !== box) {
    g.dataset.box = box;
    const [l, t, w, ht] = box.split(",");
    g.style.left = l + "px";
    g.style.top = t + "px";
    g.style.width = w + "px";
    g.style.height = ht + "px";
  }
}

// Where a pane added right now would land. Splitting from the single
// view halves the stage; otherwise it's the next cell of the grid, on a
// new row when the current one is full.
// The slot the incoming chat will occupy, at the size it will be — the
// preview above has already made room for it.
function addTargetRect() {
  const gap = 8;
  if (!splitActive()) {
    // The single chat gives up its right half; the preview class has
    // already shrunk it, so measure what's actually left.
    const m = $("messages").getBoundingClientRect();
    const s = $("stage").getBoundingClientRect();
    return { left: m.right + gap, top: m.top, width: s.right - m.right - gap * 2, height: m.height };
  }
  const grid = $("split-grid");
  const gr = grid.getBoundingClientRect();
  const n = split.length + 1;                    // the pane about to exist
  const cols = splitColumns(n, grid.clientWidth || innerWidth);
  const rows = Math.ceil(n / cols);
  const cw = (gr.width - gap * (cols - 1)) / cols;
  const ch = (gr.height - gap * (rows - 1)) / rows;
  const idx = n - 1;
  const top = gr.top + Math.floor(idx / cols) * (ch + gap);
  // Alone on the last row it stretches, exactly as it will once dropped.
  if (cols > 1 && n % cols === 1) return { left: gr.left, top, width: gr.width, height: ch };
  return { left: gr.left + (idx % cols) * (cw + gap), top, width: cw, height: ch };
}

function endDrag(commit) {
  clearTimeout(dragHoldTimer);
  // Sweep unconditionally: a chip can outlive its drag if the pointer was
  // released somewhere that never reported back.
  for (const g of document.querySelectorAll(".drag-ghost")) g.remove();
  setDragPreview(false);
  if (!drag) { hideDropGhost(); return; }
  const plan = channelDropPlan(drag, paneUnder(drag.x, drag.y));
  const d = drag;
  drag = null;

  for (const g of document.querySelectorAll(".drag-ghost")) g.remove();
  hideDropGhost();
  document.body.classList.remove("dragging");
  const grid = $("split-grid");
  for (const p of grid.children) p.classList.remove("dragging-pane");
  grid.classList.remove("drop-on");
  $("stage").classList.remove("drop-on");

  if (!d.started || !commit) return;
  suppressClickUntil = performance.now() + 400;   // the drop isn't a tap

  const hit = paneUnder(d.x, d.y);
  if (d.kind === "pane") {
    // Slots are back to their resting order here, so the index under the
    // pointer is the one to trade with.
    if (hit && hit.el.dataset.id !== d.id) swapSplit(d.id, hit.index);
    return;
  }

  // A channel dropped onto the chat area joins the split as a new pane —
  // appended, matching the empty slot its ghost was sitting in.
  if (!overSplitArea(d.x, d.y) && !hit) return;
  if (plan.blocked) {
    // The ghost already said why; a toast only where it isn't obvious.
    if (plan.blocked.startsWith("Full")) toast("Drop on a chat to replace it", true);
    return;
  }
  const c = channelById(d.id);
  if (!c) return;
  closeChanSearch();                 // it did its job
  toggleRail(false);                 // and so did the drawer it came from
  if (plan.replace != null) { replaceInSplit(plan.replace, c); activateChannel(c); return; }
  if (addToSplit(c)) activateChannel(c);
}

document.addEventListener("pointerdown", (e) => {
  // Never let a previous drag survive into this one — a stale one would
  // commit its own drop on this pointer's release.
  endDrag(false);
  if (e.button != null && e.button !== 0) return;
  const paneHead = e.target.closest && e.target.closest(".pane-head");
  const row = e.target.closest && e.target.closest("[data-chan]");
  // The close button and other controls keep their own behaviour.
  if (e.target.closest && e.target.closest("button") && !paneHead && !row) return;
  if (paneHead && e.target.closest(".pane-x")) return;

  let kind = null, id = null, name = "";
  if (paneHead) {
    const pane = paneHead.closest(".pane");
    kind = "pane";
    id = pane.dataset.id;
    name = chanName(id) || "";
  } else if (row) {
    const c = dragChannelFrom(row);
    if (!c) return;
    kind = "channel";
    id = c.id;
    name = c.name;
  } else return;

  drag = { kind, id, name, x: e.clientX, y: e.clientY, ox: e.clientX, oy: e.clientY, started: false };

  // Touch waits for a hold so the rail can still be scrolled; a mouse
  // starts as soon as it has clearly moved.
  clearTimeout(dragHoldTimer);
  if (e.pointerType === "touch") {
    dragHoldTimer = setTimeout(() => { beginDrag(); paintDropHints(); }, DRAG_HOLD_MS);
  }
}, true);

document.addEventListener("pointermove", (e) => {
  if (!drag) return;
  drag.x = e.clientX;
  drag.y = e.clientY;

  if (!drag.started) {
    const far = Math.hypot(e.clientX - drag.ox, e.clientY - drag.oy) > DRAG_SLOP;
    // A finger that moves before the hold completes is scrolling.
    if (e.pointerType === "touch") { if (far) { clearTimeout(dragHoldTimer); drag = null; } return; }
    if (far) beginDrag();
    if (!drag || !drag.started) return;
  }
  moveGhost();
  paintDropHints();
}, true);

// Non-passive so a drag in progress can cancel the scroll it would start.
document.addEventListener("touchmove", (e) => {
  if (drag && drag.started) e.preventDefault();
}, { passive: false });

document.addEventListener("pointerup", (e) => {
  if (drag) { drag.x = e.clientX; drag.y = e.clientY; }
  endDrag(true);
}, true);
document.addEventListener("pointercancel", () => endDrag(false), true);
// Releasing outside the window never sends pointerup here.
window.addEventListener("blur", () => endDrag(false));

// A drop shouldn't also register as a tap on whatever is underneath.
document.addEventListener("click", (e) => {
  if (performance.now() < suppressClickUntil) {
    e.stopPropagation();
    e.preventDefault();
  }
}, true);

let pinTimer = null;

async function searchPins(q) {
  const list = $("pin-results");
  list.textContent = "";
  if (!q) return;
  try {
    const j = await api("/search/channels?first=6&query=" + encodeURIComponent(q));
    for (const c of j.data || []) {
      const li = h("li", "bc-hit");
      if (c.thumbnail_url) {
        const img = document.createElement("img");
        img.src = c.thumbnail_url;
        li.appendChild(img);
      }
      li.appendChild(h("span", null, c.display_name + (c.is_live ? " · live" : "")));
      li.addEventListener("click", () => {
        addPin({
          id: c.id,
          login: c.broadcaster_login,
          name: c.display_name,
          avatar: c.thumbnail_url,
        });
        list.textContent = "";
        $("pin-search").value = "";
      });
      list.appendChild(li);
    }
  } catch {}
}

// ══ Watch sync ═════════════════════════════════════════════════════
// Optional. A browser extension reports which Twitch tabs are open to a
// local helper, and the helper streams them here over Server-Sent Events.
// The widget cannot listen on a port and the extension cannot be dialled
// into, so the helper sits in the middle. Everything is loopback and no
// token ever leaves this page.
const HELPER_EVENTS = "http://127.0.0.1:57123/events";
const HELPER_HEALTH = "http://127.0.0.1:57123/health";
// The helper registers this scheme for itself; opening the link makes
// Windows start it. It then lives as long as iCUE does, so this is asked
// at most once a minute and only while watch sync is on and it's silent.
const HELPER_LAUNCH = "twitchify-helper://start";
let helperLaunchedAt = 0;

function launchHelper(force) {
  if (!force && Date.now() - helperLaunchedAt < 60000) return;
  helperLaunchedAt = Date.now();
  try {
    const a = document.createElement("a");
    a.href = HELPER_LAUNCH;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch {}
  // Give it a moment to bind the port, then look again.
  setTimeout(pollHelper, 2500);
}

let watchSource = null;
let watchTabs = [];        // [{login, title, active, focused}]
let watchUp = false;
let watchRetry = null;

// Watch sync only dials the helper once it is switched on, so the switch
// itself can't learn from that connection whether there is anything to
// dial. A cheap loopback /health poll answers it — and the helper reports
// whether the extension has spoken recently, which the SSE stream can't.
let helperUp = false;
let extUp = false;

async function pollHelper() {
  let up = false, ext = false;
  try {
    const r = await fetch(HELPER_HEALTH, { signal: AbortSignal.timeout(1500) });
    const j = await r.json();
    up = !!j.ok;
    ext = !!j.extension;
  } catch { /* not running */ }
  if (up !== helperUp || ext !== extUp) {
    helperUp = up;
    extUp = ext;
    refreshPrefsIfOpen();
  }
  // Wanted but not there: ask Windows to start it (throttled inside).
  if (!up && prefs.watchSync && !DEMO) launchHelper(false);
}
setInterval(pollHelper, 5000);
pollHelper();

function startWatchSync() {
  stopWatchSync();
  if (!prefs.watchSync) return;
  try {
    watchSource = new EventSource(HELPER_EVENTS);
  } catch {
    return;
  }

  watchSource.onopen = () => {
    watchUp = true;
    renderChannels();
    refreshPrefsIfOpen();
  };
  watchSource.onmessage = (ev) => {
    let payload;
    try { payload = JSON.parse(ev.data); } catch { return; }
    watchUp = true;
    const before = watchTabs.map((t) => t.login).join(",");
    watchTabs = Array.isArray(payload.tabs) ? payload.tabs : [];
    if (watchTabs.map((t) => t.login).join(",") !== before) {
      resolveWatchTabs();
      if (prefs.preloadWatched && active) eventsub.subscribeTo(active);
    }
    renderChannels();
    if (prefs.followActiveTab) followFocused();
  };
  watchSource.onerror = () => {
    // The helper isn't running, or it went away. EventSource retries on
    // its own, but a closed stream needs rebuilding.
    watchUp = false;
    renderChannels();
    refreshPrefsIfOpen();
    if (watchSource && watchSource.readyState === EventSource.CLOSED) {
      clearTimeout(watchRetry);
      watchRetry = setTimeout(startWatchSync, 5000);
    }
  };
}

// The helper's state is shown in Preferences, so keep it live while open.
function refreshPrefsIfOpen() {
  if (!$("prefs").hidden) renderPrefs();
}

function stopWatchSync() {
  clearTimeout(watchRetry);
  try { watchSource && watchSource.close(); } catch {}
  watchSource = null;
  watchUp = false;
  watchTabs = [];
}

// Tabs arrive as logins; every Helix call needs a broadcaster id.
const loginToId = new Map();

async function resolveWatchTabs() {
  const want = watchTabs.map((t) => t.login).filter((l) => !loginToId.has(l));
  if (!want.length) return;
  for (let i = 0; i < want.length; i += 100) {
    const batch = want.slice(i, i + 100);
    try {
      const j = await api("/users?" + batch.map((l) => "login=" + encodeURIComponent(l)).join("&"));
      for (const u of j.data || []) {
        loginToId.set(u.login, u.id);
        userCache.set(u.id, { login: u.login, name: u.display_name, avatar: u.profile_image_url });
      }
      // A login with no match (deleted, or a path we misread) is cached as
      // null so it isn't looked up again on every update.
      for (const l of batch) if (!loginToId.has(l)) loginToId.set(l, null);
    } catch { return; }
  }
  renderChannels();
}

function watchChannel(tab) {
  const id = loginToId.get(tab.login);
  if (!id) return null;
  const known = channels.find((c) => c.id === id);
  if (known) return known;
  const u = userCache.get(id);
  return { id, login: tab.login, name: (u && u.name) || tab.login, self: false, watching: true, live: false };
}

let lastFollowed = null;

function followFocused() {
  const focused = watchTabs.find((t) => t.focused);
  if (!focused || focused.login === lastFollowed) return;
  const c = watchChannel(focused);
  if (!c) return;
  lastFollowed = focused.login;
  if (!active || active.id !== c.id) openChannel(c);
}

function renderChannels() {
  const list = $("channel-list");
  list.textContent = "";
  for (const c of channels) {
    const li = h("li", "chan" + (active && active.id === c.id ? " on" : "") + (c.live ? " is-live" : ""));
    li.dataset.chan = c.id;

    const av = h("div", "chan-av");
    av.appendChild(avatarEl(c.id, "av-img"));
    if (c.live) av.appendChild(h("span", "av-live"));
    li.appendChild(av);

    const body = h("div", "chan-body");
    body.appendChild(h("div", "chan-name", c.name));
    body.appendChild(h("div", "chan-tag",
      c.live && c.viewers != null ? `${formatCount(c.viewers)} watching`
        : c.self ? "Your channel" : "Moderator"));
    li.appendChild(body);

    const n = unread.get(c.id);
    if (n) li.appendChild(h("span", "unread", n > 99 ? "99+" : String(n)));

    li.addEventListener("click", () => openChannel(c));
    list.appendChild(li);
  }

  renderPinSection(list);
  if (prefs.watchSync) renderWatchSection(list);
  if (prefs.showFollowed) renderFollowedSection(list);
  renderChatTabs();

  // Stacked draws the tabs along the top edge of the stage. Only the
  // leftmost tab touches the panel's top-left corner, so that corner is
  // squared off just for it — otherwise the tab overhangs the curve.
  // Keyed off whichever tab is actually first, not off "is it mine": the
  // list happens to start with your own channel today, but sorting or
  // hiding it later shouldn't quietly break the join.
  const first = list.querySelector(".chan");
  document.body.classList.toggle("first-tab-active", !!first && first.classList.contains("on"));
}

// Every channel you could switch to, deduped: moderated, pinned, watched.
function allSwitchableChannels() {
  const all = [...channels];
  for (const p of pins) {
    if (!all.some((x) => x.id === p.id)) {
      all.push({ id: p.id, login: p.login, name: p.name, self: false, live: false });
    }
  }
  if (prefs.watchSync) {
    for (const t of watchTabs) {
      const c = watchChannel(t);
      if (c && !all.some((x) => x.id === c.id)) all.push(c);
    }
  }
  if (prefs.showFollowed) {
    const seen = new Set(all.map((x) => x.id));
    all.push(...followedEntries(seen).slice(0, FOLLOWED_CAP));
  }
  return all;
}

// Chat layout hides the rail, so offer the same switch as a strip.
function renderChatTabs() {
  const bar = $("chat-tabs");
  bar.textContent = "";
  if (effectiveLayout() !== "chat" || !prefs.showTabsInChat) return;

  for (const c of allSwitchableChannels()) {
    const b = h("button", "chat-tab" + (active && active.id === c.id ? " on" : ""));
    b.dataset.chan = c.id;
    const u = userCache.get(c.id);
    if (u && u.avatar) {
      const img = document.createElement("img");
      img.src = u.avatar;
      img.alt = "";
      b.appendChild(img);
    }
    b.appendChild(h("span", null, c.name));
    const n = unread.get(c.id);
    if (n) b.appendChild(h("span", "unread", n > 99 ? "99+" : String(n)));
    b.addEventListener("click", () => openChannel(c));
    bar.appendChild(b);
  }
}

function renderPinSection(list) {
  const mine = new Set(channels.map((c) => c.id));
  const extra = pins.filter((p) => !mine.has(p.id));
  if (!extra.length) return;

  const head = h("li", "rail-section");
  head.appendChild(h("span", null, "Pinned"));
  list.appendChild(head);

  for (const p of extra) {
    const c = { id: p.id, login: p.login, name: p.name, self: false, live: false };
    const li = h("li", "chan" + (active && active.id === p.id ? " on" : ""));
    li.dataset.chan = p.id;                       // draggable like the rest
    const av = h("div", "chan-av");
    av.appendChild(avatarEl(p.id, "av-img"));
    li.appendChild(av);
    const body = h("div", "chan-body");
    body.appendChild(h("div", "chan-name", p.name));
    body.appendChild(h("div", "chan-tag", "Pinned"));
    li.appendChild(body);
    const n = unread.get(p.id);
    if (n) li.appendChild(h("span", "unread", n > 99 ? "99+" : String(n)));
    li.addEventListener("click", () => openChannel(c));
    list.appendChild(li);
  }
}

// The multi-chat button opens its own menu: the layouts you've saved,
// a way to keep the current one, and the channel list to add from.
function openSplitMenu() {
  const trigger = $("btn-split");
  if (openMenu && openMenu.trigger === trigger) return closeMenu();
  closeMenu();

  const menu = h("div", "chan-menu");

  if (layouts.length) menu.appendChild(h("div", "menu-head", "Layouts"));
  for (const l of layouts) {
    const item = h("div", "chan-item");
    item.appendChild(svgUse("i-split", "ci-lay"));
    const nameEl = h("span", "ci-name", l.name);
    item.appendChild(nameEl);

    // Rename in place: the row's name becomes the field, so there's no
    // dialog to open on a screen this short.
    const edit = h("button", "ci-split");
    edit.appendChild(svgUse("i-edit"));
    edit.title = "Rename";
    edit.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (item.querySelector(".ci-rename")) return;
      const input = document.createElement("input");
      input.type = "text";
      input.className = "ci-rename";
      input.value = l.name;
      input.maxLength = 40;
      const commit = () => {
        if (!input.isConnected) return;
        renameLayout(l.key, input.value);
        nameEl.textContent = l.name;
        input.replaceWith(nameEl);
      };
      input.addEventListener("keydown", (e2) => {
        e2.stopPropagation();
        if (e2.key === "Enter") commit();
        else if (e2.key === "Escape") { input.replaceWith(nameEl); }
      });
      input.addEventListener("blur", commit);
      input.addEventListener("click", (e2) => e2.stopPropagation());
      nameEl.replaceWith(input);
      input.focus();
      input.select();
    });
    item.appendChild(edit);

    // Star one to have it open on start instead of whatever was last up.
    const star = h("button", "ci-split" + (prefs.defaultLayout === l.key ? " on" : ""));
    star.appendChild(svgUse("i-star"));
    star.title = prefs.defaultLayout === l.key ? "Opens on start" : "Open this on start";
    star.addEventListener("click", (ev) => {
      ev.stopPropagation();
      setPref("defaultLayout", prefs.defaultLayout === l.key ? "" : l.key);
      star.classList.toggle("on", prefs.defaultLayout === l.key);
    });
    item.appendChild(star);

    const del = h("button", "ci-split");
    del.appendChild(svgUse("i-x"));
    del.title = "Delete layout";
    del.addEventListener("click", (ev) => {
      ev.stopPropagation();
      deleteLayout(l.key);
      item.remove();
    });
    item.appendChild(del);

    item.addEventListener("click", (ev) => {
      ev.stopPropagation();
      closeMenu();
      applyLayout(l);
    });
    menu.appendChild(item);
  }

  if (splitActive()) {
    const save = h("div", "chan-item");
    save.appendChild(svgUse("i-star", "ci-lay"));
    save.appendChild(h("span", "ci-name", `Save these ${split.length} chats as a layout`));
    save.addEventListener("click", (ev) => {
      ev.stopPropagation();
      closeMenu();
      saveCurrentLayout();
    });
    menu.appendChild(save);
  }

  menu.appendChild(h("div", "menu-head", splitActive() ? "Add a chat" : "Open side by side"));
  appendChannelItems(menu);

  document.body.appendChild(menu);
  const z = zoomOf(menu);
  const r = trigger.getBoundingClientRect();
  const pad = 10;
  menu.style.left = Math.max(pad, Math.min(Math.round(r.right / z - menu.offsetWidth), innerWidth / z - menu.offsetWidth - pad)) + "px";
  menu.style.top = Math.round(r.bottom / z + 6) + "px";
  menu.style.maxHeight = Math.max(140, (innerHeight - r.bottom) / z - 16) + "px";
  openMenu = { trigger, menu };
}

// The header can act as a channel switcher: the title becomes a trigger
// and every switchable channel drops down under it, with live viewer
// counts — a rail you don't have to give an edge of the screen to.
function openChannelMenu(trigger) {
  trigger = trigger || $("chat-title");
  if (openMenu && openMenu.trigger === trigger) return closeMenu();
  closeMenu();

  const menu = h("div", "chan-menu");
  appendChannelItems(menu);

  document.body.appendChild(menu);
  const z = zoomOf(menu);
  const r = trigger.getBoundingClientRect();
  const pad = 10;
  let left = Math.round(r.left / z);
  left = Math.max(pad, Math.min(left, innerWidth / z - menu.offsetWidth - pad));
  menu.style.left = left + "px";
  menu.style.top = Math.round(r.bottom / z + 6) + "px";
  menu.style.maxHeight = Math.max(120, (innerHeight - r.bottom) / z - 16) + "px";

  openMenu = { trigger, menu };
}

// Every switchable channel as menu rows, shared by the header dropdown
// and the multi-chat menu.
function appendChannelItems(menu) {
  for (const c of allSwitchableChannels()) {
    const item = h("div", "chan-item" + (active && active.id === c.id ? " on" : ""));
    item.dataset.chan = c.id;                     // draggable into the split
    item.appendChild(avatarEl(c.id, "ci-av"));

    const name = h("span", "ci-name", c.name);
    item.appendChild(name);

    if (isPinned(c.id)) {
      const pin = h("span", "ci-pin");
      pin.appendChild(svgUse("i-pin"));
      pin.title = "Pinned";
      item.appendChild(pin);
    }
    if (c.live) {
      item.appendChild(h("span", "ci-live", c.viewers != null ? formatCount(c.viewers) : "Live"));
    }
    const n = unread.get(c.id);
    if (n) item.appendChild(h("span", "unread", n > 99 ? "99+" : String(n)));

    // Add to / remove from the split view without leaving the menu.
    const sp = h("button", "ci-split" + (inSplit(c.id) ? " on" : ""));
    sp.appendChild(svgUse("i-split"));
    sp.title = inSplit(c.id) ? "Remove from split view" : "Add to split view";
    sp.addEventListener("click", (ev) => {
      ev.stopPropagation();
      toggleSplit(c);
      sp.classList.toggle("on", inSplit(c.id));
      sp.title = inSplit(c.id) ? "Remove from split view" : "Add to split view";
    });
    item.appendChild(sp);

    item.addEventListener("click", (ev) => {
      ev.stopPropagation();
      closeMenu();
      openChannel(c);
    });
    menu.appendChild(item);
  }
}

// Channels you have open in the browser but don't already moderate.
function renderWatchSection(list) {
  const mine = new Set(channels.map((c) => c.id));
  const extra = watchTabs
    .map((t) => ({ tab: t, chan: watchChannel(t) }))
    .filter((x) => x.chan && !mine.has(x.chan.id));

  const head = h("li", "rail-section");
  head.appendChild(h("span", null, "Watching"));
  if (!watchUp) head.appendChild(h("span", "rail-note", "helper offline"));
  else if (!extra.length) head.appendChild(h("span", "rail-note", watchTabs.length ? "already listed" : "no tabs"));
  list.appendChild(head);

  for (const { tab, chan } of extra) {
    const li = h("li", "chan" + (active && active.id === chan.id ? " on" : ""));
    li.dataset.chan = chan.id;
    const av = h("div", "chan-av");
    av.appendChild(avatarEl(chan.id, "av-img"));
    if (tab.focused) av.appendChild(h("span", "av-focus"));
    li.appendChild(av);
    const body = h("div", "chan-body");
    body.appendChild(h("div", "chan-name", chan.name));
    body.appendChild(h("div", "chan-tag", tab.focused ? "In focus" : "Open in browser"));
    li.appendChild(body);

    const n = unread.get(chan.id);
    if (n) li.appendChild(h("span", "unread", n > 99 ? "99+" : String(n)));
    li.addEventListener("click", () => openChannel(chan));
    list.appendChild(li);
  }
}

function formatCount(n) {
  return n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "") + "K" : String(n);
}

// A channel you merely watch carries no moderator powers, so the
// moderation surface has to disappear rather than fail on tap.
// The channel picture in the header. Watch-sync channels are resolved
// lazily, so fetch on miss and paint again when it lands.
const avatarTried = new Set();   // channel ids already asked for once

function paintChannelAvatar() {
  const img = $("chat-av");
  if (!active || !prefs.showChannelAvatar) {
    img.hidden = true;
    return;
  }
  img.hidden = false;
  const u = userCache.get(active.id);
  if (u && u.avatar) {
    img.src = u.avatar;
  } else {
    img.removeAttribute("src");
    const want = active.id;
    // Paint again only if the fetch actually produced a picture. A user
    // with none — or no network — would otherwise loop here forever.
    if (avatarTried.has(want)) return;
    avatarTried.add(want);
    fetchUsers([want]).then(() => {
      const u2 = userCache.get(want);
      if (u2 && u2.avatar && active && active.id === want) paintChannelAvatar();
    });
  }
}

function canModId(id) {
  const c = channels.find((x) => x.id === id);
  return !!(c && (c.self || c.mod));
}
function canMod() {
  return !!(active && canModId(active.id));
}
function chanName(id) {
  const c = channels.find((x) => x.id === id) || split.find((x) => x.id === id);
  if (c) return c.name;
  const u = userCache.get(id);
  return (u && u.name) || "";
}

// The parts of "this channel is now the one" that don't touch the message
// area — shared between opening a channel normally and focusing a pane in
// the split view, where the lists must be left alone.
function activateChannel(c) {
  // A watch-sync entry for a channel you do moderate should still carry
  // the powers, so prefer the known record.
  const known = channels.find((x) => x.id === c.id);
  active = known || c;
  c = active;
  try { localStorage.setItem(LAST_CHANNEL_KEY, c.id); } catch {}
  renderChannels();
  $("chat-name").textContent = c.name;
  paintHeadLive();
  paintChannelAvatar();
  $("chat-modes").textContent = "";
  unread.delete(c.id);
  markPanes();
  applyHeaderButtons();
  paintBars();
  eventsub.subscribeTo(c);
  loadSettings();
  loadChannelBadges(c);
  loadChannelEmotes(c);
  if (prefs.showViewers && chatSurface()) loadViewers();
  $("automod").hidden = !prefs.showAutomod || !canMod() || !chatSurface();
  renderAutomod();
  renderDash();
  return c;
}

function openChannel(c) {
  // In the split view, a channel already on screen is focused in place.
  // Anything else joins the split rather than replacing it — picking a
  // channel while running three chats almost never means "throw these
  // away" — unless the preference says otherwise.
  if (splitActive() && !inSplit(c.id)) {
    if (prefs.splitAddOnClick) {
      // With no room left, picking a channel takes over the pane you're
      // looking at. Refusing outright left the switcher unable to switch
      // — the one thing it exists to do.
      if (split.length >= MAX_SPLIT) {
        const at = active ? split.findIndex((s) => s.id === active.id) : 0;
        replaceInSplit(at < 0 ? 0 : at, c);
        activateChannel(c);
        toggleRail(false);
        return;
      }
      addToSplit(c);
      activateChannel(c);
      toggleRail(false);
      return;
    }
    clearSplit();
  }

  c = activateChannel(c);
  hideConfirmBar();                  // its target belongs to the old channel

  if (!splitActive()) {
    $("messages").textContent = "";
    for (const past of buffer(c.id)) addMessage(past);
    // Replaying builds the list from empty, so jump to the newest line
    // and follow again — the previous channel's scroll position says
    // nothing about this one.
    const list = $("messages");
    setFollowing(list, true);
    pinToBottom(list);
    if (chatQuery) applyChatFilter();
  }
  toggleRail(false);
}

// ══ Quick actions ══════════════════════════════════════════════════
// The chat modes a moderator reaches for most, one tap from the chat,
// instead of two taps through the settings panel.
function renderQuickActions() {
  renderActionGrid();                // the tiles mirror the same settings
  const bar = $("quick-actions");
  const abar = $("action-bar");
  bar.textContent = "";
  abar.textContent = "";
  paintBars();
  if (!quickBarVisible() && !actionBarVisible()) return;

  const chip = (cls, icon, label) => {
    const b = h("button", "qa " + cls);
    b.appendChild(svgUse(icon));
    b.appendChild(h("span", "qa-label", label));
    return b;
  };

  if (quickBarVisible()) {
    for (const t of TOGGLES) {
      const on = !!(settings && settings[t.key]);
      const b = chip(on ? "on" : "", t.icon, t.short);
      b.title = t.label + (on ? " — on" : " — off");
      b.addEventListener("click", () => {
        if (confirmTap(b, () => prefs.confirmQuickActions)) setMode(t.key, !on, b);
      });
      bar.appendChild(b);
    }

    const clear = chip("danger", "i-broom", "Clear");
    clear.title = "Delete every message in chat";
    clear.addEventListener("click", () => {
      if (confirmTap(clear, () => prefs.confirmQuickActions)) clearChat();
    });
    bar.appendChild(clear);
  }

  // The action tiles as chips, on their own row under the chat modes.
  if (actionBarVisible()) {
    if (canMod()) {
      const sh = chip(shield && shield.active ? "on" : "", "i-shield", "Shield");
      sh.title = "Shield Mode" + (shield && shield.active ? " — on" : " — off");
      sh.addEventListener("click", () => {
        if (shield && !shield.scope) return toast("Sign out and connect again to use Shield Mode", true);
        if (confirmTap(sh, () => prefs.confirmQuickActions)) setShield(!(shield && shield.active), sh);
      });
      abar.appendChild(sh);
    }
    if (active && active.self) {
      const info = chip("bc", "i-edit", "Info");
      info.title = "Stream title and category";
      info.addEventListener("click", openBroadcast);
      abar.appendChild(info);

      const clip = chip("bc", "i-clip", "Clip");
      clip.title = "Create a clip";
      clip.addEventListener("click", () => {
        clip.disabled = true;
        createClip().finally(() => { clip.disabled = false; });
      });
      abar.appendChild(clip);

      const mark = chip("bc", "i-marker", "Marker");
      mark.title = "Add a stream marker";
      mark.addEventListener("click", createMarker);
      abar.appendChild(mark);

      const ad = chip("bc", "i-ad", "Ad");
      ad.title = "Run an ad break";
      ad.addEventListener("click", (ev) => { ev.stopPropagation(); openAdMenu(ad); });
      abar.appendChild(ad);

      const r = raidPending();
      const raid = chip(r ? "danger" : "bc", "i-raid", r ? "Cancel raid" : "Raid");
      raid.title = r ? `Raiding ${r.name}` : "Raid a channel";
      raid.addEventListener("click", () => {
        if (raidPending()) { if (confirmTap(raid, () => true)) cancelRaid(); }
        else { openBroadcast(); setTimeout(() => $("bc-raid-search").focus(), 200); }
      });
      abar.appendChild(raid);
    }
  }
}

// ══ Viewer list ════════════════════════════════════════════════════
let viewers = [];

async function loadViewers() {
  if (DEMO) { $("viewers-count").textContent = formatCount(viewers.length); renderViewers(); return; }
  if (!active || !me) return;
  const list = $("viewer-list");
  list.textContent = "";

  // Get Chatters is moderator-only. On a channel you merely watch it
  // returns a 401 that means nothing to the reader.
  if (!canMod()) {
    viewers = [];
    $("viewers-count").textContent = "—";
    list.appendChild(h("li", "side-empty",
      "The viewer list is only available on channels you moderate."));
    return;
  }

  const forChannel = active.id;
  list.appendChild(h("li", "side-empty", "Loading…"));
  try {
    const j = await api(`/chat/chatters?broadcaster_id=${forChannel}&moderator_id=${me.id}&first=100`);
    if (!active || active.id !== forChannel) return;   // switched away mid-flight
    viewers = j.data || [];
    $("viewers-count").textContent = formatCount(j.total != null ? j.total : viewers.length);
    renderViewers();
    fetchUsers(viewers.map((u) => u.user_id)).then(() => {
      if (active && active.id === forChannel) renderViewers();
    });
  } catch (e) {
    if (!active || active.id !== forChannel) return;
    viewers = [];
    $("viewers-count").textContent = "—";
    list.textContent = "";
    // The scope is granted at sign-in, so an older token simply lacks it.
    list.appendChild(h("li", "side-empty", /Missing scope/i.test(e.message)
      ? "Sign out and connect again to enable the viewer list."
      : e.message));
  }
}

function renderViewers() {
  const list = $("viewer-list");
  const q = $("viewer-search").value.trim().toLowerCase();
  const shown = q ? viewers.filter((u) => u.user_login.includes(q) || u.user_name.toLowerCase().includes(q)) : viewers;

  list.textContent = "";
  if (!shown.length) {
    list.appendChild(h("li", "side-empty", q ? "No match." : "Nobody in chat."));
    return;
  }
  for (const u of shown) {
    const li = h("li", "viewer");
    li.appendChild(avatarEl(u.user_id, "viewer-av"));
    li.appendChild(h("span", "viewer-name", u.user_name));
    li.addEventListener("click", () => openSheetForUser(u));
    list.appendChild(li);
  }
}

// A websocket subscription outlives the socket that owned it: reload the
// widget and Twitch keeps the old ones in websocket_disconnected, where
// they count against the account's limits until they age out. They can
// only be cleaned from a later session, so do it on every start.
async function pruneStaleSubscriptions() {
  const doomed = [];
  let cursor = "";
  try {
    // Collect every page first. Deleting mid-pagination shifts the cursor
    // and silently skips entries.
    for (let page = 0; page < 10; page++) {
      const j = await api("/eventsub/subscriptions?first=100" + (cursor ? "&after=" + cursor : ""));
      for (const sub of j.data || []) {
        if (sub.status !== "enabled") doomed.push(sub.id);
      }
      cursor = j.pagination && j.pagination.cursor;
      if (!cursor) break;
    }
    for (const id of doomed) {
      try { await api(`/eventsub/subscriptions?id=${id}`, { method: "DELETE" }); } catch {}
    }
  } catch {}
  return doomed.length;
}

// ══ EventSub ═══════════════════════════════════════════════════════
// One socket. Subscriptions are created for the open channel and torn
// down when switching, which stays far inside the 300-per-socket cap.
const eventsub = (() => {
  let sock = null;
  let sessionId = null;
  let subs = [];          // subscription ids for the current channel
  let pending = null;     // channel to subscribe once the session is up
  let subscribedFor = null;  // "sessionId:channelId" already wired up
  let retry = 0;
  let closing = false;

  // channel.chat.* all take {broadcaster_user_id, user_id} and need
  // user:read:chat from the signed-in account.
  const TYPES = [
    ["channel.chat.message", "1"],
    ["channel.chat.message_delete", "1"],
    ["channel.chat.clear_user_messages", "1"],
    ["channel.chat.clear", "1"],
    ["channel.chat.notification", "1"],
    ["channel.chat_settings.update", "1"],
  ];

  // Every moderation action in the channel, by anyone. Moderator-only, so
  // it is added per channel rather than sitting in the list above.
  const MOD_TYPE = ["channel.moderate", "2"];

  // AutoMod's hold queue, and how each held message was resolved — by
  // anyone. Both take {broadcaster_user_id, moderator_user_id} and need
  // moderator:manage:automod, so they ride with the open channel only.
  const AUTOMOD_TYPES = [["automod.message.hold", "2"], ["automod.message.update", "2"]];

  // The activity feed's extras. The stream going live or offline needs
  // no scope at all; follows need moderator:read:followers and mod powers.
  const FEED_TYPES = [["stream.online", "1"], ["stream.offline", "1"]];
  const FOLLOW_TYPE = ["channel.follow", "2"];
  // A feed-only widget wants notices (subs, gifts, raids) and cheers,
  // which ride on messages — not the deletion and settings traffic.
  const FEED_ONLY_TYPES = [["channel.chat.message", "1"], ["channel.chat.notification", "1"]];

  let reopenTimer = null;

  function open() {
    closing = false;
    clearTimeout(reopenTimer);
    let s;
    try { s = new WebSocket(EVENTSUB_WSS); }
    catch { return scheduleReopen(); }

    sock = s;
    s.onmessage = onMessage;
    // A socket closed on purpose, or already replaced, must not reopen.
    s.onclose = () => { if (sock === s && !closing) scheduleReopen(); };
    s.onerror = () => {};
  }

  function isOpen() { return !!sock && !closing; }

  function onMessage(ev) {
    let m;
    try { m = JSON.parse(ev.data); } catch { return; }
    const type = m.metadata && m.metadata.message_type;

    if (type === "session_welcome") {
      sessionId = m.payload.session.id;
      retry = 0;
      setStatus("ok", "Connected", me ? me.display_name : "");
      const c = pending || active;
      pending = null;
      if (c) subscribe(c);
      return;
    }
    if (type === "session_reconnect") {
      // Twitch hands over a new URL and carries the subscriptions
      // across, so swap sockets without re-subscribing.
      const next = new WebSocket(m.payload.session.reconnect_url);
      next.onmessage = onMessage;
      next.onerror = () => {};
      next.onopen = () => {
        const old = sock;
        sock = next;
        next.onclose = () => { if (sock === next && !closing) scheduleReopen(); };
        try { old.close(); } catch {}
      };
      return;
    }
    if (type === "notification") {
      const e = m.payload.event;
      // The send time lives on the envelope, not the event.
      e._at = m.metadata.message_timestamp;
      handle(m.metadata.subscription_type, e);
    }
  }

  function scheduleReopen() {
    sessionId = null;
    subs = [];
    subscribedFor = null;
    retry = Math.min(retry + 1, 6);
    setStatus("working", "Reconnecting…", me ? me.display_name : "");
    clearTimeout(reopenTimer);
    reopenTimer = setTimeout(open, Math.min(30000, 1000 * Math.pow(2, retry)));
  }

  // What this widget subscribes to depends on its role; the key below
  // carries it so a role change re-subscribes.
  function subProfile() {
    return mode() + (feedSubs() ? "+feed" : "") + (canMod() ? "+mod" : "");
  }

  function conditionFor(type, channelId) {
    if (type === "channel.moderate" || type === "channel.follow" || type.startsWith("automod.")) {
      return { broadcaster_user_id: channelId, moderator_user_id: me.id };
    }
    if (type.startsWith("stream.")) return { broadcaster_user_id: channelId };
    return { broadcaster_user_id: channelId, user_id: me.id };
  }

  // Adding two split panes in quick succession starts two of these. Both
  // used to get past the `await unsubscribeAll()` and then each create a
  // full set, leaving the channel subscribed twice on one socket — which
  // is exactly one duplicate of every message. A generation counter makes
  // the newer call win: the older one bails at its next await.
  let subGen = 0;

  async function subscribe(c) {
    if (!sessionId) { pending = c; return; }

    const mine = sessionId;               // the session these belong to
    const wanted = loadedChannels();
    const key = mine + ":" + wanted.join(",") + ":" + subProfile();
    if (subscribedFor === key) return;    // already wired up

    const gen = ++subGen;
    await unsubscribeAll();
    if (gen !== subGen || sessionId !== mine) return;
    subscribedFor = key;

    for (const id of wanted) {
      if (gen !== subGen || sessionId !== mine) return;
      await subscribeOne(id, mine, gen);
    }

    if (gen === subGen && sessionId === mine && subscribedFor === key) reconcile(wanted);
  }

  async function subscribeOne(channelId, mine, gen) {
    // channel.moderate only applies where we hold the powers, and only the
    // open channel needs its action feed. The activity extras likewise
    // follow the open channel alone.
    const isActive = active && active.id === channelId;
    const types = mode() === "feed" ? [...FEED_ONLY_TYPES] : [...TYPES];
    if (isActive && canMod() && chatSurface()) types.push(MOD_TYPE, ...AUTOMOD_TYPES);
    if (isActive && feedSubs()) {
      types.push(...FEED_TYPES);
      if (canModId(channelId)) types.push(FOLLOW_TYPE);
    }

    for (const [type, version] of types) {
      // Six creates run back to back; if the socket dropped partway, or a
      // newer subscribe superseded this one, the rest would be filed
      // against a dead session or duplicate the new set. Bail either way.
      if (sessionId !== mine || (gen != null && gen !== subGen)) return;
      try {
        const j = await apiJSON("/eventsub/subscriptions", "POST", {
          type, version,
          condition: conditionFor(type, channelId),
          transport: { method: "websocket", session_id: mine },
        });
        if (j.data && j.data[0]) subs.push(j.data[0].id);
      } catch (e) {
        if (/already exists/i.test(e.message)) {
          // An identical subscription is already feeding this session —
          // keep its id so it still gets cleaned up on the next switch.
          const id = (e.message.match(/id=([0-9a-f-]+)/i) || [])[1];
          if (id) subs.push(id);
          continue;
        }
        if (/session does not exist|already disconnected/i.test(e.message)) {
          subscribedFor = null;
          return;
        }
        // Anything else: one lost subscription shouldn't kill the channel.
        // Chat still works without, say, chat_settings.update.
        if (type === "channel.chat.message") {
          toast("Can't read this chat — " + e.message, true);
        }
        // channel.moderate needs scopes an older token won't carry; chat
        // still works without the action feed.
        if (type === "channel.moderate") modFeed = false;
        // The AutoMod scope is newer still. Say why the queue is empty
        // rather than leaving a panel that silently never fills.
        if (type === "automod.message.hold") {
          automodNote = /scope|authorization|403/i.test(e.message)
            ? "Sign out and connect again to enable the AutoMod queue."
            : "AutoMod queue unavailable — " + e.message;
          renderAutomod();
        }
        // Same for follows: the scope was added later, so an older sign-in
        // simply lacks it. Say so in the feed rather than staying quiet.
        if (type === "channel.follow") {
          followsNote = /scope|authorization|403/i.test(e.message)
            ? "Sign out and connect again to see follows." : "";
          renderFeed();
        }
      }
    }
  }

  async function unsubscribeAll() {
    const ids = subs;
    subs = [];
    subscribedFor = null;
    for (const id of ids) {
      try { await api(`/eventsub/subscriptions?id=${id}`, { method: "DELETE" }); } catch {}
    }
  }

  // Locally tracked ids drift: a 409 hands back an id we never stored, a
  // reconnect orphans a set, a failed DELETE is swallowed. Twitch is the
  // only authority on what actually exists, so after settling on a channel
  // ask it and drop anything of ours that isn't for that channel.
  //
  // Scoped by session_id, so a second widget on another screen keeps its
  // own subscriptions.
  async function reconcile(keepChannelIds) {
    const keep = Array.isArray(keepChannelIds) ? keepChannelIds : [keepChannelIds];
    if (!sessionId) return 0;
    const doomed = [];
    let cursor = "";
    try {
      for (let page = 0; page < 10; page++) {
        const j = await api("/eventsub/subscriptions?first=100" + (cursor ? "&after=" + cursor : ""));
        for (const sub of j.data || []) {
          const ours = sub.transport && sub.transport.session_id === sessionId;
          const wrongChannel = sub.condition && !keep.includes(sub.condition.broadcaster_user_id);
          if (sub.status !== "enabled" || (ours && wrongChannel)) doomed.push(sub.id);
        }
        cursor = j.pagination && j.pagination.cursor;
        if (!cursor) break;
      }
      for (const id of doomed) {
        try { await api(`/eventsub/subscriptions?id=${id}`, { method: "DELETE" }); } catch {}
      }
    } catch {}
    return doomed.length;
  }

  function close() {
    closing = true;
    clearTimeout(reopenTimer);
    sessionId = null;
    subs = [];
    subscribedFor = null;
    try { sock && sock.close(); } catch {}
  }

  return { open, close, isOpen, subscribeTo: subscribe };
})();

let modFeed = true;

// Chat for channels that aren't on screen, so switching to one shows what
// arrived while you were elsewhere.
const buffers = new Map();   // channelId -> [event]
const unread = new Map();    // channelId -> count

function buffer(id) {
  let b = buffers.get(id);
  if (!b) { b = []; buffers.set(id, b); }
  return b;
}

function remember(id, e) {
  const b = buffer(id);
  b.push(e);
  if (b.length > MAX_MESSAGES) b.shift();
}

// The channels worth holding open: the one on screen, plus the tabs the
// browser says are open, capped so subscriptions stay bounded.
function loadedChannels() {
  const ids = [];
  if (active) ids.push(active.id);
  // Background chat is only worth holding for a widget that shows chat.
  if (!chatSurface()) return ids;
  // Every split pane is on screen, so it must stay subscribed.
  for (const s of split) if (!ids.includes(s.id)) ids.push(s.id);
  // A pin is explicit, so it is kept loaded ahead of incidental tabs.
  if (prefs.preloadWatched) {
    for (const p of pins) {
      if (!ids.includes(p.id) && ids.length <= MAX_BACKGROUND) ids.push(p.id);
    }
  }
  if (prefs.watchSync && prefs.preloadWatched) {
    for (const t of watchTabs) {
      const c = watchChannel(t);
      if (c && !ids.includes(c.id) && ids.length <= MAX_BACKGROUND) ids.push(c.id);
    }
  }
  return ids;
}

function handle(type, e) {
  if (!active) return;
  const from = e.broadcaster_user_id || active.id;

  // Held messages never reach the chat; they live in the queue.
  if (type === "automod.message.hold" || type === "automod.message.update") {
    return automodEvent(type, e, from);
  }

  // Activity and stats take what they need first — the chat surface may
  // not even be on screen in this widget.
  feedIntake(type, e, from);
  if (!chatSurface()) {
    if (type === "channel.chat.message") remember(from, e);
    return;
  }

  // Events route to whichever list shows their channel — the single view
  // or a split pane. A channel with no list on screen is background:
  // buffered and counted instead of rendered.
  const list = listFor(from);
  if (!list) {
    if (type === "channel.chat.message") {
      remember(from, e);
      unread.set(from, (unread.get(from) || 0) + 1);
      renderChannels();
    }
    return;
  }

  if (type === "channel.chat.message") remember(from, e);

  switch (type) {
    case "channel.chat.message": return addMessage(e, list);
    case "channel.chat.message_delete": return markDeleted((n) => n.dataset.msg === e.message_id);
    case "channel.chat.clear_user_messages": return markDeleted((n) => n.dataset.user === e.target_user_id);
    case "channel.chat.clear": return void (list.textContent = "");
    case "channel.chat.notification": return addNotice(e, list);
    // Settings and the mod-action feed only follow the focused channel.
    case "channel.chat_settings.update": return void (from === active.id && applySettings(e));
    case "channel.moderate": return void (from === active.id && addModAction(e, list));
  }
}

// ══ Moderation notices ═════════════════════════════════════════════
// Twitch's own chat narrates mod actions inline. channel.moderate carries
// them for the whole channel, whoever performed them.
function describeAction(e) {
  const who = e.moderator_user_name || "A moderator";
  const a = e.action;
  const target = (o) => (o && (o.user_name || o.user_login)) || "someone";
  const mins = (n) => (n >= 60 ? Math.round(n / 60) + "h" : n + "m");

  switch (a) {
    case "ban": return `${who} banned ${target(e.ban)}` + (e.ban && e.ban.reason ? ` — ${e.ban.reason}` : "");
    case "unban": return `${who} unbanned ${target(e.unban)}`;
    case "timeout": {
      const secs = e.timeout && e.timeout.expires_at
        ? Math.max(1, Math.round((new Date(e.timeout.expires_at) - new Date(e._at || Date.now())) / 1000))
        : 0;
      return `${who} timed out ${target(e.timeout)}` + (secs ? ` for ${humanDuration(secs)}` : "");
    }
    case "untimeout": return `${who} removed the timeout on ${target(e.untimeout)}`;
    case "delete": return `${who} deleted a message from ${target(e.delete)}`;
    case "clear": return `${who} cleared the chat`;
    case "warn": return `${who} warned ${target(e.warn)}`;

    case "emoteonly": return `${who} turned on emote-only mode`;
    case "emoteonlyoff": return `${who} turned off emote-only mode`;
    case "subscribers": return `${who} turned on subscribers-only mode`;
    case "subscribersoff": return `${who} turned off subscribers-only mode`;
    case "uniquechat": return `${who} turned on unique-chat mode`;
    case "uniquechatoff": return `${who} turned off unique-chat mode`;
    case "followers":
      return `${who} turned on followers-only mode` +
        (e.followers && e.followers.follow_duration_minutes
          ? ` (${mins(e.followers.follow_duration_minutes)})` : "");
    case "followersoff": return `${who} turned off followers-only mode`;
    case "slow":
      return `${who} turned on slow mode` +
        (e.slow && e.slow.wait_time_seconds ? ` (${e.slow.wait_time_seconds}s)` : "");
    case "slowoff": return `${who} turned off slow mode`;

    case "mod": return `${who} made ${target(e.mod)} a moderator`;
    case "unmod": return `${who} removed ${target(e.unmod)} as a moderator`;
    case "vip": return `${who} made ${target(e.vip)} a VIP`;
    case "unvip": return `${who} removed VIP from ${target(e.unvip)}`;

    case "raid": return `${who} started a raid to ${target(e.raid)}`;
    case "unraid": return `${who} cancelled the raid`;

    case "add_blocked_term": return `${who} added a blocked term`;
    case "delete_blocked_term": return `${who} removed a blocked term`;
    case "add_permitted_term": return `${who} permitted a term`;
    case "delete_permitted_term": return `${who} removed a permitted term`;

    case "approve_unban_request": return `${who} approved an unban request`;
    case "deny_unban_request": return `${who} denied an unban request`;
    case "shoutout": return `${who} sent a shoutout`;
    case "shared_chat_ban": return `${who} banned ${target(e.shared_chat_ban)} in the shared chat`;
    default: return `${who} performed "${a}"`;
  }
}

function addModAction(e, list) {
  list = list || $("messages");
  const stick = following(list);
  const li = h("li", "notice mod-notice");
  if (prefs.showTimestamps) li.appendChild(h("span", "stamp", stampOf(e)));
  li.appendChild(h("span", "notice-text", describeAction(e)));
  list.appendChild(li);
  if (chatQuery) filterRow(li);
  trimAndScroll(stick, list);
}

// ══ Badges ════════════════════════════════════════════════════════
// Twitch serves badge art per set/version. Global sets cover MOD, VIP,
// staff and so on; each channel adds its own sub and bit badges.
const badgeUrls = new Map();   // "set_id/version" -> image url
let globalBadgesLoaded = false;

async function loadGlobalBadges() {
  if (globalBadgesLoaded) return;
  try {
    const j = await api("/chat/badges/global");
    indexBadges(j.data);
    globalBadgesLoaded = true;
  } catch {}
}
async function loadChannelBadges(c) {
  try {
    const j = await api("/chat/badges?broadcaster_id=" + c.id);
    indexBadges(j.data);
  } catch {}
}
function indexBadges(sets) {
  for (const set of sets || []) {
    for (const v of set.versions || []) {
      badgeUrls.set(set.set_id + "/" + v.id, v.image_url_2x || v.image_url_1x);
    }
  }
}

// ══ Third-party emotes ═════════════════════════════════════════════
// BTTV, 7TV and FrankerFaceZ all serve open, CORS-enabled JSON, so the
// widget can read them directly. Global sets load once; channel sets load
// per channel and 404 for streamers not registered with a provider, which
// is normal and silent.
const emotes = new Map();        // code -> {url, provider}
let globalEmotesLoaded = false;

async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}

function addBttv(list) {
  for (const e of list || []) {
    if (e && e.code && e.id) emotes.set(e.code, { url: `https://cdn.betterttv.net/emote/${e.id}/2x`, provider: "BTTV" });
  }
}
function addSeven(set) {
  for (const e of (set && set.emotes) || []) {
    const host = e.data && e.data.host;
    if (!e.name || !host || !host.url) continue;
    // host.url is protocol-relative, e.g. //cdn.7tv.app/emote/<id>
    emotes.set(e.name, { url: "https:" + host.url + "/2x.webp", provider: "7TV" });
  }
}
function addFfz(sets) {
  for (const key of Object.keys(sets || {})) {
    for (const e of sets[key].emoticons || []) {
      const u = e.urls && (e.urls["2"] || e.urls["1"]);
      if (e.name && u) emotes.set(e.name, { url: u.startsWith("//") ? "https:" + u : u, provider: "FFZ" });
    }
  }
}

async function loadGlobalEmotes() {
  if (globalEmotesLoaded || !prefs.thirdPartyEmotes) return;
  globalEmotesLoaded = true;
  await Promise.all([
    getJSON("https://api.betterttv.net/3/cached/emotes/global").then(addBttv).catch(() => {}),
    getJSON("https://7tv.io/v3/emote-sets/global").then(addSeven).catch(() => {}),
    getJSON("https://api.frankerfacez.com/v1/set/global").then((j) => addFfz(j.sets)).catch(() => {}),
  ]);
}

async function loadChannelEmotes(c) {
  if (!prefs.thirdPartyEmotes) return;
  await Promise.all([
    getJSON(`https://api.betterttv.net/3/cached/users/twitch/${c.id}`)
      .then((j) => { addBttv(j.channelEmotes); addBttv(j.sharedEmotes); }).catch(() => {}),
    getJSON(`https://7tv.io/v3/users/twitch/${c.id}`)
      .then((j) => addSeven(j.emote_set)).catch(() => {}),
    getJSON(`https://api.frankerfacez.com/v1/room/id/${c.id}`)
      .then((j) => addFfz(j.sets)).catch(() => {}),
  ]);
}

function emoteImg(code, hit) {
  const img = document.createElement("img");
  img.className = "emote";
  img.src = hit.url;
  img.alt = code;
  img.title = `${code} · ${hit.provider}`;
  img.loading = "lazy";
  return img;
}

// Twitch's own emotes arrive as fragments; third-party ones are just words
// in the text, so plain text has to be scanned token by token.
function appendText(parent, text) {
  if (!prefs.thirdPartyEmotes || !emotes.size) {
    parent.appendChild(document.createTextNode(text));
    return;
  }
  for (const token of text.split(/(\s+)/)) {
    const hit = token && emotes.get(token);
    if (hit) parent.appendChild(emoteImg(token, hit));
    else if (token) parent.appendChild(document.createTextNode(token));
  }
}

// ══ People ═════════════════════════════════════════════════════════
// Chat events and the chatter list carry ids and names but no avatars,
// so they are fetched in batches of 100 and cached for the session.
const userCache = new Map();     // id -> {login, name, avatar}

async function fetchUsers(ids) {
  const want = [...new Set(ids)].filter((id) => id && !userCache.has(id));
  for (let i = 0; i < want.length; i += 100) {
    const batch = want.slice(i, i + 100);
    try {
      const j = await api("/users?" + batch.map((id) => "id=" + id).join("&"));
      for (const u of j.data || []) {
        userCache.set(u.id, { login: u.login, name: u.display_name, avatar: u.profile_image_url });
      }
    } catch { return; }
  }
}

function avatarEl(id, cls) {
  const img = document.createElement("img");
  img.className = cls;
  img.alt = "";
  img.loading = "lazy";
  img.dataset.for = id;
  const u = userCache.get(id);
  // An id the cache hasn't seen used to stay blank forever — the pane
  // headers and the composer pill are built before their users load.
  if (u && u.avatar) img.src = u.avatar;
  else queueAvatar(id);
  return img;
}

// ══ Chat rendering ═════════════════════════════════════════════════
const BADGE_LABEL = { broadcaster: "HOST", moderator: "MOD", vip: "VIP", subscriber: "SUB", staff: "STAFF" };
const COLORS = ["#ff4a80", "#ffa14a", "#ffd24a", "#5ad46a", "#4ad4c4", "#4aa8ff", "#8f7bff", "#d97bff"];

// Twitch only sends a colour for users who picked one; the rest get a
// stable colour derived from their id so they stay recognisable.
function colorFor(id, given) {
  if (given) return given;
  let n = 0;
  for (let i = 0; i < id.length; i++) n = (n * 31 + id.charCodeAt(i)) >>> 0;
  return COLORS[n % COLORS.length];
}

// EventSub puts the send time on the envelope, not the event, so it is
// stashed on the event as it arrives.
function stampOf(e) {
  const t = e._at ? new Date(e._at) : new Date();
  return t.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: prefs.clock !== "24",
  });
}

function atBottom(m) {
  m = m || $("messages");
  return m.scrollHeight - m.scrollTop - m.clientHeight < 60;
}
function trimAndScroll(stick, m) {
  m = m || $("messages");
  while (m.children.length > MAX_MESSAGES) m.removeChild(m.firstChild);
  if (stick) pinToBottom(m);
  updateJump(m);
}

// Chat events carry no avatar. Ids are collected and resolved in batches,
// then the already-rendered rows are filled in.
const avatarQueue = new Set();
let avatarTimer = null;

function queueAvatar(id) {
  if (userCache.has(id)) return;
  avatarQueue.add(id);
  clearTimeout(avatarTimer);
  avatarTimer = setTimeout(async () => {
    const ids = [...avatarQueue];
    avatarQueue.clear();
    await fetchUsers(ids);
    for (const id of ids) {
      const u = userCache.get(id);
      if (!u || !u.avatar) continue;
      for (const img of document.querySelectorAll(`img[data-for="${id}"]`)) img.src = u.avatar;
    }
  }, 600);
}

function addMessage(e, list) {
  list = list || $("messages");
  const stick = following(list);
  const li = h("li", "msg");
  li.dataset.msg = e.message_id;
  li.dataset.user = e.chatter_user_id;

  // A mention or a watched keyword lights the row up. The sound plays only
  // the first time the message is drawn — a channel switch replays the
  // buffer, and that must not replay the chime.
  const alertKind = alertFor(e);
  if (alertKind) {
    li.classList.add("alert", "alert-" + alertKind);
    if (!e._alerted) { e._alerted = true; alertSound(); }
  }

  // Mod powers are judged for the channel the message lives in, which in
  // a split pane isn't necessarily the focused one.
  const chan = e.broadcaster_user_id || (active && active.id);
  if (prefs.inlineModActions && canModId(chan)) li.appendChild(inlineActions(e));

  if (prefs.showChatAvatars) {
    const img = avatarEl(e.chatter_user_id, "msg-av");
    img.dataset.for = e.chatter_user_id;
    li.appendChild(img);
    queueAvatar(e.chatter_user_id);
  }

  const body = h("span", "msg-body");

  if (prefs.showTimestamps) {
    body.appendChild(h("span", "stamp", stampOf(e)));
  }

  if (prefs.badgeStyle !== "off") {
    for (const b of e.badges || []) {
      const url = badgeUrls.get(b.set_id + "/" + b.id);
      if (prefs.badgeStyle === "images" && url) {
        const img = document.createElement("img");
        img.className = "badge-img";
        img.src = url;
        img.alt = b.set_id;
        img.title = b.set_id;
        body.appendChild(img);
        continue;
      }
      // No art for this set, or text was asked for — fall back to a chip,
      // but only for the sets worth calling out.
      const label = BADGE_LABEL[b.set_id];
      if (label) body.appendChild(h("span", "badge b-" + b.set_id, label));
    }
  }

  // Stream Together: a shared-chat message from a partner channel can
  // name where it came from, or read as part of one conversation.
  if (prefs.sharedChatSource
      && e.source_broadcaster_user_id && e.source_broadcaster_user_id !== e.broadcaster_user_id) {
    const tag = h("span", "shared-tag", e.source_broadcaster_user_name || "shared");
    tag.title = "Via Stream Together — sent in " + (e.source_broadcaster_user_name || "another channel");
    body.appendChild(tag);
  }

  const name = h("span", "who", e.chatter_user_name);
  name.style.color = colorFor(e.chatter_user_id, e.color);
  body.appendChild(name);

  const text = h("span", "text");
  const frags = (e.message && e.message.fragments) || [{ type: "text", text: e.message.text }];
  for (const f of frags) {
    if (f.type === "emote" && f.emote) {
      const img = document.createElement("img");
      img.className = "emote";
      img.src = `https://static-cdn.jtvnw.net/emoticons/v2/${f.emote.id}/default/dark/1.0`;
      img.alt = f.text;
      text.appendChild(img);
    } else if (f.type === "mention") {
      text.appendChild(h("span", "mention", f.text));
    } else {
      appendText(text, f.text);
    }
  }
  body.appendChild(text);
  li.appendChild(body);

  li.addEventListener("click", () => openSheet(e));
  list.appendChild(li);
  if (chatQuery) filterRow(li);
  trimAndScroll(stick, list);
}

// ══ AutoMod queue ══════════════════════════════════════════════════
// Messages AutoMod or a blocked term is holding for review. They never
// reach the chat: the hold event is the only sight of them, and the
// update event says how they were resolved — by us or by anyone else.
const automodQueue = new Map();   // channelId -> [hold event]
let automodNote = "";             // why the queue can't work, when it can't

function automodList(id) {
  let q = automodQueue.get(id);
  if (!q) { q = []; automodQueue.set(id, q); }
  return q;
}

function automodEvent(type, e, from) {
  const q = automodList(from);
  if (type === "automod.message.hold") {
    if (!q.some((x) => x.message_id === e.message_id)) q.push(e);
    if (q.length > 50) q.shift();
    // A line in the chat so a hold is noticed even with the queue closed.
    if (prefs.automodNotices && chatSurface()) {
      const list = listFor(from);
      if (list) addAutomodNotice(e, list);
    }
  } else {
    // Approved, denied or expired — remove it whoever did it.
    const i = q.findIndex((x) => x.message_id === e.message_id);
    if (i >= 0) q.splice(i, 1);
  }
  if (active && from === active.id) renderAutomod();
}

// "Blocked term" or AutoMod's category and level, in plain words.
function automodReason(e) {
  if (e.reason === "blocked_term") return "Blocked term";
  const a = e.automod || {};
  const cat = (a.category || "automod").replace(/_/g, " ");
  return cat.charAt(0).toUpperCase() + cat.slice(1) + (a.level ? " · level " + a.level : "");
}

// The message text with the flagged parts marked. Twitch sends inclusive
// character boundaries for both AutoMod categories and blocked terms.
function flaggedText(parent, e) {
  const t = (e.message && e.message.text) || "";
  const spans = [];
  for (const b of (e.automod && e.automod.boundaries) || []) spans.push([b.start_pos, b.end_pos]);
  for (const f of (e.blocked_term && e.blocked_term.terms_found) || []) {
    if (f.boundary) spans.push([f.boundary.start_pos, f.boundary.end_pos]);
  }
  spans.sort((a, b) => a[0] - b[0]);
  let at = 0;
  for (const [s, end] of spans) {
    if (!(s >= at && end >= s && end < t.length)) continue;
    if (s > at) parent.appendChild(document.createTextNode(t.slice(at, s)));
    parent.appendChild(h("mark", "am-mark", t.slice(s, end + 1)));
    at = end + 1;
  }
  if (at < t.length) parent.appendChild(document.createTextNode(t.slice(at)));
}

function renderAutomod() {
  const list = $("automod-list");
  if (!list) return;
  list.textContent = "";
  const q = active ? automodList(active.id) : [];
  $("automod-count").textContent = q.length ? String(q.length) : "—";
  paintAutomodBadge(q.length);

  if (!active || !canMod()) {
    list.appendChild(h("li", "side-empty", "AutoMod's queue is only available on channels you moderate."));
    return;
  }
  if (automodNote) {
    list.appendChild(h("li", "side-empty", automodNote));
    return;
  }
  if (!q.length) {
    list.appendChild(h("li", "side-empty", "Nothing held. Messages AutoMod catches will appear here for review."));
    return;
  }
  for (const e of q) list.appendChild(automodRow(e));
}

function automodRow(e) {
  const li = h("li", "am-item");
  li.dataset.msg = e.message_id;

  // The sender's name opens the usual moderation sheet, so a repeat
  // offender can be timed out from here without hunting for them in chat.
  const head = h("div", "am-head");
  head.appendChild(h("span", "am-who", e.user_name || e.user_login || "someone"));
  head.appendChild(h("span", "am-why", automodReason(e)));
  head.title = "Moderate " + (e.user_name || e.user_login || "");
  head.addEventListener("click", () => openSheet({
    chatter_user_id: e.user_id,
    chatter_user_name: e.user_name || e.user_login,
    chatter_user_login: e.user_login,
    broadcaster_user_id: e.broadcaster_user_id,
    message: null,
    message_id: null,
  }));
  li.appendChild(head);

  const text = h("div", "am-text");
  flaggedText(text, e);
  li.appendChild(text);

  const row = h("div", "am-actions");
  const allow = h("button", "am-allow", "Allow");
  const deny = h("button", "am-deny", "Deny");
  allow.addEventListener("click", () => resolveAutomod(e, "ALLOW", li));
  deny.addEventListener("click", () => resolveAutomod(e, "DENY", li));
  row.appendChild(allow);
  row.appendChild(deny);
  li.appendChild(row);
  return li;
}

async function resolveAutomod(e, action, li) {
  for (const b of li.querySelectorAll("button")) b.disabled = true;
  const drop = () => {
    const q = automodList(e.broadcaster_user_id || (active && active.id));
    const i = q.findIndex((x) => x.message_id === e.message_id);
    if (i >= 0) q.splice(i, 1);
  };
  try {
    // user_id is the acting moderator; Twitch checks the powers itself.
    await apiJSON("/moderation/automod/message", "POST",
      { user_id: me.id, msg_id: e.message_id, action });
    li.classList.add("done");
    drop();
    setTimeout(renderAutomod, 300);
    toast(action === "ALLOW" ? "Message allowed" : "Message denied");
  } catch (err) {
    // Resolved by someone else, or expired: it's gone on Twitch's side too.
    if (/not found|404|expired|already/i.test(err.message)) {
      drop();
      renderAutomod();
      toast("Already handled", true);
      return;
    }
    for (const b of li.querySelectorAll("button")) b.disabled = false;
    toast(err.message, true);
  }
}

// A count on the header button, so a hold shows even with the queue closed.
function paintAutomodBadge(n) {
  const b = $("btn-automod");
  if (!b) return;
  if (n == null) n = active ? automodList(active.id).length : 0;
  let badge = b.querySelector(".btn-badge");
  if (!n) { if (badge) badge.remove(); return; }
  if (!badge) { badge = h("span", "btn-badge"); b.appendChild(badge); }
  badge.textContent = n > 9 ? "9+" : String(n);
}

function addAutomodNotice(e, list) {
  const stick = following(list);
  const li = h("li", "notice am-notice");
  if (prefs.showTimestamps) li.appendChild(h("span", "stamp", stampOf(e)));
  li.appendChild(h("span", "notice-text",
    "AutoMod held a message from " + (e.user_name || e.user_login || "someone") + " · " + automodReason(e)));
  li.title = "Open the AutoMod queue";
  li.addEventListener("click", () => { if (!prefs.showAutomod) setPref("showAutomod", true); });
  list.appendChild(li);
  if (chatQuery) filterRow(li);
  trimAndScroll(stick, list);
}

// ══ Alerts: mentions and keywords ══════════════════════════════════
// Purely local — a highlight on the row and, if wanted, a short sound.
// The sounds are synthesised on the spot so nothing is downloaded and
// nothing has to ship in the package.
const ALERT_SOUNDS = [
  ["off", "Off"], ["ping", "Ping"], ["pop", "Pop"], ["chime", "Chime"], ["knock", "Knock"],
];
const ALERT_GAP_MS = 2000;   // a busy chat can't machine-gun the sound

function alertKeywords() {
  return String(prefs.alertKeywords || "")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

// "mention", "keyword", or "" for a message that needs no attention.
function alertFor(e) {
  if (!me || !e.message || e.chatter_user_id === me.id) return "";
  const text = e.message.text || "";
  if (prefs.alertMentions) {
    const frags = e.message.fragments || [];
    if (frags.some((f) => f.type === "mention" && f.mention && f.mention.user_id === me.id)) return "mention";
    // Twitch only tags a mention it could resolve; catch a plain @login too.
    if (new RegExp("(^|[^\\w])@" + me.login + "([^\\w]|$)", "i").test(text)) return "mention";
  }
  const lower = text.toLowerCase();
  for (const k of alertKeywords()) if (lower.includes(k)) return "keyword";
  return "";
}

let audioCtx = null;
let lastAlertAt = 0;

// Browsers only start audio after a user gesture. The first tap anywhere
// in the widget unlocks it; until then a chime is silently skipped.
function unlockAudio() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
  } catch {}
}
document.addEventListener("pointerdown", unlockAudio, { capture: true, passive: true });

function alertSound(name, force) {
  name = name || prefs.alertSound;
  if (!name || name === "off") return;
  const now = Date.now();
  if (!force && now - lastAlertAt < ALERT_GAP_MS) return;
  lastAlertAt = now;
  try {
    unlockAudio();
    if (!audioCtx || audioCtx.state !== "running") return;
    playAlert(audioCtx, name);
  } catch {}
}

function playAlert(ctx, name) {
  const t0 = ctx.currentTime;
  const out = ctx.createGain();
  out.gain.value = 0.16;
  out.connect(ctx.destination);

  // One enveloped oscillator: quick attack, exponential decay.
  const tone = (freq, start, dur, type, peak) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type || "sine";
    o.frequency.setValueAtTime(freq, t0 + start);
    g.gain.setValueAtTime(0.0001, t0 + start);
    g.gain.exponentialRampToValueAtTime(peak || 1, t0 + start + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + start + dur);
    o.connect(g);
    g.connect(out);
    o.start(t0 + start);
    o.stop(t0 + start + dur + 0.05);
    return o;
  };
  // A short burst of filtered noise — a knock.
  const thud = (start) => {
    const len = 0.09;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * len), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 420;
    src.connect(f);
    f.connect(out);
    src.start(t0 + start);
  };

  switch (name) {
    case "ping":
      tone(1046, 0, 0.4, "sine");
      tone(2093, 0, 0.22, "sine", 0.3);
      break;
    case "pop": {
      const o = tone(520, 0, 0.13, "sine");
      o.frequency.exponentialRampToValueAtTime(160, t0 + 0.13);
      break;
    }
    case "chime":
      tone(659, 0, 0.55, "triangle");
      tone(988, 0.14, 0.65, "triangle", 0.7);
      break;
    case "knock":
      thud(0);
      thud(0.16);
      break;
  }
}

// ══ Chat search ════════════════════════════════════════════════════
// Filters what's already on screen — every open chat, split panes
// included — by chatter name or message text. Purely local: it hides
// non-matching rows rather than querying Twitch, which has no such API.
let chatQuery = "";

function chatLists() {
  return [$("messages"), ...$("split-grid").querySelectorAll(".pane-list")];
}

// A row matches when the query appears in the sender's name or the text.
function rowMatches(li) {
  if (!chatQuery) return true;
  const who = li.querySelector(".who");
  const text = li.querySelector(".text");
  const hay = ((who ? who.textContent : "") + " " + (text ? text.textContent : "")).toLowerCase();
  return hay.includes(chatQuery);
}

function filterRow(li) {
  // Notices carry no sender, so a search hides them rather than
  // pretending they matched.
  const hide = chatQuery && (!li.classList.contains("msg") || !rowMatches(li));
  li.classList.toggle("nomatch", !!hide);
}

function applyChatFilter() {
  let hits = 0;
  for (const list of chatLists()) {
    for (const li of list.children) {
      filterRow(li);
      if (chatQuery && !li.classList.contains("nomatch")) hits++;
    }
    // A filtered list is short; keep the newest matches in view.
    if (chatQuery) list.scrollTop = list.scrollHeight;
  }
  const c = $("msg-filter-count");
  c.textContent = chatQuery ? (hits ? hits + (hits === 1 ? " hit" : " hits") : "none") : "";
  c.classList.toggle("empty", !!chatQuery && !hits);
  document.body.classList.toggle("searching", !!chatQuery);
}

// Both popovers hang under their button rather than growing inside the
// header, which has no width to spare on a narrow tile.
function placePopover(box, btn) {
  const z = zoomOf(box);             // fixed, but inside the zoomed header
  const r = btn.getBoundingClientRect();
  const pad = 10;
  const w = box.offsetWidth;
  box.style.left = Math.max(pad, Math.min(Math.round(r.right / z - w), innerWidth / z - w - pad)) + "px";
  box.style.top = Math.round(r.bottom / z + 6) + "px";
}

// ── Filter the messages on screen ──────────────────────────────────
function openMsgFilter() {
  const box = $("msg-filter");
  if (!box.hidden) return closeMsgFilter();
  closeChanSearch();
  closeMenu();
  box.hidden = false;
  $("btn-filter").classList.add("on");
  placePopover(box, $("btn-filter"));
  $("msg-filter-input").focus();
}

function closeMsgFilter() {
  $("msg-filter").hidden = true;
  $("btn-filter").classList.remove("on");
  $("msg-filter-input").value = "";
  chatQuery = "";
  applyChatFilter();
}

$("btn-filter").addEventListener("click", openMsgFilter);
$("msg-filter-close").addEventListener("click", closeMsgFilter);
$("msg-filter-input").addEventListener("input", (e) => {
  chatQuery = e.target.value.trim().toLowerCase();
  applyChatFilter();
});
$("msg-filter-input").addEventListener("keydown", (e) => {
  if (e.key === "Escape") { e.stopPropagation(); closeMsgFilter(); }
});

// ── Find any channel on Twitch ─────────────────────────────────────
// Not a filter over what's listed: this asks Twitch, so a channel you
// neither moderate nor follow can be opened by name.
let chanSearchTimer = null;
let chanSearchSeq = 0;

function openChanSearch() {
  const box = $("chan-search");
  if (!box.hidden) return closeChanSearch();
  closeMsgFilter();
  closeMenu();
  box.hidden = false;
  $("btn-search").classList.add("on");
  placePopover(box, $("btn-search"));
  $("chan-search-input").focus();
  renderChanResults(localChannelMatches(""));
}

function closeChanSearch() {
  $("chan-search").hidden = true;
  $("btn-search").classList.remove("on");
  $("chan-search-input").value = "";
  $("chan-search-results").textContent = "";
  clearTimeout(chanSearchTimer);
}

// The channels already on hand, so a known name answers instantly.
function localChannelMatches(q) {
  const all = allSwitchableChannels();
  if (!q) return all.slice(0, 8);
  return all.filter((c) => c.name.toLowerCase().includes(q) || (c.login || "").includes(q)).slice(0, 8);
}

function renderChanResults(list, note) {
  const box = $("chan-search-results");
  box.textContent = "";
  if (note) box.appendChild(h("div", "sp-note", note));
  if (!list.length && !note) box.appendChild(h("div", "sp-note", "No channels found"));

  for (const c of list) {
    const item = h("div", "chan-item" + (active && active.id === c.id ? " on" : ""));
    item.dataset.chan = c.id;                     // draggable into the split
    rememberChannel(c);
    item.appendChild(avatarEl(c.id, "ci-av"));
    item.appendChild(h("span", "ci-name", c.name));
    if (c.live) {
      item.appendChild(h("span", "ci-live", c.viewers != null ? formatCount(c.viewers) : "Live"));
    }

    // Open it beside what's already there rather than instead of it.
    const sp = h("button", "ci-split" + (inSplit(c.id) ? " on" : ""));
    sp.appendChild(svgUse("i-split"));
    sp.title = inSplit(c.id) ? "Already open" : "Open alongside";
    sp.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (inSplit(c.id)) return;
      rememberChannel(c);
      if (addToSplit(c)) activateChannel(c);
      sp.classList.add("on");
    });
    item.appendChild(sp);

    item.addEventListener("click", () => {
      rememberChannel(c);
      closeChanSearch();
      openChannel(c);
    });
    box.appendChild(item);
  }
}

// A searched channel isn't in any list yet; cache it so its avatar and
// name resolve everywhere else it shows up.
function rememberChannel(c) {
  if (!userCache.has(c.id)) {
    userCache.set(c.id, { login: c.login, name: c.name, avatar: c.avatar });
  }
}

async function runChanSearch(q) {
  const local = localChannelMatches(q);
  if (!q) return renderChanResults(local);

  renderChanResults(local, "Searching Twitch…");
  const seq = ++chanSearchSeq;
  try {
    const j = await api("/search/channels?first=8&query=" + encodeURIComponent(q));
    if (seq !== chanSearchSeq) return;            // a newer query won
    const seen = new Set(local.map((c) => c.id));
    const hits = [];
    for (const r of j.data || []) {
      if (seen.has(r.id)) continue;
      hits.push({
        id: r.id,
        login: r.broadcaster_login,
        name: r.display_name,
        avatar: r.thumbnail_url,
        self: false,
        live: !!r.is_live,
        viewers: null,
      });
      userCache.set(r.id, { login: r.broadcaster_login, name: r.display_name, avatar: r.thumbnail_url });
    }
    renderChanResults([...local, ...hits]);
  } catch {
    if (seq === chanSearchSeq) renderChanResults(local, "Couldn't reach Twitch");
  }
}

$("btn-search").addEventListener("click", openChanSearch);
$("chan-search-close").addEventListener("click", closeChanSearch);
$("chan-search-input").addEventListener("input", (e) => {
  const q = e.target.value.trim().toLowerCase();
  clearTimeout(chanSearchTimer);
  chanSearchTimer = setTimeout(() => runChanSearch(q), 300);
});
$("chan-search-input").addEventListener("keydown", (e) => {
  if (e.key === "Escape") { e.stopPropagation(); closeChanSearch(); }
});

// Anything else on screen dismisses them, like the other popovers.
document.addEventListener("pointerdown", (e) => {
  const f = $("msg-filter");
  if (!f.hidden && !f.contains(e.target) && !$("btn-filter").contains(e.target) && !chatQuery) {
    closeMsgFilter();   // a filter someone is using shouldn't vanish on a stray tap
  }
  const s = $("chan-search");
  if (!s.hidden && !s.contains(e.target) && !$("btn-search").contains(e.target)) closeChanSearch();
}, true);

// Tap-again confirmation for one-tap buttons: the first tap arms the
// button (it turns red), a second tap within 4s fires it, and the arm
// falls off on its own. A dialog would cost more taps than it saves on
// a touchscreen; re-tapping the same spot costs almost nothing.
function confirmTap(b, wants) {
  if (!wants()) return true;
  if (b.classList.contains("armed")) {
    clearTimeout(b._armTimer);
    b.classList.remove("armed");
    return true;
  }
  b.classList.add("armed");
  clearTimeout(b._armTimer);
  b._armTimer = setTimeout(() => b.classList.remove("armed"), 4000);
  return false;
}

// Pending mod actions held in a bar above the composer. Arming the
// button on the row works until the chat moves fast enough to scroll the
// row away before the second tap — the bar stays put and names its
// target, so speed stops mattering. Each pending action is its own row:
// confirming one leaves the others waiting.
function showConfirmBar(e, label, fn) {
  const bar = $("confirm-bar");

  // Tapping the same action on the same message twice is one question.
  const key = label + "|" + (e.message_id || e.chatter_user_id);
  for (const r of bar.children) if (r.dataset.key === key) return;

  const row = h("div", "cb-row");
  row.dataset.key = key;
  row.appendChild(svgUse("i-flag", "cb-ico"));
  const text = e.message && e.message.text ? ": " + e.message.text : "";
  const line = h("span", "cb-text");
  line.appendChild(h("b", null, label + " — " + e.chatter_user_name));
  line.appendChild(document.createTextNode(text));
  row.appendChild(line);

  const done = () => { row.remove(); bar.hidden = !bar.children.length; };
  const no = h("button", "cb-btn", "Cancel");
  no.addEventListener("click", done);
  const yes = h("button", "cb-btn yes", "Confirm");
  yes.addEventListener("click", () => { done(); sheetTarget = e; fn(); });
  row.appendChild(no);
  row.appendChild(yes);

  bar.appendChild(row);
  bar.hidden = false;
}
function hideConfirmBar() {
  const bar = $("confirm-bar");
  bar.textContent = "";
  bar.hidden = true;
}

// The same actions as the sheet, one tap away on the row itself.
function inlineActions(e) {
  const bar = h("span", "msg-actions");
  const first = timeoutPresets()[0];

  const act = (icon, title, fn) => {
    const b = h("button", "msg-act");
    b.appendChild(svgUse(icon));
    b.title = title;
    b.addEventListener("click", (ev) => {
      ev.stopPropagation();          // don't also open the sheet
      if (prefs.confirmInlineActions && prefs.confirmRow) {
        showConfirmBar(e, title, fn);
        return;
      }
      if (!confirmTap(b, () => prefs.confirmInlineActions)) return;
      sheetTarget = e;
      fn();
    });
    return b;
  };

  bar.appendChild(act("i-trash", "Delete message", () => runAction("delete")));
  if (first) {
    bar.appendChild(act("i-clock", "Timeout " + labelOf(first), () => runAction("timeout", toSeconds(first))));
  }
  bar.appendChild(act("i-ban", "Ban", () => { banArmed = true; runAction("ban"); }));
  return bar;
}

function addNotice(e, list) {
  list = list || $("messages");
  const stick = following(list);
  const li = h("li", "notice");
  li.appendChild(h("span", "notice-text", e.system_message || e.notice_type || "event"));
  list.appendChild(li);
  if (chatQuery) filterRow(li);
  trimAndScroll(stick, list);
}

function markDeleted(match) {
  // Deletions can land in the single view or any split pane.
  const lists = [$("messages"), ...$("split-grid").querySelectorAll(".pane-list")];
  for (const l of lists) {
    for (const n of l.children) {
      if (n.dataset && match(n)) n.classList.add("deleted");
    }
  }
}

// ══ Moderation sheet ═══════════════════════════════════════════════
function openSheet(e) {
  sheetTarget = e;
  banArmed = false;
  clearTimeout(banTimer);
  // Judge powers for the channel the message lives in, not the focused one.
  const chanId = e.broadcaster_user_id || active.id;
  const mod = canModId(chanId);
  $("sheet-name").textContent = e.chatter_user_name;
  $("sheet-sub").textContent = "@" + e.chatter_user_login + " · in " + (chanName(chanId) || active.name);
  $("sheet-message").textContent = (e.message && e.message.text) || "";
  $("sheet-message").hidden = !(e.message && e.message.text);
  // No message to act on when opened from the viewer list.
  $("sheet").querySelector('[data-act="delete"]').disabled = !e.message_id;
  renderTimeoutRow();
  $("sheet-avatar").removeAttribute("src");
  $("sheet-result").hidden = true;
  for (const g of $("sheet").querySelectorAll(".sheet-group")) g.hidden = !mod;
  $("sheet-readonly").hidden = mod;
  $("sheet").hidden = false;
  $("scrim").hidden = false;

  // Chat events carry no avatar, so fetch just this one user.
  api(`/users?id=${e.chatter_user_id}`)
    .then((j) => {
      const u = j.data && j.data[0];
      if (u && sheetTarget === e) $("sheet-avatar").src = u.profile_image_url;
    })
    .catch(() => {});
}

function openSheetForUser(u) {
  openSheet({
    chatter_user_id: u.user_id,
    chatter_user_name: u.user_name,
    chatter_user_login: u.user_login,
    message: null,
    message_id: null,
  });
}

function renderTimeoutRow() {
  const row = $("timeout-row");
  row.textContent = "";
  for (const t of timeoutPresets()) {
    const b = h("button", null, labelOf(t));
    b.addEventListener("click", () => runAction("timeout", toSeconds(t)));
    row.appendChild(b);
  }
}

const CLOSE_MS = 150;

function hidePanel(el) {
  if (!el || el.hidden || el.classList.contains("closing")) return;
  el.classList.add("closing");
  setTimeout(() => {
    el.hidden = true;
    el.classList.remove("closing");
  }, CLOSE_MS);
}

function closeSheet() {
  closeMenu();
  hideTip();
  sheetTarget = null;
  for (const id of ["sheet", "settings", "prefs", "broadcast", "pins", "scrim"]) {
    hidePanel($(id));
  }
}

function sheetResult(text, bad) {
  if ($("sheet").hidden) return toast(text, bad);
  const p = $("sheet-result");
  p.textContent = text;
  p.className = "sheet-result" + (bad ? " bad" : "");
  p.hidden = false;
}

async function runAction(act, sec) {
  if (!sheetTarget || !active) return;
  const e = sheetTarget;
  const who = e.chatter_user_name;
  // The action targets the channel the message came from — in a split
  // pane that isn't necessarily the focused channel. moderator_id is
  // always us; Twitch checks our mod status server-side.
  const base = `broadcaster_id=${e.broadcaster_user_id || active.id}&moderator_id=${me.id}`;

  try {
    if (act === "delete") {
      await api(`/moderation/chat?${base}&message_id=${e.message_id}`, { method: "DELETE" });
      markDeleted((n) => n.dataset.msg === e.message_id);
      sheetResult("Message deleted");
    } else if (act === "timeout") {
      await apiJSON(`/moderation/bans?${base}`, "POST",
        { data: { user_id: e.chatter_user_id, duration: sec, reason: "" } });
      sheetResult(`${who} timed out for ${sec >= 3600 ? sec / 3600 + "h" : sec / 60 + "m"}`);
    } else if (act === "ban") {
      if (prefs.confirmBan && !banArmed) {
        banArmed = true;
        sheetResult(`Tap Ban again to permanently ban ${who}`, true);
        clearTimeout(banTimer);
        banTimer = setTimeout(() => { banArmed = false; $("sheet-result").hidden = true; }, 4000);
        return;
      }
      banArmed = false;
      await apiJSON(`/moderation/bans?${base}`, "POST",
        { data: { user_id: e.chatter_user_id, reason: "" } });
      sheetResult(`${who} banned`);
    } else if (act === "warn") {
      await apiJSON(`/moderation/warnings?${base}`, "POST",
        { data: { user_id: e.chatter_user_id, reason: "Warned by a moderator" } });
      sheetResult(`${who} warned`);
    }
    setTimeout(closeSheet, 900);
  } catch (err) {
    sheetResult(err.message, true);
  }
}

// ══ Chat settings ══════════════════════════════════════════════════
const TOGGLES = [
  { key: "emote_mode", label: "Emote only", short: "Emote", icon: "i-smile" },
  { key: "follower_mode", label: "Followers only", short: "Follow", icon: "i-follow" },
  { key: "subscriber_mode", label: "Subscribers only", short: "Subs", icon: "i-star" },
  { key: "unique_chat_mode", label: "Unique messages", short: "Unique", icon: "i-unique" },
  { key: "slow_mode", label: "Slow mode", short: "Slow", icon: "i-slow" },
];

async function loadSettings() {
  if (DEMO) { renderModes(); renderSettings(); renderQuickActions(); return; }
  settings = null;
  if (!canMod()) { renderModes(); renderQuickActions(); return; }
  const forChannel = active.id;
  try {
    const j = await api(`/chat/settings?broadcaster_id=${forChannel}&moderator_id=${me.id}`);
    if (!active || active.id !== forChannel) return;   // switched away mid-flight
    settings = j.data && j.data[0];
  } catch {}
  renderModes();
  renderSettings();
  renderQuickActions();
}

function applySettings(e) {
  if (!settings) settings = {};
  for (const t of TOGGLES) if (e[t.key] != null) settings[t.key] = e[t.key];
  if (e.slow_mode_wait_time != null) settings.slow_mode_wait_time = e.slow_mode_wait_time;
  renderModes();
  renderSettings();
  renderQuickActions();
}

// Compact chips in the chat header, so active restrictions are visible
// without opening anything.
function renderModes() {
  const box = $("chat-modes");
  box.textContent = "";
  if (!settings) return;
  for (const t of TOGGLES) {
    if (settings[t.key]) box.appendChild(h("span", "mode-chip", t.label));
  }
}

function renderSettings() {
  const list = $("settings-list");
  list.textContent = "";
  $("settings-title").textContent = active ? "Chat settings · " + active.name : "Chat settings";
  if (!settings) {
    list.appendChild(h("li", "settings-empty", "Couldn't load chat settings."));
    return;
  }
  for (const t of TOGGLES) {
    const li = h("li", "toggle");
    li.appendChild(h("span", null, t.label));
    const sw = h("button", "switch" + (settings[t.key] ? " on" : ""));
    sw.appendChild(h("span", "knob"));
    sw.addEventListener("click", () => setMode(t.key, !settings[t.key], sw));
    li.appendChild(sw);
    list.appendChild(li);
  }
}

async function setMode(key, on, sw) {
  const body = { [key]: on };
  // Twitch wants a duration alongside these when switching them on.
  if (key === "slow_mode" && on) body.slow_mode_wait_time = 30;
  if (key === "follower_mode" && on) body.follower_mode_duration = 0;

  sw.classList.toggle("on", on);   // optimistic — reverted if Twitch says no
  try {
    const j = await apiJSON(
      `/chat/settings?broadcaster_id=${active.id}&moderator_id=${me.id}`, "PATCH", body);
    settings = (j.data && j.data[0]) || settings;
    renderModes();
    renderQuickActions();
  } catch (e) {
    sw.classList.toggle("on", !on);
    toast(e.message, true);
  }
}

async function clearChat() {
  try {
    await api(`/moderation/chat?broadcaster_id=${active.id}&moderator_id=${me.id}`, { method: "DELETE" });
    $("messages").textContent = "";
    closeSheet();
    toast("Chat cleared");
  } catch (e) {
    toast(e.message, true);
  }
}

// ══ Broadcast ══════════════════════════════════════════════════════
// Everything here is channel:* scoped, so it only ever applies to your
// own channel — the button is hidden on channels you merely moderate.
const AD_LENGTHS = [30, 60, 90, 120, 180];
let bcChannel = null;      // Helix channel info
let bcPickedGame = null;   // {id, name} chosen from search
let bcArmed = null;        // action awaiting a confirming second tap
let bcArmTimer = null;
let catTimer = null;
let raidTimer = null;

function bcResult(text, bad) {
  // The tiles trigger these with the panel closed.
  if ($("broadcast").hidden) return toast(text, bad);
  const p = $("bc-result");
  p.textContent = text;
  p.className = "sheet-result" + (bad ? " bad" : "");
  p.hidden = false;
}

// Ads and raids interrupt everyone watching, so they take two taps.
function armed(key, label) {
  if (bcArmed === key) { bcArmed = null; clearTimeout(bcArmTimer); return true; }
  bcArmed = key;
  bcResult("Tap again to " + label, true);
  clearTimeout(bcArmTimer);
  bcArmTimer = setTimeout(() => { bcArmed = null; $("bc-result").hidden = true; }, 4000);
  return false;
}

async function openBroadcast() {
  bcPickedGame = null;
  bcArmed = null;
  $("bc-result").hidden = true;
  $("bc-cat-results").textContent = "";
  $("bc-raid-results").textContent = "";
  $("bc-cat-search").value = "";
  $("bc-raid-search").value = "";
  $("broadcast").hidden = false;
  $("scrim").hidden = false;

  renderAdButtons();
  renderRaid();

  try {
    const j = await api("/channels?broadcaster_id=" + me.id);
    bcChannel = j.data && j.data[0];
    if (bcChannel) {
      $("bc-title").value = bcChannel.title || "";
      $("bc-category").textContent = bcChannel.game_name || "No category";
    }
  } catch (e) { bcResult(e.message, true); }

  try {
    const live = (await api("/streams?user_id=" + me.id)).data[0];
    $("bc-state").textContent = live
      ? `Live · ${live.viewer_count} viewers · since ${new Date(live.started_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
      : "Offline";
  } catch { $("bc-state").textContent = ""; }
}

function renderAdButtons() {
  const row = $("bc-ads");
  row.textContent = "";
  for (const len of AD_LENGTHS) {
    const b = h("button", null, len + "s");
    b.addEventListener("click", () => runCommercial(len));
    row.appendChild(b);
  }
}

async function saveChannel() {
  const body = {};
  const title = $("bc-title").value.trim();
  if (title && title !== (bcChannel && bcChannel.title)) body.title = title;
  if (bcPickedGame) body.game_id = bcPickedGame.id;
  if (!Object.keys(body).length) return bcResult("Nothing changed");
  try {
    await apiJSON("/channels?broadcaster_id=" + me.id, "PATCH", body);
    if (bcPickedGame) {
      $("bc-category").textContent = bcPickedGame.name;
      bcPickedGame = null;
      $("bc-cat-results").textContent = "";
      $("bc-cat-search").value = "";
    }
    if (bcChannel) bcChannel.title = title;
    bcResult("Channel updated");
  } catch (e) { bcResult(e.message, true); }
}

async function searchCategories(q) {
  const list = $("bc-cat-results");
  list.textContent = "";
  if (!q) return;
  try {
    const j = await api("/search/categories?first=6&query=" + encodeURIComponent(q));
    for (const g of j.data || []) {
      const li = h("li", "bc-hit");
      if (g.box_art_url) {
        const img = document.createElement("img");
        img.src = g.box_art_url.replace("{width}", "40").replace("{height}", "53");
        li.appendChild(img);
      }
      li.appendChild(h("span", null, g.name));
      li.addEventListener("click", () => {
        bcPickedGame = { id: g.id, name: g.name };
        $("bc-category").textContent = g.name + " (unsaved)";
        list.textContent = "";
        $("bc-cat-search").value = "";
      });
      list.appendChild(li);
    }
  } catch (e) { bcResult(e.message, true); }
}

async function searchRaidTarget(q) {
  const list = $("bc-raid-results");
  list.textContent = "";
  if (!q) return;
  try {
    const j = await api("/search/channels?first=6&query=" + encodeURIComponent(q));
    for (const c of j.data || []) {
      const li = h("li", "bc-hit");
      if (c.thumbnail_url) {
        const img = document.createElement("img");
        img.src = c.thumbnail_url;
        li.appendChild(img);
      }
      li.appendChild(h("span", null, c.display_name + (c.is_live ? " · live" : "")));
      li.addEventListener("click", () => startRaid(c));
      list.appendChild(li);
    }
  } catch (e) { bcResult(e.message, true); }
}

// Twitch has no "is a raid pending" endpoint, so the countdown it starts
// is mirrored locally — and persisted, so a reload mid-raid still offers
// the cancel.
const RAID_WINDOW_MS = 90000;

function raidPending() {
  try {
    const raw = localStorage.getItem(RAID_KEY);
    if (!raw) return null;
    const r = JSON.parse(raw);
    if (Date.now() > r.until) { localStorage.removeItem(RAID_KEY); return null; }
    return r;
  } catch { return null; }
}
function setRaidPending(r) {
  try {
    if (r) localStorage.setItem(RAID_KEY, JSON.stringify(r));
    else localStorage.removeItem(RAID_KEY);
  } catch {}
  renderRaid();
}

let raidTick = null;

function renderRaid() {
  const r = raidPending();
  const live = $("bc-raid-live");
  const search = $("bc-raid-search");
  const results = $("bc-raid-results");

  clearInterval(raidTick);
  live.hidden = !r;
  search.hidden = !!r;
  results.hidden = !!r;
  $("bc-raid-cancel").hidden = !r;

  if (!r) return;
  const paint = () => {
    const left = Math.max(0, Math.round((r.until - Date.now()) / 1000));
    $("bc-raid-target").textContent = `Raiding ${r.name}`;
    $("bc-raid-count").textContent = left ? `${left}s to cancel` : "starting…";
    if (!left) { clearInterval(raidTick); setRaidPending(null); }
  };
  paint();
  raidTick = setInterval(paint, 1000);
}

async function startRaid(c) {
  if (!armed("raid:" + c.id, "raid " + c.display_name)) return;
  try {
    await api(`/raids?from_broadcaster_id=${me.id}&to_broadcaster_id=${c.id}`, { method: "POST" });
    setRaidPending({ id: c.id, name: c.display_name, until: Date.now() + RAID_WINDOW_MS });
    renderActionGrid();
    bcResult("Raiding " + c.display_name + " — Twitch runs a 90s countdown");
    $("bc-raid-results").textContent = "";
    $("bc-raid-search").value = "";
  } catch (e) { bcResult(e.message, true); }
}

async function cancelRaid() {
  try {
    await api("/raids?broadcaster_id=" + me.id, { method: "DELETE" });
    setRaidPending(null);
    bcResult("Raid cancelled");
  } catch (e) {
    // Someone may have cancelled it elsewhere, or it already went out.
    if (/raid pending/i.test(e.message)) setRaidPending(null);
    bcResult(e.message, true);
  }
  renderActionGrid();
}

async function runCommercial(len, confirmed) {
  if (!confirmed && !armed("ad:" + len, `run a ${len}s ad`)) return;
  try {
    const j = await apiJSON("/channels/commercial", "POST", { broadcaster_id: me.id, length: len });
    const d = j.data && j.data[0];
    bcResult(d && d.message ? d.message : `${len}s commercial started`);
  } catch (e) { bcResult(e.message, true); }
}

async function createClip() {
  try {
    const j = await api("/clips?broadcaster_id=" + me.id, { method: "POST" });
    const d = j.data && j.data[0];
    bcResult(d ? "Clip created — edit it at " + String(d.edit_url).replace(/^https?:\/\//, "") : "Clip created");
  } catch (e) { bcResult(e.message, true); }
}

async function createMarker() {
  try {
    const j = await apiJSON("/streams/markers", "POST", { user_id: me.id, description: "Marked from the widget" });
    const d = j.data && j.data[0];
    bcResult(d ? `Marker at ${humanDuration(d.position_seconds)}` : "Marker added");
  } catch (e) { bcResult(e.message, true); }
}

// ══ Widget role ════════════════════════════════════════════════════
// Twitchify can be placed on a screen more than once, and each copy can
// take a job: the whole thing, just the chat, the activity feed, a grid
// of quick actions, or stream stats. iCUE shows a "This widget shows"
// control in the widget's own settings when it is placed (declared as an
// x-icue-property in index.html); that wins when set. Otherwise the
// choice lives in Preferences, stored per placed instance.
const MODES = [
  ["full", "Everything"],
  ["chat", "Chat"],
  ["feed", "Activity"],
  ["actions", "Actions"],
  ["stats", "Stats"],
  ["custom", "Custom"],
];
const MODE_NAMES = {
  full: "Everything", chat: "Chat & controls", feed: "Activity feed",
  actions: "Quick actions", stats: "Stats", custom: "Custom panel",
};

// iCUE-injected values arrive as globals — sometimes as `let`s in the
// global lexical scope, which `window[name]` cannot see. An indirect eval
// reads both; in a plain browser neither exists and this is undefined.
function icueProp(name) {
  try {
    if (name in window) return window[name];
    return (0, eval)(name);
  } catch { return undefined; }
}

// Typed readers for the panel's controls. A slider arrives as a number or
// a numeric string; a switch as true or "true"; a colour as #RRGGBB, but
// Qt can hand over #AARRGGBB too.
function icueScale(name) {
  const n = Number(icueProp(name));
  return (Number.isFinite(n) && n > 0 ? Math.min(200, Math.max(60, n)) : 100) / 100;
}
function icueBool(name) {
  const v = icueProp(name);
  return v === true || v === "true";
}
function icueColor(name) {
  const v = icueProp(name);
  const m = String(v || "").trim().match(/^#([0-9a-f]{6})([0-9a-f]{2})?$|^#([0-9a-f]{2})([0-9a-f]{6})$/i);
  return m ? "#" + (m[1] || m[4]).toLowerCase() : "";
}

// Region zoom means getBoundingClientRect() answers in screen pixels
// while an element's own left/top are in its zoomed space. Anything
// placed by coordinates converts through this.
function zoomOf(el) {
  let z = 1;
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
    const v = parseFloat(getComputedStyle(n).zoom);
    if (v && v !== 1) z *= v;
  }
  return z;
}

function instanceKey() {
  const u = icueProp("uniqueId");
  if (typeof u === "string" && u) return INST_PREFIX + u;
  // Browser preview: ?inst=x keeps two tabs apart.
  const m = location.search.match(/[?&]inst=([\w-]+)/);
  return INST_PREFIX + (m ? m[1] : "browser");
}

let inst = { mode: "full" };
function loadInstance() {
  try {
    const raw = localStorage.getItem(instanceKey());
    if (raw) inst = { ...inst, ...JSON.parse(raw) };
  } catch {}
  if (!MODES.some(([k]) => k === inst.mode)) inst.mode = "full";
}
function saveInstance() {
  try { localStorage.setItem(instanceKey(), JSON.stringify(inst)); } catch {}
}

// The iCUE-side control, when it says anything other than "auto".
function icueMode() {
  const m = icueProp("widgetMode");
  return MODES.some(([k]) => k === m) ? m : null;
}
// ?mode=feed for the browser preview.
function urlMode() {
  const m = (location.search.match(/[?&]mode=(\w+)/) || [])[1];
  return MODES.some(([k]) => k === m) ? m : null;
}
function mode() {
  // A panel link set in iCUE's settings makes the copy that panel, unless
  // the type control there says otherwise.
  return icueMode() || urlMode() || (icuePanelUrl() ? "custom" : null) || inst.mode || "full";
}
function setWidgetMode(m) {
  inst.mode = m;
  saveInstance();
  applyPrefs();
}

// The chat surface: messages, composer, split view, quick-action bar.
function chatSurface() { const m = mode(); return m === "full" || m === "chat"; }
// Live events over EventSub. Actions and Stats poll Helix instead, which
// keeps a screen full of widgets inside Twitch's three sockets per user.
function wantsSocket() { return chatSurface() || mode() === "feed"; }
// Follows and stream state on the socket — for the feed panel, and for
// the session counters in the stats strip.
function feedSubs() {
  const m = mode();
  return m === "feed" || (m === "full" && (prefs.feedPlace !== "off" || prefs.statsPlace !== "off"));
}
// Stats data is wanted for either placement; each placement has a test.
function wantsStats() { const m = mode(); return m === "stats" || (m === "full" && prefs.statsPlace !== "off"); }
function statsPanel() { const m = mode(); return m === "stats" || (m === "full" && prefs.statsPlace === "panel"); }
function statsStrip() { return mode() === "full" && prefs.statsPlace === "strip"; }
function wantsFeedPanel() { const m = mode(); return m === "feed" || (m === "full" && prefs.feedPlace === "panel"); }
function feedInChat() { return mode() === "full" && prefs.feedPlace === "chat"; }
function wantsActions() { const m = mode(); return m === "actions" || (m === "full" && prefs.actionsPlace === "panel"); }
function actionsBar() { return mode() === "full" && prefs.actionsPlace === "bar"; }
// The two bars above the composer: chat-mode chips, and the action chips
// on a row of their own.
function quickBarVisible() {
  return chatSurface() && !!prefs.showQuickActions && canMod();
}
function actionBarVisible() {
  return chatSurface() && actionsBar() && (canMod() || !!(active && active.self));
}
function paintBars() {
  $("quick-actions").hidden = !quickBarVisible();
  $("action-bar").hidden = !actionBarVisible();
}

let lastMode = null;

function applyMode() {
  const m = mode();
  const b = document.body;
  for (const [k] of MODES) b.classList.toggle("mode-" + k, m === k);
  b.classList.toggle("solo", !chatSurface());

  $("dash-stats").hidden = !statsPanel();
  $("dash-feed").hidden = !wantsFeedPanel();
  $("dash-actions").hidden = !wantsActions();
  $("dash-custom").hidden = !wantsCustom();
  $("dash").hidden = chatSurface() && !(statsPanel() || wantsFeedPanel() || wantsActions() || wantsCustom());
  $("stats-strip").hidden = !statsStrip();

  if (m !== lastMode) {
    const was = lastMode;
    lastMode = m;
    if (was !== null) modeChanged();
  }
}

// Switching roles while signed in: the chat surface is rebuilt from the
// buffers (it stopped rendering while hidden), the socket is opened or
// dropped to match, and the panels load for the open channel.
function modeChanged() {
  if (!me) return;
  renderSplit();
  if (chatSurface() && active && !splitActive()) {
    const list = $("messages");
    list.textContent = "";
    for (const past of buffer(active.id)) addMessage(past, list);
    setFollowing(list, true);
    pinToBottom(list);
  }
  syncSocket();
  if (!wantsSocket()) setStatus("ok", "Connected", me.display_name);
}

function syncSocket() {
  if (!me) return;
  if (wantsSocket()) { if (!eventsub.isOpen()) eventsub.open(); }
  else if (eventsub.isOpen()) eventsub.close();
}

// The dashboard sections for the open channel. Cheap to call often: the
// network loads only run when the channel changed underneath them.
function renderDash() {
  renderStats();
  renderFeed();
  renderActionGrid();
  renderCustom();
  startStatsPoll();
  if (!active || !me) return;
  if ((wantsStats() || feedSubs()) && stats.chan !== active.id) loadStats();
  if (wantsActions() && canMod() && shieldChan !== active.id) loadShield();
}

// ══ Custom panels ══════════════════════════════════════════════════
// A page of the user's own, framed — what OBS calls a browser source.
// Anything built to be embedded works: StreamElements and Streamlabs
// overlays and alert boxes, goal bars, a Twitch player embed. Ordinary
// pages (the Twitch dashboard included) refuse to load inside another
// page and stay blank, which is theirs to decide and nothing we can
// detect from outside. Optional and off by default.
let customShown = "";        // the url in the frame right now

function validPanelUrl(u) {
  return typeof u === "string" && /^https?:\/\/\S+$/i.test(u.trim());
}
function panelList() {
  return Array.isArray(prefs.customPanels)
    ? prefs.customPanels.filter((p) => p && validPanelUrl(p.url)) : [];
}
function icuePanelUrl() {
  const u = icueProp("panelUrl");
  return typeof u === "string" && validPanelUrl(u) ? u.trim() : "";
}
// The panel this copy shows: iCUE's link if set, else the one chosen
// for this instance, else the first configured.
function currentPanel() {
  const u = icuePanelUrl();
  if (u) return { id: "icue", name: "Panel", url: u };
  const list = panelList();
  return list.find((p) => p.id === inst.panel) || list[0] || null;
}
function wantsCustom() {
  const m = mode();
  return m === "custom" || (m === "full" && prefs.customPlace === "panel");
}

function renderCustom() {
  const sec = $("dash-custom");
  const box = $("custom-frame");
  if (sec.hidden) {
    // Unload when out of sight: an overlay keeps its sockets open otherwise.
    if (customShown) { box.textContent = ""; customShown = ""; }
    return;
  }
  const p = currentPanel();
  $("custom-name").textContent = p ? (p.name || "Panel") : "Custom panel";
  const url = p ? p.url : "";
  if (url === customShown && box.firstChild) return;
  box.textContent = "";
  customShown = url;

  if (!url) {
    const empty = h("div", "custom-empty");
    empty.appendChild(h("b", null, "No panel link yet"));
    empty.appendChild(document.createTextNode(
      "Add one under Preferences → Custom panels, the way you'd add a browser source in "
      + "OBS — a StreamElements or Streamlabs overlay, an alert box, a goal bar. Or paste a "
      + "link into iCUE's settings for this widget."));
    box.appendChild(empty);
    return;
  }
  const f = document.createElement("iframe");
  f.className = "custom-iframe";
  f.title = p.name || "Custom panel";
  // Scripts and its own storage, so overlays work; nothing of ours is
  // reachable from a cross-origin frame regardless.
  f.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-popups");
  f.setAttribute("allow", "autoplay");
  f.setAttribute("referrerpolicy", "no-referrer");
  f.src = url;
  box.appendChild(f);
}

function reloadCustom() {
  const f = $("custom-frame").querySelector("iframe");
  if (f) f.src = f.src;
}

// Hand any link to the OS browser, the same gentle way as a channel.
function openUrl(url) {
  if (!validPanelUrl(url)) return;
  try {
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch {}
}

// ══ Activity feed ══════════════════════════════════════════════════
// Follows, subs, gifts, cheers, raids and the stream going live or
// offline — what Twitch's own dashboard lists under Activity. Subs,
// gifts and raids ride on channel.chat.notification and cheers on the
// message itself, so only follows and stream state cost subscriptions.
// Newest first, like the dashboard.
const MAX_FEED = 200;
const feeds = new Map();          // channelId -> [item], newest first
const sessions = new Map();       // channelId -> {follows, subs, bits, raids}
const chatTimes = new Map();      // channelId -> [ms] of recent messages
let feedFilter = "all";
let followsNote = "";             // why follows aren't arriving, if known

const FEED_FILTERS = [
  ["all", "All", "i-live"], ["follow", "Follows", "i-heart"], ["sub", "Subs", "i-star"],
  ["bits", "Bits", "i-bits"], ["raid", "Raids", "i-raid"],
];
const FEED_ICON = {
  follow: "i-heart", sub: "i-star", gift: "i-gift", bits: "i-bits", raid: "i-raid",
  live: "i-bolt", offline: "i-off", announce: "i-bell", charity: "i-heart",
};

function feedOf(id) {
  let f = feeds.get(id);
  if (!f) { f = []; feeds.set(id, f); }
  return f;
}
function sessionOf(id) {
  let s = sessions.get(id);
  if (!s) { s = { follows: 0, subs: 0, bits: 0, raids: 0 }; sessions.set(id, s); }
  return s;
}

// Into the store only. A seeded follow can arrive again live; its key
// keeps it to one row.
function feedInsert(chan, item) {
  const f = feedOf(chan);
  item.at = item.at || new Date().toISOString();
  if (item.key && f.some((x) => x.key === item.key)) return false;
  f.unshift(item);
  if (f.length > MAX_FEED) f.length = MAX_FEED;
  return true;
}

// Live arrival: store, count towards the session, and show.
function feedAdd(chan, item, uncounted) {
  if (!feedInsert(chan, item)) return;
  if (!uncounted) {
    const s = sessionOf(chan);
    if (item.kind === "follow") s.follows++;
    else if (item.kind === "sub" || item.kind === "gift") s.subs += item.count != null ? item.count : 1;
    else if (item.kind === "bits") s.bits += item.bits || 0;
    else if (item.kind === "raid") s.raids++;
  }
  if (active && active.id === chan) { renderFeed(); paintSession(); }
  // Folded into the chat: rows for what Twitch's own notices don't
  // already narrate there (subs, gifts and raids arrive as notices).
  if (feedInChat() && ["follow", "bits", "live", "offline"].includes(item.kind)) {
    const list = listFor(chan);
    if (list) addFeedNotice(item, list);
  }
}

function addFeedNotice(item, list) {
  const stick = following(list);
  const li = h("li", "notice feed-notice fi-" + item.kind);
  const ico = h("span", "fi-ico");
  ico.appendChild(svgUse(FEED_ICON[item.kind] || "i-live"));
  li.appendChild(ico);
  const text = h("span", "notice-text");
  if (item.name) text.appendChild(h("b", null, item.name + " "));
  text.appendChild(document.createTextNode(item.text));
  li.appendChild(text);
  if (item.userId) {
    li.classList.add("tap");
    li.addEventListener("click", () => openSheetForUser({
      user_id: item.userId, user_name: item.name, user_login: item.login || "",
    }));
  }
  list.appendChild(li);
  if (chatQuery) filterRow(li);
  trimAndScroll(stick, list);
}

function chatTick(chan) {
  let t = chatTimes.get(chan);
  if (!t) { t = []; chatTimes.set(chan, t); }
  t.push(Date.now());
  if (t.length > 3000) t.splice(0, t.length - 3000);
}
function chatRate(chan) {
  const t = chatTimes.get(chan);
  if (!t) return 0;
  const cut = Date.now() - 60000;
  while (t.length && t[0] < cut) t.shift();
  return t.length;
}

// Every event passes through here, whatever surface is up.
function feedIntake(type, e, from) {
  switch (type) {
    case "channel.chat.message":
      chatTick(from);
      if (e.cheer && e.cheer.bits) {
        feedAdd(from, {
          kind: "bits", at: e._at, bits: e.cheer.bits,
          userId: e.chatter_user_id, name: e.chatter_user_name, login: e.chatter_user_login,
          text: `cheered ${formatCount(e.cheer.bits)} bits`,
          msg: e.message && e.message.text,
        });
      }
      return;
    case "channel.chat.notification": return feedNotice(e, from);
    case "channel.follow":
      return feedAdd(from, {
        kind: "follow", at: e.followed_at || e._at, key: "f:" + e.user_id,
        userId: e.user_id, name: e.user_name, login: e.user_login, text: "followed",
      });
    case "stream.online":
      markLive(from, true, e.started_at);
      return feedAdd(from, { kind: "live", at: e.started_at || e._at, text: "Stream went live" }, true);
    case "stream.offline":
      markLive(from, false);
      return feedAdd(from, { kind: "offline", at: e._at, text: "Stream ended" }, true);
  }
}

function markLive(chan, on, startedAt) {
  const c = channels.find((x) => x.id === chan);
  if (c) { c.live = on; if (!on) c.viewers = null; }
  if (active && active.id === chan) {
    if (stats.chan === chan) {
      stats.live = on ? (stats.live || { started_at: startedAt || new Date().toISOString(), viewer_count: 0 }) : null;
    }
    paintHeadLive();
    renderStats();
    if (wantsStats()) loadStats();
  }
  renderChannels();
}

const TIER = { "1000": "Tier 1", "2000": "Tier 2", "3000": "Tier 3" };
function tierOf(o) { return o && o.is_prime ? "Prime" : (o && TIER[o.sub_tier]) || ""; }
const joinDetail = (parts) => parts.filter(Boolean).join(" · ");

function feedNotice(e, from) {
  // Stream Together notices carry the same payload under a shared_chat_ key.
  const kind = String(e.notice_type || "").replace(/^shared_chat_/, "");
  const p = e[kind] || e["shared_chat_" + kind] || {};
  const who = {
    userId: e.chatter_user_id,
    name: e.chatter_is_anonymous ? "An anonymous gifter" : e.chatter_user_name,
    login: e.chatter_user_login,
    at: e._at,
  };
  const msg = e.message && e.message.text;
  const months = (n) => (n ? `${n} month${n === 1 ? "" : "s"}` : "");

  switch (kind) {
    case "sub":
      return feedAdd(from, { ...who, kind: "sub", text: "subscribed", detail: tierOf(p), msg });
    case "resub":
      return feedAdd(from, { ...who, kind: "sub",
        text: joinDetail(["resubscribed", months(p.cumulative_months)]),
        detail: joinDetail([tierOf(p), p.streak_months ? `${p.streak_months} month streak` : ""]), msg });
    case "sub_gift":
      // One row for the community gift; its individual gifts stay quiet.
      if (p.community_gift_id) return;
      return feedAdd(from, { ...who, kind: "gift", count: 1,
        text: `gifted a sub to ${p.recipient_user_name || "someone"}`,
        detail: joinDetail([tierOf(p), p.cumulative_total ? `${p.cumulative_total} gifted in total` : ""]) });
    case "community_sub_gift":
      return feedAdd(from, { ...who, kind: "gift", count: p.total || 1,
        text: `gifted ${p.total || 1} subs`,
        detail: joinDetail([tierOf(p), p.cumulative_total ? `${p.cumulative_total} gifted in total` : ""]) });
    case "gift_paid_upgrade":
    case "prime_paid_upgrade":
      return feedAdd(from, { ...who, kind: "sub", text: "upgraded to a paid sub", detail: tierOf(p) });
    case "pay_it_forward":
      return feedAdd(from, { ...who, kind: "gift", text: "paid a gift sub forward" }, true);
    case "raid":
      return feedAdd(from, { ...who, kind: "raid",
        userId: p.user_id || who.userId, name: p.user_name || who.name, login: p.user_login || who.login,
        text: `raided with ${formatCount(p.viewer_count || 0)} viewers` });
    case "announcement":
      return feedAdd(from, { ...who, kind: "announce", text: "made an announcement", msg }, true);
    case "bits_badge_tier":
      return feedAdd(from, { ...who, kind: "bits", text: `earned the ${formatCount(p.tier || 0)} bits badge`, msg }, true);
    case "charity_donation": {
      const a = p.amount || {};
      const dp = a.decimal_place || 0;
      const val = a.value != null ? (a.value / Math.pow(10, dp)).toFixed(dp) : "";
      return feedAdd(from, { ...who, kind: "charity",
        text: ["donated", `${val} ${a.currency || ""}`.trim(), "to " + (p.charity_name || "charity")].filter(Boolean).join(" "),
        msg }, true);
    }
    // unraid and the rest aren't activity worth a row.
  }
}

function feedStamp(iso) {
  const t = new Date(iso);
  if (isNaN(t)) return "";
  const sameDay = t.toDateString() === new Date().toDateString();
  return sameDay
    ? t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: prefs.clock !== "24" })
    : t.toLocaleDateString([], { day: "numeric", month: "short" });
}

function feedMatches(item) {
  if (feedFilter === "all") return true;
  if (feedFilter === "sub") return item.kind === "sub" || item.kind === "gift";
  return item.kind === feedFilter;
}

function renderFeed() {
  if ($("dash-feed").hidden) return;
  const filters = $("feed-filters");
  filters.textContent = "";
  for (const [key, label, icon] of FEED_FILTERS) {
    const b = h("button", "ff" + (feedFilter === key ? " on" : ""));
    b.appendChild(svgUse(icon));
    b.appendChild(h("span", null, label));
    b.addEventListener("click", () => { feedFilter = key; renderFeed(); });
    filters.appendChild(b);
  }

  const list = $("feed-list");
  list.textContent = "";
  if (!active) return;

  if (followsNote && canMod()) list.appendChild(h("li", "feed-note", followsNote));

  const items = feedOf(active.id).filter(feedMatches);
  if (!items.length) {
    const empty = h("li", "feed-empty");
    empty.appendChild(h("b", null, "It's quiet. Too quiet…"));
    empty.appendChild(document.createTextNode(feedFilter === "all"
      ? "New follows, subs, cheers and raids will show up here."
      : "Nothing of that kind yet."));
    list.appendChild(empty);
    return;
  }
  for (const it of items) list.appendChild(feedRow(it));
}

function feedRow(it) {
  const li = h("li", "fi fi-" + it.kind + (it.userId ? " tap" : ""));
  const ico = h("span", "fi-ico");
  ico.appendChild(svgUse(FEED_ICON[it.kind] || "i-live"));
  li.appendChild(ico);

  const body = h("div", "fi-body");
  const line = h("div", "fi-line");
  if (it.name) line.appendChild(h("b", null, it.name + " "));
  line.appendChild(document.createTextNode(it.text));
  body.appendChild(line);
  if (it.detail) body.appendChild(h("div", "fi-detail", it.detail));
  if (it.msg) body.appendChild(h("div", "fi-msg", it.msg));
  li.appendChild(body);

  li.appendChild(h("span", "fi-time", feedStamp(it.at)));

  // Tap a person to moderate them, same sheet as chat.
  if (it.userId) {
    li.addEventListener("click", () => openSheetForUser({
      user_id: it.userId, user_name: it.name, user_login: it.login || "",
    }));
  }
  return li;
}

// ══ Stats ══════════════════════════════════════════════════════════
// The numbers on the dashboard header: live state and uptime, viewers,
// followers, subscribers, chat pace, plus what this session brought in.
// Polled from Helix — no socket needed — so a Stats widget is cheap.
const STATS_POLL_MS = 30000;
let stats = { chan: null, live: null, info: null, followers: null, subs: null, subPoints: null };
let statsPoll = null;
let statsTick = null;

function startStatsPoll() {
  clearInterval(statsPoll);
  clearInterval(statsTick);
  if (wantsStats() || feedSubs()) statsPoll = setInterval(loadStats, STATS_POLL_MS);
  if (wantsStats() || feedSubs() || wantsActions()) statsTick = setInterval(paintTick, 1000);
}
function stopStatsPoll() { clearInterval(statsPoll); clearInterval(statsTick); }

async function loadStats() {
  if (DEMO || !active || !me) return;
  const forChannel = active.id;
  if (stats.chan !== forChannel) {
    stats = { chan: forChannel, live: null, info: null, followers: null, subs: null, subPoints: null };
  }
  const mod = canMod();
  const seed = feedSubs() && mod;          // recent follows, so the feed isn't empty on open

  const [stream, info, followers, subs] = await Promise.all([
    api(`/streams?user_id=${forChannel}`).then((j) => (j.data && j.data[0]) || null).catch(() => undefined),
    api(`/channels?broadcaster_id=${forChannel}`).then((j) => (j.data && j.data[0]) || null).catch(() => null),
    mod ? api(`/channels/followers?broadcaster_id=${forChannel}&first=${seed ? 20 : 1}`).catch((e) => e) : null,
    active.self ? api(`/subscriptions?broadcaster_id=${forChannel}&first=1`).catch((e) => e) : null,
  ]);
  if (!active || active.id !== forChannel || stats.chan !== forChannel) return;   // switched away mid-flight

  if (stream !== undefined) stats.live = stream;
  if (info) stats.info = info;

  if (followers instanceof Error) {
    stats.followers = null;
    if (/scope|unauthorized|401|403/i.test(followers.message)) followsNote = "Sign out and connect again to see follows.";
  } else if (followers) {
    stats.followers = followers.total != null ? followers.total : null;
    followsNote = "";
    if (seed) {
      for (const f of followers.data || []) {
        feedInsert(forChannel, { kind: "follow", at: f.followed_at, key: "f:" + f.user_id,
          userId: f.user_id, name: f.user_name, login: f.user_login, text: "followed" });
      }
      feedOf(forChannel).sort((a, b) => new Date(b.at) - new Date(a.at));
    }
  }
  if (subs && !(subs instanceof Error)) {
    stats.subs = subs.total != null ? subs.total : null;
    stats.subPoints = subs.points != null ? subs.points : null;
  }

  // Keep the header and rail honest too.
  const c = channels.find((x) => x.id === forChannel);
  if (c && stream !== undefined) {
    c.live = !!stream;
    c.viewers = stream ? stream.viewer_count : null;
    paintHeadLive();
    renderChannels();
  }
  renderStats();
  renderFeed();
  renderActionGrid();
}

function fmtUptime(iso) {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso)) / 1000));
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  return `${hh}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}
function sessionText(s) {
  return `+${s.follows} follows · +${s.subs} subs · ${formatCount(s.bits)} bits`
    + (s.raids ? ` · ${s.raids} raid${s.raids === 1 ? "" : "s"}` : "");
}
function paintSession() {
  if (!active) return;
  for (const el of document.querySelectorAll(".stat-session")) el.textContent = sessionText(sessionOf(active.id));
}

// Once a second: the uptime clock, the chat pace, a raid countdown —
// in the panel and the strip alike.
function paintTick() {
  if (stats.live && stats.live.started_at) {
    for (const up of document.querySelectorAll(".stat-uptime")) up.textContent = fmtUptime(stats.live.started_at);
  }
  if (active) {
    for (const rate of document.querySelectorAll(".stat-rate")) rate.textContent = String(chatRate(active.id));
  }
  const rs = document.querySelector("#action-grid .raid-sub");
  if (rs) {
    const r = raidPending();
    if (!r) renderActionGrid();            // went out, or was cancelled elsewhere
    else rs.textContent = `Raiding ${r.name} · ${Math.max(0, Math.round((r.until - Date.now()) / 1000))}s`;
  }
}

// The strip: one row of pills across the top of the chat, the way the
// dashboard's own header does it.
function renderStatsStrip() {
  const strip = $("stats-strip");
  if (strip.hidden) return;
  strip.textContent = "";
  if (!active) return;

  const pill = (icon, value, label, cls) => {
    const p = h("span", "sp" + (cls ? " " + cls : ""));
    p.appendChild(svgUse(icon));
    p.appendChild(h("b", null, value));
    if (label) p.appendChild(h("span", null, label));
    strip.appendChild(p);
    return p;
  };

  const mine = stats.chan === active.id;
  const live = mine ? stats.live : null;
  const st = pill("i-bolt", live ? "Live" : mine ? "Offline" : "—", "", live ? "live" : "");
  if (live) st.appendChild(h("span", "stat-uptime", fmtUptime(live.started_at)));
  pill("i-eye", live ? formatCount(live.viewer_count || 0) : "—", "viewers");
  pill("i-heart", mine && stats.followers != null ? formatCount(stats.followers) : "—", "followers");
  if (active.self) pill("i-star", mine && stats.subs != null ? formatCount(stats.subs) : "—", "subs");
  if (wantsSocket()) pill("i-chat", String(chatRate(active.id)), "/ min").querySelector("b").classList.add("stat-rate");
  pill("i-live", sessionText(sessionOf(active.id)), "", "sess").querySelector("b").classList.add("stat-session");
}

function renderStats() {
  renderStatsStrip();
  if ($("dash-stats").hidden) return;
  const grid = $("stats-grid");
  grid.textContent = "";
  if (!active) return;

  const tile = (key, icon, value, sub, cls) => {
    const t = h("div", "stat" + (cls ? " " + cls : ""));
    const k = h("div", "stat-k");
    if (icon) k.appendChild(svgUse(icon));
    k.appendChild(document.createTextNode(key));
    t.appendChild(k);
    t.appendChild(h("div", "stat-v", value));
    if (sub) t.appendChild(h("div", "stat-s", sub));
    grid.appendChild(t);
    return t;
  };

  const mine = stats.chan === active.id;
  const live = mine ? stats.live : null;
  const status = tile("Status", "i-bolt", live ? "Live" : mine ? "Offline" : "—",
    live ? "" : mine ? "Not streaming" : "Loading…", live ? "live" : "");
  if (live) status.appendChild(h("div", "stat-s stat-uptime", fmtUptime(live.started_at)));

  tile("Viewers", "i-eye", live ? formatCount(live.viewer_count || 0) : "—", live ? "watching now" : "");
  tile("Followers", "i-heart", mine && stats.followers != null ? formatCount(stats.followers) : "—",
    !canMod() ? "Mods only" : followsNote ? "Reconnect to enable" : "total");
  if (active.self) {
    tile("Subscribers", "i-star", mine && stats.subs != null ? formatCount(stats.subs) : "—",
      mine && stats.subPoints != null ? `${formatCount(stats.subPoints)} sub points` : "");
  }
  // The column beside the chat has room for the headline numbers and the
  // session line; chat pace and the title belong to the Stats widget and
  // the strip, where there is room to read them.
  const compact = mode() === "full";
  if (!compact && wantsSocket()) {
    const t = tile("Chat", "i-chat", String(chatRate(active.id)), "messages / min");
    t.querySelector(".stat-v").classList.add("stat-rate");
  }

  const sess = tile("This session", "i-live", sessionText(sessionOf(active.id)), "since this widget opened", "stat-wide text");
  sess.querySelector(".stat-v").classList.add("stat-session");

  if (compact) return;
  const info = mine ? stats.info : null;
  tile("Now", "i-edit", info ? (info.title || "No title") : "—",
    info ? (info.game_name || "No category") : "", "stat-wide text");
}

// ══ Quick action tiles ═════════════════════════════════════════════
// The dashboard's quick actions as touch tiles: chat modes and Shield
// Mode for any channel you moderate, and the broadcaster set — stream
// info, clip, marker, ad break, raid — on your own.
let shield = null;          // {active, scope} once known
let shieldChan = null;      // channel the state belongs to

async function loadShield() {
  if (DEMO) return;
  if (!active || !me || !canMod()) { shield = null; shieldChan = null; return; }
  const forChannel = active.id;
  shieldChan = forChannel;
  shield = null;
  try {
    const j = await api(`/moderation/shield_mode?broadcaster_id=${forChannel}&moderator_id=${me.id}`);
    if (!active || active.id !== forChannel) return;
    const d = j.data && j.data[0];
    shield = { active: !!(d && d.is_active), scope: true };
  } catch (e) {
    if (!active || active.id !== forChannel) return;
    shield = { active: false, scope: !/scope/i.test(e.message) };
  }
  renderActionGrid();
}

async function setShield(on, tileEl) {
  tileEl.classList.toggle("on", on);       // optimistic — reverted if Twitch says no
  try {
    const j = await apiJSON(`/moderation/shield_mode?broadcaster_id=${active.id}&moderator_id=${me.id}`,
      "PUT", { is_active: on });
    const d = j.data && j.data[0];
    shield = { active: d ? !!d.is_active : on, scope: true };
    toast(shield.active ? "Shield Mode on" : "Shield Mode off");
  } catch (e) {
    shield = { active: !on, scope: !/scope/i.test(e.message) };
    toast(/scope/i.test(e.message) ? "Sign out and connect again to use Shield Mode" : e.message, true);
  }
  renderActionGrid();
}

function renderActionGrid() {
  if ($("dash-actions").hidden) return;
  const grid = $("action-grid");
  grid.textContent = "";
  if (!active) return;

  const tile = (icon, name, sub, cls) => {
    const b = h("button", "tile" + (cls ? " " + cls : ""));
    b.appendChild(svgUse(icon));
    const l = h("div", "tile-l");
    l.appendChild(h("div", "tile-name", name));
    l.appendChild(h("div", "tile-sub", sub || ""));
    b.appendChild(l);
    grid.appendChild(b);
    return b;
  };
  const head = (text) => grid.appendChild(h("div", "grid-head", text));

  const mod = canMod();
  if (mod) {
    head("Chat");
    for (const t of TOGGLES) {
      const on = !!(settings && settings[t.key]);
      let sub = settings ? (on ? "On" : "Off") : "…";
      if (on && t.key === "slow_mode" && settings.slow_mode_wait_time) sub = `${settings.slow_mode_wait_time}s between messages`;
      if (on && t.key === "follower_mode" && settings.follower_mode_duration) sub = `${settings.follower_mode_duration}m of following`;
      const b = tile(t.icon, t.label, sub, on ? "on" : "");
      b.addEventListener("click", () => {
        if (confirmTap(b, () => prefs.confirmQuickActions)) setMode(t.key, !on, b);
      });
    }

    const shieldSub = !shield ? "…" : !shield.scope ? "Reconnect to enable" : shield.active ? "On" : "Off";
    const sh = tile("i-shield", "Shield Mode", shieldSub, shield && shield.active ? "on" : "");
    sh.addEventListener("click", () => {
      if (shield && !shield.scope) return toast("Sign out and connect again to use Shield Mode", true);
      if (confirmTap(sh, () => prefs.confirmQuickActions)) setShield(!(shield && shield.active), sh);
    });

    const clear = tile("i-broom", "Clear chat", "Deletes every message", "danger");
    clear.addEventListener("click", () => { if (confirmTap(clear, () => true)) clearChat(); });
  }

  if (active.self) {
    head("Your stream");
    const cat = stats.chan === active.id && stats.info && stats.info.game_name;
    tile("i-edit", "Stream info", cat || "Title and category", "bc").addEventListener("click", openBroadcast);

    const clip = tile("i-clip", "Clip that", "The last moments", "bc");
    clip.addEventListener("click", () => {
      clip.disabled = true;
      createClip().finally(() => { clip.disabled = false; });
    });
    tile("i-marker", "Add marker", "For the highlighter", "bc").addEventListener("click", createMarker);

    const ad = tile("i-ad", "Run ad", "30s to 3 min", "bc");
    ad.addEventListener("click", (ev) => { ev.stopPropagation(); openAdMenu(ad); });

    const r = raidPending();
    const raid = tile("i-raid", r ? "Cancel raid" : "Raid", r ? `Raiding ${r.name}` : "Send viewers on", r ? "danger" : "bc");
    if (r) raid.querySelector(".tile-sub").classList.add("raid-sub");
    raid.addEventListener("click", () => {
      if (raidPending()) { if (confirmTap(raid, () => true)) cancelRaid(); }
      else { openBroadcast(); setTimeout(() => $("bc-raid-search").focus(), 200); }
    });
  }

  if (!mod && !active.self) {
    grid.appendChild(h("div", "grid-empty",
      "Nothing to do here — quick actions need a channel you moderate."));
  }
}

// Ad lengths as a small menu on the tile. Each length arms on the first
// tap and runs on the second, since an ad interrupts everyone watching.
function openAdMenu(trigger) {
  if (openMenu && openMenu.trigger === trigger) return closeMenu();
  closeMenu();
  const label = (len) => (len >= 60 ? `${len / 60} min` : `${len}s`);
  const menu = h("div", "dd-menu ad-menu");
  for (const len of AD_LENGTHS) {
    const item = h("button", "dd-item", label(len));
    item.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (!confirmTap(item, () => true)) { item.textContent = "Tap again · " + label(len); return; }
      closeMenu();
      runCommercial(len, true);
    });
    menu.appendChild(item);
  }
  document.body.appendChild(menu);
  const z = zoomOf(menu);
  const r = trigger.getBoundingClientRect();
  const width = Math.max(150, Math.round(r.width / z));
  menu.style.width = width + "px";
  menu.style.left = Math.max(10, Math.min(Math.round(r.left / z), innerWidth / z - width - 10)) + "px";
  const below = (innerHeight - r.bottom) / z;
  menu.style.top = (below < menu.offsetHeight + 8
    ? Math.round(r.top / z - menu.offsetHeight - 4) : Math.round(r.bottom / z + 4)) + "px";
  trigger.classList.add("open");
  openMenu = { trigger, menu };
}

// ══ Preferences panel ══════════════════════════════════════════════
const PREF_FIELDS = [
  { group: "This widget" },
  { key: "mode", label: "Widget type", type: "mode",
    info: "Add Twitchify to the screen more than once and give each copy a job — chat "
        + "here, the activity feed beside it, quick actions or stats in another tile. "
        + "Everything puts all of them in this one widget. iCUE's own settings for the "
        + "widget can set this too, and win when they do." },
  { key: "statsPlace", label: "Stats", type: "seg", fullOnly: true, options: [
      ["off", "Off"], ["panel", "Side panel"], ["strip", "Top strip"]],
    info: "Live state and uptime, viewers, followers, subscribers and chat pace. Side "
        + "panel puts them in a column beside the chat; Top strip runs them as a single "
        + "row across the top of the chat, like the dashboard header. Everything mode only." },
  { key: "feedPlace", label: "Activity feed", type: "seg", fullOnly: true, options: [
      ["off", "Off"], ["panel", "Side panel"], ["chat", "In chat"]],
    info: "Follows, subs, gifts, cheers and raids as they happen. Side panel lists them "
        + "beside the chat with filters; In chat drops follows, cheers and the stream going "
        + "live into the chat itself, alongside Twitch's own sub and raid notices. "
        + "Everything mode only." },
  { key: "actionsPlace", label: "Action tiles", type: "seg", fullOnly: true, options: [
      ["off", "Off"], ["panel", "Side panel"], ["bar", "Bottom bar"]],
    info: "Shield Mode, stream info, clip, marker, ad break and raid. Side panel shows "
        + "them as large tiles beside the chat, with the chat modes; Bottom bar adds them "
        + "as chips to the quick actions bar above the message box. Everything mode only." },
  { key: "customPlace", label: "Custom panel", type: "seg", fullOnly: true, options: [
      ["off", "Off"], ["panel", "Side panel"]],
    info: "One of your own panels from the Custom panels list below, framed beside the "
        + "chat. Everything mode only — as a widget type, Custom fills the whole tile." },
  { key: "panel", label: "Panel", type: "panel",
    info: "Which of your custom panels this copy of the widget shows. Each copy remembers "
        + "its own choice." },
  { key: "syncChannel", label: "Widgets follow each other", type: "switch",
    info: "With several Twitchify widgets on screen, switching channel in one switches "
        + "the others too. They always share the sign-in." },

  { group: "Custom panels" },
  { key: "customPanels", label: "Your panels", type: "panels",
    info: "Links to show as panels, like browser sources in OBS. Optional: leave empty "
        + "and nothing changes. Give each a name, then pick it as a widget type (Custom) "
        + "or place it beside the chat in Everything mode." },

  { group: "Connection" },
  { type: "watchstatus" },

  { group: "Layout" },
  { key: "layout", label: "Arrangement", type: "seg", options: [
      ["side", "Side"], ["top", "Stacked"], ["chat", "Chat"]] },
  { key: "showQuickActions", label: "Quick actions bar", type: "switch",
    info: "A row of chat-mode toggles above the message box — emote only, followers only, "
        + "subscribers only, unique messages, slow mode, and clear chat." },
  { key: "headerButtons", label: "Buttons in the header", type: "toggles",
    options: HEADER_BUTTONS.map(([k, label, , icon]) => [k, label, icon]),
    info: "Which controls sit in the chat header. Preferences always stays, and Chat "
        + "settings and Broadcast still only appear where they apply." },
  { key: "jumpLatest", label: "Jump to latest button", type: "switch",
    info: "While you're scrolled up in a chat, a button appears to drop back to the "
        + "newest message. Each split chat gets its own." },
  { key: "emoteSuggest", label: "Suggest emotes as I type", type: "switch",
    info: "Typing part of an emote name lists matches above the message box — arrows to "
        + "pick, Tab or Enter to complete. Needs BTTV / 7TV / FFZ emotes on." },
  { key: "qaLabels", label: "Labels on quick actions", type: "switch",
    info: "Text next to each quick-action icon. Turn off for a compact icon-only bar. "
        + "Labels also hide on their own when the widget is too narrow for them." },
  { key: "showComposer", label: "Message box", type: "switch",
    info: "Turn this off for a watch-and-moderate layout with no way to type." },
  { key: "showViewers", label: "Viewer list", type: "switch",
    info: "A panel listing everyone currently in chat. Tap someone to moderate them even "
        + "if they haven't said anything. Only works on channels you moderate." },
  { key: "showTabsInChat", label: "Channel tabs in Chat layout", type: "switch",
    info: "Adds a row of channel tabs so you can switch without opening the sidebar." },
  { key: "splitAddOnClick", label: "Picking a channel adds a chat", type: "switch",
    info: "While several chats are open side by side, choosing another channel opens it "
        + "alongside them instead of replacing them. Turn off to have it close the split "
        + "and open that channel on its own. You can also drag a channel into the chats." },
  { key: "channelSwitcher", label: "Channel dropdown in header", type: "switch",
    info: "Makes the channel name in the header tappable: a dropdown lists every channel "
        + "you can switch to, with live viewer counts. Works in every arrangement." },
  { key: "watchSync", label: "Channels open in my browser", type: "switch", helper: true,
    info: "Shows the channels you have open in your browser, so you can read their chat "
        + "here. Needs the Watch Sync extension and helper installed. Only channel names "
        + "are shared, and only with this widget on this PC." },
  { key: "showFollowed", label: "Channels I follow", type: "switch",
    info: "Adds the channels you follow on Twitch to the channel list and the header "
        + "dropdown. If it stays empty, sign out and connect again — older sign-ins "
        + "didn't ask for the follows permission." },
  { key: "followedOnlyLive", label: "Only live followed channels", type: "switch",
    info: "Shows only followed channels that are live right now, with their viewer "
        + "counts. Turn off to include offline channels too." },
  { key: "preloadWatched", label: "Keep watched channels loaded", type: "switch", helper: true, needsHelper: true,
    info: "Keeps reading chat for the channels you have open even while you're looking at "
        + "another one, so switching shows what you missed and unread counts appear. Limited "
        + "to a few channels at a time." },
  { key: "followActiveTab", label: "Follow the focused tab", type: "switch", helper: true, needsHelper: true,
    info: "Switches this widget to whichever Twitch tab you're looking at. Requires the "
        + "extension and helper to be running." },
  { key: "buttonSize", label: "Button size", type: "seg", options: [
      ["sm", "Small"], ["md", "Medium"], ["lg", "Large"]],
    info: "Sizes every button and icon. Larger is easier to hit accurately on a touchscreen." },
  { key: "selectedStyle", label: "Selected channel", type: "seg", options: [
      ["border", "Outline"], ["fill", "Filled"]],
    info: "How the channel you're viewing is marked — an accent outline, or a solid block." },

  { group: "Chat" },
  { key: "badgeStyle", label: "Badges", type: "seg", options: [
      ["images", "Real"], ["text", "Labels"], ["off", "Hide"]],
    info: "Real shows Twitch's own badge art — subs, VIP, prediction, event badges. Labels "
        + "shows short text like MOD instead, and only for the common ones." },
  { key: "density", label: "Density", type: "seg", options: [
      ["cosy", "Cosy"], ["compact", "Compact"]],
    info: "How tightly chat lines are packed. Compact fits more messages on screen with "
        + "less space between them." },
  { key: "showTimestamps", label: "Timestamps", type: "switch" },
  { key: "clock", label: "Clock", type: "seg", options: [["12", "12h"], ["24", "24h"]] },
  { key: "showChannelAvatar", label: "Channel picture in header", type: "switch",
    info: "The profile picture of the channel you're viewing, next to its name." },
  { key: "showChatAvatars", label: "Profile pictures in chat", type: "switch",
    info: "A small picture beside every chatter. Uses more room per message." },
  { key: "sharedChatSource", label: "Mark Stream Together messages", type: "switch",
    info: "During a Stream Together, chat from the other channels arrives here too. On, "
        + "each of those messages is tagged with the channel it came from; off, they read "
        + "as one shared conversation." },
  { key: "thirdPartyEmotes", label: "BTTV / 7TV / FFZ emotes", type: "switch",
    info: "Shows emotes from BetterTTV, 7TV and FrankerFaceZ. Twitch doesn't send these, so "
        + "without this they appear as plain words." },
  { key: "fontSize", label: "Text size", type: "range", min: 11, max: 20, step: 1, unit: "px",
    info: "Size of chat messages only. Everything else follows Button size." },
  { key: "alertMentions", label: "Highlight mentions", type: "switch",
    info: "Messages that @-mention you get a highlighted row, so they stand out in a fast chat." },
  { key: "alertKeywords", label: "Highlight keywords", type: "text", placeholder: "giveaway, my name, …",
    info: "Comma-separated words or phrases. A message containing any of them is highlighted, "
        + "whatever the case. Leave empty to highlight mentions only." },
  { key: "alertSound", label: "Alert sound", type: "select", options: ALERT_SOUNDS,
    test: (v) => alertSound(v, true),
    info: "Plays when a highlighted message arrives. The sounds are generated by the widget "
        + "— nothing is downloaded. At most one every couple of seconds, so a busy chat can't "
        + "machine-gun it. Tap Test to hear the current one." },

  { group: "Moderation" },
  { key: "timeouts", label: "Timeout buttons", type: "timeouts",
    info: "The timeout lengths offered when you moderate someone. Up to six." },
  { key: "inlineModActions", label: "Mod buttons on each message", type: "switch",
    info: "Delete, timeout and ban buttons on every message, so you don't have to open a "
        + "panel first. Only appears on channels you moderate." },
  { key: "confirmBan", label: "Confirm before banning", type: "switch",
    info: "Bans need a second tap to go through. Timeouts never ask." },
  { key: "confirmInlineActions", label: "Confirm mod buttons on messages", type: "switch",
    info: "The delete, timeout and ban buttons on each message ask for confirmation "
        + "instead of acting on the first tap." },
  { key: "confirmRow", label: "Confirm in a bar above the message box", type: "switch",
    info: "The confirmation appears as a Confirm / Cancel bar pinned above the message "
        + "box, naming the action and the user — so fast chat can't scroll it away. Turn "
        + "off to confirm by tapping the same button on the message again instead." },
  { key: "confirmQuickActions", label: "Confirm quick actions", type: "switch",
    info: "The chat-mode toggles and Clear in the quick actions bar arm on the first "
        + "tap and only act on a second tap within a few seconds." },
  { key: "showAutomod", label: "AutoMod queue", type: "switch",
    info: "A panel beside the chat listing the messages AutoMod is holding, each with Allow "
        + "and Deny. Also toggled by the shield button in the header, which shows how many "
        + "are waiting. Only on channels you moderate. If it says to sign out and connect "
        + "again, your sign-in predates the AutoMod permission." },
  { key: "automodNotices", label: "AutoMod holds in chat", type: "switch",
    info: "A line in the chat whenever AutoMod holds a message, so you notice even with the "
        + "queue closed. Tap the line to open the queue." },

  { group: "Appearance" },
  { key: "bg", label: "Background", type: "swatch", options: [
      ["#0a0a0c", "Black"], ["#141419", "Charcoal"], ["#12121c", "Midnight"],
      ["#0d1512", "Forest"]] },
  { key: "accent", label: "Accent", type: "swatch", options: [
      ["#9146ff", "Purple"], ["#00a865", "Green"], ["#4aa8ff", "Blue"],
      ["#ff4a80", "Pink"], ["#f59e0b", "Amber"]] },
  { key: "scrollbars", label: "Scrollbars", type: "switch",
    info: "Hide them for a cleaner look on a touchscreen. Lists still scroll by dragging, "
        + "and a mouse wheel still works." },
  { key: "transparency", label: "Transparency", type: "range", min: 0, max: 100, step: 5, unit: "%",
    info: "Makes the chat panel — the area holding messages and the message box — "
        + "see-through, so whatever sits behind the widget shows. At 100% only the text "
        + "and buttons remain." },
];

// A native <select> drops an OS-styled list that has nothing to do with
// the rest of the widget — light on Windows, and untouchable by CSS. This
// is a small popover that inherits the same surfaces.
let openMenu = null;

function closeMenu() {
  if (!openMenu) return;
  openMenu.menu.remove();
  openMenu.trigger.classList.remove("open");
  openMenu = null;
}
document.addEventListener("pointerdown", (e) => {
  if (openMenu && !openMenu.menu.contains(e.target) && !openMenu.trigger.contains(e.target)) closeMenu();
}, true);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenu(); });

function dropdown(options, value, onPick) {
  const trigger = h("button", "dd");
  const label = h("span", "dd-label", (options.find((o) => o[0] === value) || options[0])[1]);
  trigger.appendChild(label);
  trigger.appendChild(svgUse("i-chev", "dd-chev"));

  trigger.addEventListener("click", (ev) => {
    ev.stopPropagation();
    if (openMenu && openMenu.trigger === trigger) return closeMenu();
    closeMenu();

    const menu = h("div", "dd-menu");
    for (const [val, text] of options) {
      const item = h("button", "dd-item" + (val === value ? " on" : ""), text);
      item.addEventListener("click", (e2) => {
        e2.stopPropagation();
        value = val;
        label.textContent = text;
        closeMenu();
        onPick(val);
      });
      menu.appendChild(item);
    }

    // Fixed position so the menu escapes the dialog's scroll container;
    // flipped upward when there isn't room below.
    document.body.appendChild(menu);
    const z = zoomOf(menu);
    const r = trigger.getBoundingClientRect();
    const height = menu.offsetHeight;
    const below = (window.innerHeight - r.bottom) / z;
    menu.style.left = Math.round(r.left / z) + "px";
    menu.style.width = Math.round(r.width / z) + "px";
    menu.style.top = (below < height + 8 ? Math.round(r.top / z - height - 4) : Math.round(r.bottom / z + 4)) + "px";

    trigger.classList.add("open");
    openMenu = { trigger, menu };
  });

  return trigger;
}

// One tooltip element, parented to <body> so no dialog's stacking context
// can trap it. Hover shows it; a tap pins it until you tap elsewhere.
let tipEl = null;
let tipOwner = null;
let tipPinned = false;

function hideTip() {
  if (tipEl) tipEl.remove();
  tipEl = null;
  tipOwner = null;
  tipPinned = false;
}

function showTip(mark, text, pinned) {
  hideTip();
  tipOwner = mark;
  tipPinned = pinned;

  tipEl = h("div", "pref-tip", text);
  document.body.appendChild(tipEl);

  // Both rects are screen pixels; the tip's own offsets are in its
  // zoomed space, so convert at the end.
  const z = zoomOf(tipEl);
  const r = mark.getBoundingClientRect();
  const b = tipEl.getBoundingClientRect();
  const pad = 10;
  let left = r.left + r.width / 2 - b.width / 2;
  left = Math.max(pad, Math.min(left, innerWidth - b.width - pad));
  let top = r.top - b.height - 9;
  if (top < pad) top = r.bottom + 9;          // no room above
  tipEl.style.left = Math.round(left / z) + "px";
  tipEl.style.top = Math.round(top / z) + "px";
}

// A pinned tooltip stayed up forever; anything else on screen dismisses it.
document.addEventListener("pointerdown", (e) => {
  if (tipEl && (!tipOwner || !tipOwner.contains(e.target))) hideTip();
}, true);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") hideTip(); });

function renderPrefs() {
  const body = $("prefs-body");
  body.textContent = "";

  for (const f of PREF_FIELDS) {
    if (f.group) {
      body.appendChild(h("div", "pref-group", f.group));
      continue;
    }
    // Live connectivity, refreshed while the dialog is open: Twitch by
    // setStatus, helper and extension by pollHelper. Extension state is
    // only knowable through the helper, so a dead helper leaves it
    // "unknown", not "off".
    if (f.type === "watchstatus") {
      const row = h("div", "pref-row watch-status");
      const tile = (name, cls, state) => {
        const t = h("div", "ws-item" + (cls ? " " + cls : ""));
        t.appendChild(h("span", "ws-dot"));
        const col = h("div", "ws-col");
        col.appendChild(h("div", "ws-name", name));
        col.appendChild(h("div", "ws-state", state));
        t.appendChild(col);
        return t;
      };
      const tw = connState === "ok" ? ["ok", "Connected"]
        : connState === "working" ? ["warn", "Connecting…"]
        : connState === "bad" ? ["bad", "Trouble"]
        : ["", "Signed out"];
      row.appendChild(tile("Twitch", tw[0], tw[1]));
      row.appendChild(tile("Helper", helperUp ? "ok" : "", helperUp ? "Connected" : "Not running"));
      row.appendChild(tile("Extension", extUp ? "ok" : "", extUp ? "Connected" : helperUp ? "Not detected" : "Unknown"));
      if (!helperUp) {
        // Installed but not running: one tap asks Windows to start it.
        const start = h("button", "ghost small ws-start", "Start helper");
        start.title = "Starts the Watch Sync helper if it is installed. It then runs as long as iCUE does.";
        start.addEventListener("click", () => { start.textContent = "Starting…"; launchHelper(true); });
        row.appendChild(start);
      }
      body.appendChild(row);
      continue;
    }
    // The panel picker only means something once a panel can show.
    if (f.type === "panel" && !wantsCustom()) continue;

    // A long label beside a wide input collides; stack those instead.
    const row = h("div", "pref-row" + (f.type === "text" ? " stack" : ""));

    const label = h("span", "pref-label");
    label.appendChild(document.createTextNode(f.label));

    if (f.info) {
      // Hover explains it on a mouse; tapping does the same on a screen
      // that has no hover at all.
      const mark = h("button", "pref-info" + (f.helper ? " needs-setup" : ""));
      mark.appendChild(svgUse("i-info"));
      const text = f.info + (f.helper && !(f.key === "watchSync" ? helperUp : watchUp)
        ? "  ·  Helper not connected." : "");
      mark.addEventListener("mouseenter", () => showTip(mark, text, false));
      mark.addEventListener("mouseleave", () => { if (!tipPinned) hideTip(); });
      mark.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (tipPinned && tipOwner === mark) hideTip();
        else showTip(mark, text, true);
      });
      label.appendChild(mark);
    }
    row.appendChild(label);

    // A setting that cannot do anything until the helper is up should look
    // it, rather than silently doing nothing when switched on. The master
    // switch stays operable while ON so a dead helper can't trap it.
    if (f.needsHelper && !watchUp) row.classList.add("disabled");
    if (f.key === "watchSync" && !helperUp && !prefs.watchSync) row.classList.add("disabled");
    if (f.fullOnly && mode() !== "full") row.classList.add("disabled");

    if (f.type === "mode") {
      // Per placed widget, not a shared preference — and iCUE's own
      // control for the widget overrides it when set to anything.
      row.classList.add("stack");
      const forced = icueMode();
      const seg = h("div", "seg mode-seg");
      for (const [val, text] of MODES) {
        const b = h("button", "seg-btn" + (mode() === val ? " on" : ""), text);
        b.disabled = !!forced;
        b.addEventListener("click", () => {
          setWidgetMode(val);
          renderPrefs();               // the Everything-only rows follow
        });
        seg.appendChild(b);
      }
      row.appendChild(seg);
      if (forced) {
        row.appendChild(h("div", "pref-note",
          "Set to " + MODE_NAMES[forced] + " in iCUE's settings for this widget."));
      }

    } else if (f.type === "panel") {
      // Per placed widget, like the type. iCUE's own link field wins.
      const list = panelList();
      if (icuePanelUrl()) {
        row.appendChild(h("div", "pref-note", "Using the link set in iCUE's settings for this widget."));
      } else if (!list.length) {
        row.appendChild(h("div", "pref-note", "Add a panel under Custom panels below."));
      } else {
        const cur = currentPanel();
        const dd = dropdown(list.map((p) => [p.id, p.name || p.url]), cur ? cur.id : list[0].id, (id) => {
          inst.panel = id;
          saveInstance();
          applyPrefs();
        });
        dd.classList.add("panel-pick");
        row.appendChild(dd);
      }

    } else if (f.type === "panels") {
      // Name + link per row, edited in place; a bad link is marked, not
      // refused, so it can be finished.
      row.classList.add("stack");
      const box = h("div", "panels");
      const redraw = () => {
        box.textContent = "";
        if (!Array.isArray(prefs.customPanels)) prefs.customPanels = [];
        const list = prefs.customPanels;
        list.forEach((p, i) => {
          const line = h("div", "panel-row");
          const name = document.createElement("input");
          name.type = "text";
          name.className = "panel-name";
          name.placeholder = "Name";
          name.value = p.name || "";
          name.addEventListener("change", () => { p.name = name.value.trim(); setPref("customPanels", list); });
          line.appendChild(name);

          const url = document.createElement("input");
          url.type = "text";
          url.className = "panel-url";
          url.placeholder = "https://…";
          url.value = p.url || "";
          url.classList.toggle("bad", !!p.url && !validPanelUrl(p.url));
          url.addEventListener("change", () => {
            p.url = url.value.trim();
            url.classList.toggle("bad", !!p.url && !validPanelUrl(p.url));
            setPref("customPanels", list);
          });
          line.appendChild(url);

          const del = h("button", "timeout-del");
          del.appendChild(svgUse("i-x"));
          del.title = "Remove";
          del.addEventListener("click", () => {
            list.splice(i, 1);
            setPref("customPanels", list);
            redraw();
          });
          line.appendChild(del);
          box.appendChild(line);
        });
        if (list.length < 6) {
          const add = h("button", "timeout-add");
          add.appendChild(svgUse("i-plus"));
          add.appendChild(h("span", null, "Add panel"));
          add.addEventListener("click", () => {
            list.push({ id: "p" + Date.now().toString(36), name: "", url: "" });
            setPref("customPanels", list);
            redraw();
          });
          box.appendChild(add);
        }
        box.appendChild(h("div", "pref-note",
          "Works with anything made to be embedded — the links you'd paste into an OBS "
          + "browser source: StreamElements or Streamlabs overlays and alert boxes, goal bars, "
          + "a Twitch player embed. Ordinary pages such as the Twitch dashboard refuse to load "
          + "inside another page and stay blank."));
      };
      redraw();
      row.appendChild(box);

    } else if (f.type === "switch") {
      const sw = h("button", "switch" + (prefs[f.key] ? " on" : ""));
      sw.appendChild(h("span", "knob"));
      sw.addEventListener("click", () => {
        setPref(f.key, !prefs[f.key]);
        sw.classList.toggle("on", !!prefs[f.key]);
      });
      row.appendChild(sw);

    } else if (f.type === "toggles") {
      // A row of chips, each its own on/off — one switch per item would
      // cost nine rows for what reads fine as a single group.
      row.classList.add("stack");
      const box = h("div", "chip-set");
      const state = prefs[f.key] || {};
      for (const [key, label, icon] of f.options) {
        const b = h("button", "chip" + (state[key] !== false ? " on" : ""));
        if (icon) b.appendChild(svgUse(icon));
        b.appendChild(h("span", null, label));
        b.addEventListener("click", () => {
          const next = { ...(prefs[f.key] || {}) };
          next[key] = next[key] === false;
          setPref(f.key, next);
          b.classList.toggle("on", next[key] !== false);
        });
        box.appendChild(b);
      }
      row.appendChild(box);

    } else if (f.type === "seg") {
      const seg = h("div", "seg");
      for (const [val, text] of f.options) {
        const b = h("button", "seg-btn" + (prefs[f.key] === val ? " on" : ""), text);
        b.addEventListener("click", () => {
          setPref(f.key, val);
          for (const o of seg.children) o.classList.remove("on");
          b.classList.add("on");
        });
        seg.appendChild(b);
      }
      row.appendChild(seg);

    } else if (f.type === "swatch") {
      const box = h("div", "swatches");
      const preset = f.options.map((o) => o[0]);

      const mark = () => {
        for (const o of box.children) o.classList.remove("on");
        const i = preset.indexOf(prefs[f.key]);
        if (i >= 0) box.children[i].classList.add("on");
        else box.lastChild.classList.add("on");   // the custom well
      };

      for (const [val, name] of f.options) {
        const b = h("button", "swatch");
        b.style.background = val;
        b.title = name;
        b.addEventListener("click", () => { setPref(f.key, val); mark(); });
        box.appendChild(b);
      }

      // Anything the presets don't cover.
      const well = h("label", "swatch custom");
      well.title = "Custom colour";
      const picker = document.createElement("input");
      picker.type = "color";
      picker.value = prefs[f.key];
      picker.addEventListener("input", () => { setPref(f.key, picker.value); mark(); });
      well.style.background = preset.includes(prefs[f.key]) ? "" : prefs[f.key];
      well.appendChild(picker);
      box.appendChild(well);

      mark();
      row.appendChild(box);

    } else if (f.type === "range") {
      const wrap = h("div", "range-wrap");
      const val = h("span", "range-val", prefs[f.key] + (f.unit || ""));
      const input = document.createElement("input");
      input.type = "range";
      input.min = f.min; input.max = f.max; input.step = f.step;
      input.value = prefs[f.key];
      input.addEventListener("input", () => {
        val.textContent = input.value + (f.unit || "");
        setPref(f.key, Number(input.value));
      });
      wrap.appendChild(input);
      wrap.appendChild(val);
      row.appendChild(wrap);

    } else if (f.type === "timeouts") {
      row.classList.add("stack");
      const box = h("div", "timeouts");

      const redraw = () => {
        box.textContent = "";
        prefs.timeouts.forEach((t, i) => {
          const line = h("div", "timeout-row");

          const num = document.createElement("input");
          num.type = "number";
          num.min = "1";
          num.value = t.n;
          num.className = "timeout-n";
          num.addEventListener("change", () => {
            prefs.timeouts[i].n = Math.max(1, parseInt(num.value, 10) || 1);
            num.value = prefs.timeouts[i].n;
            setPref("timeouts", prefs.timeouts);
            renderTimeoutRow();
          });
          line.appendChild(num);

          const unit = dropdown(
            [["s", "seconds"], ["m", "minutes"], ["h", "hours"], ["d", "days"]],
            t.u,
            (u) => {
              prefs.timeouts[i].u = u;
              setPref("timeouts", prefs.timeouts);
              renderTimeoutRow();
            });
          unit.classList.add("timeout-u");
          line.appendChild(unit);

          const del = h("button", "timeout-del");
          del.appendChild(svgUse("i-x"));
          del.title = "Remove";
          del.addEventListener("click", () => {
            prefs.timeouts.splice(i, 1);
            setPref("timeouts", prefs.timeouts);
            redraw();
            renderTimeoutRow();
          });
          line.appendChild(del);

          box.appendChild(line);
        });

        if (prefs.timeouts.length < 6) {
          const add = h("button", "timeout-add");
          add.appendChild(svgUse("i-plus"));
          add.appendChild(h("span", null, "Add button"));
          add.addEventListener("click", () => {
            prefs.timeouts.push({ n: 5, u: "m" });
            setPref("timeouts", prefs.timeouts);
            redraw();
            renderTimeoutRow();
          });
          box.appendChild(add);
        }
      };

      redraw();
      row.appendChild(box);

    } else if (f.type === "text") {
      const input = document.createElement("input");
      input.type = "text";
      input.className = "pref-text";
      input.value = prefs[f.key] == null ? "" : String(prefs[f.key]);
      if (f.placeholder) input.placeholder = f.placeholder;
      input.addEventListener("change", () => setPref(f.key, input.value.trim()));
      row.appendChild(input);

    } else if (f.type === "select") {
      // The widget's own dropdown, with an optional Test button beside it
      // for settings you'd rather hear than read about.
      const wrap = h("div", "pref-select");
      wrap.appendChild(dropdown(f.options, prefs[f.key], (v) => setPref(f.key, v)));
      if (f.test) {
        const t = h("button", "ghost small pref-test", "Test");
        t.addEventListener("click", () => f.test(prefs[f.key]));
        wrap.appendChild(t);
      }
      row.appendChild(wrap);
    }

    body.appendChild(row);
  }
}

function resetPrefs() {
  prefs = { ...DEFAULT_PREFS };
  savePrefs();
  applyPrefs();
  renderPrefs();
  renderTimeoutRow();
}

// ══ Composer ═══════════════════════════════════════════════════════
async function send() {
  const input = $("in-message");
  const text = input.value.trim();
  if (!text || !active) return;
  input.value = "";
  try {
    const j = await apiJSON("/chat/messages", "POST", {
      broadcaster_id: active.id,
      sender_id: me.id,
      message: text,
    });
    // Twitch can accept the request but still drop the message (AutoMod,
    // or a chat restriction), which comes back as is_sent: false.
    const d = j.data && j.data[0];
    if (d && d.is_sent === false) {
      toast(d.drop_reason ? d.drop_reason.message : "Message not sent", true);
    }
  } catch (e) {
    input.value = text;
    toast(e.message, true);
  }
}

// ══ Wiring ═════════════════════════════════════════════════════════
// ══ Demo ═══════════════════════════════════════════════════════════
// A stream that isn't happening: an own channel live with a full chat,
// two moderated channels, a couple of follows, an activity feed and the
// numbers to go with them. Every network call is refused up front, so
// the whole thing renders from this data alone.
// Stand-in avatars: an initial on a flat colour, as a data URI, so the
// demo has faces without fetching anyone's real picture.
function demoAvatar(name, colour) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80">`
    + `<rect width="80" height="80" rx="18" fill="${colour}"/>`
    + `<text x="40" y="53" font-family="Segoe UI,sans-serif" font-size="38" font-weight="700"`
    + ` fill="#fff" text-anchor="middle">${name.slice(0, 1).toUpperCase()}</text></svg>`;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

function startDemo() {
  const now = Date.now();
  const at = (secAgo) => new Date(now - secAgo * 1000).toISOString();

  // Seed the cache first: every avatar is drawn from it, so nothing has to
  // be repainted afterwards.
  const faces = [
    ["d1", "streamer", "Streamer", "#9146ff"], ["d2", "novaplays", "NovaPlays", "#00a865"],
    ["d3", "kite", "Kite", "#4ad4c4"], ["d4", "pixelrush", "PixelRush", "#ff4a80"],
    ["d5", "aurorafm", "AuroraFM", "#f59e0b"],
    ["cmira_k", "mira_k", "mira_k", "#ff4a80"], ["cTTV_Jordan", "ttv_jordan", "TTV_Jordan", "#4aa8ff"],
    ["cNovaPlays", "novaplays", "NovaPlays", "#00a865"], ["cpxl", "pxl", "pxl", "#ffd24a"],
    ["cquietfox", "quietfox", "quietfox", "#8f7bff"], ["cSam", "sam", "Sam", "#5ad46a"],
    ["czed", "zed", "zed", "#ffa14a"], ["cKite", "kite", "Kite", "#4ad4c4"],
  ];
  for (const [id, login, name, colour] of faces) {
    userCache.set(id, { login, name, avatar: demoAvatar(name, colour) });
  }

  me = { id: "d1", login: "streamer", display_name: "Streamer" };
  channels = [
    { id: "d1", login: "streamer", name: "Streamer", self: true, mod: true, live: true, viewers: 1284 },
    { id: "d2", login: "novaplays", name: "NovaPlays", self: false, mod: true, live: true, viewers: 612 },
    { id: "d3", login: "kite", name: "Kite", self: false, mod: true, live: false },
  ];
  followed = [{ id: "d4", login: "pixelrush", name: "PixelRush" }, { id: "d5", login: "aurorafm", name: "AuroraFM" }];
  followedLive.set("d4", 2300);
  followedLive.set("d5", 148);
  followedError = null;
  settings = { emote_mode: false, follower_mode: true, follower_mode_duration: 10,
    subscriber_mode: false, unique_chat_mode: false, slow_mode: false, slow_mode_wait_time: null };
  shield = { active: false, scope: true };
  shieldChan = "d1";
  stats = { chan: "d1",
    live: { started_at: at(5025), viewer_count: 1284 },
    info: { title: "Ranked climb to Immortal — !drops on", game_name: "VALORANT" },
    followers: 12480, subs: 316, subPoints: 402 };
  sessions.set("d1", { follows: 14, subs: 3, bits: 1250, raids: 1 });
  for (let i = 0; i < 42; i++) chatTick("d1");
  viewers = ["NovaPlays", "Kite", "mira_k", "TTV_Jordan", "pxl", "quietfox", "Sam", "zed"]
    .map((n, i) => ({ user_id: "v" + i, user_name: n, user_login: n.toLowerCase() }));

  showApp(true);
  clearTrouble();
  setStatus("ok", "Connected", "Demo");
  applyPrefs();
  renderChannels();
  activateChannel(channels[0]);

  const chat = [
    ["mira_k", "#ff4a80", "that flick was insane", ["subscriber"]],
    ["TTV_Jordan", "#4aa8ff", "gg ez clap", []],
    ["NovaPlays", "#00a865", "chat be nice we're only 12 games in", ["moderator"]],
    ["pxl", "#ffd24a", "!drops", []],
    ["quietfox", "#8f7bff", "first time here, love the vibe", []],
    ["Sam", "#5ad46a", "what sens are you on?", ["vip"]],
    ["zed", "#ffa14a", "LETS GOOO", ["subscriber"]],
    ["mira_k", "#ff4a80", "@Sam 0.35 @ 800 i think", ["subscriber"]],
    ["TTV_Jordan", "#4aa8ff", "one more then bed?", []],
    ["Kite", "#4ad4c4", "raid incoming after this one", ["moderator"]],
    ["pxl", "#ffd24a", "W chat", []],
    ["quietfox", "#8f7bff", "followed! see you tomorrow", []],
  ];
  chat.forEach(([name, color, text, badges], i) => {
    const e = {
      message_id: "dm" + i, chatter_user_id: "c" + name, chatter_user_name: name, chatter_user_login: name.toLowerCase(),
      color, badges: badges.map((b) => ({ set_id: b, id: "1" })), broadcaster_user_id: "d1",
      message: { text, fragments: [{ type: "text", text }] }, _at: at((chat.length - i) * 20),
    };
    remember("d1", e);
    if (chatSurface()) addMessage(e);
  });

  const feed = [
    { kind: "raid", at: at(60), userId: "cKite", name: "Kite", login: "kite", text: "raided with 120 viewers" },
    { kind: "bits", at: at(140), userId: "cSam", name: "Sam", login: "sam", bits: 500, text: "cheered 500 bits", msg: "Cheer500 nice clutch" },
    { kind: "gift", at: at(300), userId: "cmira", name: "mira_k", login: "mira_k", count: 5, text: "gifted 5 subs", detail: "Tier 1 · 40 gifted in total" },
    { kind: "sub", at: at(420), userId: "czed", name: "zed", login: "zed", text: "resubscribed · 7 months", detail: "Tier 1 · 7 month streak", msg: "love the stream, keep it up" },
    { kind: "follow", at: at(600), userId: "cquiet", name: "quietfox", login: "quietfox", text: "followed" },
    { kind: "follow", at: at(900), userId: "cpxl", name: "pxl", login: "pxl", text: "followed" },
    { kind: "live", at: at(5025), text: "Stream went live" },
  ];
  for (const f of [...feed].reverse()) feedInsert("d1", f);

  renderModes();
  renderQuickActions();
  renderDash();
  if (prefs.showViewers) loadViewers();
}

$("btn-flow").addEventListener("click", connect);
$("btn-cancel").addEventListener("click", signOut);
$("btn-open").addEventListener("click", openVerify);
$("btn-copy").addEventListener("click", copyVerify);
let signOutArmed = null;
$("btn-signout").addEventListener("click", () => {
  const b = $("btn-signout");
  if (signOutArmed) {
    clearTimeout(signOutArmed);
    signOutArmed = null;
    closeSheet();
    return signOut();
  }
  b.textContent = "Tap again to sign out";
  b.classList.add("armed");
  signOutArmed = setTimeout(() => {
    signOutArmed = null;
    b.textContent = "Sign out";
    b.classList.remove("armed");
  }, 4000);
});
$("btn-retry").addEventListener("click", () => {
  clearTrouble();
  if (token && token.access_token) start();
  else connect();
});

$("btn-send").addEventListener("click", send);
$("in-message").addEventListener("keydown", (e) => { if (e.key === "Enter") send(); });

$("sheet-close").addEventListener("click", closeSheet);
$("settings-close").addEventListener("click", closeSheet);
$("scrim").addEventListener("click", closeSheet);
$("btn-clear-chat").addEventListener("click", clearChat);

$("btn-broadcast").addEventListener("click", openBroadcast);
$("bc-close").addEventListener("click", closeSheet);
$("bc-save").addEventListener("click", saveChannel);
$("bc-clip").addEventListener("click", createClip);
$("bc-marker").addEventListener("click", createMarker);
$("bc-raid-cancel").addEventListener("click", cancelRaid);
$("bc-cat-search").addEventListener("input", (e) => {
  clearTimeout(catTimer);
  const q = e.target.value.trim();
  catTimer = setTimeout(() => searchCategories(q), 300);
});
$("bc-raid-search").addEventListener("input", (e) => {
  clearTimeout(raidTimer);
  const q = e.target.value.trim();
  raidTimer = setTimeout(() => searchRaidTarget(q), 300);
});

// A vertical wheel doesn't move a horizontally scrolling strip on its own,
// and the stacked tab bar is exactly that.
$("channel-list").addEventListener("wheel", (e) => {
  const el = $("channel-list");
  if (el.scrollWidth <= el.clientWidth) return;      // nothing to pan
  if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
  el.scrollLeft += e.deltaY;
  e.preventDefault();
}, { passive: false });

$("btn-pins").addEventListener("click", () => {
  renderPinList();
  $("pin-results").textContent = "";
  $("pin-search").value = "";
  $("pins").hidden = false;
  $("scrim").hidden = false;
});
$("pins-close").addEventListener("click", closeSheet);
$("pin-search").addEventListener("input", (e) => {
  clearTimeout(pinTimer);
  const q = e.target.value.trim();
  pinTimer = setTimeout(() => searchPins(q), 300);
});

$("chat-title").addEventListener("click", (ev) => {
  if (!prefs.channelSwitcher) return;
  ev.stopPropagation();
  openChannelMenu();
});

$("btn-prefs").addEventListener("click", () => {
  renderPrefs();
  $("prefs").hidden = false;
  $("scrim").hidden = false;
});
$("prefs-close").addEventListener("click", closeSheet);
$("btn-prefs-reset").addEventListener("click", resetPrefs);
$("viewer-search").addEventListener("input", renderViewers);
$("btn-viewers").addEventListener("click", () => setPref("showViewers", !prefs.showViewers));
$("btn-automod").addEventListener("click", () => setPref("showAutomod", !prefs.showAutomod));
$("btn-open").addEventListener("click", () => { if (active) openOnTwitch(active.login); });
$("jump-latest").addEventListener("click", () => {
  const m = $("messages");
  setFollowing(m, true);
  pinToBottom(m);
});
$("in-message").addEventListener("input", updateEmotePop);
$("in-message").addEventListener("blur", () => setTimeout(closeEmotePop, 120));
$("in-message").addEventListener("keydown", emoteKeydown, true);
// Multi-chat's own entry point: the same channel menu, but reachable
// without the header dropdown being switched on.
$("btn-split").addEventListener("click", (ev) => {
  ev.stopPropagation();
  openSplitMenu();
});
function toggleRail(open) {
  const on = open === undefined ? !document.body.classList.contains("rail-open") : open;
  const was = document.body.classList.contains("rail-open");
  document.body.classList.toggle("rail-open", on);

  if (on) {
    $("rail-scrim").hidden = effectiveLayout() !== "chat";
  } else if (was) {
    // Let the rail slide back out before the scrim disappears.
    document.body.classList.add("rail-closing");
    hidePanel($("rail-scrim"));
    setTimeout(() => document.body.classList.remove("rail-closing"), CLOSE_MS);
  } else {
    $("rail-scrim").hidden = true;
  }
}
$("btn-rail").addEventListener("click", () => toggleRail());
$("rail-scrim").addEventListener("click", () => toggleRail(false));

$("btn-settings").addEventListener("click", () => {
  renderSettings();
  $("settings").hidden = false;
  $("scrim").hidden = false;
});

for (const b of document.querySelectorAll("#sheet [data-act]")) {
  b.addEventListener("click", () => runAction(b.dataset.act, Number(b.dataset.sec)));
}

// ══ Other Twitchify widgets on the same screen ═════════════════════
// Every placed copy shares one localStorage, so the sign-in is shared
// for free — and the storage event tells the others when something
// changed: a refreshed token, a preference, a channel switch, a sign-out.
window.addEventListener("storage", (ev) => {
  if (ev.storageArea !== localStorage) return;
  switch (ev.key) {
    case TOKEN_KEY: return onTokenElsewhere(ev.newValue);
    case PENDING_KEY: return onPendingElsewhere(ev.newValue);
    case PREFS_KEY:
      loadPrefs();
      if (me) applyPrefs();
      if (!$("prefs").hidden) renderPrefs();
      return;
    case LAST_CHANNEL_KEY:
      if (prefs.syncChannel && me && ev.newValue && (!active || active.id !== ev.newValue)) {
        followElsewhere(ev.newValue);
      }
      return;
    case RAID_KEY: renderRaid(); renderActionGrid(); return;
    case PINS_KEY: loadPins(); renderChannels(); renderPinList(); return;
  }
});

function onTokenElsewhere(raw) {
  if (!raw) {
    if (token) signOut();              // signed out in another widget
    return;
  }
  const had = !!(token && token.access_token);
  loadToken();                         // a refresh, or a fresh sign-in
  if (!had && token && token.access_token) {
    clearTimeout(polling);
    clearPending();
    start();
  }
}

// A sign-in begun in one widget shows its code in all of them.
function onPendingElsewhere(raw) {
  if (token || !raw) return;
  try {
    const p = JSON.parse(raw);
    if (p && Date.now() < p.deadline) { showApp(false); showPending(p); startPolling(p); }
  } catch {}
}

function followElsewhere(id) {
  // A chat widget running several chats side by side is left alone.
  if (splitActive() && !inSplit(id)) return;
  const c = channelById(id);
  if (c) return openChannel(c);
  fetchUsers([id]).then(() => {
    const c2 = channelById(id);
    if (c2 && prefs.syncChannel && (!active || active.id !== id)) openChannel(c2);
  });
}

// iCUE's per-widget control can change the role at any time, and the
// values it injects may only settle after boot.
// The handlers themselves are an inline, non-strict script in index.html,
// because iCUE wants a bare `icueEvents = {...}` assignment that strict
// code cannot make (and its validator only looks for it there). They
// forward here. Should that script be missing, fall back to the window
// property so nothing is lost.
if (!window.icueEvents) {
  window.icueEvents = {
    onICUEInitialized() { onIcueData(); },
    onDataUpdated() { onIcueData(); },
  };
}
// Generated by gen_mirror.py alongside the metas in index.html:
// [preference key, iCUE property name, kind, declared default].
const ICUE_MIRROR = [
  ["statsPlace", "twStatsPlace", "str", "panel"],
  ["feedPlace", "twFeedPlace", "str", "panel"],
  ["actionsPlace", "twActionsPlace", "str", "off"],
  ["customPlace", "twCustomPlace", "str", "off"],
  ["syncChannel", "twSyncChannel", "bool", true],
  ["layout", "twLayout", "str", "side"],
  ["buttonSize", "twButtonSize", "str", "md"],
  ["selectedStyle", "twSelectedStyle", "str", "border"],
  ["showQuickActions", "twShowQuickActions", "bool", true],
  ["qaLabels", "twQaLabels", "bool", true],
  ["showComposer", "twShowComposer", "bool", true],
  ["showViewers", "twShowViewers", "bool", false],
  ["showTabsInChat", "twShowTabsInChat", "bool", false],
  ["channelSwitcher", "twChannelSwitcher", "bool", true],
  ["splitAddOnClick", "twSplitAddOnClick", "bool", true],
  ["jumpLatest", "twJumpLatest", "bool", true],
  ["emoteSuggest", "twEmoteSuggest", "bool", true],
  ["showFollowed", "twShowFollowed", "bool", true],
  ["followedOnlyLive", "twFollowedOnlyLive", "bool", true],
  ["watchSync", "twWatchSync", "bool", false],
  ["preloadWatched", "twPreloadWatched", "bool", false],
  ["followActiveTab", "twFollowActiveTab", "bool", false],
  ["badgeStyle", "twBadgeStyle", "str", "images"],
  ["density", "twDensity", "str", "cosy"],
  ["fontSize", "twFontSize", "num", 14],
  ["clock", "twClock", "str", "12"],
  ["showTimestamps", "twShowTimestamps", "bool", false],
  ["showChannelAvatar", "twShowChannelAvatar", "bool", true],
  ["showChatAvatars", "twShowChatAvatars", "bool", false],
  ["sharedChatSource", "twSharedChatSource", "bool", true],
  ["thirdPartyEmotes", "twThirdPartyEmotes", "bool", true],
  ["alertMentions", "twAlertMentions", "bool", true],
  ["alertKeywords", "twAlertKeywords", "text", ""],
  ["alertSound", "twAlertSound", "str", "off"],
  ["inlineModActions", "twInlineModActions", "bool", false],
  ["confirmBan", "twConfirmBan", "bool", true],
  ["confirmInlineActions", "twConfirmInlineActions", "bool", false],
  ["confirmRow", "twConfirmRow", "bool", true],
  ["confirmQuickActions", "twConfirmQuickActions", "bool", false],
  ["showAutomod", "twShowAutomod", "bool", false],
  ["automodNotices", "twAutomodNotices", "bool", true],
  ["accent", "twAccent", "color", "#9146ff"],
  ["bg", "twBackground", "color", "#0a0a0c"],
  ["transparency", "twTransparency", "num", 0],
  ["scrollbars", "twScrollbars", "bool", true],
];

// ══ iCUE settings panel ↔ Preferences ═════════════════════════════
// Every preference in the dialog is also an x-icue-property, so it can
// be set from iCUE's panel. There is no way to write a value back to that
// panel, so the two editors are reconciled by diffing: a property whose
// panel value moved since this copy last looked wins; everything else
// keeps whatever the dialog last set. The first look is special — the
// panel shows its declared defaults, which say nothing about what the
// user chose in the dialog before this update, so only values already
// moved off their default count as edits then.
//
// Preferences are shared across copies of the widget (one localStorage)
// while the panel is per copy, so the snapshot is per copy too. The last
// edit anywhere wins and every copy follows, which is the sane reading.
function icueSeenKey() { return instanceKey() + "_seen"; }

function icueMirrorValue(kind, raw) {
  if (raw === undefined || raw === null) return undefined;
  if (kind === "bool") return raw === true || raw === "true";
  if (kind === "num") { const n = Number(raw); return Number.isFinite(n) ? n : undefined; }
  if (kind === "color") {
    const m = String(raw).trim().match(/^#([0-9a-f]{6})([0-9a-f]{2})?$|^#([0-9a-f]{2})([0-9a-f]{6})$/i);
    return m ? "#" + (m[1] || m[4]).toLowerCase() : undefined;
  }
  return String(raw);
}

// Fold the panel into `prefs`; true if anything moved.
function syncIcueSettings() {
  let seen = null;
  try { const raw = localStorage.getItem(icueSeenKey()); if (raw) seen = JSON.parse(raw); } catch {}
  const snapshot = {};
  let changed = false;
  for (const [pref, name, kind, def] of ICUE_MIRROR) {
    const v = icueMirrorValue(kind, icueProp(name));
    if (v === undefined) continue;                 // not running inside iCUE
    snapshot[name] = v;
    if (String(v) === String(prefs[pref])) continue;
    const moved = seen ? String(v) !== String(seen[name]) : String(v) !== String(def);
    if (moved) { prefs[pref] = v; changed = true; }
  }
  if (Object.keys(snapshot).length) {
    try { localStorage.setItem(icueSeenKey(), JSON.stringify(snapshot)); } catch {}
  }
  if (changed) savePrefs();
  return changed;
}

function onIcueData() {
  // Type, panel link, text sizes, colours and the mirrored preferences
  // are all read live, so fold them in and re-apply.
  syncIcueSettings();
  applyPrefs();
  if (!$("prefs").hidden) renderPrefs();
}
$("custom-reload").addEventListener("click", reloadCustom);
$("custom-open").addEventListener("click", () => {
  const p = currentPanel();
  if (p) openUrl(p.url);
});

loadPrefs();
loadInstance();
loadPins();
loadSplit();
loadLayouts();
applySize();
watchScroll($("messages"));
applyPrefs();

loadToken();
const pending = loadPending();
if (DEMO) {
  startDemo();
} else if (token && token.access_token) {
  start();
} else if (pending && Date.now() < pending.deadline) {
  // Reloaded while waiting on Twitch — pick the same code back up rather
  // than stranding an approval the user has already given.
  showApp(false);
  showPending(pending);
  startPolling(pending);
} else {
  clearPending();
  showApp(false);
  stage("idle");
  setStatus("idle", "Not connected", "Not signed in");
}
if (icueProp("iCUE_initialized")) onIcueData();
