---
phase: 01-reliability
plan: 01
subsystem: infra
tags: [nodejs, powershell, winforms, error-logging, spawn, balloon-notification]

# Dependency graph
requires: []
provides:
  - Spawn error capture: ps.on('error') writes SPAWN_ERROR to %TEMP%/claude-notify-error.log
  - PowerShell stderr pipe: ps.stderr data/close handlers write POWERSHELL_ERROR to log
  - 100ms balloon stabilization delay: prevents shell registration race causing silent balloon drop
  - BalloonTipShown event handler: writes timestamped confirmation to log on every successful balloon
affects: [02-config, 03-sound, 04-focus]

# Tech tracking
tech-stack:
  added: [fs (Node.js built-in), path (Node.js built-in)]
  patterns:
    - Error logging via fs.appendFileSync to %TEMP%/claude-notify-error.log
    - Inner try/catch guards on all log writes (logging must never propagate)
    - Piped stderr from detached PowerShell process via stdio:['ignore','ignore','pipe']
    - BalloonTipShown handler registered before ShowBalloonTip call

key-files:
  created: []
  modified:
    - hooks/notify-waiting.js

key-decisions:
  - "Log path uses process.env.TEMP with USERPROFILE fallback — matches %TEMP% in PowerShell $env:TEMP so both sides write to the same file"
  - "BalloonTipShown handler registered before ShowBalloonTip — if registered after, event may fire before handler attaches"
  - "100ms chosen over 50ms — 50ms can be insufficient on fast machines per documented race condition"
  - "Outer try/catch retained alongside ps.on('error') — synchronous spawn failures caught by catch, async failures caught by event handler"

patterns-established:
  - "All log writes in inner try/catch: logging failure must never abort the hook or propagate to the caller"
  - "stdio:'ignore' changed to ['ignore','ignore','pipe'] for stderr capture while stdout stays suppressed"

requirements-completed: [RELY-01, RELY-02, RELY-03]

# Metrics
duration: 2min
completed: 2026-03-04
---

# Phase 1 Plan 1: Reliability Summary

**Spawn error capture and PowerShell stderr pipe to error log, plus 100ms balloon stabilization delay and BalloonTipShown confirmation entry — eliminating all three silent failure modes**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-03-04T11:42:51Z
- **Completed:** 2026-03-04T11:44:26Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments
- Hook now writes SPAWN_ERROR to %TEMP%/claude-notify-error.log when powershell.exe cannot be launched (RELY-02)
- PowerShell stderr is piped back to Node.js and written as POWERSHELL_ERROR entries to the same log (RELY-02)
- 100ms stabilization delay after $n.Visible=$true prevents the shell-registration race that silently drops balloons (RELY-03)
- BalloonTipShown event handler registers before ShowBalloonTip and confirms each successful balloon with a timestamped log entry (RELY-01, RELY-03)

## Task Commits

Each task was committed atomically:

1. **Task 1: Replace spawn try/catch with error capture to log file** - `5f05f8a` (feat)
2. **Task 2: Add balloon stabilization delay and BalloonTipShown handler** - `f075497` (feat)

## Files Created/Modified
- `hooks/notify-waiting.js` - Added fs/path imports, logPath constant, piped stderr spawn block with error handlers, 100ms delay and BalloonTipShown handler inside PowerShell template

## Decisions Made
- **Log path**: `process.env.TEMP || process.env.USERPROFILE` on the Node.js side and `$env:TEMP` on the PowerShell side — both resolve to the same Windows TEMP directory, so both sides append to the same file
- **Handler ordering**: BalloonTipShown registered before ShowBalloonTip — if registered after, the event may already have fired before the handler attaches
- **100ms vs 50ms**: 100ms is the documented safe value; 50ms is sometimes insufficient on fast machines
- **Inner try/catch on log writes**: any I/O error in the log write must not surface to the caller — the hook must always exit 0

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Shell variable escaping caused the inline `node -e` verify commands from the plan to fail (bash treated `!` in the filter lambda as a history expansion). Resolved by writing verification to temporary `.js` files and running with `node file.js` instead.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 1 reliability foundation complete: every trigger now produces a visible balloon or a diagnosable log entry
- Phase 2 (Config) can proceed: error log gives immediate feedback when config loading fails, making config debugging tractable
- No blockers

---
*Phase: 01-reliability*
*Completed: 2026-03-04*
