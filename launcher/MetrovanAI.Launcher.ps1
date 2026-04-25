[CmdletBinding()]
param()

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

[System.Windows.Forms.Application]::EnableVisualStyles()

$RepoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$RuntimeRoot = Join-Path $RepoRoot 'server-runtime'
$LogsRoot = Join-Path $RuntimeRoot 'logs'
$StatePath = Join-Path $RuntimeRoot 'launcher-state.json'
$ServerLogPath = Join-Path $LogsRoot 'server.log'
$ServerErrPath = Join-Path $LogsRoot 'server.err.log'
$TunnelLogPath = Join-Path $LogsRoot 'cloudflared.log'
$TunnelErrPath = Join-Path $LogsRoot 'cloudflared.err.log'
$ServerEntry = Join-Path $RepoRoot 'server\dist\index.js'
$ClientIndex = Join-Path $RepoRoot 'client\dist\index.html'
$TunnelConfig = Join-Path $RepoRoot 'deployment\cloudflare-tunnel\config.yml'
$ProductionConfigPath = Join-Path $RepoRoot 'deployment\local-server.production.json'
$ProductionTemplatePath = Join-Path $RepoRoot 'deployment\local-server.production.template.json'
$WebsiteUrl = 'http://127.0.0.1:8787'

[System.IO.Directory]::CreateDirectory($RuntimeRoot) | Out-Null
[System.IO.Directory]::CreateDirectory($LogsRoot) | Out-Null

function Resolve-Executable {
  param(
    [Parameter(Mandatory = $true)][string]$CommandName,
    [string[]]$FallbackPaths = @()
  )

  try {
    $command = Get-Command $CommandName -ErrorAction Stop
    if ($command.Path -and (Test-Path $command.Path)) {
      return $command.Path
    }
  } catch {
  }

  foreach ($fallback in $FallbackPaths) {
    if ($fallback -and (Test-Path $fallback)) {
      return $fallback
    }
  }

  return $null
}

function Get-ConfigValue {
  param(
    $Config,
    [Parameter(Mandatory = $true)][string]$Name,
    $Default = ''
  )

  if ($null -eq $Config) {
    return $Default
  }

  $property = $Config.PSObject.Properties[$Name]
  if (($null -eq $property) -or ($null -eq $property.Value)) {
    return $Default
  }

  return $property.Value
}

function Get-LauncherProductionConfig {
  $configSource = if (Test-Path $ProductionConfigPath) {
    $ProductionConfigPath
  } elseif (Test-Path $ProductionTemplatePath) {
    $ProductionTemplatePath
  } else {
    $null
  }

  if (-not $configSource) {
    return $null
  }

  try {
    return Get-Content -Path $configSource -Raw | ConvertFrom-Json
  } catch {
    return $null
  }
}

function Set-BackendEnvironment {
  $config = Get-LauncherProductionConfig
  $publicSiteUrl = [string](Get-ConfigValue -Config $config -Name 'publicSiteUrl' -Default 'https://metrovanai.com')

  $env:NODE_ENV = 'production'
  $env:PORT = [string](Get-ConfigValue -Config $config -Name 'localServerPort' -Default 8787)
  $env:METROVAN_METADATA_PROVIDER = [string](Get-ConfigValue -Config $config -Name 'metadataProvider' -Default 'json-file')
  $env:SUPABASE_DB_URL = [string](Get-ConfigValue -Config $config -Name 'supabaseDbUrl' -Default '')
  $env:METROVAN_METADATA_TABLE = [string](Get-ConfigValue -Config $config -Name 'metadataTable' -Default 'metrovan_metadata')
  $env:METROVAN_METADATA_DOCUMENT_ID = [string](Get-ConfigValue -Config $config -Name 'metadataDocumentId' -Default 'default')
  $env:METROVAN_POSTGRES_SSL = [string](Get-ConfigValue -Config $config -Name 'postgresSsl' -Default $true)
  $env:METROVAN_STORAGE_PROVIDER = [string](Get-ConfigValue -Config $config -Name 'storageProvider' -Default 'local-disk')
  $env:METROVAN_OBJECT_STORAGE_ENDPOINT = [string](Get-ConfigValue -Config $config -Name 'objectStorageEndpoint' -Default '')
  $env:METROVAN_OBJECT_STORAGE_REGION = [string](Get-ConfigValue -Config $config -Name 'objectStorageRegion' -Default 'auto')
  $env:METROVAN_OBJECT_STORAGE_BUCKET = [string](Get-ConfigValue -Config $config -Name 'objectStorageBucket' -Default '')
  $env:METROVAN_OBJECT_STORAGE_ACCESS_KEY_ID = [string](Get-ConfigValue -Config $config -Name 'objectStorageAccessKeyId' -Default '')
  $env:METROVAN_OBJECT_STORAGE_SECRET_ACCESS_KEY = [string](Get-ConfigValue -Config $config -Name 'objectStorageSecretAccessKey' -Default '')
  $env:METROVAN_OBJECT_STORAGE_PUBLIC_BASE_URL = [string](Get-ConfigValue -Config $config -Name 'objectStoragePublicBaseUrl' -Default '')
  $env:METROVAN_OBJECT_STORAGE_FORCE_PATH_STYLE = [string](Get-ConfigValue -Config $config -Name 'objectStorageForcePathStyle' -Default $true)
  $env:METROVAN_OBJECT_STORAGE_PREFIX = [string](Get-ConfigValue -Config $config -Name 'objectStoragePrefix' -Default 'metrovan')
  $env:METROVAN_TASK_EXECUTOR = [string](Get-ConfigValue -Config $config -Name 'taskExecutor' -Default 'local-runninghub')
  $env:METROVAN_REMOTE_EXECUTOR_URL = [string](Get-ConfigValue -Config $config -Name 'remoteExecutorBaseUrl' -Default '')
  $env:METROVAN_REMOTE_EXECUTOR_TOKEN = [string](Get-ConfigValue -Config $config -Name 'remoteExecutorToken' -Default '')
  $env:METROVAN_REMOTE_EXECUTOR_POLL_MS = [string](Get-ConfigValue -Config $config -Name 'remoteExecutorPollMs' -Default 2500)
  $env:METROVAN_REMOTE_EXECUTOR_TIMEOUT_SECONDS = [string](Get-ConfigValue -Config $config -Name 'remoteExecutorTimeoutSeconds' -Default 1800)
  $env:METROVAN_REMOTE_EXECUTOR_MAX_IN_FLIGHT = [string](Get-ConfigValue -Config $config -Name 'remoteExecutorMaxInFlight' -Default 2)
  $env:METROVAN_LOCAL_MERGE_MAX_IN_FLIGHT = [string](Get-ConfigValue -Config $config -Name 'localMergeMaxInFlight' -Default 2)
  $env:METROVAN_ADMIN_EMAILS = [string](Get-ConfigValue -Config $config -Name 'adminEmails' -Default '')
  $env:METROVAN_STRIPE_SECRET_KEY = [string](Get-ConfigValue -Config $config -Name 'stripeSecretKey' -Default '')
  $env:METROVAN_STRIPE_WEBHOOK_SECRET = [string](Get-ConfigValue -Config $config -Name 'stripeWebhookSecret' -Default '')
  $env:METROVAN_STRIPE_CURRENCY = [string](Get-ConfigValue -Config $config -Name 'stripeCurrency' -Default 'usd')
  $env:METROVAN_STRIPE_AUTOMATIC_TAX = [string](Get-ConfigValue -Config $config -Name 'stripeAutomaticTax' -Default $false)
  $env:PUBLIC_APP_URL = [string](Get-ConfigValue -Config $config -Name 'publicAppUrl' -Default $publicSiteUrl)
  $env:GOOGLE_CLIENT_ID = [string](Get-ConfigValue -Config $config -Name 'googleClientId' -Default '')
  $env:GOOGLE_CLIENT_SECRET = [string](Get-ConfigValue -Config $config -Name 'googleClientSecret' -Default '')
  $env:GOOGLE_REDIRECT_URI = [string](Get-ConfigValue -Config $config -Name 'googleRedirectUri' -Default 'https://api.metrovanai.com/api/auth/google/callback')
  $env:SMTP_HOST = [string](Get-ConfigValue -Config $config -Name 'smtpHost' -Default '')
  $env:SMTP_PORT = [string](Get-ConfigValue -Config $config -Name 'smtpPort' -Default 587)
  $env:SMTP_SECURE = [string](Get-ConfigValue -Config $config -Name 'smtpSecure' -Default $false)
  $env:SMTP_USER = [string](Get-ConfigValue -Config $config -Name 'smtpUser' -Default '')
  $env:SMTP_PASS = [string](Get-ConfigValue -Config $config -Name 'smtpPass' -Default '')
  $env:SMTP_FROM = [string](Get-ConfigValue -Config $config -Name 'smtpFrom' -Default '')
  $env:PASSWORD_RESET_LOG_LINKS = [string](Get-ConfigValue -Config $config -Name 'passwordResetLogLinks' -Default $false)
  $env:AUTH_EMAIL_LOG_LINKS = [string](Get-ConfigValue -Config $config -Name 'authEmailLogLinks' -Default $env:PASSWORD_RESET_LOG_LINKS)
}

function Get-State {
  if (-not (Test-Path $StatePath)) {
    return @{
      backendPid = $null
      tunnelPid = $null
    }
  }

  try {
    $parsed = Get-Content $StatePath -Raw | ConvertFrom-Json
    $state = @{
      backendPid = $null
      tunnelPid = $null
    }

    foreach ($property in $parsed.PSObject.Properties) {
      $state[$property.Name] = $property.Value
    }

    return $state
  } catch {
    return @{
      backendPid = $null
      tunnelPid = $null
    }
  }
}

function Save-State {
  param([hashtable]$State)

  $json = $State | ConvertTo-Json -Depth 4
  Set-Content -Path $StatePath -Value $json -Encoding UTF8
}

function Get-ManagedProcess {
  param([Nullable[int]]$Pid)

  if (-not $Pid) {
    return $null
  }

  try {
    return Get-Process -Id $Pid -ErrorAction Stop
  } catch {
    return $null
  }
}

function Get-PortProcessId {
  param([int]$Port)

  try {
    $connection = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop | Select-Object -First 1
    if ($connection) {
      return [int]$connection.OwningProcess
    }
  } catch {
  }

  return $null
}

function Test-BackendHealth {
  try {
    $response = Invoke-RestMethod -Uri "$WebsiteUrl/api/health" -TimeoutSec 3
    return [bool]$response.ok
  } catch {
    return $false
  }
}

function Stop-TrackedProcess {
  param([string]$Key)

  $state = Get-State
  $pid = $state[$Key]
  if ($pid) {
    try {
      Stop-Process -Id $pid -Force -ErrorAction Stop
    } catch {
    }
  }

  if ($Key -eq 'backendPid') {
    $portPid = Get-PortProcessId -Port 8787
    if ($portPid) {
      try {
        Stop-Process -Id $portPid -Force -ErrorAction Stop
      } catch {
      }
    }
  }

  $state[$Key] = $null
  Save-State $state
}

$NodeExe = Resolve-Executable -CommandName 'node.exe'
$CloudflaredExe = Resolve-Executable -CommandName 'cloudflared.exe' -FallbackPaths @(
  'C:\Users\zhouj\AppData\Local\Microsoft\WinGet\Packages\Cloudflare.cloudflared_Microsoft.Winget.Source_8wekyb3d8bbwe\cloudflared.exe'
)
$PnpmCmd = Resolve-Executable -CommandName 'pnpm.cmd' -FallbackPaths @(
  'C:\Users\zhouj\AppData\Roaming\npm\pnpm.cmd'
)

function Start-BackendProcess {
  if (-not $NodeExe) {
    throw 'node.exe was not found.'
  }
  if (-not (Test-Path $ServerEntry)) {
    throw 'Missing server\dist\index.js. Build the server first.'
  }
  if (-not (Test-Path $ClientIndex)) {
    throw 'Missing client\dist\index.html. Click Build Site first.'
  }

  $state = Get-State
  $current = Get-ManagedProcess -Pid $state.backendPid
  if ($current -or (Test-BackendHealth)) {
    return
  }

  Set-BackendEnvironment
  $process = Start-Process -FilePath $NodeExe `
    -ArgumentList 'server/dist/index.js' `
    -WorkingDirectory $RepoRoot `
    -RedirectStandardOutput $ServerLogPath `
    -RedirectStandardError $ServerErrPath `
    -PassThru

  $state.backendPid = $process.Id
  Save-State $state
}

function Start-TunnelProcess {
  if (-not $CloudflaredExe) {
    throw 'cloudflared.exe was not found.'
  }
  if (-not (Test-Path $TunnelConfig)) {
    throw 'Missing Cloudflare Tunnel config file.'
  }

  $state = Get-State
  $current = Get-ManagedProcess -Pid $state.tunnelPid
  if ($current) {
    return
  }

  $process = Start-Process -FilePath $CloudflaredExe `
    -ArgumentList @('tunnel', '--config', $TunnelConfig, 'run') `
    -WorkingDirectory $RepoRoot `
    -RedirectStandardOutput $TunnelLogPath `
    -RedirectStandardError $TunnelErrPath `
    -PassThru

  $state.tunnelPid = $process.Id
  Save-State $state
}

function Start-BuildProcess {
  if (-not $PnpmCmd) {
    throw 'pnpm.cmd was not found.'
  }

  Start-Process -FilePath 'cmd.exe' `
    -ArgumentList '/c', "`"$PnpmCmd`" build" `
    -WorkingDirectory $RepoRoot `
    -WindowStyle Normal | Out-Null
}

$form = New-Object System.Windows.Forms.Form
$form.Text = 'Metrovan AI Launcher'
$form.Size = New-Object System.Drawing.Size(360, 260)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.MinimizeBox = $true
$form.TopMost = $true
$form.BackColor = [System.Drawing.Color]::FromArgb(20, 20, 20)
$form.ForeColor = [System.Drawing.Color]::White

$title = New-Object System.Windows.Forms.Label
$title.Text = 'Metrovan AI Local Server'
$title.Font = New-Object System.Drawing.Font('Segoe UI', 14, [System.Drawing.FontStyle]::Bold)
$title.AutoSize = $true
$title.Location = New-Object System.Drawing.Point(16, 14)
$form.Controls.Add($title)

$statusLabel = New-Object System.Windows.Forms.Label
$statusLabel.AutoSize = $false
$statusLabel.Size = New-Object System.Drawing.Size(320, 48)
$statusLabel.Location = New-Object System.Drawing.Point(16, 48)
$statusLabel.Font = New-Object System.Drawing.Font('Segoe UI', 9)
$form.Controls.Add($statusLabel)

$backendLabel = New-Object System.Windows.Forms.Label
$backendLabel.AutoSize = $true
$backendLabel.Location = New-Object System.Drawing.Point(16, 100)
$backendLabel.Font = New-Object System.Drawing.Font('Segoe UI', 9)
$form.Controls.Add($backendLabel)

$tunnelLabel = New-Object System.Windows.Forms.Label
$tunnelLabel.AutoSize = $true
$tunnelLabel.Location = New-Object System.Drawing.Point(16, 122)
$tunnelLabel.Font = New-Object System.Drawing.Font('Segoe UI', 9)
$form.Controls.Add($tunnelLabel)

function New-Button {
  param(
    [string]$Text,
    [int]$X,
    [int]$Y
  )

  $button = New-Object System.Windows.Forms.Button
  $button.Text = $Text
  $button.Size = New-Object System.Drawing.Size(100, 32)
  $button.Location = New-Object System.Drawing.Point($X, $Y)
  $button.BackColor = [System.Drawing.Color]::FromArgb(34, 34, 34)
  $button.ForeColor = [System.Drawing.Color]::White
  $button.FlatStyle = 'Flat'
  $button.FlatAppearance.BorderColor = [System.Drawing.Color]::FromArgb(72, 72, 72)
  return $button
}

$startButton = New-Button -Text 'Start Server' -X 16 -Y 156
$stopButton = New-Button -Text 'Stop Server' -X 126 -Y 156
$tunnelButton = New-Button -Text 'Start Tunnel' -X 236 -Y 156
$openButton = New-Button -Text 'Open Site' -X 16 -Y 194
$buildButton = New-Button -Text 'Build Site' -X 126 -Y 194
$logButton = New-Button -Text 'Open Logs' -X 236 -Y 194

$form.Controls.AddRange(@($startButton, $stopButton, $tunnelButton, $openButton, $buildButton, $logButton))

function Refresh-Status {
  $state = Get-State
  $backendPid = $state.backendPid
  $backendProcess = Get-ManagedProcess -Pid $backendPid
  $portPid = Get-PortProcessId -Port 8787
  if (-not $backendProcess -and $portPid) {
    $backendPid = $portPid
    $state.backendPid = $portPid
    Save-State $state
    $backendProcess = Get-ManagedProcess -Pid $backendPid
  }

  $tunnelProcess = Get-ManagedProcess -Pid $state.tunnelPid
  $healthy = Test-BackendHealth

  if ($healthy) {
    $statusLabel.Text = "Site: $WebsiteUrl`r`nState: Running"
    $statusLabel.ForeColor = [System.Drawing.Color]::FromArgb(120, 255, 170)
  } elseif ($backendProcess) {
    $statusLabel.Text = "Site: $WebsiteUrl`r`nState: Starting"
    $statusLabel.ForeColor = [System.Drawing.Color]::FromArgb(255, 220, 120)
  } else {
    $statusLabel.Text = "Site: $WebsiteUrl`r`nState: Stopped"
    $statusLabel.ForeColor = [System.Drawing.Color]::FromArgb(255, 120, 120)
  }

  $backendLabel.Text = if ($backendProcess) { "Backend PID: $($backendProcess.Id)" } else { 'Backend PID: none' }
  $tunnelLabel.Text = if ($tunnelProcess) { "Tunnel PID: $($tunnelProcess.Id)" } else { 'Tunnel PID: none' }
  $tunnelButton.Text = if ($tunnelProcess) { 'Stop Tunnel' } else { 'Start Tunnel' }
}

$startButton.Add_Click({
  try {
    Start-BackendProcess
    Start-Sleep -Seconds 2
    Refresh-Status
  } catch {
    [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Start Server')
  }
})

$stopButton.Add_Click({
  Stop-TrackedProcess -Key 'backendPid'
  Refresh-Status
})

$tunnelButton.Add_Click({
  try {
    $state = Get-State
    $current = Get-ManagedProcess -Pid $state.tunnelPid
    if ($current) {
      Stop-TrackedProcess -Key 'tunnelPid'
    } else {
      Start-TunnelProcess
    }
    Start-Sleep -Seconds 1
    Refresh-Status
  } catch {
    [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Tunnel')
  }
})

$openButton.Add_Click({
  try {
    Start-BackendProcess
    Start-Sleep -Seconds 2
    Start-Process $WebsiteUrl | Out-Null
    Refresh-Status
  } catch {
    [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Open Site')
  }
})

$buildButton.Add_Click({
  try {
    Start-BuildProcess
  } catch {
    [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Build Site')
  }
})

$logButton.Add_Click({
  if (-not (Test-Path $LogsRoot)) {
    [System.IO.Directory]::CreateDirectory($LogsRoot) | Out-Null
  }
  Start-Process explorer.exe $LogsRoot | Out-Null
})

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 3000
$timer.Add_Tick({ Refresh-Status })
$timer.Start()

$form.Add_Shown({ Refresh-Status })
$form.Add_FormClosed({ $timer.Stop() })

[void]$form.ShowDialog()
