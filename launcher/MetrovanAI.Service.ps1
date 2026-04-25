[CmdletBinding()]
param(
  [switch]$SinglePass
)

$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'MetrovanAI.Common.ps1')

$mutex = Acquire-WatchdogMutex
if (-not $mutex) {
  exit 0
}

try {
  $state = Get-State
  $state.watchdogPid = $PID
  $state.watchdogStartedAt = (Get-Date).ToString('o')
  Save-State $state
  Write-WatchdogLog -Message 'Watchdog service started.'

  do {
    try {
      Write-WatchdogLog -Message 'Watchdog check pass started.'
      Ensure-LocalService
      Write-WatchdogLog -Message 'Watchdog check pass completed.'
    } catch {
      Write-WatchdogLog -Message $_.Exception.Message -Level 'ERROR'
    }

    if ($SinglePass) {
      break
    }

    $pollSeconds = [int](Get-LocalProductionConfig).watchdog.pollSeconds
    Start-Sleep -Seconds ([Math]::Max(5, $pollSeconds))
  } while ($true)
} finally {
  try {
    $state = Get-State
    $watchdogPid = if ($state.ContainsKey('watchdogPid')) { $state.watchdogPid } else { $null }
    if ($watchdogPid -eq $PID) {
      $state.watchdogPid = $null
      $state.watchdogStartedAt = $null
      Save-State $state
    }
  } catch {
  }

  Release-WatchdogMutex -Mutex $mutex
}
