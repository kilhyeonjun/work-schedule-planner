from __future__ import annotations

from collections.abc import Sequence
from fractions import Fraction
from typing import Any

from .explain import explain_day, explain_result
from .feasibility import (
    daily_additional_cap,
    daily_work_cap,
    minimum_additional_work,
    verify_constraints,
    weekly_work_baseline,
)
from .model import parse_work_month


def _bit_indexes(bits: int):
    while bits:
        lowest = bits & -bits
        yield lowest.bit_length() - 1
        bits ^= lowest


def _water_fill(
    month: Any,
    daily_caps: dict[str, int],
    weekly_work: dict[str, int],
    allocated: dict[str, int],
    remaining: int,
    activated: set[str],
    allowed_dates: set[str] | None = None,
) -> int:
    while remaining > 0:
        eligible = [
            day
            for day in month.days
            if (allowed_dates is None or day.date in allowed_dates)
            and allocated[day.date] < daily_caps[day.date]
            and (minimum_additional_work(day) == 0 or day.date in activated)
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
    return remaining


def _activation_balance_key(
    month: Any,
    days: Sequence[Any],
    daily_caps: dict[str, int],
    weekly_work: dict[str, int],
    preferred: dict[str, int],
    amount: int,
    selected_dates: tuple[str, ...],
) -> tuple[Any, ...]:
    allocated = {day.date: 0 for day in month.days}
    simulated_weekly = dict(weekly_work)
    activated = set(selected_dates)
    remaining = amount
    for day in days:
        if day.date not in activated:
            continue
        minimum = minimum_additional_work(day)
        allocated[day.date] = minimum
        simulated_weekly[day.week_key] = simulated_weekly.get(day.week_key, 0) + minimum
        remaining -= minimum
    remaining = _water_fill(
        month,
        daily_caps,
        simulated_weekly,
        allocated,
        remaining,
        activated,
        {day.date for day in days},
    )
    projected = [
        day.recognized_minutes + allocated[day.date]
        for day in days
        if daily_caps[day.date] > 0
    ]
    distance = sum(abs(allocated[day.date] - preferred[day.date]) for day in days)
    spread = max(projected) - min(projected) if projected else 0
    return (remaining > 0, distance, spread, max(projected, default=0), tuple(projected), selected_dates)


def _minimum_activation(
    month: Any,
    daily_caps: dict[str, int],
    weekly_work: dict[str, int],
    target: int,
) -> tuple[int, set[str]]:
    if not any(minimum_additional_work(day) for day in month.days):
        return target, set()

    preferred = {day.date: 0 for day in month.days}
    _water_fill(
        month,
        daily_caps,
        dict(weekly_work),
        preferred,
        target,
        {day.date for day in month.days},
    )

    grouped: dict[str, list[Any]] = {}
    for day in month.days:
        grouped.setdefault(day.week_key, []).append(day)

    week_data = []
    target_mask = (1 << (target + 1)) - 1
    for week in sorted(grouped):
        days = grouped[week]
        weekly_capacity = max(0, month.policy.weekly_limit_minutes - weekly_work.get(week, 0))
        free_capacity = sum(
            daily_caps[day.date]
            for day in days
            if minimum_additional_work(day) == 0
        )
        constrained = [
            day
            for day in days
            if 0 < minimum_additional_work(day) <= daily_caps[day.date]
        ]
        options = []
        reachable = 0
        for mask in range(1 << len(constrained)):
            selected = tuple(constrained[index] for index in range(len(constrained)) if mask & (1 << index))
            minimum = sum(minimum_additional_work(day) for day in selected)
            maximum = min(weekly_capacity, free_capacity + sum(daily_caps[day.date] for day in selected))
            if minimum > maximum or minimum > target:
                continue
            maximum = min(maximum, target)
            reachable |= ((1 << (maximum - minimum + 1)) - 1) << minimum
            options.append((minimum, maximum, tuple(day.date for day in selected)))
        week_data.append((reachable & target_mask, options, tuple(days)))

    prefixes = [1]
    for reachable, _, _ in week_data:
        combined = 0
        for amount in _bit_indexes(reachable):
            combined |= prefixes[-1] << amount
        prefixes.append(combined & target_mask)

    planned_target = target if prefixes[-1] & (1 << target) else prefixes[-1].bit_length() - 1
    activated: set[str] = set()
    remaining = planned_target
    for index in range(len(week_data) - 1, -1, -1):
        reachable, options, days = week_data[index]
        preferred_week = sum(preferred[day.date] for day in days)
        amount = min(
            (
                value
                for value in _bit_indexes(reachable)
                if value <= remaining and prefixes[index] & (1 << (remaining - value))
            ),
            key=lambda value: (abs(value - preferred_week), value),
        )
        subsets = {dates for minimum, maximum, dates in options if minimum <= amount <= maximum}
        selected = min(
            subsets,
            key=lambda dates: _activation_balance_key(
                month, days, daily_caps, weekly_work, preferred, amount, dates
            ),
        )
        activated.update(selected)
        remaining -= amount
    return planned_target, activated


def _allocate(payload: dict[str, Any]) -> tuple[Any, dict[str, int]]:
    month = parse_work_month(payload)
    allocated = {day.date: 0 for day in month.days}
    baseline = sum(day.recognized_minutes for day in month.days)
    requested = max(0, month.target_minutes - baseline)
    weekly_work = weekly_work_baseline(month.days)
    daily_caps = {day.date: daily_additional_cap(day, month.policy) for day in month.days}

    # A date override is a fixed local plan, not a cap. Lock it before the
    # deterministic allocator so it can only redistribute across other dates.
    fixed_total = 0
    for day in month.days:
        if day.date not in month.policy.date_overrides:
            continue
        fixed = month.policy.date_overrides[day.date] - day.worked_minutes
        if fixed < 0 or fixed > daily_caps[day.date]:
            raise ValueError(f"date override is outside eligible capacity: {day.date}")
        allocated[day.date] = fixed
        fixed_total += fixed
        weekly_work[day.week_key] = weekly_work.get(day.week_key, 0) + fixed
        daily_caps[day.date] = 0
    # Fixed local commitments are authoritative even when they exceed the
    # selected target; the caller must surface the resulting conflict.
    remaining, activated = _minimum_activation(month, daily_caps, weekly_work, max(0, requested - fixed_total))
    for day in month.days:
        if day.date not in activated:
            continue
        minimum = minimum_additional_work(day)
        allocated[day.date] = minimum
        weekly_work[day.week_key] = weekly_work.get(day.week_key, 0) + minimum
        remaining -= minimum

    _water_fill(month, daily_caps, weekly_work, allocated, remaining, activated)
    return month, allocated


def plan_month(payload: dict[str, Any]) -> dict[str, Any]:
    month, allocated = _allocate(payload)
    baseline = sum(day.recognized_minutes for day in month.days)
    planned_additional = sum(allocated.values())
    projected = baseline + planned_additional
    gap = max(0, month.target_minutes - projected)
    raw_over_target = max(0, projected - month.target_minutes)
    has_fixed_commitment = bool(month.policy.date_overrides) and planned_additional > 0
    over_target = raw_over_target if has_fixed_commitment else 0
    if over_target:
        status = "over_target"
    elif month.target_minutes <= baseline:
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
        "dataOrigin": month.data_origin,
        "generator": month.generator,
        "period": month.period,
        "timezone": month.timezone,
        "algorithm": {"name": "deterministic-water-fill", "version": "1"},
        "status": status,
        "targetMinutes": month.target_minutes,
        "recognizedBaselineMinutes": baseline,
        "plannedAdditionalMinutes": planned_additional,
        "projectedRecognizedMinutes": projected,
        "gapMinutes": gap,
        "overTargetMinutes": over_target,
        "constraints": constraints,
        "explanation": explain_result(status, gap),
        "days": days,
    }
