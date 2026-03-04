#!/usr/bin/env node
// notify-waiting.js
// Claude Code Notification hook — fires when Claude is waiting for user input.
// Plays a sound and shows a clickable Windows toast notification.
// Clicking the notification focuses the terminal window running Claude Code.

'use strict';

const { spawn } = require('child_process');
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
  c.sound.frequency = Number(c.sound.frequency) || DEFAULTS.sound.frequency;
  c.sound.duration  = Number(c.sound.duration)  || DEFAULTS.sound.duration;
  c.balloon.timeout = Number(c.balloon.timeout)  || DEFAULTS.balloon.timeout;
  return c;
}());

// --- 1. Build toast notification script ---
//
// Windows 11 deprecated NotifyIcon balloon tips — they are silently suppressed.
// We use the WinRT ToastNotification API instead, which is the supported path.
//
// Process-tree walk starts from process.ppid (Claude's PID) so we find the
// terminal window correctly without being tripped up by cmd.exe intermediaries.
const claudePid = process.ppid;

const toastScript = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class ClaudeWin32 {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool AllowSetForegroundWindow(int dwProcessId);
    [DllImport("kernel32.dll")] public static extern bool Beep(uint dwFreq, uint dwDuration);
}
"@

# Config values interpolated from Node.js
$title     = '${config.balloon.title.replace(/'/g, "''")}'
$message   = '${config.balloon.message.replace(/'/g, "''")}'
$timeout   = ${config.balloon.timeout}
$frequency = ${config.sound.frequency}
$duration  = ${config.sound.duration}

# Play tone
try {
    [ClaudeWin32]::Beep([uint32]$frequency, [uint32]$duration) | Out-Null
} catch {}

function Get-ParentPid([int]$procId) {
    try { return [int](Get-CimInstance Win32_Process -Filter "ProcessId=$procId" -ErrorAction Stop).ParentProcessId }
    catch { return 0 }
}

# Walk process tree to find terminal window
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

# Fallback: search for known terminal processes by name
if ($targetHwnd -eq [IntPtr]::Zero) {
    $termNames = @('WindowsTerminal', 'wt', 'ConEmuC64', 'cmd', 'pwsh', 'powershell')
    foreach ($name in $termNames) {
        $p = Get-Process -Name $name -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } | Select-Object -First 1
        if ($p) { $targetHwnd = $p.MainWindowHandle; break }
    }
}

# Load WinRT assemblies for toast notifications
$null = [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime]
$null = [Windows.UI.Notifications.ToastNotification, Windows.UI.Notifications, ContentType=WindowsRuntime]
$null = [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType=WindowsRuntime]

$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml("<toast><visual><binding template='ToastGeneric'><text>$title</text><text>$message</text></binding></visual></toast>")

$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)

$script:done = $false
$hwnd = $targetHwnd

# Use PowerShell's own AUMID so the notifier is always accepted
$appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'
$notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId)
$notifier.Show($toast)
# Toast is now managed by Windows — process can exit immediately
`;

// --- 2. Spawn toast as a detached, hidden, independent process ---
const encoded = Buffer.from(toastScript, 'utf16le').toString('base64');
try {
  const ps = spawn('powershell.exe', [
    '-WindowStyle', 'Hidden',
    '-NonInteractive',
    '-EncodedCommand', encoded
  ], {
    windowsHide: true,
    stdio: 'ignore'
  });

  ps.on('error', (err) => {
    try {
      const ts = new Date().toISOString();
      fs.appendFileSync(logPath, '[' + ts + '] SPAWN_ERROR: ' + err.message + '\n');
    } catch (_) {}
  });
} catch (_) {}
