from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _scan(root: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "scan_public_boundary.py"), "--root", str(root)],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )


def test_public_release_surfaces_pass_redacted_boundary_scan():
    completed = _scan(ROOT)
    result = json.loads(completed.stdout)

    assert completed.returncode == 0
    assert result["ok"] is True
    assert result["findings"] == []


def test_boundary_scan_reports_category_without_echoing_value(tmp_path):
    marker = "/Users/example/private-source.json"
    public = tmp_path / "public"
    public.mkdir()
    (public / "demo.json").write_text(json.dumps({"source": marker}), encoding="utf-8")

    completed = _scan(tmp_path)
    result = json.loads(completed.stdout)

    assert completed.returncode == 1
    assert result["findings"] == [
        {
            "category": "absolute_home_path",
            "line": 1,
            "match": "[REDACTED]",
            "path": "public/demo.json",
        }
    ]
    assert marker not in completed.stdout
