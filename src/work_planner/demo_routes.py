from __future__ import annotations

import json

from .demo_payload import DEFAULT_TARGET, DEMO_MONTH, DEMO_YEAR, archive_payload, month_payload

LANDING = """<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>근무 계획 데모</title><style>body{font:16px system-ui;max-width:680px;margin:15vh auto;padding:24px;background:#0b0c0e;color:#eef0f4}a{display:inline-block;margin:12px 8px 0 0;padding:12px 18px;border:1px solid #596070;border-radius:8px;color:#eef0f4;text-decoration:none}</style><main><h1>근무 계획 데모</h1><p>합성 데이터로 동작하는 읽기 전용 데모입니다.</p><a href="/demo/">데모 보기</a><a href="/app/">로그인</a></main></html>"""


def _number(query: dict[str, list[str]], key: str, default: int, low: int, high: int) -> int:
    try:
        value = int(query.get(key, [str(default)])[0])
    except (TypeError, ValueError):
        value = default
    return max(low, min(high, value))


def _query(raw: str) -> dict[str, list[str]]:
    result: dict[str, list[str]] = {}
    for item in raw.split("&"):
        key, separator, value = item.partition("=")
        if separator:
            result.setdefault(key, []).append(value)
    return result


def route(method: str, path: str, query_string: str) -> tuple[int, dict[str, str], bytes | str]:
    if method != "GET":
        return 405, {"Content-Type": "text/plain; charset=utf-8", "Allow": "GET"}, "Method Not Allowed"
    if path == "/":
        return 200, {"Content-Type": "text/html; charset=utf-8"}, LANDING
    if path == "/demo/api/archive":
        return 200, {"Content-Type": "application/json; charset=utf-8"}, json.dumps(archive_payload(), ensure_ascii=False)
    if path == "/demo/api/month":
        query = _query(query_string)
        year = _number(query, "year", DEMO_YEAR, DEMO_YEAR - 1, DEMO_YEAR)
        month = _number(query, "month", DEMO_MONTH, 1, 12)
        target = _number(query, "target", DEFAULT_TARGET, 60, 9000)
        normal = _number(query, "normal", 500, 285, 719)
        long = _number(query, "long", 719, normal, 719)
        short = _number(query, "short", 285, 285, normal)
        payload = month_payload(year, month, target, normal, long, short)
        return 200, {"Content-Type": "application/json; charset=utf-8"}, json.dumps(payload, ensure_ascii=False)
    return 404, {"Content-Type": "text/plain; charset=utf-8"}, "Not Found"
