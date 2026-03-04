---
phase: 04-focus
plan: "01"
subsystem: focus
tags: [win32, pinvoke, toast, focus, attachthreadinput, sendinput]
dependency_graph:
  requires: []
  provides: [click-to-focus, attachthreadinput-sequence, sendinput-fallback]
  affects: [hooks/notify-waiting.js]
tech_stack:
  added: []
  patterns: [AttachThreadInput primary focus, SendInput ALT fallback, P/Invoke extension]
key_files:
  created: []
  modified:
    - hooks/notify-waiting.js
decisions:
  - AllowSetForegroundWindow(-1) kept as additional permission grant before AttachThreadInput sequence (locked decision)
  - Silent catch blocks around both focus paths — tone/balloon never suppressed by focus failure
  - $script:done = $true outside all conditionals — always runs regardless of focus outcome
  - Removed duplicate $script:done/$hwnd assignment (was lines 149-150, only one copy needed)
metrics:
  duration: "~2 min"
  completed_date: "2026-03-04"
---

# Phase 4 Plan 1: AttachThreadInput Click-to-Focus Summary

**One-liner:** AttachThreadInput + SendInput ALT fallback wired into toast add_Activated handler via extended ClaudeWin32 P/Invoke class.

## What Was Done

### Task 1: Extend ClaudeWin32 class and replace focus block

Two changes to `hooks/notify-waiting.js` (the `toastScript` template literal).

**Change 1 — Extended ClaudeWin32 Add-Type class** (after Beep declaration):

P/Invoke signatures added:
- `GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId)` — user32.dll — gets the thread ID that owns the target window
- `GetCurrentThreadId()` — kernel32.dll — gets the PowerShell thread ID to attach from
- `AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach)` — user32.dll, SetLastError=true — attaches PowerShell thread input to the terminal thread

Struct definitions added:
- `KEYBDINPUT` (LayoutKind.Sequential) — wVk, wScan, dwFlags, time, dwExtraInfo
- `INPUT` (LayoutKind.Sequential) — type, ki (KEYBDINPUT)

Methods added:
- `SendInput(uint cInputs, INPUT[] pInputs, int cbSize)` — user32.dll, SetLastError=true

Constants added:
- `INPUT_KEYBOARD = 1`
- `KEYEVENTF_KEYDOWN = 0`
- `KEYEVENTF_KEYUP = 2`
- `VK_MENU = 0x12` (ALT key virtual-key code)

**Change 2 — Replaced add_Activated focus placeholder:**

Old (3 lines): `AllowSetForegroundWindow(-1)` + `ShowWindow($hwnd, 9)` + `SetForegroundWindow($hwnd)`

New focus sequence:
1. `AllowSetForegroundWindow(-1)` — grants foreground permission to any process
2. `ShowWindow($hwnd, 9)` — SW_RESTORE: idempotent, handles minimized WT (FOCUS-02)
3. `GetWindowThreadProcessId` — get target window's thread ID
4. `GetCurrentThreadId` — get PowerShell's thread ID
5. `AttachThreadInput` primary path — attach threads, call `SetForegroundWindow`, detach
6. `SendInput` ALT fallback — inject ALT keydown+keyup, then `SetForegroundWindow` — handles cross-integrity-level case (non-elevated PS, elevated WT)

**Cleanup:** Removed duplicate `$script:done = $false` / `$hwnd = $targetHwnd` block.

### Verification (automated)

- `node hooks/notify-waiting.js` exits 0, no Node.js errors
- `AttachThreadInput` appears 3 times in file (declaration + 2 call sites)
- `SendInput` appears 2 times (declaration + call site)
- `GetWindowThreadProcessId` appears 2 times (declaration + call site)

## Deviations from Plan

None — plan executed exactly as written.

## Human Verification (Task 2 — PENDING)

Status: Awaiting human verification checkpoint.

- Test A (FOCUS-01 — WT behind other windows focuses on click): PENDING
- Test B (FOCUS-02 — minimized WT restores on click): PENDING
- Test C (elevated WT silent failure): PENDING

## Self-Check

### Files verified:
- `hooks/notify-waiting.js` — FOUND, contains AttachThreadInput, SendInput, GetWindowThreadProcessId

### Commits verified:
- `57b0770` feat(04-focus/04-01): AttachThreadInput focus sequence + SendInput ALT fallback

## Self-Check: PASSED
