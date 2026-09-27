# Gaby's Fashion - Analitica local

Programa local que lee Microsoft Dynamics RMS y produce analitica de ventas,
clientes, inventario y fiado, con un diagnostico escrito por Claude.

Todo corre en esta PC. El servidor solo escucha en `127.0.0.1`: nadie mas en la
red de la tienda puede abrirlo.

## Uso

Doble clic a **`run.cmd`**. Abre el navegador en <http://localhost:4000>.

Dentro del panel, **Actualizar desde RMS** vuelve a leer la base. La lectura es
de solo lectura: el programa nunca escribe en RMS.

## Que hay en cada pestana

| Pestana | Que responde |
|---|---|
| Resumen | Como va el ano contra el anterior, y las alertas del dia |
| Ventas | Ano contra ano, y el mismo periodo de cada ano (la comparacion valida) |
| Margen | Donde se esta perdiendo margen, por ano y por categoria |
| Productos | Capital dormido, agotados que rotaban, ABC, meses de inventario |
| Clientes | Segmentos RFM, a quien contactar hoy, quien se esta fugando |
| Fiado | Antiguedad real del saldo y quien debe |
| Temporada | Indice por mes y venta por dia de la semana |
| Analisis IA | Diagnostico escrito y las acciones de mayor impacto |

## Definiciones que conviene tener claras

- **Mismo periodo**: del 1 de enero al dia de hoy, en cada ano. Comparar un ano
  a medias contra anos completos siempre da una caida falsa.
- **Capital dormido**: producto cuyo inventario actual lleva mas de un ano
  fisicamente en la tienda (contado desde `LastReceived`, el ultimo ingreso), no
  rota, y cuyo codigo tiene mas de un ano de dado de alta. Se distingue entre
  los que nunca vendieron ni una unidad y los que son saldo rezagado. La fecha clave es la del ingreso de la mercaderia, NO la del
  registro del codigo: un codigo puede existir desde hace anios y el inventario
  que hoy esta en existencia haber llegado el mes pasado.
- **En observacion**: entre 90 dias y un ano en la tienda sin moverse. Todavia
  no es capital muerto. Si al cumplir el ano sigue quieto, pasa solo a dormido.
- **Mercaderia nueva**: menos de 90 dias en la tienda. No se juzga.
- **Recomprado sin rotar**: mercaderia recien ingresada, pero de codigos que ya
  llevaban mas de un ano sin venderse. No es capital dormido (acaba de llegar);
  lo que hay que revisar es la decision de compra.
- **Cadencia del cliente**: cada cuantos dias compra ese cliente en particular.
  De ahi salen "en su ventana de recompra" (le toca volver) y "en riesgo"
  (lleva mas de 1.5 veces su ritmo sin aparecer).
- **ABC**: A son los productos que acumulan el 80% de la utilidad.

## Configuracion (`config.json`)

```json
{
  "sql":      { "server": "192.168.100.3", "database": "GABY" },
  "negocio":  { "clientesGenericos": [55, 56], "diasInventarioMuerto": 365 },
  "ia":       { "apiKey": "", "modelo": "claude-opus-5" },
  "servidor": { "puerto": 4000 }
}
```

- `clientesGenericos`: los IDs de mostrador (FACEF y CLIENTE FINAL). Se excluyen
  de la analitica de clientes porque no son personas reales.
- `ia.apiKey`: la clave de <https://console.anthropic.com>. Sin ella todo lo
  demas funciona igual; solo se desactiva el boton de generar analisis, y queda
  el de descargar el resumen para pegarlo en Claude a mano.

## Privacidad

A la API de Claude solo se mandan **cifras agregadas**: totales por ano,
por categoria, conteos por segmento y nombres de producto. Nunca salen de esta
PC nombres de clientes, telefonos ni saldos individuales. El texto exacto que se
envia es el mismo que descarga el boton "Descargar resumen".

## Estructura

```
src/rms-export.ps1   lee RMS y escribe cache/datos.json (solo lectura)
src/analytics.js     calculos: RFM, ABC, rotacion, margen, estacionalidad
src/ai.js            arma el resumen y llama a la API de Claude
src/server.js        servidor local y API del panel
web/                 el panel (sin librerias externas, funciona sin internet)
```

La extraccion va por PowerShell y no por un driver de Node porque RMS usa
autenticacion integrada de Windows, que el driver `mssql` no soporta sin
modulos nativos.

## Limitaciones conocidas

- El negocio hace pocas transacciones (unas 650 al ano). Las variaciones
  pequenas no son tendencias; el analisis lo tiene en cuenta.
- `SalesRepID` esta siempre en 0 y solo hay un cajero, asi que no se puede
  medir desempeno por vendedor.
- La canasta de compra (que se vende junto) tiene poca senal por el volumen.
