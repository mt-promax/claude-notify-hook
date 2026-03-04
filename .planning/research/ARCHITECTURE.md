# Architecture Patterns

**Domain:** Windows notification hook (Node.js + PowerShell)
**Researched:** 2026-03-04
**Confidence:** HIGH (authoritative Microsoft docs + Node.js docs; PowerShell patterns from official sources)

---

## Recommended Architecture

The hook has two runtime phases separated by a process boundary:

```
[Claude Code] --fires--> [Node.js hook] --spawns--> [PowerShell balloon process]
                               |                              |
                         (exits < 3s)               (runs 7s, stays alive
                                                     until click or timeout)

Node.js side (synchronous, must be fast):
  1. Read config (fs.readFileSync + defaults merge)
  2. Extract claudePid (process.ppid)
  3. Spawn balloon PowerShell (detached, base64-encoded script)
  4. Log spawn errors to stderr file (fire-and-forget)
  5. Exit 0

PowerShell side (detached, can be slow):
  1. Synthesize tone → play it
  2. Walk process tree to find WindowsTerminal.exe HWND
  3. Show NotifyIcon balloon with config values
  4. On click: AttachThreadInput + SetForegroundWindow to focus terminal
  5. On close/timeout: dispose and exit
```

The single-file architecture (`notify-waiting.js`) is the right choice for this scope. The improvements are all internal to that file. No separate helper scripts, no compiled binaries.

---

## Component Boundaries

| Component | Location | Responsibility | Communicates With |
|-----------|----------|---------------|-------------------|
| Config loader | Node.js, top of file | Read JSON from disk, merge with defaults, produce flat config object | Passes values into PowerShell template as interpolated literals |
| PID extractor | Node.js | `process.ppid` — Claude's PID, embedded into PowerShell script | PowerShell walk loop |
| Script builder | Node.js | Template literal with config values interpolated | PowerShell process |
| Spawn wrapper | Node.js | `spawn()` with error capture to stderr log | OS process table |
| Tone synthesizer | PowerShell balloon | Generate WAV bytes in MemoryStream, play via SoundPlayer | No other component |
| Window finder | PowerShell balloon | Walk process tree by name targeting WindowsTerminal.exe | Win32 API (SetForegroundWindow) |
| Balloon UI | PowerShell balloon | NotifyIcon + BalloonTip, WinForms message loop | Window finder (on click) |
| Focus caller | PowerShell balloon | AttachThreadInput + SetForegroundWindow sequence | Window finder HWND |

---

## Data Flow: Config to Node to PowerShell

```
~/.claude/hooks/notify-waiting-config.json
         |
         v
  fs.existsSync() → true? readFileSync + JSON.parse → merge with DEFAULTS
                  → false? use DEFAULTS as-is
         |
         v
  flat config object:
    { frequency: 880, duration: 200, title: "Claude Code",
      message: "Waiting for your input...", timeout: 6000 }
         |
         v
  Node.js template literal interpolation:
    $freq = ${config.frequency}
    $dur  = ${config.duration}
    ...embedded directly as PowerShell literal values...
         |
         v
  Buffer.from(balloon, 'utf16le').toString('base64')
         |
         v
  spawn('powershell.exe', ['-EncodedCommand', encoded], { detached: true, ... })
         |
         v
  PowerShell balloon script runs with baked-in values
  (no file I/O needed inside PowerShell — values are compile-time constants)
```

**Key decision:** Values travel as interpolated literals, not as environment variables or stdin. This keeps the PowerShell script self-contained and avoids any IPC complexity across the process boundary. The PowerShell process reads nothing from disk.

---

## Patterns to Follow

### Pattern 1: Config with baked-in defaults (no config = works)

**What:** Define defaults as a constant object in Node.js. If config file is absent or malformed, fall through to defaults. Never throw.

**When:** Always — the constraint from PROJECT.md is explicit: hook must work with no config file.

```javascript
const DEFAULTS = {
  frequency: 880,       // Hz — distinctive, not alarming
  duration:  200,       // ms
  title:     'Claude Code',
  message:   'Waiting for your input...',
  timeout:   6000       // ms balloon stays visible
};

function loadConfig(configPath) {
  try {
    if (require('fs').existsSync(configPath)) {
      const raw = JSON.parse(require('fs').readFileSync(configPath, 'utf8'));
      return Object.assign({}, DEFAULTS, raw);
    }
  } catch (_) {}
  return Object.assign({}, DEFAULTS);
}

const configPath = require('path').join(
  process.env.USERPROFILE || process.env.HOME,
  '.claude', 'hooks', 'notify-waiting-config.json'
);
const config = loadConfig(configPath);
```

**Confidence:** HIGH — standard Node.js pattern, no dependency on any library.

---

### Pattern 2: Spawn error capture without blocking hook exit

**What:** Write PowerShell spawn errors to a log file asynchronously. Do not block on it. Do not let it affect hook exit code.

**When:** Current code silently swallows spawn failures (`catch (_) {}`). The fix is to capture stderr to a log file so failures are diagnosable, without adding latency.

```javascript
const logPath = require('path').join(
  process.env.USERPROFILE || process.env.HOME,
  '.claude', 'hooks', 'notify-waiting-error.log'
);

const ps = spawn('powershell.exe', [
  '-WindowStyle', 'Hidden', '-NonInteractive', '-EncodedCommand', encoded
], {
  detached:    true,
  windowsHide: true,
  stdio:       ['ignore', 'ignore', 'pipe']   // capture stderr only
});

// Collect stderr non-blocking
let errBuf = '';
ps.stderr.on('data', d => { errBuf += d; });
ps.stderr.on('close', () => {
  if (errBuf.trim()) {
    const ts = new Date().toISOString();
    try { require('fs').appendFileSync(logPath, `[${ts}] ${errBuf}\n`); } catch (_) {}
  }
});

ps.unref();
```

**Why stderr pipe does not block:** `ps.unref()` removes the child from the parent's event loop reference count. Node exits normally. The stderr pipe remains open on the child side until PowerShell exits, but that does not prevent Node from exiting because the pipe's read end is in Node's event loop which is no longer held open.

**Known Node.js issue:** `spawn()` with PowerShell + `detached: true` has a documented quirk where exit codes are sometimes not reported correctly (nodejs/node #45593). This is not a problem here because we only care about detecting spawn failure (ENOENT, permission error), which surfaces as the `error` event on the spawn object, not as an exit code.

```javascript
ps.on('error', err => {
  try { require('fs').appendFileSync(logPath, `[spawn-error] ${err.message}\n`); } catch (_) {}
});
```

**Confidence:** MEDIUM — spawn error event is reliable; stderr pipe behavior with `unref()` is verified in Node.js docs. The specific PowerShell exit code loss issue is a known documented quirk.

---

### Pattern 3: Window-finding — name-first, PID-walk as fallback

**What:** Instead of starting the walk from `process.ppid` and hoping to find a window handle, query `WindowsTerminal.exe` by name first. Use the PID walk as a tiebreaker when multiple WT instances exist.

**When:** This is the fix for the core "click never focuses the terminal" failure.

**Why the current code fails:** The current code walks upward from `claudePid` until it finds any process with a non-zero `MainWindowHandle`. On modern Windows Terminal architecture, the process tree looks like:

```
WindowsTerminal.exe (UI, has MainWindowHandle)
  └── OpenConsole.exe  (ConPTY host — may also have a window handle)
        └── node.exe (Claude Code runner)
              └── node.exe (hook — this is process.ppid)
```

OpenConsole.exe sometimes reports a non-zero `MainWindowHandle` for its hidden console window. When it does, the walk stops there and `SetForegroundWindow` is called on the wrong handle.

**Recommended strategy:**

```powershell
# Step 1: Walk tree from claudePid, but FILTER to known WT process names only
$termProcessNames = @('WindowsTerminal')  # exact name, not partial
$targetHwnd = [IntPtr]::Zero
$walkPid = $claudePid

for ($i = 0; $i -lt 20; $i++) {
    $proc = Get-Process -Id $walkPid -ErrorAction SilentlyContinue
    if ($proc -and $termProcessNames -contains $proc.ProcessName -and
        $proc.MainWindowHandle -ne [IntPtr]::Zero) {
        $targetHwnd = $proc.MainWindowHandle
        break
    }
    $parentId = (Get-CimInstance Win32_Process -Filter "ProcessId=$walkPid" `
                  -ErrorAction SilentlyContinue).ParentProcessId
    if (-not $parentId -or $parentId -le 0) { break }
    $walkPid = [int]$parentId
}

# Step 2: If walk found nothing (no WT in tree), fall back to any visible WT window
if ($targetHwnd -eq [IntPtr]::Zero) {
    $wt = Get-Process -Name 'WindowsTerminal' -ErrorAction SilentlyContinue |
          Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } |
          Select-Object -First 1
    if ($wt) { $targetHwnd = $wt.MainWindowHandle }
}
```

**Why name-filtering during the walk is better than the current approach:**
- Skips OpenConsole.exe (which can have a spurious window handle)
- Skips `node.exe` and `pwsh.exe` (which have no UI window)
- Reaches `WindowsTerminal.exe` reliably — it is always in the tree when WT is the host
- Multiple WT instances: the walk version picks the one that is an ancestor of Claude, which is the correct one

**Confidence:** MEDIUM-HIGH — the process architecture is documented by Microsoft (OpenConsole as ConPTY host under WT). The name-filter logic is derived from the mikefrobbins.com detection pattern (2024). The specific behavior of OpenConsole's MainWindowHandle is inferred from the architecture, not directly tested.

---

### Pattern 4: AttachThreadInput for reliable focus

**What:** Before calling `SetForegroundWindow`, attach the balloon process's UI thread to the currently-active foreground thread. This makes Windows treat the call as coming from the foreground owner.

**When:** This is the fix for `SetForegroundWindow` silently failing (window just flashes in taskbar instead of coming to front).

**Why `AllowSetForegroundWindow(-1)` alone is insufficient:** The current code calls `AllowSetForegroundWindow(-1)` (ASFW_ANY) from inside the balloon process. However, `AllowSetForegroundWindow` can only be called by a process that is already the foreground owner or has been explicitly granted permission. A detached PowerShell process launched by a background hook has neither of these. The call silently succeeds (returns true) but has no effect.

**Reliable sequence:**

```powershell
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class Win32Focus {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
    [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
}
"@

function Invoke-Focus {
    param([IntPtr]$hwnd)
    # Get thread IDs
    $dummy     = 0
    $fgHwnd    = [Win32Focus]::GetForegroundWindow()
    $fgThread  = [Win32Focus]::GetWindowThreadProcessId($fgHwnd,  [ref]$dummy)
    $myThread  = [Win32Focus]::GetCurrentThreadId()

    # Attach our thread to the foreground thread
    [Win32Focus]::AttachThreadInput($myThread, $fgThread, $true)  | Out-Null
    # Now SetForegroundWindow succeeds
    [Win32Focus]::ShowWindow($hwnd, 9)               | Out-Null  # SW_RESTORE
    [Win32Focus]::SetForegroundWindow($hwnd)         | Out-Null
    # Detach
    [Win32Focus]::AttachThreadInput($myThread, $fgThread, $false) | Out-Null
}
```

**Call site (in BalloonTipClicked handler):**

```powershell
$n.add_BalloonTipClicked(({
    if ($targetHwnd -ne [IntPtr]::Zero) { Invoke-Focus $targetHwnd }
    [System.Windows.Forms.Application]::Exit()
}).GetNewClosure())
```

**Confidence:** MEDIUM — AttachThreadInput is the standard documented bypass for this restriction (Microsoft docs, PowerToys #14383). It is not 100% guaranteed across all Windows configurations (e.g., UIPI may block cross-integrity-level attachment), but it is significantly more reliable than the current approach.

---

### Pattern 5: In-memory tone synthesis (no file, configurable)

**What:** Generate WAV bytes in a `MemoryStream` and play via `System.Media.SoundPlayer`. Do not use `[System.Console]::Beep()` (blocks the PowerShell thread during playback) and do not use `SystemSounds.Asterisk` (plays Windows error sound, not configurable).

**When:** Sound must play at start of balloon script, before the WinForms message loop. Playback must be non-blocking so the message loop starts quickly.

**Two options compared:**

| Option | Pros | Cons |
|--------|------|------|
| `[Console]::Beep(freq, dur)` | One line, no imports | Blocks the thread for `dur` ms; no async; not distinctive (PC speaker tone on modern hardware) |
| `SoundPlayer` + `MemoryStream` WAV | Non-blocking (`Play()` is async); configurable freq/dur; uses audio hardware (real tone, not PC speaker) | ~15 lines of WAV header construction |

**Recommendation:** Use `SoundPlayer` + `MemoryStream`. The WAV format for a simple sine wave at 44100 Hz sample rate is well-defined and the header construction is mechanical.

```powershell
function New-ToneWav {
    param([int]$Frequency = 880, [int]$DurationMs = 200)
    $sampleRate  = 44100
    $bitsPerSamp = 16
    $channels    = 1
    $numSamples  = [int]($sampleRate * $DurationMs / 1000)
    $dataBytes   = $numSamples * $channels * ($bitsPerSamp / 8)

    $ms = New-Object System.IO.MemoryStream
    $bw = New-Object System.IO.BinaryWriter($ms)

    # RIFF header
    $bw.Write([byte[]][System.Text.Encoding]::ASCII.GetBytes('RIFF'))
    $bw.Write([int32](36 + $dataBytes))
    $bw.Write([byte[]][System.Text.Encoding]::ASCII.GetBytes('WAVE'))
    # fmt  chunk
    $bw.Write([byte[]][System.Text.Encoding]::ASCII.GetBytes('fmt '))
    $bw.Write([int32]16)         # chunk size
    $bw.Write([int16]1)          # PCM
    $bw.Write([int16]$channels)
    $bw.Write([int32]$sampleRate)
    $bw.Write([int32]($sampleRate * $channels * $bitsPerSamp / 8))   # byte rate
    $bw.Write([int16]($channels * $bitsPerSamp / 8))                  # block align
    $bw.Write([int16]$bitsPerSamp)
    # data chunk
    $bw.Write([byte[]][System.Text.Encoding]::ASCII.GetBytes('data'))
    $bw.Write([int32]$dataBytes)
    for ($i = 0; $i -lt $numSamples; $i++) {
        $sample = [int16](32767 * [Math]::Sin(2 * [Math]::PI * $Frequency * $i / $sampleRate))
        $bw.Write($sample)
    }
    $bw.Flush()
    $ms.Position = 0
    return $ms
}

$toneStream = New-ToneWav -Frequency $freq -DurationMs $dur
$player = New-Object System.Media.SoundPlayer($toneStream)
$player.Play()   # async — returns immediately, tone plays in background
```

**Confidence:** MEDIUM — `SoundPlayer` accepting a `Stream` is documented in .NET Framework 4.x and .NET. The WAV byte construction pattern is confirmed via sysnative forums post on in-memory WAV for SoundPlayer. PowerShell 5.1 (the target runtime) uses .NET Framework 4.x, which has this API. Note: `SoundPlayer.Play()` is async; `PlaySync()` would block.

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Silent catch-all in spawn wrapper

**What:** `try { spawn(...) } catch (_) {}` — current code.

**Why bad:** Spawn can fail with `ENOENT` (powershell.exe not found in PATH), permission errors, or resource exhaustion. Silent swallow means the user sees nothing and can't diagnose the failure.

**Instead:** Capture `ps.on('error', ...)` and write to a log file. Keep the catch-all for catastrophic cases only.

---

### Anti-Pattern 2: `AllowSetForegroundWindow(-1)` without `AttachThreadInput`

**What:** Current code calls `AllowSetForegroundWindow(-1)` (ASFW_ANY) from the balloon process.

**Why bad:** Grants permission to "any process" — but the balloon process itself still cannot call `SetForegroundWindow` reliably if it is not the foreground owner. The lock is not lifted for the calling process itself by this call; it only grants other processes permission to set the foreground. Calling it on itself has no effect.

**Instead:** Use `AttachThreadInput` as described in Pattern 4.

---

### Anti-Pattern 3: Walking the process tree without name-filtering

**What:** Current code: stop at first process with non-zero `MainWindowHandle`.

**Why bad:** OpenConsole.exe (the ConPTY host in the WT process tree) can have a hidden console window with a valid HWND. The walk stops there instead of reaching WindowsTerminal.exe.

**Instead:** Filter during the walk — only stop when `ProcessName -eq 'WindowsTerminal'` (Pattern 3).

---

### Anti-Pattern 4: Separate `execFile` call for sound

**What:** Current code fires a separate `execFile` call to PowerShell just to play `SystemSounds.Asterisk`.

**Why bad:** Adds an extra PowerShell process start (slow, ~300ms startup). Uses Windows Asterisk (not configurable, not distinctive). The balloon PowerShell process could handle tone synthesis itself.

**Instead:** Move tone synthesis into the balloon script (Pattern 5). Eliminate the `execFile` call entirely. The balloon already starts a PowerShell process; tone synthesis adds negligible time inside it.

---

## Build Order Recommendation

Fix in this order. Each fix is independently deployable and the order minimizes wasted debugging effort.

### Phase 1: Error surfacing (fix first)

**Why first:** Without error visibility, debugging the focus fix (Phase 2) is guesswork. Silent failures mean you cannot tell whether PowerShell failed to spawn, spawned but crashed, or ran but `SetForegroundWindow` returned false.

**What to do:**
- Add `ps.on('error', ...)` error capture to log file
- Add stderr pipe to balloon spawn (capture PowerShell runtime errors)
- Verify: trigger hook, check `notify-waiting-error.log`, confirm no errors before moving on

**Effort:** Low. Two event handlers + `appendFileSync`.

---

### Phase 2: Config loading (do second)

**Why second:** Config values need to exist before implementing the tone fix (Phase 3) and the balloon text (Phase 4). Doing config now means Phases 3 and 4 can just read `config.frequency` etc. without going back to change signatures.

**What to do:**
- Add `DEFAULTS` constant at top of file
- Add `loadConfig()` function (Pattern 1)
- Interpolate `config.frequency`, `config.duration`, `config.title`, `config.message`, `config.timeout` into the balloon template
- Write example `notify-waiting-config.json` to docs

**Effort:** Low-medium. Config reading is trivial; the main work is identifying every hardcoded value in the balloon template and replacing with interpolation.

---

### Phase 3: Tone synthesis (do third)

**Why third:** Config is now wired; tone parameters come from `config.frequency` and `config.duration`. Eliminates the `execFile` sound call.

**What to do:**
- Remove `execFile` sound call at top of `notify-waiting.js`
- Add `New-ToneWav` function to balloon template (Pattern 5)
- Add `$player.Play()` at top of balloon script, before WinForms setup
- Verify tone plays with default settings; verify config override works

**Effort:** Medium. WAV header construction is mechanical but fiddly.

---

### Phase 4: Window focus (do last)

**Why last:** The hardest to debug. By this point, error surfacing is in place so if `SetForegroundWindow` fails the PowerShell error will appear in the log. Config is wired.

**What to do:**
- Replace the window-walk logic with name-filtered walk (Pattern 3)
- Replace focus call with `Invoke-Focus` using `AttachThreadInput` (Pattern 4)
- Replace the `Add-Type` block with the expanded one that includes `GetForegroundWindow`, `GetWindowThreadProcessId`, `AttachThreadInput`, `GetCurrentThreadId`
- Verify: trigger hook, click balloon, confirm Windows Terminal comes to foreground

**Effort:** Medium-high. Logic change is small but the Win32 P/Invoke surface is larger and testing requires an active terminal session.

---

## Component Interaction Diagram

```
notify-waiting.js
├── loadConfig()
│   ├── fs.existsSync(configPath) → bool
│   ├── fs.readFileSync → JSON.parse → raw config
│   └── Object.assign(DEFAULTS, raw) → config
│
├── buildBalloonScript(config, claudePid) → string
│   └── Template literal with:
│       ├── $freq = ${config.frequency}
│       ├── $dur  = ${config.duration}
│       ├── $title = "${config.title}"
│       ├── $msg  = "${config.message}"
│       ├── $timeout = ${config.timeout}
│       └── $claudePid = ${claudePid}
│
└── spawnBalloon(script)
    ├── Buffer.from(script, 'utf16le').toString('base64')
    ├── spawn('powershell.exe', [...], { detached, stdio: ['ignore','ignore','pipe'] })
    ├── ps.on('error') → appendFileSync(logPath)
    ├── ps.stderr.on('close') → appendFileSync(logPath) if non-empty
    └── ps.unref()

[PowerShell balloon process — independent lifetime]
├── New-ToneWav($freq, $dur) → MemoryStream
├── SoundPlayer.Play()           ← async, returns immediately
├── Walk-Tree($claudePid) → $targetHwnd (WindowsTerminal.exe only)
├── NotifyIcon + BalloonTip setup (title, message, timeout from config)
├── BalloonTipClicked → Invoke-Focus($targetHwnd) → exit
├── BalloonTipClosed  → exit
└── Timer ($timeout + 1000ms) → exit
```

---

## Scalability Considerations

This is a single-user desktop hook. Scalability is not a concern. The relevant operational concerns are:

| Concern | Current State | With Fix |
|---------|--------------|----------|
| Hook exit time | < 50ms (spawn is non-blocking) | Same — config read adds < 5ms |
| PowerShell startup | ~300ms (hidden, user doesn't wait) | Same |
| Multiple simultaneous hooks | Each spawns independent balloon | Same — WinForms timer kills it |
| Log file growth | N/A (no log) | Small — only writes on error |

---

## Sources

- [SetForegroundWindow function (winuser.h) — Microsoft Learn](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setforegroundwindow) — HIGH confidence, official
- [AllowSetForegroundWindow function (winuser.h) — Microsoft Learn](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-allowsetforegroundwindow) — HIGH confidence, official
- [Detecting Windows Terminal with PowerShell — mikefrobbins.com (2024)](https://mikefrobbins.com/2024/05/16/detecting-windows-terminal-with-powershell/) — MEDIUM confidence, third-party verified technique
- [Node.js child_process documentation](https://nodejs.org/api/child_process.html) — HIGH confidence, official
- [spawn() loses exit code with PowerShell — nodejs/node #45593](https://github.com/nodejs/node/issues/45593) — MEDIUM confidence, confirmed issue report
- [Windows Console and Terminal Ecosystem Roadmap — Microsoft Learn](https://learn.microsoft.com/en-us/windows/console/ecosystem-roadmap) — HIGH confidence, describes OpenConsole.exe role
- [FancyZones SetForegroundWindow bypass — PowerToys PR #14383](https://github.com/microsoft/PowerToys/pull/14383) — MEDIUM confidence, production implementation reference
- [SPI_SETFOREGROUNDLOCKTIMEOUT workaround — Damir's Corner](https://www.damirscorner.com/blog/posts/20060603-ProblemsWithSetForegroundWindowCalls.html) — MEDIUM confidence, explains why AllowSetForegroundWindow alone fails
- [C# WAV MemoryStream for SoundPlayer — Sysnative Forums](https://www.sysnative.com/forums/threads/c-loading-wav-formatted-beep-to-memorystream-played-by-system-audio.2236/) — MEDIUM confidence, in-memory WAV construction pattern
