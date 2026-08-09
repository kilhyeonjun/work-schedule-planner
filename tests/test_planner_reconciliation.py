"""Test planner reconciliation and classifier consistency.

Verify that plannedTotalMinutes, kind classification, and summary counts
are derived from a single canonical classifier and reconcile correctly
when today has partial work.
"""

from __future__ import annotations

import datetime as dt

from work_planner.demo_payload import DEMO_MONTH, DEMO_YEAR, month_payload


def test_planned_total_minutes_includes_today_current_work():
    """plannedTotalMinutes must reconcile today's current work with additional."""
    # DEMO_TODAY = 2042-03-04, worked 240 minutes so far
    payload = month_payload(DEMO_YEAR, DEMO_MONTH, target=7800)
    plan = payload["planner"]["plan"]
    planner_days = plan["days"]

    # Find today
    today = next(day for day in planner_days if day["isToday"])
    assert today["date"] == "2042-03-04"
    assert today["currentWorkedMinutes"] == 240

    # plannedTotalMinutes represents ADDITIONAL minutes on top of recognized,
    # not the total sum of plannedMinutes (which would double-count recognized work).
    # Reconciliation formula: target = recognized + plannedTotal + gap
    assert plan["targetMinutes"] == (
        plan["recognizedMinutes"] + plan["plannedTotalMinutes"] + plan["gapMinutes"]
    ), "Reconciliation formula must hold"
    
    # Verify today's additional work is included in plannedTotalMinutes
    assert plan["plannedTotalMinutes"] == sum(
        day["plannedAdditionalMinutes"] for day in planner_days
    ), "plannedTotalMinutes must equal sum of additional minutes"


def test_kind_classifier_includes_past_workdays():
    """kind should be derived from total work (current + additional), not just additional."""
    payload = month_payload(DEMO_YEAR, DEMO_MONTH, target=7800)
    plan = payload["planner"]["plan"]
    planner_days = plan["days"]

    # Past workdays: 2042-03-02 (Mon), 2042-03-03 (Tue) worked 420 each
    # They should be classified by their worked minutes, not as "off"
    past_workdays = [
        day
        for day in planner_days
        if day["currentWorkedMinutes"] > 0
        and day["plannedAdditionalMinutes"] == 0
        and not day["isToday"]
    ]

    assert len(past_workdays) >= 1, "Should have at least 1 past completed workday"

    for day in past_workdays:
        # Current bug: kind="off" because `if additional else "off"`
        # Fix: kind should be based on currentWorkedMinutes
        assert day["kind"] != "off", (
            f"{day['date']} worked {day['currentWorkedMinutes']} but classified as 'off'"
        )


def test_summary_counts_all_eligible_weekdays():
    """plannedDays and kind counts must include past completed workdays."""
    payload = month_payload(DEMO_YEAR, DEMO_MONTH, target=7800)
    plan = payload["planner"]["plan"]
    planner_days = plan["days"]

    # Count eligible weekdays: all Mon-Fri that are not holidays/leave
    eligible_weekdays = [
        day
        for day in planner_days
        if dt.date.fromisoformat(day["date"]).weekday() < 5
        and day["kind"] != "off"
    ]

    # plannedDays should equal all active weekdays
    # Current bug: counts only plannedAdditionalMinutes > 0, excludes past days
    assert plan["summary"]["plannedDays"] == len(eligible_weekdays), (
        f"plannedDays {plan['summary']['plannedDays']} != "
        f"eligible weekdays {len(eligible_weekdays)}"
    )

    # Verify kind counts sum to plannedDays
    kind_total = (
        plan["summary"]["longDays"]
        + plan["summary"]["normalDays"]
        + plan["summary"]["shortDays"]
        + plan["summary"]["adjustDays"]
    )
    assert kind_total == plan["summary"]["plannedDays"], (
        f"kind counts sum {kind_total} != plannedDays {plan['summary']['plannedDays']}"
    )


def test_long_days_count_matches_canonical_classifier():
    """longDays summary must count all days where kind='long', including past."""
    payload = month_payload(DEMO_YEAR, DEMO_MONTH, target=7800)
    plan = payload["planner"]["plan"]
    planner_days = plan["days"]

    # Canonical count from plan days
    canonical_long = sum(1 for day in planner_days if day["kind"] == "long")

    # Summary longDays
    summary_long = plan["summary"]["longDays"]

    # Current bug: summary says 5, canonical (after fix) should be 6
    assert summary_long == canonical_long, (
        f"summary longDays {summary_long} != canonical {canonical_long}"
    )


def test_enumerate_missing_eligible_dates():
    """Identify exactly which 3 eligible weekdays are missing from plannedDays count."""
    payload = month_payload(DEMO_YEAR, DEMO_MONTH, target=7800)
    plan = payload["planner"]["plan"]
    planner_days = plan["days"]

    # All eligible weekdays (Mon-Fri, not holidays/full-day leave)
    all_eligible = [
        day["date"]
        for day in planner_days
        if dt.date.fromisoformat(day["date"]).weekday() < 5
        and day["kind"] != "off"
    ]

    # Days counted by current broken logic: only plannedAdditionalMinutes > 0
    currently_counted = [
        day["date"]
        for day in planner_days
        if day["plannedAdditionalMinutes"] > 0
    ]

    missing = set(all_eligible) - set(currently_counted)

    # Current bug: 3 missing dates (2 past workdays + today)
    # 2042-03-02 (Mon), 2042-03-03 (Tue), 2042-03-04 (Wed=today)
    assert len(missing) <= 3, f"Expected ≤3 missing, found {len(missing)}: {sorted(missing)}"

    # Verify they are all past completed workdays or today with current work
    for date_str in missing:
        day = next(d for d in planner_days if d["date"] == date_str)
        assert day["currentWorkedMinutes"] > 0, (
            f"Missing date {date_str} should have current worked minutes"
        )
        assert day["plannedAdditionalMinutes"] == 0 or day["isToday"], (
            f"Missing date {date_str} reason: "
            f"past completed work or today in progress"
        )


def test_weekly_summary_kind_counts_use_canonical_classifier():
    """Weekly summary kind counts must derive from the same _kind classifier."""
    payload = month_payload(DEMO_YEAR, DEMO_MONTH, target=7800)
    plan = payload["planner"]["plan"]
    planner_days = plan["days"]
    weekly = plan["summary"]["weekly"]

    by_date = {day["date"]: day for day in planner_days}

    for week in weekly:
        # Canonical kind counts from plan days
        canonical_counts = {"long": 0, "normal": 0, "short": 0, "adjust": 0}
        for date_str in week["dates"]:
            day = by_date[date_str]
            if day["kind"] in canonical_counts:
                canonical_counts[day["kind"]] += 1

        # Weekly summary counts must match
        assert week["longDays"] == canonical_counts["long"], (
            f"Week {week['key']} longDays mismatch"
        )
        assert week["normalDays"] == canonical_counts["normal"], (
            f"Week {week['key']} normalDays mismatch"
        )
        assert week["shortDays"] == canonical_counts["short"], (
            f"Week {week['key']} shortDays mismatch"
        )
        assert week["adjustDays"] == canonical_counts["adjust"], (
            f"Week {week['key']} adjustDays mismatch"
        )
