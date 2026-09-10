"""Mirror every in-widget preference into iCUE's widget settings panel.

Generates the <meta name="x-icue-property"> declarations and the x-icue-groups
list in twitch-widget/index.html, and the matching ICUE_MIRROR table in
twitch-widget/scripts/main.js, from the one table below - so the two can't
drift. Run from the repo root:  python gen_mirror.py
"""

import io
import json
import re

# (pref key, iCUE property name, kind, default, label, options / slider spec)
# kind: bool | str | num | color | text
G = {}
G["Dashboard"] = [
    ("statsPlace", "statsPlace", "str", "panel", "Stats",
     [("off", "Off"), ("panel", "Side panel"), ("strip", "Top strip")]),
    ("feedPlace", "feedPlace", "str", "panel", "Activity feed",
     [("off", "Off"), ("panel", "Side panel"), ("chat", "In chat")]),
    ("actionsPlace", "actionsPlace", "str", "off", "Action tiles",
     [("off", "Off"), ("panel", "Side panel"), ("bar", "Bottom bar")]),
    ("customPlace", "customPlace", "str", "off", "Custom panel",
     [("off", "Off"), ("panel", "Side panel")]),
    ("syncChannel", "syncChannel", "bool", True, "Widgets follow each other", None),
]
G["Layout"] = [
    ("layout", "layout", "str", "side", "Arrangement",
     [("side", "Side"), ("top", "Stacked"), ("chat", "Chat")]),
    ("buttonSize", "buttonSize", "str", "md", "Button size",
     [("sm", "Small"), ("md", "Medium"), ("lg", "Large")]),
    ("selectedStyle", "selectedStyle", "str", "border", "Selected channel",
     [("border", "Outline"), ("fill", "Filled")]),
    ("showQuickActions", "showQuickActions", "bool", True, "Quick actions bar", None),
    ("qaLabels", "qaLabels", "bool", True, "Labels on quick actions", None),
    ("showComposer", "showComposer", "bool", True, "Message box", None),
    ("showViewers", "showViewers", "bool", False, "Viewer list", None),
    ("showTabsInChat", "showTabsInChat", "bool", False, "Channel tabs in Chat layout", None),
    ("channelSwitcher", "channelSwitcher", "bool", True, "Channel dropdown in header", None),
    ("splitAddOnClick", "splitAddOnClick", "bool", True, "Picking a channel adds a chat", None),
    ("jumpLatest", "jumpLatest", "bool", True, "Jump to latest button", None),
    ("emoteSuggest", "emoteSuggest", "bool", True, "Suggest emotes as I type", None),
    ("showFollowed", "showFollowed", "bool", True, "Channels I follow", None),
    ("followedOnlyLive", "followedOnlyLive", "bool", True, "Only live followed channels", None),
    ("watchSync", "watchSync", "bool", False, "Channels open in my browser (needs helper)", None),
    ("preloadWatched", "preloadWatched", "bool", False, "Keep watched channels loaded", None),
    ("followActiveTab", "followActiveTab", "bool", False, "Follow the focused tab", None),
]
G["Chat"] = [
    ("badgeStyle", "badgeStyle", "str", "images", "Badges",
     [("images", "Real"), ("text", "Labels"), ("off", "Hide")]),
    ("density", "density", "str", "cosy", "Density",
     [("cosy", "Cosy"), ("compact", "Compact")]),
    ("fontSize", "fontSize", "num", 14, "Chat text size",
     {"min": 11, "max": 20, "step": 1, "unit": "px"}),
    ("clock", "clock", "str", "12", "Clock", [("12", "12h"), ("24", "24h")]),
    ("showTimestamps", "showTimestamps", "bool", False, "Timestamps", None),
    ("showChannelAvatar", "showChannelAvatar", "bool", True, "Channel picture in header", None),
    ("showChatAvatars", "showChatAvatars", "bool", False, "Profile pictures in chat", None),
    ("sharedChatSource", "sharedChatSource", "bool", True, "Mark Stream Together messages", None),
    ("thirdPartyEmotes", "thirdPartyEmotes", "bool", True, "BTTV / 7TV / FFZ emotes", None),
    ("alertMentions", "alertMentions", "bool", True, "Highlight mentions", None),
    ("alertKeywords", "alertKeywords", "text", "", "Highlight keywords (comma separated)", None),
    ("alertSound", "alertSound", "str", "off", "Alert sound",
     [("off", "Off"), ("ping", "Ping"), ("pop", "Pop"), ("chime", "Chime"), ("knock", "Knock")]),
]
G["Moderation"] = [
    ("inlineModActions", "inlineModActions", "bool", False, "Mod buttons on each message", None),
    ("confirmBan", "confirmBan", "bool", True, "Confirm before banning", None),
    ("confirmInlineActions", "confirmInlineActions", "bool", False, "Confirm mod buttons on messages", None),
    ("confirmRow", "confirmRow", "bool", True, "Confirm in a bar above the message box", None),
    ("confirmQuickActions", "confirmQuickActions", "bool", False, "Confirm quick actions", None),
    ("showAutomod", "showAutomod", "bool", False, "AutoMod queue", None),
    ("automodNotices", "automodNotices", "bool", True, "AutoMod holds in chat", None),
]
# accentColor / backgroundColor / transparency are reserved by iCUE for the
# screen's personalisation, hence the tw* names here.
G["Appearance"] = [
    ("accent", "twAccent", "color", "#9146ff", "Accent", None),
    ("bg", "twBackground", "color", "#0a0a0c", "Background", None),
    ("transparency", "twTransparency", "num", 0, "Transparency",
     {"min": 0, "max": 100, "step": 5, "unit": "%"}),
    ("scrollbars", "scrollbars", "bool", True, "Scrollbars", None),
]

Q = "'"  # JS string quote inside a double-quoted HTML attribute


def meta(pref, name, kind, default, label, extra):
    lab = Q + label.replace(Q, "") + Q
    head = '  <meta name="x-icue-property" content="%s" data-label="%s"' % (name, lab)
    if kind == "bool":
        return head + ' data-type="switch" data-default="%s" />' % str(default).lower()
    if kind == "num":
        return head + (' data-type="slider" data-default="%s" data-min="%s" data-max="%s" '
                       'data-step="%s" data-unit-label="%s%s%s" />'
                       % (default, extra["min"], extra["max"], extra["step"], Q, extra["unit"], Q))
    if kind == "color":
        return head + ' data-type="color" data-default="%s%s%s" />' % (Q, default, Q)
    if kind == "text":
        return head + ' data-type="textfield" data-default="%s%s%s" />' % (Q, default, Q)
    vals = ",".join("{%skey%s:%s%s%s,%svalue%s:%s%s%s}" % (Q, Q, Q, k, Q, Q, Q, Q, v, Q) for k, v in extra)
    return head + (' data-type="combobox" data-default="%s%s%s"\n        data-values="[%s]" />'
                   % (Q, default, Q, vals))


def main():
    lines = [
        "  <!-- Every preference in the widget's own dialog, mirrored here so it can",
        "       be set from iCUE's panel too. Generated by gen_mirror.py, which also",
        "       writes the matching ICUE_MIRROR table in main.js. -->",
    ]
    groups = []
    for g, items in G.items():
        lines.append("  <!-- %s -->" % g)
        for it in items:
            lines.append(meta(*it))
        groups.append((g, [it[1] for it in items]))

    p = "twitch-widget/index.html"
    s = io.open(p, encoding="utf-8").read()
    start = s.index("  <!-- Text size, per placed widget")
    if "<!-- Every preference in the widget" in s:
        start = s.index("  <!-- Every preference in the widget")
    gi = s.index('  <script type="application/json" id="x-icue-groups">')
    ge = s.index("</script>", gi) + len("</script>")
    text_size_start = s.index("  <!-- Text size, per placed widget")
    keep = s[text_size_start:gi]  # the text-size and colour metas, unchanged

    tr = lambda t: "tr(" + Q + t + Q + ")"
    gl = ['  <script type="application/json" id="x-icue-groups">', "    ["]
    gl.append('      { "title": "%s", "properties": ["widgetMode", "panelUrl"],' % tr("Twitchify"))
    gl.append('        "info": "%s" },' % tr("Add Twitchify more than once and give each copy a job. A custom panel "
                                             "link (an overlay or alert box made to be embedded, as in an OBS browser "
                                             "source) makes this copy show that page."))
    for g, props in groups:
        gl.append('      { "title": "%s%s%s", "properties": %s },' % (Q, g, Q, json.dumps(props)))
    gl.append('      { "title": "%s", "properties": ["textScale", "fsChat", "fsChannels", "fsControls", "fsDash"],'
              % tr("Text size"))
    gl.append('        "info": "%s" },' % tr("Overall applies to everything; the others stack on top of it for one "
                                             "area each. Chat text has its own pixel size under Preferences as well."))
    gl.append('      { "title": "%s", "properties": ["followIcueColors", "accentColor", "backgroundColor", "transparency"],'
              % tr("Colours"))
    gl.append('        "info": "%s" }' % tr("On, the accent, background and transparency follow the colours set for "
                                            "this screen in iCUE instead of the ones chosen under Preferences."))
    gl.append("    ]")
    gl.append("  </script>")

    s = s[:start] + "\n".join(lines) + "\n" + keep + "\n".join(gl) + s[ge:]
    io.open(p, "w", encoding="utf-8", newline="\n").write(s)

    rows = []
    for g, items in G.items():
        for pref, name, kind, default, label, extra in items:
            rows.append('  ["%s", "%s", "%s", %s],' % (pref, name, kind, json.dumps(default)))
    js = ("// Generated by gen_mirror.py alongside the metas in index.html:\n"
          "// [preference key, iCUE property name, kind, declared default].\n"
          "const ICUE_MIRROR = [\n" + "\n".join(rows) + "\n];\n")
    p = "twitch-widget/scripts/main.js"
    m = io.open(p, encoding="utf-8").read()
    if "const ICUE_MIRROR" in m:
        m = re.sub(r"// Generated by gen_mirror\.py.*?\n\];\n", js, m, flags=re.S)
    else:
        anchor = "function onIcueData() {"
        assert m.count(anchor) == 1
        m = m.replace(anchor, js + "\n" + anchor)
    io.open(p, "w", encoding="utf-8", newline="\n").write(m)
    print("mirrored %d preferences in %d groups" % (sum(len(v) for v in G.values()), len(G)))


if __name__ == "__main__":
    main()
