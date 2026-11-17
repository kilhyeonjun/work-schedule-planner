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

## Month insights

`month_insights(payload: dict, *, now: datetime.datetime) -> dict | None` derives
read-only insights from the public month payload; archive months without a plan
return `None`. Timestamps and date comparisons use KST (naive timestamps mean KST).
The synthetic demo fixes its clock to 2042-03-04 at 12:00 KST.

Guards report weekly actual-work projections within 240 minutes of the weekly
maximum (risk), projections above it (breach), future Friday windows after 16:00,
and insufficient recorded rest (30 minutes at 240 worked, 60 at 480). Ongoing
today rest is a risk; past-day rest is a breach.

Leaving now projects today's remaining work evenly onto future workdays, assigning
indivisible minutes in ISO-date order. A day exceeding the configured long-day
cap contributes its overflow to the shortfall; no remaining workdays means all
of today's remainder is a shortfall. Displayed averages round up to whole minutes.
This is arithmetic, not a new constrained plan or a guarantee about weekly caps.
Forecast expected minutes add planned work to recognized minutes. Minimum and
maximum instead add the capacity of future workdays at the short-day and long-day
settings, respectively. If today is a workday with remaining planned work, each
bound also includes today's nonnegative remainder at its corresponding setting
after subtracting already worked minutes. The selected target's feasibility
value is not a capacity bound and is never used for the forecast range.

### Target pace and burn rate

Pace counts ledger `workday` dates: completed dates precede KST today; remaining
dates include today. Expected progress is completed / total workdays. Burn rate
is official `derived.recognizedMinutes` divided by completed workdays, rounded to
whole minutes (Python nearest-even rounding); it is unknown before any completed
workday. Percentages use one decimal place and may exceed 100%.

Targets are base (`derived.targetMinutes`), nine-hour (total workdays × 540),
fixed OT (`derived.fixedOtMinutes`), and maximum (`derived.maxMinutes`), in that
order; nonpositive targets are omitted. Official percentages use only official
recognition. Achieved percentages add explicit `plan.inProgressRecognizedMinutes`
when present (including explicit zero), otherwise the truth record's effective
minus source recognition. Without explicit provenance, today's ongoing ledger
recognition is in-progress; a finished today's row is added only when official
recognition equals the sum of prior ledger recognition, avoiding double counting.
The demo explicitly supplies zero in-progress recognition.

Required daily work rounds up the positive target-minus-official gap divided by
remaining workdays (zero when none remain); feasibility compares it with the
long-day setting, defaulting to 719. Burn-rate projection adds burn rate ×
remaining workdays to official recognition, or stays official when rate is
unknown. ETA is the first remaining workday reaching the target at that rate;
already achieved targets use the last completed workday (today if none).
Unreached targets have no ETA and expose projected shortfall. These are
arithmetic pace estimates, not constrained-plan guarantees. Pace and target
calculations do not use selected-plan allocations; archive months still return
no insights.
