from __future__ import annotations

import copy
import json
import random

from hypothesis import given
from hypothesis import strategies as st

from work_planner import plan_month

from .test_schema import valid_input


@given(st.integers(min_value=0, max_value=5000), st.integers(min_value=0, max_value=2**32 - 1))
def test_input_order_does_not_change_result(target, seed):
    payload = valid_input()
    payload["targetMinutes"] = target
    shuffled = copy.deepcopy(payload)
    random.Random(seed).shuffle(shuffled["days"])

    assert plan_month(payload) == plan_month(shuffled)


@given(st.integers(min_value=0, max_value=5000))
def test_result_is_byte_deterministic_and_never_exceeds_caps(target):
    payload = valid_input()
    payload["targetMinutes"] = target

    first = plan_month(payload)
    second = plan_month(copy.deepcopy(payload))

    assert json.dumps(first, sort_keys=True, separators=(",", ":")) == json.dumps(
        second, sort_keys=True, separators=(",", ":")
    )
    assert first["constraints"]["dailyCapsPassed"] is True
    assert first["constraints"]["weeklyCapsPassed"] is True
