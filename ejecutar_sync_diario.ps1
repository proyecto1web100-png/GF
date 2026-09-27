# ============================================================
#  GABY'S FASHION - Lanzador diario de la sincronizacion
#  Lo ejecuta la tarea programada al encender / iniciar sesion.
#  Regla: solo corre UNA vez por dia (la primera vez del dia).
# ============================================================

$base    = $PSScriptRoot
$stamp   = Join-Path $base "ultima_sync_diaria.txt"
$logFile = Join-Path $base "sync_diario_log.txt"

function Write-DiarioLog($msg) {
    $line = (Get-Date -Format "yyyy-MM-dd HH:mm:ss") + " - " + $msg
    Write-Host $line
    Add-Content -Path $logFile -Value $line
}

$hoy = Get-Date -Format "yyyy-MM-dd"

# 1) Si ya se corrio hoy, no hacer nada
if (Test-Path $stamp) {
    $ultima = (Get-Content $stamp -TotalCount 1)
    if ($ultima) { $ultima = $ultima.Trim() }
    if ($ultima -eq $hoy) {
        Write-DiarioLog "Ya se sincronizo hoy ($hoy). Se omite esta ejecucion."
        exit 0
    }
}

# 2) Localizar el script de sincronizacion
$candidatos = @(
    (Join-Path $base "sincronizar_inventario.ps1"),
    (Join-Path $base "sincronizar_inventario (1).ps1")
)
$script = $null
foreach ($c in $candidatos) { if (Test-Path -LiteralPath $c) { $script = $c; break } }

if (-not $script) {
    Write-DiarioLog "ERROR: no se encontro sincronizar_inventario.ps1 en $base"
    exit 1
}

# 3) Ejecutar la sincronizacion
Write-DiarioLog ("Iniciando sincronizacion diaria con: " + [IO.Path]::GetFileName($script))
$exit = 0
try {
    & $script
    $exit = $LASTEXITCODE
    if ($null -eq $exit) { $exit = 0 }
} catch {
    Write-DiarioLog ("ERROR al ejecutar la sincronizacion: " + $_)
    $exit = 1
}

# 4) Marcar el dia solo si termino bien.
#    Si fallo, se volvera a intentar en el siguiente encendido.
if ($exit -eq 0) {
    Set-Content -Path $stamp -Value $hoy -Encoding ASCII
    Write-DiarioLog "Sincronizacion diaria completada. Marcada la fecha $hoy."
} else {
    Write-DiarioLog ("La sincronizacion termino con codigo " + $exit + ". No se marca el dia; se reintentara en el proximo encendido.")
}

exit $exit
