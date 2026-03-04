# Project Research Summary

**Project:** claude-notify-hook (v1.2 reliability milestone)
**Domain:** Windows developer CLI notification hook — Node.js + PowerShell + Win32
**Researched:** 2026-03-04
**Confidence:** HIGH (stack, pitfalls from official sources) / MEDIUM (architecture patterns)

## Executive Summary

This is a Windows-only Claude Code hook that fires a balloon tip notification and an audible tone when Claude pauses waiting for user input. The hook is a single Node.js file (`notify-waiting.js`) that must complete in under 3 seconds; it spawns a detached PowerShell process that owns the balloon UI lifecycle (~7 s), plays a tone, and optionally focuses the Windows Terminal window on click. No external npm packages or compiled binaries are needed — the full stack is Node.js built-ins, PowerShell 5.1 (shipped with Windows), WinForms (`NotifyIcon`), and Win32 P/Invoke via `Add-Type`.

The recommended approach is a 4-phase improvement sequence: add error surfacing first (so subsequent fixes are debuggable), wire a config file second (so config values flow through before tone and focus are touched), replace the sound mechanism third (`Console.Beep` or in-memory WAV via `SoundPlayer`), and fix window focus last (the hardest piece). The architecture decision to interpolate config values as literals into the PowerShell template before base64-encoding keeps the balloon process fully self-contained with no file I/O at runtime. That design is sound and must not change.

The primary risk is the Windows foreground lock: `SetForegroundWindow` silently fails when called from a detached process that did not originate from the foreground owner. The fix is well-understood (`AttachThreadInput` with the foreground thread, or a `SendInput` ALT-key injection), but it requires adding 6 Win32 P/Invoke signatures and careful ordering in the click handler. A secondary risk is the Windows Terminal ConPTY architecture: the PID-walk approach to finding the terminal's HWND is unreliable because `wt.exe` is a dead launcher stub and `OpenConsole.exe` (the ConPTY host) has no visible window. The fix is to look up `WindowsTerminal.exe` by name as the primary strategy and use PID-walk only as a name-filtered tiebreaker.

---

## Key Findings

### Recommended Stack

The runtime requires no changes and no new dependencies. Everything is available natively on Windows 10/11. The Node.js side uses `child_process.spawn` (detached), `fs.readFileSync`, and `JSON.parse` — all built-in. The PowerShell side uses WinForms (`System.Windows.Forms.NotifyIcon`), `System.Media.SoundPlayer`, and Win32 APIs via `Add-Type` with P/Invoke. The only new Win32 signatures needed are `AttachThreadInput`, `GetForegroundWindow`, `GetWindowThreadProcessId`, `GetCurrentThreadId`, and `BringWindowToTop` — all from `user32.dll`.

**Core technologies:**
- **Node.js `child_process.spawn`** — hook entry point — already correct; needs error event handler added
- **PowerShell 5.1** (`powershell.exe`, NOT `pwsh.exe`) — balloon process — `pwsh` has a documented Node.js detached-spawn bug (node#51018)
- **`System.Windows.Forms.NotifyIcon`** — balloon UI — the right API level for a dev tool; Toast/UWP is over-engineered and requires AUMID registration
- **`Console.Beep(freq, ms)`** — tone generation — simplest path, zero dependencies, sufficient for this milestone; WAV/MemoryStream deferred
- **`AttachThreadInput` + `SetForegroundWindow`** — window focus — the only reliable pattern when calling from a detached background process
- **JSON config at `%USERPROFILE%\.claude\hooks\notify-waiting-config.json`** — user configuration — native `JSON.parse`, zero dependency, falls back to baked-in defaults on any error

**Critical version note:** Use `powershell.exe` (5.1), never `pwsh.exe` (7+) — the latter has a documented Node.js `detached: true` spawn failure on Windows (nodejs/node#51018).

### Expected Features

**Must have (table stakes):**
- Notification appears on every trigger — silent failures destroy trust; fix with `ps.on('error')` logging
- Audible alert — purpose is to get attention while user looks elsewhere; current Asterisk sound works but is not unique
- Notification disappears on its own — already implemented via 7 s timer
- Hook exits fast enough — already implemented via `detached` + `unref()`
- Config works with no file present — defaults must be baked in; config is additive only

**Should have (differentiators):**
- Click-to-focus the correct terminal window — the #1 requested feature; no other Windows implementation ships this reliably; core competitive advantage
- Unique generated tone (not a Windows system sound) — conditioning benefit: "that beep means Claude"; system Asterisk fires for unrelated events, breaking the learned response
- Configurable sound (frequency + duration) — four JSON fields cover all tuning needs
- Configurable notification text — one JSON field
- Graceful silent-fail — sound fires first, balloon spawn failure does not cancel the tone

**Defer to v2+:**
- JSON Schema file for config validation — nice-to-have editor assistance; not blocking user value
- Windows Toast notifications — requires AUMID registration; adds significant complexity for no user benefit over balloon
- Multi-monitor window positioning — focus only; moving the window is intrusive
- Notification history / log — opt-in feature, adds state management; no clear current need

### Architecture Approach

The architecture is a two-process pipeline separated by a process boundary. Node.js reads config, interpolates values as literals into a PowerShell template string, base64-encodes it, and spawns a detached PowerShell process that runs the balloon UI. No IPC is needed after spawn; all config values travel as compile-time constants inside the encoded script. The single-file design (`notify-waiting.js`) is correct for this scope — no helper scripts, no compiled binaries.

**Major components:**
1. **Config loader (Node.js)** — reads `notify-waiting-config.json`, merges with `DEFAULTS` constant, produces flat config object; never throws
2. **Script builder (Node.js)** — template literal with config values interpolated; encodes to UTF-16LE base64 for `-EncodedCommand`
3. **Spawn wrapper (Node.js)** — `spawn()` with `ps.on('error')` + stderr pipe to error log file; calls `ps.unref()` after attaching handlers
4. **Tone synthesizer (PowerShell)** — `Console.Beep(freq, dur)` or `SoundPlayer + MemoryStream WAV`; runs before WinForms loop
5. **Window finder (PowerShell)** — name-filtered PID walk targeting `WindowsTerminal.exe`; falls back to `Get-Process -Name WindowsTerminal` if walk fails
6. **Balloon UI (PowerShell)** — `NotifyIcon` + `ShowBalloonTip`; WinForms message loop; 7 s safety timer
7. **Focus caller (PowerShell)** — `AttachThreadInput` + `ShowWindow(SW_RESTORE)` + `SetForegroundWindow`; called only from `BalloonTipClicked` handler

### Critical Pitfalls

1. **Windows foreground lock** — `SetForegroundWindow` silently fails from a detached process; Windows credits balloon clicks to `explorer.exe`, not to the balloon process. Fix: `AttachThreadInput(myThread, fgThread, TRUE)` before `SetForegroundWindow`, then detach. Alternative: `SendInput` ALT-key injection (PowerToys pattern). Do NOT use `AllowSetForegroundWindow(-1)` alone — it does nothing for the calling process.

2. **ConPTY PID walk breaks at `wt.exe` launcher** — `wt.exe` exits immediately after delegating to the running `WindowsTerminal.exe` singleton; its PID stored in `OpenConsole.exe`'s `ParentProcessId` is a dead process. The PID walk returns nothing. Fix: use `Get-Process -Name WindowsTerminal | Where MainWindowHandle -ne 0 | Select -First 1` as primary lookup; PID walk is secondary tiebreaker only for multi-WT disambiguation.

3. **Encoded command-line length limit (8,191 chars)** — base64 at 1.33x expansion means a ~5 KB PowerShell script fills the Windows `CreateProcess` command-line limit. The current script is well under this, but adding P/Invoke type blocks, WAV header construction, and config logic can push it over. Monitor `$encoded.Length`; switch to `-File` (temp file) or stdin pipe before hitting ~7,500 chars.

4. **SoundPlayer + MemoryStream triple failure modes** — if using WAV synthesis (rather than `Console.Beep`): (A) stream position must be reset to 0 before passing to `SoundPlayer`; (B) the 44-byte RIFF/WAVE header must be byte-exact (little-endian, `fmt ` with trailing space, correct `ChunkSize = 36 + dataLength`); (C) construct `MemoryStream` from the complete byte array with PowerShell comma prefix: `New-Object System.IO.MemoryStream(,$byteArray)`. All three bugs cause silent failure or unhandled exception dialogs.

5. **Balloon tip silent suppression** — `ShowBalloonTip` silently drops the balloon if: (a) the tray icon is in the overflow flyout (not the visible tray); (b) Focus Assist / Do Not Disturb is active; (c) another app already has an active balloon. Fix: add `Start-Sleep -Milliseconds 100` after setting `Visible = true` before calling `ShowBalloonTip`. Document Focus Assist as a known limitation.

---

## Implications for Roadmap

Based on research, the architecture team recommends a 4-phase build sequence. Each phase is independently shippable and individually testable. The order is strict — later phases require instrumentation and config wiring from earlier phases to be debuggable.

### Phase 1: Error Surfacing and Spawn Reliability

**Rationale:** The current code has `catch (_) {}` swallowing all spawn failures and `stdio: 'ignore'` making PowerShell errors invisible. Without diagnostic output, debugging Phases 2-4 is guesswork. This must come first — it costs low effort and unlocks all subsequent debugging.
**Delivers:** Any spawn or PowerShell runtime failure writes to `%TEMP%\claude-notify-error.log`; balloon spawn failures are diagnosable; `BalloonTipShown` handler confirms balloon appeared.
**Addresses (FEATURES.md):** "Notification appears on every trigger" — fixing silent failures; "Graceful silent-fail" — `ps.on('error')` logging.
**Avoids (PITFALLS.md):** Pitfall 3 (balloon silent suppression), Pitfall 6 (spawn platform bugs), Pitfall 7 (event race).
**Research flag:** Standard Node.js pattern — no additional research needed.

### Phase 2: Config File Wiring

**Rationale:** Config values (frequency, duration, message, timeout) must exist as named variables before Phases 3 and 4 can read them. Doing this second means tone and focus implementations read `config.frequency` etc. rather than requiring a backfill pass. Config is also prerequisite for the user-facing deliverable (customizable hook behavior).
**Delivers:** JSON config at `%USERPROFILE%\.claude\hooks\notify-waiting-config.json`; baked-in defaults (hook works with no config file); all hardcoded values replaced by interpolated `config.*` references in the balloon template.
**Addresses (FEATURES.md):** "Config file works out of the box", "Configurable sound", "Configurable notification text", "Configurable timeout".
**Avoids (PITFALLS.md):** Pitfall 9 (config JSON error kills balloon — wrap in `try/catch`, fall back to defaults).
**Research flag:** Standard pattern — no additional research needed.

### Phase 3: Unique Generated Tone (Replace SystemSounds.Asterisk)

**Rationale:** Sound is independent of window focus and is the simpler of the two differentiator features. Shipping it before the focus fix means users get an immediate perceived quality improvement even if click-to-focus is still in progress. The `execFile` sound call is also an extra PowerShell process start that can be eliminated.
**Delivers:** `Console.Beep(config.frequency, config.duration)` inside the balloon script; elimination of the separate `execFile` sound call; configurable, unique tone trained to mean "Claude is waiting".
**Addresses (FEATURES.md):** "Unique generated tone", "Configurable sound (frequency + duration)".
**Avoids (PITFALLS.md):** Pitfall 5 (SoundPlayer triple failure modes) — `Console.Beep` avoids all WAV construction complexity; if WAV synthesis is chosen instead, follow the BinaryWriter pattern with explicit stream position reset.
**Stack note:** `Console.Beep` is the recommended default for this milestone. `SoundPlayer + MemoryStream WAV` is a valid upgrade path but adds ~15 lines of mechanical WAV header construction and introduces 3 failure modes. Defer WAV synthesis unless async non-blocking playback is explicitly required.
**Research flag:** No additional research needed — `Console.Beep` is documented .NET BCL; WAV pattern is fully documented in ARCHITECTURE.md if needed.

### Phase 4: Click-to-Focus Window Terminal (Fix Focus)

**Rationale:** The hardest phase. By this point, error surfacing (Phase 1) means `SetForegroundWindow` failures will appear in the error log. Config is wired (Phase 2). This is last because the Win32 P/Invoke surface is larger, requires a live terminal session to test, and has interaction effects with the foreground lock that are only diagnosable with the logging from Phase 1.
**Delivers:** Clicking the balloon reliably brings Windows Terminal to the foreground; replaces current broken `AllowSetForegroundWindow(-1)` pattern; replaces unreliable PID walk with name-filtered lookup.
**Addresses (FEATURES.md):** "Click-to-focus the correct terminal window" — the #1 differentiator; "no other Windows implementation ships this working".
**Avoids (PITFALLS.md):** Pitfall 1 (foreground lock — use `AttachThreadInput`), Pitfall 2 (ConPTY PID walk — use name-based lookup as primary), Pitfall 8 (minimized window Z-order — `SW_RESTORE` + optional `SetWindowPos HWND_TOPMOST/HWND_NOTOPMOST` trick).
**Research flag:** This phase has a documented UIPI caveat: `AttachThreadInput` may be blocked cross-integrity-level (e.g., if Windows Terminal runs elevated). In practice the user environment runs everything at the same integrity level, so this is acceptable risk. Validate during implementation; if it fails, fall back to the `SendInput` ALT-key injection (PowerToys pattern) which has higher compatibility.

### Phase Ordering Rationale

- **Debugging dependency:** Phase 1 error surfacing makes all subsequent phases debuggable. Without it, fixing the focus logic is nearly impossible to validate.
- **Config dependency:** Phase 2 wires config values so Phases 3 and 4 read from named variables rather than hardcoded literals. Doing config last would require revisiting Phase 3 and 4 code.
- **Independence of Phase 3:** Tone synthesis is orthogonal to focus; it can ship in a PR without any focus-related code. Shipping early gives users value while Phase 4 is being debugged.
- **Focus is self-contained:** Phase 4 adds Win32 signatures and logic only inside the balloon script. It does not affect Node.js code, config loading, or tone synthesis.

### Research Flags

Phases with well-documented patterns (no additional research-phase needed):
- **Phase 1** — standard Node.js event emitter patterns; fully covered by STACK.md and ARCHITECTURE.md
- **Phase 2** — standard JSON config with defaults; fully covered by STACK.md and ARCHITECTURE.md
- **Phase 3** — `Console.Beep` is one line; WAV synthesis pattern is fully specified in ARCHITECTURE.md Pattern 5 and PITFALLS.md Pitfall 5

Phases that may need targeted research during implementation:
- **Phase 4** — `AttachThreadInput` UIPI behavior with Windows Terminal at different integrity levels; `SetWindowPos` TOPMOST trick behavior on Windows 11 24H2+. These are narrow questions that can be answered during implementation, not pre-research.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All APIs are .NET BCL or official Win32; Node.js `child_process` from official docs; no third-party packages |
| Features | HIGH (platform) / MEDIUM (community) | Table stakes from official API docs; community feature comparisons from GitHub READMEs (claude-notifications-go, cc-hooks) |
| Architecture | HIGH | Two-process design is well-established; component boundaries are implementation-confirmed, not hypothetical |
| Pitfalls | HIGH | Critical pitfalls sourced from official Microsoft docs and tracked GitHub issues in microsoft/terminal and nodejs/node |

**Overall confidence:** HIGH

### Gaps to Address

- **`AttachThreadInput` cross-integrity-level behavior with Windows Terminal:** Microsoft docs note `AttachThreadInput` may not work across UIPI boundaries. The user environment is single-integrity-level, making this low risk, but it should be explicitly tested in Phase 4. If it fails, the `SendInput` ALT-key injection fallback (PowerToys PR #1282) is a documented alternative.
- **`Console.Beep` on modern audio hardware:** STACK.md notes that `Console.Beep` routes through the PC speaker path via `kernel32.dll Beep`. On most Windows 10/11 hardware this plays through the audio device, but on some VMs or specialized hardware it may be silent. This is an acceptable limitation for the target environment (developer workstation with Windows Terminal).
- **Balloon tip in Focus Assist / Do Not Disturb:** No programmatic override is available without elevated privilege. This is a known OS limitation, not a code bug. Document in the hook's README.
- **Multiple Windows Terminal windows:** The name-based lookup picks the first visible WT instance. With multiple WT windows open, it may focus the wrong one. `$env:WT_SESSION` can identify the correct instance at hook spawn time, but the detached balloon process does not inherit environment variables. The fix (inject HWND as a spawn-time parameter) is noted but deferred; single-window behavior is correct for the vast majority of users.

---

## Sources

### Primary (HIGH confidence)
- [SetForegroundWindow — Microsoft Learn](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setforegroundwindow)
- [AllowSetForegroundWindow — Microsoft Learn](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-allowsetforegroundwindow)
- [AttachThreadInput — Microsoft Learn](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-attachthreadinput)
- [Console.Beep — Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.console.beep)
- [NotifyIcon.ShowBalloonTip — Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.windows.forms.notifyicon.showballoontip)
- [Windows Console and Terminal Ecosystem Roadmap — Microsoft Learn](https://learn.microsoft.com/en-us/windows/console/ecosystem-roadmap) — OpenConsole.exe ConPTY role
- [Node.js child_process documentation](https://nodejs.org/api/child_process.html)
- [Windows command-line string limitation — Microsoft Learn](https://learn.microsoft.com/en-us/troubleshoot/windows-client/shell-experience/command-line-string-limitation)
- [WAV file format specification — CCRMA Stanford](https://ccrma.stanford.edu/courses/422-winter-2014/projects/WaveFormat/)

### Secondary (MEDIUM confidence)
- [PowerToys PR #1282 — SendInput hack for SetForegroundWindow](https://github.com/microsoft/PowerToys/pull/1282) — foreground lock bypass pattern in production
- [PowerToys PR #14383 — FancyZones foreground bypass](https://github.com/microsoft/PowerToys/pull/14383) — AttachThreadInput in production
- [microsoft/terminal issue #5694 — Identify WindowsTerminal PID](https://github.com/microsoft/terminal/issues/5694) — WT process architecture
- [microsoft/terminal issue #14911 — wt.exe PID](https://github.com/microsoft/terminal/issues/14911) — dead launcher stub root cause
- [microsoft/terminal discussion #16447 — Get PID of OpenConsole.exe](https://github.com/microsoft/terminal/discussions/16447)
- [nodejs/node issue #51018 — pwsh detached spawn fails](https://github.com/nodejs/node/issues/51018)
- [nodejs/node issue #21825 — windowsHide ignored with detached](https://github.com/nodejs/node/issues/21825)
- [Detecting Windows Terminal with PowerShell — mikefrobbins.com (2024)](https://mikefrobbins.com/2024/05/16/detecting-windows-terminal-with-powershell/)
- [ForceForegroundWindow pattern — shlomio.wordpress.com](https://shlomio.wordpress.com/2012/09/04/solved-setforegroundwindow-win32-api-not-always-works/)
- [claude-notifications-go — Windows: notifications only, no click-to-focus](https://github.com/777genius/claude-notifications-go)

---
*Research completed: 2026-03-04*
*Ready for roadmap: yes*
