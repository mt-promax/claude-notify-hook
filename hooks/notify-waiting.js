#!/usr/bin/env node
// notify-waiting.js
// Claude Code Notification hook — fires when Claude is waiting for user input.
// Plays a sound and shows a clickable Windows balloon notification.
// Clicking the notification focuses the terminal window running Claude Code.

const { exec } = require('child_process');

// Play the Windows notification sound (non-blocking, returns immediately)
exec('powershell -WindowStyle Hidden -NonInteractive -Command "[System.Media.SystemSounds]::Asterisk.Play()"');

// PowerShell script: clickable balloon that focuses the Claude terminal on click.
// Uses Application.Run() + timer so WinForms events (click/close) actually fire.
// Walks up the process tree to find the first ancestor with a visible window.
const balloon = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class ClaudeWin32 {
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@

function Get-ParentPid([int]$ProcessId) {
    try {
        return [int](Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction Stop).ParentProcessId
    } catch { return 0 }
}

# Walk up the process tree to find the first ancestor with a visible window handle
$targetHwnd = [IntPtr]::Zero
$walkPid = $PID
for ($i = 0; $i -lt 10; $i++) {
    $parentId = Get-ParentPid $walkPid
    if ($parentId -le 0) { break }
    $parent = Get-Process -Id $parentId -ErrorAction SilentlyContinue
    if ($parent -and $parent.MainWindowHandle -ne [IntPtr]::Zero) {
        $targetHwnd = $parent.MainWindowHandle
        break
    }
    $walkPid = $parentId
}

$n = New-Object System.Windows.Forms.NotifyIcon
$n.Icon = [System.Drawing.SystemIcons]::Information
$n.Visible = $true

# On click: restore + focus the terminal, then exit the message loop
$n.add_BalloonTipClicked(({
    if ($targetHwnd -ne [IntPtr]::Zero) {
        [ClaudeWin32]::ShowWindow($targetHwnd, 9)       # SW_RESTORE = 9
        [ClaudeWin32]::SetForegroundWindow($targetHwnd)
    }
    [System.Windows.Forms.Application]::Exit()
}).GetNewClosure())

# On dismiss (timeout or X): just exit the message loop
$n.add_BalloonTipClosed(({ [System.Windows.Forms.Application]::Exit() }).GetNewClosure())

$n.ShowBalloonTip(6000, 'Claude Code', 'Waiting for your input...', [System.Windows.Forms.ToolTipIcon]::Info)

# Safety timer: exit after 7 s even if neither event fires
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 7000
$timer.add_Tick(({ $timer.Stop(); [System.Windows.Forms.Application]::Exit() }).GetNewClosure())
$timer.Start()

# Run the WinForms message loop so click/close events can fire
[System.Windows.Forms.Application]::Run()
$timer.Dispose()
$n.Dispose()
`;

const encoded = Buffer.from(balloon, 'utf16le').toString('base64');
exec(`powershell -WindowStyle Hidden -NonInteractive -EncodedCommand ${encoded}`);
