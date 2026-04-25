$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$configPath = Join-Path $repoRoot 'deployment\cloudflare-tunnel\config.yml'

if (-not (Test-Path $configPath)) {
    throw "Tunnel config not found: $configPath"
}

$cloudflared = (Get-Command cloudflared -ErrorAction SilentlyContinue)?.Source
if (-not $cloudflared) {
    $packagePath = 'C:\Users\zhouj\AppData\Local\Microsoft\WinGet\Packages\Cloudflare.cloudflared_Microsoft.Winget.Source_8wekyb3d8bbwe\cloudflared.exe'
    if (Test-Path $packagePath) {
        $cloudflared = $packagePath
    }
}

if (-not $cloudflared) {
    throw 'cloudflared not found. Install it first with winget.'
}

& $cloudflared tunnel --config $configPath run
