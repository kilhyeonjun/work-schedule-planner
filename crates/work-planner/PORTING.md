# Python core port plan

- `model.py` → `model.rs`: normalized input parsing and ISO calendar identity.
- `feasibility.py` → `feasibility.rs`: daily/weekly limits and reachable bounds.
- `planner.py` → `planner.rs`: exact optional-attendance activation, fixed commitments and deterministic water filling.
- `explain.py` → `explain.rs`: identical explanation strings and ordered reasons.
- `insights.py` → `insights.rs`: KST ledger projections, guards and target pace.
- `demo_payload.py` and `demo_routes.py` → corresponding Rust modules; a JSON-line CLI exposes these entrypoints to the opt-in Python backend shim.

Minute arithmetic stays integral (signed 64-bit values cover the schema's bounded inputs, with wider cross-products for exact capacity-weighted rational comparisons). Python integers are unbounded; schema-valid inputs never approach this representation limit. Reachability uses explicit bounded sets instead of Python arbitrary-width integer bitsets. Float operations preserve Python operation order. Python `round` is nearest-even; decimal-place rounding must match binary-float Python rounding rather than Rust's default ties-away rule.

Days are stably sorted by date. Water-fill ties compare exact rational or integral load followed by date. Weekly groups are explicitly sorted. Activation compares the full Python lexicographic tuple, including projected-load lists and selected-date lists. JSON object key order is not semantic; array ordering is preserved, and any observable traversal that Python derives from insertion order must use source-order vectors rather than unordered maps.

Python remains the default and reference backend. Parity is checked against all checked-in synthetic scenarios and generated inputs; the unchanged Python suite is also run through the Rust CLI. Golden Rust tests cover the same fixtures, while core unit tests cover limits, optional minimums, fixed conflicts and deterministic ordering. No Python core is removed and no runtime service is deployed.
