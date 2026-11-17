# Planner redesign review and drafts (2026-11-17)

Static mocks only; synthetic demo data (2042-03). Nothing here is wired to the app.

## Review of the current screen (origin/main 1198e4b, `/demo` build)

| # | Finding | Evidence |
|---|---|---|
| 1 | Agent cannot see the live screen: every `/api/*` call requires a Cloudflare Access JWT, so a local request gets 401. Only the synthetic `/demo` is viewable. | flex-mcp `scripts/flex_work_schedule_app.py` `_authorize_api` |
| 2 | Separate design system: hand-written dark-only CSS ("Terminal Ledger v4"), no light theme. The harness dashboard uses HeroUI v3 + Tailwind with auto/light/dark. | `DESIGN.md`, `shots/current-*`, `shots/dash-*` |
| 3 | Mobile header: three status chips wrap onto three lines (~170 px before content). | `shots/current-mobile-today.png` |
| 4 | Mobile calendar: each week's total takes a separate full-width row; cells too narrow for 실/남/예 text. | `shots/current-mobile-calendar.png` |
| 5 | Plan: 31-row table including weekends (~2000 px tall); same table on mobile. | `shots/current-desktop-plan.png` |
| 6 | Today: "남은 근무 3:34" and "최소 목표 잔여 3:34" repeat; right column mostly empty. | `shots/current-desktop-today.png` |
| 7 | Analysis chart: "고정OT 130:00" and "목표 130:00" labels overlap; "오늘 3/4" collides with the x-axis label. | `shots/current-desktop-analysis.png` |
| 8 | Monospace with wide letter-spacing on Korean labels hurts readability. | all current shots |

## Drafts

- **A** (`a-*.html`): harness-dashboard aligned. Left menu + theme switch on desktop, 5 bottom tabs on mobile, top bar "HH:MM 기준 · 새로 고침", month stepper + target segmented control in the top bar, Pretendard with tabular numerals, mobile tables become week list rows.
- **B** (`b-home.html`): same design system, 4 tabs; Today and Plan merged into one "이번 달" home with a timeline.
- **C** (`c-today.html`): keeps the current dark Terminal Ledger identity and monospace numerals, with the same layout cleanup.

Serve: `python3 -m http.server 18788 --bind 127.0.0.1 --directory <this folder>`; `?theme=dark` switches A/B to dark.
