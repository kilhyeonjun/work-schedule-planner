import pytest

from work_planner.feasibility import additional_work_bounds
from work_planner.model import parse_work_month
from work_planner.planner import plan_month


@pytest.mark.parametrize("weekly,worked,fixed", [(3120, 0, None), (800, 0, None), (300, 100, None), (900, 400, 300), (1000, 0, 0)])
def test_bounds_match_constrained_planner(weekly, worked, fixed):
    source = {
        "dataOrigin": "synthetic", "period": "2042-03", "timezone": "Asia/Seoul", "targetMinutes": 20000,
        "policy": {"weeklyLimitMinutes": weekly, "normalMinutes": 500, "maxMinutes": 600,
                   "dateOverrides": {} if fixed is None else {"2042-03-05": fixed}},
        "days": [
            {"date": date, "dayType": "workday", "workedMinutes": actual, "recognizedMinutes": actual,
             "leaveMinutes": 0, "availability": {"available": active, "minWorkMinutes": 285 if active else 0, "maxWorkMinutes": 600 if active else actual}}
            for date, actual, active in [("2042-03-03", worked, False), ("2042-03-04", 0, True), ("2042-03-05", 0, True)]
        ],
    }
    lower, upper = additional_work_bounds(parse_work_month(source))
    assert upper == plan_month(source)["plannedAdditionalMinutes"]
    source["targetMinutes"] = worked
    assert lower == plan_month(source)["plannedAdditionalMinutes"]


def test_fixed_week_above_limit_has_no_reachable_bounds():
    source = {
        "dataOrigin": "synthetic", "period": "2042-03", "timezone": "Asia/Seoul", "targetMinutes": 3300,
        "policy": {"weeklyLimitMinutes": 3120, "normalMinutes": 500, "maxMinutes": 719,
                   "dateOverrides": {"2042-03-07": 500}},
        "days": [
            {"date": "2042-03-03", "dayType": "workday", "workedMinutes": 1400, "recognizedMinutes": 1400,
             "leaveMinutes": 0, "availability": {"available": False, "minWorkMinutes": 0, "maxWorkMinutes": 1400}},
            {"date": "2042-03-04", "dayType": "workday", "workedMinutes": 1400, "recognizedMinutes": 1400,
             "leaveMinutes": 0, "availability": {"available": False, "minWorkMinutes": 0, "maxWorkMinutes": 1400}},
            {"date": "2042-03-07", "dayType": "workday", "workedMinutes": 0, "recognizedMinutes": 0,
             "leaveMinutes": 0, "availability": {"available": True, "minWorkMinutes": 285, "maxWorkMinutes": 500}},
        ],
    }
    assert additional_work_bounds(parse_work_month(source)) is None
    result = plan_month(source)
    assert result["status"] == "infeasible"
    assert result["infeasible"]["reason"] == "fixed_weekly_conflict"
