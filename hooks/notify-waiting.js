#!/usr/bin/env node
// notify-waiting.js
// Claude Code Notification hook — fires when Claude is waiting for user input.
// Plays a sound and shows a clickable Windows balloon notification.
// Clicking the notification focuses the terminal window running Claude Code.

'use strict';

const { execFile, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Exit cleanly on any unhandled error so Claude Code sees a successful hook run.
process.on('uncaughtException', () => process.exit(0));

const logPath = path.join(process.env.TEMP || process.env.USERPROFILE, 'claude-notify-error.log');

// --- Config loading ---
const DEFAULTS = {
  sound: {
    frequency: 880,
    duration: 220
  },
  balloon: {
    title: 'Claude Code',
    message: 'Waiting for your input...',
    timeout: 6000
  }
};

const CONFIG_PATH = path.join(
  process.env.USERPROFILE || process.env.HOME,
  '.claude', 'hooks', 'notify-waiting-config.json'
);

function loadConfig() {
  try {
    let raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    raw = raw.replace(/^\uFEFF/, ''); // Strip UTF-8 BOM (Notepad writes this by default)
    const user = JSON.parse(raw);
    return {
      sound: { ...DEFAULTS.sound, ...(user.sound || {}) },
      balloon: { ...DEFAULTS.balloon, ...(user.balloon || {}) }
    };
  } catch (_) {
    return DEFAULTS;
  }
}

const config = (function () {
  const c = loadConfig();
  // Coerce numeric fields — user may save them as strings e.g. "frequency": "880"
  c.sound.frequency = Number(c.sound.frequency) || DEFAULTS.sound.frequency;
  c.sound.duration  = Number(c.sound.duration)  || DEFAULTS.sound.duration;
  c.balloon.timeout = Number(c.balloon.timeout)  || DEFAULTS.balloon.timeout;
  return c;
}());

// --- 1. Play sound immediately (fire-and-forget) ---
try {
  execFile('powershell.exe', [
    '-WindowStyle', 'Hidden',
    '-NonInteractive',
    '-Command',
    '[System.Media.SystemSounds]::Asterisk.Play()'
  ], { windowsHide: true });
} catch (_) {}

// --- 2. Build balloon script ---
//
// KEY FIX: embed process.ppid (Claude Code's PID) directly into the script so
// the process-tree walk starts from Claude, not from the balloon's own $PID.
//
// Why the old code found the wrong window:
//   exec() on Windows spawns through a cmd.exe intermediary:
//     balloon-powershell ← cmd.exe (exec) ← node (hook) ← node (claude) ← terminal
//   That cmd.exe inherits the console from its parent and can report a non-zero
//   MainWindowHandle, so the walk stopped there instead of reaching the terminal.
//
// Fix: start from process.ppid (Claude's PID) — the walk immediately heads toward
// the terminal, with no intermediary processes in the way.
const claudePid = process.ppid;

const balloon = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class ClaudeWin32 {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool AllowSetForegroundWindow(int dwProcessId);
}
"@

# Config values interpolated from Node.js (Phase 2)
$title     = '${config.balloon.title.replace(/'/g, "''")}'
$message   = '${config.balloon.message.replace(/'/g, "''")}'
$timeout   = ${config.balloon.timeout}
$frequency = ${config.sound.frequency}
$duration  = ${config.sound.duration}

function Get-ParentPid([int]$pid) {
    try { return [int](Get-CimInstance Win32_Process -Filter "ProcessId=$pid" -ErrorAction Stop).ParentProcessId }
    catch { return 0 }
}

# Walk up from Claude Code's PID to find the terminal window.
# Check the starting PID itself first (Claude may already have a console handle),
# then walk up to parent processes.
$targetHwnd = [IntPtr]::Zero
$walkPid = ${claudePid}
for ($i = 0; $i -lt 15; $i++) {
    $proc = Get-Process -Id $walkPid -ErrorAction SilentlyContinue
    if ($proc -and $proc.MainWindowHandle -ne [IntPtr]::Zero) {
        $targetHwnd = $proc.MainWindowHandle
        break
    }
    $parentId = Get-ParentPid $walkPid
    if ($parentId -le 0) { break }
    $walkPid = $parentId
}

# Fallback: search for WindowsTerminal.exe or known terminal processes by name
if ($targetHwnd -eq [IntPtr]::Zero) {
    $termNames = @('WindowsTerminal', 'wt', 'ConEmuC64', 'cmd', 'pwsh', 'powershell')
    foreach ($name in $termNames) {
        $p = Get-Process -Name $name -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } | Select-Object -First 1
        if ($p) { $targetHwnd = $p.MainWindowHandle; break }
    }
}

$n = New-Object System.Windows.Forms.NotifyIcon
$n.Icon    = [System.Drawing.SystemIcons]::Information
$n.Visible = $true

# RELY-03: stabilization delay prevents silent balloon suppression on shell registration race
Start-Sleep -Milliseconds 100

# On click: lift Windows foreground lock, restore + focus the terminal, then exit
$n.add_BalloonTipClicked(({
    if ($targetHwnd -ne [IntPtr]::Zero) {
        [ClaudeWin32]::AllowSetForegroundWindow(-1)   # ASFW_ANY — lift focus lock
        [ClaudeWin32]::ShowWindow($targetHwnd, 9)     # SW_RESTORE = 9
        [ClaudeWin32]::SetForegroundWindow($targetHwnd)
    }
    [System.Windows.Forms.Application]::Exit()
}).GetNewClosure())

# On dismiss (timeout or X): just exit the message loop
$n.add_BalloonTipClosed(({ [System.Windows.Forms.Application]::Exit() }).GetNewClosure())

# RELY-03: confirm balloon appeared - writes to log for diagnostics
$n.add_BalloonTipShown(({
    try {
        $ts = Get-Date -Format o
        Add-Content -Path "$env:TEMP\claude-notify-error.log" -Value "[$ts] BalloonTipShown: notification appeared"
    } catch {}
}).GetNewClosure())

$n.ShowBalloonTip($timeout, $title, $message, [System.Windows.Forms.ToolTipIcon]::Info)

# Safety timer: exit after 7 s even if neither event fires
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = ${config.balloon.timeout + 1000}
$timer.add_Tick(({ $timer.Stop(); [System.Windows.Forms.Application]::Exit() }).GetNewClosure())
$timer.Start()

# Run the WinForms message loop so click/close events can fire
[System.Windows.Forms.Application]::Run()
$timer.Dispose()
$n.Dispose()
`;

// --- 3. Spawn balloon as a detached, hidden, independent process ---
// spawn() bypasses the cmd.exe intermediary that exec() adds.
// detached + stdio:'ignore' + unref() lets it outlive this hook script.
// stderr is piped so PowerShell errors surface to the error log (RELY-02).
const encoded = Buffer.from(balloon, 'utf16le').toString('base64');
try {
  const ps = spawn('powershell.exe', [
    '-WindowStyle', 'Hidden',
    '-NonInteractive',
    '-EncodedCommand', encoded
  ], {
    detached: true,
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'pipe']
  });

  ps.on('error', (err) => {
    try {
      const ts = new Date().toISOString();
      fs.appendFileSync(logPath, '[' + ts + '] SPAWN_ERROR: ' + err.message + '\n');
    } catch (_) {}
  });

  let errBuf = '';
  ps.stderr.on('data', (chunk) => { errBuf += chunk.toString('utf8'); });
  ps.stderr.on('close', () => {
    if (errBuf.trim()) {
      try {
        const ts = new Date().toISOString();
        fs.appendFileSync(logPath, '[' + ts + '] POWERSHELL_ERROR:\n' + errBuf + '\n');
      } catch (_) {}
    }
  });

  ps.unref();
} catch (_) {}
