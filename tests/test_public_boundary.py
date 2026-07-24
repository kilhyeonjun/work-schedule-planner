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


def test_boundary_scan_allows_only_canonical_visible_flex_branding(tmp_path):
    web = tmp_path / "web"
    web.mkdir()
    (web / "allowed.tsx").write_text(
        "❯ flex-planner\n<title>Flex 근무 플래너</title>\nFlex에 기록되지 않음\n",
        encoding="utf-8",
    )
    assert _scan(tmp_path).returncode == 0

    (web / "leak.tsx").write_text("Flex private adapter", encoding="utf-8")
    completed = _scan(tmp_path)
    assert completed.returncode == 1
    assert json.loads(completed.stdout)["categoryCounts"]["private_product_marker"] == 1


def test_boundary_scan_ignores_generated_dependencies_but_not_web_source(tmp_path):
    dependency = tmp_path / "web" / "app" / "node_modules" / "vendor.js"
    dependency.parent.mkdir(parents=True)
    dependency.write_text("Flex private adapter", encoding="utf-8")
    assert _scan(tmp_path).returncode == 0

    source = tmp_path / "web" / "app" / "src" / "leak.ts"
    source.parent.mkdir()
    source.write_text("Flex private adapter", encoding="utf-8")
    assert _scan(tmp_path).returncode == 1


def test_boundary_scan_cannot_bypass_mixed_brand_scripts_or_dist(tmp_path):
    probes = {
        "web/mixed.tsx": "❯ flex-planner Flex private adapter",
        "scripts/private.py": "adapter = 'Flex private adapter'",
        "scripts/private.sh": "adapter='Flex private adapter'",
        "scripts/lower.sh": "adapter='flex private adapter'",
        "scripts/upper.sh": "adapter='FLEX private adapter'",
        "web/app/dist/private.js": "const adapter = 'Flex private adapter'",
    }
    for relative, content in probes.items():
        path = tmp_path / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")

    completed = _scan(tmp_path)
    result = json.loads(completed.stdout)

    assert completed.returncode == 1
    assert {finding["path"] for finding in result["findings"]} == set(probes)
