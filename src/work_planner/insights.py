from __future__ import annotations

import calendar
import datetime as dt
import re
from zoneinfo import ZoneInfo

_KST = ZoneInfo("Asia/Seoul")


def _ceil_average(minutes: int, days: int) -> int:
    return (minutes + days - 1) // days if days else 0


def _duration(minutes: int) -> str:
    return f"{minutes // 60}:{minutes % 60:02d}"


def _month_day(date: str) -> str:
    parsed = dt.date.fromisoformat(date)
    return f"{parsed.month}/{parsed.day}"


def _recognized_minutes(day: dict) -> int:
    return day.get("recognized_minutes", day.get("work_minutes", 0) + day.get("timeoff_minutes", 0))


def _target_progress(payload: dict, today: str) -> dict:
    """Compute pace from completed ledger dates, independent of selected totals."""
    ledger = {day["date"]: day for day in payload["days"]}
    workdays = sorted(date for date, day in ledger.items() if day["day_type"] == "workday")
    completed = [date for date in workdays if date < today]
    remaining = [date for date in workdays if date >= today]
    derived = payload["derived"]

    official = sum(_recognized_minutes(day) for date, day in ledger.items() if date < today)
    effective = official + _recognized_minutes(ledger.get(today, {}))
    planner = payload.get("planner") or {}
    options = planner.get("targetOptions")
    option_minutes = {option["key"]: option["minutes"] for option in options or []}
    burn_rate = round(official / len(completed)) if completed else None
    projected = official + (burn_rate or 0) * len(remaining)
    long_cap = planner.get("settings", {}).get("longDayMinutes", 719)
    targets = []
    for key, label, minutes in [
        ("base", "8시간(소정)", option_minutes.get("target", 0) if options is not None else derived.get("targetMinutes", 0)),
        ("nine_hour", "9시간", option_minutes.get("nine_hour", len(workdays) * 540)),
        ("fixed_ot", "고정OT", option_minutes.get("fixed_ot", 0) if options is not None else derived.get("fixedOtMinutes", 0)),
        ("max", "최대", option_minutes.get("max", 0) if options is not None else derived.get("maxMinutes", 0)),
    ]:
        if minutes <= 0:
            continue
        required = _ceil_average(max(0, minutes - official), len(remaining))
        eta = None
        if official >= minutes:
            eta = completed[-1] if completed else today
        elif burn_rate is not None:
            eta = next(
                (date for index, date in enumerate(remaining, 1)
                 if official + burn_rate * index >= minutes),
                None,
            )
        targets.append({
            "key": key, "label": label, "minutes": minutes,
            "achievedPercent": round(effective / minutes * 100, 1),
            "officialPercent": round(official / minutes * 100, 1),
            "requiredDailyMinutes": required, "requiredFeasible": required <= long_cap,
            "etaDate": eta, "projectedMinutes": projected,
            "projectedPercent": round(projected / minutes * 100, 1),
            "shortfallMinutes": max(0, minutes - projected),
        })
    return {
        "pace": {
            "totalWorkdays": len(workdays), "completedWorkdays": len(completed),
            "remainingWorkdays": len(remaining),
            "expectedPercent": round(len(completed) / len(workdays) * 100, 1) if workdays else 0.0,
        },
        "burnRateMinutes": burn_rate,
        "targets": targets,
    }


def month_insights(payload: dict, *, now: dt.datetime) -> dict | None:
    """Derive read-only projections; naive ``now`` is interpreted as KST.

    Leaving now spreads today's remainder evenly by ISO date (earlier dates
    receive any indivisible minutes). It does not rerun the constrained planner.
    """
    planner = payload.get("planner") or {}
    plan = planner.get("plan")
    if plan is None:
        return None

    now = now.replace(tzinfo=_KST) if now.tzinfo is None else now.astimezone(_KST)
    today = now.date().isoformat()
    settings = planner["settings"]
    ledger = {day["date"]: day for day in payload["days"]}
    planned = {day["date"]: day for day in plan["days"]}
    future = sorted(
        date for date, day in ledger.items()
        if date > today and day["day_type"] == "workday"
    )
    guards = []
    week_starts = {}
    year, month = payload.get("year", now.year), payload.get("month", now.month)
    month_start = dt.date(year, month, 1)
    month_end = dt.date(year, month, calendar.monthrange(year, month)[1])
    weekly_limits = {week["key"]: week["weeklyMaxMinutes"] for week in plan["summary"]["weekly"]}
    weekly_totals = {}
    for rows, field in ((ledger, "work_minutes"), (planned, "plannedAdditionalMinutes")):
        for date, day in rows.items():
            parsed = dt.date.fromisoformat(date)
            if (parsed.year, parsed.month) != (year, month):
                continue
            week_year, week_number, _ = parsed.isocalendar()
            key = f"{week_year}-W{week_number:02d}"
            weekly_totals[key] = weekly_totals.get(key, 0) + day[field]
    for key, minutes in sorted(weekly_totals.items()):
        limit = weekly_limits.get(key, 3120)
        if minutes >= limit - 240:
            week_year, week_number = key.split("-W")
            monday = dt.date.fromisocalendar(int(week_year), int(week_number), 1)
            start, end = max(monday, month_start), min(monday + dt.timedelta(days=6), month_end)
            week_starts[key] = start.isoformat()
            span = f"{_month_day(start.isoformat())}–{_month_day(end.isoformat())}"
            label = (
                f"{span} 주 52시간 {_duration(minutes - limit)} 초과 예상"
                if minutes > limit else f"{span} 주 52시간까지 {_duration(limit - minutes)} 남음"
            )
            guards.append({
                "key": "weekly_max", "level": "breach" if minutes > limit else "risk",
                "weekKey": key, "label": label,
                "minutes": minutes, "limitMinutes": limit,
            })

    for date, day in sorted(planned.items()):
        if date <= today or dt.date.fromisoformat(date).weekday() != 4:
            continue
        if day["plannedAdditionalMinutes"] <= 0:
            continue
        end = re.search(r"(\d{1,2}):(\d{2})\s*$", day["window"])
        if end is not None:
            minutes = int(end[1]) * 60 + int(end[2])
            if minutes > 960:
                guards.append({
                    "key": "friday_cap", "level": "breach", "date": date,
                    "label": f"{_month_day(date)}(금) {minutes // 60:02d}:{minutes % 60:02d} 퇴근 계획 · 16:00 상한 초과",
                    "minutes": minutes, "limitMinutes": 960,
                })

    for date, day in sorted(ledger.items()):
        if date > today or (date == today and not day.get("is_ongoing", False)):
            continue
        worked = day["work_minutes"]
        required = 60 if worked >= 480 else 30 if worked >= 240 else 0
        if day["rest_minutes"] < required:
            guards.append({
                "key": "rest_break", "level": "risk" if date == today else "breach",
                "date": date,
                "label": f"{_month_day(date)} 휴게 {_duration(day['rest_minutes'])} · 필요 {_duration(required)}",
                "minutes": day["rest_minutes"], "limitMinutes": required,
            })
    guards.sort(key=lambda guard: (
        guard["level"] != "breach",
        guard.get("date") or week_starts[guard["weekKey"]],
    ))

    action = plan.get("todayAction") or {}
    remaining = action.get("remainingTodayMinutes", 0)
    leave_now = None
    if ledger.get(today, {}).get("day_type") == "workday" and remaining > 0:
        count = len(future)
        before = sum(planned.get(date, {}).get("plannedAdditionalMinutes", 0) for date in future)
        share, extra = divmod(remaining, count) if count else (0, 0)
        shortfall = sum(
            max(0, planned.get(date, {}).get("plannedMinutes", 0)
                + share + (index < extra) - settings["longDayMinutes"])
            for index, date in enumerate(future)
        ) if count else remaining
        leave_now = {
            "date": today, "workedMinutes": action.get("workedMinutes", ledger[today]["work_minutes"]),
            "todayRemainingMinutes": remaining, "remainingWorkdays": count,
            "averageDailyBeforeMinutes": _ceil_average(before, count),
            "averageDailyAfterMinutes": _ceil_average(before + remaining, count),
            "additionalPerDayMinutes": _ceil_average(remaining, count),
            "feasible": shortfall == 0, "shortfallMinutes": shortfall,
        }

    recognized = sum(_recognized_minutes(day) for date, day in ledger.items() if date < today)
    remaining_workdays = len(future) + (ledger.get(today, {}).get("day_type") == "workday")
    expected = plan.get("forecastMinutes")
    if expected is None:
        expected = recognized + plan["plannedTotalMinutes"]
    return {
        "asOf": now.isoformat(timespec="minutes")[:16],
        **_target_progress(payload, today),
        "guards": guards,
        "leaveNow": leave_now,
        "forecast": {
            "recognizedMinutes": recognized,
            "expectedMinutes": expected,
            "minMinutes": recognized + remaining_workdays * settings["shortDayMinutes"],
            "maxMinutes": recognized + remaining_workdays * settings["longDayMinutes"],
        },
    }
