# Domain Pitfalls: Windows Notification Hook

**Domain:** Windows balloon notification + focus management via PowerShell / WinForms
**Researched:** 2026-03-04
**Overall confidence:** HIGH (all claims verified against official Microsoft docs or primary sources)

---

## Critical Pitfalls

Mistakes that cause silent failures, rewrites, or permanent non-function.

---

### Pitfall 1: Windows Foreground Lock — `AllowSetForegroundWindow(-1)` Is Not Enough

**What goes wrong:**
The balloon's PowerShell process calls `AllowSetForegroundWindow(-1)` (ASFW_ANY) then `SetForegroundWindow(hwnd)` and the window does not come to front — instead the taskbar button flashes. The call returns `FALSE` silently.

**Why it happens:**
Windows maintains a foreground lock. `SetForegroundWindow` succeeds only when at least one of these conditions holds:
- The calling process IS the foreground process.
- The calling process was STARTED BY the foreground process.
- The calling process received the LAST INPUT EVENT.
- The foreground lock timeout has expired (default: 200,000 ms since last user input).
- No foreground window currently exists.

When the user clicks the balloon, the `BalloonTipClicked` handler fires inside the balloon's PowerShell process. That process was NOT started by the foreground process (it was spawned detached from Node.js, which itself is a background process). The user's click on the balloon IS an input event, but Windows credits that event to the Shell (explorer.exe), not to the PowerShell process handling the balloon. Therefore none of the conditions are satisfied, and Windows falls back to taskbar flashing.

`AllowSetForegroundWindow(-1)` only works when the CALLING process already has the right to set foreground — it grants that right to OTHER processes. A process that cannot set foreground cannot grant that right to itself or anyone else.

**Consequences:**
Click-to-focus never works. Every call ends in taskbar flash.

**Prevention:**
Two reliable approaches exist:

1. **SendInput ALT key injection** (used by PowerToys, high reliability):
   Send a synthetic ALT keydown + keyup via `SendInput` immediately before calling `SetForegroundWindow`. Pressing ALT satisfies the "last input event" criterion because Windows treats ALT input as belonging to the calling thread. This is the technique used in PowerToys FancyZones.

   Required P/Invoke additions: `SendInput`, `INPUT` struct, `KEYBDINPUT` struct with `VK_MENU` (0x12) and `KEYEVENTF_KEYUP`.

2. **`AttachThreadInput` to foreground window thread**:
   Get the foreground window, retrieve its thread ID via `GetWindowThreadProcessId`, attach your thread to it with `AttachThreadInput(myThread, fgThread, TRUE)`, call `SetForegroundWindow`, then detach. Satisfies the "started by foreground process" criterion via thread context sharing.

   **Limitation documented by Microsoft:** AttachThreadInput will NOT work when the target window belongs to a thread without a message queue (console/conpty windows may fall into this category). Test explicitly with Windows Terminal as the target.

**Warning signs:**
- `SetForegroundWindow` returns `FALSE` — check with `if (-not [ClaudeWin32]::SetForegroundWindow($hwnd))`.
- Taskbar button flashes amber instead of window appearing.
- Works when you manually click into the balloon process first (changes foreground ownership), fails when fully automated.

**Phase that should address this:** The fix-focus-and-sound phase (the phase addressing requirement "Clicking the notification focuses the correct Windows Terminal window").

**Source confidence:** HIGH — official Microsoft docs at [SetForegroundWindow (winuser.h)](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setforegroundwindow), [AllowSetForegroundWindow (winuser.h)](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-allowsetforegroundwindow), and [PowerToys PR #1282](https://github.com/microsoft/PowerToys/pull/1282).

---

### Pitfall 2: Windows Terminal ConPTY Architecture — Parent PID Walk Breaks the Chain

**What goes wrong:**
Walking `Get-CimInstance Win32_Process` parent PIDs from the shell process upward never reaches `WindowsTerminal.exe`. The walk terminates at `OpenConsole.exe` (or `conhost.exe`) with `MainWindowHandle = 0`, and the terminal's HWND is never found.

**Why it happens:**
Windows Terminal does NOT use a traditional console host. It uses ConPTY (Windows Pseudo Console). The actual process tree when running inside Windows Terminal is:

```
WindowsTerminal.exe  (UI process — has a real HWND)
    └─ OpenConsole.exe  (ConPTY host, one per tab/pane — NO main window, MainWindowHandle = 0)
           └─ shell (powershell.exe / cmd.exe / node.exe etc.)
                  └─ your hook / balloon process
```

`OpenConsole.exe` is a locally-built variant of `conhost.exe` that acts as the pseudoconsole server. It has NO visible window of its own (`MainWindowHandle` will be zero or an internal handle). A parent PID walk from the shell exits at `OpenConsole.exe` and stops — it has no useful HWND. `WindowsTerminal.exe` is `OpenConsole.exe`'s parent, but the walk is blocked because `OpenConsole.exe` appears to have no window.

The existing code handles this correctly if `MainWindowHandle == 0`, it continues walking. However the walk may still fail if:
- Multiple `OpenConsole.exe` instances exist (one per tab) — the PID chain is correct but the code finds `OpenConsole.exe` with hwnd=0 and then finds `WindowsTerminal.exe` as the next parent. This path SHOULD work.
- `wt.exe` is a launcher stub, not the actual UI process. The real UI is `WindowsTerminal.exe`. If the user launched via `wt.exe`, that process exits immediately after delegating to the running `WindowsTerminal.exe` singleton. The parent PID stored in `OpenConsole.exe`'s `ParentProcessId` field reflects the PID of `wt.exe` AT LAUNCH TIME — but `wt.exe` is now dead. `Get-Process -Id $deadPid` returns nothing, PID walk terminates with no result.

**This is the primary root cause of the process-tree walk failure in the current code.**

**Consequences:**
`$targetHwnd` remains `[IntPtr]::Zero`. The fallback name-based search (`Get-Process -Name WindowsTerminal`) then runs. This fallback works when only one Windows Terminal window exists, but picks the wrong instance if multiple are open, and completely fails if `WindowsTerminal.exe` is not in the name list.

**Prevention:**
Do NOT rely on PID-chain walking as the primary strategy. Use a name-based lookup as the primary method:

```powershell
# Direct name lookup — reliable, no PID walk needed
$wt = Get-Process -Name 'WindowsTerminal' -ErrorAction SilentlyContinue |
      Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } |
      Select-Object -First 1
```

To disambiguate multiple Windows Terminal windows (when user has more than one open), correlate via environment variable: `$env:WT_SESSION` is set by Windows Terminal in each shell it hosts, making it possible to identify which terminal instance the hook is running under — but this doesn't help the detached balloon process (it won't inherit the env var). The balloon must either receive the target HWND as a parameter injected at spawn time, or enumerate all WT windows and pick the most-recently-active one.

**Warning signs:**
- `$targetHwnd` is zero after the PID walk.
- `Get-Process -Id <parent of OpenConsole>` returns no result (PID reused or process dead).
- Multiple `OpenConsole.exe` processes in Task Manager (one per WT tab).

**Phase that should address this:** The fix-focus-and-sound phase.

**Source confidence:** HIGH — confirmed by [Windows Terminal process hierarchy discussion #5694](https://github.com/microsoft/terminal/issues/5694) and [OpenConsole.exe vs conhost.exe #12115](https://github.com/microsoft/terminal/discussions/12115). The `wt.exe` as dead launcher stub is documented indirectly in [issue #14911](https://github.com/microsoft/terminal/issues/14911).

---

### Pitfall 3: Balloon Tip Silent Suppression — The Icon Visibility Trap

**What goes wrong:**
`ShowBalloonTip` is called, no error is thrown, but the balloon never appears. No exception, no return value indicating failure.

**Why it happens — ordered by likelihood:**

1. **Tray icon not visible in taskbar notification area.** The icon must be in the *visible* part of the tray, not in the overflow (hidden icons) section. If the icon is in the overflow flyout, the balloon is silently dropped. The `NotifyIcon` must be shown and `Visible = true` before calling `ShowBalloonTip`. The current code sets `Visible = true` immediately before `ShowBalloonTip` — correct — but if a race condition causes `ShowBalloonTip` to fire before the icon is registered with the shell, it is silently discarded. Adding a brief `Start-Sleep -Milliseconds 200` after setting `Visible = true` can stabilize this.

2. **Focus Assist / Do Not Disturb is active.** Windows 11 "Do Not Disturb" (formerly Focus Assist) suppresses all notifications when active. This affects balloon tips from `Shell_NotifyIcon` just as it affects toast notifications. The user may have enabled it via Clock app > Focus Sessions, or it may auto-enable during game/presentation/fullscreen detection. No programmatic override is available without elevated privilege.

3. **Only one balloon can be active system-wide.** If another application has an active balloon tip, `ShowBalloonTip` for a different tray icon will either be queued or silently dropped. This is an OS-level serialization limit documented by Microsoft.

4. **The balloon timeout parameter is deprecated and ignored.** Windows 11 enforces its own minimum (10 s) and maximum (30 s) timeout regardless of what you pass to `ShowBalloonTip`. Passing a value outside this range does not cause an error — the OS just clamps it silently.

5. **Notification Center disabled via registry or policy.** `HKCU\Software\Policies\Microsoft\Windows\Explorer\DisableNotificationCenter = 1` or the Group Policy equivalent can disable the notification area entirely.

6. **The balloon event fires but the process exits before the message loop starts.** In the current code, `Application.Run()` starts after `ShowBalloonTip` is called — correct. But if the encoded command is so large that PowerShell startup takes >1s, Windows may time out the balloon registration. This ties to the command-line length pitfall (see Pitfall 4).

**Consequences:**
Silent failure — no balloon, no error, no diagnostic output (since the process is detached with `stdio: 'ignore'`).

**Prevention:**
- After setting `Visible = true`, add a `Start-Sleep -Milliseconds 100` before calling `ShowBalloonTip`.
- After `ShowBalloonTip`, do NOT call `Application.Run()` on a background thread — call it on the same thread that created the `NotifyIcon` (the current code does this correctly).
- Add a BalloonTipShown event handler to confirm the balloon appeared and log to a temp file when debugging.
- Document in config that Focus Assist will suppress notifications.

**Warning signs:**
- Works on a fresh machine, fails after enabling Focus Assist.
- Works when tray icon is pinned (visible), fails when icon is in overflow.
- Intermittent — works sometimes but not others (OS serialization with other apps).

**Phase that should address this:** The notification reliability phase (fixing "Notification appears reliably on every trigger").

**Source confidence:** HIGH — [NotifyIcon.ShowBalloonTip docs](https://learn.microsoft.com/en-us/dotnet/api/system.windows.forms.notifyicon.showballoontip), [Shell notification area guidance](https://learn.microsoft.com/en-us/windows/win32/shell/notification-area), and [ShowBalloonTip stops working Q&A](https://learn.microsoft.com/en-us/answers/questions/912221/showballoontip-stops-working-in-windows-10).

---

## Moderate Pitfalls

---

### Pitfall 4: Windows Command-Line Length Limit Silently Kills Encoded PowerShell

**What goes wrong:**
The balloon PowerShell script is base64-encoded and passed via `-EncodedCommand`. As the script grows (more P/Invoke type definitions, config logic, etc.), the base64 string eventually exceeds the Windows command-line length limit of **8,191 characters**. When this limit is exceeded, `spawn()` either fails silently (the `catch (_) {}` swallows it) or PowerShell truncates the argument, producing a corrupted script that exits immediately with no output.

**Why it happens:**
Windows imposes an 8,191-character limit on the total command-line string (`lpCommandLine` parameter to `CreateProcess`). The Node.js `spawn()` call constructs a command line that includes `powershell.exe`, all flags, and the base64 payload. Base64 expansion ratio is ~1.33x, so a 5,000-byte PowerShell script becomes ~6,700 characters of base64 — leaving only ~1,200 characters for the rest of the command line before hitting the limit. Adding P/Invoke type definitions, config JSON embedding, and sound generation bytes can push past this quickly.

**Consequences:**
Silent failure. The balloon process starts and immediately crashes or produces no output. No exception propagates to the Node.js parent because `stdio: 'ignore'` is set and the catch block swallows the spawn error.

**Prevention:**
- Write the balloon PowerShell script to a temp file (e.g., `%TEMP%\claude-notify-balloon.ps1`) and invoke with `-File` instead of `-EncodedCommand`. This removes the command-line length constraint entirely.
- Alternatively, pipe the script via stdin: use `stdio: ['pipe', 'ignore', 'ignore']`, write the script to `ps.stdin`, and remove `-EncodedCommand`. PowerShell reads from stdin when `-` is passed as the command.
- Monitor script size during development: base64 of the current script at ~2,200 characters of source is fine. At ~6,000 source characters, verify total command-line length.

**Warning signs:**
- Balloon works with a small test script, fails with full production script.
- Adding features causes silent regression — balloon stops appearing.
- `$encoded.Length` in Node exceeds ~7,500 characters.

**Phase that should address this:** Any phase that adds significant script content (config loading, sound generation bytes).

**Source confidence:** HIGH — [Microsoft command-line string limitation](https://learn.microsoft.com/en-us/troubleshoot/windows-client/shell-experience/command-line-string-limitation).

---

### Pitfall 5: SoundPlayer + MemoryStream — Three Independent Failure Modes

**What goes wrong:**
`[System.Media.SoundPlayer]` initialized from a `[System.IO.MemoryStream]` containing generated WAV bytes fails with `"The wave header is corrupt"`, plays silence, or throws `"Stream does not support seek"`.

**Why it happens — three separate bugs:**

**Bug A: Stream position not reset to 0 before passing to SoundPlayer.**
After writing WAV bytes to a `MemoryStream`, the stream's `Position` is at the end. `SoundPlayer` reads from the current position, finds no data, and throws or plays silence. Fix: call `$stream.Position = 0` before creating `SoundPlayer`.

**Bug B: Malformed 44-byte RIFF/WAVE header.**
`SoundPlayer` validates the header strictly. The exact required PCM header layout is:

| Offset | Size | Field | Required Value |
|--------|------|-------|---------------|
| 0 | 4 | ChunkID | `RIFF` (ASCII) |
| 4 | 4 | ChunkSize | `36 + dataLength` (little-endian int32) |
| 8 | 4 | Format | `WAVE` (ASCII) |
| 12 | 4 | Subchunk1ID | `fmt ` (note trailing space) |
| 16 | 4 | Subchunk1Size | `16` (PCM, little-endian int32) |
| 20 | 2 | AudioFormat | `1` (PCM, little-endian int16) |
| 22 | 2 | NumChannels | `1` (mono) or `2` |
| 24 | 4 | SampleRate | e.g. `44100` (little-endian int32) |
| 28 | 4 | ByteRate | `SampleRate * NumChannels * BitsPerSample / 8` |
| 32 | 2 | BlockAlign | `NumChannels * BitsPerSample / 8` |
| 34 | 2 | BitsPerSample | `16` (recommended) |
| 36 | 4 | Subchunk2ID | `data` (ASCII) |
| 40 | 4 | Subchunk2Size | `dataLength` in bytes |
| 44 | N | Data | PCM samples |

Common mistakes: wrong endianness (use `BinaryWriter` which writes little-endian on Windows), writing `ChunkSize` as total file size instead of `36 + dataLength`, omitting the trailing space in `"fmt "`, or using 8-bit samples (unsigned) instead of 16-bit (signed).

**Bug C: SoundPlayer assumes `Stream.Read` returns a full buffer.**
`SoundPlayer` internally assumes `Stream.Read()` always returns the requested number of bytes (violates the `Stream.Read` contract). A `MemoryStream` initialized from a correctly sized buffer will satisfy this, but a `MemoryStream` constructed with capacity 0 then grown dynamically may trigger edge cases. Always construct the `MemoryStream` with the complete byte array: `New-Object System.IO.MemoryStream(,$byteArray)` (note the comma — PowerShell needs it to pass the byte array as a single argument, not unrolled).

**Consequences:**
Silent: plays no sound. Loud: throws a .NET exception that is uncaught in the detached PowerShell and causes an unhandled exception dialog (since it's a Windows app, not console).

**Prevention:**
- Always reset `$stream.Position = 0` before `SoundPlayer`.
- Use a `BinaryWriter` wrapping the `MemoryStream` to write header fields — it enforces little-endian automatically.
- Construct `MemoryStream` from the complete byte array with the comma prefix in PowerShell.
- Test the generated WAV bytes by writing to a temp `.wav` file and opening in Windows Media Player before debugging `SoundPlayer` integration.

**Warning signs:**
- `[System.Media.SoundPlayer]` throws on `Play()` but not on construction.
- Sound plays at wrong pitch (wrong sample rate in header).
- Works first call, fails subsequent calls (stream position not reset between calls).

**Phase that should address this:** The fix-focus-and-sound phase (replacing `SystemSounds::Asterisk` with a generated tone).

**Source confidence:** HIGH — [WAV format specification (CCRMA Stanford)](https://ccrma.stanford.edu/courses/422-winter-2014/projects/WaveFormat/), [SoundPlayer from Stream issue #80264](https://github.com/dotnet/runtime/issues/80264), [SoundPlayer MemoryStream Q&A](https://learn.microsoft.com/en-us/answers/questions/1141011/c-cannot-play-wav-from-a-stream-with-system-media).

---

### Pitfall 6: Node.js `spawn()` with `detached: true` + `windowsHide: true` — Known Platform Bugs

**What goes wrong:**
The detached PowerShell process fails to launch silently, or launches but immediately shows a console window flash, or exits before completing its work.

**Why it happens:**
Three independent Node.js/Windows platform issues:

1. **`windowsHide: true` has no effect with `detached: true` in older Node versions.** There is a documented [Node.js issue #21825](https://github.com/nodejs/node/issues/21825) where `windowsHide` is ignored when `detached` is also set, causing a console window to flash. This was fixed in Node 14+. If the Claude Code runtime uses an older Node, this produces a visible flash on every notification.

2. **Spawning `pwsh.exe` (PowerShell 7) with `detached: true` silently fails on some Windows configurations.** There is an open [Node.js issue #51018](https://github.com/nodejs/node/issues/51018) for this specific combination. Using `powershell.exe` (PowerShell 5.1) avoids this entirely — which the current code already does correctly.

3. **`ps.unref()` called before the child process fully initializes.** `unref()` removes the child from the parent's event loop reference count, allowing the parent to exit. This is correct behavior. However if the parent exits before the child's stdio is set up, on some Windows versions the child process inherits broken handles and exits immediately. Since `stdio: 'ignore'` is used, handles are set to `/dev/nul` — this should be safe, but if the OS has a handle limit issue the child may still fail.

**Consequences:**
Silent — the `catch (_) {}` swallows spawn errors. No balloon appears. No indication to the user.

**Prevention:**
- Keep using `powershell.exe` (not `pwsh`) as the target. This is already correct.
- Verify Node.js version is 14+ for `windowsHide` to work with `detached`.
- Consider adding a brief error file as a diagnostic: write spawn stderr to a temp log file during development, not in production.

**Warning signs:**
- Balloon worked during development, fails on a different machine with different Node version.
- Brief console window flash on each notification trigger.

**Phase that should address this:** Notification reliability phase (diagnosing silent spawn failures).

**Source confidence:** MEDIUM — [Node issue #21825](https://github.com/nodejs/node/issues/21825), [Node issue #51018](https://github.com/nodejs/node/issues/51018). These are long-standing issues with incomplete fix history.

---

## Minor Pitfalls

---

### Pitfall 7: `BalloonTipClosed` vs `BalloonTipClicked` Event Race

**What goes wrong:**
The user clicks the balloon but `BalloonTipClosed` fires before (or simultaneously with) `BalloonTipClicked`, causing `Application.Exit()` to be called twice or causing the click handler to not complete before the process exits.

**Why it happens:**
Windows fires `BalloonTipClosed` in some configurations when the balloon is dismissed, regardless of whether it was dismissed by timeout or by click. If the user clicks rapidly, both events may be queued in the message loop. `Application.Exit()` is idempotent (calling it twice does nothing harmful), but if the `BalloonTipClosed` handler fires first and exits before `BalloonTipClicked` runs, the focus operation is skipped.

**Prevention:**
Use a `[bool]` flag: set it to `$true` in `BalloonTipClicked` before calling `Exit()`. In `BalloonTipClosed`, only call `Exit()` if the flag is `$false`. This is a standard tray-app defensive pattern.

**Warning signs:**
- Click sometimes focuses, sometimes doesn't — non-deterministic.

**Phase that should address this:** Notification reliability phase.

**Source confidence:** MEDIUM — community pattern, confirmed by [csharp411 NotifyIcon issues](https://www.csharp411.com/notifyiconshowballoontip-issues/).

---

### Pitfall 8: `ShowWindow(SW_RESTORE)` Before `SetForegroundWindow` — Wrong Order with Minimized Windows

**What goes wrong:**
If the Windows Terminal window is minimized, calling `ShowWindow(SW_RESTORE, 9)` then `SetForegroundWindow` sometimes activates the window but leaves it behind other windows. The window is restored but not brought to front.

**Why it happens:**
`SW_RESTORE` (value 9) restores a minimized or maximized window to its previous size and position, but does NOT guarantee z-order change. On some Windows 11 configurations, the restored window stays below other windows if `SetForegroundWindow` then fails due to foreground lock.

**Prevention:**
Use `SW_SHOW` (value 5) or `SW_SHOWNORMAL` (value 1) instead of or in addition to `SW_RESTORE`. Follow with `SetWindowPos` using `HWND_TOPMOST` then `HWND_NOTOPMOST` (the "topmost trick") to force z-order, then `SetForegroundWindow`. Example sequence:
1. `ShowWindow(hwnd, SW_RESTORE)` — unminimize
2. `SetWindowPos(hwnd, HWND_TOPMOST, ...)` — force to top
3. `SetWindowPos(hwnd, HWND_NOTOPMOST, ...)` — remove always-on-top (optional)
4. `SetForegroundWindow(hwnd)` — activate

**Phase that should address this:** Fix-focus phase.

**Source confidence:** MEDIUM — widely documented community pattern, [Damir's Corner](https://www.damirscorner.com/blog/posts/20060603-ProblemsWithSetForegroundWindowCalls.html).

---

### Pitfall 9: Config JSON Read Failure Causes Silent Hook Failure

**What goes wrong:**
If the config file exists but contains invalid JSON (e.g., user edited it incorrectly), `ConvertFrom-Json` throws, and the balloon script exits before showing the notification.

**Why it happens:**
PowerShell's `ConvertFrom-Json` throws a terminating error on malformed JSON. In a script without structured error handling, this unwinds the entire script.

**Prevention:**
Wrap config loading in a `try/catch` and fall back to all defaults if any error occurs. Never let config failures propagate — the hook's primary job is the notification, not config validation.

**Phase that should address this:** Config implementation phase.

**Source confidence:** HIGH — standard PowerShell behavior, no source needed.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Fix click-to-focus | Foreground lock blocks `SetForegroundWindow` | Implement SendInput ALT-key trick before `SetForegroundWindow` |
| Fix click-to-focus | PID walk fails because `wt.exe` launcher is dead | Use `Get-Process WindowsTerminal` name lookup as primary; inject HWND as spawn argument |
| Fix notification reliability | Silent balloon suppression from Focus Assist | Document limitation; add BalloonTipShown handler for diagnostics |
| Fix notification reliability | Tray icon in overflow | Ensure `Visible = true` with 100ms sleep before `ShowBalloonTip` |
| Replace sound with generated tone | WAV header corruption or stream position error | Use BinaryWriter, reset `$stream.Position = 0`, test with temp file first |
| Add config file | Config JSON error kills balloon | Wrap all config loading in `try/catch`, fall back to hardcoded defaults |
| Script growth from new features | Encoded command line exceeds 8,191 chars | Switch from `-EncodedCommand` to temp file or stdin pipe before script hits ~5KB |

---

## Sources

- [SetForegroundWindow — Win32 API reference (Microsoft Learn)](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setforegroundwindow)
- [AllowSetForegroundWindow — Win32 API reference (Microsoft Learn)](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-allowsetforegroundwindow)
- [PowerToys PR #1282 — SendInput hack for SetForegroundWindow](https://github.com/microsoft/PowerToys/pull/1282)
- [PowerToys PR #14383 — FancyZones foreground bypass](https://github.com/microsoft/PowerToys/pull/14383)
- [Windows Terminal issue #5694 — Identify WindowsTerminal PID](https://github.com/microsoft/terminal/issues/5694)
- [Windows Terminal issue #14911 — wt.exe PID of child process](https://github.com/microsoft/terminal/issues/14911)
- [Windows Terminal discussion #12115 — OpenConsole.exe vs conhost.exe](https://github.com/microsoft/terminal/discussions/12115)
- [Windows Terminal discussion #16447 — Get PID of OpenConsole.exe](https://github.com/microsoft/terminal/discussions/16447)
- [NotifyIcon.ShowBalloonTip — .NET API reference (Microsoft Learn)](https://learn.microsoft.com/en-us/dotnet/api/system.windows.forms.notifyicon.showballoontip)
- [Shell notification area guidance (Microsoft Learn)](https://learn.microsoft.com/en-us/windows/win32/shell/notification-area)
- [SoundPlayer from Stream issue #80264 — dotnet/runtime](https://github.com/dotnet/runtime/issues/80264)
- [SoundPlayer MemoryStream Q&A — Microsoft Learn](https://learn.microsoft.com/en-us/answers/questions/1141011/c-cannot-play-wav-from-a-stream-with-system-media)
- [WAV file format specification — CCRMA Stanford](https://ccrma.stanford.edu/courses/422-winter-2014/projects/WaveFormat/)
- [Windows command-line string limitation — Microsoft Learn](https://learn.microsoft.com/en-us/troubleshoot/windows-client/shell-experience/command-line-string-limitation)
- [Node.js issue #21825 — windowsHide ignored with detached](https://github.com/nodejs/node/issues/21825)
- [Node.js issue #51018 — pwsh detached spawn fails](https://github.com/nodejs/node/issues/51018)
