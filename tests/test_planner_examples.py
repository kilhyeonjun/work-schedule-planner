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


def test_preexisting_weekly_overage_does_not_break_future_planning():
    payload = valid_input()
    payload["targetMinutes"] = 1000
    payload["policy"]["weeklyLimitMinutes"] = 600
    payload["policy"]["weekdayCaps"] = {}
    payload["days"] = [
        {
            "date": "2042-03-03",
            "dayType": "unavailable",
            "workedMinutes": 700,
            "recognizedMinutes": 700,
            "leaveMinutes": 0,
            "availability": {"available": False, "maxWorkMinutes": 700},
        },
        {
            "date": "2042-03-10",
            "dayType": "workday",
            "workedMinutes": 0,
            "recognizedMinutes": 0,
            "leaveMinutes": 0,
            "availability": {"available": True, "maxWorkMinutes": 600},
        },
    ]

    result = plan_month(payload)

    assert result["plannedAdditionalMinutes"] == 300
    assert result["constraints"]["weeklyCapsPassed"] is True


def test_nonzero_plans_respect_minimum_work_minutes():
    payload = valid_input()
    payload["targetMinutes"] = 783
    payload["policy"]["weekdayCaps"] = {}
    payload["days"] = [
        {
            "date": f"2042-03-{day:02d}",
            "dayType": "workday",
            "workedMinutes": 0,
            "recognizedMinutes": 0,
            "leaveMinutes": 0,
            "availability": {
                "available": True,
                "minWorkMinutes": 285,
                "maxWorkMinutes": 719,
            },
        }
        for day in range(3, 7)
    ]

    result = plan_month(payload)
    planned = [day["plannedWorkMinutes"] for day in result["days"] if day["plannedWorkMinutes"]]

    assert result["status"] == "planned"
    assert result["gapMinutes"] == 0
    assert len(planned) == 2
    assert sorted(planned) == [391, 392]
    assert result["constraints"]["minimumWorkPassed"] is True


def test_minimum_activation_skips_small_cap_when_an_exact_single_day_plan_exists():
    payload = valid_input()
    payload["targetMinutes"] = 10
    payload["policy"]["weekdayCaps"] = {}
    payload["days"] = [
        {
            "date": "2042-03-03",
            "dayType": "workday",
            "workedMinutes": 0,
            "recognizedMinutes": 0,
            "leaveMinutes": 0,
            "availability": {"available": True, "minWorkMinutes": 6, "maxWorkMinutes": 6},
        },
        {
            "date": "2042-03-04",
            "dayType": "workday",
            "workedMinutes": 0,
            "recognizedMinutes": 0,
            "leaveMinutes": 0,
            "availability": {"available": True, "minWorkMinutes": 5, "maxWorkMinutes": 10},
        },
    ]

    result = plan_month(payload)

    assert [day["plannedAdditionalMinutes"] for day in result["days"]] == [0, 10]
    assert result["gapMinutes"] == 0


def test_minimum_activation_preserves_projected_load_balancing():
    payload = valid_input()
    payload["targetMinutes"] = 15
    payload["policy"]["weekdayCaps"] = {}
    payload["days"] = [
        {
            "date": "2042-03-03",
            "dayType": "workday",
            "workedMinutes": 10,
            "recognizedMinutes": 10,
            "leaveMinutes": 0,
            "availability": {"available": True, "minWorkMinutes": 15, "maxWorkMinutes": 15},
        },
        {
            "date": "2042-03-04",
            "dayType": "workday",
            "workedMinutes": 0,
            "recognizedMinutes": 0,
            "leaveMinutes": 0,
            "availability": {"available": True, "minWorkMinutes": 0, "maxWorkMinutes": 5},
        },
    ]

    result = plan_month(payload)

    assert [day["plannedAdditionalMinutes"] for day in result["days"]] == [0, 5]
    assert [day["projectedRecognizedMinutes"] for day in result["days"]] == [10, 5]
    assert result["gapMinutes"] == 0


def test_minimum_activation_preserves_projected_load_balancing_across_weeks():
    payload = valid_input()
    payload["targetMinutes"] = 15
    payload["policy"]["weekdayCaps"] = {}
    payload["days"] = [
        {
            "date": "2042-03-03",
            "dayType": "workday",
            "workedMinutes": 10,
            "recognizedMinutes": 10,
            "leaveMinutes": 0,
            "availability": {"available": True, "minWorkMinutes": 15, "maxWorkMinutes": 15},
        },
        {
            "date": "2042-03-10",
            "dayType": "workday",
            "workedMinutes": 0,
            "recognizedMinutes": 0,
            "leaveMinutes": 0,
            "availability": {"available": True, "minWorkMinutes": 0, "maxWorkMinutes": 5},
        },
    ]

    result = plan_month(payload)

    assert [day["plannedAdditionalMinutes"] for day in result["days"]] == [0, 5]
    assert [day["projectedRecognizedMinutes"] for day in result["days"]] == [10, 5]
    assert result["gapMinutes"] == 0


def test_minimum_activation_skips_a_tight_week_when_next_week_can_fulfill_exactly():
    payload = valid_input()
    payload["targetMinutes"] = 140
    payload["policy"]["weeklyLimitMinutes"] = 100
    payload["policy"]["weekdayCaps"] = {}
    payload["days"] = [
        {
            "date": "2042-03-03",
            "dayType": "workday",
            "workedMinutes": 40,
            "recognizedMinutes": 40,
            "leaveMinutes": 0,
            "availability": {"available": True, "minWorkMinutes": 100, "maxWorkMinutes": 100},
        },
        {
            "date": "2042-03-10",
            "dayType": "workday",
            "workedMinutes": 0,
            "recognizedMinutes": 0,
            "leaveMinutes": 0,
            "availability": {"available": True, "minWorkMinutes": 50, "maxWorkMinutes": 100},
        },
    ]

    result = plan_month(payload)

    assert [day["plannedAdditionalMinutes"] for day in result["days"]] == [0, 100]
    assert result["gapMinutes"] == 0


def test_target_below_minimum_work_fails_closed():
    payload = valid_input()
    payload["targetMinutes"] = 196
    payload["policy"]["weekdayCaps"] = {}
    payload["days"] = [{
        "date": "2042-03-03",
        "dayType": "workday",
        "workedMinutes": 0,
        "recognizedMinutes": 0,
        "leaveMinutes": 0,
        "availability": {
            "available": True,
            "minWorkMinutes": 285,
            "maxWorkMinutes": 719,
        },
    }]

    result = plan_month(payload)

    assert result["status"] == "insufficient_slots"
    assert result["plannedAdditionalMinutes"] == 0
    assert result["gapMinutes"] == 196
    assert result["constraints"]["minimumWorkPassed"] is True


def test_date_override_is_fixed_and_redistributes_remaining_target():
    payload = valid_input()
    payload["targetMinutes"] = 400
    payload["policy"]["weekdayCaps"] = {}
    payload["policy"]["dateOverrides"] = {"2042-03-03": 300}

    result = plan_month(payload)
    by_date = {day["date"]: day for day in result["days"]}

    assert by_date["2042-03-03"]["plannedWorkMinutes"] == 300
    assert by_date["2042-03-03"]["plannedAdditionalMinutes"] == 180
    assert by_date["2042-03-07"]["plannedAdditionalMinutes"] == 40
    assert result["gapMinutes"] == 0


def test_fixed_overrides_exceeding_target_remain_visible_as_over_target_conflict():
    payload = valid_input()
    payload["targetMinutes"] = 175
    payload["policy"]["weekdayCaps"] = {}
    payload["policy"]["dateOverrides"] = {"2042-03-03": 300}

    result = plan_month(payload)

    assert result["status"] == "over_target"
    assert result["plannedAdditionalMinutes"] == 180
    assert result["projectedRecognizedMinutes"] == 360
    assert result["gapMinutes"] == 0
    assert result["overTargetMinutes"] == 185


def test_satisfied_target_allocates_nothing():
    payload = valid_input()
    payload["targetMinutes"] = 120

    result = plan_month(payload)

    assert result["status"] == "satisfied"
    assert result["plannedAdditionalMinutes"] == 0
    assert result["gapMinutes"] == 0
