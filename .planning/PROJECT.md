# claude-notify-hook

## What This Is

A Claude Code hook that shows a clickable Windows balloon notification whenever Claude finishes a response and is waiting for user input. The user hears a unique generated tone, sees the notification, and clicks it to jump straight back to their Windows Terminal window — no hunting, no alt-tabbing.

## Core Value

Click the notification and land in the right terminal window, every single time.

## Requirements

### Validated

- ✓ Hook fires on Claude Code `Notification` event — existing
- ✓ Plays a sound immediately on trigger — existing
- ✓ Shows a balloon tip via Windows NotifyIcon — existing
- ✓ Spawns detached PowerShell so hook exits cleanly — existing
- ✓ Process-tree walk to find terminal window — existing (partially working)

### Active

- [ ] Notification appears reliably on every trigger (no silent failures)
- [ ] Clicking the notification focuses the correct Windows Terminal window
- [ ] Sound is a unique generated tone (not the Windows Asterisk system sound)
- [ ] User-editable config file for sound frequency/duration, message text, and timeout
- [ ] Config has sensible defaults (works out of the box with no config file)

### Out of Scope

- macOS/Linux support — Windows-only by design (PowerShell + WinForms)
- Push to phone or external devices — local desktop notification only
- Multi-monitor window placement — focus the window, not position it
- Toast notifications (UWP) — balloon tip is sufficient and simpler

## Context

- **Terminal**: Windows Terminal (wt.exe) — the target window for focus. Process-tree walk must resolve to WindowsTerminal.exe's MainWindowHandle.
- **Current failure mode**: Notification sometimes doesn't appear (silent spawn failure); click never focuses the terminal (SetForegroundWindow call either targets wrong HWND or Windows foreground lock blocks it).
- **Windows foreground lock**: When the balloon click fires, the calling process must be the foreground owner or have been granted permission. This is the likely root cause of click-to-focus failures.
- **Sound**: Currently uses `[System.Media.SystemSounds]::Asterisk` which produces the Windows error beep. Replace with a synthesized tone using `[System.Media.SoundPlayer]` + generated WAV bytes or `[Console]::Beep` with custom frequency/duration.
- **Config location**: `%USERPROFILE%\.claude\hooks\notify-waiting-config.json` — next to the hook file, easy to find.

## Constraints

- **Runtime**: PowerShell 5.1 (built into Windows — no install required). No .NET beyond what's in the GAC.
- **No external files for sound**: Tone must be generated at runtime — users shouldn't need to download a .wav file.
- **Backward compatibility**: Hook must still work if no config file exists (all config values have defaults baked in).
- **Detached process**: PowerShell balloon process must stay detached and not block Claude Code's hook timeout.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Generated tone over system sound | Unique identity; no file dependency; frequency/duration configurable | — Pending |
| Config file next to hook (not registry) | Easy to find, edit, share; version-controllable | — Pending |
| Target WindowsTerminal.exe directly | User confirmed WT is their terminal; name-based lookup more reliable than PID walk alone | — Pending |
| Fix foreground lock with input injection or AttachThreadInput | AllowSetForegroundWindow(-1) alone insufficient; need to force focus | — Pending |

---
*Last updated: 2026-03-04 after initialization*
