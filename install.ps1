# install.ps1
# Claude Notify Hook — standalone installer for Windows
# Usage: irm https://raw.githubusercontent.com/mt-promax/claude-notify-hook/master/install.ps1 | iex

$ErrorActionPreference = 'Stop'

$hookDir      = "$env:USERPROFILE\.claude\hooks"
$settingsFile = "$env:USERPROFILE\.claude\settings.json"
$hookDest     = "$hookDir\notify-waiting.js"
$rawBase      = "https://raw.githubusercontent.com/mt-promax/claude-notify-hook/master"

Write-Host ""
Write-Host "Claude Notify Hook - Installer" -ForegroundColor Cyan
Write-Host "==============================" -ForegroundColor Cyan
Write-Host ""

# 1. Create hooks directory if needed
if (-not (Test-Path $hookDir)) {
    New-Item -ItemType Directory -Path $hookDir | Out-Null
    Write-Host "  Created $hookDir" -ForegroundColor DarkGray
}

# 2. Download the hook script
Write-Host "  Downloading notify-waiting.js..." -ForegroundColor DarkGray
Invoke-WebRequest -Uri "$rawBase/hooks/notify-waiting.js" -OutFile $hookDest -UseBasicParsing
Write-Host "  Saved to $hookDest" -ForegroundColor DarkGray

# 3. Patch settings.json — merge the Notification hook entry without touching existing config
$hookCommand = "node `"$hookDest`""

$hookEntry = [ordered]@{
    type    = "command"
    command = $hookCommand
}
$hookGroup = [ordered]@{ hooks = @($hookEntry) }

if (Test-Path $settingsFile) {
    $raw      = Get-Content $settingsFile -Raw
    $settings = $raw | ConvertFrom-Json
} else {
    $settings = [PSCustomObject]@{}
}

# Ensure .hooks exists
if (-not $settings.PSObject.Properties['hooks']) {
    $settings | Add-Member -NotePropertyName 'hooks' -NotePropertyValue ([PSCustomObject]@{})
}

# Ensure .hooks.Notification exists
if (-not $settings.hooks.PSObject.Properties['Notification']) {
    $settings.hooks | Add-Member -NotePropertyName 'Notification' -NotePropertyValue @()
}

# Check if this command is already registered
$alreadyInstalled = $false
foreach ($group in $settings.hooks.Notification) {
    foreach ($hook in $group.hooks) {
        if ($hook.command -like "*notify-waiting.js*") {
            $alreadyInstalled = $true
        }
    }
}

if ($alreadyInstalled) {
    Write-Host "  Hook already registered in settings.json — skipping." -ForegroundColor Yellow
} else {
    # Append the new hook group
    $settings.hooks.Notification = @($settings.hooks.Notification) + $hookGroup
    $settings | ConvertTo-Json -Depth 10 | Set-Content $settingsFile -Encoding UTF8
    Write-Host "  Registered Notification hook in settings.json" -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "  Done! Claude Code will now show a clickable notification" -ForegroundColor Green
Write-Host "  whenever it's waiting for your input." -ForegroundColor Green
Write-Host ""
Write-Host "  To uninstall, remove the hook entry from:" -ForegroundColor DarkGray
Write-Host "  $settingsFile" -ForegroundColor DarkGray
Write-Host ""
