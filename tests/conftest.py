from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from work_planner_rust import call, route_response

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="module")
def oracle():
    process = subprocess.Popen(
        [sys.executable, "-m", "tests.reference_backend"], cwd=ROOT,
        env={**os.environ, "WORK_PLANNER_BACKEND": "python"},
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, encoding="utf-8",
    )

    def compare(op, *, exception_type_only=False, **args):
        process.stdin.write(json.dumps({"op": op, "args": args}) + "\n")
        process.stdin.flush()
        expected = json.loads(process.stdout.readline())
        if expected["ok"]:
            actual = list(route_response(**args)) if op == "route_text" else call(op, **args)
            assert actual == expected["result"]
            return actual
        with pytest.raises((ValueError, TypeError, AssertionError, KeyError, AttributeError, OverflowError)) as raised:
            call(op, **args)
        assert type(raised.value).__name__ == expected["error"]["type"]
        if not exception_type_only:
            assert str(raised.value) == expected["error"]["message"]
        return None

    yield compare
    process.stdin.close()
    process.wait()
    process.stdout.close()
