from __future__ import annotations

import argparse
import json
import mimetypes
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from work_planner.demo_payload import (
    DEFAULT_TARGET,
    DEMO_MONTH,
    DEMO_YEAR,
    archive_payload,
    month_payload,
)

LANDING = """<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>근무 계획 데모</title><style>body{font:16px system-ui;max-width:680px;margin:15vh auto;padding:24px;background:#0b0c0e;color:#eef0f4}a{display:inline-block;margin:12px 8px 0 0;padding:12px 18px;border:1px solid #596070;border-radius:8px;color:#eef0f4;text-decoration:none}</style><main><h1>근무 계획 데모</h1><p>합성 데이터로 동작하는 읽기 전용 데모입니다.</p><a href="/demo/">데모 보기</a><a href="/app/">로그인</a></main></html>"""


def _number(query: dict[str, list[str]], key: str, default: int, low: int, high: int) -> int:
    try:
        value = int(query.get(key, [str(default)])[0])
    except (TypeError, ValueError):
        value = default
    return max(low, min(high, value))


def route(method: str, path: str, query_string: str) -> tuple[int, dict[str, str], bytes | str]:
    if method != "GET":
        return 405, {"Content-Type": "text/plain; charset=utf-8", "Allow": "GET"}, "Method Not Allowed"
    if path == "/":
        return 200, {"Content-Type": "text/html; charset=utf-8"}, LANDING
    if path == "/demo/api/archive":
        return 200, {"Content-Type": "application/json; charset=utf-8"}, json.dumps(archive_payload(), ensure_ascii=False)
    if path == "/demo/api/month":
        query = parse_qs(query_string, keep_blank_values=True)
        year = _number(query, "year", DEMO_YEAR, DEMO_YEAR - 1, DEMO_YEAR)
        month = _number(query, "month", DEMO_MONTH, 1, 12)
        target = _number(query, "target", DEFAULT_TARGET, 60, 9000)
        normal = _number(query, "normal", 500, 60, 719)
        long = _number(query, "long", 719, normal, 719)
        short = _number(query, "short", 285, 60, normal)
        payload = month_payload(year, month, target, normal, long, short)
        return 200, {"Content-Type": "application/json; charset=utf-8"}, json.dumps(payload, ensure_ascii=False)
    return 404, {"Content-Type": "text/plain; charset=utf-8"}, "Not Found"


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
        self.wfile.write(body.encode() if isinstance(body, str) else body)

    def do_POST(self) -> None:
        status, headers, body = route("POST", urlsplit(self.path).path, "")
        self.send_response(status)
        for key, value in headers.items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body.encode() if isinstance(body, str) else body)

    def _file(self, path: Path, content_type: str | None = None) -> None:
        if not path.is_file():
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", content_type or mimetypes.guess_type(path.name)[0] or "application/octet-stream")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(path.read_bytes())

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
