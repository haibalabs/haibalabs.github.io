"""Local test server; stream an optional canonical snapshot without a large test RPC."""
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]
SNAPSHOT = os.environ.get('CANONICAL_SNAPSHOT')


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def translate_path(self, path):
        if SNAPSHOT and urlsplit(path).path == '/history/canonical-t2.json':
            return str(Path(SNAPSHOT).resolve())
        return super().translate_path(path)


if __name__ == '__main__':
    raw_port = os.environ.get('PORT', '')
    try:
        if not raw_port.isascii() or not raw_port.isdecimal():
            raise ValueError
        port = int(raw_port)
        if not 1024 <= port <= 65535:
            raise ValueError
    except ValueError:
        raise SystemExit('Set PORT to an unused integer from 1024 to 65535.')
    ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever()
