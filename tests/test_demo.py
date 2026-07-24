from __future__ import annotations

import hashlib
import json
from pathlib import Path

from scripts.demo_server import Handler, route
from work_planner.demo_payload import DEMO_MONTH, DEMO_YEAR, archive_payload, month_payload


def test_current_demo_payload_supports_every_canonical_tab():
    payload = month_payload(DEMO_YEAR, DEMO_MONTH, target=3900, normal=500, long=719, short=285)

    assert payload["ok"] is True
    assert payload["dataOrigin"] == "synthetic"
    assert payload["ui"] == {
        "readOnly": True,
        "archiveMode": False,
        "targetConfiguration": {"enabled": True},
    }
    assert payload["days"] and payload["derived"] and payload["truth"]["current"]
    assert payload["sync"] and payload["notifications"]["items"]
    assert {item["key"] for item in payload["planner"]["comparisons"]} == {
        "target",
        "fixed_ot",
        "max",
    }
    assert payload["planner"]["plan"]["summary"]["weekly"]
    assert sum(bool(day["isToday"]) for day in payload["planner"]["plan"]["days"]) == 1


def test_demo_server_ignores_client_disconnect_during_write():
    handler = object.__new__(Handler)
    object.__setattr__(
        handler,
        "wfile",
        type(
            "Disconnected",
            (),
            {"write": lambda self, body: (_ for _ in ()).throw(BrokenPipeError())},
        )(),
    )

    handler._write(b"response")


def test_archive_payload_is_read_only_and_omits_planner():
    payload = month_payload(DEMO_YEAR, DEMO_MONTH - 1)

    assert payload["dataOrigin"] == "synthetic"
    assert payload["ui"]["archiveMode"] is True
    assert payload["ui"]["readOnly"] is True
    assert payload["ui"]["targetConfiguration"]["enabled"] is False
    assert "planner" not in payload
    assert archive_payload()["dataOrigin"] == "synthetic"


def test_archive_index_totals_match_month_detail_payloads():
    for item in archive_payload()["months"]:
        detail = month_payload(item["year"], item["month"])
        assert item["recognizedMinutes"] == detail["derived"]["recognizedMinutes"]


def test_demo_routes_are_exact_read_only_and_clamp_numeric_queries():
    status, headers, body = route("GET", "/demo/api/month", "year=x&month=99&target=-7")
    payload = json.loads(body)

    assert status == 200
    assert headers["Content-Type"] == "application/json; charset=utf-8"
    assert payload["year"] == DEMO_YEAR
    assert payload["month"] == DEMO_MONTH
    assert payload["dataOrigin"] == "synthetic"
    assert route("POST", "/demo/api/month", "")[0] == 405
    assert route("GET", "/api/month", "")[0] == 404
    assert route("GET", "/demo/api/not-a-route", "")[0] == 404
    assert route("GET", "/demo/api/archive", "")[0] == 200


def test_public_route_normalizes_target_below_recognized_total():
    status, _, body = route("GET", "/demo/api/month", "target=60")
    payload = json.loads(body)
    plan = payload["planner"]["plan"]

    assert status == 200
    assert plan["targetMinutes"] == plan["recognizedMinutes"]
    assert plan["recognizedMinutes"] + plan["plannedTotalMinutes"] + plan["gapMinutes"] == plan["targetMinutes"]


def test_future_month_route_is_not_returned_as_a_completed_archive():
    status, _, body = route("GET", "/demo/api/month", "year=2042&month=12")
    payload = json.loads(body)

    assert status == 200
    assert (payload["year"], payload["month"]) == (DEMO_YEAR, DEMO_MONTH)
    assert payload["ui"]["archiveMode"] is False
    assert payload["collectedAt"].startswith("2042-03-04")


def test_demo_route_tuning_changes_the_plan():
    default = json.loads(route("GET", "/demo/api/month", "target=7800")[2])
    tuned = json.loads(
        route("GET", "/demo/api/month", "target=7800&normal=60&long=60&short=60")[2]
    )

    default_plan = default["planner"]["plan"]
    tuned_plan = tuned["planner"]["plan"]
    assert tuned_plan["plannedTotalMinutes"] < default_plan["plannedTotalMinutes"]
    assert tuned_plan["days"] != default_plan["days"]


def test_demo_route_long_tuning_independently_changes_the_plan():
    shorter = json.loads(route("GET", "/demo/api/month", "target=7800&normal=500&long=500&short=285")[2])
    longer = json.loads(route("GET", "/demo/api/month", "target=7800&normal=500&long=719&short=285")[2])

    short_plan = shorter["planner"]["plan"]
    long_plan = longer["planner"]["plan"]
    assert short_plan["days"] != long_plan["days"]


def test_today_ledger_intervals_match_work_totals_and_bounds():
    payload = month_payload(DEMO_YEAR, DEMO_MONTH)
    today = next(day for day in payload["days"] if day["date"] == "2042-03-04")

    def minutes(value: str) -> int:
        hour, minute = map(int, value.split(":"))
        return hour * 60 + minute

    intervals = [interval_.split("–") for interval_ in today["intervals"]]
    duration = sum(minutes(end) - minutes(start) for start, end in intervals)
    assert duration == today["work_minutes"] == today["office_minutes"]
    assert intervals[0][0] == today["first_start"]
    assert intervals[-1][1] == today["last_end"]


def test_all_ledger_rows_match_work_rest_and_bounds():
    payload = month_payload(DEMO_YEAR, DEMO_MONTH)

    def minutes(value: str) -> int:
        hour, minute = map(int, value.split(":"))
        return hour * 60 + minute

    for day in payload["days"]:
        if not day["work_minutes"]:
            continue
        intervals = [interval_.split("–") for interval_ in day["intervals"]]
        worked = sum(minutes(end) - minutes(start) for start, end in intervals)
        span = minutes(day["last_end"]) - minutes(day["first_start"])
        assert worked == day["work_minutes"] == day["office_minutes"], day["date"]
        assert intervals[0][0] == day["first_start"]
        assert intervals[-1][1] == day["last_end"]
        assert span == worked + day["rest_minutes"], day["date"]


def test_today_action_is_derived_from_the_selected_day_plan():
    plan = month_payload(DEMO_YEAR, DEMO_MONTH, target=3900)["planner"]["plan"]
    action = plan["todayAction"]
    today = next(day for day in plan["days"] if day["date"] == action["date"])
    start, end = action["window"].split("–")
    start_minutes = int(start[:2]) * 60 + int(start[3:])
    end_minutes = int(end[:2]) * 60 + int(end[3:])

    assert action["workedMinutes"] == today["currentWorkedMinutes"]
    assert action["remainingTodayMinutes"] == today["plannedAdditionalMinutes"]
    assert action["workedMinutes"] + action["remainingTodayMinutes"] == today["plannedMinutes"]
    assert end_minutes - start_minutes == today["plannedMinutes"]


def test_every_recommended_window_duration_matches_planned_minutes():
    days = month_payload(DEMO_YEAR, DEMO_MONTH)["planner"]["plan"]["days"]

    def minutes(value: str) -> int:
        hour, minute = map(int, value.split(":"))
        return hour * 60 + minute

    for day in days:
        if day["window"] == "—":
            continue
        start, end = day["window"].split("–")
        assert minutes(end) - minutes(start) == day["plannedMinutes"], day["date"]


def test_root_landing_has_only_same_host_demo_and_login_choices():
    status, _, body = route("GET", "/", "")

    assert status == 200
    assert '<a href="/demo/">데모 보기</a>' in body
    assert '<a href="/app/">로그인</a>' in body
    assert "cookie" not in body.lower()
    assert "telemetry" not in body.lower()


def test_canonical_frontend_uses_only_demo_seams_and_discloses_origin():
    src = Path(__file__).resolve().parents[1] / "web" / "flex-work-schedule" / "src"
    lib = (src / "lib.ts").read_text(encoding="utf-8")
    main = (src / "main.tsx").read_text(encoding="utf-8")

    assert "const API_BASE = window.location.pathname.startsWith('/demo') ? '/demo/api' : '/api';" in lib
    assert "fetch(`${API_BASE}/month?${q}`" in lib
    assert "fetch(`${API_BASE}/archive`" in lib
    assert "__DEMO_TODAY__" in lib
    assert "합성 데이터" in main
    assert "dataOrigin" in main


def test_reviewed_canonical_frontend_manifest_is_immutable():
    root = Path(__file__).resolve().parents[1]
    public = root / "web" / "flex-work-schedule" / "src"
    manifest = json.loads((root / "web" / "flex-work-schedule" / "reviewed-src-manifest.json").read_text())
    files = {path.relative_to(public).as_posix() for path in public.rglob("*") if path.is_file()}

    assert files == set(manifest["files"])
    for relative, expected in manifest["files"].items():
        assert hashlib.sha256((public / relative).read_bytes()).hexdigest() == expected["publicSha256"], relative

    canonical = Path.home() / ".hermes/worktrees/flex-kil76-baseline/web/flex-work-schedule/src"
    if canonical.is_dir():
        canonical_files = {path.relative_to(canonical).as_posix() for path in canonical.rglob("*") if path.is_file()}
        assert canonical_files == files
        for relative, expected in manifest["files"].items():
            canonical_bytes = (canonical / relative).read_bytes()
            assert hashlib.sha256(canonical_bytes).hexdigest() == expected["canonicalSha256"], relative
            if not expected["seam"]:
                assert (public / relative).read_bytes() == canonical_bytes, relative
