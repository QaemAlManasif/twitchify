"""Screenshots of the widget in demo mode, for the thumbnails and the promo.

Uses the installed Chrome through Playwright (no browser download). The dev
server must be up:  python serve.py 5598 twitch-widget   (from the repo root)

    python shots.py [base-url]
"""

import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5598"
OUT = Path(__file__).parent / "public"

# name, width, height, mode, shared-preference overrides
SHOTS = [
    ("full",    2560, 720, "full",    {}),
    ("strip",   1920, 720, "full",    {"statsPlace": "strip", "feedPlace": "chat", "actionsPlace": "bar"}),
    ("chat",    1600, 720, "chat",    {}),
    ("feed",    1000, 720, "feed",    {}),
    ("actions", 1000, 720, "actions", {}),
    ("stats",   1000, 720, "stats",   {}),
    # Watch Sync: the rail carries a "Watching" section for the tab in the
    # browser. The tabs are injected after boot, the way the helper's stream
    # would deliver them.
    ("watching", 1500, 720, "chat", {"watchSync": True}, """
        // The real EventSource is retrying against a helper that isn't there,
        // and each failure resets watchUp. Stop it before staging the state.
        stopWatchSync();
        watchTabs = [{login: 'pixelrush', title: 'PixelRush - Twitch', active: true, focused: true}];
        loginToId.set('pixelrush', 'd4');
        watchUp = true;
        renderChannels();
    """),
]

# The extension's own popup, rendered from its file with the messaging stubbed.
POPUP = Path(__file__).resolve().parents[1] / "watch-extension" / "popup.html"
POPUP_STUB = """
window.chrome = { runtime: { sendMessage: (_m, cb) => cb({ helper: true, tabs: 1, clients: 2 }) } };
"""


def main():
    OUT.mkdir(exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=True)
        for shot in SHOTS:
            name, w, h, mode, prefs = shot[:5]
            after = shot[5] if len(shot) > 5 else None
            ctx = browser.new_context(viewport={"width": w, "height": h}, device_scale_factor=2)
            # Preferences are read from localStorage at boot, so seed them first.
            ctx.add_init_script(
                "localStorage.setItem('twitchmod_prefs', %s);" % json.dumps(json.dumps(prefs))
            )
            page = ctx.new_page()
            page.goto(f"{BASE}/?demo&mode={mode}&inst=shot-{name}", wait_until="networkidle")
            page.wait_for_timeout(1500)
            if after:
                page.evaluate(after)
                page.wait_for_timeout(600)
            page.screenshot(path=str(OUT / f"{name}.png"), full_page=False)
            print(f"{name}.png  {w}x{h}@2x  mode={mode}")
            ctx.close()

        # The extension popup, at its own size.
        ctx = browser.new_context(viewport={"width": 288, "height": 190}, device_scale_factor=3)
        ctx.add_init_script(POPUP_STUB)
        page = ctx.new_page()
        page.goto(POPUP.as_uri(), wait_until="load")
        page.wait_for_timeout(500)
        box = page.evaluate("() => { const b = document.body.getBoundingClientRect();"
                            " return {w: Math.ceil(b.width), h: Math.ceil(b.height)}; }")
        page.screenshot(path=str(OUT / "popup.png"),
                        clip={"x": 0, "y": 0, "width": box["w"], "height": box["h"]})
        print(f"popup.png  {box['w']}x{box['h']}@3x")
        ctx.close()
        browser.close()


if __name__ == "__main__":
    main()
