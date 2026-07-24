#!/usr/bin/env python3
from __future__ import annotations

import argparse
import copy
import datetime as dt
import json
import random
from pathlib import Path
from typing import Any

from work_planner import plan_month

SEED = 7601
GENERATOR = {"name": "constraint-work-planner-scenarios", "version": "1", "seed": SEED}
ROOT = Path(__file__).resolve().parents[1]


def _workdays() -> list[dt.date]:
    cursor = dt.date(2042, 3, 3)
    days: list[dt.date] = []
    while len(days) < 10:
        if cursor.weekday() < 5:
            days.append(cursor)
        cursor += dt.timedelta(days=1)
    return days


def _base_input() -> dict[str, Any]:
    rng = random.Random(SEED)
    days = []
    for index, date in enumerate(_workdays()):
        worked = rng.choice([180, 240, 300]) if index < 3 else 0
        leave = 120 if index == 2 else 0
        days.append(
            {
                "date": date.isoformat(),
                "dayType": "workday",
                "workedMinutes": worked,
                "recognizedMinutes": worked + leave,
                "leaveMinutes": leave,
                "availability": {"available": True, "maxWorkMinutes": 600},
            }
        )
    baseline = sum(day["recognizedMinutes"] for day in days)
    return {
        "dataOrigin": "synthetic",
        "generator": dict(GENERATOR),
        "period": "2042-03",
        "timezone": "UTC",
        "targetMinutes": baseline + 3000,
        "policy": {
            "weeklyLimitMinutes": 2400,
            "normalMinutes": 420,
            "maxMinutes": 600,
            "dateOverrides": {},
            "weekdayCaps": {},
        },
        "days": days,
    }


def scenarios() -> dict[str, dict[str, Any]]:
    balanced = _base_input()
    weekday_cap = copy.deepcopy(balanced)
    weekday_cap["policy"]["weekdayCaps"] = {"4": 360}

    partial_leave = copy.deepcopy(balanced)
    partial_leave["days"][4]["leaveMinutes"] = 180
    partial_leave["days"][4]["recognizedMinutes"] = 180
    partial_leave["policy"]["weeklyLimitMinutes"] = 1800
    partial_leave["targetMinutes"] = sum(
        day["recognizedMinutes"] for day in partial_leave["days"]
    ) + 2500

    infeasible = copy.deepcopy(balanced)
    infeasible["targetMinutes"] = 30000

    reversed_input = copy.deepcopy(balanced)
    reversed_input["days"].reverse()

    return {
        "balanced-month": balanced,
        "weekday-cap": weekday_cap,
        "partial-leave-weekly-cap": partial_leave,
        "infeasible-target": infeasible,
        "input-order-determinism": reversed_input,
    }


def _text(payload: dict[str, Any]) -> str:
    return json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def expected_files(root: Path) -> dict[Path, str]:
    outputs: dict[Path, str] = {}
    for name, payload in scenarios().items():
        outputs[root / "fixtures" / "scenarios" / f"{name}.input.json"] = _text(payload)
        outputs[root / "public" / "demo-data" / f"{name}.result.json"] = _text(
            {
                "dataOrigin": "synthetic",
                "generator": dict(GENERATOR),
                "scenario": name,
                "result": plan_month(payload),
            }
        )
    return outputs


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate fixed-seed synthetic planner evidence")
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--root", type=Path, default=ROOT)
    args = parser.parse_args()

    mismatches = []
    for path, content in expected_files(args.root).items():
        if args.check:
            if not path.exists() or path.read_text(encoding="utf-8") != content:
                mismatches.append(path.relative_to(args.root).as_posix())
            continue
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
    if mismatches:
        print(json.dumps({"ok": False, "mismatches": mismatches}, sort_keys=True))
        return 1
    print(json.dumps({"ok": True, "checked": args.check, "files": len(expected_files(args.root))}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
