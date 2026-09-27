// Motor de analitica: funciones puras sobre el JSON que produce rms-export.ps1.
// No toca la base ni la red.

const DIA = 86400000;

const num = (v) => (typeof v === "number" && isFinite(v) ? v : 0);
const dias = (desde, hasta = new Date()) => {
  if (!desde) return null;
  const d = new Date(desde);
  if (isNaN(d)) return null;
  return Math.floor((hasta - d) / DIA);
};
const margenPct = (venta, costo) => (venta > 0 ? ((venta - costo) / venta) * 100 : 0);
const redondear = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

// ── VENTAS Y MARGEN ──────────────────────────────────────────
export function ventas(datos) {
  const anual = datos.anual.map((a) => ({
    anio: a.anio,
    venta: redondear(num(a.venta)),
    costo: redondear(num(a.costo)),
    utilidad: redondear(num(a.venta) - num(a.costo)),
    margen: redondear(margenPct(num(a.venta), num(a.costo))),
    transacciones: num(a.transacciones),
    unidades: num(a.unidades),
    ticket: num(a.transacciones) ? redondear(num(a.venta) / num(a.transacciones)) : 0,
  }));

  // Comparativo contra el mismo dia del anio anterior: la unica lectura honesta
  // cuando el anio en curso va a la mitad.
  const ytd = datos.ytd.map((a) => ({
    anio: a.anio,
    venta: redondear(num(a.venta)),
    costo: redondear(num(a.costo)),
    margen: redondear(margenPct(num(a.venta), num(a.costo))),
    transacciones: num(a.transacciones),
    clientes: num(a.clientes),
    ticket: num(a.transacciones) ? redondear(num(a.venta) / num(a.transacciones)) : 0,
  }));

  const actual = ytd[ytd.length - 1] || null;
  const previo = ytd[ytd.length - 2] || null;
  const variacion = (a, b, campo) =>
    a && b && b[campo] ? redondear(((a[campo] - b[campo]) / b[campo]) * 100) : null;

  const mensual = datos.mensual.map((m) => ({
    anio: m.anio,
    mes: m.mes,
    venta: redondear(num(m.venta)),
    margen: redondear(margenPct(num(m.venta), num(m.costo))),
    transacciones: num(m.transacciones),
  }));

  return {
    anual,
    mensual,
    ytd,
    comparativo: {
      anioActual: actual,
      anioPrevio: previo,
      ventaPct: variacion(actual, previo, "venta"),
      transaccionesPct: variacion(actual, previo, "transacciones"),
      ticketPct: variacion(actual, previo, "ticket"),
      clientesPct: variacion(actual, previo, "clientes"),
      margenPuntos: actual && previo ? redondear(actual.margen - previo.margen) : null,
    },
  };
}

// ── CATEGORIAS ───────────────────────────────────────────────
export function categorias(datos) {
  const porAnio = {};
  for (const c of datos.categorias) {
    porAnio[c.anio] ??= [];
    porAnio[c.anio].push({
      categoria: c.categoria,
      venta: redondear(num(c.venta)),
      utilidad: redondear(num(c.venta) - num(c.costo)),
      margen: redondear(margenPct(num(c.venta), num(c.costo))),
      unidades: num(c.unidades),
    });
  }
  for (const anio of Object.keys(porAnio)) porAnio[anio].sort((a, b) => b.venta - a.venta);

  // Que categorias movieron el margen total entre el primer y el ultimo anio
  const anios = Object.keys(porAnio).map(Number).sort();
  const primero = porAnio[anios[0]] || [];
  const ultimo = porAnio[anios[anios.length - 1]] || [];
  const mapa = new Map(primero.map((c) => [c.categoria, c]));
  const cambios = ultimo
    .map((c) => {
      const antes = mapa.get(c.categoria);
      if (!antes) return null;
      return {
        categoria: c.categoria,
        margenAntes: antes.margen,
        margenAhora: c.margen,
        puntos: redondear(c.margen - antes.margen),
        ventaAhora: c.venta,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.puntos - b.puntos);

  return { porAnio, cambiosMargen: cambios, anios };
}

// ── PRODUCTOS: rotacion, ABC, capital dormido, quiebres ──────
export function productos(datos, cfg) {
  const limiteMuerto = cfg?.negocio?.diasInventarioMuerto ?? 365;

  const items = datos.productos.map((p) => {
    const stock = num(p.stock);
    const costoUnit = num(p.costo_unit);
    const unidades = num(p.unidades_12m);
    const venta = num(p.venta_12m);
    const costo = num(p.costo_12m);
    const capital = redondear(stock * costoUnit);
    // Meses de inventario: a este ritmo de venta, cuanto dura el stock actual
    const ritmoMensual = unidades / 12;
    const mesesInventario = ritmoMensual > 0 ? redondear(stock / ritmoMensual, 1) : null;

    return {
      id: p.ID,
      nombre: p.nombre,
      categoria: p.categoria,
      stock,
      costoUnit: redondear(costoUnit),
      precio: redondear(num(p.precio)),
      capital,
      unidades12m: unidades,
      venta12m: redondear(venta),
      utilidad12m: redondear(venta - costo),
      margen: redondear(margenPct(venta, costo)),
      mesesInventario,
      diasSinVender: dias(p.LastSold),
      diasDesdeRecibido: dias(p.LastReceived),
      diasEnCatalogo: dias(p.DateCreated),
      ultimaVenta: p.LastSold,
      ingreso: p.LastReceived,
      registrado: p.DateCreated,
    };
  });

  const conStock = items.filter((i) => i.stock > 0);

  // Cuanto lleva EN LA TIENDA la mercaderia que hoy esta en existencia: se mide
  // desde el ultimo ingreso, no desde que se creo el codigo de producto. Un
  // articulo puede tener el codigo desde hace anios y haber llegado el mes
  // pasado; medir la edad del codigo marca como capital muerto lo recien
  // comprado.
  for (const i of conStock) {
    i.diasEnTienda = i.diasDesdeRecibido ?? i.diasEnCatalogo ?? null;
  }

  const nuncaVendido = (i) => i.diasSinVender === null;
  const noRota = (i) => nuncaVendido(i) || i.diasSinVender > limiteMuerto;
  const vale = (i) => i.capital > 0 && i.diasEnTienda !== null;

  // El mismo producto puede estar cargado con varios codigos. Si un codigo
  // gemelo si se vendio hace poco, el producto NO esta muerto: lo que hay es un
  // codigo duplicado en RMS. Se separa para no contarlo como capital congelado.
  const clave = (n) => String(n ?? "").toLowerCase().trim();
  const ventaDelGrupo = new Map();
  for (const i of items) {
    if (i.diasSinVender === null) continue;
    const k = clave(i.nombre);
    const actual = ventaDelGrupo.get(k);
    if (actual === undefined || i.diasSinVender < actual) ventaDelGrupo.set(k, i.diasSinVender);
  }
  for (const i of conStock) {
    const g = ventaDelGrupo.get(clave(i.nombre));
    i.ventaDelGrupo = g ?? null;
    // Tiene un gemelo que si rota y este codigo no
    i.codigoDuplicado = g !== undefined && g !== null && g <= limiteMuerto && noRota(i);
  }

  // Dormido: este inventario lleva mas de un ciclo completo parado en la tienda
  // y ademas no rota, ni el suyo ni el de ningun codigo gemelo. Se exige tambien
  // que el codigo tenga mas de un anio de registrado: un articulo dado de alta
  // este anio no ha tenido tiempo de demostrar nada.
  const dormido = conStock
    .filter(
      (i) =>
        vale(i) &&
        i.diasEnTienda > limiteMuerto &&
        (i.diasEnCatalogo === null || i.diasEnCatalogo > limiteMuerto) &&
        noRota(i) &&
        !i.codigoDuplicado
    )
    .sort((a, b) => b.capital - a.capital);

  // Distingue las dos formas de morir: nunca vendio ni una unidad (la compra
  // estuvo mal desde el principio) o quedo el saldo de algo que si se vendio
  // (talla o color rezagado). El dinero esta igual de parado, pero la leccion
  // para la proxima compra es distinta.
  for (const i of dormido) i.origen = nuncaVendido(i) ? "nunca" : "saldo";

  // Codigos duplicados: el producto si se vende, pero bajo otro codigo.
  const duplicados = conStock
    .filter((i) => vale(i) && i.diasEnTienda > limiteMuerto && i.codigoDuplicado)
    .sort((a, b) => b.capital - a.capital);

  // Zona gris: entre 90 dias y un ciclo completo sin moverse.
  const enObservacion = conStock
    .filter(
      (i) => vale(i) && i.diasEnTienda > 90 && i.diasEnTienda <= limiteMuerto && noRota(i) && !i.codigoDuplicado
    )
    .sort((a, b) => b.capital - a.capital);

  // Recien llegado: no se juzga.
  const nuevos = conStock.filter((i) => vale(i) && i.diasEnTienda <= 90);

  // Compra cuestionable: se volvio a surtir algo que ya estaba en el catalogo
  // desde hace mas de un anio y que no rota. La mercaderia es nueva, asi que no
  // es capital dormido todavia; lo que hay que revisar es la decision de compra.
  const recompradoSinRotar = conStock
    .filter(
      (i) =>
        vale(i) &&
        i.diasEnTienda <= limiteMuerto &&
        i.diasEnCatalogo !== null &&
        i.diasEnCatalogo > limiteMuerto &&
        noRota(i)
    )
    .sort((a, b) => b.capital - a.capital);

  // Quiebre: rota bien pero ya no hay existencia = venta que se esta perdiendo
  const quiebres = items
    .filter((i) => i.stock <= 0 && i.unidades12m >= 3)
    .sort((a, b) => b.venta12m - a.venta12m);

  // Rotacion alta: mucho movimiento en 12 meses y todavia hay stock
  const rotativos = conStock
    .filter((i) => i.unidades12m > 0)
    .sort((a, b) => b.unidades12m - a.unidades12m);

  // Clasificacion ABC por utilidad aportada en 12 meses
  const conVenta = items.filter((i) => i.venta12m > 0).sort((a, b) => b.utilidad12m - a.utilidad12m);
  const utilidadTotal = conVenta.reduce((s, i) => s + i.utilidad12m, 0);
  let acumulado = 0;
  for (const i of conVenta) {
    acumulado += i.utilidad12m;
    const pct = utilidadTotal > 0 ? (acumulado / utilidadTotal) * 100 : 0;
    i.abc = pct <= 80 ? "A" : pct <= 95 ? "B" : "C";
  }

  const suma = (lista) => redondear(lista.reduce((s, i) => s + i.capital, 0));
  const capitalTotal = suma(conStock);
  const capitalDormido = suma(dormido);

  return {
    totales: {
      itemsConStock: conStock.length,
      capitalTotal,
      capitalDormido,
      pctDormido: capitalTotal > 0 ? redondear((capitalDormido / capitalTotal) * 100) : 0,
      itemsDormidos: dormido.length,
      capitalObservacion: suma(enObservacion),
      itemsObservacion: enObservacion.length,
      capitalNuevo: suma(nuevos),
      itemsNuevos: nuevos.length,
      capitalRecomprado: suma(recompradoSinRotar),
      itemsRecomprados: recompradoSinRotar.length,
      capitalDuplicado: suma(duplicados),
      itemsDuplicados: duplicados.length,
      dormidoNunca: suma(dormido.filter((i) => i.origen === "nunca")),
      itemsDormidoNunca: dormido.filter((i) => i.origen === "nunca").length,
      dormidoSaldo: suma(dormido.filter((i) => i.origen === "saldo")),
      itemsDormidoSaldo: dormido.filter((i) => i.origen === "saldo").length,
      diasCiclo: limiteMuerto,
      quiebres: quiebres.length,
      ventaPerdidaEstimada: redondear(quiebres.reduce((s, i) => s + i.venta12m, 0)),
    },
    dormido: dormido.slice(0, 200),
    enObservacion: enObservacion.slice(0, 40),
    recompradoSinRotar: recompradoSinRotar.slice(0, 40),
    duplicados: duplicados.slice(0, 40),
    quiebres: quiebres.slice(0, 40),
    rotativos: rotativos.slice(0, 40),
    topUtilidad: conVenta.slice(0, 40),
    abc: {
      A: conVenta.filter((i) => i.abc === "A").length,
      B: conVenta.filter((i) => i.abc === "B").length,
      C: conVenta.filter((i) => i.abc === "C").length,
    },
  };
}

// ── CLIENTES: RFM, fugas y probabilidad de compra ────────────
export function clientes(datos) {
  const hoy = new Date();

  const lista = datos.clientes
    .filter((c) => num(c.compras) > 0)
    .map((c) => {
      const compras = num(c.compras);
      const total = num(c.total_comprado);
      const recencia = dias(c.ultima_compra, hoy);
      const antiguedad = dias(c.primera_compra, hoy);
      // Cadencia: cada cuantos dias suele comprar este cliente
      const cadencia =
        compras > 1 && antiguedad !== null && recencia !== null
          ? Math.max(1, Math.round((antiguedad - recencia) / (compras - 1)))
          : null;

      return {
        id: c.ID,
        nombre: c.nombre || "(sin nombre)",
        // Company: en esta tienda se usa como referencia de quien es el cliente
        // ("Esposo Paty", "VIVERO LIMA"), no como razon social.
        referencia: c.referencia || "",
        telefono: c.telefono || "",
        compras,
        total: redondear(total),
        ticket: redondear(total / compras),
        recencia,
        antiguedad,
        cadencia,
        saldo: redondear(num(c.saldo)),
        ultimaCompra: c.ultima_compra,
      };
    });

  // Segmento RFM. Sin cadencia propia (una sola compra) se usa 180 dias como
  // referencia del negocio.
  for (const c of lista) {
    const ref = c.cadencia ?? 180;
    const r = c.recencia ?? 9999;

    if (c.compras === 1 && r <= 90) c.segmento = "nuevo";
    else if (r > ref * 3 || r > 730) c.segmento = "perdido";
    else if (r > ref * 1.5) c.segmento = "en_riesgo";
    else if (c.compras >= 10) c.segmento = "campeon";
    else if (c.compras >= 4) c.segmento = "leal";
    else c.segmento = "ocasional";

    // Esta dentro de su ventana normal de recompra
    c.enVentana = c.cadencia !== null && r >= ref * 0.7 && r <= ref * 1.4;
    // Valor anual estimado: ticket * compras por anio
    c.valorAnual =
      c.cadencia && c.cadencia > 0 ? redondear((365 / c.cadencia) * c.ticket) : null;
  }

  const porSegmento = {};
  for (const c of lista) {
    porSegmento[c.segmento] ??= { clientes: 0, venta: 0 };
    porSegmento[c.segmento].clientes++;
    porSegmento[c.segmento].venta = redondear(porSegmento[c.segmento].venta + c.total);
  }

  const ordenValor = (a, b) => b.total - a.total;

  // Cohorte de fuga del anio pasado: compraron el anio anterior y en lo que va
  // de este no han vuelto. Es la lista de llamadas mas concreta que da el
  // sistema, porque no depende de estimar cadencias.
  const anioActual = hoy.getFullYear();
  const anioAnterior = anioActual - 1;
  const anioDe = (f) => (f ? new Date(f).getFullYear() : null);
  const fugadosAnioPasado = lista
    .filter((c) => anioDe(c.ultimaCompra) === anioAnterior)
    .sort(ordenValor);

  return {
    total: lista.length,
    porSegmento,
    fugadosAnioPasado,
    anioFuga: anioAnterior,
    // Lista completa, para armar campanas y listas de contacto sin duplicar
    // aqui la logica de segmentacion.
    todos: lista,
    // Los que hay que llamar hoy: estan en su ventana de recompra
    probables: lista
      .filter((c) => c.enVentana && c.segmento !== "perdido")
      .sort((a, b) => (b.valorAnual ?? 0) - (a.valorAnual ?? 0))
      .slice(0, 40),
    // Buenos clientes que se estan enfriando: aqui es donde se pierde dinero
    enRiesgo: lista
      .filter((c) => c.segmento === "en_riesgo" && c.compras >= 3)
      .sort(ordenValor)
      .slice(0, 40),
    perdidos: lista
      .filter((c) => c.segmento === "perdido" && c.compras >= 3)
      .sort(ordenValor)
      .slice(0, 40),
    mejores: [...lista].sort(ordenValor).slice(0, 30),
    nuevos: lista
      .filter((c) => c.segmento === "nuevo")
      .sort((a, b) => (a.recencia ?? 9999) - (b.recencia ?? 9999))
      .slice(0, 30),
    concentracion: (() => {
      const orden = [...lista].sort(ordenValor);
      const total = orden.reduce((s, c) => s + c.total, 0);
      const top10 = orden.slice(0, Math.max(1, Math.ceil(orden.length * 0.1)));
      const ventaTop = top10.reduce((s, c) => s + c.total, 0);
      return {
        clientesTop10: top10.length,
        pctVenta: total > 0 ? redondear((ventaTop / total) * 100) : 0,
      };
    })(),
  };
}

// ── CUENTAS POR COBRAR: antiguedad real del saldo ────────────
export function cuentasPorCobrar(datos) {
  const rangos = [
    { nombre: "0-30 dias", min: 0, max: 30, saldo: 0, docs: 0 },
    { nombre: "31-60 dias", min: 31, max: 60, saldo: 0, docs: 0 },
    { nombre: "61-90 dias", min: 61, max: 90, saldo: 0, docs: 0 },
    { nombre: "91-180 dias", min: 91, max: 180, saldo: 0, docs: 0 },
    { nombre: "mas de 180 dias", min: 181, max: 99999, saldo: 0, docs: 0 },
  ];

  const porCliente = new Map();

  for (const d of datos.cxc) {
    const saldo = num(d.saldo);
    const dd = num(d.dias);
    const r = rangos.find((x) => dd >= x.min && dd <= x.max);
    if (r) {
      r.saldo = redondear(r.saldo + saldo);
      r.docs++;
    }
    const k = d.CustomerID;
    if (!porCliente.has(k)) {
      porCliente.set(k, {
        nombre: d.nombre || "(sin nombre)",
        referencia: d.referencia || "",
        telefono: d.telefono || "",
        saldo: 0,
        masViejo: 0,
      });
    }
    const c = porCliente.get(k);
    c.saldo = redondear(c.saldo + saldo);
    c.masViejo = Math.max(c.masViejo, dd);
  }

  const clientesCxc = [...porCliente.values()].sort((a, b) => b.saldo - a.saldo);
  const total = redondear(clientesCxc.reduce((s, c) => s + c.saldo, 0));
  const vencido = rangos.filter((r) => r.min > 60).reduce((s, r) => s + r.saldo, 0);

  return {
    total,
    vencido: redondear(vencido),
    pctVencido: total > 0 ? redondear((vencido / total) * 100) : 0,
    rangos,
    clientes: clientesCxc.slice(0, 40),
  };
}

// ── ESTACIONALIDAD ───────────────────────────────────────────
export function estacionalidad(datos) {
  const MESES = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
  const DIAS = ["Domingo","Lunes","Martes","Miercoles","Jueves","Viernes","Sabado"];

  const meses = datos.porMes.map((m) => ({
    mes: m.mes,
    nombre: MESES[m.mes - 1] ?? String(m.mes),
    venta: redondear(num(m.venta)),
    transacciones: num(m.transacciones),
  }));
  const promedio = meses.length ? meses.reduce((s, m) => s + m.venta, 0) / meses.length : 0;
  for (const m of meses) m.indice = promedio > 0 ? redondear((m.venta / promedio) * 100) : 0;

  const semana = datos.porDiaSemana.map((d) => ({
    dia: d.dia,
    nombre: DIAS[d.dia - 1] ?? String(d.dia),
    venta: redondear(num(d.venta)),
    transacciones: num(d.transacciones),
  }));

  return { meses, semana, diario: datos.diario ?? [] };
}

// ── PAQUETE COMPLETO ─────────────────────────────────────────
export function analizarTodo(datos, cfg) {
  return {
    generado: datos.generado,
    ventas: ventas(datos),
    categorias: categorias(datos),
    productos: productos(datos, cfg),
    clientes: clientes(datos),
    cxc: cuentasPorCobrar(datos),
    estacionalidad: estacionalidad(datos),
    canasta: datos.canasta ?? [],
  };
}
