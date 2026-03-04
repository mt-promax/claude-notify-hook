# Phase 1: Reliability - Research

**Researched:** 2026-03-04
**Domain:** Windows notification hook error handling, spawn diagnostics, balloon reliability
**Confidence:** HIGH (all mechanisms documented in Node.js and Microsoft official sources)

## Summary

Phase 1 adds three critical reliability mechanisms to the existing notification hook: spawn error capture to a log file, a BalloonTipShown handler to confirm display, and a 100ms stabilization delay to prevent silent balloon suppression. These changes address the silent failure problem — currently when PowerShell fails to spawn or the balloon fails to display, the user sees nothing and has no diagnostic trail.

The phase requires only three small additions to `notify-waiting.js` and the PowerShell balloon template, with no external dependencies. All mechanisms are standard Node.js patterns (child_process event handlers, fs.appendFileSync) and PowerShell standard library (event handlers, Add-Content, Get-Date). The implementation is low effort; the value unlock is disproportionately high because subsequent phases (focus fix, config wiring) become debuggable.

**Primary recommendation:** Implement in this order: (1) spawn error event handler + stderr pipe to log file, (2) add 100ms sleep after Visible = true, (3) add BalloonTipShown event handler that writes confirmation to log. Each can be tested independently before committing.

---

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| RELY-01 | Notification appears on every Claude Code trigger (no silent failures) | Requires spawn error capture (prevents spawn ENOENT/EACCES); requires 100ms stabilization delay before ShowBalloonTip (prevents silent suppression per Pitfall 3); requires error logging |
| RELY-02 | Spawn failure is logged to a file for user diagnostics | Requires `ps.on('error')` handler + stderr pipe + file append to `%TEMP%\claude-notify-error.log` |
| RELY-03 | Balloon shows reliably — 100ms stabilization delay prevents silent suppression | Requires `Start-Sleep -Milliseconds 100` between `Visible = true` and `ShowBalloonTip` per Pitfall 3 |

---

## Standard Stack

### Runtime — No Changes

| Component | Technology | Version | Purpose |
|-----------|-----------|---------|---------|
| Hook script | Node.js | Bundled with Claude Code | `child_process.spawn`, `fs.appendFileSync` |
| Balloon process | PowerShell | 5.1 (Windows built-in) | `-EncodedCommand` execution, event handlers |
| UI toolkit | System.Windows.Forms | .NET Framework GAC | NotifyIcon, event subscriptions |

### New APIs (Phase 1 Only)

| API | Scope | Module | Purpose | Phase |
|-----|-------|--------|---------|-------|
| `spawn.on('error')` | Node.js | child_process | Capture OS-level spawn failures (ENOENT, EACCES) | 1 |
| `stderr.on('data')` + `stderr.on('close')` | Node.js | child_process | Capture PowerShell runtime errors (non-blocking) | 1 |
| `fs.appendFileSync` | Node.js | fs | Write spawn errors to temp file (fire-and-forget) | 1 |
| `Get-Date -Format o` | PowerShell | Cmdlet | ISO 8601 timestamp for log entries | 1 |
| `Add-Content -Path` | PowerShell | Cmdlet | Write BalloonTipShown confirmation to log | 1 |
| `BalloonTipShown` event | PowerShell | WinForms | Confirm balloon appeared on screen | 1 |

### Config Values (Hardcoded in Phase 1, Externalized in Phase 2)

| Value | Current (Phase 1) | Where It Goes | Phase 2+ |
|-------|-------------------|---------------|----------|
| Log file path | `%TEMP%\claude-notify-error.log` | Hardcoded in Node.js | Externalized to config, Phase 2 |
| Stabilization delay | 100 ms | Hardcoded in PowerShell | Potentially configurable in Phase 2 |
| Balloon title | "Claude Code" | Hardcoded in PowerShell | Config key `balloon.title`, Phase 2 |
| Balloon message | "Waiting for your input..." | Hardcoded in PowerShell | Config key `balloon.message`, Phase 2 |
| Balloon timeout | 6000 ms | Hardcoded in PowerShell | Config key `balloon.timeout`, Phase 2 |

**Why hardcoding is OK for Phase 1:** RELY-01/02/03 do not require config file support. Hardcoded values let Phase 1 ship quickly. Phase 2 externalizes these to JSON. Phase 1 is a one-off payoff with no technical debt — the hardcoded values are trivial to find and replace during Phase 2.

---

## Architecture Patterns

### Recommended Changes (Phase 1)

The existing two-process architecture remains unchanged:
```
[Claude Code (node)]
    --spawn--> [PowerShell balloon process]
                    |
                    ├─ Plays tone (SystemSounds.Asterisk)
                    ├─ Shows NotifyIcon balloon
                    └─ On click: focuses terminal
```

Phase 1 adds **error visibility** to both sides of the process boundary:

```
Node.js side (improvements):
  1. Construct spawn with BEFORE: plain try/catch (catches nothing useful)
  2. AFTER: attach ps.on('error') handler → log spawn failures to file
  3. AFTER: attach ps.stderr handlers → capture PowerShell runtime errors
  4. Both handlers write to %TEMP%\claude-notify-error.log (append-only, never throws)
  5. Exit 0 regardless (hook must not fail, even if logging fails)

PowerShell side (improvements):
  1. BEFORE: NotifyIcon visible, immediately ShowBalloonTip (race condition)
  2. AFTER: NotifyIcon visible, sleep 100ms, then ShowBalloonTip (stabilization)
  3. AFTER: add BalloonTipShown event handler → log confirmation to file
```

### Pattern 1: Spawn Error Capture (Node.js)

**What:** Attach error and stderr handlers to the spawn object. Write errors to a temp log file. Do not let errors affect the hook's exit code (always exit 0).

**When:** Always — every phase should have this. Phase 1 is where it's first added.

```javascript
// At top of file, define log path (hardcoded for Phase 1)
const logPath = require('path').join(
  process.env.USERPROFILE || process.env.HOME,
  '.local', 'temp', 'claude-notify-error.log'
);

// Replace the current try/catch with this pattern:
const ps = spawn('powershell.exe', [
  '-WindowStyle', 'Hidden',
  '-NonInteractive',
  '-EncodedCommand', encoded
], {
  detached: true,
  windowsHide: true,
  stdio: ['ignore', 'ignore', 'pipe']  // capture stderr
});

// Log spawn errors (OS-level failures like ENOENT)
ps.on('error', (err) => {
  try {
    const fs = require('fs');
    const ts = new Date().toISOString();
    fs.appendFileSync(logPath, `[${ts}] SPAWN_ERROR: ${err.message}\n`);
  } catch (_) {
    // Fail silently — don't let logging break the hook
  }
});

// Log PowerShell runtime errors (stderr output)
let errBuf = '';
ps.stderr.on('data', (chunk) => {
  errBuf += chunk.toString('utf8');
});

ps.stderr.on('close', () => {
  if (errBuf.trim()) {
    try {
      const fs = require('fs');
      const ts = new Date().toISOString();
      fs.appendFileSync(logPath, `[${ts}] POWERSHELL_ERROR: ${errBuf}\n`);
    } catch (_) {
      // Fail silently
    }
  }
});

ps.unref();
// Hook script exits — stderr pipe remains open in background
```

**Why this works:** `unref()` removes the child from Node's reference count, so the hook exits immediately. The stderr pipe is still open in the OS, allowing the PowerShell process to write to it. Non-blocking — the hook does not wait for PowerShell to finish.

**Confidence: HIGH** — This is standard Node.js event emitter pattern from official documentation. All three events (spawn 'error', stderr 'data', stderr 'close') are guaranteed by the Node.js contract.

---

### Pattern 2: Balloon Stabilization Delay (PowerShell)

**What:** After setting NotifyIcon.Visible = true, sleep for 100 milliseconds before calling ShowBalloonTip. This prevents Windows from silently dropping the balloon when the icon is not yet registered with the shell.

**When:** Always required — this is a documented Windows shell behavior (see Pitfall 3).

```powershell
$n = New-Object System.Windows.Forms.NotifyIcon
$n.Icon    = [System.Drawing.SystemIcons]::Information
$n.Visible = $true

# CRITICAL: stabilization delay — prevents silent balloon suppression
Start-Sleep -Milliseconds 100

# Now the icon is registered with the shell and the balloon will appear
$n.ShowBalloonTip(6000, 'Claude Code', 'Waiting for your input...', [System.Windows.Forms.ToolTipIcon]::Info)
```

**Why 100ms:** Windows notifies the shell of icon registration asynchronously. Empirically, 50ms is often insufficient; 100ms is safe. The cost (100ms added to the PowerShell startup, which is already ~300ms) is negligible.

**Confidence: HIGH** — This is a well-known Windows shell behavior documented by Microsoft and confirmed in community forums (csharp411.com, Microsoft Q&A).

---

### Pattern 3: BalloonTipShown Event Handler (PowerShell)

**What:** Subscribe to the NotifyIcon.BalloonTipShown event. When it fires, write a confirmation to the log file. This proves the balloon appeared on the user's screen.

**When:** Needed for RELY-03 verification — the success criteria includes "a BalloonTipShown confirmation is written to the log confirming it displayed."

```powershell
# After creating NotifyIcon, add this event handler:
$n.add_BalloonTipShown(({
    try {
        $logPath = "$env:TEMP\claude-notify-error.log"
        $ts = Get-Date -Format o
        Add-Content -Path $logPath -Value "[$ts] BalloonTipShown: notification confirmed visible"
    } catch {}
}).GetNewClosure())
```

**Alternative simpler version (if logging errors is too noisy):**

If RELY-03 just requires "confirmation written to log" without requiring it to be in the error log, write to a separate success log:

```powershell
$n.add_BalloonTipShown(({
    try {
        Add-Content -Path "$env:TEMP\claude-notify-success.log" -Value "$(Get-Date -Format o) BalloonTipShown"
    } catch {}
}).GetNewClosure())
```

**Confidence: HIGH** — WinForms NotifyIcon.BalloonTipShown is documented .NET API. The event fires synchronously when the OS displays the balloon.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Spawn error detection | Custom polling of process state | `spawn.on('error')` event | OS signals spawn failure reliably; polling is racy and slow |
| PowerShell error capture | Store in memory + check on timer | `stderr.on('data')` + `stderr.on('close')` events | Non-blocking; all errors are captured; events fire in order |
| File logging from Node.js | Implement custom queue + async write | `fs.appendFileSync` | Simple, atomic, never loses data on hook exit; fire-and-forget matches hook's asynchronous nature |
| Balloon display timing | Sleep in the WinForms message loop | Sleep BEFORE `ShowBalloonTip` call | Message loop is blocked during sleep anyway; sleeping before call is cleaner and avoids race conditions |
| Event binding in PowerShell | Script blocks as strings | `.GetNewClosure()` pattern | Ensures closure variables (`$n`, `$logPath`) are captured correctly; avoids variable reference errors |

---

## Common Pitfalls

### Pitfall 1: Silent Catch-All in Spawn Wrapper

**What goes wrong:** Current code has `try { spawn(...) } catch (_) {}` — catches synchronous throw but ignores all asynchronous errors.

**Why it happens:** `spawn()` throws synchronously only for ENOENT (executable not found). All other failures (permission denied, resource exhaustion) surface asynchronously via the `error` event. The catch block never sees them.

**Consequences:** Hook silently fails. User sees nothing. No balloon appears. No diagnostic trail — the user can't tell if it's a network issue, a misconfiguration, or a broken hook.

**How to avoid:** Replace bare try/catch with `ps.on('error', handler)`. Never let async errors swallow silently.

**Warning signs:** Balloon works on some machines but not others; intermittent failures; no error output even when redirecting stderr.

**This phase addresses it:** RELY-02 requires spawn errors to be logged. Implementing Pattern 1 fixes this.

---

### Pitfall 2: Balloon Silent Suppression (Race Condition)

**What goes wrong:** NotifyIcon.Visible = true, then immediately ShowBalloonTip. The balloon never appears, no error is thrown.

**Why it happens:** Windows shell needs time to register the icon with the notification area. If ShowBalloonTip is called before registration completes, the balloon is silently dropped. This is a documented Windows shell behavior.

**Consequences:** User sees no balloon. No error in code. The notification hook appears broken.

**How to avoid:** Add `Start-Sleep -Milliseconds 100` between `Visible = true` and `ShowBalloonTip`.

**Warning signs:** Balloon appears on slow machines but not on fast ones; works the second time a hook fires (icon is already registered); works when you manually single-step through the PowerShell script.

**This phase addresses it:** RELY-03 requires the 100ms stabilization delay. Implementing Pattern 2 fixes this.

---

### Pitfall 3: BalloonTipShown Event Never Fires

**What goes wrong:** BalloonTipShown handler is registered, but the event never fires. The handler code never runs.

**Why it happens:** The event fires only when the OS actually displays the balloon. If the balloon is suppressed (Pitfall 2), the event never fires. Alternatively, the Application.Run() loop exits before the event can fire.

**Consequences:** No confirmation is written to the log. RELY-03's success criteria cannot be verified.

**How to avoid:** Ensure Application.Run() is called and the message loop runs until the balloon is dismissed. Ensure BalloonTipShown handler is registered BEFORE ShowBalloonTip (not after).

**Warning signs:** Handler code is syntactically correct but never executes; timer exit is the only way the process shuts down.

**This phase addresses it:** Implementing Pattern 3 with proper handler registration fixes this. Testing involves triggering the hook and checking the log file.

---

### Pitfall 4: File Append Throws but Hook Must Still Exit 0

**What goes wrong:** `appendFileSync(logPath)` throws (file permission denied, disk full), and the exception propagates, causing the hook to exit with non-zero code. Claude Code thinks the hook failed.

**Why it happens:** Logging is a best-effort feature. If it fails, the primary mission (showing the balloon) should still be attempted. Letting log failures abort the hook defeats the purpose.

**Consequences:** Failed logging is interpreted as a failed hook. Claude Code may disable the hook or treat it as an error.

**How to avoid:** Wrap all file operations in try/catch and swallow exceptions. Always exit 0 from the hook script itself (never throw from Node.js at the top level).

**Warning signs:** Hook works with stderr redirect, fails silently without it; appears broken intermittently.

**This phase addresses it:** Pattern 1 wraps all fs calls in try/catch. Node.js top-level catch (already present: `process.on('uncaughtException', () => process.exit(0))`) ensures the hook always exits cleanly.

---

## Code Examples

### Complete Phase 1 Spawn Pattern (Node.js)

```javascript
// Source: https://nodejs.org/api/child_process.html (spawn documentation)
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const logPath = path.join(
  process.env.USERPROFILE || process.env.HOME,
  '.local', 'temp', 'claude-notify-error.log'  // Phase 1 hardcoded location
);

const ps = spawn('powershell.exe', [
  '-WindowStyle', 'Hidden',
  '-NonInteractive',
  '-EncodedCommand', encoded
], {
  detached: true,
  windowsHide: true,
  stdio: ['ignore', 'ignore', 'pipe']  // capture stderr
});

// Spawn error handler (OS-level failures)
ps.on('error', (err) => {
  try {
    const ts = new Date().toISOString();
    fs.appendFileSync(logPath, `[${ts}] SPAWN_ERROR: ${err.message}\n`);
  } catch (_) {}
});

// PowerShell stderr handler (runtime errors)
let errBuf = '';
ps.stderr.on('data', (chunk) => {
  errBuf += chunk.toString('utf8');
});

ps.stderr.on('close', () => {
  if (errBuf.trim()) {
    try {
      const ts = new Date().toISOString();
      fs.appendFileSync(logPath, `[${ts}] POWERSHELL_ERROR:\n${errBuf}\n`);
    } catch (_) {}
  }
});

ps.unref();
```

---

### Complete Phase 1 Balloon Pattern (PowerShell)

Excerpt from the balloon script (in notify-waiting.js):

```powershell
# Create the notification icon
$n = New-Object System.Windows.Forms.NotifyIcon
$n.Icon    = [System.Drawing.SystemIcons]::Information
$n.Visible = $true

# PHASE 1 FIX: stabilization delay before showing balloon
Start-Sleep -Milliseconds 100

# Register event handler for balloon display confirmation
$n.add_BalloonTipShown(({
    try {
        $logPath = "$env:TEMP\claude-notify-error.log"
        $ts = Get-Date -Format o
        Add-Content -Path $logPath -Value "[$ts] BalloonTipShown: notification appeared"
    } catch {}
}).GetNewClosure())

# Click handler (unchanged from current code)
$n.add_BalloonTipClicked(({
    if ($targetHwnd -ne [IntPtr]::Zero) {
        [ClaudeWin32]::AllowSetForegroundWindow(-1)
        [ClaudeWin32]::ShowWindow($targetHwnd, 9)
        [ClaudeWin32]::SetForegroundWindow($targetHwnd)
    }
    [System.Windows.Forms.Application]::Exit()
}).GetNewClosure())

# Dismiss handler (unchanged)
$n.add_BalloonTipClosed(({ [System.Windows.Forms.Application]::Exit() }).GetNewClosure())

# Show the balloon (now with stabilization delay preventing silent suppression)
$n.ShowBalloonTip(6000, 'Claude Code', 'Waiting for your input...', [System.Windows.Forms.ToolTipIcon]::Info)

# Safety timer and message loop (unchanged)
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 7000
$timer.add_Tick(({ $timer.Stop(); [System.Windows.Forms.Application]::Exit() }).GetNewClosure())
$timer.Start()
[System.Windows.Forms.Application]::Run()
$timer.Dispose()
$n.Dispose()
```

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Manual trigger + log file inspection |
| Config file | None (Phase 1 has no config file) |
| Quick validation | `node hooks/notify-waiting.js` → check `%TEMP%\claude-notify-error.log` for BalloonTipShown entry |
| Full validation | Trigger hook multiple times under different conditions (PowerShell broken, normal operation, minimized window) |

### Phase Requirements → Verification Map

| Req ID | Behavior | Validation Method | Success Condition |
|--------|----------|-------------------|-------------------|
| RELY-01 | Notification appears on every trigger (no silent failures) | Trigger hook, observe balloon appears | Balloon visible on screen every time; log file contains BalloonTipShown entries |
| RELY-02 | Spawn failure is logged to `%TEMP%\claude-notify-error.log` | Break PowerShell by renaming powershell.exe temporarily, trigger hook, check log | Log file exists; contains timestamped SPAWN_ERROR or POWERSHELL_ERROR entry |
| RELY-03 | 100ms stabilization delay prevents silent suppression | Trigger hook rapidly 5 times in succession | Every balloon appears (no silent suppression); every trigger results in BalloonTipShown log entry |

### Sampling Rate
- **Per task commit:** Trigger hook manually, verify balloon appears and log is written
- **Per wave merge:** Run on multiple machines (fast, slow, with different Windows 11 builds) to verify stabilization delay is sufficient
- **Phase gate:** Successful balloon + BalloonTipShown log entry on 3+ consecutive triggers before `/gsd:verify-work`

### Wave 0 Gaps
None — Phase 1 requires only modifications to the existing `notify-waiting.js` file and the PowerShell balloon template. No new test files, no framework installation needed. All validation is manual trigger-and-inspect.

---

## State of the Art

| Old Approach (Current Code) | Current Approach (Phase 1) | Impact |
|--------------------------|--------------------------|--------|
| `try { spawn(...) } catch (_) {}` | `ps.on('error')` + stderr pipe + file logging | Spawn failures now diagnosable instead of silent |
| Immediate `ShowBalloonTip` after `Visible = true` | `Start-Sleep -Milliseconds 100` before `ShowBalloonTip` | Prevents silent balloon suppression on Windows shell registration race |
| No BalloonTipShown handler | Add event handler, write confirmation to log | Proves balloon appeared (required for RELY-03) |
| Error messages invisible (stdio: 'ignore') | stderr pipe → file, persisted even after hook exits | PowerShell errors are now discoverable |

**Deprecated approaches NOT used in Phase 1:**
- `SetErrorAction Stop` without try/catch in PowerShell (errors still exit silently if not captured)
- `[System.Windows.Forms.Application]::DoEvents()` timing loop (blocks the message loop; less reliable than proper event handlers)
- Custom error queuing in memory (lost if process crashes; not persistent)

---

## Open Questions

1. **Log file location for Phase 2+:** Currently hardcoded as `%TEMP%\claude-notify-error.log`. Should Phase 2 allow users to customize this location via config? **Recommendation:** Keep it at `%TEMP%` in Phase 2 (matches other developer tools). Allow override in config but document the temp-folder default.

2. **Single log file vs per-session logs:** Should the log file be shared across all hook invocations, or should each session get its own timestamped file? **Recommendation:** Keep a single log file (append-only). Users can manually roll it if it grows large. Phase 2 can add log rotation if needed.

3. **Validation method:** RELY-03 requires proof that BalloonTipShown was written to the log. Should the test check for a specific timestamp range, or just the presence of the log entry? **Recommendation:** Check for the log entry; timestamp is not critical for this phase.

4. **Focus Assist / Do Not Disturb interaction:** Windows 11 Focus Assist suppresses all balloons. This is not fixable in Phase 1. Should Phase 1 document this as a known limitation? **Recommendation:** Document in README after Phase 1 ships.

---

## Sources

### Primary (HIGH Confidence)
- [Node.js child_process.spawn documentation](https://nodejs.org/api/child_process.html) — spawn error event, stderr handling
- [Node.js fs.appendFileSync documentation](https://nodejs.org/api/fs.html) — synchronous file append, atomic writes
- [Microsoft: NotifyIcon.ShowBalloonTip](https://learn.microsoft.com/en-us/dotnet/api/system.windows.forms.notifyicon.showballoontip) — balloon suppression race condition
- [Microsoft: Shell notification area guidance](https://learn.microsoft.com/en-us/windows/win32/shell/notification-area) — icon registration timing

### Secondary (MEDIUM Confidence)
- [csharp411.com NotifyIcon issues](https://www.csharp411.com/notifyiconshowballoontip-issues/) — community documentation of balloon suppression and stabilization delay workaround
- [Microsoft Q&A: ShowBalloonTip stops working](https://learn.microsoft.com/en-us/answers/questions/912221/showballoontip-stops-working-in-windows-10) — user-reported race condition with fix

### Tertiary (Supporting)
- .planning/research/PITFALLS.md — detailed pitfall analysis including Pitfall 3 (balloon silent suppression) and Pitfall 6 (spawn issues)
- .planning/research/STACK.md — section 4 "Detecting Silent PowerShell Spawn Failures from Node.js"

---

## Metadata

**Confidence breakdown:**
- Spawn error patterns: HIGH — standard Node.js event emitter API
- Balloon stabilization delay: HIGH — well-documented Windows shell behavior
- PowerShell event handling: HIGH — standard WinForms .NET event pattern
- File logging (phase 1 hardcoded path): HIGH — trivial fs.appendFileSync, documented pattern
- Overall Phase 1: HIGH — no external dependencies, all mechanisms are standard library

**Research date:** 2026-03-04
**Valid until:** 2026-03-31 (Windows balloon APIs are stable; Node.js spawn events are stable; no anticipated changes)
**Review trigger:** Only if Windows 11 24H2+ introduces changes to notification area behavior or Node.js significantly changes spawn error handling
