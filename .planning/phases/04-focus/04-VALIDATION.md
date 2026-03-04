---
phase: 4
slug: focus
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-04
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Manual only — focus is user-driven UI interaction (clicking a toast notification) |
| **Config file** | none |
| **Quick run command** | `node hooks/notify-waiting.js` (trigger hook, observe focus behavior) |
| **Full suite command** | Manual test steps in Per-Task Verification Map |
| **Estimated runtime** | ~2 minutes manual |

---

## Sampling Rate

- **After every task commit:** Trigger `node hooks/notify-waiting.js` and verify balloon appears (smoke check)
- **After every plan wave:** Full manual focus test — click toast, verify WT focuses
- **Before `/gsd:verify-work`:** Full suite must pass (FOCUS-01 + FOCUS-02)
- **Max feedback latency:** Manual — 2 minutes

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 4-01-01 | 01 | 1 | FOCUS-01, FOCUS-02 | manual | `node hooks/notify-waiting.js` then click toast | ✅ | ⬜ pending |
| 4-01-02 | 01 | 1 | FOCUS-01, FOCUS-02 | manual | checkpoint human-verify | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. No new test files needed — all validation is manual UI interaction.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Click toast focuses WT from behind | FOCUS-01 | Requires physical mouse click on toast notification | 1. Open a covering window (e.g. Notepad). 2. `node hooks/notify-waiting.js`. 3. Click toast. 4. Verify WT comes to foreground. |
| Click toast restores minimized WT | FOCUS-02 | Requires minimizing terminal and clicking notification | 1. Minimize Windows Terminal. 2. `node hooks/notify-waiting.js`. 3. Click toast. 4. Verify WT restores and gains focus. |
| Focus works when WT is non-elevated | FOCUS-01 | Cross-integrity-level scenario requires manual setup | 1. Run WT as normal user. 2. Run hook. 3. Click toast. 4. Focus should work via AttachThreadInput. |
| Focus falls back gracefully when elevated | FOCUS-01 | Requires running WT as admin | 1. Run WT as Administrator. 2. Run hook (non-elevated). 3. Click toast. 4. Focus should work via SendInput fallback, or degrade silently. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: checkpoint covers all manual verifications
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
