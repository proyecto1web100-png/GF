// Dashboard local. Sin librerias externas: las graficas se dibujan en SVG.

let A = null;
let MONEDA = "L.";

const $ = (s) => document.querySelector(s);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const dinero = (n) => MONEDA + " " + Math.round(Number(n) || 0).toLocaleString("es-HN");
const pct = (n) => (n === null || n === undefined ? "s/d" : Number(n).toFixed(1) + "%");
const signo = (n) => (n === null || n === undefined ? "" : n > 0 ? "sube" : n < 0 ? "baja" : "");
const flecha = (n) => (n === null || n === undefined ? "" : n > 0 ? "+" : "");

// ── graficas svg ─────────────────────────────────────────────
// El viewBox usa un ancho fijo de 1000 con escalado uniforme: si se deforma el
// eje X, el texto de las etiquetas sale aplastado.
const ANCHO = 1000;

function barras(datos, { alto = 200, color = "#c9a84c", formato = dinero } = {}) {
  if (!datos.length) return "<p class='cargando'>Sin datos</p>";
  const max = Math.max(...datos.map((d) => d.valor), 1);
  const paso = ANCHO / datos.length;
  return `<svg viewBox="0 0 ${ANCHO} ${alto}" style="width:100%">
    ${datos
      .map((d, i) => {
        const h = Math.max(1, (d.valor / max) * (alto - 40));
        return `<rect x="${i * paso + paso * 0.18}" y="${alto - 24 - h}" width="${paso * 0.64}" height="${h}"
                 fill="${d.color || color}" rx="3"><title>${esc(d.etiqueta)}: ${formato(d.valor)}</title></rect>
        <text x="${i * paso + paso / 2}" y="${alto - 8}" font-size="13" fill="#9a927e"
              text-anchor="middle">${esc(d.etiqueta)}</text>`;
      })
      .join("")}
  </svg>`;
}

function lineas(series, etiquetas, { alto = 250 } = {}) {
  const todos = series.flatMap((s) => s.valores.filter((v) => v !== null));
  if (!todos.length) return "<p class='cargando'>Sin datos</p>";
  const max = Math.max(...todos, 1);
  const n = etiquetas.length;
  const x = (i) => (n > 1 ? (i / (n - 1)) * (ANCHO - 40) + 20 : ANCHO / 2);
  const y = (v) => alto - 28 - (v / max) * (alto - 48);

  return `<svg viewBox="0 0 ${ANCHO} ${alto}" style="width:100%">
    ${series
      .map((s) => {
        const pts = s.valores
          .map((v, i) => (v === null ? null : `${x(i)},${y(v)}`))
          .filter(Boolean)
          .join(" ");
        return `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="2.5"
                 stroke-linejoin="round" stroke-linecap="round"/>`;
      })
      .join("")}
    ${series
      .map((s) =>
        s.valores
          .map((v, i) =>
            v === null ? "" : `<circle cx="${x(i)}" cy="${y(v)}" r="3.5" fill="${s.color}"><title>${esc(s.nombre)} ${esc(etiquetas[i])}: ${dinero(v)}</title></circle>`
          )
          .join("")
      )
      .join("")}
    ${etiquetas
      .map((e, i) => `<text x="${x(i)}" y="${alto - 8}" font-size="13" fill="#9a927e" text-anchor="middle">${esc(e)}</text>`)
      .join("")}
  </svg>
  <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:8px;font-size:13px">
    ${series
      .map((s) => `<span><span style="display:inline-block;width:11px;height:11px;background:${s.color};border-radius:2px;margin-right:5px"></span>${esc(s.nombre)}</span>`)
      .join("")}
  </div>`;
}

function tabla(columnas, filas) {
  if (!filas.length) return "<p class='cargando'>Sin registros</p>";
  return `<table><thead><tr>${columnas
    .map((c) => `<th class="${c.n ? "n" : ""}">${esc(c.titulo)}</th>`)
    .join("")}</tr></thead><tbody>${filas
    .map(
      (f) =>
        `<tr>${columnas.map((c) => `<td class="${c.n ? "n" : ""}">${c.render ? c.render(f) : esc(f[c.campo])}</td>`).join("")}</tr>`
    )
    .join("")}</tbody></table>`;
}

const caja = (titulo, nota, cuerpo) =>
  `<div class="caja"><h2>${esc(titulo)}</h2>${nota ? `<p class="nota">${esc(nota)}</p>` : ""}${cuerpo}</div>`;

const tarjeta = (rotulo, valor, pie = "", clase = "") =>
  `<div class="tarjeta"><div class="rotulo">${esc(rotulo)}</div>
   <div class="valor ${clase}">${valor}</div><div class="pie">${pie}</div></div>`;

// ── vistas ───────────────────────────────────────────────────
function vistaResumen() {
  const c = A.ventas.comparativo;
  const ac = c.anioActual, pr = c.anioPrevio;
  const p = A.productos.totales;
  const alertas = [];

  if (c.margenPuntos !== null && c.margenPuntos < -1)
    alertas.push(`El margen cayo ${Math.abs(c.margenPuntos)} puntos contra el mismo periodo del ano pasado.`);
  if (p.pctDormido > 30)
    alertas.push(
      `${p.pctDormido}% del inventario (${dinero(p.capitalDormido)}) ya tuvo un ciclo completo sin venderse.`
    );
  if (A.clientes.enRiesgo.length)
    alertas.push(`${A.clientes.enRiesgo.length} clientes buenos llevan mucho mas de lo normal sin comprar.`);
  if (p.quiebres)
    alertas.push(`${p.quiebres} productos que si rotaban estan agotados.`);
  if (A.cxc.pctVencido > 40)
    alertas.push(`${A.cxc.pctVencido}% del fiado (${dinero(A.cxc.vencido)}) tiene mas de 60 dias.`);

  const meses = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
  const anios = [...new Set(A.ventas.mensual.map((m) => m.anio))].sort().slice(-3);
  const colores = ["#5b5b5b", "#8a7433", "#c9a84c"];
  const series = anios.map((anio, i) => ({
    nombre: String(anio),
    color: colores[i] ?? "#c9a84c",
    valores: meses.map((_, mi) => {
      const f = A.ventas.mensual.find((m) => m.anio === anio && m.mes === mi + 1);
      return f ? f.venta : null;
    }),
  }));

  return `
    ${alertas.length ? `<div class="aviso"><b>Atencion:</b><br>${alertas.map(esc).join("<br>")}</div>` : ""}
    <div class="tarjetas">
      ${tarjeta("Venta " + (ac?.anio ?? ""), dinero(ac?.venta ?? 0),
        `vs ${pr?.anio ?? ""}: <span class="${signo(c.ventaPct)}">${flecha(c.ventaPct)}${pct(c.ventaPct)}</span> (mismo periodo)`)}
      ${tarjeta("Margen bruto", pct(ac?.margen),
        `<span class="${signo(c.margenPuntos)}">${flecha(c.margenPuntos)}${c.margenPuntos ?? "s/d"} puntos</span> vs ${pr?.anio ?? ""}`,
        c.margenPuntos < 0 ? "baja" : "")}
      ${tarjeta("Transacciones", (ac?.transacciones ?? 0).toLocaleString("es-HN"),
        `<span class="${signo(c.transaccionesPct)}">${flecha(c.transaccionesPct)}${pct(c.transaccionesPct)}</span>`)}
      ${tarjeta("Ticket promedio", dinero(ac?.ticket ?? 0),
        `<span class="${signo(c.ticketPct)}">${flecha(c.ticketPct)}${pct(c.ticketPct)}</span>`)}
      ${tarjeta("Capital dormido", dinero(p.capitalDormido), `${p.pctDormido}% del inventario`, p.pctDormido > 40 ? "baja" : "")}
      ${tarjeta("Fiado pendiente", dinero(A.cxc.total), `${pct(A.cxc.pctVencido)} con mas de 60 dias`)}
    </div>
    ${caja("Venta mensual, ultimos 3 anos", "Compara el ritmo del ano en curso contra los anteriores.", lineas(series, meses))}
  `;
}

function vistaVentas() {
  return (
    caja("Ano contra ano (anos completos)", "El ano en curso aparece incompleto: usa la tabla de abajo para comparar.",
      tabla(
        [
          { titulo: "Ano", campo: "anio" },
          { titulo: "Venta", n: true, render: (f) => dinero(f.venta) },
          { titulo: "Costo", n: true, render: (f) => dinero(f.costo) },
          { titulo: "Utilidad", n: true, render: (f) => dinero(f.utilidad) },
          { titulo: "Margen", n: true, render: (f) => pct(f.margen) },
          { titulo: "Transac.", n: true, render: (f) => f.transacciones.toLocaleString("es-HN") },
          { titulo: "Ticket", n: true, render: (f) => dinero(f.ticket) },
        ],
        A.ventas.anual
      )) +
    caja("Mismo periodo de cada ano", "Del 1 de enero al dia de hoy. Esta es la comparacion valida.",
      tabla(
        [
          { titulo: "Ano", campo: "anio" },
          { titulo: "Venta", n: true, render: (f) => dinero(f.venta) },
          { titulo: "Margen", n: true, render: (f) => pct(f.margen) },
          { titulo: "Transac.", n: true, render: (f) => f.transacciones.toLocaleString("es-HN") },
          { titulo: "Clientes", n: true, render: (f) => f.clientes },
          { titulo: "Ticket", n: true, render: (f) => dinero(f.ticket) },
        ],
        A.ventas.ytd
      )) +
    caja("Venta por ano", "", barras(A.ventas.anual.map((y) => ({ etiqueta: y.anio, valor: y.venta }))))
  );
}

function vistaMargen() {
  const anios = A.categorias.anios;
  const ultimo = anios[anios.length - 1];
  return (
    caja("Margen bruto por ano", "Punto de partida del diagnostico: cuanto queda de cada lempira vendido.",
      barras(A.ventas.anual.map((y) => ({ etiqueta: y.anio, valor: y.margen })), { formato: (v) => v + "%" })) +
    caja("Categorias que movieron el margen", `Cambio en puntos entre ${anios[0]} y ${ultimo}. Los negativos son los que hay que revisar primero.`,
      tabla(
        [
          { titulo: "Categoria", campo: "categoria" },
          { titulo: `Margen ${anios[0]}`, n: true, render: (f) => pct(f.margenAntes) },
          { titulo: `Margen ${ultimo}`, n: true, render: (f) => pct(f.margenAhora) },
          { titulo: "Cambio", n: true, render: (f) => `<span class="${signo(f.puntos)}">${flecha(f.puntos)}${f.puntos} pts</span>` },
          { titulo: "Venta actual", n: true, render: (f) => dinero(f.ventaAhora) },
        ],
        A.categorias.cambiosMargen
      )) +
    caja(`Categorias en ${ultimo}`, "",
      tabla(
        [
          { titulo: "Categoria", campo: "categoria" },
          { titulo: "Venta", n: true, render: (f) => dinero(f.venta) },
          { titulo: "Utilidad", n: true, render: (f) => dinero(f.utilidad) },
          { titulo: "Margen", n: true, render: (f) => pct(f.margen) },
          { titulo: "Unidades", n: true, render: (f) => f.unidades },
        ],
        A.categorias.porAnio[ultimo] ?? []
      ))
  );
}

function vistaProductos() {
  const p = A.productos;
  const colProducto = { titulo: "Producto", campo: "nombre" };
  // Las dos preguntas que importan: cuando llego esta mercaderia y cuanto lleva
  // sin venderse.
  const meses = (d) => (d === null || d === undefined ? "-" : (d / 30.44).toFixed(1) + " meses");
  const colsInventario = [
    { titulo: "Ingreso a tienda", n: true, render: (f) => f.ingreso ?? "-" },
    { titulo: "Lleva en tienda", n: true, render: (f) => meses(f.diasEnTienda) },
    { titulo: "Ultima venta", n: true, render: (f) => f.ultimaVenta ?? "nunca vendido" },
    { titulo: "Sin venderse", n: true, render: (f) => meses(f.diasSinVender) },
  ];
  return (
    `<div class="tarjetas">
      ${tarjeta("Capital en inventario", dinero(p.totales.capitalTotal), `${p.totales.itemsConStock} items con existencia`)}
      ${tarjeta("Capital dormido", dinero(p.totales.capitalDormido), `${p.totales.itemsDormidos} items, ${p.totales.pctDormido}%`, "baja")}
      ${tarjeta("De eso, nunca vendio nada", dinero(p.totales.dormidoNunca), `${p.totales.itemsDormidoNunca} items: la compra fallo desde el inicio`, "baja")}
      ${tarjeta("De eso, es saldo restante", dinero(p.totales.dormidoSaldo), `${p.totales.itemsDormidoSaldo} items que si llegaron a venderse`, "ojo")}
      ${tarjeta("En observacion", dinero(p.totales.capitalObservacion), `${p.totales.itemsObservacion} items entre 3 y 12 meses en tienda`, "ojo")}
      ${tarjeta("Mercaderia nueva", dinero(p.totales.capitalNuevo), `${p.totales.itemsNuevos} items con menos de 90 dias en tienda`)}
      ${tarjeta("Recomprado sin rotar", dinero(p.totales.capitalRecomprado), `${p.totales.itemsRecomprados} items surtidos de nuevo pese a no venderse`, "ojo")}
      ${tarjeta("Codigos duplicados", dinero(p.totales.capitalDuplicado), `${p.totales.itemsDuplicados} items: el producto si vende, pero con otro codigo`)}
      ${tarjeta("Agotados que rotaban", p.totales.quiebres, `vendieron ${dinero(p.totales.ventaPerdidaEstimada)} en 12 meses`, "ojo")}
      ${tarjeta("Clasificacion ABC", `${p.abc.A} / ${p.abc.B} / ${p.abc.C}`, "A = 80% de la utilidad")}
    </div>` +
    `<div class="caja">
      <h2>Capital dormido</h2>
      <p class="nota">Mercaderia que lleva mas de un ano fisicamente en la tienda desde su ultimo ingreso y no rota. Se excluyen los codigos dados de alta en el ultimo ano y los codigos duplicados.</p>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:14px">
        <span style="font-size:13px;color:var(--tenue)">Mostrar los que llevan</span>
        <select id="filtroAnios">
          <option value="1">1 ano o mas</option>
          <option value="2">2 anos o mas</option>
          <option value="3">3 anos o mas</option>
        </select>
        <span style="font-size:13px;color:var(--tenue)">en inventario</span>
        <span id="resumenDormido" style="font-size:13px;color:var(--tenue);margin-left:auto"></span>
      </div>
      <div id="tablaDormido"></div>
    </div>` +
    caja(
      "En observacion",
      `Este inventario lleva entre 90 dias y ${p.totales.diasCiclo} dias en la tienda sin moverse. Todavia no es capital muerto: si al cumplir el ano sigue quieto, pasa solo a la lista de arriba.`,
      tabla(
        [
          colProducto,
          { titulo: "Categoria", campo: "categoria" },
          { titulo: "Stock", n: true, campo: "stock" },
          { titulo: "Capital", n: true, render: (f) => dinero(f.capital) },
          ...colsInventario,
        ],
        p.enObservacion
      )) +
    caja(
      "Codigos duplicados (no es capital muerto)",
      "El mismo producto esta cargado con mas de un codigo en RMS. Este codigo no se mueve, pero su gemelo si vendio hace poco: el producto no esta muerto, el codigo esta duplicado. Conviene unificarlos en RMS.",
      tabla(
        [
          colProducto,
          { titulo: "Categoria", campo: "categoria" },
          { titulo: "Stock", n: true, campo: "stock" },
          { titulo: "Capital", n: true, render: (f) => dinero(f.capital) },
          { titulo: "Este codigo sin vender", n: true, render: (f) => meses(f.diasSinVender) },
          { titulo: "El producto vendio hace", n: true, render: (f) => meses(f.ventaDelGrupo) },
        ],
        p.duplicados
      )) +
    caja(
      "Se volvio a comprar algo que no rota",
      `La mercaderia llego hace poco, asi que no es capital dormido. Lo que hay que revisar es la compra: son codigos que ya llevaban mas de ${p.totales.diasCiclo} dias en el catalogo sin venderse y aun asi se volvieron a surtir.`,
      tabla(
        [
          colProducto,
          { titulo: "Categoria", campo: "categoria" },
          { titulo: "Stock", n: true, campo: "stock" },
          { titulo: "Capital", n: true, render: (f) => dinero(f.capital) },
          ...colsInventario,
          { titulo: "En catalogo desde", n: true, render: (f) => f.registrado ?? "-" },
        ],
        p.recompradoSinRotar
      )) +
    caja("Agotados que si rotaban", "Venta que se esta perdiendo por falta de existencia. Candidatos a reponer ya.",
      tabla(
        [
          colProducto,
          { titulo: "Categoria", campo: "categoria" },
          { titulo: "Unidades 12m", n: true, campo: "unidades12m" },
          { titulo: "Venta 12m", n: true, render: (f) => dinero(f.venta12m) },
          { titulo: "Margen", n: true, render: (f) => pct(f.margen) },
        ],
        p.quiebres
      )) +
    caja("Los que mas utilidad dejan", "No es lo que mas se vende, sino lo que mas deja.",
      tabla(
        [
          colProducto,
          { titulo: "ABC", campo: "abc" },
          { titulo: "Unidades", n: true, campo: "unidades12m" },
          { titulo: "Venta", n: true, render: (f) => dinero(f.venta12m) },
          { titulo: "Utilidad", n: true, render: (f) => dinero(f.utilidad12m) },
          { titulo: "Margen", n: true, render: (f) => pct(f.margen) },
          { titulo: "Meses de stock", n: true, render: (f) => f.mesesInventario ?? "-" },
        ],
        p.topUtilidad
      )) +
    caja("Mayor rotacion con existencia", "Los caballos de batalla: cuidar que nunca falten.",
      tabla(
        [
          colProducto,
          { titulo: "Unidades 12m", n: true, campo: "unidades12m" },
          { titulo: "Stock", n: true, campo: "stock" },
          { titulo: "Meses de stock", n: true, render: (f) => f.mesesInventario ?? "-" },
          { titulo: "Margen", n: true, render: (f) => pct(f.margen) },
        ],
        p.rotativos
      ))
  );
}

function vistaClientes() {
  const c = A.clientes;
  const seg = Object.entries(c.porSegmento).map(([k, v]) => ({ segmento: k, ...v }));
  const colsCliente = [
    { titulo: "Cliente", campo: "nombre" },
    { titulo: "Referencia", render: (f) => f.referencia || "" },
    { titulo: "Telefono", campo: "telefono" },
    { titulo: "Compras", n: true, campo: "compras" },
    { titulo: "Total", n: true, render: (f) => dinero(f.total) },
    { titulo: "Ticket", n: true, render: (f) => dinero(f.ticket) },
    { titulo: "Dias sin venir", n: true, render: (f) => f.recencia ?? "-" },
    { titulo: "Compra cada", n: true, render: (f) => (f.cadencia ? f.cadencia + " d" : "-") },
  ];

  return (
    `<div class="tarjetas">
      ${tarjeta("Clientes identificados", c.total, "con al menos una compra")}
      ${tarjeta("Concentracion", pct(c.concentracion.pctVenta), `el 10% mejor (${c.concentracion.clientesTop10}) genera esto`)}
      ${tarjeta("Para contactar hoy", c.probables.length, "estan en su ventana de recompra", "ojo")}
      ${tarjeta("En riesgo de fuga", c.enRiesgo.length, "buenos clientes que se enfriaron", "baja")}
    </div>` +
    `<div class="caja">
      <h2>Compraron en ${c.anioFuga} y este ano no han vuelto</h2>
      <p class="nota">La lista de llamadas mas concreta del sistema: ${c.fugadosAnioPasado.length} clientes que suman ${dinero(
        c.fugadosAnioPasado.reduce((s, x) => s + x.total, 0)
      )} de compra historica. Ordenados por lo que gastaron: empeza por arriba.</p>
      <div style="margin-bottom:14px">
        <button id="btnCsvFugados">Descargar lista en CSV</button>
      </div>
      ${tabla(
        [
          { titulo: "Cliente", campo: "nombre" },
          { titulo: "Referencia", render: (f) => f.referencia || "" },
          { titulo: "Telefono", render: (f) => f.telefono || "(sin telefono)" },
          { titulo: "Compras", n: true, campo: "compras" },
          { titulo: "Total historico", n: true, render: (f) => dinero(f.total) },
          { titulo: "Ticket", n: true, render: (f) => dinero(f.ticket) },
          { titulo: "Ultima compra", n: true, render: (f) => f.ultimaCompra ?? "-" },
          { titulo: "Dias sin venir", n: true, render: (f) => f.recencia ?? "-" },
          { titulo: "Saldo fiado", n: true, render: (f) => (f.saldo > 0 ? dinero(f.saldo) : "-") },
        ],
        c.fugadosAnioPasado
      )}
    </div>` +
    caja("Segmentos", "campeon: 10+ compras al dia. leal: 4+. en_riesgo: lleva 1.5x su ritmo sin venir. perdido: 3x o mas de 2 anos.",
      tabla(
        [
          { titulo: "Segmento", campo: "segmento" },
          { titulo: "Clientes", n: true, campo: "clientes" },
          { titulo: "Venta historica", n: true, render: (f) => dinero(f.venta) },
        ],
        seg.sort((a, b) => b.venta - a.venta)
      )) +
    caja("Contactar hoy: estan en su ventana de recompra", "Segun su propio ritmo de compra, les toca volver ahora. Ordenados por valor anual estimado.",
      tabla([...colsCliente, { titulo: "Valor anual est.", n: true, render: (f) => (f.valorAnual ? dinero(f.valorAnual) : "-") }], c.probables)) +
    caja("En riesgo de fuga", "Compraban seguido y dejaron de venir. Recuperar uno cuesta mucho menos que conseguir uno nuevo.",
      tabla(colsCliente, c.enRiesgo)) +
    caja("Ya perdidos (con historial)", "Llevan mas de 3 veces su ritmo normal sin comprar.", tabla(colsCliente, c.perdidos)) +
    caja("Mejores clientes", "", tabla(colsCliente, c.mejores)) +
    caja("Nuevos recientes", "Primera compra en los ultimos 90 dias. La segunda compra es la que crea al cliente.", tabla(colsCliente, c.nuevos))
  );
}

function vistaFiado() {
  return (
    `<div class="tarjetas">
      ${tarjeta("Saldo total", dinero(A.cxc.total), "")}
      ${tarjeta("Vencido +60 dias", dinero(A.cxc.vencido), pct(A.cxc.pctVencido) + " del total", A.cxc.pctVencido > 40 ? "baja" : "")}
    </div>` +
    caja("Antiguedad del saldo", "Mientras mas viejo el saldo, menos probable es cobrarlo.",
      tabla(
        [
          { titulo: "Antiguedad", campo: "nombre" },
          { titulo: "Saldo", n: true, render: (f) => dinero(f.saldo) },
          { titulo: "Documentos", n: true, campo: "docs" },
        ],
        A.cxc.rangos
      )) +
    caja("Quien debe", "",
      tabla(
        [
          { titulo: "Cliente", campo: "nombre" },
          { titulo: "Referencia", render: (f) => f.referencia || "" },
          { titulo: "Telefono", campo: "telefono" },
          { titulo: "Saldo", n: true, render: (f) => dinero(f.saldo) },
          { titulo: "Doc. mas viejo", n: true, render: (f) => f.masViejo + " d" },
        ],
        A.cxc.clientes
      ))
  );
}

function vistaTemporada() {
  const e = A.estacionalidad;
  return (
    caja("Indice por mes", "100 = mes promedio. Arriba de 120 es temporada alta; abajo de 80, temporada baja.",
      barras(
        e.meses.map((m) => ({
          etiqueta: m.nombre,
          valor: m.indice,
          color: m.indice >= 120 ? "#4caf7d" : m.indice <= 80 ? "#d8544f" : "#c9a84c",
        })),
        { formato: (v) => v + " (indice)" }
      )) +
    caja("Venta por dia de la semana", "Ultimos 2 anos. Sirve para decidir horarios y personal.",
      barras(e.semana.map((d) => ({ etiqueta: d.nombre.slice(0, 3), valor: d.venta })))) +
    (A.canasta.length
      ? caja("Se compran juntos", "Ojo: con el volumen de esta tienda la senal es debil. Tomalo como pista, no como regla.",
          tabla(
            [
              { titulo: "Producto A", campo: "producto_a" },
              { titulo: "Producto B", campo: "producto_b" },
              { titulo: "Veces juntos", n: true, campo: "veces" },
            ],
            A.canasta
          ))
      : "")
  );
}

function vistaIA(estado) {
  const guardado = window.__ia;
  return (
    `<div class="caja">
      <h2>Analisis con IA</h2>
      <p class="nota">Se envian solo cifras agregadas. Nunca salen de esta PC nombres, telefonos ni saldos de clientes.</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button id="btnIA" class="primario">Generar analisis</button>
        <button id="btnResumen">Descargar resumen (para pegar en Claude)</button>
      </div>
      ${estado ? `<p class="nota" style="margin-top:12px">${esc(estado)}</p>` : ""}
    </div>` +
    (guardado
      ? `<div class="caja"><p class="nota">Generado: ${esc(new Date(guardado.generado).toLocaleString("es-HN"))} &middot; modelo ${esc(guardado.modelo)}</p>
         <div id="ia">${markdown(guardado.texto)}</div></div>`
      : "")
  );
}

// markdown minimo: titulos, negritas, vinetas y separadores.
// Se arman parrafos reales para no depender de white-space:pre-wrap, que dejaba
// huecos enormes alrededor de los titulos.
function markdown(t) {
  return esc(t)
    .split(/\n{2,}/)
    .map((bloque) => {
      const b = bloque.trim();
      if (!b) return "";
      if (/^---+$/.test(b)) return "<hr>";
      if (/^#{1,3} /.test(b)) return `<h2>${b.replace(/^#{1,3} /, "")}</h2>`;
      const cuerpo = b
        .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
        .replace(/^\*(.+)\*$/s, "<i>$1</i>")
        .replace(/^[-*] /gm, "&bull; ")
        .replace(/\n/g, "<br>");
      return `<p>${cuerpo}</p>`;
    })
    .join("");
}

// ── control ──────────────────────────────────────────────────
const VISTAS = {
  resumen: vistaResumen, ventas: vistaVentas, margen: vistaMargen,
  productos: vistaProductos, clientes: vistaClientes, fiado: vistaFiado,
  temporada: vistaTemporada, ia: () => vistaIA(),
};

function pintar(nombre) {
  if (!A) return;
  $("#v-" + nombre).innerHTML = VISTAS[nombre]();
  if (nombre === "ia") conectarIA();
  if (nombre === "productos") conectarDormido();
  if (nombre === "clientes") conectarClientes();
}

// Descarga la lista de fuga como CSV. Se arma en el navegador: los datos de los
// clientes no salen de esta PC.
function conectarClientes() {
  $("#btnCsvFugados")?.addEventListener("click", () => {
    const cols = ["nombre", "referencia", "telefono", "compras", "total", "ticket", "ultimaCompra", "recencia", "saldo"];
    const titulos = [
      "Cliente", "Referencia", "Telefono", "Compras", "Total historico", "Ticket promedio",
      "Ultima compra", "Dias sin venir", "Saldo fiado",
    ];
    const escapar = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const filas = A.clientes.fugadosAnioPasado.map((c) => cols.map((k) => escapar(c[k])).join(","));
    // BOM para que Excel abra bien los acentos
    const csv = "﻿" + [titulos.map(escapar).join(",")].concat(filas).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `clientes-sin-volver-${A.clientes.anioFuga}.csv`;
    a.click();
  });
}

// Tabla de capital dormido con filtro por anios en inventario.
function conectarDormido() {
  const sel = $("#filtroAnios");
  const destino = $("#tablaDormido");
  if (!sel || !destino) return;

  const pintarTabla = () => {
    const minDias = Number(sel.value) * 365;
    const filas = A.productos.dormido.filter((i) => i.diasEnTienda >= minDias);
    const capital = filas.reduce((s, i) => s + i.capital, 0);
    $("#resumenDormido").textContent = `${filas.length} articulos · ${dinero(capital)}`;
    destino.innerHTML = tabla(
      [
        { titulo: "Producto", campo: "nombre" },
        { titulo: "Categoria", campo: "categoria" },
        { titulo: "Stock", n: true, campo: "stock" },
        { titulo: "Capital", n: true, render: (f) => dinero(f.capital) },
        { titulo: "Dias en inventario", n: true, render: (f) => (f.diasEnTienda ?? "-").toLocaleString("es-HN") },
      ],
      filas
    );
  };

  sel.addEventListener("change", pintarTabla);
  pintarTabla();
}

function conectarIA() {
  $("#btnIA")?.addEventListener("click", async () => {
    $("#v-ia").innerHTML = vistaIA("Analizando... esto tarda entre 30 y 90 segundos.");
    conectarIA();
    try {
      const r = await fetch("/api/analisis-ia", { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "fallo");
      window.__ia = j;
      $("#v-ia").innerHTML = vistaIA();
      conectarIA();
    } catch (e) {
      $("#v-ia").innerHTML = vistaIA("Error: " + e.message);
      conectarIA();
    }
  });
  $("#btnResumen")?.addEventListener("click", async () => {
    const t = await (await fetch("/api/resumen")).text();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([t], { type: "text/plain;charset=utf-8" }));
    a.download = "resumen-gabys.txt";
    a.click();
  });
}

document.querySelectorAll("nav button").forEach((b) => {
  b.addEventListener("click", () => {
    document.querySelectorAll("nav button").forEach((x) => x.classList.remove("activo"));
    document.querySelectorAll("main section").forEach((x) => x.classList.remove("activo"));
    b.classList.add("activo");
    $("#v-" + b.dataset.vista).classList.add("activo");
    pintar(b.dataset.vista);
  });
});

$("#btnRefrescar").addEventListener("click", async () => {
  const b = $("#btnRefrescar");
  b.disabled = true;
  b.textContent = "Leyendo RMS...";
  try {
    const r = await fetch("/api/refrescar", { method: "POST" });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    await cargar();
  } catch (e) {
    alert("No se pudo actualizar: " + e.message);
  }
  b.disabled = false;
  b.textContent = "Actualizar desde RMS";
});

async function cargar() {
  const r = await fetch("/api/analisis");
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    $("#cargando").textContent = j.error || "No hay datos todavia.";
    return;
  }
  A = await r.json();
  MONEDA = A.negocio?.moneda ?? "L.";
  $("#cargando").style.display = "none";
  $("#generado").textContent = "Datos al " + new Date(A.generado).toLocaleString("es-HN");
  window.__ia = await (await fetch("/api/analisis-ia")).json();
  const activa = document.querySelector("nav button.activo").dataset.vista;
  pintar(activa);
}

cargar();
