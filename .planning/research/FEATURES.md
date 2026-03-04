# Feature Landscape

**Domain:** Windows developer CLI notification hook (Claude Code)
**Researched:** 2026-03-04
**Overall confidence:** HIGH (platform APIs) / MEDIUM (community patterns)

---

## Table Stakes

Features users expect. Missing = the hook feels broken or untrustworthy.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Notification appears on every trigger | Core contract of a "hook" — silent failures destroy trust | Med | Current silent failure caused by detached spawn; fix with process exit code check or fallback retry |
| Audible alert on trigger | The whole point is to get your attention while you're looking at something else | Low | Console.Beep or SoundPlayer; current Asterisk sound works but is generic |
| Notification body shows relevant message | Users want to know which event fired, not just "something happened" | Low | Hardcoded "Waiting for your input..." is acceptable minimum; dynamic text from hook stdin is better |
| Notification disappears on its own | A persistent balloon that never clears is annoying and piles up | Low | Timeout already implemented (7 s timer + BalloonTipClosed event) |
| Hook exits fast enough for Claude Code timeout | Claude Code kills hooks that hang; hook must complete before timeout | Low | Already implemented via detached spawn + unref() |
| Config file works out of the box with no edits | Config with no file = hook crashes = no notification | Low | Defaults must be baked into the script; config is additive, not required |

---

## Differentiators

Features that make this hook meaningfully better than a plain `notify-send`-style call.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Click-to-focus the correct terminal window | The #1 requested feature across all Claude Code notification hooks; no other Windows hook ships this working | High | AttachThreadInput + BringWindowToTop + SetForegroundWindow is the reliable pattern. Current code uses AllowSetForegroundWindow(-1) alone which is insufficient. |
| Unique generated tone (not system sound) | Trained response: "that beep means Claude is waiting." System Asterisk fires for unrelated Windows events — conditioning breaks. | Low | Console.Beep(frequency, duration) — no file dependency, configurable, plays immediately |
| Configurable sound (frequency + duration) | Developers who use the hook all day will want to tune it; some find high-frequency tones fatiguing | Low | Two JSON fields: `soundFrequency` (Hz, e.g. 880) and `soundDuration` (ms, e.g. 200) |
| Configurable notification text | Teams or users may want different balloon body text per workflow | Low | One JSON field: `message` (string) |
| Configurable timeout | Some users want longer visibility; some want instant-dismiss | Low | One JSON field: `timeoutMs` (ms, e.g. 6000) |
| Config file with schema hints | Editors can validate and autocomplete the config | Low | Add `$schema` field pointing to a JSON Schema file in the repo |
| Graceful silent-fail with fallback sound | If balloon spawn fails, at least the user still hears the tone | Low | Play sound first (already done), then spawn balloon separately — failure in spawn doesn't kill the sound |

---

## Anti-Features

Features to explicitly NOT build in this milestone.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Windows Toast notifications (UWP/WinRT) | Requires app identity registration or AUMID; significantly more complex; balloon is already the right UX level for a dev hook | Keep balloon tip — sufficient for purpose, PS 5.1-compatible, zero setup |
| macOS or Linux support | Out of scope by design; PowerShell + WinForms is Windows-only | Keep Windows-only; document clearly |
| Push to phone or external device | Not a developer-tool expectation; adds OAuth/API complexity | Scope out; mention in README as "not planned" |
| Multi-monitor window positioning | Focus is enough; positioning is intrusive and error-prone | Just focus the window, don't move it |
| Notification history / log file | Adds I/O, state management, and privacy concerns with no clear user need | If needed later, implement as opt-in |
| Per-project config | Over-engineering for a single-hook tool; global config covers all Claude Code sessions | One config at `%USERPROFILE%\.claude\hooks\notify-waiting-config.json` |
| Tray icon that persists between events | Balloon lifecycle is per-event; a persistent tray icon requires a background service | NotifyIcon is created and destroyed per-event — correct pattern |
| Retry loops on focus failure | Flashing the taskbar icon is acceptable fallback; retry loops cause visible thrashing | Attempt focus once; if Windows denies it, taskbar flash is the Windows-standard fallback |

---

## Feature Dependencies

```
Sound plays (step 1) — independent of balloon spawn (step 2)
  ↓ already working, keep this ordering

Config file read → sound frequency, sound duration, message text, timeout
  ↓ config must be read before spawn; default values must exist for all fields

Window handle discovered (process-tree walk) → click-to-focus on balloon click
  ↓ handle walk happens at spawn time, stored in balloon script
  ↓ AttachThreadInput click handler depends on handle being valid IntPtr

Balloon spawned (detached PS process) → click event → AttachThreadInput + BringWindowToTop + SetForegroundWindow
```

---

## MVP Recommendation

Prioritize (in order):

1. **Reliable balloon appearance** — Fix silent spawn failure. Sound fires first already; verify spawn succeeds with a basic existence check or fallback spawn retry.
2. **Unique generated tone** — Replace `SystemSounds.Asterisk` with `Console.Beep(freq, ms)` using frequency/duration from config (with defaults). Immediate perceived quality improvement.
3. **Click-to-focus that works** — Replace current `AllowSetForegroundWindow(-1)` pattern with `AttachThreadInput` + `BringWindowToTop` + `SetForegroundWindow`. This is the core differentiator.
4. **Config file** — JSON at `%USERPROFILE%\.claude\hooks\notify-waiting-config.json`. Four fields: `soundFrequency`, `soundDuration`, `message`, `timeoutMs`. All optional; all have baked-in defaults.

Defer:
- JSON Schema file for config validation — nice-to-have, not blocking user value; can ship in a follow-up.
- Fallback graceful-fail sound — already partially covered by "sound first" ordering; document the guarantee, no extra code needed.

---

## Config Schema Recommendation

Suggested fields for `notify-waiting-config.json`:

```json
{
  "$schema": "./notify-waiting-config.schema.json",
  "soundFrequency": 880,
  "soundDuration": 200,
  "message": "Waiting for your input...",
  "timeoutMs": 6000
}
```

| Field | Type | Default | Range / Notes |
|-------|------|---------|--------------|
| `soundFrequency` | integer | `880` | 37–32767 Hz. 880 Hz is A5 — audible but not fatiguing. 0 = silent. |
| `soundDuration` | integer | `200` | Milliseconds. 100–500 ms is typical. 0 = silent. |
| `message` | string | `"Waiting for your input..."` | Max 255 chars (balloon tip limit). |
| `timeoutMs` | integer | `6000` | Balloon display time in ms. Windows ignores this on 10/11 and uses accessibility settings, but the safety timer respects it. |

Design rule: If the config file is missing, malformed, or any field is absent, the baked-in default applies. The hook never crashes on config issues.

---

## Community Context

The `claude-notifications-go` project explicitly documents that Windows has no click-to-focus (they ship notification-only on Windows). This hook is the only Windows implementation that attempts click-to-focus — making it a genuine gap-filler in the ecosystem. Getting it working reliably is the primary competitive advantage of this project.

Sound-only hooks (like `cc-hooks` and `claude-code-audio-hooks`) are the most common pattern. Balloon-tip-plus-sound-plus-focus is the premium tier that no Windows implementation currently delivers reliably.

---

## Sources

- [NotifyIcon.ShowBalloonTip — Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/System.Windows.Forms.NotifyIcon.ShowBalloonTip?view=windowsdesktop-7.0) — HIGH confidence
- [SetForegroundWindow — Win32 API reference](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setforegroundwindow) — HIGH confidence
- [Console.Beep — .NET 9 reference](https://learn.microsoft.com/en-us/dotnet/api/system.console.beep?view=net-9.0) — HIGH confidence
- [claude-notifications-go — Windows: notifications only, no click-to-focus](https://github.com/777genius/claude-notifications-go) — MEDIUM confidence (GitHub README claim)
- [EnableBalloonTips registry key — Microsoft Q&A](https://learn.microsoft.com/en-us/answers/questions/2647986/enableballoontips-missing-from-registry) — MEDIUM confidence
- [AttachThreadInput + ForceForegroundWindow pattern](https://shlomio.wordpress.com/2012/09/04/solved-setforegroundwindow-win32-api-not-always-works/) — MEDIUM confidence (older post, API unchanged)
- [ChanMeng666/claude-code-audio-hooks — audio-only hook pattern](https://github.com/ChanMeng666/claude-code-audio-hooks) — MEDIUM confidence
- [PowerShell balloon notification patterns — Windows OS Hub](https://woshub.com/popup-notification-powershell/) — MEDIUM confidence
