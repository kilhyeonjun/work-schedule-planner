---
version: alpha
name: Terminal Ledger v4
description: Compact dark operational UI for deterministic work-schedule decisions.
colors:
  background: "#0B0C0E"
  panel: "#131518"
  surface: "#1B1E23"
  line: "#26292F"
  ink: "#EDEEF0"
  muted: "#8A9098"
  primary: "#6E7CFF"
  success: "#3ECF8E"
  warning: "#F5A54E"
  danger: "#F56E6E"
typography:
  body:
    fontFamily: Pretendard
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.45
  data:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: 500
    lineHeight: 1.4
rounded:
  control: 8px
  card: 12px
  sheet: 16px
spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
components:
  strategy-panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: 12px
  strategy-control:
    backgroundColor: "{colors.background}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: 44px
  strategy-control-active:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.background}"
    rounded: "{rounded.control}"
    height: 44px
---

## Overview

Terminal Ledger is a compact decision surface, not a decorative dashboard. Preserve the existing app shell, route structure, dense calendar, and deterministic API-owned calculations. Indigo is the only primary interaction accent.

## Colors

Near-black surfaces separate shell, panel, and card depth with borders rather than gradients. Semantic colors identify work-day kinds and system status. Muted text is secondary only; controls and values use `ink`.

## Typography

Pretendard carries Korean labels and body copy. JetBrains Mono is required for dates, durations, targets, and computed values. Keep tabular numerals aligned.

## Layout

The strategy control is globally reachable from the header on every current-month page. Desktop uses an anchored popover no wider than 420px. Mobile uses a bottom sheet with safe-area padding, bounded vertical scrolling, and no horizontal overflow. Existing page content remains visible during recomputation.

## Elevation & Depth

Use one bordered surface and a restrained dark shadow for the floating strategy panel. Do not introduce gradients, glass effects, or new page-level surfaces.

## Shapes

Controls use 8px corners, cards 12px, and the mobile sheet 16px top corners. Every interactive target is at least 44px on mobile.

## Components

The shared strategy panel contains target presets, exact target adjustment, and normal/long/short work-duration controls. Every adjustable value has a native range input with one-minute steps, an `HH:MM` readout, and one-minute decrement/increment buttons. A reset action restores defaults. Changes update local control state and URL immediately, preserve stale page content, abort superseded requests, and show a non-blocking `업데이트 중` state until the latest response lands.

The plan page may summarize or compare strategies but must not own a second settings implementation.

## Do's and Don'ts

- Do keep target and work-duration state in one app-level source of truth.
- Do expose the same panel from Today, Plan, Calendar, Analysis, and current-month Record views.
- Do preserve keyboard operation, focus trapping, Escape, backdrop, and focus restoration.
- Do keep the simulation read-only against Flex.
- Don't require an Apply button; changes are immediate.
- Don't blank the page or move scroll position during recomputation.
- Don't add invented business metrics, navigation, or visual language.
