---
phase: 02
slug: config
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-04
---

# Phase 02 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Manual trigger + file inspection |
| **Config file** | `%USERPROFILE%\.claude\hooks\notify-waiting-config.json` (user-created for testing) |
| **Quick run command** | `node hooks/notify-waiting.js` |
| **Full suite command** | Manual: (1) no config, (2) partial config, (3) malformed JSON, (4) valid config with custom values |
| **Estimated runtime** | ~2 minutes (manual) |

---

## Sampling Rate

- **After every task commit:** Trigger hook with no config present, verify default message appears. Then create config with custom message, trigger again, verify custom message appears.
- **After every plan wave:** Test three scenarios: (1) no config file, (2) partial config (only `sound.frequency` specified), (3) malformed JSON (missing closing brace). All three must result in a working notification with appropriate fallback behavior.
- **Before `/gsd:verify-work`:** Full manual battery must pass
- **Max feedback latency:** ~2 minutes

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 1 | CONF-01, CONF-02 | Manual | `node hooks/notify-waiting.js` (no config) | ✅ existing | ⬜ pending |
| 02-01-02 | 01 | 1 | CONF-01, CONF-03 | Manual | Create config, `node hooks/notify-waiting.js` | ✅ user-created | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing infrastructure covers all phase requirements — no new test files or framework installation needed. Phase 2 only modifies `hooks/notify-waiting.js`.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Hook reads custom `message` from config | CONF-01 | Balloon display is visual | Create config with `{"balloon":{"message":"test-msg"}}`, trigger hook, observe balloon shows "test-msg" |
| Hook works with no config file | CONF-02 | Requires file system state | Delete/absent config, trigger hook, verify default balloon appears |
| Config at `%USERPROFILE%\.claude\hooks\notify-waiting-config.json` | CONF-03 | Path verification is env-dependent | Create config at that exact path, trigger hook, verify values apply |
| Malformed JSON falls back to defaults | CONF-02 | Requires invalid file state | Write `{bad json` to config, trigger hook, verify default balloon still appears |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
