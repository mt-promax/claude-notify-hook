# Roadmap: claude-notify-hook

## Overview

Four phases transform a partially-working Claude Code hook into a reliable, configurable notification tool. Phase 1 surfaces errors so every subsequent fix is debuggable. Phase 2 wires a config file so all values flow through named variables before tone and focus code touches them. Phase 3 replaces the Windows system sound with a generated tone. Phase 4 fixes click-to-focus using the Win32 AttachThreadInput pattern. Each phase ships independently testable value.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Reliability** - Spawn failures surface to an error log; balloon shows on every trigger (completed 2026-03-04)
- [x] **Phase 2: Config** - JSON config file wired end-to-end with baked-in defaults (completed 2026-03-04)
- [ ] **Phase 3: Sound** - Generated tone replaces Windows Asterisk system sound
- [ ] **Phase 4: Focus** - Clicking the balloon reliably focuses Windows Terminal

## Phase Details

### Phase 1: Reliability
**Goal**: Every trigger produces a visible notification or a diagnosable error — no more silent failures
**Depends on**: Nothing (first phase)
**Requirements**: RELY-01, RELY-02, RELY-03
**Success Criteria** (what must be TRUE):
  1. Triggering the hook while the PowerShell spawn is broken produces a log file at `%TEMP%\claude-notify-error.log` with a readable error message
  2. The balloon appears on every normal trigger — the 100ms stabilization delay prevents silent suppression
  3. When the balloon appears, a `BalloonTipShown` confirmation is written to the log confirming it displayed
**Plans**: 1 plan

Plans:
- [ ] 01-01-PLAN.md — Replace silent try/catch with spawn error capture + add balloon stabilization delay and BalloonTipShown handler

### Phase 2: Config
**Goal**: Users can customize sound, message, and timeout via a JSON file; hook works with no config file present
**Depends on**: Phase 1
**Requirements**: CONF-01, CONF-02, CONF-03
**Success Criteria** (what must be TRUE):
  1. User can create `%USERPROFILE%\.claude\hooks\notify-waiting-config.json` and the hook reads it on next trigger
  2. Deleting the config file (or leaving it absent) does not break the hook — defaults produce a working notification
  3. Editing `frequency`, `duration`, `message`, and `timeout` fields in the config file changes observable hook behavior on next trigger
**Plans**: TBD

### Phase 3: Sound
**Goal**: The hook plays a unique generated tone that conditions users to recognize "Claude is waiting"
**Depends on**: Phase 2
**Requirements**: SND-01, SND-02
**Success Criteria** (what must be TRUE):
  1. The hook no longer produces the Windows Asterisk system-sound beep — the tone is audibly distinct
  2. Changing `frequency` and `duration` in the config file changes the pitch and length of the tone on next trigger
  3. The separate `execFile` sound process is eliminated — tone plays from within the balloon script
**Plans**: TBD

### Phase 4: Focus
**Goal**: Clicking the balloon brings the correct Windows Terminal window to the foreground every time
**Depends on**: Phase 3
**Requirements**: FOCUS-01, FOCUS-02
**Success Criteria** (what must be TRUE):
  1. Clicking the balloon when Windows Terminal is behind other windows brings it to the foreground
  2. Clicking the balloon when Windows Terminal is minimized restores and focuses it
  3. No manual alt-tab or window hunting is required after clicking the notification
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Reliability | 1/1 | Complete   | 2026-03-04 |
| 2. Config | 1/1 | Complete   | 2026-03-04 |
| 3. Sound | 0/1 | Planned | - |
| 4. Focus | 0/TBD | Not started | - |
