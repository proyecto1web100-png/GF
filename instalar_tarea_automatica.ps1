# ============================================================
#  GABY'S FASHION — Instalador de Tarea Automática
#  Ejecuta este script UNA SOLA VEZ como Administrador
#  para programar la sincronización cada 2 horas
# ============================================================

$scriptPath = "$PSScriptRoot\sincronizar_inventario.ps1"
$taskName   = "GabysFashion_Sync"

# Eliminar tarea anterior si existe
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host "Tarea anterior eliminada."
}

# Crear nueva tarea cada 2 horas
$action  = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-ExecutionPolicy Bypass -File `"$scriptPath`""
$trigger = New-ScheduledTaskTrigger -RepetitionInterval (New-TimeSpan -Hours 2) -Once -At (Get-Date)
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 5)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -RunLevel Highest -Force

Write-Host ""
Write-Host "✅ Tarea programada exitosamente." -ForegroundColor Green
Write-Host "   Nombre: $taskName"
Write-Host "   Frecuencia: cada 2 horas"
Write-Host "   Script: $scriptPath"
Write-Host ""
Write-Host "Puedes verla en: Programador de tareas de Windows → $taskName"
