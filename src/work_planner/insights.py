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


def _break_minutes(day: dict) -> int:
    """Non-work time between first start and last end: recorded rest plus gaps and leave.

    A half-day leave or a long gap between two work blocks is a break even when no rest
    block was recorded, so recorded rest alone flags false breaches.
    """
    rest = day.get("rest_minutes", 0)
    start, end = day.get("first_start"), day.get("last_end")
    if not start or not end:
        return rest
    start_minutes = int(start[:2]) * 60 + int(start[3:5])
    end_minutes = int(end[:2]) * 60 + int(end[3:5])
    span = end_minutes - start_minutes + (1440 if end_minutes < start_minutes else 0)
    return max(rest, span - day["work_minutes"])



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

def _constrained_projection(payload: dict, now: dt.datetime, *, leave_now: bool = False) -> tuple[int, int]:
    """Allocate the maximum through the same daily/weekly constraint engine as plans."""
    from .planner import plan_month

    settings = payload["planner"]["settings"]
    normal = settings.get("normalDayMinutes", min(500, settings["longDayMinutes"]))
    today = now.date().isoformat()
    rows = []
    overrides = {}
    baseline = 0
    for day in payload["days"]:
        date = day["date"]
        worked = day.get("work_minutes", 0)
        leave = day.get("timeoff_minutes", 0)
        recognized = _recognized_minutes(day)
        baseline += recognized
        active = date >= today and day["day_type"] == "workday" and not (leave_now and date == today)
        if date > today and (worked > 0 or leave >= settings["shortDayMinutes"]):
            active = False
        cap = normal if dt.date.fromisoformat(date).weekday() == 4 else settings["longDayMinutes"]
        cap = max(worked, cap - leave)
        raw = settings.get("dateOverrides", {}).get(date)
        fixed = raw.get("minutes") if isinstance(raw, dict) else raw
        if fixed is not None and active:
            cap = max(worked, min(cap, max(0, int(fixed) - leave)))
            overrides[date] = cap
        if date == today and active:
            # Same latest-end policy as the recommendation's work windows.
            end = 1180 if settings["longDayMinutes"] == 719 else 400 + settings["longDayMinutes"] + 60 if settings["longDayMinutes"] >= 500 else 960
            if dt.date.fromisoformat(date).weekday() == 4:
                end = min(end, 960)
            time_left = max(0, end - now.hour * 60 - now.minute - bool(now.second or now.microsecond))
            possible = 0
            for floor, ceiling in ((0, 239), (30, 479), (60, cap)):
                extra = min(max(0, cap - worked), max(0, ceiling - worked), max(0, time_left - max(0, floor - day.get("rest_minutes", 0))))
                required = 60 if worked + extra >= 480 else 30 if worked + extra >= 240 else 0
                if extra + max(0, required - day.get("rest_minutes", 0)) <= time_left:
                    possible = max(possible, extra)
            cap = worked + possible
            if date in overrides:
                overrides[date] = cap
        core = settings.get("dateCoreTimes", {}).get(date)
        minimum_total = settings["shortDayMinutes"]
        if core:
            start = dt.time.fromisoformat(core["start"])
            end_time = dt.time.fromisoformat(core["end"])
            duration = end_time.hour * 60 + end_time.minute - start.hour * 60 - start.minute
            minimum_total = duration if duration >= 240 else settings["shortDayMinutes"]
        minimum = max(0, minimum_total - leave)
        if (date == today and leave >= min(480, normal)) or (worked == 0 and cap < minimum):
            active = False
            overrides.pop(date, None)
        rows.append({"date": date, "dayType": day["day_type"], "workedMinutes": worked,
                     "recognizedMinutes": recognized, "leaveMinutes": leave,
                     "availability": {"available": active, "minWorkMinutes": minimum if active else 0,
                                      "maxWorkMinutes": cap if active else worked}})
    source = {"dataOrigin": payload.get("dataOrigin", "operational"), "period": today[:7], "timezone": "Asia/Seoul", "targetMinutes": baseline + 31 * 719,
              "policy": {"weeklyLimitMinutes": 3120, "normalMinutes": normal,
                         "maxMinutes": settings["longDayMinutes"], "dateOverrides": overrides},
              "days": rows}
    maximum = plan_month(source)
    source["targetMinutes"] = baseline
    minimum = plan_month(source)
    return (baseline + sum(day["plannedAdditionalMinutes"] for day in minimum["days"]),
            baseline + sum(day["plannedAdditionalMinutes"] for day in maximum["days"]))



def month_insights(payload: dict, *, now: dt.datetime) -> dict | None:
    """Derive ledger-basis projections through constrained allocation; naive now is KST."""
    planner = payload.get("planner") or {}
    plan = planner.get("plan")
    if plan is None:
        return None

    now = now.replace(tzinfo=_KST) if now.tzinfo is None else now.astimezone(_KST)
    today = now.date().isoformat()
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
            weekly_totals[key] = weekly_totals.get(key, 0) + day.get(field, 0)
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
        rest = _break_minutes(day)
        if rest < required:
            guards.append({
                "key": "rest_break", "level": "risk" if date == today else "breach",
                "date": date,
                "label": f"{_month_day(date)} 휴게 {_duration(rest)} · 필요 {_duration(required)}",
                "minutes": rest, "limitMinutes": required,
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
        _, leave_maximum = _constrained_projection(payload, now, leave_now=True)
        required_total = sum(_recognized_minutes(day) for day in ledger.values()) + before + remaining
        shortfall = max(0, required_total - leave_maximum)
        leave_now = {
            "date": today, "workedMinutes": action.get("workedMinutes", ledger[today]["work_minutes"]),
            "todayRemainingMinutes": remaining, "remainingWorkdays": count,
            "averageDailyBeforeMinutes": _ceil_average(before, count),
            "averageDailyAfterMinutes": _ceil_average(before + remaining, count),
            "additionalPerDayMinutes": _ceil_average(remaining, count),
            "feasible": shortfall == 0, "shortfallMinutes": shortfall,
        }

    recognized = sum(_recognized_minutes(day) for date, day in ledger.items() if date < today)
    today_recognized = _recognized_minutes(ledger[today]) if today in ledger else 0
    current = recognized + today_recognized
    minimum, maximum = _constrained_projection(payload, now)

    # Same basis as min/max: recorded recognition, confirmed future recognition (paid leave
    # already on the ledger, including full-day leave without a plan row), and the plan's
    # still-unrecorded work. plan.forecastMinutes is in target-eligibility units
    # (remote/unknown work may be excluded there), so it is not comparable.
    expected = (
        current
        + sum(_recognized_minutes(day) for date, day in ledger.items() if date > today)
        + sum(day.get("plannedAdditionalMinutes", 0) for date, day in planned.items() if date >= today)
    )
    return {
        "asOf": now.isoformat(timespec="minutes")[:16],
        **_target_progress(payload, today),
        "guards": guards,
        "leaveNow": leave_now,
        "forecast": {
            "recognizedMinutes": current,
            "expectedMinutes": expected,
            "minMinutes": minimum,
            "maxMinutes": maximum,
        },
    }
