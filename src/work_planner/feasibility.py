from __future__ import annotations

from collections import defaultdict

from .model import Day, Policy


def daily_work_cap(day: Day, policy: Policy) -> int:
    if day.day_type != "workday" or not day.availability.available:
        return day.worked_minutes
    candidates = [policy.max_minutes, day.availability.max_work_minutes]
    if day.date in policy.date_overrides:
        candidates.append(policy.date_overrides[day.date])
    if day.weekday in policy.weekday_caps:
        candidates.append(policy.weekday_caps[day.weekday])
    return max(day.worked_minutes, min(candidates))


def daily_additional_cap(day: Day, policy: Policy) -> int:
    return max(0, daily_work_cap(day, policy) - day.worked_minutes)


def weekly_work_baseline(days: tuple[Day, ...]) -> dict[str, int]:
    totals: dict[str, int] = defaultdict(int)
    for day in days:
        totals[day.week_key] += day.worked_minutes
    return dict(totals)


def verify_constraints(days: tuple[Day, ...], policy: Policy, allocated: dict[str, int]) -> dict[str, bool]:
    baseline = weekly_work_baseline(days)
    weekly = dict(baseline)
    daily_ok = True
    unavailable_ok = True
    for day in days:
        additional = allocated.get(day.date, 0)
        weekly[day.week_key] = weekly.get(day.week_key, 0) + additional
        daily_ok = daily_ok and day.worked_minutes + additional <= daily_work_cap(day, policy)
        if day.day_type != "workday" or not day.availability.available:
            unavailable_ok = unavailable_ok and additional == 0
    return {
        "dailyCapsPassed": daily_ok,
        "weeklyCapsPassed": all(
            total <= max(policy.weekly_limit_minutes, baseline.get(week, 0))
            for week, total in weekly.items()
        ),
        "unavailableDaysPassed": unavailable_ok,
    }
