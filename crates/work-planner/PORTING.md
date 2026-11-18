# Python core port plan

- `model.py` → `model.rs`: normalized input parsing and ISO calendar identity.
- `feasibility.py` → `feasibility.rs`: daily/weekly limits and reachable bounds.
- `planner.py` → `planner.rs`: exact optional-attendance activation, fixed commitments and deterministic water filling.
- `explain.py` → `explain.rs`: identical explanation strings and ordered reasons.
- `insights.py` → `insights.rs`: KST ledger projections, guards and target pace.
- `demo_payload.py` and `demo_routes.py` → corresponding Rust modules; a JSON-line CLI exposes these entrypoints to the opt-in Python backend shim.

Planner minute arithmetic uses signed 64-bit values, with 128-bit cross-products for exact capacity-weighted comparisons. Public Rust work-month planning and additional-work bounds enforce a 44,640-minute target, a 10,080-minute weekly limit, a 1,440-minute daily limit, and at most 31 days. The normalized model requires non-negative integer minutes. Insights' internal ledger projections and the Python reference keep the broader phase-1 safety domain (±10,000,000 minutes and up to 366 entries per `days` collection). Generator seeds and other non-minute metadata are not limited. The parity CLI preserves arbitrary-size JSON integers until validation can return a Python-compatible exception.

The operational adapter calls `allocate_flex_projection`, which takes a bounded additional-work amount instead of a total target. It allows derived ledger baselines to exceed the public 1,440-minute field limit (up to 4,320 worked and 5,760 recognized minutes from summing validated source buckets and existing advice). The 31-date, daily allocation, weekly and additional-work limits remain enforced; the projection entry point is not exposed by the parity CLI.

The Python CLI requires the `python-parity` Cargo feature to preserve arbitrary-size integers during JSON decoding. The library does not enable this feature by default.

Insights preserve Python int/float/bool operand identity, operand-order-sensitive min/max ties, floor division, and nearest-even `round`. Explicit `int()` sites share one fallible coercion helper (including float truncation, signed/underscored/Unicode decimal strings); invalid values are never replaced by zero. ISO date/time parsing accepts Python 3.11 basic and extended calendar/week dates, basic/extended times, fractions and timezone offsets. The Python facade feature-detects newer runtime ISO syntax changes; native Rust defaults to 3.11 behavior.

Days are stably sorted by date. Water-fill ties compare exact rational or integral load followed by date. Weekly groups are explicitly sorted. Activation compares the full Python lexicographic tuple, including projected-load lists and selected-date lists. JSON object key order is not semantic; array ordering is preserved, and any observable traversal that Python derives from insertion order must use source-order vectors rather than unordered maps.

Python remains the default and reference backend. Parity is checked against all checked-in synthetic scenarios and generated inputs; the unchanged Python suite is also run through the Rust CLI. Golden Rust tests cover the same fixtures, while core unit tests cover limits, optional minimums, fixed conflicts and deterministic ordering. No Python core is removed and no runtime service is deployed.
