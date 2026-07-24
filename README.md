# Constraint Work Planner

A deterministic, vendor-neutral work-planning core for explaining how hard daily and weekly limits interact with recognized load and partial leave.

This repository is a local release candidate. Its inputs, generated results, and future screenshots are synthetic-only. It has no account system, backend service, telemetry, arbitrary upload, or connection to an operational workforce system.

## Current status

- Planner core and fixed-seed scenarios: under verification
- Static product UI: design approval pending
- Public repository, license, live URL, and career integration: not released

## Trust boundary

The public core accepts only the schema in `schema/work-month.schema.json`. It does not read environment variables, home directories, local caches, or network resources. Every input and output is stamped `dataOrigin: synthetic`.

This is an engineering demonstration, not legal, payroll, or compliance advice, and not an official integration with any workforce platform.

## Development

```bash
uv sync --extra dev
uv run pytest -q
uvx ruff==0.16.0 check .
uv run python scripts/generate_scenarios.py --check
```
