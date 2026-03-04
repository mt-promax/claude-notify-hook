# Phase 4: Focus - Context

**Gathered:** 2026-03-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Wire the WinRT toast `add_Activated` callback to reliably focus the correct Windows Terminal window. This means implementing the `AttachThreadInput` + `SetForegroundWindow` pattern in the PowerShell balloon script, replacing the current placeholder (which only calls `AllowSetForegroundWindow(-1)` + `ShowWindow(9)` + `SetForegroundWindow` — insufficient to overcome Windows foreground lock).

Scope: click-to-focus only. Sound, config loading, and balloon display are out of scope.

</domain>

<decisions>
## Implementation Decisions

### Focus technique
- Use `AttachThreadInput` sequence: `GetWindowThreadProcessId($hwnd)` → `GetCurrentThreadId()` → `AttachThreadInput(currentTid, targetTid, true)` → `SetForegroundWindow($hwnd)` → `AttachThreadInput(currentTid, targetTid, false)`
- Call `ShowWindow($hwnd, 9)` (SW_RESTORE) before `SetForegroundWindow` to handle minimized windows — satisfies FOCUS-02
- `AllowSetForegroundWindow(-1)` call before the sequence is kept as an additional permission grant

### Elevated WT fallback (cross-integrity-level)
- If `AttachThreadInput` is blocked (cross-integrity-level: PowerShell non-elevated, WT elevated), fall back to SendInput ALT-key injection
- SendInput sequence: inject a dummy ALT keydown + keyup to make the calling process the foreground owner, then call `SetForegroundWindow`
- This is the documented Windows workaround for foreground lock when AttachThreadInput is blocked
- If both fail: silent failure — balloon and sound already played, focus is best-effort

### Window discovery order
- **Primary:** Search by process name `WindowsTerminal` first (per PROJECT.md decision — name-based lookup more reliable)
- **Secondary:** PID walk from `claudePid` (process.ppid) if name search finds no window with a valid HWND
- **Multiple WT windows:** take the first one with a non-zero `MainWindowHandle` (most recently active by OS ordering)
- No title-pattern matching — too fragile

### Minimized window handling
- Always call `ShowWindow($hwnd, 9)` (SW_RESTORE) before SetForegroundWindow — harmless if already visible, required if minimized
- No check of current window state needed — SW_RESTORE is idempotent

### Focus failure UX
- Silent failure — no second toast, no taskbar flash, no error log entry for focus failure
- Rationale: balloon appeared, sound played — user is aware Claude is waiting. Focus is a convenience, not a requirement for the hook to be "working"
- Exception: if HWND discovery itself fails completely ($targetHwnd is zero), skip all focus calls (already the case in current scaffold)

### Claude's Discretion
- Exact P/Invoke signatures to import (GetCurrentThreadId, AttachThreadInput, SendInput structs)
- Whether to define SendInput as a separate Add-Type block or fold it into the existing ClaudeWin32 class
- Order of Add-Type declarations vs focus logic

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `ClaudeWin32` Add-Type class: already imported in balloon script with `SetForegroundWindow`, `ShowWindow`, `AllowSetForegroundWindow`, `Beep` — extend this class with `AttachThreadInput`, `GetWindowThreadProcessId`, `GetCurrentThreadId`, `SendInput`
- `$targetHwnd` variable: already resolved by process-tree walk + name fallback before `add_Activated` fires — reuse as-is
- `$hwnd` in closure: already captured via `GetNewClosure()` — the focus logic goes inside `add_Activated`, replacing the current 3-line placeholder

### Established Patterns
- Single `Add-Type -TypeDefinition` block for all P/Invoke: keep all Win32 imports in one class to avoid multiple compilation passes
- Silent catch blocks: used for tone failure; use same pattern if SendInput fallback throws
- `$script:done = $true` at end of Activated handler: keep this — do not return early on focus failure

### Integration Points
- Replace lines in `$toast.add_Activated` handler (the 3-line focus block: AllowSetForegroundWindow, ShowWindow, SetForegroundWindow)
- Extend `ClaudeWin32` Add-Type class definition at top of `$toastScript` template literal in `notify-waiting.js`
- No changes to Node.js side — all focus logic lives in the PowerShell template string

</code_context>

<specifics>
## Specific Ideas

- No specific references from user discussion — decisions derived from PROJECT.md constraints, STATE.md blocker notes, and existing code analysis
- The `AttachThreadInput` + `SendInput ALT` fallback pattern is the documented Windows solution for foreground lock (MSDN / Raymond Chen blog)

</specifics>

<deferred>
## Deferred Ideas

- None — discussion stayed within phase scope

</deferred>

---

*Phase: 04-focus*
*Context gathered: 2026-03-04*
