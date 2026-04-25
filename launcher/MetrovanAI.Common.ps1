[CmdletBinding()]
param()

Set-StrictMode -Version Latest

$script:RepoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$script:ServerEntry = Join-Path $script:RepoRoot 'server\dist\index.js'
$script:ClientIndex = Join-Path $script:RepoRoot 'client\dist\index.html'
$script:TunnelConfig = Join-Path $script:RepoRoot 'deployment\cloudflare-tunnel\config.yml'
$script:ProductionConfigPath = Join-Path $script:RepoRoot 'deployment\local-server.production.json'
$script:ProductionTemplatePath = Join-Path $script:RepoRoot 'deployment\local-server.production.template.json'
$script:LocalProductionConfigCache = $null
$script:NodeExe = $null
$script:CloudflaredExe = $null
$script:PnpmCmd = $null

function New-StateDefaults {
  return @{
    backendPid = $null
    backendStartedAt = $null
    backendFailureCount = 0
    tunnelPid = $null
    tunnelStartedAt = $null
    publicFailureCount = 0
    watchdogPid = $null
    watchdogStartedAt = $null
    lastCheckAt = $null
    lastLocalHealthyAt = $null
    lastPublicHealthyAt = $null
  }
}

function ConvertTo-Hashtable {
  param([Parameter(ValueFromPipeline = $true)]$Value)

  if ($null -eq $Value) {
    return $null
  }

  if ($Value -is [System.Collections.IDictionary]) {
    $table = @{}
    foreach ($key in $Value.Keys) {
      $table[[string]$key] = ConvertTo-Hashtable $Value[$key]
    }
    return $table
  }

  if ($Value -is [System.Management.Automation.PSCustomObject]) {
    $table = @{}
    foreach ($property in $Value.PSObject.Properties) {
      $table[$property.Name] = ConvertTo-Hashtable $property.Value
    }
    return $table
  }

  if (($Value -is [System.Collections.IEnumerable]) -and -not ($Value -is [string])) {
    $items = @()
    foreach ($item in $Value) {
      $items += ,(ConvertTo-Hashtable $item)
    }
    return $items
  }

  return $Value
}

function Merge-Hashtable {
  param(
    [hashtable]$Base,
    [hashtable]$Overlay
  )

  $merged = @{}
  foreach ($key in $Base.Keys) {
    $merged[$key] = $Base[$key]
  }

  foreach ($key in $Overlay.Keys) {
    $existing = if ($merged.ContainsKey($key)) { $merged[$key] } else { $null }
    $next = $Overlay[$key]

    if (($existing -is [hashtable]) -and ($next -is [hashtable])) {
      $merged[$key] = Merge-Hashtable -Base $existing -Overlay $next
      continue
    }

    $merged[$key] = $next
  }

  return $merged
}

function Get-DefaultLocalProductionConfig {
  return @{
    apiBaseUrl = 'https://api.metrovanai.com'
    publicSiteUrl = 'https://metrovanai.com'
    publicAppUrl = 'https://metrovanai.com'
    publicApiHealthUrl = 'https://api.metrovanai.com/api/health'
    localServerPort = 8787
    metadataProvider = 'json-file'
    supabaseDbUrl = ''
    metadataTable = 'metrovan_metadata'
    metadataDocumentId = 'default'
    postgresSsl = $true
    storageProvider = 'local-disk'
    objectStorageEndpoint = ''
    objectStorageRegion = 'auto'
    objectStorageBucket = ''
    objectStorageAccessKeyId = ''
    objectStorageSecretAccessKey = ''
    objectStoragePublicBaseUrl = ''
    objectStorageForcePathStyle = $true
    objectStoragePrefix = 'metrovan'
    taskExecutor = 'local-runninghub'
    remoteExecutorBaseUrl = ''
    remoteExecutorToken = ''
    remoteExecutorPollMs = 2500
    remoteExecutorTimeoutSeconds = 1800
    remoteExecutorMaxInFlight = 2
    localMergeMaxInFlight = 2
    storageRoot = 'server-runtime'
    adminEmails = ''
    stripeSecretKey = ''
    stripeWebhookSecret = ''
    stripeCurrency = 'usd'
    stripeAutomaticTax = $false
    googleClientId = ''
    googleClientSecret = ''
    googleRedirectUri = 'https://api.metrovanai.com/api/auth/google/callback'
    smtpHost = ''
    smtpPort = 587
    smtpSecure = $false
    smtpUser = ''
    smtpPass = ''
    smtpFrom = ''
    passwordResetLogLinks = $false
    watchdog = @{
      pollSeconds = 15
      backendStartGraceSeconds = 25
      tunnelStartGraceSeconds = 10
      publicFailureThreshold = 3
      backendFailureThreshold = 2
      restartCooldownSeconds = 8
    }
  }
}

function Get-LocalProductionConfig {
  $config = Get-DefaultLocalProductionConfig
  $configSource = if (Test-Path $script:ProductionConfigPath) {
    $script:ProductionConfigPath
  } elseif (Test-Path $script:ProductionTemplatePath) {
    $script:ProductionTemplatePath
  } else {
    $null
  }

  if ($configSource) {
    try {
      $parsed = Get-Content -Path $configSource -Raw | ConvertFrom-Json
      $table = ConvertTo-Hashtable $parsed
      if ($table -is [hashtable]) {
        $config = Merge-Hashtable -Base $config -Overlay $table
      }
    } catch {
      Write-Warning "Failed to parse local production config: $configSource"
    }
  }

  return $config
}

function Get-RuntimeRoot {
  $config = Get-LocalProductionConfig
  $storageRoot = if ($null -ne $config.storageRoot) { [string]$config.storageRoot } else { 'server-runtime' }
  if ([string]::IsNullOrWhiteSpace($storageRoot)) {
    $storageRoot = 'server-runtime'
  }

  if ([System.IO.Path]::IsPathRooted($storageRoot)) {
    return [System.IO.Path]::GetFullPath($storageRoot)
  }

  return [System.IO.Path]::GetFullPath((Join-Path $script:RepoRoot $storageRoot))
}

function Get-LogsRoot {
  $logsRoot = Join-Path (Get-RuntimeRoot) 'logs'
  [System.IO.Directory]::CreateDirectory($logsRoot) | Out-Null
  return $logsRoot
}

function Get-StatePath {
  return Join-Path (Get-RuntimeRoot) 'launcher-state.json'
}

function Get-ServerLogPath {
  return Join-Path (Get-LogsRoot) 'server.log'
}

function Get-ServerErrPath {
  return Join-Path (Get-LogsRoot) 'server.err.log'
}

function Get-TunnelLogPath {
  return Join-Path (Get-LogsRoot) 'cloudflared.log'
}

function Get-TunnelErrPath {
  return Join-Path (Get-LogsRoot) 'cloudflared.err.log'
}

function Get-WatchdogLogPath {
  return Join-Path (Get-LogsRoot) 'watchdog.log'
}

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

function Initialize-MetrovanExecutables {
  if (-not $script:NodeExe) {
    $script:NodeExe = Resolve-Executable -CommandName 'node.exe'
  }

  if (-not $script:CloudflaredExe) {
    $script:CloudflaredExe = Resolve-Executable -CommandName 'cloudflared.exe' -FallbackPaths @(
      'C:\Users\zhouj\AppData\Local\Microsoft\WinGet\Packages\Cloudflare.cloudflared_Microsoft.Winget.Source_8wekyb3d8bbwe\cloudflared.exe'
    )
  }

  if (-not $script:PnpmCmd) {
    $script:PnpmCmd = Resolve-Executable -CommandName 'pnpm.cmd' -FallbackPaths @(
      'C:\Users\zhouj\AppData\Roaming\npm\pnpm.cmd'
    )
  }
}

function Get-State {
  $statePath = Get-StatePath
  if (-not (Test-Path $statePath)) {
    return New-StateDefaults
  }

  try {
    $parsed = Get-Content -Path $statePath -Raw | ConvertFrom-Json
    $table = ConvertTo-Hashtable $parsed
    if ($table -is [hashtable]) {
      return Merge-Hashtable -Base (New-StateDefaults) -Overlay $table
    }
  } catch {
  }

  return New-StateDefaults
}

function Save-State {
  param([hashtable]$State)

  $runtimeRoot = Get-RuntimeRoot
  [System.IO.Directory]::CreateDirectory($runtimeRoot) | Out-Null
  $json = $State | ConvertTo-Json -Depth 8
  Set-Content -Path (Get-StatePath) -Value $json -Encoding UTF8
}

function Get-ManagedProcess {
  param([Nullable[int]]$ProcessId)

  if (-not $ProcessId) {
    return $null
  }

  try {
    return Get-Process -Id $ProcessId -ErrorAction Stop
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

function Get-BackendUrl {
  $config = Get-LocalProductionConfig
  return "http://127.0.0.1:$([int]$config.localServerPort)"
}

function Invoke-MetrovanHealthCheck {
  param(
    [Parameter(Mandatory = $true)][string]$Uri,
    [int]$TimeoutSeconds = 5
  )

  try {
    $response = Invoke-RestMethod -Uri $Uri -TimeoutSec $TimeoutSeconds
    return [bool]$response.ok
  } catch {
    return $false
  }
}

function Test-BackendHealth {
  return Invoke-MetrovanHealthCheck -Uri "$((Get-BackendUrl).TrimEnd('/'))/api/health" -TimeoutSeconds 3
}

function Test-PublicApiHealth {
  $config = Get-LocalProductionConfig
  $uri = if ($null -ne $config.publicApiHealthUrl) { [string]$config.publicApiHealthUrl } else { '' }
  if ([string]::IsNullOrWhiteSpace($uri)) {
    $apiBaseUrl = if ($null -ne $config.apiBaseUrl) { [string]$config.apiBaseUrl } else { '' }
    if ([string]::IsNullOrWhiteSpace($apiBaseUrl)) {
      return $false
    }
    $uri = "$($apiBaseUrl.TrimEnd('/'))/api/health"
  }

  return Invoke-MetrovanHealthCheck -Uri $uri -TimeoutSeconds 6
}

function Set-BackendEnvironment {
  $config = Get-LocalProductionConfig

  $env:NODE_ENV = 'production'
  $env:PORT = [string]([int]$config.localServerPort)
  $env:METROVAN_METADATA_PROVIDER = if ($null -ne $config.metadataProvider) { [string]$config.metadataProvider } else { 'json-file' }
  $env:SUPABASE_DB_URL = if ($null -ne $config.supabaseDbUrl) { [string]$config.supabaseDbUrl } else { '' }
  $env:METROVAN_METADATA_TABLE = if ($null -ne $config.metadataTable) { [string]$config.metadataTable } else { 'metrovan_metadata' }
  $env:METROVAN_METADATA_DOCUMENT_ID = if ($null -ne $config.metadataDocumentId) { [string]$config.metadataDocumentId } else { 'default' }
  $env:METROVAN_POSTGRES_SSL = if ($null -ne $config.postgresSsl) { [string]$config.postgresSsl } else { 'True' }
  $env:METROVAN_STORAGE_PROVIDER = if ($null -ne $config.storageProvider) { [string]$config.storageProvider } else { 'local-disk' }
  $env:METROVAN_OBJECT_STORAGE_ENDPOINT = if ($null -ne $config.objectStorageEndpoint) { [string]$config.objectStorageEndpoint } else { '' }
  $env:METROVAN_OBJECT_STORAGE_REGION = if ($null -ne $config.objectStorageRegion) { [string]$config.objectStorageRegion } else { 'auto' }
  $env:METROVAN_OBJECT_STORAGE_BUCKET = if ($null -ne $config.objectStorageBucket) { [string]$config.objectStorageBucket } else { '' }
  $env:METROVAN_OBJECT_STORAGE_ACCESS_KEY_ID = if ($null -ne $config.objectStorageAccessKeyId) { [string]$config.objectStorageAccessKeyId } else { '' }
  $env:METROVAN_OBJECT_STORAGE_SECRET_ACCESS_KEY = if ($null -ne $config.objectStorageSecretAccessKey) { [string]$config.objectStorageSecretAccessKey } else { '' }
  $env:METROVAN_OBJECT_STORAGE_PUBLIC_BASE_URL = if ($null -ne $config.objectStoragePublicBaseUrl) { [string]$config.objectStoragePublicBaseUrl } else { '' }
  $env:METROVAN_OBJECT_STORAGE_FORCE_PATH_STYLE = if ($null -ne $config.objectStorageForcePathStyle) { [string]$config.objectStorageForcePathStyle } else { 'True' }
  $env:METROVAN_OBJECT_STORAGE_PREFIX = if ($null -ne $config.objectStoragePrefix) { [string]$config.objectStoragePrefix } else { 'metrovan' }
  $env:METROVAN_TASK_EXECUTOR = if ($null -ne $config.taskExecutor) { [string]$config.taskExecutor } else { 'local-runninghub' }
  $env:METROVAN_REMOTE_EXECUTOR_URL = if ($null -ne $config.remoteExecutorBaseUrl) { [string]$config.remoteExecutorBaseUrl } else { '' }
  $env:METROVAN_REMOTE_EXECUTOR_TOKEN = if ($null -ne $config.remoteExecutorToken) { [string]$config.remoteExecutorToken } else { '' }
  $env:METROVAN_REMOTE_EXECUTOR_POLL_MS = if ($null -ne $config.remoteExecutorPollMs) { [string]$config.remoteExecutorPollMs } else { '2500' }
  $env:METROVAN_REMOTE_EXECUTOR_TIMEOUT_SECONDS = if ($null -ne $config.remoteExecutorTimeoutSeconds) { [string]$config.remoteExecutorTimeoutSeconds } else { '1800' }
  $env:METROVAN_REMOTE_EXECUTOR_MAX_IN_FLIGHT = if ($null -ne $config.remoteExecutorMaxInFlight) { [string]$config.remoteExecutorMaxInFlight } else { '2' }
  $env:METROVAN_LOCAL_MERGE_MAX_IN_FLIGHT = if ($null -ne $config.localMergeMaxInFlight) { [string]$config.localMergeMaxInFlight } else { '2' }
  $env:METROVAN_ADMIN_EMAILS = if ($null -ne $config.adminEmails) { [string]$config.adminEmails } else { '' }
  $env:METROVAN_STRIPE_SECRET_KEY = if ($null -ne $config.stripeSecretKey) { [string]$config.stripeSecretKey } else { '' }
  $env:METROVAN_STRIPE_WEBHOOK_SECRET = if ($null -ne $config.stripeWebhookSecret) { [string]$config.stripeWebhookSecret } else { '' }
  $env:METROVAN_STRIPE_CURRENCY = if ($null -ne $config.stripeCurrency) { [string]$config.stripeCurrency } else { 'usd' }
  $env:METROVAN_STRIPE_AUTOMATIC_TAX = if ($null -ne $config.stripeAutomaticTax) { [string]$config.stripeAutomaticTax } else { 'False' }
  $env:PUBLIC_APP_URL = if ($null -ne $config.publicAppUrl) { [string]$config.publicAppUrl } else { [string]$config.publicSiteUrl }
  $env:GOOGLE_CLIENT_ID = if ($null -ne $config.googleClientId) { [string]$config.googleClientId } else { '' }
  $env:GOOGLE_CLIENT_SECRET = if ($null -ne $config.googleClientSecret) { [string]$config.googleClientSecret } else { '' }
  $env:GOOGLE_REDIRECT_URI = if ($null -ne $config.googleRedirectUri) { [string]$config.googleRedirectUri } else { '' }
  $env:SMTP_HOST = if ($null -ne $config.smtpHost) { [string]$config.smtpHost } else { '' }
  $env:SMTP_PORT = if ($null -ne $config.smtpPort) { [string]$config.smtpPort } else { '587' }
  $env:SMTP_SECURE = if ($null -ne $config.smtpSecure) { [string]$config.smtpSecure } else { 'False' }
  $env:SMTP_USER = if ($null -ne $config.smtpUser) { [string]$config.smtpUser } else { '' }
  $env:SMTP_PASS = if ($null -ne $config.smtpPass) { [string]$config.smtpPass } else { '' }
  $env:SMTP_FROM = if ($null -ne $config.smtpFrom) { [string]$config.smtpFrom } else { '' }
  $env:PASSWORD_RESET_LOG_LINKS = if ($null -ne $config.passwordResetLogLinks) { [string]$config.passwordResetLogLinks } else { 'False' }
  $authEmailLogLinks = if ($config.ContainsKey('authEmailLogLinks')) { $config['authEmailLogLinks'] } else { $null }
  $env:AUTH_EMAIL_LOG_LINKS = if ($null -ne $authEmailLogLinks) { [string]$authEmailLogLinks } else { [string]$env:PASSWORD_RESET_LOG_LINKS }
}

function Write-WatchdogLog {
  param(
    [Parameter(Mandatory = $true)][string]$Message,
    [ValidateSet('INFO', 'WARN', 'ERROR')][string]$Level = 'INFO'
  )

  $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
  Add-Content -Path (Get-WatchdogLogPath) -Value "$timestamp [$Level] $Message"
}

function Stop-TrackedProcess {
  param([Parameter(Mandatory = $true)][string]$Key)

  $state = Get-State
  $trackedPid = $state[$Key]
  if ($trackedPid) {
    try {
      Stop-Process -Id $trackedPid -Force -ErrorAction Stop
    } catch {
    }
  }

  if ($Key -eq 'backendPid') {
    $portPid = Get-PortProcessId -Port ([int](Get-LocalProductionConfig).localServerPort)
    if ($portPid) {
      try {
        Stop-Process -Id $portPid -Force -ErrorAction Stop
      } catch {
      }
    }
    $state.backendPid = $null
    $state.backendStartedAt = $null
    $state.backendFailureCount = 0
  }

  if ($Key -eq 'tunnelPid') {
    $state.tunnelPid = $null
    $state.tunnelStartedAt = $null
    $state.publicFailureCount = 0
  }

  if ($Key -eq 'watchdogPid') {
    $state.watchdogPid = $null
    $state.watchdogStartedAt = $null
  }

  Save-State $state
}

function Start-BackendProcess {
  Initialize-MetrovanExecutables
  if (-not $script:NodeExe) {
    throw 'node.exe was not found.'
  }
  if (-not (Test-Path $script:ServerEntry)) {
    throw 'Missing server\dist\index.js. Build the server first.'
  }
  if (-not (Test-Path $script:ClientIndex)) {
    throw 'Missing client\dist\index.html. Build the client first.'
  }

  $config = Get-LocalProductionConfig
  $state = Get-State
  if (Test-BackendHealth) {
    $portPid = Get-PortProcessId -Port ([int]$config.localServerPort)
    if ($portPid) {
      $current = Get-ManagedProcess -ProcessId $portPid
      if ($current) {
        $state.backendPid = $current.Id
        if (-not $state.backendStartedAt) {
          $state.backendStartedAt = (Get-Date).ToString('o')
        }
        Save-State $state
        return $current
      }
    }
  }

  $current = Get-ManagedProcess -ProcessId $state.backendPid
  if (-not $current) {
    $portPid = Get-PortProcessId -Port ([int]$config.localServerPort)
    if ($portPid) {
      $current = Get-ManagedProcess -ProcessId $portPid
      if ($current) {
        $state.backendPid = $portPid
        Save-State $state
      }
    }
  }

  if ($current) {
    return $current
  }

  Set-BackendEnvironment
  $process = Start-Process -FilePath $script:NodeExe `
    -ArgumentList 'server/dist/index.js' `
    -WorkingDirectory $script:RepoRoot `
    -RedirectStandardOutput (Get-ServerLogPath) `
    -RedirectStandardError (Get-ServerErrPath) `
    -PassThru

  $state.backendPid = $process.Id
  $state.backendStartedAt = (Get-Date).ToString('o')
  $state.backendFailureCount = 0
  Save-State $state
  return $process
}

function Start-TunnelProcess {
  Initialize-MetrovanExecutables
  if (-not $script:CloudflaredExe) {
    throw 'cloudflared.exe was not found.'
  }
  if (-not (Test-Path $script:TunnelConfig)) {
    throw 'Missing Cloudflare Tunnel config file.'
  }

  $state = Get-State
  $current = Get-ManagedProcess -ProcessId $state.tunnelPid
  if ($current) {
    return $current
  }

  $process = Start-Process -FilePath $script:CloudflaredExe `
    -ArgumentList @('tunnel', '--config', $script:TunnelConfig, 'run') `
    -WorkingDirectory $script:RepoRoot `
    -RedirectStandardOutput (Get-TunnelLogPath) `
    -RedirectStandardError (Get-TunnelErrPath) `
    -PassThru

  $state.tunnelPid = $process.Id
  $state.tunnelStartedAt = (Get-Date).ToString('o')
  $state.publicFailureCount = 0
  Save-State $state
  return $process
}

function Start-BuildProcess {
  Initialize-MetrovanExecutables
  if (-not $script:PnpmCmd) {
    throw 'pnpm.cmd was not found.'
  }

  Start-Process -FilePath 'cmd.exe' `
    -ArgumentList '/c', "`"$script:PnpmCmd`" build" `
    -WorkingDirectory $script:RepoRoot `
    -WindowStyle Normal | Out-Null
}

function Ensure-LocalService {
  $config = Get-LocalProductionConfig
  $state = Get-State
  $now = Get-Date
  $state.lastCheckAt = $now.ToString('o')

  $backend = Get-ManagedProcess -ProcessId $state.backendPid
  if (-not $backend) {
    $portPid = Get-PortProcessId -Port ([int]$config.localServerPort)
    if ($portPid) {
      $backend = Get-ManagedProcess -ProcessId $portPid
      if ($backend) {
        $state.backendPid = $backend.Id
      }
    }
  }

  $localHealthy = Test-BackendHealth
  if (-not $backend) {
    if ($localHealthy) {
      $portPid = Get-PortProcessId -Port ([int]$config.localServerPort)
      if ($portPid) {
        $portProcess = Get-ManagedProcess -ProcessId $portPid
        if ($portProcess) {
          $state.backendPid = $portProcess.Id
          $state.backendFailureCount = 0
          $state.lastLocalHealthyAt = $now.ToString('o')
          Save-State $state
          return
        }
      }
    }

    Start-BackendProcess | Out-Null
    Write-WatchdogLog -Message 'Started backend process.'
    $state = Get-State
    $state.lastCheckAt = $now.ToString('o')
    Save-State $state
    return
  }

  if ($localHealthy) {
    $state.backendFailureCount = 0
    $state.lastLocalHealthyAt = $now.ToString('o')
  } else {
    $backendFailureCount = if ($null -ne $state.backendFailureCount) { [int]$state.backendFailureCount } else { 0 }
    $state.backendFailureCount = $backendFailureCount + 1
    $backendStartedAt = if ($state.backendStartedAt) { [datetime]$state.backendStartedAt } else { $now.AddMinutes(-10) }
    $backendAgeSeconds = ($now - $backendStartedAt).TotalSeconds
    if (
      ($backendAgeSeconds -ge [int]$config.watchdog.backendStartGraceSeconds) -and
      ([int]$state.backendFailureCount -ge [int]$config.watchdog.backendFailureThreshold)
    ) {
      Write-WatchdogLog -Message "Backend unhealthy for $([int]$state.backendFailureCount) checks. Restarting backend." -Level 'WARN'
      Stop-TrackedProcess -Key 'backendPid'
      Start-Sleep -Seconds ([int]$config.watchdog.restartCooldownSeconds)
      Start-BackendProcess | Out-Null
      $state = Get-State
      $state.lastCheckAt = $now.ToString('o')
      Save-State $state
      return
    }
  }

  $tunnel = Get-ManagedProcess -ProcessId $state.tunnelPid
  if (-not $tunnel) {
    Start-TunnelProcess | Out-Null
    Write-WatchdogLog -Message 'Started cloudflared process.'
    $state = Get-State
    $state.lastCheckAt = $now.ToString('o')
    Save-State $state
    return
  }

  if ($localHealthy) {
    $publicHealthy = Test-PublicApiHealth
    if ($publicHealthy) {
      $state.publicFailureCount = 0
      $state.lastPublicHealthyAt = $now.ToString('o')
    } else {
      $publicFailureCount = if ($null -ne $state.publicFailureCount) { [int]$state.publicFailureCount } else { 0 }
      $state.publicFailureCount = $publicFailureCount + 1
      $tunnelStartedAt = if ($state.tunnelStartedAt) { [datetime]$state.tunnelStartedAt } else { $now.AddMinutes(-10) }
      $tunnelAgeSeconds = ($now - $tunnelStartedAt).TotalSeconds
      if (
        ($tunnelAgeSeconds -ge [int]$config.watchdog.tunnelStartGraceSeconds) -and
        ([int]$state.publicFailureCount -ge [int]$config.watchdog.publicFailureThreshold)
      ) {
        Write-WatchdogLog -Message "Public API health failed $([int]$state.publicFailureCount) times. Restarting cloudflared." -Level 'WARN'
        Stop-TrackedProcess -Key 'tunnelPid'
        Start-Sleep -Seconds ([int]$config.watchdog.restartCooldownSeconds)
        Start-TunnelProcess | Out-Null
        $state = Get-State
      }
    }
  }

  Save-State $state
}

function Acquire-WatchdogMutex {
  param([string]$Name = 'Global\MetrovanAIWatchdog')

  $created = $false
  $mutex = New-Object System.Threading.Mutex($true, $Name, [ref]$created)
  if (-not $created) {
    try {
      $mutex.Dispose()
    } catch {
    }
    return $null
  }

  return $mutex
}

function Release-WatchdogMutex {
  param($Mutex)

  if (-not $Mutex) {
    return
  }

  try {
    $Mutex.ReleaseMutex() | Out-Null
  } catch {
  }

  try {
    $Mutex.Dispose()
  } catch {
  }
}
