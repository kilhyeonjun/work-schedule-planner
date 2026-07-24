from __future__ import annotations

from .model import Day


def explain_day(day: Day, additional: int, daily_cap: int) -> list[str]:
    reasons: list[str] = []
    if day.leave_minutes:
        reasons.append("recognized_leave_retained")
    if additional:
        reasons.append("lowest_projected_recognized_load")
    if day.worked_minutes + additional == daily_cap:
        reasons.append("daily_cap_reached")
    if additional == 0 and (day.day_type != "workday" or not day.availability.available):
        reasons.append("unavailable")
    return reasons or ["no_additional_work_required"]


def explain_result(status: str, gap_minutes: int) -> str:
    if status == "satisfied":
        return "The recognized baseline already meets the selected target."
    if status == "insufficient_slots":
        return f"Hard limits leave an explicit {gap_minutes}-minute gap."
    return "Additional work is balanced by projected recognized load while hard limits remain intact."
