$ErrorActionPreference = 'Stop'

if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
  Write-Host 'Bun is required. Installing Bun...'
  powershell -c "irm bun.sh/install.ps1 | iex"
  $bunHome = $env:BUN_INSTALL
  if (-not $bunHome) {
    $bunHome = Join-Path $HOME '.bun'
  }
  $bunBin = Join-Path $bunHome 'bin'
  $env:Path = "$bunBin;$env:Path"
}

bun add --global sophiaagent@latest
Write-Host 'Sophia Agent installed. Run: sophia'
