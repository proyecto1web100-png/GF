// Servidor estatico minimo para previsualizar el sitio en local.
//
// Ademas sirve de arnes de captura: con ?cap=<estado> inyecta un script que
// deja la pagina en un estado concreto (modal cerrado, ofertas abiertas,
// carrito con un producto, etc.) para poder fotografiarla sin tocar los
// archivos de produccion. Sin ?cap= el sitio se sirve tal cual.
const http = require('http');
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..', 'Script Principal', 'web_temp');
// Las fotos de producto viven en hosts externos (i.ibb.co y compania). Grabar
// los clips una y otra vez dispara cientos de pedidos en pocos minutos y el
// host termina rechazandolos: las tarjetas salen en blanco o con el texto
// alternativo. Se guardan en disco la primera vez y de ahi en adelante salen
// de local, que ademas hace las grabaciones reproducibles.
const CACHE = path.join(__dirname, 'cache-img');
fs.mkdirSync(CACHE, { recursive: true });
const TIPOS = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.css':'text/css',
                '.png':'image/png', '.jpg':'image/jpeg', '.svg':'image/svg+xml', '.ico':'image/x-icon' };

// Cada estado se alcanza con las mismas funciones que usa el sitio.
const ESTADOS = {
  hero:      `window.scrollTo(0,0);`,
  // Estado base para grabar video: todo cargado y visible, sin mover la
  // pagina. El guion del clip decide despues a donde ir.
  listo:     `forzarCerca();
              await esperarImagenes();
              document.documentElement.style.scrollBehavior='auto';
              window.scrollTo(0,0);`,
  ofertas:   `document.getElementById('liqToggle')?.click(); await esperar(1400);
              document.getElementById('liqGrid')?.scrollIntoView({block:'start'}); await esperar(500);`,
  catalogo:  `forzarCerca();
              await esperarImagenes();
              await esperar(600);
              encuadrar('coleccion', 10);
              await esperar(1500);`,
  // Las tarjetas de producto nacen en opacity 0 y esperan al observador de
  // scroll; en headless no alcanza a dispararse, asi que se fuerzan visibles.
  productos: `forzarCerca();
              await esperarImagenes();
              await esperar(600);
              encuadrar('productsGrid', 60);
              await esperar(1500);`,
  carrito:   `const b=document.querySelector('#productsGrid [data-cart-key]');
              if(b){ cartAdd(b.dataset.cartKey); } await esperar(300);
              if(typeof cartRender==='function') cartRender();
              document.querySelector('[onclick*="cartToggle"],#cartBtn,.cart-btn')?.click();
              await esperar(2400);`,
  // El overlay de cuenta se queda a opacidad parcial en headless (su transicion
  // no termina de aplicarse), asi que se fuerza el estado final a mano.
  cuenta:    `if(typeof accAbrir==="function"){ accAbrir(); } await esperar(1200);
              const ov=document.getElementById('accountOverlay');
              if(ov){ ov.style.transition='none'; ov.style.opacity='1'; ov.style.visibility='visible';
                      ov.querySelectorAll('*').forEach(el=>{ el.style.transition='none';
                        const o=parseFloat(getComputedStyle(el).opacity); if(o<1) el.style.opacity='1'; }); }
              await esperar(700);`,
  contacto:  `forzarCerca();
              await esperarImagenes();
              await esperar(600);
              encuadrar('contacto', 10);
              await esperar(900);`,
};

const ARNES = (estado) => `
<script>
(async function(){
  const esperar = ms => new Promise(r=>setTimeout(r,ms));
  // En Chrome headless window.scrollTo casi no se refleja en la captura: la
  // foto sale en el tope de la pagina. Se encuadra moviendo el documento con
  // un margen negativo, que si queda plasmado en el pixel.
  // Con el viewport fijado por el protocolo de depuracion (fotografiar.mjs)
  // el desplazamiento normal si queda reflejado en la captura.
  // Las imagenes de producto son remotas: forzarlas visibles no basta, hay
  // que esperar a que terminen de descargar o la foto sale con huecos.
  //
  // Dos trampas aprendidas a golpes:
  //  - Justo despues de asignar src, el navegador puede seguir reportando
  //    complete === true por un instante, y la espera terminaba antes de
  //    empezar. Por eso se deja pasar un momento antes de mirar.
  //  - complete === true tambien vale para una imagen que fallo. Lo que
  //    dice si hay pixeles de verdad es naturalWidth.
  // El sitio crea imagenes al vuelo (las miniaturas del carrito, por ejemplo)
  // apuntando al host externo, que se saltan el cache. Se vigila el documento
  // y se reescribe cualquier imagen externa en cuanto aparece.
  const alCache = (u) => '/img?u=' + encodeURIComponent(u);
  const redirigir = (img) => {
    const u = img.getAttribute('src');
    if (u && /^https?:/.test(u) && !u.startsWith(location.origin)) img.src = alCache(u);
  };
  new MutationObserver((cambios) => {
    for (const c of cambios) {
      for (const n of c.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.tagName === 'IMG') redirigir(n);
        n.querySelectorAll?.('img').forEach(redirigir);
      }
      if (c.type === 'attributes' && c.target.tagName === 'IMG') redirigir(c.target);
    }
  }).observe(document.documentElement,
             { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });

  const esperarImagenes = async (limite = 30000) => {
    await esperar(400);
    const t0 = Date.now();
    let quietas = 0;
    while (Date.now() - t0 < limite) {
      const faltan = [...document.images]
        .filter(i => i.src && (!i.complete || i.naturalWidth === 0)).length;
      // dos vueltas seguidas sin pendientes: recien ahi se da por cargado
      quietas = faltan === 0 ? quietas + 1 : 0;
      if (quietas >= 2) return;
      await esperar(250);
    }
  };
  // Revelar las tarjetas y pedir sus fotos, pero SOLO las que estan cerca de
  // la ventana. Pedir las 466 de golpe hace que el host de imagenes rechace
  // buena parte por exceso de peticiones, y quedan rotas justo las que se
  // estaban filmando.
  const forzarCerca = (margen = 2200) => {
    const tope = window.scrollY - margen;
    const piso = window.scrollY + window.innerHeight + margen;
    document.querySelectorAll('.product-card').forEach(c => {
      const y = c.getBoundingClientRect().top + window.scrollY;
      if (y > piso || y + c.offsetHeight < tope) return;
      c.classList.add('visible'); c.style.opacity = '1'; c.style.transform = 'none';
      c.querySelectorAll('img.lazy[data-src]').forEach(i => {
        if (!i.dataset.src) return;
        // por el cache local, no directo al host externo
        i.src = /^https?:/.test(i.dataset.src)
          ? '/img?u=' + encodeURIComponent(i.dataset.src)
          : i.dataset.src;
        i.classList.remove('lazy');
      });
    });
  };

  // Los guiones de grabacion (grabar.mjs) corren en el ambito global y las
  // necesitan tambien.
  window.esperarImagenes = esperarImagenes;
  window.forzarCerca = forzarCerca;
  const encuadrar = (id, margen) => {
    const e = document.getElementById(id); if (!e) return;
    const y = e.getBoundingClientRect().top + window.scrollY;
    document.documentElement.style.scrollBehavior = 'auto';
    window.scrollTo(0, Math.max(0, y - margen));
  };
  await esperar(3200);                     // deja cargar productos desde Sheets
  // Cerrar los popups de captacion que se abren solos (bienvenida y comunidad
  // de WhatsApp). Se quita el OVERLAY completo, no el modal interior: si queda
  // el overlay, su capa oscura tapa toda la pagina.
  // Los overlays que abre el usuario (carrito, cuenta, menu) NO se tocan: los
  // estados de captura los necesitan.
  ['clientOverlay', 'communityOverlay'].forEach(id => document.getElementById(id)?.remove());
  document.body.style.overflow='auto';
  await esperar(400);
  try { ${ESTADOS[estado] || ''} } catch(e) { console.error('arnes:', e); }
  // marca para saber que el estado ya quedo listo
  document.title = 'LISTO — ' + document.title;
})();
</script>`;

const servirCacheada = async (url, res) => {
  const clave = require('crypto').createHash('sha1').update(url).digest('hex');
  const archivo = path.join(CACHE, clave);
  const tipoArchivo = archivo + '.tipo';

  if (fs.existsSync(archivo)) {
    const tipo = fs.existsSync(tipoArchivo) ? fs.readFileSync(tipoArchivo, 'utf8') : 'image/jpeg';
    res.writeHead(200, { 'Content-Type': tipo, 'Cache-Control': 'max-age=31536000' });
    return res.end(fs.readFileSync(archivo));
  }
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r.ok) { res.writeHead(502); return res.end('origen: ' + r.status); }
    const buf = Buffer.from(await r.arrayBuffer());
    const tipo = r.headers.get('content-type') || 'image/jpeg';
    fs.writeFileSync(archivo, buf);
    fs.writeFileSync(tipoArchivo, tipo);
    res.writeHead(200, { 'Content-Type': tipo, 'Cache-Control': 'max-age=31536000' });
    res.end(buf);
  } catch (e) {
    res.writeHead(502); res.end('fallo: ' + e.message);
  }
};

http.createServer((req, res) => {
  const [rutaCruda, query] = decodeURIComponent(req.url).split('?');
  if (rutaCruda === '/img') {
    const url = new URLSearchParams(query || '').get('u');
    if (!url) { res.writeHead(400); return res.end('falta u'); }
    return servirCacheada(url, res);
  }
  let ruta = rutaCruda === '/' ? '/index.html' : rutaCruda;
  const archivo = path.join(RAIZ, ruta);
  if (!archivo.startsWith(RAIZ)) { res.writeHead(403); return res.end('no'); }

  fs.readFile(archivo, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('no encontrado: ' + ruta); }
    const cap = new URLSearchParams(query || '').get('cap');
    if (cap && archivo.endsWith('.html')) {
      const html = buf.toString('utf8').replace('</body>', ARNES(cap) + '</body>');
      res.writeHead(200, { 'Content-Type': TIPOS['.html'] });
      return res.end(html);
    }
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(archivo)] || 'application/octet-stream' });
    res.end(buf);
  });
// Escucha en todas las interfaces para poder abrirlo desde el telefono u otra
// PC de la red local. Es el sitio publico de la tienda: no expone nada privado.
}).listen(3030, '0.0.0.0', () => {
  console.log('sitio en http://localhost:3030  (y en la red local por la IP de esta PC)');
});
