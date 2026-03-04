# Phase 2: Config - Research

**Researched:** 2026-03-04
**Domain:** Configuration file loading, JSON parsing, PowerShell variable interpolation, Node.js file I/O with defaults
**Confidence:** HIGH (all mechanisms documented in Node.js and PowerShell official sources)

## Summary

Phase 2 wires a user-editable JSON configuration file end-to-end, with sensible baked-in defaults so the hook works immediately out-of-the-box. The phase externalizes four hardcoded values from Phase 1 (sound frequency, sound duration, balloon message, balloon timeout) into a config file at `%USERPROFILE%\.claude\hooks\notify-waiting-config.json`, while preserving backward compatibility — if the config file is missing, deleted, or malformed, the hook continues working with defaults.

The implementation is straightforward: read JSON in Node.js at startup with try/catch fallback to defaults, interpolate config values as literals into the PowerShell script string before base64 encoding, and pass them to the balloon process. No external dependencies. All parsing is native (`JSON.parse`, PowerShell object syntax). The hard part is NOT the config mechanism — it's ensuring that Phase 3 (tone generation) and Phase 4 (focus fix) can access their own config values through the same pipeline. Phase 2 establishes that pattern.

**Primary recommendation:** Implement in this order: (1) Define config schema and defaults in Node.js, (2) add JSON read function with try/catch + `Object.assign` shallow merge, (3) interpolate config values into PowerShell string, (4) verify all four values flow through correctly on a test run, (5) test missing/malformed/partial config files to confirm defaults work.

---

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CONF-01 | User can configure sound frequency, sound duration, balloon message text, and timeout via a JSON file | Requires JSON file at `%USERPROFILE%\.claude\hooks\notify-waiting-config.json`, readable by `fs.readFileSync`, with fields `sound.frequency`, `sound.duration`, `balloon.message`, `balloon.timeout` |
| CONF-02 | Hook works out of the box with no config file (all fields have baked-in defaults) | Requires `JSON.parse` wrapped in try/catch, shallow merge with `DEFAULTS` object, fallback on any error (file not found, malformed JSON, permission denied) |
| CONF-03 | Config file lives next to the hook at `%USERPROFILE%\.claude\hooks\notify-waiting-config.json` | Requires config path constructed from `process.env.USERPROFILE` + `.claude\hooks\notify-waiting-config.json` |

---

## Standard Stack

### Runtime — No Changes

| Component | Technology | Version | Purpose |
|-----------|-----------|---------|---------|
| Hook script | Node.js | Bundled with Claude Code | `fs.readFileSync`, `JSON.parse`, string interpolation into base64 |
| Balloon process | PowerShell | 5.1 (Windows built-in) | `-EncodedCommand` receives interpolated config values as literals |
| Config file | JSON | 1.0 standard | `%USERPROFILE%\.claude\hooks\notify-waiting-config.json` |

### New APIs (Phase 2 Only)

| API | Scope | Module | Purpose | Phase |
|-----|-------|--------|---------|-------|
| `fs.readFileSync(path, encoding)` | Node.js | fs | Synchronous config file read | 2 |
| `JSON.parse(text)` | Node.js | Built-in | Parse JSON config; wrapped in try/catch to handle malformed input | 2 |
| `Object.assign(target, source)` | Node.js | Built-in | Shallow merge user config with DEFAULTS (override only provided keys) | 2 |

### Config Values (Hardcoded in Phase 1, Externalized in Phase 2)

| Value | Current (Phase 1) | Phase 2 Config Key | Type | Default |
|-------|-------------------|-----------------|------|---------|
| Tone frequency | Unused (SystemSounds.Asterisk) | `sound.frequency` | Integer (Hz) | 880 |
| Tone duration | Unused (SystemSounds.Asterisk) | `sound.duration` | Integer (ms) | 220 |
| Balloon title | "Claude Code" | `balloon.title` | String | "Claude Code" |
| Balloon message | "Waiting for your input..." | `balloon.message` | String | "Waiting for your input..." |
| Balloon timeout | 6000 ms | `balloon.timeout` | Integer (ms) | 6000 |

**Schema notes:**
- All keys optional; missing keys inherit from DEFAULTS
- Extra keys ignored (forward-compatible)
- Malformed JSON triggers fallback to DEFAULTS
- No validation of numeric ranges (PowerShell will reject invalid frequency/timeout naturally)

---

## Architecture Patterns

### Recommended Project Structure

```
hooks/
├── notify-waiting.js          # Phase 1 + 2: spawn, config read, interpolate
└── (no separate config-loader module — logic stays in notify-waiting.js for simplicity)

%USERPROFILE%\.claude\hooks/
├── notify-waiting.js          # distributed here via install
└── notify-waiting-config.json # created by user (optional)
```

### Pattern 1: Config Load with Fallback to Defaults (Node.js)

**What:** Read JSON file synchronously at startup. If file is missing, malformed, or unreadable, return hardcoded defaults. Never throw — always have a working config object by the end.

**When:** Always — every hook project should follow this pattern.

**Example:**

```javascript
// Source: https://nodejs.org/api/fs.html#fs_fs_readfilesync_path_options (Node.js fs docs)
// and https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/parse

const path = require('path');
const fs = require('fs');

// Step 1: Define canonical defaults
const DEFAULTS = {
  sound: {
    frequency: 880,
    duration: 220
  },
  balloon: {
    title: 'Claude Code',
    message: 'Waiting for your input...',
    timeout: 6000
  }
};

// Step 2: Define config file location (next to hook)
const CONFIG_PATH = path.join(
  process.env.USERPROFILE || process.env.HOME,
  '.claude', 'hooks', 'notify-waiting-config.json'
);

// Step 3: Load with graceful fallback
function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    const user = JSON.parse(raw);

    // Shallow merge: user config overlays DEFAULTS
    // If user config is missing sound.frequency, DEFAULTS.sound.frequency is used
    return {
      sound: {
        ...DEFAULTS.sound,
        ...(user.sound || {})
      },
      balloon: {
        ...DEFAULTS.balloon,
        ...(user.balloon || {})
      }
    };
  } catch (_) {
    // Any error: file not found, malformed JSON, permission denied → use DEFAULTS
    return DEFAULTS;
  }
}

const config = loadConfig();
```

**Why this works:**
- `fs.readFileSync` throws for missing file → caught, defaults used
- `JSON.parse` throws for malformed JSON → caught, defaults used
- Missing `.sound` key in user config → `...DEFAULTS.sound` fills in missing fields
- Malformed numeric values (e.g., `"frequency": "not-a-number"`) → PowerShell rejects them later (not this phase's problem)

**Confidence: HIGH** — Standard Node.js pattern from official docs. Object spread syntax is ES6 stable.

---

### Pattern 2: Embed Config into PowerShell Script String (Node.js)

**What:** After loading config, interpolate values directly into the PowerShell heredoc string as literal values before base64 encoding. This avoids any JSON parsing inside PowerShell.

**When:** Always required to pass values from Node.js to PowerShell detached process.

**Example:**

```javascript
// Source: Node.js string interpolation + base64 encoding (https://nodejs.org/api/buffer.html#buffer_class_buffer)

const config = loadConfig();

// Build PowerShell script with config values interpolated
const balloon = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# ... (Win32 type definitions and helper functions — unchanged from Phase 1) ...

# PHASE 2: Use config values passed from Node.js
$frequency = ${config.sound.frequency}
$duration  = ${config.sound.duration}
$title     = '${config.balloon.title}'
$message   = '${config.balloon.message}'
$timeout   = ${config.balloon.timeout}

# ... (rest of balloon script uses \$frequency, \$duration, \$title, \$message, \$timeout) ...

# At ShowBalloonTip call:
$n.ShowBalloonTip(\$timeout, \$title, \$message, [System.Windows.Forms.ToolTipIcon]::Info)
`;

// Encode to base64
const encoded = Buffer.from(balloon, 'utf16le').toString('base64');
```

**Why this works:**
- Values are embedded as literals in the script string (e.g., `${config.sound.frequency}` becomes `880` in the string)
- PowerShell receives a complete, valid script with no variables to resolve
- If user config is missing, defaults are interpolated instead
- No JSON parsing needed in PowerShell — simpler, faster

**Confidence: HIGH** — Standard template pattern. Buffer and base64 encoding are Node.js built-in.

---

### Pattern 3: Validate Config at Hook Startup (Defensive)

**What:** After loading config, optionally validate numeric ranges or string lengths. If values are clearly invalid, log them to the error log and use defaults instead.

**When:** Nice-to-have for robustness; not required for CONF-01/02/03 but improves user experience.

**Example:**

```javascript
// Validation helper (optional)
function validateConfig(config) {
  const errors = [];

  // Check numeric ranges
  if (config.sound.frequency < 37 || config.sound.frequency > 32767) {
    errors.push(`sound.frequency ${config.sound.frequency} out of range [37, 32767]`);
  }
  if (config.sound.duration < 10 || config.sound.duration > 60000) {
    errors.push(`sound.duration ${config.sound.duration} out of range [10, 60000]`);
  }
  if (config.balloon.timeout < 1000 || config.balloon.timeout > 30000) {
    errors.push(`balloon.timeout ${config.balloon.timeout} out of range [1000, 30000]`);
  }

  // Log errors if any
  if (errors.length > 0) {
    try {
      const fs = require('fs');
      const logPath = path.join(process.env.TEMP || process.env.USERPROFILE, 'claude-notify-error.log');
      const ts = new Date().toISOString();
      fs.appendFileSync(logPath, `[${ts}] CONFIG_VALIDATION: ${errors.join('; ')}\n`);
    } catch (_) {}

    // Return defaults instead of invalid config
    return DEFAULTS;
  }

  return config;
}

const config = validateConfig(loadConfig());
```

**Confidence: MEDIUM** — Validation logic is straightforward, but numeric ranges are approximate (based on Phase 3 research on Console.Beep and user expectations for timeouts).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Config file location | Custom registry lookup or environment variable | `path.join(process.env.USERPROFILE, '.claude', 'hooks')` | Predictable, version-controllable, matches hook installation location |
| JSON parsing | Custom string splitting on `:` or `,` | `JSON.parse()` | Handles nesting, escaping, whitespace correctly; no regexes needed |
| Config override logic | Loop through user keys manually, check existence | `Object.assign(DEFAULTS, user)` or spread syntax | Concise, well-tested, handles missing keys automatically |
| Error handling | Let errors propagate, break the hook | Wrap `fs.readFileSync` + `JSON.parse` in try/catch, always return DEFAULTS | Ensures hook never fails due to config issues |
| PowerShell interpolation | Store config values in a separate file, read in PowerShell | Interpolate into script string in Node.js | Avoids file I/O from detached PowerShell process; config is immutable once the script starts |

**Key insight:** Config files are a convenience feature, not a mission-critical component. If anything goes wrong with the config, the hook should silently fall back to defaults and keep working. This is the "principle of minimal failure" for user-facing tools.

---

## Common Pitfalls

### Pitfall 1: Throwing on Config Parse Error

**What goes wrong:** `const config = JSON.parse(raw);` is not wrapped in try/catch. If the user's config is malformed JSON, the exception propagates and the hook exits with non-zero code.

**Why it happens:** Developer assumes the config file is either valid or absent. But users may create a partial config, introduce syntax errors when editing, or accidentally save a file with BOM (Byte Order Mark) that breaks parsing.

**Consequences:** Hook appears broken. User sees no balloon. No diagnostic trail (or only a confusing JSON.SyntaxError in stderr).

**How to avoid:** ALWAYS wrap `JSON.parse` in try/catch. On any error (file not found, malformed JSON, permission denied), use DEFAULTS instead. The hook must be resilient to user edits.

**Warning signs:** Hook works when no config file exists, fails when config is present; works on machine A but not B (different file encodings or JSON libraries).

**This phase addresses it:** Pattern 1 wraps both `readFileSync` and `JSON.parse` in a single try/catch with DEFAULTS fallback.

---

### Pitfall 2: Overwriting All Defaults with User Config

**What goes wrong:** Using `config = JSON.parse(raw)` directly without merging with DEFAULTS. If the user's config is missing a key, that key is undefined in the interpolated script.

**Why it happens:** Developer assumes the user config is complete. But good UX means users should only need to specify the keys they care about — other keys inherit defaults.

**Example:**
```javascript
// BAD:
const config = JSON.parse(raw);
// If raw = { "sound": { "frequency": 440 } }, then config.sound.duration is undefined

// GOOD:
const config = {
  sound: { ...DEFAULTS.sound, ...(JSON.parse(raw).sound || {}) },
  balloon: { ...DEFAULTS.balloon, ...(JSON.parse(raw).balloon || {}) }
};
// config.sound.frequency = 440 (from user), config.sound.duration = 220 (from DEFAULTS)
```

**Consequences:** PowerShell script receives undefined or null values. Interpolation produces invalid PowerShell syntax or runtime errors.

**How to avoid:** Use shallow merge pattern (Object.assign or spread syntax). Merge at the nested level, not the top level. Allow partial user configs.

**Warning signs:** Config works if all keys are present; breaks if user omits any key; behavior changes inconsistently across machines.

**This phase addresses it:** Pattern 1 uses nested spread syntax to overlay user config on DEFAULTS at the `sound` and `balloon` levels.

---

### Pitfall 3: File Encoding Mismatch (BOM, UTF-16)

**What goes wrong:** User creates config file in Notepad (which defaults to UTF-16 or UTF-8 with BOM on Windows), `fs.readFileSync(path, 'utf8')` includes the BOM bytes, `JSON.parse` rejects it as invalid JSON.

**Why it happens:** Windows text editors often add a BOM (Byte Order Mark) to UTF-8 files. Node.js `utf8` decoder does not strip it; `JSON.parse` sees the BOM and fails.

**Consequences:** Config file appears correct but is rejected as malformed. User sees no diagnostic message (just silent fallback to defaults, which may confuse them if they intentionally configured something).

**How to avoid:** Either: (a) Use `utf8-bom` (npm package) decoder, or (b) manually strip BOM in JavaScript: `raw.replace(/^\uFEFF/, '')` before parsing, or (c) document that users must save config as "UTF-8 without BOM" in their editor.

**For this phase:** Option (c) is simplest — document in README. Option (b) is zero-dependency. Option (a) requires a package (unwanted for this project).

**Recommended:** Add one line after `readFileSync`:
```javascript
raw = raw.replace(/^\uFEFF/, ''); // Strip UTF-8 BOM if present
const user = JSON.parse(raw);
```

**Confidence: MEDIUM** — BOM issues are common in Windows tools; the fix is trivial; mitigation is a one-liner.

---

### Pitfall 4: Config Path Not Expandable on All Windows Versions

**What goes wrong:** Using hardcoded path like `C:\Users\...` instead of environment variables. If the username changes or Windows is installed in a non-standard location, the path breaks.

**Why it happens:** Developer assumes user home directory is always `C:\Users\<username>`, which is the default. But enterprise setups, roaming profiles, or non-C: drives can place home elsewhere.

**Consequences:** Config file is never found (hook still works with defaults, but config feature appears broken).

**How to avoid:** ALWAYS use `process.env.USERPROFILE` to get the user's home directory. This respects Windows settings and roaming profiles.

**Example:**
```javascript
// BAD:
const configPath = `C:\\Users\\${process.env.USERNAME}\\.claude\\hooks\\notify-waiting-config.json`;

// GOOD:
const configPath = path.join(
  process.env.USERPROFILE || process.env.HOME,  // USERPROFILE is the standard; HOME is fallback for non-Windows
  '.claude', 'hooks', 'notify-waiting-config.json'
);
```

**This phase addresses it:** Pattern 1 uses `process.env.USERPROFILE` with `path.join`, which respects Windows path conventions and environment variables.

---

### Pitfall 5: Numeric String in Config Becomes String in PowerShell

**What goes wrong:** User config has `"frequency": "440"` (string) instead of `"frequency": 440` (number). When interpolated into PowerShell, it becomes the string `"440"` instead of the number `440`.

**Why it happens:** User manually edits JSON without strict type discipline. Or a JSON generator (like some config GUIs) outputs strings for all values.

**Consequences:** PowerShell receives `[Console]::Beep('440', 220)` instead of `[Console]::Beep(440, 220)`. Type mismatch error in PowerShell.

**How to avoid:** Coerce numeric config values to numbers in Node.js before interpolating. Or validate config and reject non-numeric values.

**Example:**
```javascript
// After loading config, coerce:
config.sound.frequency = Number(config.sound.frequency) || DEFAULTS.sound.frequency;
config.sound.duration = Number(config.sound.duration) || DEFAULTS.sound.duration;
config.balloon.timeout = Number(config.balloon.timeout) || DEFAULTS.balloon.timeout;
```

**Confidence: MEDIUM** — JSON.parse preserves types, but user editing can introduce strings. Coercion is a one-liner but easy to forget.

---

## Code Examples

### Complete Phase 2 Config Load (Node.js)

```javascript
// Source: https://nodejs.org/api/fs.html and https://nodejs.org/api/path.html

const path = require('path');
const fs = require('fs');

// Hardcoded defaults (fallback if config file is missing or invalid)
const DEFAULTS = {
  sound: {
    frequency: 880,
    duration: 220
  },
  balloon: {
    title: 'Claude Code',
    message: 'Waiting for your input...',
    timeout: 6000
  }
};

// Config file location: next to the hook, in the user's .claude folder
const CONFIG_PATH = path.join(
  process.env.USERPROFILE || process.env.HOME,
  '.claude', 'hooks', 'notify-waiting-config.json'
);

// Load config with graceful fallback to defaults
function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');

    // Strip UTF-8 BOM if present (Pitfall 3 mitigation)
    const cleaned = raw.replace(/^\uFEFF/, '');
    const user = JSON.parse(cleaned);

    // Shallow merge: user config overlays DEFAULTS (Pitfall 2 fix)
    return {
      sound: {
        ...DEFAULTS.sound,
        ...(user.sound || {})
      },
      balloon: {
        ...DEFAULTS.balloon,
        ...(user.balloon || {})
      }
    };
  } catch (_) {
    // Any error: file not found, malformed JSON, permission denied, etc.
    // (Pitfall 1 fix)
    return DEFAULTS;
  }
}

// Load and coerce numeric values (Pitfall 5 mitigation)
let config = loadConfig();
config.sound.frequency = Number(config.sound.frequency) || DEFAULTS.sound.frequency;
config.sound.duration = Number(config.sound.duration) || DEFAULTS.sound.duration;
config.balloon.timeout = Number(config.balloon.timeout) || DEFAULTS.balloon.timeout;
```

---

### Complete Phase 2 Interpolation (Node.js)

Excerpt showing how config values flow into the PowerShell string:

```javascript
// After loading config (see above), build the balloon script with config values embedded

const balloon = `
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

# Config values interpolated from Node.js (PHASE 2 change)
\$frequency = ${config.sound.frequency}
\$duration  = ${config.sound.duration}
\$title     = '${config.balloon.title.replace(/'/g, "''")}'  # Escape single quotes for PowerShell
\$message   = '${config.balloon.message.replace(/'/g, "''")}'
\$timeout   = ${config.balloon.timeout}

# ... (process-tree walk code unchanged) ...

\$n = New-Object System.Windows.Forms.NotifyIcon
\$n.Icon    = [System.Drawing.SystemIcons]::Information
\$n.Visible = \$true

# Stabilization delay (unchanged from Phase 1)
Start-Sleep -Milliseconds 100

# Event handlers (unchanged)
\$n.add_BalloonTipClicked(({
    if (\$targetHwnd -ne [IntPtr]::Zero) {
        [ClaudeWin32]::AllowSetForegroundWindow(-1)
        [ClaudeWin32]::ShowWindow(\$targetHwnd, 9)
        [ClaudeWin32]::SetForegroundWindow(\$targetHwnd)
    }
    [System.Windows.Forms.Application]::Exit()
}).GetNewClosure())

\$n.add_BalloonTipClosed(({ [System.Windows.Forms.Application]::Exit() }).GetNewClosure())

\$n.add_BalloonTipShown(({
    try {
        \$ts = Get-Date -Format o
        Add-Content -Path "\$env:TEMP\\claude-notify-error.log" -Value "[\$ts] BalloonTipShown: notification appeared"
    } catch {}
}).GetNewClosure())

# PHASE 2: Use config values instead of hardcoded strings
\$n.ShowBalloonTip(\$timeout, \$title, \$message, [System.Windows.Forms.ToolTipIcon]::Info)

# Timer (unchanged)
\$timer = New-Object System.Windows.Forms.Timer
\$timer.Interval = 7000
\$timer.add_Tick(({ \$timer.Stop(); [System.Windows.Forms.Application]::Exit() }).GetNewClosure())
\$timer.Start()

[System.Windows.Forms.Application]::Run()
\$timer.Dispose()
\$n.Dispose()
`;

// Encode to base64 and spawn (unchanged from Phase 1)
const encoded = Buffer.from(balloon, 'utf16le').toString('base64');
// ... spawn call continues as before ...
```

---

### Example User Config File

File location: `%USERPROFILE%\.claude\hooks\notify-waiting-config.json`

```json
{
  "sound": {
    "frequency": 440,
    "duration": 300
  },
  "balloon": {
    "title": "Claude",
    "message": "Ready for input",
    "timeout": 8000
  }
}
```

All keys are optional. Missing keys use defaults:

```json
{
  "sound": {
    "frequency": 880
  }
}
```

Result: `frequency` = 880 (from user), `duration` = 220 (from defaults), `balloon` values all from defaults.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Manual trigger + file inspection |
| Config file | `%USERPROFILE%\.claude\hooks\notify-waiting-config.json` (user-created for testing) |
| Quick run command | `node hooks/notify-waiting.js` (trigger hook manually) |
| Full suite command | Manual: (1) no config, (2) partial config, (3) malformed JSON, (4) valid config with custom values |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CONF-01 | Hook reads JSON config and applies `sound.frequency`, `sound.duration`, `balloon.message`, `balloon.timeout` | Manual | Create `notify-waiting-config.json` with custom values, trigger hook, observe balloon with custom message and listen for tone frequency | ✅ Wave 0 |
| CONF-02 | Hook works with no config file (uses baked-in defaults) | Manual | Delete `notify-waiting-config.json`, trigger hook, observe balloon appears with default message and default tone frequency | ✅ Wave 0 |
| CONF-03 | Config file is located at `%USERPROFILE%\.claude\hooks\notify-waiting-config.json` | Manual | Create config at specified location, trigger hook, verify values flow through correctly | ✅ Wave 0 |

### Sampling Rate

- **Per task commit:** Trigger hook with no config present, verify default message appears. Then create config with custom message, trigger again, verify custom message appears.
- **Per wave merge:** Test three scenarios: (1) no config file, (2) partial config (only `sound.frequency` specified), (3) malformed JSON (missing closing brace). All three must result in a working notification with appropriate fallback behavior.
- **Phase gate:** Full test battery passes before `/gsd:verify-work` (see Wave 0 Gaps).

### Wave 0 Gaps

- [ ] None — Phase 2 requires only modifications to `hooks/notify-waiting.js`. No new test files, framework installation, or config scaffolding files needed. User creates the config file manually when desired; the hook works without it.

---

## State of the Art

| Old Approach (Phase 1 Hardcoded) | Current Approach (Phase 2 Config) | Impact |
|--------------------------------|--------------------------------|--------|
| Balloon title hardcoded as `'Claude Code'` | Configurable via `balloon.title` in JSON | User can customize notification title for multiple hooks or branded workflows |
| Balloon message hardcoded as `'Waiting for your input...'` | Configurable via `balloon.message` in JSON | User can add context-specific messages or use different languages |
| Balloon timeout hardcoded as 6000ms | Configurable via `balloon.timeout` in JSON | User can tune notification persistence based on screen distance or audio latency |
| Sound frequency unused (SystemSounds.Asterisk) | Prepared for Phase 3: configurable via `sound.frequency` in JSON | Foundation for Phase 3 tone generation; users can select pitch preference |
| Sound duration unused (SystemSounds.Asterisk) | Prepared for Phase 3: configurable via `sound.duration` in JSON | Foundation for Phase 3 tone generation; users can tune audible prominence |
| Config values in single monolithic try/catch | Defaults defined in CONSTANTS, merged per-key | Easier to maintain defaults and add new config keys in Phase 3 |
| No config file support | Config file at predictable location with graceful fallback | Professional UX: works out-of-box, supports power-user customization |

**Future-proofing (Phase 3 and 4):**
- Phase 3 will introduce `sound.frequency` and `sound.duration` into the code; these keys are already prepared in the Phase 2 config structure
- Phase 4 will NOT require new config keys (focus fix is code-based, not configurable), but the config pipeline will be stable and tested
- Phase 2 establishes the pattern so Phase 3 can focus on tone generation, not config plumbing

---

## Open Questions

1. **Should invalid config values (out-of-range numbers) fall back to defaults or use closest valid value?**
   - What we know: Phase 1 has no validation; Phase 2 could add validation before interpolation
   - What's unclear: Should user see feedback that their config was rejected? (Could log to error file or silently accept)
   - Recommendation: For v1, silently fall back to DEFAULTS on any validation error. Phase 3 can add better diagnostics when tone generation exposes what frequencies/durations actually work.

2. **Should config file be version-specific or apply to all hook versions?**
   - What we know: Installing a new hook version overwrites `notify-waiting.js` but not `notify-waiting-config.json`
   - What's unclear: If a user's config specifies `sound.frequency: 20000` and Phase 3 later limits to `[37, 32767]`, does the old config file break the new hook?
   - Recommendation: Document that config is forward-compatible (added keys are ignored; removed keys fall back to defaults). If Phase 3 introduces constraints, validate and clamp values, don't reject.

3. **Should the config file be created automatically on first hook run?**
   - What we know: Current plan is user-created (optional); hook works without it
   - What's unclear: Does this create friction for power users who want to customize immediately?
   - Recommendation: Keep it user-created for Phase 2. Phase 3+ can add an `install` subcommand that scaffolds a commented JSON template, but that's out of scope for v1.

4. **Should config loading be logged?**
   - What we know: File I/O errors are silently caught (no log output on fallback to defaults)
   - What's unclear: Should we log "Config loaded from..." or "Using defaults" for debugging?
   - Recommendation: No logging in Phase 2 (to keep it silent and simple). Phase 3 can add debug-mode logging if needed.

---

## Sources

### Primary (HIGH Confidence)

- [Node.js fs.readFileSync documentation](https://nodejs.org/api/fs.html#fs_fs_readfilesync_path_options) — synchronous file read, throws on error
- [Node.js JSON.parse documentation](https://nodejs.org/api/json.html#json_json_parse_text_reviver) — JSON parsing, throws on malformed input
- [Node.js path.join documentation](https://nodejs.org/api/path.html#path_path_join_paths) — cross-platform path construction
- [Node.js Buffer.from and toString documentation](https://nodejs.org/api/buffer.html#buffer_static_method_buffer_from_string_encoding) — base64 encoding for PowerShell `-EncodedCommand`
- [JavaScript Object.assign and spread operator](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/assign) and [spread syntax](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Spread_syntax) — shallow merge pattern for config defaults

### Secondary (MEDIUM Confidence)

- [Stack Research — Section 3: Config File Format and Parsing](../research/STACK.md) — Pre-research recommending JSON, schema design, PowerShell interpolation approach
- [Phase 1 Research — RESEARCH.md](./01-reliability/01-RESEARCH.md) — Established baseline for spawn error logging pattern, file I/O with try/catch, PowerShell event handlers

### Tertiary (Supporting)

- `.planning/research/PITFALLS.md` — General Windows hook pitfalls; some overlap with config edge cases
- `.planning/research/FEATURES.md` — User-facing config requirements from discovery phase

---

## Metadata

**Confidence breakdown:**

| Area | Level | Reason |
|------|-------|--------|
| JSON parsing in Node.js | HIGH | Native API, stable, documented, no dependencies |
| Config file location (`%USERPROFILE%\.claude\hooks\`) | HIGH | Matches existing hook installation location; uses environment variables correctly |
| Fallback-to-defaults pattern | HIGH | Standard practice in all Unix tools; no edge cases in this implementation |
| Shallow merge for partial configs | HIGH | Object spread syntax is ES6 stable; well-tested pattern |
| PowerShell string interpolation | HIGH | Template strings in Node.js are stable; no regex escaping needed for literal integers and simple strings |
| BOM handling | MEDIUM | UTF-8 BOM issue is real but one-liner fix; may not be hit in all test scenarios |
| Numeric type coercion | MEDIUM | JSON.parse preserves types, but user edits can introduce strings; coercion is straightforward but easy to forget |
| Overall Phase 2 | HIGH | No external dependencies, all mechanisms are standard library, direct improvement on Phase 1 foundation |

**Research date:** 2026-03-04
**Valid until:** 2026-03-31 (JSON and Node.js file APIs are stable; no anticipated changes in PowerShell 5.1; Windows path conventions stable)
**Review trigger:** Only if Node.js significantly changes how environment variables are accessed or if Windows changes home directory conventions
