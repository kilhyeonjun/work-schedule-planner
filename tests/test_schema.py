from __future__ import annotations

import copy
import json
from pathlib import Path

import jsonschema
import pytest

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = json.loads((ROOT / "schema" / "work-month.schema.json").read_text(encoding="utf-8"))


def valid_input() -> dict:
    return {
        "dataOrigin": "synthetic",
        "generator": {"name": "fixed-seed", "version": "1", "seed": 7601},
        "period": "2042-03",
        "timezone": "UTC",
        "targetMinutes": 1320,
        "policy": {
            "weeklyLimitMinutes": 2400,
            "normalMinutes": 420,
            "maxMinutes": 600,
            "dateOverrides": {},
            "weekdayCaps": {"4": 360},
        },
        "days": [
            {
                "date": "2042-03-03",
                "dayType": "workday",
                "workedMinutes": 120,
                "recognizedMinutes": 180,
                "leaveMinutes": 60,
                "availability": {"available": True, "maxWorkMinutes": 600},
            },
            {
                "date": "2042-03-07",
                "dayType": "workday",
                "workedMinutes": 0,
                "recognizedMinutes": 0,
                "leaveMinutes": 0,
                "availability": {"available": True, "maxWorkMinutes": 600},
            },
        ],
    }


def test_schema_accepts_vendor_neutral_synthetic_input():
    jsonschema.validate(valid_input(), SCHEMA)


def test_schema_accepts_normalized_operational_input():
    payload = valid_input()
    payload["dataOrigin"] = "operational"

    jsonschema.validate(payload, SCHEMA)


@pytest.mark.parametrize(
    ("path", "value"),
    [
        (("employeeId",), "person-1"),
        (("email",), "sample@example.test"),
        (("days", 0, "notes"), "copied source note"),
        (("policy", "sourceEndpoint"), "https://example.test"),
    ],
)
def test_schema_rejects_fields_outside_public_contract(path, value):
    payload = copy.deepcopy(valid_input())
    cursor = payload
    for key in path[:-1]:
        cursor = cursor[key]
    cursor[path[-1]] = value

    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(payload, SCHEMA)


def test_schema_rejects_unsupported_origin():
    payload = valid_input()
    payload["dataOrigin"] = "anonymized"

    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(payload, SCHEMA)
