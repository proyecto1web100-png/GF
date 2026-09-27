// Fotografia estados del sitio local para el video.
//
// Chrome headless por linea de comandos ignora --window-size y dimensiona la
// captura por el contenido, asi que el encuadre salia mal o en negro. Aqui se
// habla el protocolo de depuracion directamente: el viewport se fija a mano y
// la foto se recorta a un rectangulo exacto. Sin dependencias externas.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CHROME = 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe';
const BASE = 'http://localhost:3030';
const DEST = path.join(import.meta.dirname, '..', 'video-anuncio', 'anuncio-gabys', 'assets', 'pantallas');
const ANCHO = 492, ALTO = 1032, ESCALA = 2;   // proporcion exacta de la pantalla del mockup (538x1128)

const estados = process.argv.slice(2);
if (!estados.length) { console.error('uso: node fotografiar.mjs <estado>...'); process.exit(1); }

const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'foto-'));
const puerto = 9333;
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--mute-audio',
  `--remote-debugging-port=${puerto}`, `--user-data-dir=${perfil}`,
  `--window-size=${ANCHO},${ALTO}`, 'about:blank',
], { stdio: 'ignore' });

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// El puerto tarda un instante en abrir.
let version = null;
for (let i = 0; i < 60 && !version; i++) {
  try { version = await (await fetch(`http://127.0.0.1:${puerto}/json/version`)).json(); }
  catch { await dormir(250); }
}
if (!version) { chrome.kill(); throw new Error('Chrome no abrio el puerto de depuracion'); }

const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));

let id = 0;
const pendientes = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pendientes.has(m.id)) {
    const { ok, mal } = pendientes.get(m.id);
    pendientes.delete(m.id);
    m.error ? mal(new Error(m.error.message)) : ok(m.result);
  }
});
const enviar = (method, params = {}, sessionId) => new Promise((ok, mal) => {
  const n = ++id;
  pendientes.set(n, { ok, mal });
  ws.send(JSON.stringify({ id: n, method, params, sessionId }));
});

for (const estado of estados) {
  const { targetId } = await enviar('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await enviar('Target.attachToTarget', { targetId, flatten: true });

  await enviar('Emulation.setDeviceMetricsOverride', {
    width: ANCHO, height: ALTO, deviceScaleFactor: ESCALA, mobile: true,
  }, sessionId);
  await enviar('Page.enable', {}, sessionId);
  await enviar('Page.navigate', { url: `${BASE}/?cap=${estado}` }, sessionId);

  // El arnes de captura marca el titulo cuando el estado ya quedo montado.
  let listo = false;
  for (let i = 0; i < 200 && !listo; i++) {
    await dormir(250);
    const r = await enviar('Runtime.evaluate', {
      expression: 'document.title.startsWith("LISTO")', returnByValue: true,
    }, sessionId);
    listo = r.result.value === true;
  }
  await dormir(600);

  // Sin 'clip': con recorte, las coordenadas son del documento y no del
  // viewport, asi que la foto salia siempre desde el tope de la pagina.
  const { data } = await enviar('Page.captureScreenshot', {
    format: 'png', captureBeyondViewport: false,
  }, sessionId);

  const destino = path.join(DEST, `${estado}.png`);
  fs.writeFileSync(destino, Buffer.from(data, 'base64'));
  const b = fs.readFileSync(destino);
  console.log(`  ${estado.padEnd(10)} ${b.readUInt32BE(16)}x${b.readUInt32BE(20)}  ${(b.length / 1024) | 0}KB  ${listo ? '' : '(sin marca LISTO)'}`);

  await enviar('Target.closeTarget', { targetId });
}

ws.close();
chrome.kill();
try { fs.rmSync(perfil, { recursive: true, force: true }); } catch { /* Chrome tarda en soltar el perfil */ }
