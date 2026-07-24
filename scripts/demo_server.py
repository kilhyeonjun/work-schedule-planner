from __future__ import annotations

import argparse
import mimetypes
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from work_planner.demo_routes import route


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        request = urlsplit(self.path)
        status, headers, body = route("GET", request.path, request.query)
        if status == 404 and (request.path == "/demo" or request.path == "/demo/"):
            self._file(ROOT / "web" / "flex-work-schedule" / "dist" / "index.html", "text/html; charset=utf-8")
            return
        if status == 404 and request.path.startswith("/demo/assets/"):
            name = request.path.removeprefix("/demo/assets/")
            if name and "/" not in name and "\\" not in name:
                self._file(ROOT / "web" / "flex-work-schedule" / "dist" / "assets" / name)
                return
        self.send_response(status)
        for key, value in headers.items():
            self.send_header(key, value)
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self._write(body.encode() if isinstance(body, str) else body)

    def do_POST(self) -> None:
        status, headers, body = route("POST", urlsplit(self.path).path, "")
        self.send_response(status)
        for key, value in headers.items():
            self.send_header(key, value)
        self.end_headers()
        self._write(body.encode() if isinstance(body, str) else body)

    def _file(self, path: Path, content_type: str | None = None) -> None:
        if not path.is_file():
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", content_type or mimetypes.guess_type(path.name)[0] or "application/octet-stream")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self._write(path.read_bytes())

    def _write(self, body: bytes) -> None:
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def log_message(self, format: str, *args: object) -> None:
        print(f"{self.address_string()} - {format % args}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Read-only synthetic work-planner demo")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=18787)
    args = parser.parse_args()
    ThreadingHTTPServer((args.host, args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
