---
phase: 3
slug: sound
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-04
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Manual integration testing (no automated test suite — hook project) |
| **Config file** | none — manual execution |
| **Quick run command** | Trigger hook in terminal, listen for distinct tone |
| **Full suite command** | Trigger hook + edit config (frequency/duration) + re-trigger to verify override |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `Trigger hook in terminal, listen for distinct tone`
- **After every plan wave:** Run `Trigger hook + edit config (frequency/duration) + re-trigger to verify override`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 3-01-01 | 01 | 1 | SND-01 | manual | Trigger hook → hear distinct tone (not Windows Asterisk beep) | N/A — manual | ⬜ pending |
| 3-01-02 | 01 | 1 | SND-01 | manual | Verify execFile block removed from notify-waiting.js (code review) | N/A — code review | ⬜ pending |
| 3-01-03 | 01 | 1 | SND-02 | manual | Edit config.json (frequency: 440, duration: 500) → trigger hook → verify pitch/length changed | N/A — manual | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing infrastructure covers all phase requirements.*

No automated test framework is applicable — this project is a Windows hook with audio output that requires a physical audio device and manual listening verification. No stubs or fixtures needed.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Hook plays generated tone (not Windows Asterisk) | SND-01 | Audio output requires human listening; no programmatic way to distinguish beep timbre automatically | 1. Run `node notify-waiting.js` to trigger hook; 2. Listen for tone — should be a pure beep, not the "ding" Windows Asterisk sound |
| Config frequency/duration changes affect tone | SND-02 | Tone pitch/duration changes require human perception to verify | 1. Edit config.json: `"sound": {"frequency": 440, "duration": 500}`; 2. Trigger hook; 3. Verify tone is lower-pitched and longer than default (880 Hz, 220 ms) |
| execFile sound process eliminated | SND-01 | Code removal, not behavior | Review notify-waiting.js — lines 59–67 (execFile block for SystemSounds.Asterisk) should not exist |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
