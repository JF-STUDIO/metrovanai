param(
  [string]$ImageName = "metrovanai-runpod-worker",
  [string]$Tag = "local"
)

$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$WorkerRoot = Join-Path $RepoRoot "runpod-worker"

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw "Docker is not installed or not available in PATH. Install Docker Desktop, then rerun this script."
}

docker build -t "${ImageName}:${Tag}" $WorkerRoot
Write-Host "Built ${ImageName}:${Tag}"
