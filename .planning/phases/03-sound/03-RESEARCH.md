# Phase 3: Sound - Research

**Researched:** 2026-03-04
**Domain:** PowerShell audio generation, Windows system sound API
**Confidence:** HIGH

## Summary

Phase 3 replaces the Windows system sound (Asterisk beep) with a generated tone that plays directly from within the balloon PowerShell script. The implementation uses `[Console]::Beep()`, a built-in .NET method available in PowerShell 5.1 (Windows 10/11 native), with no external dependencies. The tone frequency (Hz) and duration (ms) are already interpolated into the balloon template string from the config, requiring only a single one-liner addition to the script with silent error handling for edge cases (VMs, headless environments).

**Primary recommendation:** Add `try { [Console]::Beep($frequency, $duration) } catch {}` at the start of the balloon PowerShell script (after Assembly loads, before NotifyIcon creation), remove the separate `execFile` sound call from `notify-waiting.js` (lines 60-67).

## User Constraints (from CONTEXT.md)

### Locked Decisions
- Use `[Console]::Beep($frequency, $duration)` — simplest 1-line approach, no additional .NET assembly needed, PowerShell 5.1 built-in
- Known limitation: may be silent on some VMs (noted in STATE.md as acceptable for target environment — physical Windows 11 machine)
- Do NOT use WAV byte generation + SoundPlayer unless Console.Beep proves problematic (over-engineering for the current requirement)

### Tone Generation Location
- Tone plays inside the balloon PowerShell script (the `spawn` process), NOT via the separate `execFile` call
- The separate `execFile` block (lines 60-67 of notify-waiting.js) is removed entirely
- This satisfies the success criterion: "the separate execFile sound process is eliminated"

### Sound Timing
- Tone plays at the START of the balloon script, before the NotifyIcon is created and before `ShowBalloonTip` is called
- This preserves the "plays immediately on trigger" feel — user hears tone as the balloon is being set up, not after

### Default Tone Character
- Keep existing defaults: 880Hz, 220ms (already in DEFAULTS object in notify-waiting.js)
- These are already configurable via config file — no need to change defaults

### Error Handling
- Wrap tone call in try/catch — silent failure if `[Console]::Beep` throws (e.g., on VM or headless environment)
- Do not log tone failure to error log (it's non-critical — the balloon still appears)

### Claude's Discretion
- Exact placement in balloon script (before vs after Add-Type assembly loads — place after to keep startup order predictable)
- Whether to add a PowerShell comment explaining why Console.Beep is used over SoundPlayer

### Deferred Ideas (OUT OF SCOPE)
- WAV bytes + SoundPlayer for headphone/Bluetooth compatibility — if Console.Beep proves inadequate, this is the upgrade path (v2)
- Silent mode toggle (no sound, keep balloon) — CONF-05, already in v2 requirements backlog

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SND-01 | Hook plays a generated tone (not Windows Asterisk system sound) | Console.Beep is a .NET API that generates a tone at specified frequency; wraps Windows Beep function; eliminates dependency on SystemSounds.Asterisk. |
| SND-02 | Tone frequency and duration are configurable via config file | Variables `$frequency` and `$duration` are already interpolated into balloon script template (notify-waiting.js lines 101-102); passed from config with defaults (880Hz, 220ms) and numeric coercion (lines 53-54). |

## Standard Stack

### Core Technology
| Library/API | Version | Purpose | Why Standard |
|-------------|---------|---------|--------------|
| Console.Beep | .NET 2.0+ (built-in) | Generate configurable tone by frequency and duration | Part of System.Console namespace, available in PowerShell 5.1 natively (no assembly load needed), Windows-standard for console alerts |
| PowerShell | 5.1 (Windows 10/11 native) | Host the tone-generation call inside the balloon script | Already in use (Phase 1); executes the balloon script process |

### How It Works

**Console.Beep in PowerShell:**
```powershell
[Console]::Beep(frequency, duration)
```

- **Wraps:** The Windows `Beep()` function (Win32 API)
- **Parameters:**
  - `frequency`: Hz, range 37–32767 (but only ~190–8500 Hz is audible on standard hardware)
  - `duration`: milliseconds, must be > 0
- **Default behavior:** 800 Hz, 200 ms if called with no args
- **Return:** void (fire-and-forget)

**Platform dependency:**
- Windows only (uses Windows Beep Win32 call internally)
- Behavior on Windows 7+: Depends on default sound device (not legacy 8254 timer chip like pre-Win7)
- On Windows 11: Outputs to default audio device or fails silently if none is active

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Console.Beep | WAV file + SoundPlayer | Requires generating/storing WAV bytes or loading external file; adds complexity and assembly loading; better for specialized audio (Bluetooth, headphones); deferred to v2 if needed |
| Console.Beep | Add-Type Windows.Media.SoundPlayer | More complex PowerShell code; requires assembly load; same OS dependency; not worth the overhead for simple beep |
| Console.Beep | External exe (Beeper.exe) | Defeats purpose of eliminating separate process; more dependencies; harder to distribute |

## Architecture Patterns

### Recommended Integration

**Location in balloon script:**
```
1. Add-Type (System.Windows.Forms, System.Drawing, ClaudeWin32 P/Invoke)
2. [Variables interpolated from Node.js: $title, $message, $timeout, $frequency, $duration]
3. *** TONE GENERATION HERE ***
4. Helper functions (Get-ParentPid)
5. Process tree walk
6. NotifyIcon creation
7. Event handlers
8. ShowBalloonTip
9. Message loop
```

**Insertion point:** After line 102 (after `$duration = ...`), before line 104 (before `function Get-ParentPid`).

### Pattern: Try-Catch for Non-Critical Operations

**What:** Wrap the tone call in try-catch with an empty catch block — silent failure is correct here because:
- Tone is a UX enhancement, not critical to notification delivery
- If Console.Beep fails (VM, no audio device), the balloon still shows
- No need to log failure — it's not a bug, it's an environmental constraint

**When to use:** Non-critical operations that shouldn't block the main flow
**Example:**
```powershell
try {
    [Console]::Beep($frequency, $duration)
} catch {
    # Silent failure — tone is non-critical
}
```

**Why NOT to use here:** Logging tone failure
- State.md explicitly says: "Do not log tone failure to error log (it's non-critical — the balloon still appears)"
- Prevents log spam in VMs or environments where audio is disabled by design
- Aligns with existing pattern in notify-waiting.js (see lines 60-67: empty catch block for Asterisk.Play())

### Anti-Patterns to Avoid

- **Don't validate frequency/duration range in PowerShell:** Numbers are already coerced to valid ranges in Node.js (DEFAULTS values 880, 220); attempting validation in PowerShell adds unnecessary lines
- **Don't attempt WAV byte generation in PowerShell:** Defeats simplicity goal; belongs in Node.js layer if ever needed
- **Don't call Console.Beep outside try-catch at top level:** Unhandled exception would fail the entire balloon script; silent failure is the right behavior

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Generate audio tone | Custom WAV encoder, Wave file I/O, SoundPlayer wrapper | Console.Beep built-in | Avoids audio codec complexity, format version issues, driver compatibility; console audio is a solved problem in .NET |
| Validate tone parameters | Manual range checking (37–32767 Hz, duration > 0) | Console.Beep exception handling + DEFAULTS in Node.js | Validation belongs at config load time (Node.js); PowerShell receives pre-validated values |
| Frequency/duration string parsing in PowerShell | Regex or manual parsing | Numeric interpolation in template string + coercion in Node.js (lines 53–54) | Already done in Phase 2; PowerShell script receives integers, no parsing needed |

**Key insight:** The balloon script's job is to *use* config values, not to validate or parse them. All config processing happens in Node.js where it's testable and centralized. PowerShell is the execution layer, not the logic layer.

## Common Pitfalls

### Pitfall 1: Silent Failure Misunderstood as Bug

**What goes wrong:** Developer adds logging for tone failures, creating noise in error logs every time the hook runs on a VM.

**Why it happens:** Confusing "non-critical" with "should be logged" — the tendency to log everything for "debugging."

**How to avoid:** Remember: tone failure != notification failure. The balloon still appears. Logging non-failures pollutes diagnostics and confuses users. Only log real errors (spawn failure, process walk failure, focus failure).

**Warning signs:** Error log contains entries like `[timestamp] TONE_ERROR: Console.Beep failed on VM` repeated on every test. This is noise, not diagnostic value.

### Pitfall 2: Trying to Call Console.Beep Before Assembly Loads

**What goes wrong:** Placing `[Console]::Beep()` before `Add-Type -AssemblyName System.Windows.Forms` causes a PowerShell error or behavior change.

**Why it happens:** `[Console]` is a .NET type reference; PowerShell needs the .NET type system ready, which is usually fine, but keeping the order (assemblies first, then type usage) is defensive and clear.

**How to avoid:** Follow the established pattern: load all Add-Type statements first, set variables second, then use those types. This matches the existing balloon script structure.

**Warning signs:** PowerShell error in stderr: "Cannot find type [Console]" or similar type resolution failures.

### Pitfall 3: Frequency/Duration Out of Audible Range

**What goes wrong:** Config file specifies frequency 50 Hz (inaudible) or 15000 Hz (ultrasonic), user thinks tone is broken.

**Why it happens:** Console.Beep accepts 37–32767 Hz but only ~190–8500 Hz is audible on most hardware.

**How to avoid:** Document in config template that practical range is 200–2000 Hz for best results. Defaults (880 Hz) are well within human hearing range.

**Warning signs:** User reports "tone doesn't play" but balloon works; check config frequency value.

### Pitfall 4: Assuming Tone Is Synchronous (It Is)

**What goes wrong:** Code assumes tone finishes before balloon appears; actually they may overlap in timing.

**Why it happens:** Misunderstanding Console.Beep blocking behavior — it blocks until the tone finishes.

**How to avoid:** Rely on the blocking behavior — it's a feature. Tone plays, *then* balloon setup continues. No race condition.

**Warning signs:** None, actually — this is correct behavior. Just document that the tone plays before the balloon appears.

## Code Examples

Verified patterns from official sources and existing codebase:

### Console.Beep Syntax in PowerShell
```powershell
# Source: https://learn.microsoft.com/en-us/dotnet/api/system.console.beep
# Plays a beep at 880 Hz for 220 milliseconds
[Console]::Beep(880, 220)

# With variables (interpolated from config)
[Console]::Beep($frequency, $duration)
```

### Silent Failure Pattern for Non-Critical Operations
```powershell
# Source: notify-waiting.js existing pattern (lines 60-67, 192-197)
try {
    [Console]::Beep($frequency, $duration)
} catch {
    # Silent failure — tone is non-critical enhancement
    # Balloon still appears even if tone fails
}
```

### Integration into Balloon Script
```powershell
# From notify-waiting.js template (lines 84-174)
# Placeholder insertion: after line 102, before line 104

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class ClaudeWin32 {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool AllowSetForegroundWindow(int dwProcessId);
}
"@

# Variables interpolated from config
$title     = '${config.balloon.title.replace(/'/g, "''")}'
$message   = '${config.balloon.message.replace(/'/g, "''")}'
$timeout   = ${config.balloon.timeout}
$frequency = ${config.sound.frequency}
$duration  = ${config.sound.duration}

# *** TONE GENERATION (NEW) ***
try {
    [Console]::Beep($frequency, $duration)
} catch {
    # Silent failure if audio device unavailable (e.g., VM, headless)
}

# ... rest of script continues
```

### Node.js: Removing execFile Sound Call
```javascript
// REMOVE: Lines 59-67 from notify-waiting.js
// OLD CODE (DELETE THIS):
// try {
//   execFile('powershell.exe', [
//     '-WindowStyle', 'Hidden',
//     '-NonInteractive',
//     '-Command',
//     '[System.Media.SystemSounds]::Asterisk.Play()'
//   ], { windowsHide: true });
// } catch (_) {}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| SystemSounds.Asterisk.Play() | Console.Beep($freq, $dur) | Phase 3 (now) | Unique, configurable tone replaces generic system beep; single process (balloon) instead of two (execFile + balloon) |
| Separate execFile process for sound | Tone generation inside balloon script | Phase 3 (now) | Simpler process model, no race condition, eliminates separate process lifecycle |
| Hardcoded 800 Hz default | Config-driven 880 Hz (or user-configured) | Phase 2 → Phase 3 | User can customize tone identity; values already available in script |
| No audio feedback customization | Frequency + duration configurable via JSON | Phase 2 → Phase 3 | Users can tune tone to preference or accessibility needs |

**Deprecated/outdated:**
- SystemSounds.Asterisk: Generic Windows sound; doesn't meet "unique tone" requirement. Replaced by Console.Beep with custom frequency/duration.
- execFile for sound: Separate process with no real advantage over in-script generation. Removed in Phase 3.

## Open Questions

1. **Should a PowerShell comment explain why Console.Beep over SoundPlayer?**
   - What we know: CONTEXT.md lists this as "Claude's Discretion"
   - What's unclear: Whether verbose code comments help future maintenance
   - Recommendation: Add a brief comment (1 line) explaining: "# Generate tone via Console.Beep — simplest .NET method, no assembly load needed" for future developers curious about the design choice

2. **What if frequency/duration are non-numeric in config?**
   - What we know: Node.js coerces with `Number()` and falls back to DEFAULTS (lines 53–54)
   - What's unclear: Edge case if coercion produces NaN
   - Recommendation: No change needed — `Number("abc")` returns NaN, which triggers the `|| DEFAULTS` fallback; PowerShell receives valid integers; Console.Beep throws (caught silently) if bad values somehow arrive

3. **Should we test tone output on actual hardware?**
   - What we know: CONTEXT.md says "acceptable for target environment — physical Windows 11 machine"
   - What's unclear: Whether phase verification includes manual sound listening test
   - Recommendation: Phase 3 verification plan should include: start hook, verify balloon appears, verify distinct tone plays (not system Asterisk), verify tone changes when config is edited

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | No automated tests detected in project structure |
| Config file | None — see Wave 0 |
| Quick run command | Manual: trigger Claude in terminal, listen for tone, check config override |
| Full suite command | N/A — project is a hook with no automated test suite |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Validation Method | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SND-01 | Hook plays generated tone (not system sound) | Manual/integration | Trigger hook, listen for audible beep distinct from Windows Asterisk | N/A — manual verification |
| SND-02 | Config frequency/duration change affects tone | Manual/integration | Edit config.json (frequency: 440, duration: 500), trigger hook, verify tone pitch/length change | N/A — manual verification |

### Sampling Rate
- **Per task commit:** Manual verification of tone output (quick test: does it beep?)
- **Per phase completion:** Verify config override works (edit config, hook should produce different tone)
- **Phase gate:** Manual listening test passes before `/gsd:verify-work`

### Wave 0 Gaps
- No automated test framework in place (project is a simple hook, not a complex application)
- Verification is integration-level: trigger hook + listen + verify config affects tone
- No mock Console.Beep needed; PowerShell tests are environment-specific (require Windows 11, audio device)

*(No gaps in implementation support — project structure is minimal; no test infrastructure needed for a hook that's primarily UI/audio)*

## Sources

### Primary (HIGH confidence)
- [Console.Beep Method (.NET API)](https://learn.microsoft.com/en-us/dotnet/api/system.console.beep?view=net-10.0) - Verified frequency range (37–32767 Hz), duration parameter, Windows platform dependency, Beep function wrapping, default values (800 Hz, 200 ms)
- [PowerShell Console.Beep usage](https://devblogs.microsoft.com/scripting/powertip-use-powershell-to-send-beep-to-console/) - Syntax `[console]::beep(frequency, duration)`, audible range verification
- notify-waiting.js (existing codebase) - DEFAULTS object (880 Hz, 220 ms), config interpolation (lines 101–102), numeric coercion (lines 53–54), try-catch pattern (lines 60–67, 192–197)
- 03-CONTEXT.md - Locked decisions on Console.Beep, error handling, timing, defaults

### Secondary (MEDIUM confidence)
- PowerShell error handling best practices (try-catch patterns) - Verified via multiple sources that empty catch blocks are acceptable for non-critical operations when silent failure is correct behavior

### Tertiary (references, no validation needed)
- Windows 11 audio device behavior (theoretical) — documented in MS Learn; not independently verified for this specific environment

## Metadata

**Confidence breakdown:**
- Standard stack: **HIGH** - Console.Beep is documented .NET API, PowerShell 5.1 built-in, Windows 10/11 native, no version/availability risk
- Architecture: **HIGH** - Integration pattern is straightforward (one-liner insertion, remove four lines from Node.js); no new patterns needed; matches existing code style
- Pitfalls: **HIGH** - VM/audio silencing is documented in official sources and acknowledged in CONTEXT.md; common patterns (try-catch, silent failure) are verified against PowerShell best practices

**Research date:** 2026-03-04
**Valid until:** 2026-04-04 (30 days — Console.Beep is stable API, unlikely to change)
