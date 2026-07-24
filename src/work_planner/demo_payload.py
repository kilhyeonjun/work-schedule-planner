from __future__ import annotations

import calendar
import datetime as dt
from collections import defaultdict
from itertools import combinations
from typing import Any

from .planner import plan_month

DEMO_YEAR = 2042
DEMO_MONTH = 3
DEMO_TODAY = dt.date(DEMO_YEAR, DEMO_MONTH, 4)
DEFAULT_TARGET = 7_800
WEEKDAYS = "월화수목금토일"


def _clock(minutes: int) -> str:
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def _window(minutes: int) -> str:
    if minutes == 719:
        return "06:40–19:40"
    if minutes == 500:
        return "06:40–16:00"
    if minutes == 285:
        return "10:45–16:00"
    if minutes >= 500:
        return f"06:40–{_clock(max(16 * 60, 6 * 60 + 40 + minutes + 60))}"
    rest = 60 if minutes >= 480 else 30 if minutes >= 240 else 0
    return f"{_clock(16 * 60 - minutes - rest)}–16:00"


def _kind(minutes: int, normal: int, long: int, short: int) -> str:
    if minutes == normal:
        return "normal"
    if long > normal and minutes == long:
        return "long"
    if short < normal and minutes == short:
        return "short"
    return "adjust"


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
                "availability": {
                    "available": workday and (archive or date >= DEMO_TODAY),
                    "minWorkMinutes": max(0, short - leave),
                    "maxWorkMinutes": long,
                },
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
            "weekdayCaps": {"4": normal},
        },
        "days": days,
    }


def _normal_first(result: dict[str, Any], source: dict[str, Any], normal: int) -> dict[str, Any]:
    source_days = {day["date"]: day for day in source["days"]}
    rows = [dict(day) for day in result["days"]]
    by_week: dict[str, list[int]] = defaultdict(list)
    for index, row in enumerate(rows):
        by_week[row["week"]].append(index)

    for indices in by_week.values():
        total = sum(rows[index]["plannedAdditionalMinutes"] for index in indices)
        eligible = []
        bounds: dict[int, tuple[int, int, int]] = {}
        for index in indices:
            row = rows[index]
            raw = source_days[row["date"]]
            availability = raw["availability"]
            if not availability["available"]:
                continue
            worked = row["workedMinutes"]
            leave = row["leaveMinutes"]
            minimum = max(0, availability["minWorkMinutes"] - worked)
            capacity = max(0, row["dailyWorkCapMinutes"] - worked)
            normal_additional = max(minimum, min(capacity, normal - worked - leave))
            eligible.append(index)
            bounds[index] = (minimum, normal_additional, capacity)

        selected = None
        for size in range(len(eligible), 0, -1):
            selected = next(
                (
                    group
                    for group in combinations(eligible, size)
                    if sum(bounds[index][0] for index in group) <= total
                    <= sum(bounds[index][2] for index in group)
                ),
                None,
            )
            if selected is not None:
                break
        if selected is None:
            continue

        allocation = {index: 0 for index in eligible}
        normal_total = sum(bounds[index][1] for index in selected)
        target_bound = 2 if total >= normal_total else 1
        if target_bound == 2:
            for index in selected:
                allocation[index] = bounds[index][1]
            remaining = total - normal_total
        else:
            for index in selected:
                allocation[index] = bounds[index][0]
            remaining = total - sum(allocation.values())
        for index in selected:
            added = min(remaining, bounds[index][target_bound] - allocation[index])
            allocation[index] += added
            remaining -= added
            if remaining == 0:
                break

        for index in eligible:
            row = rows[index]
            added = allocation[index]
            row["plannedAdditionalMinutes"] = added
            row["plannedWorkMinutes"] = row["workedMinutes"] + added
            row["projectedRecognizedMinutes"] = row["recognizedMinutes"] + added
            row["reasons"] = ["normal_work_first"] if added else []

    return {**result, "days": rows}


def _weekly(
    rows: list[dict[str, Any]], actual: dict[str, int], normal: int, long: int, short: int
) -> list[dict[str, Any]]:
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
        kinds = [
            _kind(item["plannedWorkMinutes"], normal, long, short)
            for item in items
            if item["plannedAdditionalMinutes"] > 0
        ]
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
                "longDays": kinds.count("long"),
                "normalDays": kinds.count("normal"),
                "shortDays": kinds.count("short"),
                "adjustDays": kinds.count("adjust"),
                "todayIncluded": DEMO_TODAY.isoformat() in dates,
                "fridayNormal": True,
                "dates": dates,
            }
        )
    return result


def _comparison(
    key: str, label: str, target: int, selected: int, plan: dict[str, Any], normal: int, long: int, short: int
) -> dict[str, Any]:
    planned = [day for day in plan["days"] if day["plannedAdditionalMinutes"] > 0]
    kinds = [_kind(day["plannedWorkMinutes"], normal, long, short) for day in planned]
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
            "plannedDays": len(planned),
            "longDays": kinds.count("long"),
            "normalDays": kinds.count("normal"),
            "shortDays": kinds.count("short"),
            "adjustDays": kinds.count("adjust"),
            "averageDailyMinutes": sum(day["plannedWorkMinutes"] for day in planned) // len(planned) if planned else 0,
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
    result = _normal_first(plan_month(source), source, normal)
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
                "kind": _kind(worked + additional, normal, long, short) if additional else "off",
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
    comparison_plans = []
    for key, label, value in options:
        comparison_source = _source(year, month, value, normal, long, short, archive=False)
        comparison_plans.append(
            (key, label, value, _normal_first(plan_month(comparison_source), comparison_source, normal))
        )
    weekly = _weekly(result["days"], actual, normal, long, short)
    long_days = [day for day in planner_days if day["kind"] == "long"]
    adjust_days = [day for day in planner_days if day["kind"] == "adjust"]
    today_plan = next(day for day in planner_days if day["date"] == DEMO_TODAY.isoformat())
    today_window = _window(today_plan["plannedMinutes"])
    today_plan["window"] = today_window
    base["planner"] = {
        "targetOptions": [{"key": key, "label": label, "minutes": value} for key, label, value in options],
        "selectedTargetMinutes": target,
        "settings": {"normalDayMinutes": normal, "longDayMinutes": long, "shortDayMinutes": short},
        "comparisons": [
            _comparison(key, label, value, target, plan, normal, long, short)
            for key, label, value, plan in comparison_plans
        ],
        "strategy": {
            "mode": "commute",
            "distributionMode": "commute_concentrated",
            "title": "보통근무 우선",
            "message": "보통근무를 우선 유지하고, 부족분은 롱데이에 집중하며, 초과분은 늦게 출근해 16시에 퇴근하도록 조정합니다.",
            "frontLoadedLongDays": len(long_days),
            "fridayLongDays": 0,
            "bufferDate": adjust_days[-1]["date"] if adjust_days else None,
            "longDays": len(long_days),
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
                "longDays": sum(day["kind"] == "long" for day in planner_days),
                "normalDays": sum(day["kind"] == "normal" for day in planner_days),
                "shortDays": sum(day["kind"] == "short" for day in planner_days),
                "adjustDays": sum(day["kind"] == "adjust" for day in planner_days),
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
