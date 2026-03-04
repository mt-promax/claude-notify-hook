---
phase: 03-sound
plan: 01
subsystem: notification
tags: [powershell, console-beep, audio, config, windows]

# Dependency graph
requires:
  - phase: 02-config
    provides: Config IIFE with sound.frequency and sound.duration values interpolated into the balloon template string
provides:
  - Console.Beep tone wired into the balloon PowerShell script — plays a distinct configurable tone on each hook trigger
  - execFile Asterisk sound process removed — single spawned PowerShell process handles both tone and balloon
affects:
  - 04-focus

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Console.Beep inside the balloon template string — tone fires synchronously before the balloon appears, using variables already interpolated by the config IIFE"
    - "Silent-catch pattern for tone failure — balloon still appears if audio is unavailable"

key-files:
  created: []
  modified:
    - hooks/notify-waiting.js

key-decisions:
  - "Console.Beep over SystemSounds.Asterisk — Console.Beep frequency/duration are fully configurable via the existing sound config keys; no new mechanism needed"
  - "Tone placed after $frequency/$duration variable declarations and before Get-ParentPid — follows script execution order; variables must be set before Beep call"
  - "Silent catch block around Beep — tone failure (e.g., VM with no audio) must never suppress the balloon"
  - "execFile destructure removed from child_process import — no unused import left in the module"

patterns-established:
  - "Tone-then-balloon order: [Console]::Beep runs synchronously, then Add-Type and balloon code execute — this ordering gives the audio-first experience"

requirements-completed: [SND-01, SND-02]

# Metrics
duration: ~5min
completed: 2026-03-04
---

# Phase 3 Plan 01: Sound Summary

**Console.Beep tone at 880 Hz replaces Windows Asterisk system sound, driven by config frequency/duration, in a single balloon PowerShell process**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-03-04T13:42:52Z
- **Completed:** 2026-03-04
- **Tasks:** 2 (1 auto, 1 human-verify)
- **Files modified:** 1

## Accomplishments
- Removed the separate `execFile` PowerShell sound process; tone now plays inside the existing balloon script
- `[Console]::Beep($frequency, $duration)` wired after the config variable block — frequency and duration driven by `config.sound.frequency` and `config.sound.duration`
- User confirmed: tone is audibly distinct from the Windows Asterisk "ding", pitch and duration change with config overrides, balloon still appears normally

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire Console.Beep into balloon script and remove execFile sound call** - `71fc39b` (feat)
2. **Task 2: Verify distinct tone plays and config affects it** - human-verify checkpoint (approved, no code commit)

## Files Created/Modified
- `hooks/notify-waiting.js` - Removed execFile Asterisk block, updated child_process destructure to `{ spawn }`, inserted `[Console]::Beep($frequency, $duration)` with silent-catch inside balloon template string

## Decisions Made
- Console.Beep used over System.Media.SoundPlayer (no WAV file needed, frequency/duration directly configurable via existing config keys)
- Tone call positioned after variable declarations and before Get-ParentPid to respect PowerShell execution order
- Silent catch block ensures balloon still shows even if audio subsystem is unavailable

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 3 complete; `hooks/notify-waiting.js` is stable with config-driven tone and single-process balloon
- Phase 4 (Focus) can now implement the click-to-focus AttachThreadInput pattern on this clean foundation
- Known concern: AttachThreadInput may be blocked cross-integrity-level if Windows Terminal runs elevated — validate during Phase 4; SendInput ALT-key injection is the documented fallback

---
*Phase: 03-sound*
*Completed: 2026-03-04*
