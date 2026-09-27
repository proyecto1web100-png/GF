// Arma la lista de invitacion a la comunidad de WhatsApp, segmentada.
// Uso: node src/campana-whatsapp.js
// Deja el CSV en cache/campana-comunidad-whatsapp.csv

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { clientes } from "./analytics.js";

const aqui = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.dirname(aqui);

const datos = JSON.parse(
  fs.readFileSync(path.join(raiz, "cache", "datos.json"), "utf8").replace(/^﻿/, "")
);
const C = clientes(datos);

// No se invita a un sorteo a quien debe y no aparece: primero se cobra, y esa
// conversacion no se mezcla con una promocion.
//   DIAS_SIN_ABONAR: cuanto tiempo sin abonar ya cuenta como moroso.
//   SALDO_MINIMO: por debajo de esto el saldo es un residuo olvidado y no
//   justifica sacar a un cliente bueno de la campana.
const DIAS_SIN_ABONAR = 180;
const SALDO_MINIMO = 100;

const mora = new Map((datos.mora ?? []).map((m) => [m.CustomerID, m]));
const esMoroso = (c) => {
  const m = mora.get(c.id);
  if (!m) return false;
  if ((m.saldo ?? 0) < SALDO_MINIMO) return false;
  // Sin abonos registrados: se juzga por la antiguedad del documento mas viejo
  const dias = m.dias_ultimo_abono ?? m.dias_doc_mas_viejo ?? 0;
  return dias > DIAS_SIN_ABONAR;
};

// Solo sirve quien tenga telefono: la comunidad es por WhatsApp.
const conTel = C.todos.filter(
  (c) => String(c.telefono || "").replace(/\D/g, "").length >= 8 && !esMoroso(c)
);

const excluidos = C.todos
  .filter((c) => esMoroso(c))
  .map((c) => {
    const m = mora.get(c.id);
    return {
      nombre: c.nombre,
      telefono: c.telefono,
      saldo: Math.round(m.saldo),
      diasSinAbonar: m.dias_ultimo_abono ?? m.dias_doc_mas_viejo,
      segmento: c.segmento,
    };
  })
  .sort((a, b) => b.diasSinAbonar - a.diasSinAbonar);

const usados = new Set();
const tomar = (filtro, cuantos, orden = (a, b) => b.total - a.total) => {
  const elegidos = conTel
    .filter((c) => !usados.has(c.id) && filtro(c))
    .sort(orden)
    .slice(0, cuantos);
  for (const c of elegidos) usados.add(c.id);
  return elegidos;
};

// Los grupos se llenan en orden de escasez: primero los que tienen pocos
// candidatos disponibles, para que no se los lleve un grupo mas amplio.
const grupos = [];

// 1) Recurrentes buenos: campeones y leales que siguen activos.
grupos.push({
  nombre: "1. Recurrente bueno",
  meta: 35,
  clientes: tomar((c) => c.segmento === "campeon" || c.segmento === "leal", 35),
});

// 2) Por irse o muy cerca: se estan enfriando pero todavia se recuperan.
grupos.push({
  nombre: "3. Por irse",
  meta: 40,
  clientes: tomar((c) => c.segmento === "en_riesgo", 40),
});

// 3) Normales eventuales: compran de vez en cuando, sin patron fuerte.
grupos.push({
  nombre: "2. Eventual",
  meta: 40,
  clientes: tomar((c) => c.segmento === "ocasional" || c.segmento === "nuevo", 40),
});

// 4) Ya se fueron: se priorizan los que mas gastaron, que son los que mas
//    vale la pena intentar recuperar.
grupos.push({
  nombre: "4. Se fue",
  meta: 30,
  clientes: tomar((c) => c.segmento === "perdido", 30),
});

// Si algun grupo quedo corto, se completa con los mas parecidos que sobren:
// clientes perdidos recientes para "eventual", que es el grupo mas elastico.
const eventual = grupos.find((g) => g.nombre === "2. Eventual");
if (eventual.clientes.length < eventual.meta) {
  const faltan = eventual.meta - eventual.clientes.length;
  const relleno = tomar(
    (c) => c.segmento === "perdido" && c.compras <= 3,
    faltan,
    (a, b) => (a.recencia ?? 9999) - (b.recencia ?? 9999)
  );
  eventual.clientes.push(...relleno);
  eventual.relleno = relleno.length;
}

// ── salida ───────────────────────────────────────────────────
const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const filas = [];
for (const g of grupos) {
  for (const c of g.clientes) {
    filas.push([
      g.nombre,
      c.nombre,
      c.referencia,
      c.telefono,
      c.compras,
      Math.round(c.total),
      Math.round(c.ticket),
      c.ultimaCompra ?? "",
      c.recencia ?? "",
      c.cadencia ?? "",
      c.saldo > 0 ? Math.round(c.saldo) : "",
    ]);
  }
}

const encabezado = [
  "Grupo", "Cliente", "Referencia", "Telefono", "Compras", "Total historico",
  "Ticket promedio", "Ultima compra", "Dias sin venir", "Compra cada (dias)", "Saldo fiado",
];

const csv =
  "﻿" + [encabezado, ...filas].map((f) => f.map(esc).join(",")).join("\r\n");
const salida = path.join(raiz, "cache", "campana-comunidad-whatsapp.csv");
fs.writeFileSync(salida, csv, "utf8");

// Resumen en consola
console.log("Clientes identificados:", C.todos.length, "| con telefono usable:", conTel.length);
for (const g of grupos) {
  const val = g.clientes.reduce((s, c) => s + c.total, 0);
  console.log(
    `${g.nombre.padEnd(22)} ${String(g.clientes.length).padStart(3)}/${g.meta}` +
      `  valor historico L. ${Math.round(val).toLocaleString("es-HN")}` +
      (g.relleno ? `  (${g.relleno} de relleno)` : "")
  );
}
console.log("Total en la lista:", filas.length);
console.log("CSV:", salida);

// ── excluidos por mora ───────────────────────────────────────
const csvMora =
  "﻿" +
  [
    ["Cliente", "Telefono", "Saldo", "Dias sin abonar", "Segmento"],
    ...excluidos.map((e) => [e.nombre, e.telefono, e.saldo, e.diasSinAbonar, e.segmento]),
  ]
    .map((f) => f.map(esc).join(","))
    .join("\r\n");
fs.writeFileSync(path.join(raiz, "cache", "excluidos-por-mora.csv"), csvMora, "utf8");

console.log("");
console.log(`Excluidos por mora (mas de ${DIAS_SIN_ABONAR} dias sin abonar y saldo >= L. ${SALDO_MINIMO}): ${excluidos.length}`);
console.log("Saldo total de los excluidos: L. " + excluidos.reduce((s, e) => s + e.saldo, 0).toLocaleString("es-HN"));
for (const e of excluidos.slice(0, 12)) {
  console.log(`  ${e.nombre.padEnd(34)} L. ${String(e.saldo).padStart(6)}  ${String(e.diasSinAbonar).padStart(5)} dias  (${e.segmento})`);
}
