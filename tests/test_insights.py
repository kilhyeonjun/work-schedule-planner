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
def test_forecast_uses_slot_capacity_not_selected_target_feasibility(maximum):
    source = payload()
    if maximum is not None:
        source["planner"]["plan"]["feasibility"] = {"possibleTargetMinutes": maximum}
    assert month_insights(source, now=NOW)["forecast"] == {
        "recognizedMinutes": 720, "expectedMinutes": 1720,
        "minMinutes": 1335, "maxMinutes": 2280,
    }


def test_forecast_excludes_holidays_and_includes_unplanned_workdays():
    source = payload()
    source["days"][2]["day_type"] = "holiday"
    source["planner"]["plan"]["days"] = source["planner"]["plan"]["days"][:1]
    assert month_insights(source, now=NOW)["forecast"]["minMinutes"] == 1050


@pytest.mark.parametrize("worked,remaining,day_type,minimum,maximum", [
    (240, 0, "workday", 1290, 1920),
    (240, 200, "holiday", 1290, 1920),
    (285, 200, "workday", 1290, 2235),
    (650, 200, "workday", 1290, 1920),
])
def test_forecast_today_slot_uses_nonnegative_short_and_long_remainders(
    worked, remaining, day_type, minimum, maximum,
):
    source = payload()
    source["days"][1]["day_type"] = day_type
    source["planner"]["plan"]["todayAction"].update(
        workedMinutes=worked, remainingTodayMinutes=remaining,
    )
    forecast = month_insights(source, now=NOW)["forecast"]
    assert forecast["minMinutes"] == minimum
    assert forecast["maxMinutes"] == maximum


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


def progress_payload():
    """Synthetic month exercising official versus in-progress recognition."""
    source = payload()
    days = []
    for number in range(1, 31):
        date = dt.date(2026, 11, number)
        workday = date.weekday() < 5
        recognized = 584 if workday and number < 17 else 0
        if number == 16:
            recognized = 582
        if number == 17:
            recognized = 430
        days.append({
            "date": date.isoformat(), "day_type": "workday" if workday else "weekend",
            "recognized_minutes": recognized, "work_minutes": recognized,
            "rest_minutes": 60, "is_ongoing": number == 17,
        })
    source["days"] = days
    source["derived"] = {
        "recognizedMinutes": 6422, "targetMinutes": 10080,
        "fixedOtMinutes": 12420, "maxMinutes": 14028,
    }
    source["planner"]["settings"]["longDayMinutes"] = 719
    return source


PROGRESS_NOW = dt.datetime(2026, 11, 17, 15, tzinfo=NOW.tzinfo)


def test_four_target_progress_synthetic_month():
    insights = month_insights(progress_payload(), now=PROGRESS_NOW)
    assert insights["pace"] == {
        "totalWorkdays": 21, "completedWorkdays": 11,
        "remainingWorkdays": 10, "expectedPercent": 52.4,
    }
    assert insights["burnRateMinutes"] == 584
    targets = insights["targets"]
    assert [target["key"] for target in targets] == ["base", "nine_hour", "fixed_ot", "max"]
    assert [target["label"] for target in targets] == ["8시간(소정)", "9시간", "고정OT", "최대"]
    assert [target["minutes"] for target in targets] == [10080, 11340, 12420, 14028]
    assert [target["achievedPercent"] for target in targets] == [68.0, 60.4, 55.2, 48.8]
    assert [target["officialPercent"] for target in targets] == [63.7, 56.6, 51.7, 45.8]
    assert [target["requiredDailyMinutes"] for target in targets] == [366, 492, 600, 761]
    assert [target["requiredFeasible"] for target in targets] == [True, True, True, False]
    assert [target["etaDate"] for target in targets] == ["2026-11-25", "2026-11-27", None, None]
    assert [target["projectedMinutes"] for target in targets] == [12262] * 4
    assert [target["shortfallMinutes"] for target in targets] == [0, 0, 158, 1766]
    assert [target["projectedPercent"] for target in targets] == [121.6, 108.1, 98.7, 87.4]


@pytest.mark.parametrize("explicit", ["plan", "truth", "finished_excluded", "finished_included"])
def test_effective_progress_provenance_and_no_double_count(explicit):
    source = progress_payload()
    if explicit == "plan":
        source["planner"]["plan"]["inProgressRecognizedMinutes"] = 100
        effective = 6522
    elif explicit == "truth":
        source["truth"] = {"current": {"sourceRecognizedMinutes": 6422, "effectiveRecognizedMinutes": 6522}}
        effective = 6522
    else:
        source["days"][16]["is_ongoing"] = False
        effective = 6852
        if explicit == "finished_included":
            source["derived"]["recognizedMinutes"] = 6852
    target = month_insights(source, now=PROGRESS_NOW)["targets"][0]
    assert target["achievedPercent"] == round(effective / 10080 * 100, 1)


def test_demo_explicit_zero_in_progress_is_not_added_twice():
    source = month_payload()
    insights = source["planner"]["insights"]
    for target in insights["targets"]:
        assert target["achievedPercent"] == target["officialPercent"]


def test_first_workday_burn_rate_is_unknown_and_projection_stays_official():
    source = progress_payload()
    source["derived"]["recognizedMinutes"] = 0
    now = dt.datetime(2026, 11, 2, 12, tzinfo=NOW.tzinfo)
    insights = month_insights(source, now=now)
    assert insights["burnRateMinutes"] is None
    assert insights["pace"]["completedWorkdays"] == 0
    assert insights["pace"]["remainingWorkdays"] == 21
    assert insights["pace"]["expectedPercent"] == 0.0
    assert all(target["etaDate"] is None for target in insights["targets"])
    assert all(target["projectedMinutes"] == 0 for target in insights["targets"])


@pytest.mark.parametrize("now,eta", [
    (dt.datetime(2026, 11, 2, 12, tzinfo=NOW.tzinfo), "2026-11-02"),
    (PROGRESS_NOW, "2026-11-16"),
])
def test_already_achieved_target_eta(now, eta):
    source = progress_payload()
    source["derived"]["targetMinutes"] = 6000
    target = month_insights(source, now=now)["targets"][0]
    assert target["etaDate"] == eta
    assert target["requiredDailyMinutes"] == 0
    assert target["shortfallMinutes"] == 0


def test_no_workdays_and_nonpositive_targets():
    source = progress_payload()
    for day in source["days"]:
        day["day_type"] = "holiday"
    source["derived"].update(targetMinutes=0, fixedOtMinutes=-1)
    insights = month_insights(source, now=PROGRESS_NOW)
    assert insights["pace"] == {
        "totalWorkdays": 0, "completedWorkdays": 0,
        "remainingWorkdays": 0, "expectedPercent": 0.0,
    }
    assert insights["burnRateMinutes"] is None
    assert [target["key"] for target in insights["targets"]] == ["max"]
    target = insights["targets"][0]
    assert target["requiredDailyMinutes"] == 0
    assert target["etaDate"] is None


def test_target_progress_default_cap_and_kst_boundary():
    source = progress_payload()
    source["planner"]["settings"].pop("longDayMinutes")
    # Progress uses a default cap independently; existing forecast settings still
    # require explicit planner settings, so exercise the pure progress helper.
    from work_planner.insights import _target_progress

    assert _target_progress(source, "2026-11-17")["targets"][-1]["requiredFeasible"] is False
    source["planner"]["settings"]["longDayMinutes"] = 719
    expected = month_insights(source, now=PROGRESS_NOW)
    assert month_insights(source, now=PROGRESS_NOW.astimezone(dt.UTC)) == expected
    source["days"].reverse()
    assert month_insights(source, now=PROGRESS_NOW) == expected
