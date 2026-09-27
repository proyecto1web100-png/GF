# ============================================================
#  GABY'S FASHION - Instalador de la tarea "una vez al dia"
#  Ejecutar UNA sola vez. No necesita ser Administrador.
#
#  Que hace:
#    - Crea la tarea "GabysFashion_Sync_Diario"
#    - Se dispara al iniciar sesion en Windows (al encender la PC)
#    - Espera 3 minutos para que haya red y SQL disponible
#    - El lanzador solo sincroniza la PRIMERA vez de cada dia
# ============================================================

$ErrorActionPreference = "Stop"

$taskName   = "GabysFashion_Sync_Diario"
$lanzador   = Join-Path $PSScriptRoot "ejecutar_sync_diario.ps1"

if (-not (Test-Path -LiteralPath $lanzador)) {
    Write-Host "ERROR: no se encontro $lanzador" -ForegroundColor Red
    exit 1
}

# Quitar la tarea vieja de cada 2 horas, si existe
if (Get-ScheduledTask -TaskName "GabysFashion_Sync" -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName "GabysFashion_Sync" -Confirm:$false
    Write-Host "Tarea anterior 'GabysFashion_Sync' (cada 2 horas) eliminada."
}

if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host "Tarea '$taskName' anterior eliminada."
}

$action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $lanzador + '"') `
    -WorkingDirectory $PSScriptRoot

$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERDOMAIN\$env:USERNAME
$trigger.Delay = "PT3M"

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 30) `
    -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 10) `
    -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
    -Settings $settings -Description "Sincroniza RMS -> Google Sheets una sola vez al dia, al encender la PC." | Out-Null

Write-Host ""
Write-Host "Tarea programada creada correctamente." -ForegroundColor Green
Write-Host "   Nombre     : $taskName"
Write-Host "   Disparador : al iniciar sesion (3 minutos despues)"
Write-Host "   Frecuencia : maximo 1 vez por dia (la primera del dia)"
Write-Host "   Lanzador   : $lanzador"
Write-Host ""
Write-Host "Verla en: Programador de tareas de Windows -> Biblioteca -> $taskName"
