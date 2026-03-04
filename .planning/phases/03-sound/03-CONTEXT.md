# Phase 3: Sound - Context

**Gathered:** 2026-03-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace the separate `execFile` PowerShell call that plays `[System.Media.SystemSounds]::Asterisk` with a generated tone that runs inside the existing balloon PowerShell script. Config values `$frequency` and `$duration` are already interpolated into the balloon script — they need to be wired to a tone generator. The `execFile` sound call in `notify-waiting.js` is then removed.

Scope: tone generation only. Balloon behavior, focus, and config loading are out of scope.

</domain>

<decisions>
## Implementation Decisions

### Tone generation method
- Use `[Console]::Beep($frequency, $duration)` — simplest 1-line approach, no additional .NET assembly needed, PowerShell 5.1 built-in
- Known limitation: may be silent on some VMs (noted in STATE.md as acceptable for target environment — physical Windows 11 machine)
- Do NOT use WAV byte generation + SoundPlayer unless Console.Beep proves problematic (over-engineering for the current requirement)

### Where the tone plays
- Tone plays inside the balloon PowerShell script (the `spawn` process), NOT via the separate `execFile` call
- The separate `execFile` block (lines 60-67 of notify-waiting.js) is removed entirely
- This satisfies the success criterion: "the separate execFile sound process is eliminated"

### Sound timing
- Tone plays at the START of the balloon script, before the NotifyIcon is created and before `ShowBalloonTip` is called
- This preserves the "plays immediately on trigger" feel — user hears tone as the balloon is being set up, not after

### Default tone character
- Keep existing defaults: 880Hz, 220ms (already in DEFAULTS object in notify-waiting.js)
- These are already configurable via config file — no need to change defaults

### Error handling
- Wrap tone call in try/catch — silent failure if `[Console]::Beep` throws (e.g., on VM or headless environment)
- Do not log tone failure to error log (it's non-critical — the balloon still appears)

### Claude's Discretion
- Exact placement in balloon script (before vs after Add-Type assembly loads — place after to keep startup order predictable)
- Whether to add a PowerShell comment explaining why Console.Beep is used over SoundPlayer

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `$frequency` and `$duration` variables: already interpolated into the balloon template string at lines 101-102 of notify-waiting.js — no new interpolation needed, just reference them
- `logPath` / error logging pattern: established in Phase 1 — do NOT add tone-failure logging (silent failure is correct here)
- `DEFAULTS.sound`: already defines `{ frequency: 880, duration: 220 }` — keep as-is

### Established Patterns
- Silent failure in try/catch: used throughout notify-waiting.js — tone failure should follow same pattern
- Config values coerced to Number before use: already done in the IIFE for `c.sound.frequency` and `c.sound.duration`
- PowerShell script is a template literal string: tone call is a one-liner inserted near the top of the `balloon` string

### Integration Points
- Remove: `execFile` block at lines 60-67 of notify-waiting.js (the `[System.Media.SystemSounds]::Asterisk.Play()` call)
- Add: `try { [Console]::Beep($frequency, $duration) } catch {}` inside the balloon template string, after variables are set, before NotifyIcon setup

</code_context>

<specifics>
## Specific Ideas

- No specific references from user discussion — all decisions derived from project constraints and existing code
- The `$frequency` / `$duration` variables are already in the balloon script, so the tone line slots in naturally with zero additional interpolation

</specifics>

<deferred>
## Deferred Ideas

- WAV bytes + SoundPlayer for headphone/Bluetooth compatibility — if Console.Beep proves inadequate, this is the upgrade path (v2)
- Silent mode toggle (no sound, keep balloon) — CONF-05, already in v2 requirements backlog

</deferred>

---

*Phase: 03-sound*
*Context gathered: 2026-03-04*
