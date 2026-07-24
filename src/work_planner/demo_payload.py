from __future__ import annotations

import calendar
import datetime as dt
from collections import defaultdict
from typing import Any

from .planner import plan_month

DEMO_YEAR = 2042
DEMO_MONTH = 3
DEMO_TODAY = dt.date(DEMO_YEAR, DEMO_MONTH, 4)
DEFAULT_TARGET = 7_800
WEEKDAYS = "월화수목금토일"


def _window(minutes: int) -> str:
    end = 9 * 60 + minutes
    return f"09:00–{end // 60:02d}:{end % 60:02d}"


def _source(
    year: int,
    month: int,
    target: int,
    normal: int = 500,
    long: int = 719,
    short: int = 285,
    *,
    archive: bool,
) -> dict[str, Any]:
    days = []
    for number in range(1, calendar.monthrange(year, month)[1] + 1):
        date = dt.date(year, month, number)
        workday = date.weekday() < 5
        past = archive or date <= DEMO_TODAY
        worked = 420 if workday and past else 0
        leave = 120 if date == dt.date(DEMO_YEAR, DEMO_MONTH, 3) else 0
        if date == DEMO_TODAY:
            worked = 240
        days.append(
            {
                "date": date.isoformat(),
                "dayType": "workday" if workday else "weekend",
                "workedMinutes": worked,
                "recognizedMinutes": worked + leave,
                "leaveMinutes": leave,
                "availability": {"available": workday and (archive or date >= DEMO_TODAY), "maxWorkMinutes": long},
            }
        )
    return {
        "dataOrigin": "synthetic",
        "generator": {"name": "constraint-work-planner-demo", "version": "1", "seed": 7601},
        "period": f"{year:04d}-{month:02d}",
        "timezone": "UTC",
        "targetMinutes": target,
        "policy": {
            "weeklyLimitMinutes": 2400,
            "normalMinutes": normal,
            "maxMinutes": long,
            "allocationMode": "capacity_weighted",
            "dateOverrides": {},
            "weekdayCaps": {"1": normal, "2": normal, "4": short},
        },
        "days": days,
    }


def _weekly(rows: list[dict[str, Any]], actual: dict[str, int]) -> list[dict[str, Any]]:
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        date = dt.date.fromisoformat(row["date"])
        year, week, _ = date.isocalendar()
        groups[f"{year}-W{week:02d}"].append(row)
    result = []
    for key, items in groups.items():
        dates = [item["date"] for item in items]
        added = sum(item["plannedAdditionalMinutes"] for item in items)
        worked = sum(actual.get(date, 0) for date in dates)
        start = dt.date.fromisoformat(dates[0])
        end = dt.date.fromisoformat(dates[-1])
        result.append(
            {
                "key": key,
                "label": f"{start.month}/{start.day}–{end.month}/{end.day}",
                "plannedAdditionalMinutes": added,
                "plannedMinutes": worked + added,
                "actualMinutes": worked,
                "projectedActualMinutes": worked + added,
                "weeklyMaxMinutes": 2400,
                "remainingToWeeklyMaxMinutes": max(0, 2400 - worked - added),
                "longDays": 0,
                "normalDays": sum(item["plannedAdditionalMinutes"] > 0 for item in items),
                "shortDays": 0,
                "todayIncluded": DEMO_TODAY.isoformat() in dates,
                "fridayNormal": True,
                "dates": dates,
            }
        )
    return result


def _comparison(key: str, label: str, target: int, selected: int, plan: dict[str, Any]) -> dict[str, Any]:
    return {
        "key": key,
        "label": label,
        "targetMinutes": target,
        "selected": target == selected,
        "status": plan["status"],
        "remainingMinutes": max(0, target - plan["recognizedBaselineMinutes"]),
        "gapMinutes": plan["gapMinutes"],
        "effortLabel": {"target": "낮음", "fixed_ot": "보통", "max": "높음"}[key],
        "effortMessage": "합성 데이터 기반 시뮬레이션",
        "projectedExtraPayAfterTaxKrw": 0,
        "summary": {
            "plannedDays": sum(day["plannedAdditionalMinutes"] > 0 for day in plan["days"]),
            "longDays": 0,
            "averageDailyMinutes": 0,
        },
        "feasibility": {"status": plan["status"], "gapMinutes": plan["gapMinutes"]},
    }


def month_payload(
    year: int = DEMO_YEAR,
    month: int = DEMO_MONTH,
    target: int = DEFAULT_TARGET,
    normal: int = 500,
    long: int = 719,
    short: int = 285,
) -> dict[str, Any]:
    year, month = min((year, month), (DEMO_TODAY.year, DEMO_TODAY.month))
    archive = (year, month) != (DEMO_YEAR, DEMO_MONTH)
    source = _source(year, month, target, normal, long, short, archive=archive)
    target = max(target, sum(day["recognizedMinutes"] for day in source["days"]))
    source["targetMinutes"] = target
    result = plan_month(source)
    actual = {day["date"]: day["workedMinutes"] for day in source["days"]}
    recognized = {day["date"]: day["recognizedMinutes"] for day in source["days"]}
    total_actual = sum(actual.values())
    total_recognized = sum(recognized.values())
    collected = f"{year:04d}-{month:02d}-{calendar.monthrange(year, month)[1]:02d}T07:00:00Z" if archive else "2042-03-04T07:00:00Z"
    days = []
    planner_days = []
    for raw, planned in zip(source["days"], result["days"], strict=True):
        date = dt.date.fromisoformat(raw["date"])
        worked = raw["workedMinutes"]
        leave = raw["leaveMinutes"]
        ongoing = date == DEMO_TODAY and not archive
        days.append(
            {
                "date": raw["date"],
                "weekday": WEEKDAYS[date.weekday()],
                "day_type": raw["dayType"],
                "badge": "근무일" if date.weekday() < 5 else "주말",
                "work_minutes": worked,
                "recognized_minutes": raw["recognizedMinutes"],
                "office_minutes": worked,
                "remote_minutes": 0,
                "timeoff_minutes": leave,
                "rest_minutes": (30 if ongoing else 60) if worked else 0,
                "night_minutes": 0,
                "first_start": "09:00" if worked else None,
                "last_end": "13:30" if ongoing else ("17:00" if worked else None),
                "intervals": (["09:00–12:00", "12:30–13:30"] if ongoing else ["09:00–12:00", "13:00–17:00"]) if worked else [],
                "notes": ["합성 데모 기록"] if worked else [],
                "is_ongoing": ongoing,
                "is_on_break": False,
            }
        )
        additional = planned["plannedAdditionalMinutes"]
        planner_days.append(
            {
                "date": raw["date"],
                "weekday": WEEKDAYS[date.weekday()],
                "kind": "normal" if additional else "off",
                "window": _window(worked + additional) if additional else "—",
                "plannedMinutes": worked + additional,
                "plannedAdditionalMinutes": additional,
                "currentWorkedMinutes": worked,
                "timeoffMinutes": leave,
                "isToday": date == DEMO_TODAY,
                "isDateOverride": False,
            }
        )
    base: dict[str, Any] = {
        "ok": True,
        "dataOrigin": "synthetic",
        "year": year,
        "month": month,
        "collectedAt": collected,
        "derived": {
            "actualMinutes": total_actual,
            "recognizedMinutes": total_recognized,
            "timeOffMinutes": sum(day["leaveMinutes"] for day in source["days"]),
            "targetMinutes": target,
            "fixedOtMinutes": 7800,
            "maxMinutes": 9000,
            "statutoryMaxMinutes": 9000,
        },
        "days": days,
        "ui": {"readOnly": True, "archiveMode": archive, "targetConfiguration": {"enabled": not archive}},
        "sync": {"lastSyncAt": collected, "ageMinutes": 0, "stale": False, "lastError": None},
        "truth": {
            "current": {
                "sourceActualMinutes": total_actual,
                "inProgressActualMinutes": 0,
                "effectiveActualMinutes": total_actual,
                "sourceRecognizedMinutes": total_recognized,
                "effectiveRecognizedMinutes": total_recognized,
                "remainingToSelectedTargetMinutes": max(0, target - total_recognized),
                "selectedTargetMinutes": target,
                "officialAsOf": collected,
                "isOngoing": not archive,
                "isOnBreak": False,
            }
        },
        "notifications": {"items": [{"topicTitle": "데모 알림", "latestText": "합성 데이터 알림", "createdAt": collected}]},
    }
    if archive:
        return base
    options = [("target", "최소 기준", 7200), ("fixed_ot", "수당 기준선", 7800), ("max", "상한", 9000)]
    comparison_plans = [
        (key, label, value, plan_month(_source(year, month, value, normal, long, short, archive=False)))
        for key, label, value in options
    ]
    weekly = _weekly(result["days"], actual)
    today_plan = next(day for day in planner_days if day["date"] == DEMO_TODAY.isoformat())
    today_window = _window(today_plan["plannedMinutes"])
    today_plan["window"] = today_window
    base["planner"] = {
        "targetOptions": [{"key": key, "label": label, "minutes": value} for key, label, value in options],
        "selectedTargetMinutes": target,
        "settings": {"normalDayMinutes": normal, "longDayMinutes": long, "shortDayMinutes": short},
        "comparisons": [_comparison(key, label, value, target, plan) for key, label, value, plan in comparison_plans],
        "strategy": {
            "mode": "balanced",
            "title": "균형 배치",
            "message": "합성 데이터 기반 균형 계획",
            "frontLoadedLongDays": 0,
            "fridayLongDays": 0,
            "bufferDate": "2042-03-30",
            "longDays": 0,
            "projectedExtraPayAfterTaxKrw": 0,
        },
        "plan": {
            "status": result["status"],
            "targetMinutes": target,
            "recognizedMinutes": total_recognized,
            "sourceRecognizedMinutes": total_recognized,
            "inProgressRecognizedMinutes": 0,
            "remainingMinutes": max(0, target - total_recognized),
            "plannedTotalMinutes": result["plannedAdditionalMinutes"],
            "gapMinutes": result["gapMinutes"],
            "projectedOverFixedMinutes": 0,
            "projectedExtraPayPreTaxKrw": 0,
            "projectedExtraPayAfterTaxKrw": 0,
            "summary": {
                "plannedDays": sum(day["plannedAdditionalMinutes"] > 0 for day in result["days"]),
                "longDays": 0,
                "normalDays": sum(day["plannedAdditionalMinutes"] > 0 for day in result["days"]),
                "shortDays": 0,
                "adjustDays": 0,
                "averageDailyMinutes": 0,
                "weekly": weekly,
            },
            "days": planner_days,
            "feasibility": {"status": result["status"], "possibleTargetMinutes": target - result["gapMinutes"], "gapMinutes": result["gapMinutes"], "targetReductionMinutes": result["gapMinutes"], "requiredLongDayMinutes": 0, "requiredLongDayFeasible": result["gapMinutes"] == 0},
            "todayAction": {"kind": "workday", "date": today_plan["date"], "window": today_window, "decisionTitle": "오늘은 계획대로 진행", "message": "합성 데이터 기반 권장", "workedMinutes": today_plan["currentWorkedMinutes"], "remainingTodayMinutes": today_plan["plannedAdditionalMinutes"], "recommendedLeaveTime": today_window[-5:], "minimumTargetRemainingTodayMinutes": today_plan["plannedAdditionalMinutes"]},
        },
    }
    return base


def archive_payload() -> dict[str, Any]:
    months = []
    for year, month in ((DEMO_YEAR, DEMO_MONTH), (DEMO_YEAR, DEMO_MONTH - 1)):
        detail = month_payload(year, month)
        months.append(
            {
                "key": f"{year:04d}-{month:02d}",
                "year": year,
                "month": month,
                "collectedAt": detail["collectedAt"],
                "targetMinutes": detail["derived"]["targetMinutes"],
                "recognizedMinutes": detail["derived"]["recognizedMinutes"],
            }
        )
    return {
        "ok": True,
        "dataOrigin": "synthetic",
        "months": months,
    }
