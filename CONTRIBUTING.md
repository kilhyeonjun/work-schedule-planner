# Contributing

The repository is not open for external contributions before its first public release.

For local verification, run:

```bash
uv sync --extra dev --frozen
uvx ruff==0.16.0 check .
uv run pytest -q
uv run python scripts/generate_scenarios.py --check
uv run python scripts/scan_public_boundary.py
```

Changes must preserve deterministic output, synthetic provenance, hard-limit invariants, and the zero-network runtime boundary.
