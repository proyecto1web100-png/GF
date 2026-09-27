// Servidor local del dashboard. Solo escucha en 127.0.0.1: nada de esto
// queda expuesto a la red de la tienda.

import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { analizarTodo } from "./analytics.js";
import { analizarConIA, construirResumen } from "./ai.js";

const aqui = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.dirname(aqui);
const RUTA_DATOS = path.join(raiz, "cache", "datos.json");
const RUTA_IA = path.join(raiz, "cache", "analisis-ia.json");

const cfg = JSON.parse(fs.readFileSync(path.join(raiz, "config.json"), "utf8"));
const PUERTO = cfg?.servidor?.puerto ?? 4000;

function leerDatos() {
  if (!fs.existsSync(RUTA_DATOS)) return null;
  // PowerShell puede dejar BOM al inicio del archivo
  const bruto = fs.readFileSync(RUTA_DATOS, "utf8").replace(/^﻿/, "");
  return JSON.parse(bruto);
}

// Vuelve a leer RMS ejecutando el extractor de PowerShell
function refrescarDesdeRMS() {
  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(aqui, "rms-export.ps1")],
      { timeout: 300000, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) return reject(new Error((stderr || stdout || error.message).trim()));
        resolve((stdout || "").trim());
      }
    );
  });
}

let cache = null;
function analisisActual({ forzar = false } = {}) {
  if (cache && !forzar) return cache;
  const datos = leerDatos();
  if (!datos) return null;
  cache = analizarTodo(datos, cfg);
  return cache;
}

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(raiz, "web")));

app.get("/api/analisis", (req, res) => {
  const a = analisisActual();
  if (!a) {
    return res.status(503).json({
      error: "Todavia no hay datos. Usa el boton 'Actualizar desde RMS'.",
    });
  }
  res.json({ ...a, negocio: cfg.negocio, iaHabilitada: Boolean(cfg?.ia?.apiKey) });
});

app.post("/api/refrescar", async (req, res) => {
  try {
    const salida = await refrescarDesdeRMS();
    cache = null;
    const a = analisisActual({ forzar: true });
    res.json({ ok: true, mensaje: salida, generado: a?.generado ?? null });
  } catch (e) {
    res.status(500).json({ error: "No se pudo leer RMS: " + e.message });
  }
});

app.get("/api/resumen", (req, res) => {
  const a = analisisActual();
  if (!a) return res.status(503).json({ error: "Sin datos." });
  res.type("text/plain; charset=utf-8").send(construirResumen(a, cfg));
});

app.post("/api/analisis-ia", async (req, res) => {
  const a = analisisActual();
  if (!a) return res.status(503).json({ error: "Sin datos." });
  try {
    const r = await analizarConIA(a, cfg);
    fs.writeFileSync(RUTA_IA, JSON.stringify(r, null, 2), "utf8");
    res.json(r);
  } catch (e) {
    res.status(e.code === "SIN_API_KEY" ? 400 : 500).json({ error: e.message });
  }
});

// Ultimo analisis guardado, para no volver a pagar la llamada al abrir el panel
app.get("/api/analisis-ia", (req, res) => {
  if (!fs.existsSync(RUTA_IA)) return res.json(null);
  res.json(JSON.parse(fs.readFileSync(RUTA_IA, "utf8")));
});

app.listen(PUERTO, "127.0.0.1", () => {
  console.log(`Gaby's Fashion - Analitica en http://localhost:${PUERTO}`);
  if (!fs.existsSync(RUTA_DATOS)) {
    console.log("Aviso: no hay datos todavia. Usa 'Actualizar desde RMS' en el panel.");
  }
});
