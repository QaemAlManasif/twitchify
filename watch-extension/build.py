"""Package the extension for both stores.

    python build.py

Chrome and Firefox share every file except the manifest: Firefox's MV3 runs
the background script as an event page ("scripts"), Chrome as a service
worker, and Firefox needs an add-on id under browser_specific_settings.
Both zips land next to this folder.
"""

import json
import os
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.dirname(HERE)
FILES = ["background.js", "popup.html", "popup.js",
         "icons/icon16.png", "icons/icon32.png", "icons/icon48.png", "icons/icon128.png"]


def build(name, manifest):
    with open(os.path.join(HERE, manifest), encoding="utf-8") as f:
        version = json.load(f)["version"]
    target = os.path.join(OUT, f"twitchify-watch-sync-{name}-{version}.zip")
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as z:
        z.write(os.path.join(HERE, manifest), "manifest.json")
        for rel in FILES:
            z.write(os.path.join(HERE, rel), rel)
    print("wrote", os.path.relpath(target, OUT), "from", manifest)


if __name__ == "__main__":
    build("chrome", "manifest.json")
    build("firefox", "manifest.firefox.json")
