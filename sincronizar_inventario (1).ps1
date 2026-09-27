# Gaby's Fashion - Script de Sincronizacion
# Microsoft Dynamics RMS -> Google Sheets
# Se ejecuta cada 2 horas automaticamente

# Forzar TLS 1.2 para las APIs de Google (PowerShell 5.1 no lo activa por defecto)
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

# CONFIGURACION
$SQL_SERVER   = "192.168.100.3"
$SQL_DATABASE = "GABY"
$SQL_USER     = ""
$SQL_PASS     = ""

$WEB_APP_URL = "https://script.google.com/macros/s/AKfycbyzvQUSWAvkmnmDHO_MoviiSekTV7yyO5ueYt_JlDpLUiFJEUD2bpyAZx0pyPnf0A/exec"
$LOG_FILE    = "$PSScriptRoot\sync_log.txt"

# Google Sheets API directa (para crear hojas/columnas automaticamente)
$SHEET_ID             = "1V2p26r-2bUhQOH2_VOBVJ15V-qKrp_MQmPrJ-TZZBDw"
$SERVICE_ACCOUNT_JSON = "$PSScriptRoot\light-relic-496921-n3-8abbc5810591.json"

# Archivo PRIVADO: cuentas por cobrar, abonos y credenciales de los clientes.
# Va aparte porque $SHEET_ID esta compartido como "cualquiera con el enlace"
# y el ID aparece en el codigo fuente de la pagina: todo lo que este ahi
# es publico. Este segundo archivo NO se comparte con nadie mas que la
# cuenta de servicio del sync.
# Se crea ejecutando crearHojaPrivada() en el Apps Script; pegar aqui el ID.
$PRIVATE_SHEET_ID     = "19aBoaT5zoAqO5ytzxtKVUDFn69E5xy5YgttNa1k0rMw"

# TOKEN — se carga desde config.ps1 (archivo separado, no compartir)
$configFile = "$PSScriptRoot\config.ps1"
if (Test-Path $configFile) {
    . $configFile
}
$SYNC_TOKEN = $env:GABYS_SYNC_TOKEN
if (-not $SYNC_TOKEN) {
    Write-Host "ERROR: No se encontro el token en config.ps1 ni en variables de entorno." -ForegroundColor Red
    exit 1
}

# Contador de fallos reales. Si termina en algo distinto de 0, el script sale
# con codigo 1 para que la tarea diaria NO marque el dia como sincronizado.
$script:SyncErrores = 0

# Enviar JSON como bytes UTF-8 para preservar caracteres especiales (ñ, á, etc.)
function Send-Json($url, $body) {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
    try {
        $resp = Invoke-RestMethod -Uri $url -Method Post -Body $bytes -ContentType "application/json; charset=utf-8"
        if ($resp -and $resp.error) {
            # Esto NO es un aviso: el Apps Script rechazo la escritura.
            Write-Log ("ERROR Apps Script: " + $resp.error)
            $script:SyncErrores++
        }
        return $resp
    } catch {
        Write-Log ("ERROR en Send-Json: " + $_)
        $script:SyncErrores++
        throw
    }
}

# IMPORTANTE: este archivo lo ejecuta powershell.exe (5.1), que lee los .ps1
# sin BOM como ANSI. Una "ñ" escrita tal cual en el codigo llega como "Ã±".
# Por eso en el codigo (no en comentarios) los acentos van con [char]0x00F1.

# Repara texto que quedo con la tipografia rota: "NiÃ±a" -> "Niña".
# Pasa cuando un texto UTF-8 se leyo como Windows-1252. Si el texto no es de
# ese tipo (o ya esta bien) se devuelve igual.
$script:Cp1252 = $null
try {
    $script:Cp1252 = [Text.Encoding]::GetEncoding(1252, [Text.EncoderFallback]::ExceptionFallback, [Text.DecoderFallback]::ExceptionFallback)
} catch { }
$script:Utf8Strict = New-Object System.Text.UTF8Encoding($false, $true)
function Repair-Texto([string]$s) {
    if ([string]::IsNullOrEmpty($s) -or -not $script:Cp1252) { return $s }
    for ($v = 0; $v -lt 2; $v++) {
        if ($s -cnotmatch '[\u00C2-\u00C5][\u0080-\u00BF\u0152-\u2122]') { break }
        try {
            $r = $script:Utf8Strict.GetString($script:Cp1252.GetBytes($s))
        } catch { break }
        if ($r -ceq $s) { break }
        $s = $r
    }
    return $s
}

function Write-Log($msg) {
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "$timestamp - $msg"
    Write-Host $line
    Add-Content -Path $LOG_FILE -Value $line
}

# ════════════════════════════════════════════════════════════
#  GOOGLE SHEETS API - crear hojas y columnas automaticamente
#  (usa el service account gabys-sync@... via JWT RS256)
# ════════════════════════════════════════════════════════════
function ConvertTo-Base64Url([byte[]]$bytes) {
    [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

# Obtiene un access_token de Google firmando un JWT con la llave del service account
function Get-GoogleAccessToken($saPath, $scope) {
    $sa  = Get-Content $saPath -Raw | ConvertFrom-Json
    $now = [int][DateTimeOffset]::UtcNow.ToUnixTimeSeconds()

    $header = @{ alg = 'RS256'; typ = 'JWT' } | ConvertTo-Json -Compress
    $claim  = @{ iss = $sa.client_email; scope = $scope; aud = $sa.token_uri; exp = ($now + 3600); iat = $now } | ConvertTo-Json -Compress

    $hB = ConvertTo-Base64Url ([Text.Encoding]::UTF8.GetBytes($header))
    $cB = ConvertTo-Base64Url ([Text.Encoding]::UTF8.GetBytes($claim))
    $toSign = "$hB.$cB"

    $pem = ($sa.private_key -replace '-----BEGIN PRIVATE KEY-----', '' -replace '-----END PRIVATE KEY-----', '' -replace '\s', '')
    $der = [Convert]::FromBase64String($pem)
    $cng = [System.Security.Cryptography.CngKey]::Import($der, [System.Security.Cryptography.CngKeyBlobFormat]::Pkcs8PrivateBlob)
    $rsa = New-Object System.Security.Cryptography.RSACng($cng)
    $sig = $rsa.SignData([Text.Encoding]::UTF8.GetBytes($toSign), [System.Security.Cryptography.HashAlgorithmName]::SHA256, [System.Security.Cryptography.RSASignaturePadding]::Pkcs1)

    $jwt  = "$toSign." + (ConvertTo-Base64Url $sig)
    $resp = Invoke-RestMethod -Uri $sa.token_uri -Method Post -Body @{
        grant_type = 'urn:ietf:params:oauth:grant-type:jwt-bearer'
        assertion  = $jwt
    }
    return $resp.access_token
}

# Crea la hoja (pestania) si no existe. No escribe nada.
function Ensure-SheetExists($token, $sheetId, $title) {
    $authHdr = @{ Authorization = "Bearer $token" }
    $meta = Invoke-RestMethod -Method Get -Headers $authHdr `
        -Uri "https://sheets.googleapis.com/v4/spreadsheets/$sheetId`?fields=sheets.properties.title"
    foreach ($s in $meta.sheets) { if ($s.properties.title -eq $title) { return } }
    $addBody = @{ requests = @(@{ addSheet = @{ properties = @{ title = $title } } }) } | ConvertTo-Json -Depth 6
    Invoke-RestMethod -Method Post -Headers $authHdr -ContentType "application/json; charset=utf-8" `
        -Uri "https://sheets.googleapis.com/v4/spreadsheets/$sheetId`:batchUpdate" -Body $addBody | Out-Null
    Write-Log "Hoja '$title' creada."
}

# Borra el contenido de la hoja y escribe $values (arreglo de filas, la primera son encabezados).
function Set-SheetValues($token, $sheetId, $title, $values) {
    $authHdr = @{ Authorization = "Bearer $token" }
    $clr = [Uri]::EscapeDataString($title)
    Invoke-RestMethod -Method Post -Headers $authHdr -ContentType "application/json; charset=utf-8" `
        -Uri "https://sheets.googleapis.com/v4/spreadsheets/$sheetId/values/$clr`:clear" -Body '{}' | Out-Null
    $body  = @{ values = $values } | ConvertTo-Json -Depth 6
    $range = [Uri]::EscapeDataString("$title!A1")
    Invoke-RestMethod -Method Put -Headers $authHdr -ContentType "application/json; charset=utf-8" `
        -Uri "https://sheets.googleapis.com/v4/spreadsheets/$sheetId/values/$range`?valueInputOption=RAW" -Body $body | Out-Null
}

# Jala el fiado (cuentas por cobrar) desde RMS y lo escribe en Google Sheets.
#   credito_total   = Customer.CreditLimit
#   saldo_pendiente = Customer.AccountBalance
#   abonos          = pagos en AccountReceivableHistory (HistoryType = 2), agrupados por PaymentID
function Sync-CuentasPorCobrar($connStr) {
    if (-not (Test-Path $SERVICE_ACCOUNT_JSON)) {
        Write-Log "Aviso: no se encontro el service account JSON - se omite Cuentas por Cobrar."
        return
    }
    try {
        # 1) Clientes con saldo pendiente
        $qCli = @"
SELECT c.ID,
  -- El nombre real esta en FirstName/LastName. En esta tienda Company se usa
  -- como referencia ("Esposo Paty", "VIVERO LIMA"), no como razon social, asi
  -- que solo se usa cuando no hay nombre de persona.
  LTRIM(RTRIM(CASE WHEN LTRIM(RTRIM(ISNULL(c.FirstName,'') + ' ' + ISNULL(c.LastName,''))) <> ''
                   THEN ISNULL(c.FirstName,'') + ' ' + ISNULL(c.LastName,'')
                   ELSE ISNULL(c.Company,'') END)) AS nombre,
  ISNULL(c.PhoneNumber,'')   AS telefono,
  ISNULL(c.CreditLimit,0)    AS credito_total,
  ISNULL(c.AccountBalance,0) AS saldo_pendiente
FROM Customer c
WHERE c.AccountBalance > 0
ORDER BY c.AccountBalance DESC
"@
        # 2) Abonos (pagos): HistoryType = 2, agrupados por PaymentID (un pago puede repartirse en varias facturas)
        $qAb = @"
SELECT ar.CustomerID,
       CONVERT(varchar(10), MAX(h.Date), 23) AS fecha,
       ABS(SUM(h.Amount)) AS monto
FROM AccountReceivableHistory h
JOIN AccountReceivable ar ON h.AccountReceivableID = ar.ID
WHERE h.HistoryType = 2
GROUP BY ar.CustomerID, h.PaymentID
HAVING ABS(SUM(h.Amount)) > 0
"@
        $cli = Invoke-Query $connStr $qCli
        $ab  = Invoke-Query $connStr $qAb

        # Mapa CustomerID -> lista de abonos
        $abMap = @{}
        foreach ($a in $ab) {
            $k = [string]$a["CustomerID"]
            if (-not $abMap.ContainsKey($k)) { $abMap[$k] = New-Object System.Collections.Generic.List[object] }
            $abMap[$k].Add([pscustomobject]@{ monto = [math]::Round([decimal]$a["monto"], 2); fecha = [string]$a["fecha"] })
        }

        # Construir filas (encabezados primero)
        $ccVals = New-Object System.Collections.Generic.List[object]
        $ccVals.Add(@('nombre','telefono','credito_total','saldo_pendiente','ultimo_abono','fecha_ultimo_abono'))
        $abVals = New-Object System.Collections.Generic.List[object]
        $abVals.Add(@('nombre','telefono','monto','fecha'))

        foreach ($c in $cli) {
            $id      = [string]$c["ID"]
            $nombre  = [string]$c["nombre"]
            $tel     = [string]$c["telefono"]
            $credito = [math]::Round([decimal]$c["credito_total"], 2)
            $saldo   = [math]::Round([decimal]$c["saldo_pendiente"], 2)

            $ultMonto = ''
            $ultFecha = ''
            if ($abMap.ContainsKey($id)) {
                $sorted   = @($abMap[$id] | Sort-Object fecha -Descending)
                $ultMonto = $sorted[0].monto
                $ultFecha = $sorted[0].fecha
                foreach ($t in ($sorted | Select-Object -First 5)) {
                    $abVals.Add(@($nombre, $tel, $t.monto, $t.fecha))
                }
            }
            $ccVals.Add(@($nombre, $tel, $credito, $saldo, $ultMonto, $ultFecha))
        }

        # Escribir a Google Sheets (SIEMPRE al archivo privado: son datos
        # personales de clientes, no pueden vivir en la hoja publica)
        if ($PRIVATE_SHEET_ID -eq "PEGAR_AQUI_EL_ID" -or [string]::IsNullOrWhiteSpace($PRIVATE_SHEET_ID)) {
            Write-Log "OMITIDO: Cuentas por Cobrar no se sincronizo porque falta configurar PRIVATE_SHEET_ID."
            Write-Log "         Ejecutar crearHojaPrivada() en el Apps Script y pegar el ID en este script."
            return
        }

        $token = Get-GoogleAccessToken $SERVICE_ACCOUNT_JSON 'https://www.googleapis.com/auth/spreadsheets'
        Ensure-SheetExists $token $PRIVATE_SHEET_ID 'CuentasPorCobrar'
        Ensure-SheetExists $token $PRIVATE_SHEET_ID 'Abonos'
        Set-SheetValues $token $PRIVATE_SHEET_ID 'CuentasPorCobrar' $ccVals
        Set-SheetValues $token $PRIVATE_SHEET_ID 'Abonos'           $abVals

        Write-Log ("Cuentas por Cobrar sincronizadas desde RMS: " + ($ccVals.Count - 1) + " clientes, " + ($abVals.Count - 1) + " abonos.")
    } catch {
        Write-Log ("ERROR al sincronizar Cuentas por Cobrar: " + $_)
        $script:SyncErrores++
    }
}

# Construye la cadena de conexion segun si hay usuario SQL o no
function Get-ConnStr {
    if ($SQL_USER -ne "") {
        return "Server=$SQL_SERVER;Database=$SQL_DATABASE;User Id=$SQL_USER;Password=$SQL_PASS;"
    }
    return "Server=$SQL_SERVER;Database=$SQL_DATABASE;Integrated Security=True;"
}

# Ejecuta una query y devuelve lista de filas como hashtables
function Invoke-Query($connStr, $query) {
    $conn = New-Object System.Data.SqlClient.SqlConnection($connStr)
    $conn.Open()
    $rows = [System.Collections.Generic.List[hashtable]]::new()
    try {
        $cmd    = New-Object System.Data.SqlClient.SqlCommand($query, $conn)
        $reader = $cmd.ExecuteReader()
        try {
            $cols = @(0..($reader.FieldCount - 1) | ForEach-Object { $reader.GetName($_) })
            while ($reader.Read()) {
                $row = @{}
                foreach ($col in $cols) { $row[$col] = $reader[$col] }
                $rows.Add($row)
            }
        } finally {
            $reader.Close()
        }
    } finally {
        $conn.Close()
    }
    return ,$rows
}

Write-Log "Iniciando sincronizacion..."

$connStr = Get-ConnStr

# 1. LEER PRODUCTOS DESDE SQL SERVER
$queryProductos = @"
-- Un mismo producto puede estar cargado con varios codigos y precios distintos.
-- Se elige un codigo VIGENTE por producto y de ahi sale el precio publicado:
--   1) primero los que tienen existencia,
--   2) entre esos, el de ingreso mas reciente.
-- Si ninguno tiene existencia, gana igual el de ingreso mas reciente.
-- Antes se usaba MAX(Price) y la web publicaba el precio del codigo agotado,
-- casi siempre mas caro que el articulo que de verdad estaba en la tienda.
WITH base AS (
    SELECT i.Description,
           i.Price,
           i.DepartmentID,
           (i.Quantity - ISNULL(i.QuantityCommitted, 0)) AS disponible,
           ROW_NUMBER() OVER (
               PARTITION BY i.Description
               ORDER BY CASE WHEN (i.Quantity - ISNULL(i.QuantityCommitted, 0)) > 0 THEN 0 ELSE 1 END,
                        i.LastReceived DESC,
                        i.ID DESC
           ) AS vigente
    FROM Item i
    WHERE i.Inactive = 0
)
SELECT
    b.Description                                  AS nombre,
    MAX(CASE WHEN b.vigente = 1 THEN b.Price END)  AS precio,
    ISNULL(MAX(d.Name), '')                        AS categoria,
    -- En repetidos: ignora los que tienen cantidad 0, suma solo los que tienen cantidad > 0
    CAST(ROUND(SUM(CASE WHEN b.disponible > 0 THEN b.disponible ELSE 0 END), 0) AS INT) AS cantidad
FROM base b
LEFT JOIN Department d ON b.DepartmentID = d.ID
GROUP BY b.Description
ORDER BY MAX(d.Name), b.Description
"@

try {
    $filas = Invoke-Query $connStr $queryProductos

$products = [System.Collections.Generic.List[object]]::new()
    $porNombre = @{}
    $nombresReparados = 0
    $juntados = 0
    foreach ($row in $filas) {
        $cantVal = $row["cantidad"]
        $cant = if ($cantVal -eq [System.DBNull]::Value -or $null -eq $cantVal) { 0 } else { [int]$cantVal }

        $cat = Repair-Texto ([string]$row["categoria"])
        # Si la categoria es una variante corrupta de "Ropa Niñ@s", corregirla.
        # Antes aqui estaba la "ñ" escrita tal cual y PowerShell 5.1 la leia
        # como "Ã±": cada sync le ponia "Ropa NiÃ±@s" a todos esos productos.
        $ninas = "Ropa Ni$([char]0x00F1)@s"
        if ($cat -match '^Ropa Ni.+@s$' -and $cat -cne $ninas) {
            $cat = $ninas
        }

        $nombreOriginal = [string]$row["nombre"]
        $nombre = (Repair-Texto $nombreOriginal).Trim()
        if ($nombre -cne $nombreOriginal.Trim()) { $nombresReparados++ }
        if ($nombre -eq '') { continue }
        $precio = if ($row["precio"] -eq [System.DBNull]::Value) { 0 } else { $row["precio"] }

        # Si RMS tiene el mismo articulo con el nombre bueno y con el dañado,
        # se juntan en uno solo (si no, la hoja tendria los dos).
        $clave = $nombre.ToLowerInvariant()
        if ($porNombre.ContainsKey($clave)) {
            $prev = $porNombre[$clave]
            if ($prev.cantidad -le 0 -and $cant -gt 0) { $prev.precio = "L. " + [math]::Round($precio, 2) }
            $prev.cantidad += $cant
            if (-not $prev.categoria) { $prev.categoria = $cat }
            $juntados++
            continue
        }

        $p = [PSCustomObject]@{
            nombre    = $nombre
            precio    = "L. " + [math]::Round($precio, 2)
            categoria = $cat
            cantidad  = $cant
        }
        $porNombre[$clave] = $p
        $products.Add($p)
    }
    Write-Log ("Productos leidos desde RMS: " + $products.Count)
    if ($nombresReparados -gt 0) {
        Write-Log ("AVISO: " + $nombresReparados + " nombres venian con la tipografia rota desde RMS y se corrigieron al enviar (" + $juntados + " eran repetidos del nombre bueno). Conviene corregirlos tambien en RMS.")
    }

    # DEBUG: mostrar productos sin categoria
    $sinCat = $products | Where-Object { $_.categoria -eq '' }
    Write-Log ("DEBUG: Productos sin categoria: " + $sinCat.Count)
    $sinCat | Select-Object -First 5 | ForEach-Object {
        Write-Log ("  SIN CAT: [" + $_.nombre + "]")
    }
} catch {
    Write-Log ("ERROR al leer SQL Server: " + $_)
    exit 1
}

if ($products.Count -eq 0) {
    Write-Log "No se encontraron productos activos. Sincronizacion cancelada."
    exit 0
}

# 2. ENVIAR AL APPS SCRIPT EN BLOQUES DE 500
try {
    Write-Log "Enviando productos a Google Sheets..."

    $blockSize = 500
    $total     = $products.Count
    $sent      = 0

    for ($i = 0; $i -lt $total; $i += $blockSize) {
        $end   = [math]::Min($i + $blockSize - 1, $total - 1)
        $block = $products.GetRange($i, $end - $i + 1)

        $body = @{
            token    = $SYNC_TOKEN
            products = $block
            clear    = ($i -eq 0)
        } | ConvertTo-Json -Depth 5

        Send-Json $WEB_APP_URL $body | Out-Null
        $sent += $block.Count
        Write-Log ("Enviados: " + $sent + " de " + $total)
    }

    Write-Log ("Google Sheet actualizado con " + $total + " productos.")
} catch {
    Write-Log ("ERROR al enviar a Google Sheets: " + $_)
    exit 1
}

Write-Log "Productos enviados (falta verificar que la hoja los haya aceptado)."

# 2b. LIMPIAR LA HOJA
# La hoja solo agrega o actualiza por nombre: lo que ya no viene de RMS se
# quedaba para siempre. Asi quedaron repetidos los articulos que se habian
# guardado con la tipografia rota ("NiÃ±a") cuando empezo a llegar el nombre
# bueno. Con la lista completa, el Apps Script quita las filas que no estan
# en RMS (las copia antes a la hoja ProductosEliminados).
# Solo se llega aqui si TODOS los bloques se enviaron bien.
try {
    $finBody = @{
        token   = $SYNC_TOKEN
        type    = "productos_fin"
        nombres = @($products | ForEach-Object { $_.nombre })
    } | ConvertTo-Json -Depth 3
    $resp = Send-Json $WEB_APP_URL $finBody
    if ($resp -and $resp.msg -and ([string]$resp.msg).StartsWith('tipo desconocido')) {
        Write-Log "AVISO: el Apps Script publicado aun no tiene la limpieza de repetidos. Pegar el Codigo.gs nuevo y crear una nueva implementacion."
    } elseif ($resp -and $resp.msg) {
        Write-Log ("Hoja de productos: " + $resp.msg)
    }
} catch {
    Write-Log ("ERROR al limpiar productos repetidos: " + $_)
    $script:SyncErrores++
}

# 3. GUARDAR FECHA DE ULTIMA SINCRONIZACION
$stampEnviado = Get-Date
try {
    $syncBody = @{
        token  = $SYNC_TOKEN
        type   = "config"
        config = @{ lastSync = ($stampEnviado.ToString("yyyy-MM-ddTHH:mm:ss")) }
    } | ConvertTo-Json -Depth 3
    Send-Json $WEB_APP_URL $syncBody | Out-Null
    Write-Log "Fecha de sincronizacion guardada en Sheets."
} catch {
    Write-Log ("ERROR: no se pudo guardar fecha de sync: " + $_)
    $script:SyncErrores++
}


# ════════════════════════════════════════════════════════════
#  CUENTAS POR COBRAR - jala el fiado desde RMS y lo escribe en Sheets
# ════════════════════════════════════════════════════════════
Write-Log "Sincronizando Cuentas por Cobrar desde RMS..."

# Ultimas compras de cada cliente con saldo, para que las vea en su cuenta
# en la pagina. Va al archivo PRIVADO: es historial de compras de personas.
function Sync-Compras($connStr) {
    if (-not (Test-Path $SERVICE_ACCOUNT_JSON)) {
        Write-Log "Aviso: no se encontro el service account JSON - se omite Compras."
        return
    }
    if ($PRIVATE_SHEET_ID -eq "PEGAR_AQUI_EL_ID" -or [string]::IsNullOrWhiteSpace($PRIVATE_SHEET_ID)) {
        Write-Log "OMITIDO: Compras no se sincronizo porque falta PRIVATE_SHEET_ID."
        return
    }
    try {
        # Las 10 ultimas compras de cada cliente que debe algo. ROW_NUMBER
        # numera por cliente de la mas nueva a la mas vieja y se cortan las 10.
        $q = @"
-- TODO cliente con telefono, no solo los que deben: hay ~264 que compran
-- de contado y tambien quieren ver su historial en la pagina.
WITH ultimas AS (
  SELECT t.CustomerID, t.TransactionNumber, t.StoreID, t.Time, t.Total,
         ROW_NUMBER() OVER (PARTITION BY t.CustomerID ORDER BY t.Time DESC) AS nro
  FROM [Transaction] t
  JOIN Customer cc ON cc.ID = t.CustomerID
  WHERE LTRIM(RTRIM(ISNULL(cc.PhoneNumber,''))) <> ''
)
SELECT
  LTRIM(RTRIM(CASE WHEN LTRIM(RTRIM(ISNULL(c.FirstName,'') + ' ' + ISNULL(c.LastName,''))) <> ''
                   THEN ISNULL(c.FirstName,'') + ' ' + ISNULL(c.LastName,'')
                   ELSE ISNULL(c.Company,'') END)) AS nombre,
  ISNULL(c.PhoneNumber,'') AS telefono,
  CONVERT(varchar(10), u.Time, 23) AS fecha,
  u.Total AS total,
  (SELECT COUNT(*) FROM TransactionEntry te
    WHERE te.TransactionNumber = u.TransactionNumber AND te.StoreID = u.StoreID) AS articulos,
  STUFF((SELECT TOP 3 ', ' + i.Description
         FROM TransactionEntry te JOIN Item i ON i.ID = te.ItemID
         WHERE te.TransactionNumber = u.TransactionNumber AND te.StoreID = u.StoreID
         FOR XML PATH('')), 1, 2, '') AS detalle
FROM ultimas u
JOIN Customer c ON c.ID = u.CustomerID
WHERE u.nro <= 10
ORDER BY u.CustomerID, u.Time DESC
"@
        $rows = Invoke-Query $connStr $q

        $vals = New-Object System.Collections.Generic.List[object]
        $vals.Add(@('nombre','telefono','fecha','total','articulos','detalle'))
        foreach ($r in $rows) {
            $det = [string]$r.detalle
            if ($det.Length -gt 90) { $det = $det.Substring(0, 90) + "..." }
            $vals.Add(@([string]$r.nombre, [string]$r.telefono, [string]$r.fecha,
                        [double]$r.total, [int]$r.articulos, $det))
        }

        $token = Get-GoogleAccessToken $SERVICE_ACCOUNT_JSON 'https://www.googleapis.com/auth/spreadsheets'
        Ensure-SheetExists $token $PRIVATE_SHEET_ID 'Compras'
        Set-SheetValues $token $PRIVATE_SHEET_ID 'Compras' $vals

        Write-Log ("Compras sincronizadas desde RMS: " + ($vals.Count - 1) + " transacciones.")
    } catch {
        Write-Log ("ERROR al sincronizar Compras: " + $_)
        $script:SyncErrores++
    }
}

Sync-CuentasPorCobrar $connStr

# Todos los articulos que compro alguna vez cada cliente con saldo.
# Sirve para la verificacion de la pagina: los senuelos que se le muestran
# tienen que ser cosas que ESE cliente nunca compro, o la pregunta se cae.
function Sync-ComprasItems($connStr) {
    if (-not (Test-Path $SERVICE_ACCOUNT_JSON)) { return }
    if ($PRIVATE_SHEET_ID -eq "PEGAR_AQUI_EL_ID" -or [string]::IsNullOrWhiteSpace($PRIVATE_SHEET_ID)) {
        Write-Log "OMITIDO: ComprasItems no se sincronizo porque falta PRIVATE_SHEET_ID."
        return
    }
    try {
        $q = @"
SELECT DISTINCT
  ISNULL(c.PhoneNumber,'') AS telefono,
  LTRIM(RTRIM(i.Description)) AS articulo
FROM [Transaction] t
JOIN TransactionEntry te ON te.TransactionNumber = t.TransactionNumber AND te.StoreID = t.StoreID
JOIN Item i ON i.ID = te.ItemID
JOIN Customer c ON c.ID = t.CustomerID
WHERE c.AccountBalance > 0
  AND LTRIM(RTRIM(ISNULL(i.Description,''))) <> ''
"@
        $rows = Invoke-Query $connStr $q

        $vals = New-Object System.Collections.Generic.List[object]
        $vals.Add(@('telefono','articulo'))
        foreach ($r in $rows) {
            $a = [string]$r.articulo
            if ($a.Length -gt 60) { $a = $a.Substring(0, 60) }
            $vals.Add(@([string]$r.telefono, $a))
        }

        $token = Get-GoogleAccessToken $SERVICE_ACCOUNT_JSON 'https://www.googleapis.com/auth/spreadsheets'
        Ensure-SheetExists $token $PRIVATE_SHEET_ID 'ComprasItems'
        Set-SheetValues $token $PRIVATE_SHEET_ID 'ComprasItems' $vals

        Write-Log ("Articulos por cliente sincronizados: " + ($vals.Count - 1) + " pares.")
    } catch {
        Write-Log ("ERROR al sincronizar ComprasItems: " + $_)
        $script:SyncErrores++
    }
}
Sync-Compras $connStr
Sync-ComprasItems $connStr


# ════════════════════════════════════════════════════════════
#  SINCRONIZAR VENTAS — SQL Server → Google Sheets
# ════════════════════════════════════════════════════════════
Write-Log "Sincronizando datos de ventas..."

try {
    $qVentasDia = @"
SELECT
    CONVERT(varchar(10), t.Time, 120) AS fecha,
    COUNT(*)                           AS num_transacciones,
    SUM(CASE WHEN t.Total > 0 THEN t.Total ELSE 0 END) AS total_ventas,
    SUM(CASE WHEN t.Total < 0 THEN ABS(t.Total) ELSE 0 END) AS total_devoluciones
FROM [Transaction] t
WHERE t.Time >= DATEADD(year, -2, GETDATE())
  AND t.RecallType = 0
GROUP BY CONVERT(varchar(10), t.Time, 120)
ORDER BY fecha DESC
"@

    $qTopProductos = @"
SELECT TOP 20
    i.Description AS nombre,
    d.Name        AS categoria,
    SUM(te.Quantity) AS cantidad_vendida,
    SUM(te.Price * te.Quantity) AS total_vendido,
    COUNT(DISTINCT te.TransactionNumber) AS num_transacciones
FROM TransactionEntry te
JOIN [Transaction] t ON te.TransactionNumber = t.TransactionNumber
JOIN Item i ON te.ItemID = i.ID
LEFT JOIN Department d ON i.DepartmentID = d.ID
WHERE t.Time >= DATEADD(year, -2, GETDATE())
  AND t.RecallType = 0
  AND te.Quantity > 0
GROUP BY i.Description, d.Name
ORDER BY cantidad_vendida DESC
"@

    $qCategorias = @"
SELECT
    d.Name AS categoria,
    SUM(te.Quantity) AS cantidad_vendida,
    SUM(te.Price * te.Quantity) AS total_vendido
FROM TransactionEntry te
JOIN [Transaction] t ON te.TransactionNumber = t.TransactionNumber
JOIN Item i ON te.ItemID = i.ID
LEFT JOIN Department d ON i.DepartmentID = d.ID
WHERE t.Time >= DATEADD(year, -2, GETDATE())
  AND t.RecallType = 0
  AND te.Quantity > 0
GROUP BY d.Name
ORDER BY total_vendido DESC
"@

    $qResumen = @"
SELECT
    COUNT(DISTINCT CASE WHEN RecallType=0 AND Total>0 THEN TransactionNumber END) AS total_ventas,
    SUM(CASE WHEN RecallType=0 AND Total>0 THEN Total ELSE 0 END)                 AS monto_total,
    COUNT(DISTINCT CASE WHEN RecallType=0 AND Total>0 AND Time >= DATEADD(month, DATEDIFF(month,0,GETDATE()), 0) THEN TransactionNumber END) AS ventas_mes,
    SUM(CASE WHEN RecallType=0 AND Total>0 AND Time >= DATEADD(month, DATEDIFF(month,0,GETDATE()), 0) THEN Total ELSE 0 END) AS monto_mes,
    COUNT(DISTINCT CASE WHEN RecallType=0 AND Total>0 AND Time >= DATEADD(day, 1-DATEPART(dw, GETDATE()), CAST(GETDATE() AS DATE)) THEN TransactionNumber END)  AS ventas_semana,
    SUM(CASE WHEN RecallType=0 AND Total>0 AND Time >= DATEADD(day, 1-DATEPART(dw, GETDATE()), CAST(GETDATE() AS DATE)) THEN Total ELSE 0 END)  AS monto_semana
FROM [Transaction]
"@

    # Ejecutar las 4 queries (la conexion se abre y cierra en cada llamada)
    $fVentasDia    = Invoke-Query $connStr $qVentasDia
    $fTopProductos = Invoke-Query $connStr $qTopProductos
    $fCategorias   = Invoke-Query $connStr $qCategorias
    $fResumen      = Invoke-Query $connStr $qResumen

    $ventasDia = [System.Collections.Generic.List[object]]::new()
    foreach ($r in $fVentasDia) {
        $ventasDia.Add([PSCustomObject]@{
            fecha             = $r["fecha"]
            num_transacciones = $r["num_transacciones"]
            total_ventas      = [math]::Round($r["total_ventas"], 2)
            total_devoluciones= [math]::Round($r["total_devoluciones"], 2)
        })
    }

    $topProductos = [System.Collections.Generic.List[object]]::new()
    foreach ($r in $fTopProductos) {
        $topProductos.Add([PSCustomObject]@{
            nombre            = $r["nombre"]
            categoria         = $r["categoria"]
            cantidad_vendida  = $r["cantidad_vendida"]
            total_vendido     = [math]::Round($r["total_vendido"], 2)
            num_transacciones = $r["num_transacciones"]
        })
    }

    $ventasCat = [System.Collections.Generic.List[object]]::new()
    foreach ($r in $fCategorias) {
        $ventasCat.Add([PSCustomObject]@{
            categoria        = $r["categoria"]
            cantidad_vendida = $r["cantidad_vendida"]
            total_vendido    = [math]::Round($r["total_vendido"], 2)
        })
    }

    $resumen = @{}
    if ($fResumen.Count -gt 0) {
        $r = $fResumen[0]
        $resumen = @{
            total_ventas  = $r["total_ventas"]
            monto_total   = [math]::Round($r["monto_total"], 2)
            ventas_mes    = $r["ventas_mes"]
            monto_mes     = [math]::Round($r["monto_mes"], 2)
            ventas_semana = $r["ventas_semana"]
            monto_semana  = [math]::Round($r["monto_semana"], 2)
        }
    }

    Write-Log ("Ventas leidas: " + $ventasDia.Count + " dias, " + $topProductos.Count + " top productos")

    $ventasBody = @{
        token        = $SYNC_TOKEN
        type         = "ventas"
        ventasDia    = $ventasDia
        topProductos = $topProductos
        ventasCat    = $ventasCat
        resumen      = $resumen
    } | ConvertTo-Json -Depth 5

    Send-Json $WEB_APP_URL $ventasBody | Out-Null
    Write-Log "Datos de ventas enviados a Sheets correctamente."

} catch {
    Write-Log ("ERROR al sincronizar ventas: " + $_)
    $script:SyncErrores++
}


# ============================================================
#  VERIFICACION FINAL
#  No basta con que el Apps Script responda "ok": si el Drive
#  esta lleno la hoja queda en solo lectura y la escritura se
#  descarta DESPUES de haber respondido. Por eso se vuelve a
#  leer lastSync desde la hoja y se compara con lo que se envio.
# ============================================================

# Devuelve la fecha guardada en la pestania Config, o $null si no se pudo leer.
function Get-LastSyncEnHoja {
    $url = "https://docs.google.com/spreadsheets/d/$SHEET_ID/gviz/tq?tqx=out:json&headers=1&sheet=Config&_=" + [Guid]::NewGuid().ToString()
    $raw = (Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 60).Content
    $ini = $raw.IndexOf('(')
    $fin = $raw.LastIndexOf(')')
    if ($ini -lt 0 -or $fin -le $ini) { return $null }
    $data = $raw.Substring($ini + 1, $fin - $ini - 1) | ConvertFrom-Json

    $valor = $null
    foreach ($row in $data.table.rows) {
        if ($row.c[0] -and $row.c[0].v -eq 'lastSync' -and $row.c[1]) { $valor = [string]$row.c[1].v }
    }
    if (-not $valor) { return $null }

    # gviz puede devolver la celda como texto o como Date(anio,mes,dia,...)
    $m = [regex]::Match($valor, '^Date\((\d+),(\d+),(\d+),(\d+),(\d+),(\d+)\)$')
    if ($m.Success) {
        return New-Object DateTime(
            [int]$m.Groups[1].Value, ([int]$m.Groups[2].Value + 1), [int]$m.Groups[3].Value,
            [int]$m.Groups[4].Value, [int]$m.Groups[5].Value, [int]$m.Groups[6].Value)
    }

    $fecha = [DateTime]::MinValue
    if ([DateTime]::TryParse($valor.Replace('T', ' '), [ref]$fecha)) { return $fecha }
    return $null
}

Write-Log "Verificando que la hoja realmente se haya actualizado..."
try {
    $enHoja = Get-LastSyncEnHoja
    if ($null -eq $enHoja) {
        Write-Log "ERROR de verificacion: no se pudo leer lastSync desde la hoja."
        $script:SyncErrores++
    } else {
        $diff = [math]::Abs(($stampEnviado - $enHoja).TotalMinutes)
        if ($diff -le 10) {
            Write-Log ("Verificado: la hoja tiene lastSync = " + $enHoja.ToString("yyyy-MM-dd HH:mm:ss"))
        } else {
            Write-Log ("ERROR de verificacion: la hoja quedo en " + $enHoja.ToString("yyyy-MM-dd HH:mm:ss") + " y se esperaba " + $stampEnviado.ToString("yyyy-MM-dd HH:mm:ss") + ".")
            Write-Log "  Nada se escribio. Causa mas probable: el Google Drive de la cuenta esta lleno y la hoja quedo en solo lectura."
            $script:SyncErrores++
        }
    }
} catch {
    Write-Log ("ERROR de verificacion: " + $_)
    $script:SyncErrores++
}

if ($script:SyncErrores -gt 0) {
    Write-Log ("SINCRONIZACION FALLIDA: " + $script:SyncErrores + " error(es). El dia NO se marca como sincronizado; se reintentara en el proximo encendido.")
    exit 1
}

Write-Log "Sincronizacion verificada correctamente."
exit 0
