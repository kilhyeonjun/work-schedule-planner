"""Opt-in process transport; environment/process access stays outside the pure core."""
from __future__ import annotations

import atexit
import builtins
import dataclasses
import functools
import json
import os
import subprocess
import threading
from pathlib import Path

_lock = threading.Lock()
_process: subprocess.Popen | None = None


def _close():
    global _process
    if _process is not None:
        _process.stdin.close()
        _process.wait()
        _process.stdout.close()
        _process = None


atexit.register(_close)


def call(op: str, **args):
    """Call the library CLI; never build, download, or fall back to Python."""
    global _process
    with _lock:
        if _process is None:
            root = Path(__file__).resolve().parents[2]
            binary = os.environ.get("WORK_PLANNER_RUST_BIN")
            if binary is None:
                release = root / "target" / "release" / "work-planner-cli"
                binary = str(release if release.is_file() else root / "target" / "debug" / "work-planner-cli")
            _process = subprocess.Popen(
                [binary], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                text=True, encoding="utf-8", bufsize=1,
            )
        _process.stdin.write(json.dumps({"op": op, "args": args}, ensure_ascii=False) + "\n")
        _process.stdin.flush()
        line = _process.stdout.readline()
        if not line:
            raise RuntimeError("Rust planner CLI exited without a response")
        response = json.loads(line)
        if not response["ok"]:
            error = response["error"]
            raise getattr(builtins, error["type"], RuntimeError)(error["message"])
        return response["result"]


def route_response(method, path, query_string):
    """Keep Python's public route tuple and JSON text serialization."""
    status, headers, body = call("route", method=method, path=path, query_string=query_string)
    if headers["Content-Type"].startswith("application/json"):
        body = json.dumps(body, ensure_ascii=False)
    return status, headers, body


def _day(day):
    return {
        "date": day.date, "dayType": day.day_type, "workedMinutes": day.worked_minutes,
        "recognizedMinutes": day.recognized_minutes, "leaveMinutes": day.leave_minutes,
        "availability": {"available": day.availability.available,
                         "minWorkMinutes": day.availability.min_work_minutes,
                         "maxWorkMinutes": day.availability.max_work_minutes},
    }


def install():
    """Install only when explicitly selected; Python remains the default."""
    if os.environ.get("WORK_PLANNER_BACKEND", "python") != "rust":
        return
    import work_planner
    from work_planner import demo_payload, demo_routes, explain, feasibility, insights, planner

    def plan_month(payload):
        return call("plan_month", payload=payload)

    def month_insights(payload, *, now, projection_constraints=None):
        return call("month_insights", payload=payload, now=now.isoformat(),
                    projection_constraints=projection_constraints)

    def explain_day(day, additional, daily_cap):
        return call("explain_day", day=_day(day), additional=additional, daily_cap=daily_cap)

    def explain_result(status, gap_minutes):
        return call("explain_result", status=status, gap_minutes=gap_minutes)

    def additional_work_bounds(month):
        raw = dataclasses.asdict(month)
        policy = month.policy
        payload = {
            "dataOrigin": raw["data_origin"], "generator": raw["generator"],
            "period": raw["period"], "timezone": raw["timezone"],
            "targetMinutes": raw["target_minutes"],
            "policy": {"weeklyLimitMinutes": policy.weekly_limit_minutes,
                       "normalMinutes": policy.normal_minutes, "maxMinutes": policy.max_minutes,
                       "allocationMode": policy.allocation_mode,
                       "dateOverrides": policy.date_overrides, "weekdayCaps": policy.weekday_caps},
            "days": [_day(day) for day in month.days],
        }
        result = call("additional_work_bounds", payload=payload)
        return None if result is None else tuple(result)

    def normal_first(result, source, normal):
        return call("normal_first", result=result, source=source, normal=normal)

    def month_payload(year=2042, month=3, target=7800, normal=500, long=719, short=285):
        year, month = min((year, month), (2042, 3))
        archive = (year, month) != (2042, 3)
        source = demo_payload._source(year, month, target, normal, long, short, archive=archive)
        target = max(target, sum(day["recognizedMinutes"] for day in source["days"]))
        values = [target] if archive else dict.fromkeys([target, 7200, demo_payload.nine_hour_target_minutes(year, month), 7800, 9000])
        plans = {str(value): demo_payload._demo_plan(year, month, value, normal, long, short, archive)
                 for value in values}
        return call("month_payload", year=year, month=month, target=target, normal=normal,
                    long=long, short=short, plans=plans)

    def archive_payload():
        return call("archive_payload")

    def nine_hour_target_minutes(year, month):
        return call("nine_hour_target_minutes", year=year, month=month)

    def route(method, path, query_string):
        return route_response(method, path, query_string)

    def replace(module, name, function):
        original = getattr(module, name)
        functools.update_wrapper(function, original)
        setattr(module, name, function)

    for module in [work_planner, planner, demo_payload]:
        replace(module, "plan_month", plan_month)
    for module in [work_planner, insights, demo_payload]:
        replace(module, "month_insights", month_insights)
    for module in [explain, planner]:
        replace(module, "explain_day", explain_day)
        replace(module, "explain_result", explain_result)
    replace(feasibility, "additional_work_bounds", additional_work_bounds)
    replace(demo_payload, "_normal_first", normal_first)
    replace(demo_payload, "month_payload", month_payload)
    replace(demo_payload, "archive_payload", archive_payload)
    replace(demo_payload, "nine_hour_target_minutes", nine_hour_target_minutes)
    replace(demo_routes, "month_payload", month_payload)
    replace(demo_routes, "archive_payload", archive_payload)
    replace(demo_routes, "nine_hour_target_minutes", nine_hour_target_minutes)
    replace(demo_routes, "route", route)
