#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

TEXT_SUFFIXES = {".css", ".html", ".js", ".json", ".py", ".svg", ".ts", ".tsx"}
SCAN_DIRS = ("src", "schema", "fixtures", "public", "web")
PATTERNS = {
    "absolute_home_path": re.compile(r"(?:/Users/|/home/)[^\s\"']+"),
    "private_network": re.compile(
        r"\b(?:10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|"
        r"100\.(?:6[4-9]|[78]\d|9\d|1[01]\d|12[0-7])(?:\.\d{1,3}){2})\b"
    ),
    "private_product_marker": re.compile(r"(?i)\b(?:flex|gameduo|tailnet|hermes profile)\b"),
    "sensitive_field": re.compile(
        r'(?i)["\'](?:employeeId|customerId|userId|email|department|endpoint|cookie|'
        r'authorization|authState|token|header|rawResponse|sourceResponse)["\']\s*:'
    ),
}


def scan(root: Path) -> dict:
    findings = []
    scanned = 0
    for directory in SCAN_DIRS:
        base = root / directory
        if not base.exists():
            continue
        for path in sorted(candidate for candidate in base.rglob("*") if candidate.is_file()):
            if path.suffix.lower() not in TEXT_SUFFIXES:
                continue
            scanned += 1
            text = path.read_text(encoding="utf-8", errors="ignore")
            for line_number, line in enumerate(text.splitlines(), 1):
                for category, pattern in PATTERNS.items():
                    if pattern.search(line):
                        findings.append(
                            {
                                "path": path.relative_to(root).as_posix(),
                                "line": line_number,
                                "category": category,
                                "match": "[REDACTED]",
                            }
                        )
    counts = {category: 0 for category in PATTERNS}
    for finding in findings:
        counts[finding["category"]] += 1
    return {"ok": not findings, "scannedFiles": scanned, "categoryCounts": counts, "findings": findings}


def main() -> int:
    parser = argparse.ArgumentParser(description="Redacted public-release boundary scan")
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    result = scan(args.root.resolve())
    print(json.dumps(result, sort_keys=True))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
