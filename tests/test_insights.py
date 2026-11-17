from __future__ import annotations

import copy
import datetime as dt

import pytest

from work_planner import month_insights
from work_planner.demo_payload import month_payload
from work_planner.demo_routes import route

NOW = dt.datetime(2042, 3, 4, 12, tzinfo=dt.timezone(dt.timedelta(hours=9)))


def payload():
    return {
        "dataOrigin": "synthetic",
        "days": [
            {"date": date, "day_type": "workday", "work_minutes": worked,
             "rest_minutes": 60, "is_ongoing": date == "2042-03-04"}
            for date, worked in [("2042-03-03", 480), ("2042-03-04", 240),
                                 ("2042-03-05", 0), ("2042-03-07", 0)]
        ],
        "derived": {"recognizedMinutes": 720},
        "planner": {
            "settings": {"shortDayMinutes": 285, "longDayMinutes": 600},
            "plan": {
                "days": [
                    {"date": date, "plannedMinutes": minutes, "plannedAdditionalMinutes": added,
                     "window": "09:00–16:00"}
                    for date, minutes, added in [("2042-03-04", 440, 200),
                                                  ("2042-03-05", 400, 400), ("2042-03-07", 400, 400)]
                ],
                "summary": {"weekly": []}, "plannedTotalMinutes": 1000,
                "todayAction": {"workedMinutes": 240, "remainingTodayMinutes": 200},
            },
        },
    }


@pytest.mark.parametrize("minutes,level", [(2159, None), (2160, "risk"), (2400, "risk"), (2401, "breach")])
@pytest.mark.parametrize("projected", [True, False])
def test_weekly_guard_threshold_and_fallback(minutes, level, projected):
    source = payload()
    week = {"key": "2042-W10", "weeklyMaxMinutes": 2400,
            "actualMinutes": 1000, "plannedAdditionalMinutes": minutes - 1000}
    if projected:
        week["projectedActualMinutes"] = minutes
        week["actualMinutes"] = 0  # Explicit projection takes precedence.
    source["planner"]["plan"]["summary"]["weekly"] = [week]
    guards = month_insights(source, now=NOW)["guards"]
    assert guards == ([] if level is None else [{
        "key": "weekly_max", "level": level, "weekKey": "2042-W10",
        "label": "주간 실근무 상한", "minutes": minutes, "limitMinutes": 2400,
    }])


@pytest.mark.parametrize("end,breach", [("15:59", False), ("16:00", False), ("16:01", True)])
def test_future_friday_end_boundary(end, breach):
    source = payload()
    source["planner"]["plan"]["days"][-1]["window"] = f"09:00–{end}"
    guards = month_insights(source, now=NOW)["guards"]
    assert len(guards) == int(breach)
    if breach:
        assert guards[0] == {"key": "friday_cap", "level": "breach", "date": "2042-03-07",
                             "label": "금요일 16시 퇴근 상한", "minutes": 961, "limitMinutes": 960}


@pytest.mark.parametrize("date,additional", [("2042-02-28", 400), ("2042-03-07", 0), ("2042-03-05", 400)])
def test_friday_guard_ignores_past_unplanned_and_other_weekdays(date, additional):
    source = payload()
    source["planner"]["plan"]["days"][-1].update(
        date=date, plannedAdditionalMinutes=additional, window="09:00–19:00"
    )
    assert month_insights(source, now=NOW)["guards"] == []


@pytest.mark.parametrize("worked,rest,required", [
    (239, 0, None), (240, 29, 30), (240, 30, None), (479, 30, None),
    (480, 30, 60), (480, 59, 60), (480, 60, None),
])
@pytest.mark.parametrize("index,level", [(0, "breach"), (1, "risk")])
def test_rest_thresholds_past_and_ongoing_today(worked, rest, required, index, level):
    source = payload()
    source["days"][index].update(work_minutes=worked, rest_minutes=rest)
    guards = month_insights(source, now=NOW)["guards"]
    assert guards == ([] if required is None else [{
        "key": "rest_break", "level": level, "date": source["days"][index]["date"],
        "label": "실근무에 따른 필수 휴게", "minutes": rest, "limitMinutes": required,
    }])


def test_rest_ignores_future_and_nonongoing_today():
    source = payload()
    for day in source["days"][1:]:
        day.update(work_minutes=480, rest_minutes=0, is_ongoing=False)
    assert month_insights(source, now=NOW)["guards"] == []


def test_leave_now_feasible_projection():
    assert month_insights(payload(), now=NOW)["leaveNow"] == {
        "date": "2042-03-04", "workedMinutes": 240, "todayRemainingMinutes": 200,
        "remainingWorkdays": 2, "averageDailyBeforeMinutes": 400,
        "averageDailyAfterMinutes": 500, "additionalPerDayMinutes": 100,
        "feasible": True, "shortfallMinutes": 0,
    }


@pytest.mark.parametrize("cap,shortfall", [(500, 0), (499, 2)])
def test_leave_now_cap_boundary(cap, shortfall):
    source = payload()
    source["planner"]["settings"]["longDayMinutes"] = cap
    leave = month_insights(source, now=NOW)["leaveNow"]
    assert leave["feasible"] is (shortfall == 0)
    assert leave["shortfallMinutes"] == shortfall


def test_leave_now_checks_each_day_not_just_average_and_rounds_even_shares():
    source = payload()
    source["planner"]["plan"]["todayAction"]["remainingTodayMinutes"] = 201
    source["planner"]["plan"]["days"][1]["plannedMinutes"] = 600
    leave = month_insights(source, now=NOW)["leaveNow"]
    assert leave["additionalPerDayMinutes"] == 101
    assert leave["averageDailyAfterMinutes"] == 501
    assert leave["shortfallMinutes"] == 101
    assert leave["feasible"] is False


def test_leave_now_no_future_workdays():
    source = payload()
    source["days"] = source["days"][:2]
    leave = month_insights(source, now=NOW)["leaveNow"]
    assert leave["remainingWorkdays"] == 0
    assert leave["averageDailyAfterMinutes"] == 0
    assert leave["additionalPerDayMinutes"] == 0
    assert leave["shortfallMinutes"] == 200
    assert leave["feasible"] is False


@pytest.mark.parametrize("off", [True, False])
def test_leave_now_absent_on_off_day_or_without_remaining(off):
    source = payload()
    if off:
        source["days"][1]["day_type"] = "holiday"
    else:
        source["planner"]["plan"]["todayAction"]["remainingTodayMinutes"] = 0
    assert month_insights(source, now=NOW)["leaveNow"] is None


@pytest.mark.parametrize("maximum", [None, 0, 1800])
def test_forecast_feasibility_and_fallback(maximum):
    source = payload()
    if maximum is not None:
        source["planner"]["plan"]["feasibility"] = {"possibleTargetMinutes": maximum}
    assert month_insights(source, now=NOW)["forecast"] == {
        "recognizedMinutes": 720, "expectedMinutes": 1720,
        "minMinutes": 1290, "maxMinutes": 1920 if maximum is None else maximum,
    }


def test_forecast_excludes_holidays_and_includes_unplanned_workdays():
    source = payload()
    source["days"][2]["day_type"] = "holiday"
    source["planner"]["plan"]["days"] = source["planner"]["plan"]["days"][:1]
    assert month_insights(source, now=NOW)["forecast"]["minMinutes"] == 1005


@pytest.mark.parametrize("planner", [None, {}, {"plan": None}])
def test_archive_without_plan_returns_none(planner):
    assert month_insights({"planner": planner}, now=NOW) is None
    assert month_insights(month_payload(2042, 2), now=NOW) is None


def test_deterministic_pure_and_kst_date_conversion():
    source = payload()
    original = copy.deepcopy(source)
    expected = month_insights(source, now=NOW)
    assert month_insights(source, now=NOW.astimezone(dt.UTC)) == expected
    assert month_insights(source, now=NOW.replace(tzinfo=None)) == expected
    assert month_insights(source, now=dt.datetime(2042, 3, 3, 15, tzinfo=dt.UTC))["asOf"] == "2042-03-04T00:00"
    assert source == original
    source["days"].reverse()
    source["planner"]["plan"]["days"].reverse()
    assert month_insights(source, now=NOW) == expected


def test_demo_attaches_insights_and_route_serializes_them():
    import json

    source = month_payload()
    assert source["planner"]["insights"] == month_insights(source, now=NOW)
    assert source["planner"]["insights"]["asOf"] == "2042-03-04T12:00"
    status, _, body = route("GET", "/demo/api/month", "")
    assert status == 200
    assert json.loads(body)["planner"]["insights"] == source["planner"]["insights"]
