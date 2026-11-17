from __future__ import annotations

from collections import defaultdict

from .model import Day, Policy, WorkMonth


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


def minimum_additional_work(day: Day) -> int:
    return max(0, day.availability.min_work_minutes - day.worked_minutes)


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
    minimum_ok = True
    for day in days:
        additional = allocated.get(day.date, 0)
        weekly[day.week_key] = weekly.get(day.week_key, 0) + additional
        daily_ok = daily_ok and day.worked_minutes + additional <= daily_work_cap(day, policy)
        if day.day_type != "workday" or not day.availability.available:
            unavailable_ok = unavailable_ok and additional == 0
        if additional:
            minimum_ok = minimum_ok and day.worked_minutes + additional >= day.availability.min_work_minutes
    result = {
        "dailyCapsPassed": daily_ok,
        "weeklyCapsPassed": all(
            total <= max(policy.weekly_limit_minutes, baseline.get(week, 0))
            for week, total in weekly.items()
        ),
        "unavailableDaysPassed": unavailable_ok,
    }
    if any(day.availability.min_work_minutes for day in days):
        result["minimumWorkPassed"] = minimum_ok
    return result

def additional_work_bounds(month: WorkMonth) -> tuple[int, int] | None:
    """Exact bounds for optional attendance intervals and fixed dates, by week."""
    baseline = weekly_work_baseline(month.days)
    reachable: dict[str, int] = {}
    fixed: dict[str, int] = defaultdict(int)
    for day in month.days:
        cap = daily_additional_cap(day, month.policy)
        if cap == 0:
            continue
        week = day.week_key
        bits = reachable.get(week, 1)
        if day.date in month.policy.date_overrides:
            reachable[week] = bits << cap
            fixed[week] += cap
        else:
            # Attendance is either absent or a continuous [minimum, cap] interval.
            updated = bits
            for amount in range(max(1, minimum_additional_work(day)), cap + 1):
                updated |= bits << amount
            reachable[week] = updated
        room = max(0, month.policy.weekly_limit_minutes - baseline.get(week, 0))
        reachable[week] &= (1 << (room + 1)) - 1
    if any(bits == 0 for bits in reachable.values()):
        return None
    minimum = sum(fixed.values())
    maximum = sum(bits.bit_length() - 1 for bits in reachable.values())
    return minimum, maximum
