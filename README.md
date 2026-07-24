# Constraint Work Planner

A deterministic, vendor-neutral work-planning core for explaining how hard daily and weekly limits interact with recognized load and partial leave.

The public demo, generated fixtures, and screenshots are synthetic-only. The Python core can also accept already-normalized operational minutes from a private adapter; this repository contains no account system, backend connector, telemetry, arbitrary upload, credentials, or operational records.

## Current status

- Planner core, fixed-seed scenarios, and static product UI: verified in CI
- Public repository: released
- Live URL and career integration: pending

## Trust boundary

The core accepts only the normalized fields in `schema/work-month.schema.json`. `dataOrigin` is `synthetic` for public demo data or `operational` for a private adapter's normalized input. The public demo and committed fixtures enforce `synthetic`; the core itself does not read environment variables, home directories, local caches, network resources, identifiers, or credentials.

This is an engineering demonstration, not legal, payroll, or compliance advice, and not an official integration with any workforce platform.

## Development

```bash
uv sync --extra dev
uv run pytest -q
uvx ruff==0.16.0 check .
uv run python scripts/generate_scenarios.py --check
```
