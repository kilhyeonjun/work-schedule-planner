# Flex planner — draft A

Approved reference: `../../docs/design/drafts/2026-11-17-planner-redesign/a-*.html` and `a.css`. The harness dashboard supplies the interaction and surface language; the planner supplies its own domain decisions. Korean labels use self-hosted Pretendard with tabular numerals, never a Korean monospace face. No CDN, remote font, or inline script is required.

## System

HeroUI v3 (`@heroui/react` / `@heroui/styles` 3.2.7), the dashboard's React Aria pins, and Tailwind 4.3.4 via the Vite plugin. `src/heroui.css` imports only rendered component sheets: Button, ToggleButton/Group, Chip and Card. Add a sheet there when adding a HeroUI primitive. `index.css` owns shell, theme mapping and the shared strategy panel; each tab owns its layout sheet.

Native button resets stay in `@layer base` so they cannot erase HeroUI component padding/backgrounds. The `planner-segments` group gives targets and desktop themes separately padded pill segments, 3px gaps and accent-soft selection.

The default theme follows the OS. Desktop theme choices (자동/밝게/어둡게) persist under `work-planner.theme` and react to OS changes in automatic mode. Light and dark both use the HeroUI theme. Text stays in foreground/muted/accent colors; warning/danger status uses dots, chip edges or borders rather than low-contrast colored text. Cards have 20px corners, secondary surfaces 16px, and primary controls pill/12px shapes.

## Navigation and hierarchy

At 1024px and above: 220px sticky left menu (오늘/계획/달력/분석/기록), theme at its foot. Below 1024px: five bottom tabs, safe-area padding and 44px control targets. The header contains the title, KST `HH:MM 기준`, month stepper, target segmented choice, shared strategy control, collection freshness, nonempty guard count and 새로 고침. Compact mobile controls wrap without a horizontal page scroll. Stale-content recomputation is nonblocking and explicitly says 업데이트 중.

- Today: recommended leave time and collected-versus-estimated work; month progress; arithmetic 지금 퇴근하면; upcoming workdays, original intervals and notifications. Off-days lead with the next workday instead. Nonempty guard details precede the decision.
- Plan: goal choice → feasibility → recommended schedule grouped by week → method/weekly ceilings. Desktop rows become phone list rows; each week can collapse. Selecting a row opens a duration what-if (근무 배정 없음 0:00/단축/보통/긴 날), previews month totals/adjustments and permits local save only with the returned preview token. Zero means no planned work, not a leave request. Demo 405 responses explain unavailability, never fabricate a projection.
- Calendar: desktop month grid, phone week groups/mini-cells/disclosure rows; both select the same date detail. The existing exact duration/window/break editor, lock preference, preview/save/reset and raw recorded data remain available.
- Analysis: cumulative burn-up with separated goal/OT labels, projected trace, selectable after-tax-pay versus long-day comparison, optional min/expected/max forecast bar, pay efficiency and recent trend.
- Record: archive year/month navigation, actual/leave/recognized totals, four-month trend and paginated daily records. Phone weeks disclose the same page rows with secondary data included.

Default disclosure state keeps the decision compact: Calendar opens only today's week (first week for another month), while Plan opens the current and following week. Manual expansion remains scoped to the viewed month. Four strategy cards occupy one desktop row; phones lead with the selected strategy and result, with alternatives behind the “다른 전략 비교” disclosure. Calendar mini-cells retain at least 44×44px touch targets, with horizontal overflow contained within the week at narrow widths. Today hides minimum-goal remainder only when it duplicates the selected-strategy remainder.

`TargetProgress.tsx` is shared by Today (compact card) and Analysis (desktop comparison columns / phone rows). Four server-owned target facts show current progress against the elapsed-workday marker, burn rate and completed/total workdays, required daily minutes, ETA or month-end shortfall. Analysis adds official/current percentages and projected month-end totals/percentages. An infeasible daily requirement uses a warning dot with neutral text. Four target presets wrap in a full-width mobile segmented group rather than a scrolling strip.

## State and domain boundaries

`main.tsx` remains the owner of year/month/target/normal/long/short/tab/selectedDate plus daily-average state, URL push/replace/popstate, preferences and cross-tab settings. `lib.ts` retains `/api/month` and `/api/archive`, `/demo/api/*` isolation, abort-on-supersession, and stale same-month data. Archive months expose only calendar/archive and no target/tuning controls.

The shared strategy panel is the only settings implementation: presets, exact custom target, 1-minute range/steppers, 285-minute floor and baseline reset; changes apply immediately. It preserves Escape, focus trap, inert background, scrim dismissal and focus restoration. Strategy cards only select the shared target.

`planner.insights` is optional: no planner/insights in archive months is normal. Guards, leave-now arithmetic and forecast are server-owned read-model facts, not client reimplementations. Local overrides never write to Flex. The existing preview/save endpoint owns reconciliation and tokens. `POST /api/sync` is shown only for stale or >30-minute collection age outside demo; started/running/cooldown/unavailable are disclosed and cooldown disables repeat requests. Requests use same-origin credentials, `X-Planner-Action: sync`, `Content-Type: application/json` and body `{}`. A forbidden response is displayed as unavailable.

`lib.ts` owns the shared plan-state mapping: 가능 / 충족 / 목표 도달 불가 / 오늘 추가 근무 필요 / 자료 확인 필요 / 고정 충돌 / 필수선 초과. `plan.capacity.planForecastMinutes` is the recommendation; `maxForecastMinutes` additionally considers today's daily, weekly and wall-clock room, including remaining statutory breaks, with past work and future allocations fixed. The UI distinguishes “추천표대로면 … · 오늘 더 일하면 최대 …” and the shortfall against that maximum. A target within capacity but beyond the recommendation says “오늘 추가 근무 필요”. Target-adjust actions fit the recommendation, not an unrequested extension of today's anchor; when the clock makes even the recommendation impossible, omit the target shortcut. Presets disclose their reachable maximum. Concrete reasons include today's anchor, weekly/daily/date limits and configured Friday duration with the actual plan-window end; the generic hint is only a fallback. No second future allocation happens in the UI. Zero shortfall/excess rows are hidden. “현재 인정” uses current ledger truth; current “목표 산입” uses `accounting.currentTargetEligibleMinutes`, including today's records but not future leave, with excluded/held amounts explained. Missing current accounting is omitted, never replaced by `accounting.targetEligibleMinutes` or `plan.recognizedMinutes` (forecast starting balances). Unknown work is “미분류 근무 · 목표 산입 제외”.

Current-basis exclusions explain the current display; classification review is the leading state only when exclusions actually absent from the forecast cover the true-maximum shortfall, not merely the recommendation gap. Otherwise preserve the time-shortage state and explain exclusions in its basis. Remote credit already unlocked by future leave must not be blamed for a capacity gap.

Leave-now feasibility reruns constrained allocation with today's unrecorded work removed. Its daily average is context, not an equal-split feasibility test. Forecast bounds use weekly/date/Friday/day/time constraints. Target progress says “전일까지 / 오늘 수집 포함”; pace and ETA are explicitly recent-speed estimates.

Calendar renders future partial leave plus planned additional work as a hybrid on desktop, phone mini-cells/list and detail: leave / additional work / expected recognition. Archive calendars without a plan show only confirmed ledger metrics, not zero forecasts or remaining-work metrics. Overrides say “날짜 고정” with the actual window, never a fixed assumed end time. The editor accepts validated `HH:MM–HH:MM` and `HH:MM~HH:MM` source windows. Date, target, settings and source-payload changes reset the editor and invalidate preview tokens, including delayed pending responses.

Today, Plan and Calendar share the “사무실 최소 기준” meter: office work plus approved paid leave through today versus the monthly minimum; future leave only enters the recommendation projection. Before satisfaction, disclose deferred remote credit and the projected satisfaction date (or month-end shortfall). After satisfaction, collapse to a check line. Missing breakdown omits the meter. This rule is independent of plan-state warnings and uses identical markup on mobile.

The mobile header directly exposes target choices. Strategy averages are clamped to the actual target range and reflect the applied target. After 45 minutes or a stale server flag, Today stops elapsed-time accrual; collection values and recommendation-based estimates remain visibly distinct. Analysis's projected trace includes future full-day leave even without a plan row.


## Review and checks

`tests/e2e/demo.spec.ts` exercises desktop 1440×1000 and phone 390×844, public-route isolation, URL/history/settings, archive gating, previews/windows, optional insights, disclosure/overflow and themes. Playwright owns port 18789, not a preexisting preview server. Run with a temporary HOME (and temporary data directories if adding private fixtures).

The immutable source manifest is checked by `tests/test_demo.py::test_reviewed_frontend_manifest_is_immutable`: every file under `src`, including self-hosted fonts, must appear with its SHA-256. Regenerate after reviewed source edits with a sorted recursive file list and `hashlib.sha256(path.read_bytes()).hexdigest()`; preserve manifest version 1.
