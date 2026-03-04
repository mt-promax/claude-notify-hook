---
phase: 1
slug: reliability
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-04
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Manual + file inspection (no test framework — Node.js hook, PowerShell script) |
| **Config file** | none |
| **Quick run command** | `node hooks/notify-waiting.js` (manual trigger) |
| **Full suite command** | See Manual-Only Verifications below |
| **Estimated runtime** | ~5 seconds per manual test |

---

## Sampling Rate

- **After every task commit:** Inspect the modified file for correctness
- **After every plan wave:** Run full manual verification sequence
- **Before `/gsd:verify-work`:** All manual verifications must pass
- **Max feedback latency:** ~10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 1-01-01 | 01 | 1 | RELY-02 | manual | inspect notify-waiting.js for ps.on('error') handler | ✅ | ⬜ pending |
| 1-01-02 | 01 | 1 | RELY-03 | manual | check 100ms delay + BalloonTipShown event in PS script | ✅ | ⬜ pending |
| 1-01-03 | 01 | 1 | RELY-01 | manual | trigger hook, verify log file at %TEMP%\claude-notify-error.log | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements — modifications are to existing files only (notify-waiting.js). No new test framework or stubs needed.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Spawn error captured to log | RELY-02 | Requires breaking PowerShell spawn (invalid path test) | Temporarily set script path to invalid value, trigger hook, check %TEMP%\claude-notify-error.log exists with readable error |
| Balloon appears reliably | RELY-03 | Visual confirmation required | Trigger hook 3x in rapid succession, balloon should appear every time |
| BalloonTipShown written to log | RELY-03 | Requires running hook end-to-end | Trigger hook normally, check log for BalloonTipShown confirmation line |
| No silent failures | RELY-01 | Requires simulating each failure mode | Break each component in turn, verify log entry appears every time |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
