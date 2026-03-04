# claude-notify-hook

## What This Is

A Claude Code hook that shows a clickable Windows balloon notification whenever Claude finishes a response and is waiting for user input. The user hears a unique generated tone, sees the notification, and clicks it to jump straight back to their Windows Terminal window — no hunting, no alt-tabbing.

## Core Value

Click the notification and land in the right terminal window, every single time.

## Current State (v1.0)

Shipped 2026-03-04. The hook reliably fires, plays a configurable tone, shows a WinRT toast notification, and contains click-to-focus code (AttachThreadInput + SendInput fallback). Focus behavior was not manually verified before shipping.

- **250 LOC** JavaScript (hooks/notify-waiting.js)
- **Stack**: Node.js, PowerShell 5.1, WinRT ToastNotification API, Win32 P/Invoke
- **Known gap**: FOCUS-01/02 click-to-focus not manually tested — code is in place

## Requirements

### Validated

- ✓ Hook fires on Claude Code `Notification` event — existing
- ✓ Plays a sound immediately on trigger — existing
- ✓ Shows a WinRT toast notification — v1.0 (upgraded from WinForms balloon)
- ✓ Spawns detached PowerShell so hook exits cleanly — existing
- ✓ Notification appears reliably on every trigger — v1.0 (RELY-01)
- ✓ Spawn failure logged to `%TEMP%\claude-notify-error.log` — v1.0 (RELY-02)
- ✓ 100ms balloon stabilization delay + BalloonTipShown handler — v1.0 (RELY-03)
- ✓ JSON config file with DEFAULTS, loadConfig(), BOM strip — v1.0 (CONF-01, CONF-02, CONF-03)
- ✓ Generated `[Console]::Beep` tone, frequency/duration configurable — v1.0 (SND-01, SND-02)
- ✓ AttachThreadInput + SendInput ALT fallback wired into click handler — v1.0 (FOCUS-01, FOCUS-02 — code shipped, not verified)

### Active

- [ ] Verify click-to-focus works in practice (FOCUS-01, FOCUS-02) — manual test pending

### Out of Scope

- macOS/Linux support — Windows-only by design (PowerShell + WinForms)
- Push to phone or external devices — local desktop notification only
- Multi-monitor window placement — focus the window, not position it

## Context

- **Terminal**: Windows Terminal (wt.exe). Name-based lookup preferred over PID walk.
- **Tone**: `[Console]::Beep($frequency, $duration)` — single PS process handles both tone and balloon. Default 880Hz / 220ms.
- **Config**: `%USERPROFILE%\.claude\hooks\notify-waiting-config.json` — UTF-8 BOM handled, partial configs merged with DEFAULTS.
- **Focus**: AttachThreadInput primary, SendInput ALT-key injection fallback for cross-integrity-level (elevated WT) scenario. Both paths silent-fail.
- **Notifications**: Upgraded from WinForms NotifyIcon (suppressed on Windows 11) to WinRT ToastNotification API.

## Constraints

- **Runtime**: PowerShell 5.1 (built into Windows — no install required). No .NET beyond what's in the GAC.
- **No external files for sound**: Tone generated at runtime via `[Console]::Beep`.
- **Backward compatibility**: Hook works with no config file — DEFAULTS object baked in.
- **Detached process**: PowerShell balloon process stays detached and does not block Claude Code's hook timeout.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Generated tone over system sound | Unique identity; no file dependency; frequency/duration configurable | ✓ Shipped — `[Console]::Beep` works on physical Windows 11 |
| Config file next to hook (not registry) | Easy to find, edit, share; version-controllable | ✓ Shipped — USERPROFILE path, BOM-safe JSON parse |
| Target WindowsTerminal.exe by name | More reliable than PID walk alone | ✓ Shipped — name search first, PID walk fallback |
| AttachThreadInput + SendInput fallback for focus | AllowSetForegroundWindow(-1) alone insufficient | ✓ Code shipped — manual verification skipped |
| WinRT ToastNotification over WinForms NotifyIcon | WinForms balloons silently suppressed on Windows 11 | ✓ Shipped — resolves silent notification issue |
| USERPROFILE for CONFIG_PATH | Handles roaming profiles and non-C: installs | ✓ Shipped |
| BOM strip before JSON.parse | Notepad writes UTF-8 BOM by default; breaks JSON.parse silently | ✓ Shipped |
| Nested spread merge (sound/balloon level) | Enables partial user configs | ✓ Shipped |
| Console.Beep over SoundPlayer + WAV bytes | Simplest 1-line approach, PS 5.1 built-in, no assembly load | ✓ Shipped — may be silent on VMs (acceptable) |
| Silent catch around Beep | Tone failure must never suppress the balloon | ✓ Shipped |

---
*Last updated: 2026-03-04 after v1.0 milestone*
