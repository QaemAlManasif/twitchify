"""Dev static server for the widget.

Plain http.server lets the browser cache scripts/main.js, so edits appear to
have no effect and you end up debugging stale code. This sends no-store on
everything.

    python serve.py [port] [directory]
"""

import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5599
    directory = sys.argv[2] if len(sys.argv) > 2 else "twitch-widget"
    handler = partial(NoCacheHandler, directory=directory)
    print(f"serving {directory} on http://localhost:{port} (no-store)", flush=True)
    # Threaded: a single-threaded server stalls completely the moment one
    # connection is held open, which looks exactly like the page hanging.
    server = ThreadingHTTPServer(("127.0.0.1", port), handler)
    server.daemon_threads = True
    server.serve_forever()
