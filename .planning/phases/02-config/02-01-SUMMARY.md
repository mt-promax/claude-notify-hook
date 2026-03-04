---
phase: 02-config
plan: 01
subsystem: config
tags: [nodejs, json, powershell, config-loading, bom-strip]

# Dependency graph
requires:
  - phase: 01-reliability
    provides: hooks/notify-waiting.js with spawn error capture, balloon stabilization, and BalloonTipShown handler
provides:
  - DEFAULTS object with sound (frequency, duration) and balloon (title, message, timeout) keys
  - CONFIG_PATH constant pointing to %USERPROFILE%/.claude/hooks/notify-waiting-config.json
  - loadConfig() function with UTF-8 BOM strip, JSON.parse, nested spread merge, and DEFAULTS fallback
  - config IIFE with numeric coercion using Number() || DEFAULTS fallback
  - PowerShell balloon template with $title, $message, $timeout, $frequency, $duration interpolated as literals
affects: [03-sound, 04-focus]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Config IIFE pattern — coercion runs once at startup, result stored in const config
    - Nested spread merge — { ...DEFAULTS.sound, ...(user.sound || {}) } enables partial user configs
    - BOM strip before JSON.parse — handles Notepad UTF-8 BOM that breaks JSON.parse
    - Single-quote escaping for PS strings — .replace(/'/g, "''") prevents PS string injection

key-files:
  created: []
  modified:
    - hooks/notify-waiting.js

key-decisions:
  - "Use USERPROFILE (not USERNAME) for CONFIG_PATH — handles roaming profiles and non-C: installs"
  - "BOM strip must precede JSON.parse — Notepad on Windows writes UTF-8 BOM which JSON.parse rejects"
  - "Nested spread at sound/balloon level (not top-level) — allows partial configs where only some keys present"
  - "Numeric coercion after merge using Number() || DEFAULTS.x — NaN fallback handles string-typed numeric values"
  - "Safety timer uses config.balloon.timeout + 1000 instead of hardcoded 7000 — prevents premature exit when user raises timeout above 6000ms"

patterns-established:
  - "Config IIFE: const config = (function(){ const c = loadConfig(); /* coerce */; return c; }()); — single const, coercion inline"
  - "PS interpolation: $varname = '${config.balloon.title.replace(/'/g, \"''\")}' for strings, $var = ${config.balloon.timeout} for integers"

requirements-completed: [CONF-01, CONF-02, CONF-03]

# Metrics
duration: 2min
completed: 2026-03-04
---

# Phase 2 Plan 01: Config Summary

**JSON config file wired end-to-end into notify-waiting.js with DEFAULTS fallback, BOM-safe parsing, and all five config values interpolated as literals into the PowerShell balloon template**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-03-04T12:07:32Z
- **Completed:** 2026-03-04T12:09:45Z
- **Tasks:** 2 of 3 (Task 3 is checkpoint:human-verify — paused)
- **Files modified:** 1

## Accomplishments
- Inserted DEFAULTS object, CONFIG_PATH constant, loadConfig() function, and config IIFE into notify-waiting.js
- Replaced all three hardcoded PowerShell values (ShowBalloonTip args and timer interval) with interpolated config variables
- Applied single-quote escaping on PS string values to prevent injection
- Fixed safety timer to use `config.balloon.timeout + 1000` ensuring it always outlasts the balloon

## Task Commits

Each task was committed atomically:

1. **Task 1: Add DEFAULTS, CONFIG_PATH, and loadConfig()** - `6ced343` (feat)
2. **Task 2: Interpolate config values into PowerShell balloon** - `a805e4b` (feat)
3. **Task 3: Verify all four config scenarios** - PENDING (checkpoint:human-verify)

## Files Created/Modified
- `hooks/notify-waiting.js` - Added config loading block (DEFAULTS, CONFIG_PATH, loadConfig, config IIFE) and interpolated $title/$message/$timeout/$frequency/$duration into balloon template

## Decisions Made
- Used `USERPROFILE` (not `USERNAME`) for CONFIG_PATH — handles roaming profiles and non-C: installs
- BOM strip (`raw.replace(/^\uFEFF/, '')`) placed before JSON.parse — Notepad on Windows writes UTF-8 BOM which JSON.parse rejects
- Nested spread at `sound` and `balloon` level (not top level) — allows partial user configs where only some keys are specified
- Numeric coercion after merge: `Number(c.sound.frequency) || DEFAULTS.sound.frequency` — NaN from string-typed values falls back correctly
- Safety timer changed from hardcoded `7000` to `config.balloon.timeout + 1000` — prevents premature exit when user sets timeout above 6000ms

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Config pipeline is in place; Phase 3 (sound) can consume sound.frequency and sound.duration from config object
- Task 3 (human verification of all 4 scenarios) must be approved before this plan is fully complete
- Once approved: CONF-01, CONF-02, CONF-03 requirements are satisfied

---
*Phase: 02-config*
*Completed: 2026-03-04*
