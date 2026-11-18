from __future__ import annotations

import copy
import json
import subprocess

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

import work_planner_rust as transport
from work_planner.validation import MAX_MINUTES, validate_limits

from .test_insights import NOW
from .test_insights import payload as insight_payload
from .test_rust_parity import FIXTURES, ROOT
from .test_schema import valid_input


def insights(oracle, source, constraints=None):
    return oracle("month_insights", payload=source, now=NOW.isoformat(),
                  projection_constraints=constraints, exception_type_only=True)


def canonical_constraints(source):
    days = [{"date": day["date"], "dayType": day["day_type"],
             "workedMinutes": day.get("work_minutes", 0),
             "recognizedMinutes": day.get("work_minutes", 0), "leaveMinutes": 0,
             "availability": {"available": day["date"] >= "2042-03-04",
                              "minWorkMinutes": 0, "maxWorkMinutes": 600}}
            for day in source["days"]]
    return {"dataOrigin": "synthetic", "period": "2042-03", "timezone": "Asia/Seoul",
            "targetMinutes": 1720, "recognizedBaselineMinutes": 720, "forecastMinutes": 1720,
            "policy": {"weeklyLimitMinutes": 3120, "normalMinutes": 500, "maxMinutes": 600,
                       "dateOverrides": {}, "weekdayCaps": {}}, "days": days}


@pytest.mark.parametrize("fixed", [500, 500.0, 500.9, "5_00", " +500 ", "٥٠٠", True,
                                   None, "", "500.0", "bad", [], [500], {"minutes": []}])
def test_fixed_override_coercion_matches_int(oracle, fixed):
    source = insight_payload()
    source["planner"]["settings"]["dateOverrides"] = {"2042-03-05": fixed}
    insights(oracle, source)


@pytest.mark.parametrize("start,end", [
    ("0900", "1300"), ("09", "13"), ("T09:00", "T13:00"),
    ("090000", "130000"), ("09:00:00.1234567", "13:00:00,9876543"),
    ("09:00+09:00", "13:00Z"), ("09:00+01:99", "13:00-0200"),
    ("09.5", "13.5"), ("09:00,5", "13:00.5"),
    ("09:0", "13:00"), ("090", "1300"), (None, "13:00"), ("24:00", "13:00"),
])
def test_core_time_iso_forms_match_python(oracle, start, end):
    source = insight_payload()
    source["planner"]["settings"]["dateCoreTimes"] = {"2042-03-05": {"start": start, "end": end}}
    insights(oracle, source)


@pytest.mark.parametrize("value", [None, [], {}, 0, "bad", [None]])
@pytest.mark.parametrize("path", [
    ("days",), ("planner",), ("planner", "plan", "days"),
    ("planner", "plan", "summary"), ("planner", "plan", "summary", "weekly"),
    ("planner", "settings"), ("planner", "settings", "dateOverrides"),
    ("planner", "settings", "dateCoreTimes"),
])
def test_malformed_containers_raise_python_exception_without_killing_cli(oracle, path, value):
    source = insight_payload()
    cursor = source
    for key in path[:-1]:
        cursor = cursor[key]
    cursor[path[-1]] = value
    insights(oracle, source)
    assert transport.call("plan_month", payload=valid_input())["status"] == "insufficient_slots"


@pytest.mark.parametrize("value", [None, {}, "bad", [None], [{"date": "2042-03-04"}]])
def test_malformed_projection_days_return_errors(oracle, value):
    source = insight_payload()
    constraints = canonical_constraints(source)
    constraints["days"] = value
    insights(oracle, source, constraints)
    transport.call("plan_month", payload=valid_input())


@pytest.mark.parametrize("field", ["targetMinutes", "workedMinutes", "recognizedMinutes", "weeklyLimitMinutes"])
@pytest.mark.parametrize("value", [MAX_MINUTES + 1, 2**63 - 1, 2**100, -(2**100)])
def test_huge_minutes_are_rejected_consistently(oracle, field, value):
    source = valid_input()
    if field == "weeklyLimitMinutes":
        source["policy"][field] = value
    elif field in {"workedMinutes", "recognizedMinutes"}:
        source["days"][0][field] = value
    else:
        source[field] = value
    oracle("plan_month", payload=source)


@pytest.mark.parametrize("date", ["20420303", "2042-W10", "2042W10", "2042-W10-1", "2042W101",
                                  "2042-3-03", "2042-03-3", "0000-01-01", "2042W10-1"])
def test_date_forms_and_invalid_dates_match_python(oracle, date):
    source = valid_input()
    source["days"][0]["date"] = date
    oracle("plan_month", payload=source, exception_type_only=True)


NUMERICS = st.one_of(st.integers(-1000, 1000), st.floats(-1000, 1000, allow_nan=False),
                     st.sampled_from(["5_00", " +500 ", "500.0", "", "x", None, True, [], {}]))


@settings(max_examples=100, deadline=None, derandomize=True)
@given(NUMERICS)
def test_generated_int_coercions(oracle, value):
    source = insight_payload()
    source["planner"]["settings"]["dateOverrides"] = {"2042-03-05": {"minutes": value}}
    insights(oracle, source)


@settings(max_examples=100, deadline=None, derandomize=True)
@given(NUMERICS, st.sampled_from([
    ("days", 0, "work_minutes"), ("days", 0, "recognized_minutes"),
    ("days", 1, "rest_minutes"), ("planner", "settings", "longDayMinutes"),
    ("planner", "plan", "days", 1, "plannedAdditionalMinutes"),
    ("derived", "targetMinutes"), ("planner", "plan", "todayAction", "remainingTodayMinutes"),
]))
def test_generated_insight_numeric_types(oracle, value, path):
    source = insight_payload()
    cursor = source
    for key in path[:-1]:
        cursor = cursor[key]
    cursor[path[-1]] = value
    insights(oracle, source)


@st.composite
def iso_times(draw):
    hour, minute, second = draw(st.tuples(st.integers(0, 23), st.integers(0, 59), st.integers(0, 59)))
    form = draw(st.sampled_from(["hour", "basic", "extended", "seconds", "fraction", "hour_fraction", "minute_fraction"]))
    value = {"hour": f"{hour:02}", "basic": f"{hour:02}{minute:02}",
             "extended": f"{hour:02}:{minute:02}", "seconds": f"{hour:02}{minute:02}{second:02}",
             "fraction": f"{hour:02}:{minute:02}:{second:02}.1234567",
             "hour_fraction": f"{hour:02}.25", "minute_fraction": f"{hour:02}:{minute:02},5"}[form]
    return draw(st.sampled_from(["", "T"])) + value + draw(st.sampled_from(["", "Z", "+09:00", "-0230"]))


@settings(max_examples=100, deadline=None, derandomize=True)
@given(iso_times(), iso_times())
def test_generated_iso_times(oracle, start, end):
    source = insight_payload()
    source["planner"]["settings"]["dateCoreTimes"] = {"2042-03-05": {"start": start, "end": end}}
    insights(oracle, source)


@settings(max_examples=100, deadline=None, derandomize=True)
@given(st.one_of(st.none(), st.integers(), st.text(max_size=10),
                 st.lists(st.none(), max_size=3), st.dictionaries(st.text(max_size=4), st.none(), max_size=3)),
       st.sampled_from(["days", "policy", "recognizedBaselineMinutes"]))
def test_generated_projection_containers(oracle, value, key):
    source = insight_payload()
    constraints = canonical_constraints(source)
    constraints[key] = value
    insights(oracle, source, constraints)


@settings(max_examples=100, deadline=None, derandomize=True)
@given(st.integers(min_value=10_000_001, max_value=2**200), st.booleans())
def test_generated_huge_minutes(oracle, value, negative):
    source = valid_input()
    source["targetMinutes"] = -value if negative else value
    oracle("plan_month", payload=source)


def test_limits_leave_all_fixtures_and_demo_payloads_unchanged(oracle):
    for path in FIXTURES:
        source = json.loads(path.read_text())
        validate_limits(source)
        result = oracle("plan_month", payload=source)
        expected = json.loads((ROOT / "public" / "demo-data" / path.name.replace(".input.", ".result.")).read_text())
        assert result == expected["result"]
    oracle("month_payload", target=7800)
    oracle("month_payload", year=2042, month=2)


def test_transport_recovers_after_child_death_and_semantic_error():
    source = valid_input()
    expected = transport.call("plan_month", payload=source)
    process = transport._process
    process.kill()
    process.wait()
    assert transport.call("plan_month", payload=source) == expected
    bad = canonical_constraints(insight_payload())
    bad["days"] = None
    with pytest.raises(TypeError):
        transport.call("month_insights", payload=insight_payload(), now=NOW.isoformat(), projection_constraints=bad)
    assert transport._process is None
    assert transport.call("plan_month", payload=source) == expected


def test_cli_survives_bad_request_then_handles_next_line():
    source = valid_input()
    transport.call("plan_month", payload=source)
    binary = transport._process.args[0]
    process = subprocess.Popen([binary], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
    requests = [
        {"op": "month_insights", "args": {"payload": insight_payload(), "now": NOW.isoformat(),
                                         "projection_constraints": {"days": None}}},
        {"op": "plan_month", "args": {"payload": source}},
    ]
    output, _ = process.communicate("".join(json.dumps(request) + "\n" for request in requests))
    first, second = map(json.loads, output.splitlines())
    assert first["error"]["type"] == "TypeError"
    assert second["ok"] is True
    assert process.returncode == 0


def test_container_length_bound_is_shared(oracle):
    source = valid_input()
    source["days"] = copy.deepcopy(source["days"][:1]) * 367
    oracle("plan_month", payload=source)


@pytest.mark.parametrize("key", ["4", " +4 ", "0_4", "٤", "-1", "wat", "4.0"])
def test_weekday_integer_key_coercion(oracle, key):
    source = valid_input()
    source["policy"]["weekdayCaps"] = {key: 360}
    oracle("plan_month", payload=source, exception_type_only=True)


@settings(max_examples=100, deadline=None, derandomize=True)
@given(NUMERICS, st.sampled_from(["targetMinutes", "weeklyLimitMinutes", "workedMinutes", "minWorkMinutes"]))
def test_generated_normalized_minute_types_are_not_coerced(oracle, value, key):
    source = valid_input()
    if key == "weeklyLimitMinutes":
        source["policy"][key] = value
    elif key == "workedMinutes":
        source["days"][0][key] = value
    elif key == "minWorkMinutes":
        source["days"][0]["availability"][key] = value
    else:
        source[key] = value
    oracle("plan_month", payload=source, exception_type_only=True)


@pytest.mark.parametrize("rest", [0.0, 30.0, 60.0, 120.0])
def test_float_rest_preserves_python_min_max_tie_operand_types(oracle, rest):
    source = insight_payload()
    source["days"][1]["rest_minutes"] = rest
    insights(oracle, source)
