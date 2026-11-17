# Constraint Work Planner

A deterministic, vendor-neutral work-planning core for explaining how hard daily and weekly limits interact with recognized load and partial leave.

The public demo, generated fixtures, and screenshots are synthetic-only. The Python core can also accept already-normalized operational minutes from a private adapter; this repository contains no account system, backend connector, telemetry, arbitrary upload, credentials, or operational records.

## Current status

- Planner core, fixed-seed scenarios, and static product UI: verified in CI
- Public repository: released
- Live URL and career integration: pending

## Trust boundary

The core accepts only the normalized fields in `schema/work-month.schema.json`. `dataOrigin` is `synthetic` for public demo data or `operational` for a private adapter's normalized input. An adapter may set optional `availability.minWorkMinutes`; then the deterministic planner emits either zero planned work for that date or at least that minimum, failing closed with an explicit gap when no exact allocation is possible. The public demo and committed fixtures enforce `synthetic`; the core itself does not read environment variables, home directories, local caches, network resources, identifiers, or credentials.

This is an engineering demonstration, not legal, payroll, or compliance advice, and not an official integration with any workforce platform.

## Development

```bash
uv sync --extra dev
cargo build --release --bin work-planner-cli
uv run pytest -q
uvx ruff==0.16.0 check .
uv run python scripts/generate_scenarios.py --check
```

## Rust core and optional backend

`crates/work-planner` ports the model, feasibility, allocation, explanations,
insights, synthetic payloads and read-only demo routes. Rust 1.96.1 is pinned in
`rust-toolchain.toml`; no Python service is replaced or deployed.

Python is still the default. Build the CLI above, then opt in before importing:

```bash
WORK_PLANNER_BACKEND=rust uv run --extra dev python -m pytest -q
WORK_PLANNER_BACKEND=rust uv run python scripts/generate_scenarios.py --check
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```

The separate `work_planner_rust` transport package owns environment selection and
the local JSON-line subprocess. The pure core modules retain their existing
network/environment/home-access boundary. `WORK_PLANNER_RUST_BIN` can select an
explicit CLI path; otherwise the transport prefers `target/release/work-planner-cli`
and then `target/debug/work-planner-cli`. It never builds or silently falls back.
All existing public imports remain valid, including direct module imports.
The demo facade retains its observable Python LRU cache and passes its computed
Rust plans to Rust payload assembly, avoiding repeated allocation.

Parity tests use an independent Python process and the Rust CLI: all five
scenario fixtures, 100 deterministic Hypothesis planner/bounds examples, 100
Hypothesis insight examples, and demo/route/explanation cases. JSON object order
is immaterial; array order and floating-point values must agree exactly. Route
JSON bodies are compared after decoding, rather than by whitespace/key order.
The public-boundary scanner also covers `crates/`; no scanner allowlists or
frontend source manifests are changed.
