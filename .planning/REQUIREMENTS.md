# Requirements: claude-notify-hook

**Defined:** 2026-03-04
**Core Value:** Click the notification and land in the right terminal window, every single time.

## v1 Requirements

### Reliability

- [x] **RELY-01**: Notification appears on every Claude Code trigger (no silent failures)
- [x] **RELY-02**: Spawn failure is logged to a file so the user can diagnose issues
- [x] **RELY-03**: Balloon shows reliably — 100ms stabilization delay after NotifyIcon.Visible = true before ShowBalloonTip

### Focus

- [ ] **FOCUS-01**: Clicking the balloon focuses the correct Windows Terminal (wt.exe) window
- [ ] **FOCUS-02**: Focus works even when Windows Terminal has been minimized (SW_RESTORE + SetForegroundWindow)

### Sound

- [x] **SND-01**: Hook plays a generated tone (not Windows Asterisk system sound)
- [x] **SND-02**: Tone frequency and duration are configurable via config file

### Config

- [ ] **CONF-01**: User can configure sound frequency, sound duration, balloon message text, and timeout via a JSON file
- [ ] **CONF-02**: Hook works out of the box with no config file (all fields have baked-in defaults)
- [ ] **CONF-03**: Config file lives next to the hook at `%USERPROFILE%\.claude\hooks\notify-waiting-config.json`

## v2 Requirements

### Multi-terminal support

- **TERM-01**: Works with VS Code integrated terminal
- **TERM-02**: Works with ConEmu / cmder

### Advanced config

- **CONF-04**: Support multiple sound profiles (configurable per project or hook type)
- **CONF-05**: Silent mode toggle (disable sound but keep balloon)

## Out of Scope

| Feature | Reason |
|---------|--------|
| macOS / Linux support | Windows-only by design — PowerShell + WinForms |
| Push notifications (phone, email) | Local desktop notification only |
| Toast notifications (UWP/WinRT) | WinForms NotifyIcon is sufficient, no UWP dependency |
| Window positioning / multi-monitor | Focus only, not placement |
| Focus Assist / Do Not Disturb bypass | OS policy — hooking into notification settings is out of scope |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| RELY-01 | Phase 1 | Complete |
| RELY-02 | Phase 1 | Complete |
| RELY-03 | Phase 1 | Complete |
| CONF-01 | Phase 2 | Pending |
| CONF-02 | Phase 2 | Pending |
| CONF-03 | Phase 2 | Pending |
| SND-01 | Phase 3 | Complete |
| SND-02 | Phase 3 | Complete |
| FOCUS-01 | Phase 4 | Pending |
| FOCUS-02 | Phase 4 | Pending |

**Coverage:**
- v1 requirements: 10 total
- Mapped to phases: 10
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-04*
*Last updated: 2026-03-04 after initial definition*
