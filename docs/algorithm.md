# Algorithm

Constraint Work Planner uses deterministic water-filling, not an optimizer and not artificial intelligence.

## Objective and constraints

The soft objective is to balance projected recognized load across available workdays. Hard limits always win:

- day availability and day type;
- per-date and per-weekday work caps;
- total work cap per ISO week;
- existing worked minutes;
- unavailable days receive no additional work.

Recognized load and actual work are separate. Paid leave can advance a recognized-time target without consuming the weekly actual-work allowance. The planner allocates one minute at a time to the eligible day with the lowest projected recognized load, then breaks ties by ISO date. This makes input ordering irrelevant and results byte-deterministic.

When the target cannot fit, the planner returns `insufficient_slots` and an explicit `gapMinutes`. It never exceeds a hard limit to make the target appear feasible.

## Evidence scenarios

The fixed seed `7601` produces five synthetic scenarios: balanced allocation, a weekday cap retained after redistribution, partial leave under a weekly cap, an infeasible target, and reversed-input determinism. Run `python scripts/generate_scenarios.py --check` to verify that checked-in evidence matches the canonical core.
