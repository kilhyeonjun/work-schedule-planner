from __future__ import annotations

from work_planner import plan_month

from .test_schema import valid_input


def test_core_preserves_operational_origin_for_private_adapters():
    payload = valid_input()
    payload["dataOrigin"] = "operational"

    assert plan_month(payload)["dataOrigin"] == "operational"


def test_balances_projected_recognized_load_within_one_minute():
    payload = valid_input()
    payload["targetMinutes"] = 960
    payload["policy"]["weekdayCaps"] = {}

    result = plan_month(payload)
    projected = [day["projectedRecognizedMinutes"] for day in result["days"]]

    assert result["status"] == "planned"
    assert result["gapMinutes"] == 0
    assert max(projected) - min(projected) <= 1


def test_weekday_cap_survives_redistribution():
    payload = valid_input()
    payload["targetMinutes"] = 1140
    payload["policy"]["weekdayCaps"] = {"4": 240}

    result = plan_month(payload)
    friday = next(day for day in result["days"] if day["weekday"] == 4)

    assert friday["plannedWorkMinutes"] <= 240
    assert result["constraints"]["dailyCapsPassed"] is True


def test_partial_leave_counts_for_target_but_not_weekly_work_cap():
    payload = valid_input()
    payload["targetMinutes"] = 1080
    payload["policy"]["weeklyLimitMinutes"] = 840

    result = plan_month(payload)

    assert result["recognizedBaselineMinutes"] == 180
    assert sum(day["plannedAdditionalMinutes"] for day in result["days"]) == 720
    assert result["gapMinutes"] == 180
    assert result["constraints"]["weeklyCapsPassed"] is True


def test_infeasible_target_fails_closed_with_explicit_gap():
    payload = valid_input()
    payload["targetMinutes"] = 5000

    result = plan_month(payload)

    assert result["status"] == "insufficient_slots"
    assert result["gapMinutes"] > 0
    assert result["constraints"] == {
        "dailyCapsPassed": True,
        "weeklyCapsPassed": True,
        "unavailableDaysPassed": True,
    }


def test_satisfied_target_allocates_nothing():
    payload = valid_input()
    payload["targetMinutes"] = 120

    result = plan_month(payload)

    assert result["status"] == "satisfied"
    assert result["plannedAdditionalMinutes"] == 0
    assert result["gapMinutes"] == 0
