# ============================================================
#  Deploy de Gaby's Fashion a Netlify
#  Uso:
#     .\deploy_netlify.ps1              -> deploy a PRODUCCIÓN
#     .\deploy_netlify.ps1 -Draft       -> deploy de prueba (URL temporal)
#     .\deploy_netlify.ps1 -Message "x" -> con nota/etiqueta
# ============================================================
[CmdletBinding()]
param(
  [switch]$Draft,
  [string]$Message
)

$ErrorActionPreference = 'Stop'
$root    = $PSScriptRoot
$publish = Join-Path $root 'Script Principal\web_temp'

if (-not (Test-Path (Join-Path $publish 'index.html'))) {
  throw "No se encontró index.html en: $publish"
}

# --- Autenticación (opcional): variable de entorno o archivo netlify_token.txt ---
$token = $env:NETLIFY_AUTH_TOKEN
if (-not $token) {
  $tf = Join-Path $root 'netlify_token.txt'
  if (Test-Path $tf) { $token = (Get-Content $tf -Raw).Trim() }
}

# --- ID del sitio (opcional): variable de entorno o archivo netlify_site.txt ---
$site = $env:NETLIFY_SITE_ID
if (-not $site) {
  $sf = Join-Path $root 'netlify_site.txt'
  if (Test-Path $sf) { $site = (Get-Content $sf -Raw).Trim() }
}

# --- Elegir cómo invocar la CLI (global si existe, si no vía npx) ---
$netlifyGlobal = Get-Command netlify -ErrorAction SilentlyContinue
if ($netlifyGlobal) {
  $exe  = 'netlify'
  $base = @('deploy')
} else {
  Write-Host "Netlify CLI no está instalado globalmente; usando npx (puede tardar la primera vez)..." -ForegroundColor Yellow
  $exe  = 'npx'
  $base = @('--yes', 'netlify-cli@latest', 'deploy')
}

# --- Construir argumentos ---
$deployArgs = $base + @('--dir', $publish)
if (-not $Draft) { $deployArgs += '--prod' }
if ($Message)    { $deployArgs += @('--message', $Message) }
if ($site)       { $deployArgs += @('--site', $site) }
if ($token)      { $deployArgs += @('--auth', $token) }

$modo = if ($Draft) { 'BORRADOR (URL temporal)' } else { 'PRODUCCIÓN' }
Write-Host ""
Write-Host "  Gaby's Fashion  ->  Netlify  [$modo]" -ForegroundColor Cyan
Write-Host "  Carpeta: $publish" -ForegroundColor DarkGray
Write-Host ""

Set-Location $root
& $exe @deployArgs
$code = $LASTEXITCODE

if ($code -eq 0) {
  Write-Host ""
  Write-Host "  Deploy completado." -ForegroundColor Green
} else {
  Write-Host ""
  Write-Host "  El deploy falló (código $code)." -ForegroundColor Red
  Write-Host "  Si es la primera vez: ejecutá 'netlify login' y luego este script para crear/enlazar el sitio." -ForegroundColor Yellow
}
exit $code
