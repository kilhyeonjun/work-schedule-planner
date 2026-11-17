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
def test_weekly_guard_threshold_uses_actual_plus_planned_not_summary_projection(minutes, level, projected):
    source = payload()
    for day in source["days"]:
        day["work_minutes"] = 0
    source["days"][0]["work_minutes"] = 1000
    for day in source["planner"]["plan"]["days"]:
        day["plannedAdditionalMinutes"] = 0
    source["planner"]["plan"]["days"][0]["plannedAdditionalMinutes"] = minutes - 1000
    week = {"key": "2042-W10", "weeklyMaxMinutes": 2400,
            "actualMinutes": 1000, "plannedAdditionalMinutes": minutes - 1000}
    if projected:
        week["projectedActualMinutes"] = 99999  # Stale summary cannot override ledger plus plan.
        week["actualMinutes"] = 0
    source["planner"]["plan"]["summary"]["weekly"] = [week]
    guards = month_insights(source, now=NOW)["guards"]
    assert guards == ([] if level is None else [{
        "key": "weekly_max", "level": level, "weekKey": "2042-W10",
        "label": {2160: "3/3–3/9 주 52시간까지 4:00 남음",
                  2400: "3/3–3/9 주 52시간까지 0:00 남음",
                  2401: "3/3–3/9 주 52시간 0:01 초과 예상"}.get(minutes),
        "minutes": minutes, "limitMinutes": 2400,
    }])


@pytest.mark.parametrize("end,breach", [("15:59", False), ("16:00", False), ("16:01", True)])
def test_future_friday_end_boundary(end, breach):
    source = payload()
    source["planner"]["plan"]["days"][-1]["window"] = f"09:00–{end}"
    guards = month_insights(source, now=NOW)["guards"]
    assert len(guards) == int(breach)
    if breach:
        assert guards[0] == {"key": "friday_cap", "level": "breach", "date": "2042-03-07",
                             "label": "3/7(금) 16:01 퇴근 계획 · 16:00 상한 초과", "minutes": 961, "limitMinutes": 960}


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
        "label": f"3/{3 + index} 휴게 {rest // 60}:{rest % 60:02d} · 필요 {required // 60}:{required % 60:02d}",
        "minutes": rest, "limitMinutes": required,
    }])


@pytest.mark.parametrize("first,last,worked,rest,flagged", [
    # 10:07–12:00 work, 12:00–16:00 leave, 16:05–19:00 work: the leave is the break.
    ("10:07", "19:00", 288, 0, False),
    # Continuous 09:00–14:00 with no recorded rest is still a breach.
    ("09:00", "14:00", 300, 0, True),
    # Overnight spans wrap past midnight instead of going negative.
    ("22:00", "02:00", 240, 0, True),
    ("22:00", "02:30", 240, 30, False),
])
def test_rest_counts_non_work_gaps_between_first_start_and_last_end(first, last, worked, rest, flagged):
    source = payload()
    source["days"][0].update(first_start=first, last_end=last, work_minutes=worked, rest_minutes=rest)
    guards = [guard for guard in month_insights(source, now=NOW)["guards"] if guard["key"] == "rest_break"]
    assert bool(guards) is flagged


def test_rest_ignores_future_and_nonongoing_today():
    source = payload()
    for day in source["days"][1:]:
        day.update(work_minutes=480, rest_minutes=0, is_ongoing=False)
    assert not any(guard["key"] == "rest_break" for guard in month_insights(source, now=NOW)["guards"])


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


def test_leave_now_reallocates_instead_of_requiring_equal_shares():
    source = payload()
    source["planner"]["plan"]["todayAction"]["remainingTodayMinutes"] = 200
    source["planner"]["plan"]["days"][1]["plannedAdditionalMinutes"] = 600
    source["planner"]["plan"]["days"][2]["plannedAdditionalMinutes"] = 300
    source["planner"]["settings"]["dateOverrides"] = {"2042-03-05": 600}
    leave = month_insights(source, now=NOW)["leaveNow"]
    assert leave["additionalPerDayMinutes"] == 100
    assert leave["averageDailyAfterMinutes"] == 550
    # Equal +100 violates Thursday's fixed 600; Friday can take all +200.
    assert 600 + leave["additionalPerDayMinutes"] > 600
    assert leave["shortfallMinutes"] == 0
    assert leave["feasible"] is True


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
        "minMinutes": 720, "maxMinutes": 2160,
    }


def test_forecast_excludes_holidays_and_includes_unplanned_workdays():
    source = payload()
    source["days"][2]["day_type"] = "holiday"
    source["planner"]["plan"]["days"] = source["planner"]["plan"]["days"][:1]
    assert month_insights(source, now=NOW)["forecast"]["minMinutes"] == 720


@pytest.mark.parametrize("worked,day_type,minimum,maximum", [
    (240, "workday", 720, 2160),
    (285, "workday", 765, 2180),
    # Recorded time beyond the long-day cap and holiday work are kept, never dropped.
    (650, "workday", 1130, 2230),
    (240, "holiday", 720, 1820),
])
def test_forecast_keeps_today_recorded_time_and_adds_only_unrecorded_capacity(
    worked, day_type, minimum, maximum,
):
    source = payload()
    source["days"][1].update(day_type=day_type, work_minutes=worked)
    forecast = month_insights(source, now=NOW)["forecast"]
    assert forecast["recognizedMinutes"] == 480 + worked
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


@pytest.mark.parametrize("ongoing", [True, False])
def test_progress_ignores_whether_derived_total_includes_today(ongoing):
    source = progress_payload()
    source["days"][16]["is_ongoing"] = ongoing
    expected = month_insights(source, now=PROGRESS_NOW)
    source["derived"]["recognizedMinutes"] += 430
    actual = month_insights(source, now=PROGRESS_NOW)
    for key in ("pace", "burnRateMinutes", "targets"):
        assert actual[key] == expected[key]


def test_demo_separates_completed_and_today_and_uses_target_options():
    insights = month_payload()["planner"]["insights"]
    assert insights["burnRateMinutes"] == 540
    assert [target["minutes"] for target in insights["targets"]] == [7200, 11340, 7800, 9000]
    base = insights["targets"][0]
    assert base["officialPercent"] == 7.5
    assert base["achievedPercent"] == 10.8


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
    if now.day == 2:
        source["days"][0]["recognized_minutes"] = 6000  # Completed weekend work counts.
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


def test_completed_recognition_fallback_includes_weekend_work_and_timeoff():
    source = progress_payload()
    source["days"][0].pop("recognized_minutes")
    source["days"][0].update(work_minutes=60, timeoff_minutes=30)
    insights = month_insights(source, now=PROGRESS_NOW)
    assert insights["burnRateMinutes"] == round((6422 + 90) / 11)
    assert insights["targets"][0]["officialPercent"] == round(6512 / 10080 * 100, 1)


def test_option_targets_override_derived_and_keep_fixed_labels():
    source = progress_payload()
    source["planner"]["targetOptions"] = [
        {"key": key, "label": "합성 옵션", "minutes": minutes}
        for key, minutes in [("target", 9000), ("nine_hour", 11000),
                             ("fixed_ot", 12000), ("max", 13000)]
    ]
    targets = month_insights(source, now=PROGRESS_NOW)["targets"]
    assert [target["minutes"] for target in targets] == [9000, 11000, 12000, 13000]
    assert [target["label"] for target in targets] == ["8시간(소정)", "9시간", "고정OT", "최대"]


def test_present_options_do_not_fall_back_to_selected_derived_targets():
    source = progress_payload()
    source["planner"]["targetOptions"] = [{"key": "target", "minutes": 7200}]
    targets = month_insights(source, now=PROGRESS_NOW)["targets"]
    assert [target["key"] for target in targets] == ["base", "nine_hour"]
    assert [target["minutes"] for target in targets] == [7200, 11340]


@pytest.mark.parametrize("year,month,week_key,label", [
    (2042, 3, "2042-W09", "3/1–3/2 주 52시간까지 1:40 남음"),
    (2042, 3, "2042-W14", "3/31–3/31 주 52시간까지 1:40 남음"),
    (2026, 1, "2026-W01", "1/1–1/4 주 52시간까지 1:40 남음"),
])
def test_week_guard_label_clips_iso_week_to_payload_month(year, month, week_key, label):
    source = payload()
    source.update(year=year, month=month)
    source["days"] = [{
        "date": f"{year}-{month:02d}-01" if week_key.endswith("09") or month == 1 else f"{year}-{month:02d}-31",
        "day_type": "workday", "work_minutes": 3020, "rest_minutes": 60,
    }]
    source["planner"]["plan"]["days"] = []
    source["planner"]["plan"]["summary"]["weekly"] = [{
        "key": week_key, "projectedActualMinutes": 3020, "weeklyMaxMinutes": 3120,
    }]
    assert month_insights(source, now=NOW)["guards"][0]["label"] == label


def test_guard_labels_are_self_contained_and_severity_then_date_sorted():
    source = payload()
    source["planner"]["plan"]["summary"]["weekly"] = [
        {"key": "2042-W11", "projectedActualMinutes": 3020, "weeklyMaxMinutes": 3120},
        {"key": "2042-W10", "projectedActualMinutes": 3250, "weeklyMaxMinutes": 3120},
    ]
    source["days"][0]["rest_minutes"] = 30
    source["days"][1]["rest_minutes"] = 10
    source["planner"]["plan"]["days"][-1]["window"] = "09:00–17:05"
    for day in source["planner"]["plan"]["days"]:
        day["plannedAdditionalMinutes"] = 0
    source["planner"]["plan"]["days"][-1]["plannedAdditionalMinutes"] = 2530
    source["planner"]["plan"]["days"].append({
        "date": "2042-03-10", "plannedAdditionalMinutes": 3020,
        "plannedMinutes": 3020, "window": "—",
    })
    guards = month_insights(source, now=NOW)["guards"]
    assert [(guard["level"], guard["label"]) for guard in guards] == [
        ("breach", "3/3–3/9 주 52시간 2:10 초과 예상"),
        ("breach", "3/3 휴게 0:30 · 필요 1:00"),
        ("breach", "3/7(금) 17:05 퇴근 계획 · 16:00 상한 초과"),
        ("risk", "3/4 휴게 0:10 · 필요 0:30"),
        ("risk", "3/10–3/16 주 52시간까지 1:40 남음"),
    ]


@pytest.mark.parametrize("eligibility_basis", [True, False])
def test_anchored_today_expected_counts_recorded_today_once_in_recognized_units(eligibility_basis):
    source = payload()
    source.update(year=2026, month=7)
    source["derived"]["recognizedMinutes"] = 13612
    source["days"] = [
        {"date": date, "day_type": "workday", "work_minutes": worked,
         "recognized_minutes": worked, "rest_minutes": 60}
        for date, worked in [
            ("2026-07-01", 11452), ("2026-07-27", 500),
            ("2026-07-28", 623), ("2026-07-29", 604),
            ("2026-07-30", 433), ("2026-07-31", 0),
        ]
    ]
    plan = source["planner"]["plan"]
    plan["days"] = [
        {"date": "2026-07-30", "plannedMinutes": 463, "plannedAdditionalMinutes": 30, "window": "07:17–16:00"},
        {"date": "2026-07-31", "plannedMinutes": 470, "plannedAdditionalMinutes": 470, "window": "07:40–16:00"},
    ]
    plan["plannedTotalMinutes"] = 933
    if eligibility_basis:
        # Live plans total target-eligible minutes; excluded remote/unknown work makes
        # these far below recognition, so they must not drive the recognized forecast.
        plan["recognizedMinutes"], plan["forecastMinutes"] = 169, 669
    forecast = month_insights(
        source, now=dt.datetime(2026, 7, 30, 15, tzinfo=NOW.tzinfo),
    )["forecast"]
    assert forecast == {
        "recognizedMinutes": 13612, "expectedMinutes": 14112,
        "minMinutes": 13612, "maxMinutes": 14272,
    }


def test_expected_includes_confirmed_future_leave_with_and_without_plan_rows():
    source = payload()
    # Partial leave on a planned day: plannedAdditionalMinutes excludes the leave.
    source["days"][2]["timeoff_minutes"] = 240
    # Full-day leave has no plan row at all.
    source["days"].append({"date": "2042-03-06", "day_type": "workday", "work_minutes": 0,
                           "timeoff_minutes": 480, "rest_minutes": 0})
    assert month_insights(source, now=NOW)["forecast"]["expectedMinutes"] == 720 + 240 + 480 + 1000


def test_completed_week_breach_without_plan_rows_and_outside_month_is_excluded():
    source = payload()
    source.update(year=2042, month=3)
    source["days"] = [
        {"date": "2042-03-01", "day_type": "weekend", "work_minutes": 3121, "rest_minutes": 60},
        {"date": "2042-02-28", "day_type": "workday", "work_minutes": 999, "rest_minutes": 60},
    ]
    source["planner"]["plan"]["days"] = []
    source["planner"]["plan"]["summary"]["weekly"] = []
    assert month_insights(source, now=NOW)["guards"] == [{
        "key": "weekly_max", "level": "breach", "weekKey": "2042-W09",
        "label": "3/1–3/2 주 52시간 0:01 초과 예상", "minutes": 3121, "limitMinutes": 3120,
    }]


def test_future_ledger_rows_may_omit_zero_work_minutes():
    source = payload()
    expected = month_insights(source, now=NOW)
    for day in source["days"]:
        if day["date"] > NOW.date().isoformat():
            del day["work_minutes"]
    assert month_insights(source, now=NOW) == expected

def test_forecast_and_leave_now_respect_weekly_room_and_fixed_slots():
    source = payload()
    source["days"][0]["work_minutes"] = 2800
    source["planner"]["settings"]["dateOverrides"] = {"2042-03-05": 0}
    insights = month_insights(source, now=NOW)
    # Only 80 weekly minutes remain, less than Friday's attendance minimum.
    assert insights["forecast"]["maxMinutes"] <= 3120
    assert insights["leaveNow"]["feasible"] is False
    assert insights["leaveNow"]["shortfallMinutes"] > 0


def test_forecast_includes_future_full_day_leave_once_and_no_work_on_that_date():
    source = payload()
    source["days"][2].update(timeoff_minutes=480, recognized_minutes=480)
    source["planner"]["settings"]["dateOverrides"] = {"2042-03-07": 0}
    insights = month_insights(source, now=NOW)
    assert insights["forecast"]["minMinutes"] == 1200
    assert insights["forecast"]["maxMinutes"] == 1540


def test_forecast_late_today_keeps_recorded_work_without_impossible_extension():
    source = payload()
    source["days"] = source["days"][:2]
    late = NOW.replace(hour=23)
    forecast = month_insights(source, now=late)["forecast"]
    assert forecast["minMinutes"] == forecast["maxMinutes"] == 720
