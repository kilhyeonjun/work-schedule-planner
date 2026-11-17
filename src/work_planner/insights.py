from __future__ import annotations

import datetime as dt
import re
from zoneinfo import ZoneInfo

_KST = ZoneInfo("Asia/Seoul")


def _ceil_average(minutes: int, days: int) -> int:
    return (minutes + days - 1) // days if days else 0


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
    for week in plan["summary"]["weekly"]:
        minutes = week.get("projectedActualMinutes")
        if minutes is None:
            minutes = week["actualMinutes"] + week["plannedAdditionalMinutes"]
        limit = week["weeklyMaxMinutes"]
        if minutes >= limit - 240:
            guards.append({
                "key": "weekly_max", "level": "breach" if minutes > limit else "risk",
                "weekKey": week["key"], "label": "주간 실근무 상한",
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
                    "label": "금요일 16시 퇴근 상한", "minutes": minutes, "limitMinutes": 960,
                })

    for date, day in sorted(ledger.items()):
        if date > today or (date == today and not day.get("is_ongoing", False)):
            continue
        worked = day["work_minutes"]
        required = 60 if worked >= 480 else 30 if worked >= 240 else 0
        if day["rest_minutes"] < required:
            guards.append({
                "key": "rest_break", "level": "risk" if date == today else "breach",
                "date": date, "label": "실근무에 따른 필수 휴게",
                "minutes": day["rest_minutes"], "limitMinutes": required,
            })

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

    recognized = payload["derived"]["recognizedMinutes"]
    feasibility = plan.get("feasibility") or planner.get("feasibility") or payload.get("feasibility") or {}
    maximum = feasibility.get("possibleTargetMinutes")
    return {
        "asOf": now.isoformat(timespec="minutes")[:16],
        "guards": guards,
        "leaveNow": leave_now,
        "forecast": {
            "recognizedMinutes": recognized,
            "expectedMinutes": recognized + plan["plannedTotalMinutes"],
            "minMinutes": recognized + len(future) * settings["shortDayMinutes"],
            "maxMinutes": maximum if maximum is not None else recognized + len(future) * settings["longDayMinutes"],
        },
    }
