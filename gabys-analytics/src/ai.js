// Capa de IA: manda SOLO agregados a la API de Claude.
// Nunca salen de esta PC nombres, telefonos ni saldos individuales de clientes.

import Anthropic from "@anthropic-ai/sdk";

const MODELO_POR_DEFECTO = "claude-opus-5";

// Construye el resumen que ve el modelo. Tambien es lo que descarga el boton
// "exportar resumen", asi que debe ser legible por una persona.
export function construirResumen(a, cfg) {
  const m = cfg?.negocio?.moneda ?? "L.";
  const dinero = (n) => `${m} ${Math.round(n).toLocaleString("es-HN")}`;
  const pct = (n) => (n === null || n === undefined ? "s/d" : `${n}%`);
  const L = [];

  L.push(`NEGOCIO: ${cfg?.negocio?.nombre ?? "tienda de ropa"} (Honduras, moneda ${m})`);
  L.push(`Datos generados: ${a.generado}`);
  L.push("");

  L.push("== VENTAS Y MARGEN POR ANIO (anios completos) ==");
  L.push("anio | venta | costo | utilidad | margen% | transacciones | ticket promedio");
  for (const y of a.ventas.anual) {
    L.push(
      `${y.anio} | ${dinero(y.venta)} | ${dinero(y.costo)} | ${dinero(y.utilidad)} | ${y.margen}% | ${y.transacciones} | ${dinero(y.ticket)}`
    );
  }
  L.push("");

  L.push("== MISMO PERIODO DEL ANIO (del 1 de enero a la fecha de hoy, comparable) ==");
  L.push("anio | venta | margen% | transacciones | clientes | ticket");
  for (const y of a.ventas.ytd) {
    L.push(`${y.anio} | ${dinero(y.venta)} | ${y.margen}% | ${y.transacciones} | ${y.clientes} | ${dinero(y.ticket)}`);
  }
  const c = a.ventas.comparativo;
  L.push(
    `Variacion contra el mismo periodo del anio pasado: venta ${pct(c.ventaPct)}, transacciones ${pct(c.transaccionesPct)}, ticket ${pct(c.ticketPct)}, clientes ${pct(c.clientesPct)}, margen ${c.margenPuntos ?? "s/d"} puntos.`
  );
  L.push("");

  L.push("== MARGEN POR CATEGORIA: cambio entre el primer y el ultimo anio disponible ==");
  L.push("categoria | margen antes% | margen ahora% | cambio en puntos | venta actual");
  for (const x of a.categorias.cambiosMargen.slice(0, 12)) {
    L.push(`${x.categoria} | ${x.margenAntes}% | ${x.margenAhora}% | ${x.puntos} | ${dinero(x.ventaAhora)}`);
  }
  L.push("");

  const p = a.productos.totales;
  L.push("== INVENTARIO ==");
  L.push(`Items con existencia: ${p.itemsConStock}. Capital invertido a costo: ${dinero(p.capitalTotal)}.`);
  L.push(
    `IMPORTANTE: la antiguedad se mide desde el ULTIMO INGRESO de la mercaderia a la tienda, no desde que se creo el codigo de producto. Un codigo puede existir hace anios y el inventario actual haber llegado el mes pasado.`
  );
  L.push(
    `Capital dormido (lleva mas de ${p.diasCiclo} dias en la tienda y no rota; se excluyen los codigos dados de alta en el ultimo anio): ${dinero(p.capitalDormido)} = ${p.pctDormido}% del inventario, en ${p.itemsDormidos} items.`
  );
  L.push(
    `  De ese dormido, ${dinero(p.dormidoNunca)} en ${p.itemsDormidoNunca} items NUNCA vendieron ni una unidad (error de compra desde el inicio), y ${dinero(p.dormidoSaldo)} en ${p.itemsDormidoSaldo} items son el saldo rezagado de productos que si llegaron a venderse (talla o color que sobro).`
  );
  L.push(
    `En observacion (entre 90 y ${p.diasCiclo} dias en la tienda sin moverse): ${dinero(p.capitalObservacion)} en ${p.itemsObservacion} items. NO cuentan como capital muerto.`
  );
  L.push(
    `Mercaderia nueva (menos de 90 dias en la tienda, no se juzga): ${dinero(p.capitalNuevo)} en ${p.itemsNuevos} items.`
  );
  L.push(
    `Recomprado sin rotar (mercaderia recien llegada, pero de codigos que llevaban mas de ${p.diasCiclo} dias en el catalogo sin venderse): ${dinero(p.capitalRecomprado)} en ${p.itemsRecomprados} items. No es capital dormido; es una decision de compra a revisar.`
  );
  L.push(
    `Codigos duplicados (el producto si se vende, pero bajo otro codigo de RMS): ${dinero(p.capitalDuplicado)} en ${p.itemsDuplicados} items. Excluidos del capital dormido.`
  );
  L.push(`Clasificacion ABC por utilidad: A=${a.productos.abc.A}, B=${a.productos.abc.B}, C=${a.productos.abc.C} items.`);
  L.push(`Productos agotados que si rotaban (posible venta perdida): ${p.quiebres} items, que en 12 meses vendieron ${dinero(p.ventaPerdidaEstimada)}.`);
  L.push("");
  L.push("Top 10 productos por utilidad en 12 meses (nombre | unidades | venta | utilidad | margen%):");
  for (const i of a.productos.topUtilidad.slice(0, 10)) {
    L.push(`- ${i.nombre} | ${i.unidades12m} | ${dinero(i.venta12m)} | ${dinero(i.utilidad12m)} | ${i.margen}%`);
  }
  L.push("");
  L.push("Top 10 capital dormido (nombre | stock | capital | dias en inventario | origen):");
  for (const i of a.productos.dormido.slice(0, 10)) {
    L.push(
      `- ${i.nombre} | ${i.stock} | ${dinero(i.capital)} | ${i.diasEnTienda ?? "s/d"} | ${i.origen === "nunca" ? "nunca vendio" : "saldo restante"}`
    );
  }
  L.push("");
  L.push("Top 10 recomprado sin rotar (nombre | capital | ingreso a tienda | ultima venta):");
  for (const i of a.productos.recompradoSinRotar.slice(0, 10)) {
    L.push(`- ${i.nombre} | ${dinero(i.capital)} | ${i.ingreso ?? "s/d"} | ${i.ultimaVenta ?? "nunca vendido"}`);
  }
  L.push("");
  L.push("Capital dormido por categoria:");
  const porCat = {};
  for (const i of a.productos.dormido) porCat[i.categoria] = (porCat[i.categoria] ?? 0) + i.capital;
  for (const [cat, v] of Object.entries(porCat).sort((x, y) => y[1] - x[1]).slice(0, 8)) {
    L.push(`- ${cat}: ${dinero(v)}`);
  }
  L.push("");
  L.push("Top 10 agotados que rotaban (nombre | unidades 12m | venta 12m):");
  for (const i of a.productos.quiebres.slice(0, 10)) {
    L.push(`- ${i.nombre} | ${i.unidades12m} | ${dinero(i.venta12m)}`);
  }
  L.push("");

  L.push("== CLIENTES (agregado, sin datos personales) ==");
  L.push(`Clientes identificados con al menos una compra: ${a.clientes.total}.`);
  L.push("segmento | clientes | venta historica");
  for (const [seg, v] of Object.entries(a.clientes.porSegmento)) {
    L.push(`${seg} | ${v.clientes} | ${dinero(v.venta)}`);
  }
  L.push(
    `Concentracion: el 10% de mejores clientes (${a.clientes.concentracion.clientesTop10} personas) genera el ${a.clientes.concentracion.pctVenta}% de la venta identificada.`
  );
  L.push(
    `En riesgo de fuga con 3 o mas compras previas: ${a.clientes.enRiesgo.length}. Ya perdidos con historial: ${a.clientes.perdidos.length}. En ventana de recompra ahora mismo: ${a.clientes.probables.length}.`
  );
  L.push("");

  L.push("== CUENTAS POR COBRAR (fiado) ==");
  L.push(`Saldo total pendiente: ${dinero(a.cxc.total)}. Vencido a mas de 60 dias: ${dinero(a.cxc.vencido)} (${a.cxc.pctVencido}%).`);
  for (const r of a.cxc.rangos) L.push(`${r.nombre}: ${dinero(r.saldo)} en ${r.docs} documentos`);
  L.push("");

  L.push("== ESTACIONALIDAD (indice 100 = mes promedio) ==");
  L.push(a.estacionalidad.meses.map((x) => `${x.nombre}:${x.indice}`).join("  "));
  L.push("Venta por dia de semana (ultimos 2 anios):");
  L.push(a.estacionalidad.semana.map((x) => `${x.nombre}:${dinero(x.venta)}`).join("  "));

  return L.join("\n");
}

const SISTEMA = `Eres un analista de negocios con experiencia en retail de ropa en Honduras.
Analizas los datos reales de una tienda pequena y contestas en espanol claro, directo, sin jerga corporativa.

Reglas:
- Trabaja SOLO con los numeros que te dan. Si algo no se puede concluir con esos datos, dilo en vez de inventar.
- Prioriza por impacto en dinero: primero lo que mas cuesta o mas ingreso genera.
- Cada recomendacion debe ser algo que la duena pueda hacer esta semana con lo que tiene, no un proyecto de consultoria.
- Cuantifica siempre que puedas ("recuperar X lempiras", "son Y clientes").
- Cuidado con las conclusiones de volumen bajo: este negocio hace pocas transacciones, asi que no trates variaciones pequenas como tendencias.

Estructura tu respuesta con estos titulos exactos en markdown:
## Lo que esta funcionando
## Lo que esta fallando
## Las 5 acciones con mas impacto
## Que vigilar de cerca`;

export async function analizarConIA(analisis, cfg) {
  const apiKey = cfg?.ia?.apiKey || process.env.ANTHROPIC_API_KEY || "";
  if (!apiKey) {
    const err = new Error(
      "No hay API key configurada. Agregala en config.json (ia.apiKey) o exporta ANTHROPIC_API_KEY. Mientras tanto podes usar el boton de exportar resumen."
    );
    err.code = "SIN_API_KEY";
    throw err;
  }

  const client = new Anthropic({ apiKey });
  const modelo = cfg?.ia?.modelo || MODELO_POR_DEFECTO;
  const resumen = construirResumen(analisis, cfg);

  const peticion = {
    model: modelo,
    max_tokens: 16000,
    system: SISTEMA,
    thinking: { type: "adaptive" },
    messages: [
      {
        role: "user",
        content: `Estos son los datos reales del negocio extraidos del punto de venta. Analizalos.\n\n${resumen}`,
      },
    ],
  };

  let respuesta;
  try {
    // Fallback del lado del servidor: si el modelo declina, la API reintenta
    // sola con otro modelo dentro de la misma llamada.
    respuesta = await client.beta.messages.create({
      ...peticion,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
  } catch (e) {
    // Si esta cuenta no tiene el beta habilitado, se usa la llamada normal.
    respuesta = await client.messages.create(peticion);
  }

  if (respuesta.stop_reason === "refusal") {
    throw new Error("El modelo declino responder a esta solicitud.");
  }

  const texto = respuesta.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  return {
    texto,
    modelo: respuesta.model,
    uso: respuesta.usage,
    generado: new Date().toISOString(),
  };
}
