# Python core port plan

- `model.py` → `model.rs`: normalized input parsing and ISO calendar identity.
- `feasibility.py` → `feasibility.rs`: daily/weekly limits and reachable bounds.
- `planner.py` → `planner.rs`: exact optional-attendance activation, fixed commitments and deterministic water filling.
- `explain.py` → `explain.rs`: identical explanation strings and ordered reasons.
- `insights.py` → `insights.rs`: KST ledger projections, guards and target pace.
- `demo_payload.py` and `demo_routes.py` → corresponding Rust modules; a JSON-line CLI exposes these entrypoints to the opt-in Python backend shim.

Planner minute arithmetic uses signed 64-bit values, with 128-bit cross-products for exact capacity-weighted comparisons. Both public backends now enforce the same generous safety domain: finite minute quantities within ±10,000,000 and at most 366 entries per `days` collection. The normalized model still requires non-negative integer minutes. These limits are deliberately much wider than the JSON schema, leave all fixtures/demo payloads unchanged, and prevent Python's unbounded integers from becoming unchecked Rust overflow. Generator seeds and other non-minute metadata are not limited. JSON decoding preserves arbitrary-size integers until validation can return a Python-compatible exception.

The Python CLI requires the `python-parity` Cargo feature to preserve arbitrary-size integers during JSON decoding. The library does not enable this feature by default.

Insights preserve Python int/float/bool operand identity, operand-order-sensitive min/max ties, floor division, and nearest-even `round`. Explicit `int()` sites share one fallible coercion helper (including float truncation, signed/underscored/Unicode decimal strings); invalid values are never replaced by zero. ISO date/time parsing accepts Python 3.11 basic and extended calendar/week dates, basic/extended times, fractions and timezone offsets. The Python facade feature-detects newer runtime ISO syntax changes; native Rust defaults to 3.11 behavior.

Days are stably sorted by date. Water-fill ties compare exact rational or integral load followed by date. Weekly groups are explicitly sorted. Activation compares the full Python lexicographic tuple, including projected-load lists and selected-date lists. JSON object key order is not semantic; array ordering is preserved, and any observable traversal that Python derives from insertion order must use source-order vectors rather than unordered maps.

Python remains the default and reference backend. Parity is checked against all checked-in synthetic scenarios and generated inputs; the unchanged Python suite is also run through the Rust CLI. Golden Rust tests cover the same fixtures, while core unit tests cover limits, optional minimums, fixed conflicts and deterministic ordering. No Python core is removed and no runtime service is deployed.
