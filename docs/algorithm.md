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

Guards sum each current-month ledger day's actual work and each plan day's
additional work by ISO week, including completed weeks without plan rows. Weekly
limits come from matching summary rows or default to 3,120 minutes. Projections
within 240 minutes of the maximum are risks; above it they are breaches. Other
guards report future Friday windows after 16:00 and insufficient rest
(30 minutes at 240 worked, 60 at 480). Rest is all non-work time between the
first start and last end (recorded rest, gaps between work blocks, and leave in
between; overnight spans wrap), never less than recorded rest. Ongoing today rest
is a risk; past-day rest is a breach.

Leaving now removes today's unrecorded work and asks the constrained planner for
the remaining dates' maximum. Shortfall compares that capacity with the existing
recommendation total. The displayed daily averages are arithmetic context, not
the allocation used for feasibility. Weekly caps, Friday caps, full-day leave,
date overrides and the remaining time today constrain the result.
Forecast `recognizedMinutes` is completed ledger recognition (dates strictly before
today) plus today's recorded recognition. Expected minutes add confirmed future
recognition already on the ledger (paid leave after today, including full-day
leave without a plan row) and the plan's still unrecorded work
(`plannedAdditionalMinutes` of plan rows dated today or later) to that current
recognition. `plan.forecastMinutes` is not used: live plans count
target-eligible minutes, which exclude deferred remote and unclassified work, so
that total is not comparable with recognized minutes. Minimum and maximum keep all recorded
recognition and confirmed leave. The shared daily-cap, attendance-floor and weekly
baseline primitives define each optional day's interval (zero or minimum-to-cap);
fixed dates have one allowed value. A per-week reachable-minutes bitset yields
exact minimum/maximum bounds without repeatedly constructing long recommendations.
This respects 3,120 weekly work minutes, Friday's normal cap, overrides, leave,
and today's remaining wall-clock time and statutory break thresholds.

### Target pace and burn rate

Pace counts ledger `workday` dates: completed dates precede KST today; remaining
dates include today. Expected progress is completed / total workdays. Burn rate
is completed recognition divided by completed workdays, rounded to whole minutes
(Python nearest-even rounding); it is unknown before any completed workday.
Completed recognition sums all ledger dates before today, including weekend
work. Each row uses `recognized_minutes`, falling back to work plus time off.
Official percentages use that completed sum; achieved percentages add today's
ledger recognition, whether ongoing or finished. Month-level derived totals and
plan/truth in-progress values are not used, so today's work is never counted twice.
Percentages use one decimal place and may exceed 100%.

Targets use `planner.targetOptions` keys `target`, `nine_hour`, `fixed_ot`, and
`max`, in that order, with fixed labels 8시간(소정), 9시간, 고정OT, and 최대.
Nine-hour falls back to total workdays × 540 when absent from options. Base,
fixed OT, and maximum fall back to `derived.targetMinutes`, `fixedOtMinutes`,
and `maxMinutes` only when the options list is absent, never when individual
options are missing. Nonpositive targets are omitted.

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

The synthetic demo exposes all four presets in `targetOptions` and `comparisons`.
Its 9시간 target counts synthetic month workdays × 540; the demo API permits that
target above the older 9,000-minute selector bound. Each comparison uses the same
planner as a selected target. An infeasible nine-hour target retains its requested
minutes and reports the unmet gap without relaxing any constraints.

Guard labels are self-contained Korean summaries for direct display: clipped
Monday–Sunday month dates and remaining/excess `H:MM` for the weekly 52-hour
limit, Friday's planned `HH:MM` departure versus 16:00, and a day's actual versus
required rest in `H:MM`. Breaches precede risks; each severity sorts by date
(weekly guards use the clipped week start).

Weekly aggregation treats omitted zero-valued work minutes on future ledger rows
as zero, matching the public read model's sparse future-day representation.

### Office minimum and pay

`plan.officeMinimum` is null without a work-form breakdown. Otherwise its current
basis is office work plus paid leave on ledger dates through today, including
today's recorded work but excluding future leave. Required minutes are the
agreed monthly minimum, independent of the selected target. Remaining minutes
are clamped at zero. Projection adds recommended unrecorded office work and
approved future paid leave once. Remote work is deferred until this minimum is
met; unknown work never unlocks it. Today, Plan and Calendar share this rule.
Expected pay uses recommendation forecast minutes, not an unreachable requested
target; the UI labels it as a recommendation-based estimate.

