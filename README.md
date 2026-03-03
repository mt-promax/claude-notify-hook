# claude-notify-hook

A [Claude Code](https://claude.ai/claude-code) hook that shows a **clickable Windows balloon notification** whenever Claude is waiting for your input. Click the notification to jump straight to the terminal window.

- Plays the Windows system notification sound
- Shows a balloon tip in the system tray
- **Clicking it focuses and restores the Claude terminal** — no hunting for the window
- Auto-dismisses after 6 seconds if ignored

> **Windows only** — uses PowerShell + WinForms for the notification and Win32 `SetForegroundWindow` for focus.

---

## Install

### Option 1 — Claude Code plugin (recommended)

```
claude plugin install mt-promax/claude-notify-hook
```

### Option 2 — One-liner PowerShell installer

```powershell
irm https://raw.githubusercontent.com/mt-promax/claude-notify-hook/main/install.ps1 | iex
```

This downloads `notify-waiting.js` to `~/.claude/hooks/` and automatically adds the hook entry to `~/.claude/settings.json`.

---

## Manual install

1. Copy `hooks/notify-waiting.js` to `%USERPROFILE%\.claude\hooks\`
2. Add this to `%USERPROFILE%\.claude\settings.json`:

```json
{
  "hooks": {
    "Notification": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"%USERPROFILE%\\.claude\\hooks\\notify-waiting.js\""
          }
        ]
      }
    ]
  }
}
```

---

## How it works

The `Notification` hook fires each time Claude finishes a response and is waiting for user input. The hook:

1. Plays `SystemSounds.Asterisk` immediately (non-blocking)
2. Spawns a hidden, detached PowerShell process that:
   - Receives Claude Code's PID (`process.ppid`) embedded in the script
   - Walks up the process tree **from Claude's PID** to find the terminal window
   - Shows a `NotifyIcon` balloon tip
   - Runs a WinForms message loop so the click event can fire
   - On click: calls `AllowSetForegroundWindow` + `ShowWindow(SW_RESTORE)` + `SetForegroundWindow` on the terminal handle
   - Auto-exits after 7 seconds via a timer

---

## Requirements

- Windows 10 or 11
- [Claude Code](https://claude.ai/claude-code) installed
- Node.js (comes with Claude Code)
- PowerShell 5.1 (built into Windows — no install needed)

---

## Uninstall

Remove the `Notification` hook entry from `%USERPROFILE%\.claude\settings.json` and delete `%USERPROFILE%\.claude\hooks\notify-waiting.js`.
