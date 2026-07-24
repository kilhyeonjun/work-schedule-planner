from __future__ import annotations

import ast
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src" / "work_planner"


def test_public_core_has_no_network_environment_or_home_access():
    forbidden_imports = {"http", "os", "requests", "socket", "urllib"}
    forbidden_calls = {"home", "getenv", "get_environ"}
    findings: list[str] = []

    for path in sorted(SRC.glob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                findings.extend(
                    f"{path.name}:import:{alias.name}"
                    for alias in node.names
                    if alias.name.split(".")[0] in forbidden_imports
                )
            elif isinstance(node, ast.ImportFrom) and (node.module or "").split(".")[0] in forbidden_imports:
                findings.append(f"{path.name}:import:{node.module}")
            elif (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Attribute)
                and node.func.attr in forbidden_calls
            ):
                findings.append(f"{path.name}:call:{node.func.attr}")

    assert findings == []
