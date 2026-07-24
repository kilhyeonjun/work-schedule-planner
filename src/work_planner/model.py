from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class Availability:
    available: bool
    max_work_minutes: int


@dataclass(frozen=True)
class Day:
    date: str
    day_type: str
    worked_minutes: int
    recognized_minutes: int
    leave_minutes: int
    availability: Availability

    @property
    def parsed_date(self) -> dt.date:
        return dt.date.fromisoformat(self.date)

    @property
    def weekday(self) -> int:
        return self.parsed_date.weekday()

    @property
    def week_key(self) -> str:
        iso_year, iso_week, _ = self.parsed_date.isocalendar()
        return f"{iso_year:04d}-W{iso_week:02d}"


@dataclass(frozen=True)
class Policy:
    weekly_limit_minutes: int
    normal_minutes: int
    max_minutes: int
    date_overrides: dict[str, int]
    weekday_caps: dict[int, int]


@dataclass(frozen=True)
class WorkMonth:
    data_origin: str
    generator: dict[str, Any]
    period: str
    timezone: str
    target_minutes: int
    policy: Policy
    days: tuple[Day, ...]


def _integer(value: Any, name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError(f"{name} must be a non-negative integer")
    return value


def parse_work_month(payload: dict[str, Any]) -> WorkMonth:
    if payload.get("dataOrigin") != "synthetic":
        raise ValueError("dataOrigin must be synthetic")
    raw_policy = payload.get("policy")
    raw_days = payload.get("days")
    if not isinstance(raw_policy, dict) or not isinstance(raw_days, list) or not raw_days:
        raise ValueError("policy and at least one day are required")

    policy = Policy(
        weekly_limit_minutes=_integer(raw_policy.get("weeklyLimitMinutes"), "weeklyLimitMinutes"),
        normal_minutes=_integer(raw_policy.get("normalMinutes"), "normalMinutes"),
        max_minutes=_integer(raw_policy.get("maxMinutes"), "maxMinutes"),
        date_overrides={
            str(key): _integer(value, f"dateOverrides.{key}")
            for key, value in dict(raw_policy.get("dateOverrides") or {}).items()
        },
        weekday_caps={
            int(key): _integer(value, f"weekdayCaps.{key}")
            for key, value in dict(raw_policy.get("weekdayCaps") or {}).items()
        },
    )
    days: list[Day] = []
    for raw in raw_days:
        if not isinstance(raw, dict) or not isinstance(raw.get("availability"), dict):
            raise TypeError("each day requires an availability object")
        availability = raw["availability"]
        day = Day(
            date=str(raw.get("date") or ""),
            day_type=str(raw.get("dayType") or ""),
            worked_minutes=_integer(raw.get("workedMinutes"), "workedMinutes"),
            recognized_minutes=_integer(raw.get("recognizedMinutes"), "recognizedMinutes"),
            leave_minutes=_integer(raw.get("leaveMinutes"), "leaveMinutes"),
            availability=Availability(
                available=bool(availability.get("available")),
                max_work_minutes=_integer(availability.get("maxWorkMinutes"), "maxWorkMinutes"),
            ),
        )
        _ = day.parsed_date
        days.append(day)
    days.sort(key=lambda day: day.date)
    if len({day.date for day in days}) != len(days):
        raise ValueError("day dates must be unique")

    return WorkMonth(
        data_origin="synthetic",
        generator=dict(payload.get("generator") or {}),
        period=str(payload.get("period") or ""),
        timezone=str(payload.get("timezone") or ""),
        target_minutes=_integer(payload.get("targetMinutes"), "targetMinutes"),
        policy=policy,
        days=tuple(days),
    )
