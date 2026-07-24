from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INPUTS = ROOT / "fixtures" / "scenarios"
RESULTS = ROOT / "public" / "demo-data"
EXPECTED = {
    "balanced-month",
    "weekday-cap",
    "partial-leave-weekly-cap",
    "infeasible-target",
    "input-order-determinism",
}


def test_scenarios_have_reproducible_synthetic_provenance():
    names = {path.name.removesuffix(".input.json") for path in INPUTS.glob("*.input.json")}
    assert names == EXPECTED
    assert {path.name.removesuffix(".result.json") for path in RESULTS.glob("*.result.json")} == EXPECTED

    for path in sorted([*INPUTS.glob("*.json"), *RESULTS.glob("*.json")]):
        payload = json.loads(path.read_text(encoding="utf-8"))
        assert payload["dataOrigin"] == "synthetic"
        assert payload["generator"]["name"] == "constraint-work-planner-scenarios"
        assert payload["generator"]["version"] == "1"
        assert payload["generator"]["seed"] == 7601


def test_checked_in_scenarios_match_generator():
    completed = subprocess.run(
        [sys.executable, "scripts/generate_scenarios.py", "--check"],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    assert completed.returncode == 0, completed.stdout + completed.stderr


def test_reversed_input_has_identical_canonical_result():
    balanced = json.loads((RESULTS / "balanced-month.result.json").read_text(encoding="utf-8"))
    reversed_result = json.loads(
        (RESULTS / "input-order-determinism.result.json").read_text(encoding="utf-8")
    )

    assert balanced["result"] == reversed_result["result"]
