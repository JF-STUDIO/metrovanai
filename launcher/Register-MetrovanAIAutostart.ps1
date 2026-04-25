[CmdletBinding()]
param(
  [switch]$StartNow
)

$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'MetrovanAI.Common.ps1')

$serviceScriptPath = Join-Path $PSScriptRoot 'MetrovanAI.Service.ps1'
$taskCommand = "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$serviceScriptPath`""
$startupFolder = [Environment]::GetFolderPath('Startup')
$shortcutPath = Join-Path $startupFolder 'MetrovanAI Watchdog.lnk'
$wshShell = New-Object -ComObject WScript.Shell
$shortcut = $wshShell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = 'powershell.exe'
$shortcut.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$serviceScriptPath`""
$shortcut.WorkingDirectory = $script:RepoRoot
$shortcut.WindowStyle = 7
$shortcut.Description = 'Starts the Metrovan AI local watchdog service.'
$shortcut.Save()

$taskName = 'MetrovanAI Watchdog Recovery'
try {
  & schtasks.exe /Delete /TN $taskName /F | Out-Null
} catch {
}

& schtasks.exe /Create /TN $taskName /TR $taskCommand /SC MINUTE /MO 5 /F
if ($LASTEXITCODE -ne 0) {
  throw "Failed to register scheduled task: $taskName"
}

if ($StartNow) {
  Start-Process -FilePath 'powershell.exe' `
    -ArgumentList '-NoProfile', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', $serviceScriptPath `
    -WorkingDirectory $script:RepoRoot `
    -WindowStyle Hidden | Out-Null
}

Write-Output "Registered startup shortcut: $shortcutPath"
Write-Output 'Registered scheduled task: MetrovanAI Watchdog Recovery'
