"""Package the extension for both stores.

    python build.py

Chrome and Firefox share every file except the manifest: Firefox's MV3 runs
the background script as an event page ("scripts"), Chrome as a service
worker, and Firefox needs an add-on id under browser_specific_settings.
Both zips land next to this folder.
"""

import json
import os
import struct
import zipfile
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.dirname(HERE)
FILES = ["background.js", "popup.html", "popup.js",
         "icons/icon16.png", "icons/icon32.png", "icons/icon48.png", "icons/icon128.png"]

PNG_SIGNATURE = bytes([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])


def check_png(path):
    """Refuse to package a PNG whose chunk checksums don't match.

    Pillow ignores a bad CRC and decodes the image anyway, so a file can
    look perfect in every local check and still be rejected by Chrome,
    whose decoder won't open it. That shipped once: icon32.png had a bad
    IDAT checksum and the store install failed with "Could not decode
    image". Verify every chunk here instead of trusting a lenient decoder.
    """
    d = open(path, "rb").read()
    if d[:8] != PNG_SIGNATURE:
        raise SystemExit("ABORT - not a PNG: " + path)
    pos = 8
    while pos < len(d):
        ln = struct.unpack(">I", d[pos:pos + 4])[0]
        typ = d[pos + 4:pos + 8]
        body = d[pos + 8:pos + 8 + ln]
        crc = struct.unpack(">I", d[pos + 8 + ln:pos + 12 + ln])[0]
        if zlib.crc32(typ + body) & 0xFFFFFFFF != crc:
            raise SystemExit("ABORT - bad %s checksum in %s; Chrome will refuse to decode it"
                             % (typ.decode("latin1"), path))
        pos += 12 + ln
        if typ == b"IEND":
            return
    raise SystemExit("ABORT - no IEND chunk in " + path)


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
    for rel in FILES:
        if rel.endswith(".png"):
            check_png(os.path.join(HERE, rel))
    build("chrome", "manifest.json")
    build("firefox", "manifest.firefox.json")
