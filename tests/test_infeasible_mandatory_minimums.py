from __future__ import annotations

from work_planner import plan_month


def test_invalid_availability_min_exceeds_max():
    """Input validation: minWorkMinutes > maxWorkMinutes is infeasible."""
    payload = {
        "dataOrigin": "synthetic",
        "generator": {"name": "test", "version": "1"},
        "period": "2042-03",
        "timezone": "Asia/Seoul",
        "targetMinutes": 1000,
        "policy": {
            "weeklyLimitMinutes": 2400,
            "normalMinutes": 480,
            "maxMinutes": 600,
            "allocationMode": "equal",
            "dateOverrides": {},
            "weekdayCaps": {},
        },
        "days": [
            {
                "date": "2042-03-03",
                "dayType": "workday",
                "workedMinutes": 0,
                "recognizedMinutes": 0,
                "leaveMinutes": 0,
                "availability": {
                    "available": True,
                    "minWorkMinutes": 500,
                    "maxWorkMinutes": 400,
                },
            },
        ],
    }

    result = plan_month(payload)

    assert result["status"] == "infeasible"
    assert result["plannedAdditionalMinutes"] == 0
    assert "infeasible" in result
    assert result["infeasible"]["reason"] == "invalid_availability"
    assert result["infeasible"]["date"] == "2042-03-03"
    assert result["infeasible"]["min_work_minutes"] == 500
    assert result["infeasible"]["max_work_minutes"] == 400


def test_tight_mandatory_minimums_degrade_gracefully():
    """Mandatory minimums near weekly cap activate feasible subset, not infeasible."""
    payload = {
        "dataOrigin": "synthetic",
        "generator": {"name": "test", "version": "1"},
        "period": "2042-03",
        "timezone": "Asia/Seoul",
        "targetMinutes": 1000,
        "policy": {
            "weeklyLimitMinutes": 500,
            "normalMinutes": 480,
            "maxMinutes": 600,
            "allocationMode": "equal",
            "dateOverrides": {},
            "weekdayCaps": {},
        },
        "days": [
            {
                "date": "2042-03-03",
                "dayType": "workday",
                "workedMinutes": 200,
                "recognizedMinutes": 200,
                "leaveMinutes": 0,
                "availability": {
                    "available": True,
                    "minWorkMinutes": 250,
                    "maxWorkMinutes": 600,
                },
            },
            {
                "date": "2042-03-04",
                "dayType": "workday",
                "workedMinutes": 0,
                "recognizedMinutes": 0,
                "leaveMinutes": 0,
                "availability": {
                    "available": True,
                    "minWorkMinutes": 250,
                    "maxWorkMinutes": 600,
                },
            },
        ],
    }

    result = plan_month(payload)

    # Remaining weekly capacity: 500 - 200 = 300
    # If both activated: 50 (first day remaining) + 250 (second day) = 300
    # Algorithm should find feasible subset
    assert result["status"] in ("planned", "insufficient_slots")
    assert result["constraints"]["weeklyCapsPassed"] is True
