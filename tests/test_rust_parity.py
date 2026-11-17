from __future__ import annotations

import datetime as dt
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from work_planner_rust import call

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = sorted((ROOT / "fixtures" / "scenarios").glob("*.input.json"))


@pytest.fixture(scope="module")
def oracle():
    process = subprocess.Popen(
        [sys.executable, "-m", "tests.reference_backend"], cwd=ROOT,
        env={**os.environ, "WORK_PLANNER_BACKEND": "python"},
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, encoding="utf-8",
    )

    def compare(op, **args):
        process.stdin.write(json.dumps({"op": op, "args": args}) + "\n")
        process.stdin.flush()
        expected = json.loads(process.stdout.readline())
        if expected["ok"]:
            actual = call(op, **args)
            assert actual == expected["result"]
            return actual
        with pytest.raises((ValueError, TypeError, AssertionError)) as raised:
            call(op, **args)
        assert type(raised.value).__name__ == expected["error"]["type"]
        assert str(raised.value) == expected["error"]["message"]
        return None

    yield compare
    process.stdin.close()
    process.wait()
    process.stdout.close()


@pytest.mark.parametrize("path", FIXTURES, ids=lambda p: p.stem)
def test_every_scenario_matches_python(oracle, path):
    oracle("plan_month", payload=json.loads(path.read_text()))


@st.composite
def months(draw):
    count = draw(st.integers(1, 10))
    start = dt.date(2042, 3, 1)
    days = []
    for index in range(count):
        date = start + dt.timedelta(days=index)
        worked = draw(st.integers(0, 120))
        leave = draw(st.integers(0, 120))
        maximum = draw(st.integers(0, 360))
        minimum = draw(st.integers(0, maximum))
        days.append({
            "date": date.isoformat(), "dayType": draw(st.sampled_from(["workday", "weekend", "holiday"])),
            "workedMinutes": worked, "recognizedMinutes": worked + leave, "leaveMinutes": leave,
            "availability": {"available": draw(st.booleans()), "minWorkMinutes": minimum,
                             "maxWorkMinutes": maximum},
        })
    overrides = {}
    if draw(st.booleans()):
        day = draw(st.sampled_from(days))
        overrides[day["date"]] = draw(st.integers(0, 360))
    return {
        "dataOrigin": draw(st.sampled_from(["synthetic", "operational"])),
        "generator": {"name": "hypothesis", "version": "1", "seed": 7601},
        "period": "2042-03", "timezone": "Asia/Seoul", "targetMinutes": draw(st.integers(0, 5000)),
        "policy": {"weeklyLimitMinutes": draw(st.integers(0, 2400)), "normalMinutes": 300,
                   "maxMinutes": draw(st.integers(0, 600)), "dateOverrides": overrides,
                   "weekdayCaps": draw(st.dictionaries(st.sampled_from([str(i) for i in range(7)]), st.integers(0, 360))),
                   "allocationMode": draw(st.sampled_from(["equal", "capacity_weighted"]))},
        "days": days,
    }


@settings(max_examples=100, deadline=None, derandomize=True)
@given(months())
def test_generated_planner_and_bounds_match_python(oracle, payload):
    oracle("plan_month", payload=payload)
    oracle("additional_work_bounds", payload=payload)


@settings(max_examples=100, deadline=None, derandomize=True)
@given(st.integers(0, 12000), st.integers(0, 1439), st.booleans())
def test_generated_insights_match_python(oracle, recognized, time, aware):
    payload = {
        "dataOrigin": "synthetic", "year": 2042, "month": 3,
        "days": [{"date": f"2042-03-{day:02}", "day_type": "workday",
                  "work_minutes": recognized if day == 3 else 0,
                  "recognized_minutes": recognized if day == 3 else 0,
                  "rest_minutes": 60, "is_ongoing": day == 4} for day in [3, 4, 5, 7]],
        "derived": {"targetMinutes": 7200, "fixedOtMinutes": 7800, "maxMinutes": 9000},
        "planner": {"settings": {"normalDayMinutes": 500, "longDayMinutes": 719, "shortDayMinutes": 285},
                    "plan": {"days": [{"date": f"2042-03-{day:02}", "plannedAdditionalMinutes": 300,
                                       "window": "09:00–16:00"} for day in [4, 5, 7]],
                             "summary": {"weekly": []},
                             "todayAction": {"workedMinutes": 0, "remainingTodayMinutes": 300}}},
    }
    if aware:
        payload["planner"]["targetOptions"] = None
    now = dt.datetime(2042, 3, 4, time // 60, time % 60,
                      tzinfo=dt.timezone(dt.timedelta(hours=9)) if aware else None)
    oracle("month_insights", payload=payload, now=now.isoformat())


@pytest.mark.parametrize("target,normal,long,short", [
    (60, 500, 719, 285), (781, 500, 719, 285), (3900, 500, 719, 285),
    (7800, 500, 719, 285), (9000, 500, 719, 285), (11340, 500, 719, 285),
    (7800, 285, 285, 285), (7800, 600, 700, 300),
])
def test_demo_payloads_match_python(oracle, target, normal, long, short):
    oracle("month_payload", target=target, normal=normal, long=long, short=short)


@pytest.mark.parametrize("year,month", [(2041, 12), (2042, 2), (2042, 12)])
def test_archive_months_and_future_clamp_match_python(oracle, year, month):
    oracle("month_payload", year=year, month=month)


def test_archive_index_matches_python(oracle):
    oracle("archive_payload")


@pytest.mark.parametrize("method,path,query", [
    ("GET", "/", ""), ("POST", "/demo/api/month", ""), ("GET", "/missing", ""),
    ("GET", "/demo/api/archive", ""), ("GET", "/demo/api/month", ""),
    ("GET", "/demo/api/month", "year=x&month=99&target=-7"),
    ("GET", "/demo/api/month", "target=999999&normal=600&long=650&short=300"),
])
def test_routes_match_python(oracle, method, path, query):
    oracle("route", method=method, path=path, query_string=query)


@pytest.mark.parametrize("status,gap", [("planned", 0), ("satisfied", 0), ("insufficient_slots", 42), ("over_target", 0)])
def test_explanations_match_python(oracle, status, gap):
    oracle("explain_result", status=status, gap_minutes=gap)


def test_day_explanations_match_python(oracle):
    payload = json.loads(FIXTURES[0].read_text())
    for day in payload["days"]:
        for additional in [0, 60]:
            oracle("explain_day", day=day, additional=additional, daily_cap=day["workedMinutes"] + additional)
