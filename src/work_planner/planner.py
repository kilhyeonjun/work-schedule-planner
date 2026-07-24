from __future__ import annotations

from fractions import Fraction
from typing import Any

from .explain import explain_day, explain_result
from .feasibility import (
    daily_additional_cap,
    daily_work_cap,
    verify_constraints,
    weekly_work_baseline,
)
from .model import parse_work_month


def _allocate(payload: dict[str, Any]) -> tuple[Any, dict[str, int]]:
    month = parse_work_month(payload)
    allocated = {day.date: 0 for day in month.days}
    baseline = sum(day.recognized_minutes for day in month.days)
    remaining = max(0, month.target_minutes - baseline)
    weekly_work = weekly_work_baseline(month.days)
    daily_caps = {day.date: daily_additional_cap(day, month.policy) for day in month.days}

    while remaining > 0:
        eligible = [
            day
            for day in month.days
            if allocated[day.date] < daily_caps[day.date]
            and weekly_work.get(day.week_key, 0) < month.policy.weekly_limit_minutes
        ]
        if not eligible:
            break
        if month.policy.allocation_mode == "capacity_weighted":
            selected = min(
                eligible,
                key=lambda day: (
                    Fraction(day.recognized_minutes + allocated[day.date], daily_caps[day.date]),
                    day.date,
                ),
            )
        else:
            selected = min(
                eligible,
                key=lambda day: (day.recognized_minutes + allocated[day.date], day.date),
            )
        allocated[selected.date] += 1
        weekly_work[selected.week_key] = weekly_work.get(selected.week_key, 0) + 1
        remaining -= 1
    return month, allocated


def plan_month(payload: dict[str, Any]) -> dict[str, Any]:
    month, allocated = _allocate(payload)
    baseline = sum(day.recognized_minutes for day in month.days)
    planned_additional = sum(allocated.values())
    gap = max(0, month.target_minutes - baseline - planned_additional)
    if month.target_minutes <= baseline:
        status = "satisfied"
    elif gap:
        status = "insufficient_slots"
    else:
        status = "planned"

    days = []
    for day in month.days:
        additional = allocated[day.date]
        cap = daily_work_cap(day, month.policy)
        days.append(
            {
                "date": day.date,
                "weekday": day.weekday,
                "week": day.week_key,
                "dayType": day.day_type,
                "workedMinutes": day.worked_minutes,
                "recognizedMinutes": day.recognized_minutes,
                "leaveMinutes": day.leave_minutes,
                "plannedAdditionalMinutes": additional,
                "plannedWorkMinutes": day.worked_minutes + additional,
                "projectedRecognizedMinutes": day.recognized_minutes + additional,
                "dailyWorkCapMinutes": cap,
                "reasons": explain_day(day, additional, cap),
            }
        )

    constraints = verify_constraints(month.days, month.policy, allocated)
    if not all(constraints.values()):
        raise AssertionError("planner emitted a hard-constraint violation")
    return {
        "dataOrigin": "synthetic",
        "generator": month.generator,
        "period": month.period,
        "timezone": month.timezone,
        "algorithm": {"name": "deterministic-water-fill", "version": "1"},
        "status": status,
        "targetMinutes": month.target_minutes,
        "recognizedBaselineMinutes": baseline,
        "plannedAdditionalMinutes": planned_additional,
        "projectedRecognizedMinutes": baseline + planned_additional,
        "gapMinutes": gap,
        "constraints": constraints,
        "explanation": explain_result(status, gap),
        "days": days,
    }
