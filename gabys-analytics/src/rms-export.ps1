# ============================================================
#  Gaby's Fashion - Extractor de RMS para el modulo de analitica
#  Lee SOLO datos (ningun INSERT/UPDATE) y escribe cache\datos.json
#  Uso: powershell -ExecutionPolicy Bypass -File rms-export.ps1
# ============================================================

$ErrorActionPreference = "Stop"

$raiz   = Split-Path $PSScriptRoot -Parent
$cfg    = Get-Content (Join-Path $raiz "config.json") -Raw | ConvertFrom-Json
$salida = Join-Path $raiz "cache\datos.json"

if ($cfg.sql.user -ne "") {
    $connStr = "Server=$($cfg.sql.server);Database=$($cfg.sql.database);User Id=$($cfg.sql.user);Password=$($cfg.sql.password);"
} else {
    $connStr = "Server=$($cfg.sql.server);Database=$($cfg.sql.database);Integrated Security=True;"
}

# Ejecuta una consulta y devuelve un arreglo de objetos planos (listos para JSON)
function Invoke-Query($query) {
    $conn = New-Object System.Data.SqlClient.SqlConnection($connStr)
    $conn.Open()
    try {
        $cmd = New-Object System.Data.SqlClient.SqlCommand($query, $conn)
        $cmd.CommandTimeout = 120
        $reader = $cmd.ExecuteReader()
        try {
            $cols  = @(0..($reader.FieldCount - 1) | ForEach-Object { $reader.GetName($_) })
            $filas = New-Object System.Collections.Generic.List[object]
            while ($reader.Read()) {
                $o = [ordered]@{}
                foreach ($c in $cols) {
                    $v = $reader[$c]
                    if ($v -eq [System.DBNull]::Value) { $o[$c] = $null }
                    elseif ($v -is [datetime])         { $o[$c] = $v.ToString("yyyy-MM-dd") }
                    elseif ($v -is [decimal])          { $o[$c] = [double]$v }
                    else                               { $o[$c] = $v }
                }
                $filas.Add([pscustomobject]$o)
            }
            return ,$filas
        } finally { $reader.Close() }
    } finally { $conn.Close() }
}

$genericos = ($cfg.negocio.clientesGenericos -join ',')
if (-not $genericos) { $genericos = '0' }

# ---------- 1. Ventas y margen por anio ----------
$qAnual = @"
SELECT YEAR(t.Time) AS anio,
       SUM(te.Price * te.Quantity) AS venta,
       SUM(te.Cost  * te.Quantity) AS costo,
       SUM(te.Quantity)            AS unidades,
       COUNT(DISTINCT t.TransactionNumber) AS transacciones,
       COUNT(DISTINCT t.CustomerID)        AS clientes
FROM TransactionEntry te
JOIN [Transaction] t ON te.TransactionNumber = t.TransactionNumber
WHERE t.RecallType = 0
GROUP BY YEAR(t.Time)
ORDER BY anio
"@

# ---------- 2. Ventas y margen por mes ----------
$qMensual = @"
SELECT YEAR(t.Time) AS anio, MONTH(t.Time) AS mes,
       SUM(te.Price * te.Quantity) AS venta,
       SUM(te.Cost  * te.Quantity) AS costo,
       COUNT(DISTINCT t.TransactionNumber) AS transacciones
FROM TransactionEntry te
JOIN [Transaction] t ON te.TransactionNumber = t.TransactionNumber
WHERE t.RecallType = 0
GROUP BY YEAR(t.Time), MONTH(t.Time)
ORDER BY anio, mes
"@

# ---------- 3. Mismo periodo del anio (comparable contra anios completos) ----------
$qYTD = @"
DECLARE @doy INT = DATEPART(dayofyear, GETDATE());
SELECT YEAR(t.Time) AS anio,
       SUM(te.Price * te.Quantity) AS venta,
       SUM(te.Cost  * te.Quantity) AS costo,
       COUNT(DISTINCT t.TransactionNumber) AS transacciones,
       COUNT(DISTINCT t.CustomerID)        AS clientes
FROM TransactionEntry te
JOIN [Transaction] t ON te.TransactionNumber = t.TransactionNumber
WHERE t.RecallType = 0 AND DATEPART(dayofyear, t.Time) <= @doy
GROUP BY YEAR(t.Time)
ORDER BY anio
"@

# ---------- 4. Margen por categoria y anio ----------
$qCategorias = @"
SELECT YEAR(t.Time) AS anio,
       ISNULL(d.Name, '(sin categoria)') AS categoria,
       SUM(te.Price * te.Quantity) AS venta,
       SUM(te.Cost  * te.Quantity) AS costo,
       SUM(te.Quantity)            AS unidades
FROM TransactionEntry te
JOIN [Transaction] t ON te.TransactionNumber = t.TransactionNumber
JOIN Item i          ON te.ItemID = i.ID
LEFT JOIN Department d ON i.DepartmentID = d.ID
WHERE t.RecallType = 0 AND t.Time >= DATEADD(year, -3, GETDATE())
GROUP BY YEAR(t.Time), d.Name
ORDER BY anio, venta DESC
"@

# ---------- 5. Productos: stock, rotacion y ventas de los ultimos 12 meses ----------
$qProductos = @"
SELECT i.ID,
       i.Description                     AS nombre,
       ISNULL(d.Name, '(sin categoria)') AS categoria,
       CAST(i.Quantity AS float)         AS stock,
       CAST(i.Cost  AS float)            AS costo_unit,
       CAST(i.Price AS float)            AS precio,
       i.LastSold, i.LastReceived, i.DateCreated,
       ISNULL(v.unidades, 0) AS unidades_12m,
       ISNULL(v.venta, 0)    AS venta_12m,
       ISNULL(v.costo, 0)    AS costo_12m,
       ISNULL(v.trans, 0)    AS trans_12m
FROM Item i
LEFT JOIN Department d ON i.DepartmentID = d.ID
LEFT JOIN (
    SELECT te.ItemID,
           SUM(te.Quantity)            AS unidades,
           SUM(te.Price * te.Quantity) AS venta,
           SUM(te.Cost  * te.Quantity) AS costo,
           COUNT(DISTINCT te.TransactionNumber) AS trans
    FROM TransactionEntry te
    JOIN [Transaction] t ON te.TransactionNumber = t.TransactionNumber
    WHERE t.RecallType = 0 AND t.Time >= DATEADD(month, -12, GETDATE())
    GROUP BY te.ItemID
) v ON v.ItemID = i.ID
WHERE i.Inactive = 0 AND (i.Quantity > 0 OR v.unidades IS NOT NULL)
"@

# ---------- 6. Clientes (excluye los genericos de mostrador) ----------
$qClientes = @"
SELECT c.ID,
       -- El nombre real vive en FirstName/LastName. Company se usa en esta
       -- tienda como referencia ("Esposo Paty", "VIVERO LIMA"), no como nombre:
       -- solo se usa si no hay nombre de persona.
       LTRIM(RTRIM(CASE WHEN LTRIM(RTRIM(ISNULL(c.FirstName,'') + ' ' + ISNULL(c.LastName,''))) <> ''
                        THEN ISNULL(c.FirstName,'') + ' ' + ISNULL(c.LastName,'')
                        ELSE ISNULL(c.Company,'') END)) AS nombre,
       LTRIM(RTRIM(ISNULL(c.Company,''))) AS referencia,
       ISNULL(c.PhoneNumber,'')   AS telefono,
       ISNULL(c.AccountBalance,0) AS saldo,
       ISNULL(c.CreditLimit,0)    AS credito,
       MIN(t.Time) AS primera_compra,
       MAX(t.Time) AS ultima_compra,
       COUNT(DISTINCT t.TransactionNumber) AS compras,
       SUM(CASE WHEN t.Total > 0 THEN t.Total ELSE 0 END) AS total_comprado
FROM Customer c
JOIN [Transaction] t ON t.CustomerID = c.ID
WHERE t.RecallType = 0 AND c.ID NOT IN ($genericos)
GROUP BY c.ID, c.Company, c.FirstName, c.LastName, c.PhoneNumber, c.AccountBalance, c.CreditLimit
"@

# ---------- 7. Cuentas por cobrar con antiguedad real ----------
$qCxC = @"
SELECT ar.CustomerID,
       -- El nombre real vive en FirstName/LastName. Company se usa en esta
       -- tienda como referencia ("Esposo Paty", "VIVERO LIMA"), no como nombre:
       -- solo se usa si no hay nombre de persona.
       LTRIM(RTRIM(CASE WHEN LTRIM(RTRIM(ISNULL(c.FirstName,'') + ' ' + ISNULL(c.LastName,''))) <> ''
                        THEN ISNULL(c.FirstName,'') + ' ' + ISNULL(c.LastName,'')
                        ELSE ISNULL(c.Company,'') END)) AS nombre,
       LTRIM(RTRIM(ISNULL(c.Company,''))) AS referencia,
       ISNULL(c.PhoneNumber,'') AS telefono,
       CAST(ar.Balance AS float)        AS saldo,
       CAST(ar.OriginalAmount AS float) AS original,
       ar.Date AS fecha, ar.DueDate AS vence,
       DATEDIFF(day, ar.Date, GETDATE()) AS dias
FROM AccountReceivable ar
JOIN Customer c ON ar.CustomerID = c.ID
WHERE ar.Balance > 0
ORDER BY dias DESC
"@

# ---------- 7b. Morosidad: saldo y cuanto hace que no abona ----------
$qMora = @"
SELECT c.ID AS CustomerID,
       CAST(c.AccountBalance AS float)              AS saldo,
       DATEDIFF(day, MIN(ar.Date), GETDATE())       AS dias_doc_mas_viejo,
       (SELECT DATEDIFF(day, MAX(h.Date), GETDATE())
          FROM AccountReceivableHistory h
          JOIN AccountReceivable a2 ON h.AccountReceivableID = a2.ID
         WHERE a2.CustomerID = c.ID AND h.HistoryType = 2) AS dias_ultimo_abono
FROM Customer c
JOIN AccountReceivable ar ON ar.CustomerID = c.ID AND ar.Balance > 0
WHERE c.AccountBalance > 0
GROUP BY c.ID, c.AccountBalance
"@

# ---------- 8. Estacionalidad ----------
$qMes = @"
SELECT MONTH(t.Time) AS mes,
       SUM(te.Price * te.Quantity) AS venta,
       COUNT(DISTINCT t.TransactionNumber) AS transacciones
FROM TransactionEntry te
JOIN [Transaction] t ON te.TransactionNumber = t.TransactionNumber
WHERE t.RecallType = 0
GROUP BY MONTH(t.Time) ORDER BY mes
"@

$qDiaSemana = @"
SELECT DATEPART(weekday, t.Time) AS dia,
       SUM(te.Price * te.Quantity) AS venta,
       COUNT(DISTINCT t.TransactionNumber) AS transacciones
FROM TransactionEntry te
JOIN [Transaction] t ON te.TransactionNumber = t.TransactionNumber
WHERE t.RecallType = 0 AND t.Time >= DATEADD(year, -2, GETDATE())
GROUP BY DATEPART(weekday, t.Time) ORDER BY dia
"@

# ---------- 9. Canasta: pares de productos comprados juntos ----------
$qCanasta = @"
SELECT TOP 40
       ia.Description AS producto_a,
       ib.Description AS producto_b,
       COUNT(*) AS veces
FROM TransactionEntry a
JOIN TransactionEntry b ON a.TransactionNumber = b.TransactionNumber AND a.ItemID < b.ItemID
JOIN [Transaction] t ON a.TransactionNumber = t.TransactionNumber
JOIN Item ia ON a.ItemID = ia.ID
JOIN Item ib ON b.ItemID = ib.ID
WHERE t.RecallType = 0 AND t.Time >= DATEADD(year, -2, GETDATE())
GROUP BY ia.Description, ib.Description
HAVING COUNT(*) >= 2
ORDER BY veces DESC
"@

# ---------- 10. Ritmo reciente (ultimos 90 dias) ----------
$qDiario = @"
SELECT CONVERT(varchar(10), t.Time, 23) AS fecha,
       SUM(te.Price * te.Quantity) AS venta,
       COUNT(DISTINCT t.TransactionNumber) AS transacciones
FROM TransactionEntry te
JOIN [Transaction] t ON te.TransactionNumber = t.TransactionNumber
WHERE t.RecallType = 0 AND t.Time >= DATEADD(day, -90, GETDATE())
GROUP BY CONVERT(varchar(10), t.Time, 23)
ORDER BY fecha
"@

Write-Host "Leyendo RMS..."
$datos = [ordered]@{
    generado     = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ss")
    anual        = Invoke-Query $qAnual
    mensual      = Invoke-Query $qMensual
    ytd          = Invoke-Query $qYTD
    categorias   = Invoke-Query $qCategorias
    productos    = Invoke-Query $qProductos
    clientes     = Invoke-Query $qClientes
    cxc          = Invoke-Query $qCxC
    mora         = Invoke-Query $qMora
    porMes       = Invoke-Query $qMes
    porDiaSemana = Invoke-Query $qDiaSemana
    canasta      = Invoke-Query $qCanasta
    diario       = Invoke-Query $qDiario
}

$json = $datos | ConvertTo-Json -Depth 6 -Compress
[System.IO.File]::WriteAllText($salida, $json, (New-Object System.Text.UTF8Encoding($false)))

Write-Host ("OK - " + $datos.productos.Count + " productos, " + $datos.clientes.Count + " clientes, " + $datos.anual.Count + " anios")
