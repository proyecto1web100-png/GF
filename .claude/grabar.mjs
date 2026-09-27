// Graba clips de video del sitio local para meterlos dentro del mockup del
// telefono. Usa el screencast del protocolo de depuracion: el navegador emite
// un fotograma cada vez que repinta, con su marca de tiempo, y con esas marcas
// se arma el MP4. Asi el clip refleja el movimiento real de la pagina en vez
// de una sucesion de capturas sueltas.
//
//   node grabar.mjs <clip>...
//
// Los guiones de cada clip viven en GUIONES: son las mismas funciones que usa
// el sitio (cartAdd, accAbrir), no un simulacro.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CHROME = 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe';
const FFMPEG = path.join(import.meta.dirname, '..', 'video-anuncio', 'anuncio-gabys',
                         'herramientas', 'ffmpeg-9.0.1-essentials_build', 'bin', 'ffmpeg.exe');
const BASE = 'http://localhost:3030';
const DEST = path.join(import.meta.dirname, '..', 'video-anuncio', 'anuncio-gabys', 'assets', 'clips');

// La pantalla del mockup mide 538x1128 CSS y se graba al doble: 1076x2256.
// El clip se guarda a esa resolucion nativa, sin reducir. Guardarlo a 538
// obligaba a ampliarlo despues, y al renderizar en 4K la pantalla del
// telefono -- lo que mas se mira -- salia borrosa.
const ANCHO = 538, ALTO = 1128, ESCALA = 2;

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// ── guiones ────────────────────────────────────────────────
// Cada guion corre dentro de la pagina y devuelve cuando termino. El arnes de
// captura (servir-web.js) ya dejo el estado base listo.
const GUIONES = {
  // Recorrido por el catalogo: desplazamiento continuo y parejo.
  catalogo: `
    const g = document.getElementById('productsGrid');
    const desde = g.getBoundingClientRect().top + window.scrollY - 90;
    // Sin pasarse del final de la rejilla: mas abajo empieza "Quienes Somos"
    // y el recorrido deja de ser una demostracion del catalogo.
    const hasta = Math.min(desde + 1450, desde + g.scrollHeight - 1000);
    document.documentElement.style.scrollBehavior = 'auto';
    window.scrollTo(0, desde);
    // Las tarjetas nacen en diferido; si no se fuerzan, el video sale con
    // recuadros blancos donde deberian ir las fotos.
    forzarCerca();
    await esperarImagenes(6000);
    await esperar(700);
    const t0 = performance.now(), dur = 5200;
    while (true) {
      const p = Math.min(1, (performance.now() - t0) / dur);
      // suave al entrar y al salir: nada de arranques y frenazos secos
      const e = p < 0.5 ? 2*p*p : 1 - Math.pow(-2*p + 2, 2) / 2;
      window.scrollTo(0, desde + (hasta - desde) * e);
      if (p >= 1) break;
      await new Promise(r => requestAnimationFrame(r));
    }
    await esperar(600);
  `,

  // Elegir dos articulos y abrir el carrito.
  carrito: `
    // Las tarjetas que entran al desplazarse vuelven a nacer en diferido, asi
    // que se fuerzan otra vez antes de cada toma o las fotos salen en blanco.
    const forzar = () => forzarCerca();   // solo las tarjetas cercanas
    const g = document.getElementById('productsGrid');
    document.documentElement.style.scrollBehavior = 'auto';
    window.scrollTo(0, g.getBoundingClientRect().top + window.scrollY - 90);
    forzar(); await esperar(400);

    const botones = [...document.querySelectorAll('#productsGrid [data-cart-key]')].slice(0, 3);
    for (const b of botones) {
      b.scrollIntoView({ block: 'center', behavior: 'smooth' });
      await esperar(450);
      forzar();
      b.style.transform = 'scale(0.94)';    // acuse visible del toque
      await esperar(130);
      b.style.transform = '';
      b.click();
      await esperar(650);
    }
    await esperar(300);
    openCart();                             // el sitio no tiene cartToggle
    // las miniaturas del panel se piden recien al abrirlo: hay que darles aire
    await esperar(4200);
  `,

  // Abrir el boton de Ofertas y recorrer la cascada de articulos.
  ofertas: `
    const t = document.getElementById('liqToggle');

    t.scrollIntoView({ block: 'center' });
    await esperar(900);
    t.style.transform = 'scale(0.98)';
    await esperar(150);
    t.style.transform = '';
    t.click();
    await esperar(2200);                    // la cascada se revela sola
    const grid = document.getElementById('liqGrid');
    const desde = window.scrollY;
    const hasta = desde + Math.min(1100, grid.scrollHeight - 200);
    const t0 = performance.now(), dur = 3600;
    while (true) {
      const p = Math.min(1, (performance.now() - t0) / dur);
      const e = p < 0.5 ? 2*p*p : 1 - Math.pow(-2*p + 2, 2) / 2;
      window.scrollTo(0, desde + (hasta - desde) * e);
      if (p >= 1) break;
      await new Promise(r => requestAnimationFrame(r));
    }
    await esperar(700);
  `,

  // Crear la cuenta, entrar, y recorrer saldo y compras.
  //
  // PRIVACIDAD: no se registra ni se consulta a nadie real. accRegistrar,
  // accCheckTel y accVerSaldo hablan con el servidor; ninguno se llama. La
  // sesion se arma en el navegador y los paneles se pintan a mano con las
  // mismas plantillas del sitio, con cifras inventadas.
  cuenta: `
    const tecleá = async (el, texto, ms = 80) => {
      el.focus();
      for (const c of texto) {
        el.value += c;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        await esperar(ms);
      }
    };
    const pulsar = async (el) => {
      el.style.transform = 'scale(0.97)';
      await esperar(140);
      el.style.transform = '';
      await esperar(320);
    };

    // ── el numero ──────────────────────────────────────────
    accAbrir();
    await esperar(1100);
    await tecleá(document.getElementById('accTel'), '9876-5432');
    await esperar(500);
    await pulsar(document.getElementById('accTelBtn'));

    // ── crear la cuenta ────────────────────────────────────
    document.getElementById('accEcoNuevo').textContent = '9876-5432';
    accIr('accStepNuevo');
    await esperar(900);
    await tecleá(document.getElementById('accNombre'), 'Maria Ejemplo', 95);
    await esperar(450);
    await tecleá(document.getElementById('accPass1'), 'miclave1', 90);
    await esperar(350);
    await tecleá(document.getElementById('accPass2'), 'miclave1', 90);
    await esperar(600);
    await pulsar(document.getElementById('accNuevoBtn'));
    await esperar(700);

    // ── ya adentro ─────────────────────────────────────────
    GF_USER = { telefono: '9876-5432', nombre: 'Maria Ejemplo',
                sesion: 'demo', tieneSaldo: true, pendiente: false };
    accPintarCuenta();
    accIr('accStepCuenta');
    await esperar(2000);

    // ── estado de cuenta ───────────────────────────────────
    await pulsar(document.getElementById('accBtnSaldo'));
    accIr('accStepSaldo');
    document.getElementById('accSaldoCargando').style.display = 'block';
    document.getElementById('accSaldoCuerpo').style.display = 'none';
    await esperar(850);                     // el mismo respiro que la carga real
    document.getElementById('accSaldoCargando').style.display = 'none';
    const saldo = document.getElementById('accSaldoCuerpo');
    saldo.style.display = 'block';
    saldo.innerHTML =
      '<div class="acc-saldo-box">' +
        '<div class="acc-saldo-lbl">Saldo pendiente</div>' +
        '<div class="acc-saldo-num">L. 1,250.00</div>' +
        '<div class="acc-saldo-sub">Credito otorgado: L. 3,000.00</div>' +
        '<div class="acc-saldo-sub">Ultimo abono: L. 500.00 &middot; 28/08/2026</div>' +
      '</div>' +
      '<div class="acc-abonos"><div class="acc-abonos-tit">Mis abonos</div>' +
        '<div class="acc-abono-row"><span class="fecha">28/08/2026</span><span class="monto">L. 500.00</span></div>' +
        '<div class="acc-abono-row"><span class="fecha">14/08/2026</span><span class="monto">L. 750.00</span></div>' +
        '<div class="acc-abono-row"><span class="fecha">02/08/2026</span><span class="monto">L. 500.00</span></div>' +
      '</div>' +
      '<button class="client-btn" style="width:100%;margin-top:1.2rem;">Quiero abonar</button>';
    await esperar(3000);

    // ── ultimas compras ────────────────────────────────────
    accIr('accStepCuenta');
    await esperar(900);
    const btnCompras = document.querySelectorAll('#accStepCuenta .acc-menu-btn')[1];
    await pulsar(btnCompras);
    accIr('accStepCompras');
    document.getElementById('accComprasCargando').style.display = 'block';
    document.getElementById('accComprasCuerpo').style.display = 'none';
    await esperar(850);
    document.getElementById('accComprasCargando').style.display = 'none';
    const compras = document.getElementById('accComprasCuerpo');
    compras.style.display = 'block';
    compras.innerHTML =
      '<div class="acc-compras">' +
        '<div class="acc-compra"><div class="acc-compra-fila">' +
          '<span class="acc-compra-fecha">28/08/2026</span>' +
          '<span class="acc-compra-total">L. 1,530.00</span></div>' +
          '<div class="acc-compra-det">Base Loreal Infalible &middot; Corrector La Colors</div></div>' +
        '<div class="acc-compra"><div class="acc-compra-fila">' +
          '<span class="acc-compra-fecha">14/08/2026</span>' +
          '<span class="acc-compra-total">L. 2,430.00</span></div>' +
          '<div class="acc-compra-det">Cepillo Secadora Pelo Revlon</div></div>' +
        '<div class="acc-compra"><div class="acc-compra-fila">' +
          '<span class="acc-compra-fecha">02/08/2026</span>' +
          '<span class="acc-compra-total">L. 950.00</span></div>' +
          '<div class="acc-compra-det">Crema contorno de ojos Timewise</div></div>' +
      '</div>';
    await esperar(3200);
  `,
};

// ── clips paso a paso ──────────────────────────────────────
// El screencast filma en tiempo real y solo emite cuando el navegador
// repinta: a doble resolucion se queda en ~40 fps y un desplazamiento
// continuo pierde fluidez. Para los clips que son puro movimiento calculado
// no hace falta filmar: se posiciona la pagina en el fotograma N, se saca la
// foto, y se repite. Sale exacto a 60 fps aunque tarde mas en grabarse.
const PASOS = {
  catalogo: {
    fotogramas: 330,                        // 5.5s a 60 fps
    preparar: `
      const g = document.getElementById('productsGrid');
      window.__desde = g.getBoundingClientRect().top + window.scrollY - 90;
      window.__hasta = Math.min(window.__desde + 1450,
                                window.__desde + g.scrollHeight - 1000);
      document.documentElement.style.scrollBehavior = 'auto';
      // Recorrer una vez todo el tramo pidiendo las fotos de cada tramo, y
      // recien despues volver al inicio a filmar. Pedirlas solo desde la
      // posicion de arranque dejaba entrar tarjetas sin imagen a mitad del
      // recorrido, porque la carga sigue en curso mientras se avanza.
      for (let k = 0; k <= 10; k++) {
        window.scrollTo(0, window.__desde + (window.__hasta - window.__desde) * (k / 10));
        forzarCerca();
        await esperar(120);
      }
      await esperarImagenes(12000);
      window.scrollTo(0, window.__desde);
      await esperar(300);
    `,
    // p va de 0 a 1; el reposo del principio y del final es parte del plano
    paso: `
      const arranque = 0.10, frenada = 0.94;
      let q = (p - arranque) / (frenada - arranque);
      q = Math.max(0, Math.min(1, q));
      const e = q < 0.5 ? 2*q*q : 1 - Math.pow(-2*q + 2, 2) / 2;
      window.scrollTo(0, window.__desde + (window.__hasta - window.__desde) * e);
    `,
  },
};

// ── preparacion ────────────────────────────────────────────
// Lo que hay que dejar listo ANTES de empezar a filmar. Si esto viviera en
// el guion, el calentamiento saldria en el clip.
const PREPARACION = {
  // Pedir las imagenes de la rejilla y esperarlas aca, no en el guion: si la
  // espera queda filmada, el clip se estira con varios segundos de pagina
  // quieta justo antes de la accion.
  carrito: `
    const g = document.getElementById('productsGrid');
    document.documentElement.style.scrollBehavior = 'auto';
    window.scrollTo(0, g.getBoundingClientRect().top + window.scrollY - 90);
    forzarCerca();
    await esperarImagenes(9000);
  `,

  // Las tarjetas de oferta no existen hasta que se abre la seccion, asi que
  // no se pueden precargar sin abrirla. Se abre y se cierra fuera de camara
  // para que las fotos queden en cache y la toma real entre con imagen.
  ofertas: `
    const t = document.getElementById('liqToggle');
    t.click();
    await esperar(1400);
    document.querySelectorAll('#liqGrid img.lazy[data-src]').forEach(i => {
      if (i.dataset.src) { i.src = i.dataset.src; i.classList.remove('lazy'); } });
    // Solo se tocan las imagenes. Marcar las tarjetas como visibles dejaria
    // opacidad en linea que sobrevive al cierre, y la cascada de la toma real
    // aparecería toda de golpe en vez de escalonarse.
    await esperarImagenes(9000);
    t.click();
    await esperar(1000);
  `,
};

// ── arranque del navegador ─────────────────────────────────
const clips = process.argv.slice(2);
if (!clips.length) { console.error('uso: node grabar.mjs <clip>...'); process.exit(1); }
fs.mkdirSync(DEST, { recursive: true });

const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'grab-'));
const puerto = 9344;
const chrome = spawn(CHROME, [
  '--headless=new', '--hide-scrollbars', '--mute-audio',
  `--remote-debugging-port=${puerto}`, `--user-data-dir=${perfil}`,
  '--force-color-profile=srgb', 'about:blank',
], { stdio: 'ignore' });

let version = null;
for (let i = 0; i < 80 && !version; i++) {
  try { version = await (await fetch(`http://127.0.0.1:${puerto}/json/version`)).json(); }
  catch { await dormir(250); }
}
if (!version) { chrome.kill(); throw new Error('Chrome no abrio el puerto de depuracion'); }

const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));

let id = 0;
const pendientes = new Map();
const oyentes = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pendientes.has(m.id)) {
    const { ok, mal } = pendientes.get(m.id);
    pendientes.delete(m.id);
    m.error ? mal(new Error(m.error.message)) : ok(m.result);
  } else if (m.method) {
    for (const f of oyentes) f(m);
  }
});
const enviar = (method, params = {}, sessionId) => new Promise((ok, mal) => {
  const n = ++id;
  pendientes.set(n, { ok, mal });
  ws.send(JSON.stringify({ id: n, method, params, sessionId }));
});

// ── grabacion ──────────────────────────────────────────────
for (const clip of clips) {
  const guion = GUIONES[clip];
  if (!guion) { console.error(`  ${clip}: sin guion`); continue; }

  const { targetId } = await enviar('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await enviar('Target.attachToTarget', { targetId, flatten: true });
  await enviar('Emulation.setDeviceMetricsOverride', {
    width: ANCHO, height: ALTO, deviceScaleFactor: ESCALA, mobile: true,
  }, sessionId);
  await enviar('Page.enable', {}, sessionId);
  await enviar('Page.navigate', { url: `${BASE}/?cap=listo` }, sessionId);

  let listo = false;
  for (let i = 0; i < 200 && !listo; i++) {
    await dormir(250);
    const r = await enviar('Runtime.evaluate', {
      expression: 'document.title.startsWith("LISTO")', returnByValue: true,
    }, sessionId);
    listo = r.result.value === true;
  }

  // camara apagada todavia
  if (PREPARACION[clip]) {
    await enviar('Runtime.evaluate', {
      expression: `(async () => { const esperar = ms => new Promise(r=>setTimeout(r,ms)); ${PREPARACION[clip]} })()`,
      awaitPromise: true,
    }, sessionId);
  }

  const crudos = fs.mkdtempSync(path.join(os.tmpdir(), `${clip}-`));

  if (PASOS[clip]) {
    const { fotogramas, preparar, paso } = PASOS[clip];
    await enviar('Runtime.evaluate', {
      expression: `(async () => { const esperar = ms => new Promise(r=>setTimeout(r,ms)); ${preparar} })()`,
      awaitPromise: true,
    }, sessionId);
    for (let i = 0; i < fotogramas; i++) {
      await enviar('Runtime.evaluate', {
        expression: `(() => { const p = ${i} / ${fotogramas - 1}; ${paso} })()`,
      }, sessionId);
      const { data } = await enviar('Page.captureScreenshot',
        { format: 'jpeg', quality: 94, captureBeyondViewport: false }, sessionId);
      fs.writeFileSync(path.join(crudos, `${String(i).padStart(5, '0')}.jpg`),
                       Buffer.from(data, 'base64'));
    }
    const salidaP = path.join(DEST, `${clip}.mp4`);
    const rp = spawnSync(FFMPEG, [
      '-y', '-framerate', '60', '-i', path.join(crudos, '%05d.jpg'),
      '-vf', `scale=${ANCHO * ESCALA}:${ALTO * ESCALA}:flags=lanczos`,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'slow',
      '-movflags', '+faststart', salidaP,
    ], { encoding: 'utf8' });
    const kbP = fs.existsSync(salidaP) ? (fs.statSync(salidaP).size / 1024) | 0 : 0;
    console.log(`  ${clip.padEnd(10)} ${fotogramas} fotogramas · ${(fotogramas / 60).toFixed(1)}s · ${kbP}KB  (paso a paso, 60 fps exactos)` +
                (rp.status === 0 ? '' : `
${rp.stderr?.slice(-600)}`));
    fs.rmSync(crudos, { recursive: true, force: true });
    await enviar('Target.closeTarget', { targetId });
    continue;
  }

  const marcas = [];
  let n = 0;
  // Los fotogramas se acumulan en memoria y se escriben al final. Grabarlos a
  // disco aqui bloquea el hilo de eventos entre uno y otro, y el screencast
  // -- que solo emite cuando el hilo esta libre -- se quedaba en ~34 fps.
  const buffer = [];
  const onFrame = (m) => {
    if (m.method !== 'Page.screencastFrame' || m.sessionId !== sessionId) return;
    // el acuse va primero: hasta que no llega, Chrome no manda el siguiente
    enviar('Page.screencastFrameAck', { sessionId: m.params.sessionId }, sessionId).catch(() => {});
    buffer.push(m.params.data);
    marcas.push(m.params.metadata.timestamp);
    n++;
  };
  oyentes.push(onFrame);

  await enviar('Page.startScreencast', {
    format: 'jpeg', quality: 92, everyNthFrame: 1,
    maxWidth: ANCHO * ESCALA, maxHeight: ALTO * ESCALA,
  }, sessionId);

  await enviar('Runtime.evaluate', {
    expression: `(async () => { const esperar = ms => new Promise(r=>setTimeout(r,ms)); ${guion} })()`,
    awaitPromise: true,
  }, sessionId);

  await enviar('Page.stopScreencast', {}, sessionId);
  oyentes.splice(oyentes.indexOf(onFrame), 1);
  await dormir(300);

  buffer.forEach((datos, i) => {
    fs.writeFileSync(path.join(crudos, `${String(i).padStart(5, '0')}.jpg`),
                     Buffer.from(datos, 'base64'));
  });

  // Las marcas vienen en segundos; se convierten en un guion de concatenacion
  // para que ffmpeg respete el ritmo real en vez de asumir cadencia fija.
  const lista = path.join(crudos, 'lista.txt');
  const lineas = [];
  for (let i = 0; i < n; i++) {
    const d = i < n - 1 ? Math.max(0.001, marcas[i + 1] - marcas[i]) : 1 / 60;
    lineas.push(`file '${String(i).padStart(5, '0')}.jpg'`, `duration ${d.toFixed(5)}`);
  }
  if (n) lineas.push(`file '${String(n - 1).padStart(5, '0')}.jpg'`);
  fs.writeFileSync(lista, lineas.join('\n'));

  const salida = path.join(DEST, `${clip}.mp4`);
  const r = spawnSync(FFMPEG, [
    '-y', '-f', 'concat', '-safe', '0', '-i', lista,
    '-vf', `fps=60,scale=${ANCHO * ESCALA}:${ALTO * ESCALA}:flags=lanczos`,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'slow',
    '-movflags', '+faststart', salida,
  ], { encoding: 'utf8' });

  const dur = n > 1 ? (marcas[n - 1] - marcas[0]).toFixed(1) : '0';
  const kb = fs.existsSync(salida) ? (fs.statSync(salida).size / 1024) | 0 : 0;
  console.log(`  ${clip.padEnd(10)} ${n} fotogramas · ${dur}s · ${kb}KB` +
              (r.status === 0 ? '' : `\n${r.stderr?.slice(-600)}`));

  fs.rmSync(crudos, { recursive: true, force: true });
  await enviar('Target.closeTarget', { targetId });
}

ws.close();
chrome.kill();
try { fs.rmSync(perfil, { recursive: true, force: true }); } catch { /* Chrome tarda en soltarlo */ }
