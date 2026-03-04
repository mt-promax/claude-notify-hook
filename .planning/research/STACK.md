# Technology Stack

**Project:** claude-notify-hook (v1.2 reliability milestone)
**Researched:** 2026-03-04
**Research mode:** Stack dimension — four specific technical questions

---

## Summary Verdict

All four problem areas are solvable using only what is already in the runtime
(PowerShell 5.1, Node.js built-in `child_process`, plain JSON). No external
packages are needed. The hard part is the Windows foreground lock, not the
other three items.

---

## 1. Custom Tone Generation

### Recommended Approach: `[Console]::Beep(frequency, duration)`

**Why:** `[Console]::Beep(int freq, int durationMs)` is a .NET BCL method
present in every .NET 2.0+ runtime (including the CLR under PowerShell 5.1).
It accepts any frequency from 37–32767 Hz and any positive duration in
milliseconds. It runs synchronously on the calling thread, is fire-and-forget
from the caller's point of view, and requires no file, no stream, no assembly
reference, and no Add-Type. It is the simplest path to a unique, configurable
tone.

**Configurable surface:**
- `sound.frequency` (Hz, default 880 — a 440*2 A5, noticeably different from
  the Windows Asterisk beep which is Windows-theme-defined)
- `sound.duration` (ms, default 220)

**Limitations:**
- Uses the PC speaker path (via `kernel32.dll Beep`). On systems where the PC
  speaker path is routed through the audio device driver this works fine
  (all modern Windows 10/11 hardware). On very old or headless VMs it may be
  silent — acceptable given the target environment.
- Cannot produce chords or complex waveforms.
- `[Console]::Beep` blocks the thread for the duration — call it with a short
  duration (≤300 ms) so the sound process exits quickly.

**Do NOT use `[System.Media.SoundPlayer]` with `MemoryStream` for this
milestone.** While SoundPlayer can accept a `MemoryStream` containing a
hand-constructed PCM WAV (RIFF header + `fmt ` chunk + `data` chunk, 44-byte
header for standard PCM), the implementation requires writing ~40 lines of
PowerShell to construct the header bytes, fill sample data with a sine-wave
loop, and seek the stream to position 0 before passing it to SoundPlayer's
constructor. That is significant complexity for a tone that is perceptually
equivalent to a two-parameter `Console.Beep` call. Defer WAV synthesis to a
future enhancement milestone if richer sound shaping is ever requested.

**Do NOT use `[System.Media.SystemSounds]::Asterisk`.** It plays whatever
Windows has configured as its "Asterisk" scheme sound — not a unique tone.

**Confidence: HIGH** — `Console.Beep` is stable .NET BCL, documented on
Microsoft Learn, present since .NET 2.0.

---

## 2. Focusing a Windows Terminal Window from a Detached Process

### Why the Current Code Fails

Windows Terminal (WindowsTerminal.exe) is an MSIX-packaged UWP-adjacent
application. Its process tree looks like this when a shell session is running:

```
WindowsTerminal.exe  (UI host — has MainWindowHandle)
  └─ OpenConsole.exe  (ConPTY host — no MainWindowHandle, no visible HWND)
       └─ powershell.exe / cmd.exe / node.exe  (actual shell)
            └─ node.exe  (Claude Code)
                 └─ node.exe  (hook script)
```

Two problems compound:

**Problem A — HWND walk never reaches WT.**
The PID walk from `process.ppid` (Claude Code's node.exe) goes:
`node (hook) → node (Claude Code) → powershell/cmd/node shell → OpenConsole.exe`.
`OpenConsole.exe` has `MainWindowHandle == 0`. The walk never reaches
`WindowsTerminal.exe` because WT is not OpenConsole's parent — WT spawns
OpenConsole as a child but OpenConsole's parent PID in Win32 is
`WindowsTerminal.exe`. However, there is a documented issue (microsoft/terminal
#7084) where Windows Terminal's `MainWindowHandle` can be reported as 0 when
queried through `Get-Process` due to the MSIX packaging and how WT uses a
multi-process architecture where the "window" is logically owned by the UI
thread in a separate process from the ConPTY host.

**Problem B — Foreground lock.**
When the balloon tip `BalloonTipClicked` handler fires, the calling thread is
the WinForms message loop inside the detached `powershell.exe` balloon process.
That process has no foreground privilege. `AllowSetForegroundWindow(-1)` (ASFW_ANY)
does NOT grant foreground capability — it only tells the system that *another
specific process* may call `SetForegroundWindow`. A detached process calling
`AllowSetForegroundWindow` on itself does nothing useful. `SetForegroundWindow`
then silently fails (returns TRUE but has no visual effect) because the system
restricts which processes can bring a window to the foreground.

### Recommended Fix: Name-Based Lookup + AttachThreadInput

**Step 1 — Find WindowsTerminal.exe by name, not by PID walk.**

Replace the PID-walk HWND search with a direct name lookup:

```powershell
$wt = Get-Process -Name 'WindowsTerminal' -ErrorAction SilentlyContinue |
      Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } |
      Select-Object -First 1
$targetHwnd = if ($wt) { $wt.MainWindowHandle } else { [IntPtr]::Zero }
```

This is the approach used by the community's `Test-IsWindowsTerminal` function
(Mike F. Robbins, 2024) and is confirmed by microsoft/terminal #5694. It
bypasses the broken PID walk entirely. The user's environment has exactly one
Windows Terminal instance, so `Select-Object -First 1` is safe.

**Step 2 — Use `AttachThreadInput` to defeat the foreground lock.**

The canonical workaround for the foreground lock when calling from a process
that does not own the foreground is:

```csharp
// P/Invoke signatures needed in Add-Type block:
[DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
[DllImport("user32.dll")] static extern uint GetCurrentThreadId();
[DllImport("user32.dll")] static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
[DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr hWnd);
[DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
[DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);
```

**Sequence in the BalloonTipClicked handler:**

```
fgHwnd       = GetForegroundWindow()
fgThreadId   = GetWindowThreadProcessId(fgHwnd)
myThreadId   = GetCurrentThreadId()
if fgThreadId != myThreadId:
    AttachThreadInput(myThreadId, fgThreadId, true)
ShowWindow(targetHwnd, SW_RESTORE)      # 9
BringWindowToTop(targetHwnd)
SetForegroundWindow(targetHwnd)
if fgThreadId != myThreadId:
    AttachThreadInput(myThreadId, fgThreadId, false)
```

**Why this works:** `AttachThreadInput` temporarily joins the message queues of
the two threads. The target thread (the current foreground owner) effectively
sponsors the `SetForegroundWindow` call. This is the technique used by
PowerToys (microsoft/PowerToys PR #1282), PSOneTools
`Show-PSOneApplicationWindow`, and numerous Win32 focus-management libraries.

**Confidence: MEDIUM.** AttachThreadInput is well-documented (Microsoft Learn)
and the PowerToys usage confirms it works in practice on Windows 10/11.
However, Microsoft's own documentation notes: "Attaching threads of different
message queues can cause your application to stop responding" if the target
thread is in a hung state. In this hook's case the foreground thread is always
a live Windows Terminal UI thread, so the risk is acceptable.

**What NOT to use:**

| API | Why Not |
|-----|---------|
| `AllowSetForegroundWindow(-1)` alone | Does not grant privilege to the calling process; only grants it to another named process |
| `SwitchToThisWindow` | Undocumented, not in winuser.h, behavior unreliable on Win11 |
| `keybd_event` / `SendInput` (alt-tab trick) | Requires knowing the exact virtual key sequence; introduces timing dependency; sends real input events into the system that may hit the wrong window |
| `SetForegroundWindow` without `AttachThreadInput` | Silently fails when calling process is not the foreground owner |

---

## 3. Config File Format and Parsing

### Recommended Approach: JSON file in `%USERPROFILE%\.claude\hooks\`

**Location:** `%USERPROFILE%\.claude\hooks\notify-waiting-config.json`

This is confirmed in `PROJECT.md` ("next to the hook file, easy to find").
The hook already lives in `%USERPROFILE%\.claude\hooks\`, so the config is
discoverable without documentation.

**Parsing — Node.js side (config read once at hook startup):**

```javascript
const path = require('path');
const fs   = require('fs');

const CONFIG_PATH = path.join(
  process.env.USERPROFILE || process.env.HOME,
  '.claude', 'hooks', 'notify-waiting-config.json'
);

const DEFAULTS = {
  sound:    { frequency: 880, duration: 220 },
  balloon:  { title: 'Claude Code', message: 'Waiting for your input...', timeout: 6000 },
};

function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    const user = JSON.parse(raw);
    return {
      sound:   { ...DEFAULTS.sound,   ...(user.sound   || {}) },
      balloon: { ...DEFAULTS.balloon, ...(user.balloon || {}) },
    };
  } catch (_) {
    return DEFAULTS;  // missing file or malformed JSON — use defaults
  }
}

const config = loadConfig();
```

**Why JSON:**
- Native `JSON.parse` — zero dependency
- Human-editable in any text editor
- Supported by every Node.js version bundled with Claude Code
- Schema is simple (two top-level keys, shallow objects)
- `try/catch` around `readFileSync + JSON.parse` handles: file not found,
  permission denied, malformed JSON — all fall back to defaults

**Why not:**
- TOML/YAML: Requires a parser dependency or PowerShell parsing shim
- INI: No native parser, line-based format is awkward for nested values
- Registry: Harder to edit, not version-controllable, violates user expectations
  for a developer tool
- `.env`: No nested structure; not standard for non-server tools

**Schema (what the config file looks like):**

```json
{
  "sound": {
    "frequency": 880,
    "duration": 220
  },
  "balloon": {
    "title": "Claude Code",
    "message": "Waiting for your input...",
    "timeout": 6000
  }
}
```

All keys optional. Missing keys fall back to defaults. Extra keys ignored.

**Embedding config values into the PowerShell script string:**
Config values are read in Node.js, then interpolated as literals into the
PowerShell heredoc before encoding to base64. This avoids any JSON parsing
inside PowerShell 5.1, which is possible but verbose.

**Confidence: HIGH** — Standard Node.js pattern, no external dependencies.

---

## 4. Detecting Silent PowerShell Spawn Failures from Node.js

### Root Causes of Silent Failures

The current code wraps `spawn()` in `try/catch` and ignores errors. This
catches only synchronous exceptions (e.g., `ENOENT` when `powershell.exe` is
not on PATH). It does NOT catch:

1. **Process starts but exits with non-zero code** — PowerShell syntax errors,
   `Add-Type` compilation failures, missing .NET assembly.
2. **Process starts but the WinForms message loop never runs** — e.g., the
   encoded command is malformed, or the base64 decode fails silently.
3. **Process starts but hangs indefinitely** — WinForms `Application.Run()`
   blocked waiting for a message that never arrives.

### Recommended Approach: Log-to-file with timeout guard

Because the balloon process is detached and must remain detached (so the hook
exits immediately and Claude Code sees a clean run), we cannot pipe stderr from
the balloon process. What we CAN do:

**Option A — Log file from PowerShell (recommended for debugging phases):**

At the start of the PowerShell script, set `$ErrorActionPreference = 'Stop'`
and wrap the entire body in a `try/catch` that writes failures to a log file:

```powershell
$ErrorActionPreference = 'Stop'
$logPath = "$env:TEMP\claude-notify-error.log"
try {
    # ... entire balloon script ...
} catch {
    Add-Content -Path $logPath -Value "$(Get-Date -Format o) ERROR: $_"
}
```

This is silent to the user during normal operation but gives the developer a
diagnostic trail when investigating failures. The log file is only written on
error.

**Option B — Validate spawn succeeded in Node.js:**

The Node.js `spawn` 'spawn' event (not 'error') fires when the process
successfully starts. The 'error' event fires if the OS-level spawn fails
(ENOENT, EACCES). For the detached + unref pattern, add listeners before
calling `unref()`:

```javascript
const ps = spawn('powershell.exe', [...args], { detached: true, windowsHide: true, stdio: 'ignore' });
ps.on('error', (err) => {
  // OS-level spawn failure (powershell.exe not found, permission denied)
  // Log to file — do NOT throw, hook must exit 0
  const fs = require('fs');
  fs.appendFileSync(
    require('path').join(require('os').tmpdir(), 'claude-notify-error.log'),
    `${new Date().toISOString()} SPAWN_ERROR: ${err.message}\n`
  );
});
ps.unref();
```

**Why not keep the current bare `try/catch`:** It only catches synchronous
throws from `spawn()`, which in practice only occur for `ENOENT`. All the
interesting failure modes are asynchronous and invisible with the current code.

**Known Node.js issue with `detached: true` and `pwsh`:**
`nodejs/node#51018` documents that spawning `pwsh.exe` (PowerShell 7) with
`detached: true` on Windows can fail silently. The fix is to use `powershell.exe`
(5.1) not `pwsh.exe` — which the existing code already does correctly.

**Timeout guard (already implemented):** The PowerShell script's `$timer` at
7 seconds is the right pattern. It ensures the process does not hang
indefinitely if neither `BalloonTipClicked` nor `BalloonTipClosed` fires.

**Confidence: HIGH** — Node.js `child_process` event model is stable;
PowerShell `try/catch` + `Add-Content` is standard PS 5.1.

---

## Recommended Stack Table

### Runtime — No Changes

| Component | Technology | Version | Notes |
|-----------|-----------|---------|-------|
| Hook script | Node.js | Bundled with Claude Code | `child_process.spawn` |
| Balloon process | PowerShell | 5.1 (built into Windows) | `-EncodedCommand` |
| UI toolkit | System.Windows.Forms | .NET Framework GAC | NotifyIcon, Timer |
| Win32 interop | P/Invoke via `Add-Type` | N/A | user32.dll |

### New APIs Required

| API | DLL | Purpose | PS 5.1 Available |
|-----|-----|---------|-----------------|
| `Console.Beep(freq, ms)` | BCL | Custom tone | Yes (.NET 2.0+) |
| `AttachThreadInput` | user32.dll | Defeat foreground lock | Yes (Win32) |
| `GetForegroundWindow` | user32.dll | Get current foreground owner | Yes (Win32) |
| `GetWindowThreadProcessId` | user32.dll | Get foreground thread ID | Yes (Win32) |
| `GetCurrentThreadId` | user32.dll | Get balloon thread ID | Yes (Win32) |
| `BringWindowToTop` | user32.dll | Raise window in Z-order | Yes (Win32) |

### Dropped APIs

| API | Reason |
|-----|--------|
| `[System.Media.SystemSounds]::Asterisk` | Replaced by `Console.Beep` |
| `AllowSetForegroundWindow(-1)` | Ineffective from detached process |
| PID-walk HWND search | Replaced by name-based WT lookup |

### Config

| Component | Technology | Notes |
|-----------|-----------|-------|
| Config file | JSON | `%USERPROFILE%\.claude\hooks\notify-waiting-config.json` |
| Parser | Node.js `JSON.parse` | Sync read at hook startup, defaults on any error |
| Error log | Filesystem (`%TEMP%\claude-notify-error.log`) | Written only on failure |

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Tone generation | `Console.Beep` | SoundPlayer + MemoryStream WAV | 40+ lines of header construction for identical perceived result |
| Tone generation | `Console.Beep` | System Sounds (Asterisk etc.) | Not unique; not configurable |
| Window focus | AttachThreadInput pattern | `keybd_event` alt-tab trick | Sends real input; timing-sensitive; can hit wrong window |
| Window focus | AttachThreadInput pattern | `SwitchToThisWindow` | Undocumented; unreliable Win11 |
| Window focus | AttachThreadInput pattern | `AllowSetForegroundWindow(-1)` | Does not grant privilege to calling process |
| HWND lookup | Name-based (`Get-Process -Name WindowsTerminal`) | PID walk | PID walk terminates at OpenConsole.exe (MainWindowHandle=0) before reaching WT |
| Config format | JSON | TOML/YAML | Requires parser dependency |
| Config format | JSON | Windows Registry | Not version-controllable; not user-editable without regedit |
| Error detection | `ps.on('error')` + PS try/catch log | Ignore all errors | Silent failures give no diagnostic trail |

---

## Sources

- [SetForegroundWindow function — Microsoft Learn](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setforegroundwindow)
- [AllowSetForegroundWindow function — Microsoft Learn](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-allowsetforegroundwindow)
- [AttachThreadInput function — Microsoft Learn](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-attachthreadinput)
- [Console.Beep Method — Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.console.beep)
- [SendInput function — Microsoft Learn](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput)
- [BinaryWriter Class — Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.io.binarywriter)
- [MemoryStream Class — Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.io.memorystream)
- [Starting Terminal with wt no longer returns MainWindowHandle — microsoft/terminal #7084](https://github.com/microsoft/terminal/issues/7084)
- [Identify WindowsTerminal process ID — microsoft/terminal #5694](https://github.com/microsoft/terminal/issues/5694)
- [Get the PID of my OpenConsole.exe — microsoft/terminal Discussion #16447](https://github.com/microsoft/terminal/discussions/16447)
- [SendInput hack to workaround SetForegroundWindow — microsoft/PowerToys PR #1282](https://github.com/microsoft/PowerToys/pull/1282)
- [Detecting Windows Terminal with PowerShell — mikefrobbins.com (May 2024)](https://mikefrobbins.com/2024/05/16/detecting-windows-terminal-with-powershell/)
- [Windows Console and Terminal Ecosystem Roadmap — Microsoft Learn](https://learn.microsoft.com/en-us/windows/console/ecosystem-roadmap)
- [Spawning pwsh with detached:true does not work — nodejs/node #51018](https://github.com/nodejs/node/issues/51018)
- [Node.js Child Process documentation](https://nodejs.org/api/child_process.html)
- [WAVE PCM soundfile format — sapp.org](http://soundfile.sapp.org/doc/WaveFormat/)
- [SetForegroundWindow not always works — shlomio.wordpress.com (ForceForegroundWindow)](https://shlomio.wordpress.com/2012/09/04/solved-setforegroundwindow-win32-api-not-always-works/)
