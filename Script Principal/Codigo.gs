// ════════════════════════════════════════════════════════════
//  Gaby's Fashion — Google Apps Script v8
//  Cambios vs v7:
//    - Limpieza de productos repetidos (limpiarProductosDuplicados)
//    - Fotos en Cloudinary (contarImagenesImgbb, migrarImagenesACloudinary)
//  Cambios de v7 (vs v6):
//    - Corregida la llave faltante en out() (rompia el archivo)
//    - handleProductos: escritura por lotes (2 llamadas en vez de ~40 000)
//    - handleVentas / banners / categorias: encabezado + datos en un solo setValues
//    - Nueva funcion diagnostico() para probar permisos desde el editor
// ════════════════════════════════════════════════════════════

const SHEET_ID = '1V2p26r-2bUhQOH2_VOBVJ15V-qKrp_MQmPrJ-TZZBDw';
const SECRET   = 'GF2025_k9xQm7pL';

function doGet(e) {
  const ss = SpreadsheetApp.openById(SHEET_ID);

  if (e.parameter.type === 'config') {
    try {
      const sheet = ss.getSheetByName('Config');
      if (!sheet) return out('{}');
      const data = sheet.getDataRange().getValues();
      const cfg  = {};
      for (let i = 1; i < data.length; i++) { if (data[i][0]) cfg[data[i][0]] = data[i][1]; }
      return out(JSON.stringify(cfg));
    } catch (err) { return out('{}'); }
  }

  if (e.parameter.type === 'banners') {
    try {
      const sheet = ss.getSheetByName('Banners');
      if (!sheet) return out('[]');
      const data    = sheet.getDataRange().getValues();
      const banners = [];
      for (let i = 1; i < data.length; i++) {
        if (data[i][0]) banners.push({ imagen: data[i][0], titulo: data[i][1], subtitulo: data[i][2] });
      }
      return out(JSON.stringify(banners));
    } catch (err) { return out('[]'); }
  }

  if (e.parameter.type === 'ventas') {
    try {
      const readSheet = (name) => {
        const sh = ss.getSheetByName(name);
        if (!sh || sh.getLastRow() < 2) return [];
        const rows    = sh.getDataRange().getValues();
        const headers = rows[0].map(h => h.toString().toLowerCase().trim());
        return rows.slice(1).map(r => {
          const obj = {};
          headers.forEach((h, i) => {
            const v = r[i];
            if (v instanceof Date) {
              // Siempre devolver fecha como yyyy-MM-dd
              const yyyy = v.getFullYear();
              const mm   = String(v.getMonth() + 1).padStart(2, '0');
              const dd   = String(v.getDate()).padStart(2, '0');
              obj[h] = yyyy + '-' + mm + '-' + dd;
            } else {
              obj[h] = v !== undefined ? v.toString() : '';
            }
          });
          return obj;
        });
      };
      const result = {
        ventasDia:    readSheet('VentasDia'),
        topProductos: readSheet('TopProductos'),
        ventasCat:    readSheet('VentasCat'),
        resumen:      readSheet('ResumenVentas')[0] || {}
      };
      return out(JSON.stringify(result));
    } catch (err) { return out(JSON.stringify({ error: err.message })); }
  }

  return out(JSON.stringify({ status: 'Gaby\'s Fashion API activa' }));
}

function doPost(e) {
  try {
    let data = {};
    // Intentar leer del body primero
    try {
      if (e.postData && e.postData.contents) {
        data = JSON.parse(e.postData.contents);
      }
    } catch (parseErr) {}

    // Fallback: leer de query params (para no-cors con text/plain)
    if (!data.type && e.parameter && e.parameter.type) {
      data = e.parameter;
    }

    // Cliente no necesita token (viene del sitio publico)
    if (data.type === 'cliente') return handleCliente(data);

    // Cuentas de cliente: tampoco llevan SECRET (el sitio es publico).
    // Cada una valida lo suyo: clave, sesion firmada o nombre exacto de RMS.
    if (data.type === 'auth_check')    return handleAuthCheck(data);
    if (data.type === 'auth_register') return handleAuthRegister(data);
    if (data.type === 'auth_login')    return handleAuthLogin(data);
    if (data.type === 'auth_saldo')    return handleAuthSaldo(data);
    if (data.type === 'auth_update')   return handleAuthUpdate(data);
    if (data.type === 'auth_quiz')     return handleAuthQuiz(data);
    if (data.type === 'auth_verificar') return handleAuthVerificarCompra(data);
    if (data.type === 'auth_compras')  return handleAuthCompras(data);

    if (data.token !== SECRET) {
      return out(JSON.stringify({ ok: false, error: 'No autorizado' }));
    }

    const type = data.type;

    if (data.products !== undefined) return handleProductos(data);
    if (type === 'productos_fin')    return handleProductosFin(data);
    if (type === 'subir_imagen')     return handleSubirImagen(data); // solo desde el panel
    if (type === 'banners')          return handleBanners(data);
    if (type === 'config')           return handleConfig(data);
    if (type === 'categorias')       return handleCategorias(data);
    if (type === 'clientes_rewrite') return handleClientesRewrite(data);
    if (type === 'ventas')           return handleVentas(data);
    if (type === 'auth_reset')       return handleAuthReset(data);   // solo desde el panel
    if (type === 'auth_activar')     return handleAuthActivar(data); // solo desde el panel
    if (type === 'auth_aprobar')     return handleAuthAprobar(data); // solo desde el panel
    if (type === 'auth_reintento')   return handleAuthReintento(data); // solo desde el panel
    if (type === 'auth_borrar')      return handleAuthBorrar(data);  // solo desde el panel
    if (type === 'cobros')           return handleCobrosPanel(data); // solo desde el panel
    if (type === 'cuentas_web')      return handleCuentasWeb(data);  // solo desde el panel

    return ok('tipo desconocido: ' + type);
  } catch (err) {
    return out(JSON.stringify({ ok: false, error: err.message }));
  }
}

// ── PRODUCTOS ────────────────────────────────────────────────
//  Optimizado: 1 lectura + 2 escrituras por bloque.
//  Antes hacia un setValue por celda (~10 por producto).
const PROD_HEADERS = ['nombre','categoria','subcategoria','precio','descripcion','cantidad','emoji','imagen','nuevo','oculto'];
const PROD_COL = { nombre:0, categoria:1, subcategoria:2, precio:3, descripcion:4, cantidad:5, emoji:6, imagen:7, nuevo:8, oculto:9 };

function handleProductos(data) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return escribirProductos(data);
  } finally {
    lock.releaseLock();
  }
}

function escribirProductos(data) {
  const ss        = SpreadsheetApp.openById(SHEET_ID);
  const sheet     = ss.getSheets()[0];
  const productos = data.products || [];
  const NCOL      = PROD_HEADERS.length;
  // El panel solo edita lo que ya esta en la hoja. Si pudiera agregar filas,
  // un panel abierto desde antes de una limpieza volveria a crear los
  // repetidos al guardar. Las filas nuevas solo las crea el sync de RMS.
  const soloActualizar = data.soloActualizar === true;

  // 1) Asegurar la fila de encabezados
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, NCOL).setValues([PROD_HEADERS]).setFontWeight('bold');
  } else if (sheet.getRange(1, 1).getValue() !== 'nombre') {
    sheet.insertRowBefore(1);
    sheet.getRange(1, 1, 1, NCOL).setValues([PROD_HEADERS]).setFontWeight('bold');
  }

  if (!productos.length) return ok('0 productos procesados, 0 nuevos agregados');

  // 2) Leer TODAS las filas existentes de una sola vez
  const nFilas  = Math.max(sheet.getLastRow() - 1, 0);
  const valores = nFilas ? sheet.getRange(2, 1, nFilas, NCOL).getValues() : [];

  // Mapa nombre -> indice de fila (0 = primera fila de datos)
  const idx = {};
  for (let i = 0; i < valores.length; i++) {
    const k = String(valores[i][PROD_COL.nombre] || '').toLowerCase().trim();
    if (k && idx[k] === undefined) idx[k] = i;
  }

  // Aplica los campos de un producto sobre una fila (arreglo de 10 celdas)
  const aplicar = (fila, p) => {
    fila[PROD_COL.nombre]    = p.nombre    || '';
    fila[PROD_COL.categoria] = p.categoria || '';
    fila[PROD_COL.precio]    = p.precio    || '';
    fila[PROD_COL.cantidad]  = (p.cantidad !== undefined) ? p.cantidad : '';
    // Estos campos se editan a mano en la hoja: solo se pisan si RMS manda algo
    if (p.subcategoria !== undefined && p.subcategoria !== '') fila[PROD_COL.subcategoria] = p.subcategoria;
    if (p.descripcion  !== undefined && p.descripcion  !== '') fila[PROD_COL.descripcion]  = p.descripcion;
    if (p.emoji        !== undefined && p.emoji        !== '') fila[PROD_COL.emoji]        = p.emoji;
    if (p.imagen       !== undefined && p.imagen       !== '') fila[PROD_COL.imagen]       = p.imagen;
    if (p.nuevo        !== undefined) fila[PROD_COL.nuevo]  = p.nuevo;
    if (p.oculto       !== undefined) fila[PROD_COL.oculto] = p.oculto;
    return fila;
  };

  // 3) Repartir entre "actualizar" y "agregar"
  const nuevos     = [];
  const idxNuevos  = {};   // nombre -> indice dentro de nuevos (evita duplicar en el mismo bloque)
  let actualizados = 0;

  productos.forEach(p => {
    // Lo que manda RMS se repara ("NiÃ±a" -> "Niña") para que coincida con
    // la fila buena y no cree otra. Lo del panel no: trae el nombre tal como
    // esta en la hoja y repararlo lo haria pisar otra fila.
    if (!soloActualizar) p.nombre = repararTexto(p.nombre);
    const key = String(p.nombre || '').toLowerCase().trim();
    if (!key) return;

    if (idx[key] !== undefined) {
      aplicar(valores[idx[key]], p);
      actualizados++;
    } else if (soloActualizar) {
      return;
    } else if (idxNuevos[key] !== undefined) {
      aplicar(nuevos[idxNuevos[key]], p);
    } else {
      const fila = new Array(NCOL).fill('');
      idxNuevos[key] = nuevos.length;
      nuevos.push(aplicar(fila, p));
    }
  });

  // 4) Escribir: una llamada para lo actualizado, otra para lo nuevo
  if (valores.length) sheet.getRange(2, 1, valores.length, NCOL).setValues(valores);
  if (nuevos.length)  sheet.getRange(2 + valores.length, 1, nuevos.length, NCOL).setValues(nuevos);

  return ok(productos.length + ' productos procesados, ' + actualizados + ' actualizados, ' + nuevos.length + ' nuevos agregados');
}

// ── LIMPIEZA DE PRODUCTOS ────────────────────────────────────
//  Por que habia repetidos: la hoja solo agrega o actualiza por nombre, nunca
//  borra. Cuando el sync mandaba "NiÃ±a" en vez de "Niña", se crearon filas
//  con el nombre dañado. Al corregirse la tipografia, RMS empezo a mandar el
//  nombre bueno, que no coincide con el dañado, y se agrego otra fila. La
//  dañada quedo para siempre con la cantidad vieja (RMS ya no la actualiza).
//
//  handleProductosFin: el sync manda al final la lista completa de nombres
//  de RMS y se quitan las filas que ya no estan ahi (dañadas, repetidas o
//  productos que se desactivaron).
//  limpiarProductosDuplicados: lo mismo pero sin RMS, para correrlo a mano.
//
//  Nada se pierde: las filas quitadas se copian a la hoja ProductosEliminados,
//  y la foto/descripcion/subcategoria/emoji de una fila dañada pasa a la
//  buena si la buena no tiene.

// Contenido que se carga a mano en la hoja (no viene de RMS) y que se pasa de
// la fila dañada a la buena. "oculto" y "nuevo" NO: si alguien oculto la
// dañada justamente por estar repetida, no hay que ocultar tambien la buena.
const PROD_MANUALES = ['subcategoria','descripcion','emoji','imagen'];

// Caracteres de Windows-1252 en 0x80-0x9F que no coinciden con Latin-1
const CP1252_BYTE = {
  0x20AC:0x80, 0x201A:0x82, 0x0192:0x83, 0x201E:0x84, 0x2026:0x85, 0x2020:0x86,
  0x2021:0x87, 0x02C6:0x88, 0x2030:0x89, 0x0160:0x8A, 0x2039:0x8B, 0x0152:0x8C,
  0x017D:0x8E, 0x2018:0x91, 0x2019:0x92, 0x201C:0x93, 0x201D:0x94, 0x2022:0x95,
  0x2013:0x96, 0x2014:0x97, 0x02DC:0x98, 0x2122:0x99, 0x0161:0x9A, 0x203A:0x9B,
  0x0153:0x9C, 0x017E:0x9E, 0x0178:0x9F
};

// Decodifica bytes UTF-8; devuelve null si no son UTF-8 valido
function utf8Estricto(bytes) {
  let s = '', i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    if (b < 0x80) { s += String.fromCharCode(b); i++; continue; }
    let n, cp;
    if (b >= 0xC2 && b <= 0xDF)      { n = 1; cp = b & 0x1F; }
    else if (b >= 0xE0 && b <= 0xEF) { n = 2; cp = b & 0x0F; }
    else if (b >= 0xF0 && b <= 0xF4) { n = 3; cp = b & 0x07; }
    else return null;
    if (i + n >= bytes.length) return null;
    for (let k = 1; k <= n; k++) {
      const c = bytes[i + k];
      if ((c & 0xC0) !== 0x80) return null;
      cp = (cp << 6) | (c & 0x3F);
    }
    s += String.fromCodePoint(cp);
    i += n + 1;
  }
  return s;
}

// "NiÃ±a" -> "Niña". Si el texto no es de ese tipo de daño, lo deja igual.
function repararTexto(s) {
  let t = String(s == null ? '' : s);
  for (let vuelta = 0; vuelta < 2; vuelta++) {
    if (!/[Â-Å][\u0080-¿Œ-™]/.test(t)) break;
    const bytes = [];
    for (const ch of t) {
      const c = ch.codePointAt(0);
      if (c <= 0xFF) bytes.push(c);
      else if (CP1252_BYTE[c] !== undefined) bytes.push(CP1252_BYTE[c]);
      else return t;
    }
    const r = utf8Estricto(bytes);
    if (r === null || r === t) break;
    t = r;
  }
  return t;
}

// Nombre dañado: con el caracter de reemplazo, un "?" o restos tipo "Ã"
function esSospechoso(s) {
  return /[�?ÂÃ]/.test(String(s || ''));
}

function claveProducto(s) {
  return repararTexto(s).toLowerCase().replace(/\s+/g, ' ').trim();
}

// "ni?a" / "ni�a" (irrecuperables) -> patron que acepta "niña"
function patronComodin(clave) {
  const partes = clave.split(/[�?]+/);
  if (partes.length < 2) return null;
  return new RegExp('^' + partes.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^\\s]{1,2}') + '$');
}

function vacio(v) { return v === '' || v === null || v === undefined; }

// Pasa a la fila que se queda lo que se edito a mano en la que se va
function fusionarManuales(destino, origen) {
  PROD_MANUALES.forEach(c => {
    const i = PROD_COL[c];
    if (vacio(destino[i]) && !vacio(origen[i])) destino[i] = origen[i];
  });
}

// nombresRMS: lista completa de nombres de RMS, o null para limpiar sin RMS.
function depurarProductos(nombresRMS) {
  const ss     = SpreadsheetApp.openById(SHEET_ID);
  const sheet  = ss.getSheets()[0];
  const ANCHO  = Math.max(sheet.getLastColumn(), PROD_HEADERS.length);
  const nFilas = Math.max(sheet.getLastRow() - 1, 0);
  const res    = { antes: nFilas, quedan: nFilas, eliminadas: 0, renombradas: 0 };
  if (!nFilas) return res;

  const valores = sheet.getRange(2, 1, nFilas, ANCHO).getValues();
  const nombre  = v => String(v[PROD_COL.nombre] || '');
  const exacta  = v => nombre(v).toLowerCase().trim();
  const enRMS   = nombresRMS
    ? new Set(nombresRMS.map(n => repararTexto(n).toLowerCase().trim()).filter(Boolean))
    : null;

  // 1) Filas buenas: las que estan en RMS (o, sin RMS, las de nombre sano).
  //    De repetidas exactas se queda la primera.
  const queda    = valores.map(() => false);
  const vistas   = {};
  const porClave = {};
  valores.forEach((v, i) => {
    const k = exacta(v);
    if (!k) { queda[i] = true; return; }   // fila sin nombre: no se toca
    const buena = enRMS ? enRMS.has(k) : !esSospechoso(nombre(v));
    if (buena && vistas[k] === undefined) {
      vistas[k] = i;
      queda[i]  = true;
      const c = claveProducto(nombre(v));
      if (porClave[c] === undefined) porClave[c] = i;
    }
  });

  // 2) Las demas: si son la version dañada de una buena, le pasan sus datos
  //    manuales y se van. Si no tienen pareja: con RMS se van (ya no existen);
  //    sin RMS se repara el nombre si se puede y se quedan.
  const eliminadas = [];
  const ahora = new Date();
  valores.forEach((v, i) => {
    if (queda[i]) return;
    const c = claveProducto(nombre(v));
    let j = porClave[c];
    if (j === undefined) {
      const re = patronComodin(c);
      if (re) {
        const m = Object.keys(porClave).filter(k => re.test(k));
        if (m.length === 1) j = porClave[m[0]];
      }
    }
    if (j !== undefined) {
      fusionarManuales(valores[j], v);
      eliminadas.push([ahora].concat(v, ['repetido de: ' + nombre(valores[j])]));
      return;
    }
    if (enRMS) {
      eliminadas.push([ahora].concat(v, ['ya no esta en RMS']));
      return;
    }
    const reparado = repararTexto(nombre(v));
    if (reparado !== nombre(v) && !esSospechoso(reparado)) {
      v[PROD_COL.nombre] = reparado;
      res.renombradas++;
    }
    queda[i] = true;
    const c2 = claveProducto(nombre(v));
    if (porClave[c2] === undefined) porClave[c2] = i;
  });

  if (!eliminadas.length && !res.renombradas) return res;

  // 3) Respaldo de lo quitado
  if (eliminadas.length) {
    let bk = ss.getSheetByName('ProductosEliminados');
    if (!bk) {
      bk = ss.insertSheet('ProductosEliminados', ss.getNumSheets());
      const enc = ['fecha_eliminado'].concat(sheet.getRange(1, 1, 1, ANCHO).getValues()[0], ['motivo']);
      bk.getRange(1, 1, 1, enc.length).setValues([enc]).setFontWeight('bold');
    }
    bk.getRange(bk.getLastRow() + 1, 1, eliminadas.length, eliminadas[0].length).setValues(eliminadas);
  }

  // 4) Reescribir la hoja solo con las que quedan
  const quedan = valores.filter((v, i) => queda[i]);
  if (quedan.length) sheet.getRange(2, 1, quedan.length, ANCHO).setValues(quedan);
  if (quedan.length < nFilas) sheet.deleteRows(2 + quedan.length, nFilas - quedan.length);

  res.quedan     = quedan.length;
  res.eliminadas = eliminadas.length;
  return res;
}

function handleProductosFin(data) {
  const nombres = data.nombres || [];
  // Si RMS no devolvio casi nada es un error de lectura, no una tienda vacia:
  // no se borra nada.
  if (nombres.length < 10) {
    return out(JSON.stringify({ ok: false, error: 'productos_fin: solo llegaron ' + nombres.length + ' nombres, no se limpia la hoja' }));
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const r = depurarProductos(nombres);
    return ok('limpieza: ' + r.antes + ' filas, ' + r.eliminadas + ' quitadas (repetidas o fuera de RMS), quedan ' + r.quedan);
  } finally {
    lock.releaseLock();
  }
}

// Correr a mano desde el editor de Apps Script para limpiar ya, sin esperar
// al proximo sync. Quita las filas dañadas que tienen su version buena y
// corrige el nombre de las que se pueden reparar.
function limpiarProductosDuplicados() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const r = depurarProductos(null);
    Logger.log('Filas antes: ' + r.antes + ' | quitadas: ' + r.eliminadas +
               ' | nombres corregidos: ' + r.renombradas + ' | quedan: ' + r.quedan);
    Logger.log('Las filas quitadas estan en la hoja ProductosEliminados.');
  } finally {
    lock.releaseLock();
  }
}

// ── FOTOS EN CLOUDINARY ──────────────────────────────────────
//  Las fotos estaban en ImgBB, que dejo de mostrarlas. Ahora van a
//  Cloudinary (plan gratis). Las credenciales NO van en el codigo: se ponen en
//  Configuracion del proyecto > Propiedades del script:
//    CLOUDINARY_CLOUD, CLOUDINARY_KEY, CLOUDINARY_SECRET
//
//  - handleSubirImagen: el panel manda la foto aqui y se sube a Cloudinary,
//    asi la clave nunca queda en la pagina.
//  - migrarImagenesACloudinary: correr a mano (las veces que haga falta) para
//    pasar las fotos que ya estan en ImgBB. Cloudinary las descarga directo
//    del enlace de ImgBB, asi que ImgBB tiene que estar respondiendo.

const CLD_MIGRADAS = 'gabys/imgbb';      // carpeta de las fotos traidas de ImgBB
const CLD_NUEVAS   = 'gabys/productos';  // carpeta de las que se suben desde el panel
const LOGO_IMGBB   = 'https://i.ibb.co/JRFYK77G/PHOTO-2026-05-25-15-58-59.jpg';

function cloudinaryCfg() {
  const p = PropertiesService.getScriptProperties();
  const cfg = {
    cloud:  (p.getProperty('CLOUDINARY_CLOUD')  || '').trim(),
    key:    (p.getProperty('CLOUDINARY_KEY')    || '').trim(),
    secret: (p.getProperty('CLOUDINARY_SECRET') || '').trim()
  };
  if (!cfg.cloud || !cfg.key || !cfg.secret) {
    throw new Error('Faltan CLOUDINARY_CLOUD, CLOUDINARY_KEY o CLOUDINARY_SECRET en Propiedades del script');
  }
  return cfg;
}

// Firma de Cloudinary: parametros ordenados "a=1&b=2" + secreto, en SHA-1
function firmaCloudinary(params, secret) {
  const texto = Object.keys(params).sort().map(k => k + '=' + params[k]).join('&') + secret;
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_1, texto, Utilities.Charset.UTF_8);
  return bytes.map(b => ((b & 0xFF) + 0x100).toString(16).slice(1)).join('');
}

// Arma el pedido de subida. file: un enlace (Cloudinary lo descarga) o un
// data URI "data:image/jpeg;base64,...".
function pedidoCloudinary(cfg, file, opciones) {
  const params = Object.assign({ timestamp: Math.floor(Date.now() / 1000) }, opciones);
  return {
    url: 'https://api.cloudinary.com/v1_1/' + cfg.cloud + '/image/upload',
    method: 'post',
    payload: Object.assign({}, params, { file: file, api_key: cfg.key, signature: firmaCloudinary(params, cfg.secret) }),
    muteHttpExceptions: true
  };
}

// Devuelve la secure_url o lanza error con el mensaje de Cloudinary
function leerRespuestaCloudinary(res) {
  let json = {};
  try { json = JSON.parse(res.getContentText()); } catch (e) {}
  if (res.getResponseCode() === 200 && json.secure_url) return json.secure_url;
  throw new Error('Cloudinary ' + res.getResponseCode() + ': ' + ((json.error && json.error.message) || res.getContentText().slice(0, 200)));
}

function handleSubirImagen(data) {
  const img = String(data.imagen || '');
  if (!/^data:image\/(jpeg|png|webp|gif);base64,/.test(img)) {
    return out(JSON.stringify({ ok: false, error: 'imagen invalida' }));
  }
  if (img.length > 14 * 1024 * 1024) {
    return out(JSON.stringify({ ok: false, error: 'imagen muy grande' }));
  }
  try {
    const cfg = cloudinaryCfg();
    const { url, ...opciones } = pedidoCloudinary(cfg, img, { folder: CLD_NUEVAS });
    const res = UrlFetchApp.fetch(url, opciones);
    return out(JSON.stringify({ ok: true, url: leerRespuestaCloudinary(res) }));
  } catch (err) {
    return out(JSON.stringify({ ok: false, error: err.message }));
  }
}

// Solo enlaces directos a la imagen (i.ibb.co/...). Los de la pagina de
// ImgBB (ibb.co/xxxx) son HTML y Cloudinary no los puede usar.
function esImgbbDirecto(v) {
  return /^https?:\/\/i\.ibb\.co\/\S+$/i.test(String(v || '').trim());
}

// Nombre fijo por foto: si se corre dos veces no se duplica en Cloudinary.
// https://i.ibb.co/JRFYK77G/foto.jpg -> gabys/imgbb/JRFYK77G_foto
function idCloudinaryDe(url) {
  const partes = String(url).trim().split('?')[0].split('/').slice(3);
  const limpio = partes.join('_').replace(/\.[a-z0-9]+$/i, '').replace(/[^A-Za-z0-9_-]/g, '_');
  return CLD_MIGRADAS + '/' + limpio;
}

// Prueba: solo cuenta cuantas fotos de ImgBB hay en cada hoja. No sube nada.
function contarImagenesImgbb() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let total = 0;
  const unicas = {};
  ss.getSheets().forEach(sh => {
    if (sh.getName() === 'ProductosEliminados' || sh.getLastRow() === 0) return;
    let n = 0;
    sh.getDataRange().getValues().forEach(fila => fila.forEach(v => {
      if (esImgbbDirecto(v)) { n++; unicas[String(v).trim()] = true; }
    }));
    if (n) Logger.log(sh.getName() + ': ' + n + ' celdas con foto de ImgBB');
    total += n;
  });
  Logger.log('Total: ' + total + ' celdas, ' + Object.keys(unicas).length + ' fotos distintas.');
  cloudinaryCfg();   // avisa ya si faltan las propiedades
  Logger.log('Credenciales de Cloudinary: configuradas.');
}

// Pasa las fotos de ImgBB a Cloudinary y cambia los enlaces en todas las
// hojas. Apps Script corta a los 6 minutos: si quedan fotos, lo dice en el
// registro y hay que volver a ejecutarla (sigue donde quedo).
function migrarImagenesACloudinary() {
  const cfg    = cloudinaryCfg();
  const inicio = Date.now();
  const LIMITE = 4.5 * 60 * 1000;
  const LOTE   = 8;
  const ss     = SpreadsheetApp.openById(SHEET_ID);

  const hojas = ss.getSheets().filter(sh => sh.getName() !== 'ProductosEliminados' && sh.getLastRow() > 0);
  const pendientes = {};
  pendientes[LOGO_IMGBB] = true;
  hojas.forEach(sh => sh.getDataRange().getValues().forEach(fila => fila.forEach(v => {
    if (esImgbbDirecto(v)) pendientes[String(v).trim()] = true;
  })));
  const urls = Object.keys(pendientes);
  Logger.log('Fotos de ImgBB por pasar: ' + urls.length);

  // 1) Subir en lotes paralelos
  const nuevas = {};
  const fallas = [];
  let i = 0;
  for (; i < urls.length && Date.now() - inicio < LIMITE; i += LOTE) {
    const lote = urls.slice(i, i + LOTE);
    const pedidos = lote.map(u => pedidoCloudinary(cfg, u, { public_id: idCloudinaryDe(u), overwrite: 'false' }));
    const resp = UrlFetchApp.fetchAll(pedidos);
    resp.forEach((r, k) => {
      try { nuevas[lote[k]] = leerRespuestaCloudinary(r); }
      catch (err) { fallas.push(lote[k] + ' -> ' + err.message); }
    });
  }
  const sinIntentar = Math.max(urls.length - i, 0);

  // 2) Cambiar los enlaces en las hojas. Por columna: si la columna no tiene
  //    formulas se escribe entera de una vez; si tiene, celda por celda.
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  let cambiadas = 0;
  try {
    hojas.forEach(sh => {
      const rango = sh.getDataRange();
      const vals  = rango.getValues();
      const nCols = vals[0].length;
      for (let c = 0; c < nCols; c++) {
        const filas = [];
        for (let r = 0; r < vals.length; r++) {
          const v = String(vals[r][c] || '').trim();
          if (esImgbbDirecto(v) && nuevas[v]) filas.push(r);
        }
        if (!filas.length) continue;
        const col = sh.getRange(1, c + 1, vals.length, 1);
        const tieneFormulas = col.getFormulas().some(f => f[0]);
        if (tieneFormulas) {
          filas.forEach(r => sh.getRange(r + 1, c + 1).setValue(nuevas[String(vals[r][c]).trim()]));
        } else {
          const colVals = vals.map(f => [f[c]]);
          filas.forEach(r => { colVals[r][0] = nuevas[String(vals[r][c]).trim()]; });
          col.setValues(colVals);
        }
        cambiadas += filas.length;
      }
    });
  } finally {
    lock.releaseLock();
  }

  Logger.log('Subidas a Cloudinary: ' + Object.keys(nuevas).length + ' | enlaces cambiados en la hoja: ' + cambiadas);
  if (nuevas[LOGO_IMGBB]) Logger.log('Logo: ' + nuevas[LOGO_IMGBB]);
  if (fallas.length) {
    Logger.log('No se pudieron pasar ' + fallas.length + ' (se quedan con el enlace de ImgBB):');
    fallas.slice(0, 30).forEach(f => Logger.log('  ' + f));
  }
  if (sinIntentar) Logger.log('Faltan ' + sinIntentar + ' fotos por tiempo: ejecuta de nuevo migrarImagenesACloudinary.');
  else if (!fallas.length) Logger.log('Listo: todas las fotos estan en Cloudinary.');
}

// ── VENTAS ───────────────────────────────────────────────────
//  Escribe encabezado + datos en un solo setValues por hoja.
function handleVentas(data) {
  const ss = SpreadsheetApp.openById(SHEET_ID);

  const escribir = (nombreHoja, headers, filas) => {
    const sh = ss.getSheetByName(nombreHoja) || ss.insertSheet(nombreHoja);
    sh.clearContents();
    const bloque = [headers].concat(filas);
    sh.getRange(1, 1, bloque.length, headers.length).setValues(bloque);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  };

  // — Hoja: VentasDia —
  const ventasDia = data.ventasDia || [];
  if (ventasDia.length) {
    escribir('VentasDia',
      ['fecha','num_transacciones','total_ventas','total_devoluciones'],
      ventasDia.map(r => [r.fecha || '', r.num_transacciones || 0, r.total_ventas || 0, r.total_devoluciones || 0]));
  }

  // — Hoja: TopProductos —
  const topProductos = data.topProductos || [];
  if (topProductos.length) {
    escribir('TopProductos',
      ['nombre','categoria','cantidad_vendida','total_vendido','num_transacciones'],
      topProductos.map(r => [r.nombre || '', r.categoria || '', r.cantidad_vendida || 0, r.total_vendido || 0, r.num_transacciones || 0]));
  }

  // — Hoja: VentasCat —
  const ventasCat = data.ventasCat || [];
  if (ventasCat.length) {
    escribir('VentasCat',
      ['categoria','cantidad_vendida','total_vendido'],
      ventasCat.map(r => [r.categoria || '', r.cantidad_vendida || 0, r.total_vendido || 0]));
  }

  // — Hoja: ResumenVentas (una sola fila, se sobreescribe cada sync) —
  const resumen = data.resumen || {};
  const now = Utilities.formatDate(new Date(), 'America/Tegucigalpa', 'dd/MM/yyyy HH:mm');
  escribir('ResumenVentas',
    ['total_ventas','monto_total','ventas_mes','monto_mes','ventas_semana','monto_semana','ultima_actualizacion'],
    [[
      resumen.total_ventas  || 0,
      resumen.monto_total   || 0,
      resumen.ventas_mes    || 0,
      resumen.monto_mes     || 0,
      resumen.ventas_semana || 0,
      resumen.monto_semana  || 0,
      now
    ]]);

  return ok('ventas guardadas: ' + ventasDia.length + ' dias, ' + topProductos.length + ' top productos');
}

// ── BANNERS ──────────────────────────────────────────────────
function handleBanners(data) {
  const ss      = SpreadsheetApp.openById(SHEET_ID);
  const sheet   = ss.getSheetByName('Banners') || ss.insertSheet('Banners');
  const banners = data.banners || [];
  const headers = ['imagen','titulo','subtitulo'];

  sheet.clearContents();
  const bloque = [headers].concat(banners.map(b => [b.imagen || '', b.titulo || '', b.subtitulo || '']));
  sheet.getRange(1, 1, bloque.length, headers.length).setValues(bloque);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');

  return ok(banners.length + ' banners guardados');
}

// ── CATEGORIAS ───────────────────────────────────────────────
function handleCategorias(data) {
  const ss         = SpreadsheetApp.openById(SHEET_ID);
  const sheet      = ss.getSheetByName('Categorias') || ss.insertSheet('Categorias');
  const categorias = data.categorias || [];
  const headers    = ['categoria','subcategoria'];

  sheet.clearContents();
  const bloque = [headers].concat(categorias.map(c => [c.categoria || '', c.subcategoria || '']));
  sheet.getRange(1, 1, bloque.length, headers.length).setValues(bloque);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');

  return ok(categorias.length + ' categorias guardadas');
}

// ── CONFIG ───────────────────────────────────────────────────
function handleConfig(data) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName('Config');
  if (!sheet) {
    sheet = ss.insertSheet('Config');
    sheet.getRange(1, 1, 1, 2).setValues([['clave','valor']]).setFontWeight('bold');
  }

  const cfg      = data.config || {};
  const lastRow  = sheet.getLastRow();
  const existing = {};
  const valores  = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, 2).getValues() : [];
  valores.forEach((row, i) => { if (row[0]) existing[row[0]] = i; });

  const nuevas = [];
  Object.keys(cfg).forEach(k => {
    const v = String(cfg[k]);
    if (existing[k] !== undefined) valores[existing[k]][1] = v;
    else nuevas.push([k, v]);
  });

  if (valores.length) sheet.getRange(2, 1, valores.length, 2).setValues(valores);
  if (nuevas.length)  sheet.getRange(2 + valores.length, 1, nuevas.length, 2).setValues(nuevas);

  return ok('config actualizada');
}

// ── CLIENTE ──────────────────────────────────────────────────
function handleCliente(data) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName('Clientes');
  if (!sheet) {
    sheet = ss.insertSheet('Clientes');
    sheet.appendRow(['nombre','telefono','fecha','hora','dispositivo','como_conocio']);
    sheet.getRange(1, 1, 1, 6).setFontWeight('bold');
  } else {
    // Agregar columna como_conocio si no existe
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    if (!headers.includes('como_conocio')) {
      sheet.getRange(1, sheet.getLastColumn() + 1).setValue('como_conocio');
      sheet.getRange(1, sheet.getLastColumn()).setFontWeight('bold');
    }
  }
  const now = new Date();
  sheet.appendRow([
    data.nombre   || '',
    data.telefono || '',
    Utilities.formatDate(now, 'America/Tegucigalpa', 'dd/MM/yyyy'),
    Utilities.formatDate(now, 'America/Tegucigalpa', 'HH:mm'),
    data.dispositivo  || '',
    data.como_conocio || ''
  ]);
  return ok('cliente guardado');
}

// ── CLIENTES REWRITE ─────────────────────────────────────────
function handleClientesRewrite(data) {
  const ss       = SpreadsheetApp.openById(SHEET_ID);
  const sheet    = ss.getSheetByName('Clientes') || ss.insertSheet('Clientes');
  const clientes = data.clientes || [];
  const headers  = ['nombre','telefono','fecha','hora','dispositivo','como_conocio'];

  sheet.clearContents();
  const bloque = [headers].concat(clientes.map(c => headers.map(h => c[h] || '')));
  sheet.getRange(1, 1, bloque.length, headers.length).setValues(bloque);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');

  return ok(clientes.length + ' clientes guardados');
}

// ── DIAGNOSTICO ──────────────────────────────────────────────
//  Ejecutar esta funcion desde el editor para forzar la autorizacion
//  y comprobar que se puede LEER y ESCRIBIR en la hoja correcta.
function diagnostico() {
  Logger.log('Cuenta que ejecuta: ' + Session.getEffectiveUser().getEmail());

  const ss = SpreadsheetApp.openById(SHEET_ID);   // aqui truena si no hay permiso
  Logger.log('Hoja abierta: ' + ss.getName());
  Logger.log('Pestanas: ' + ss.getSheets().map(s => s.getName()).join(', '));

  const sh = ss.getSheets()[0];
  Logger.log('Primera pestana: ' + sh.getName() + ' con ' + sh.getLastRow() + ' filas');

  sh.getRange('A1').setNote('prueba ' + new Date());   // prueba de escritura, no borra datos
  Logger.log('Escritura OK');
}

// ── HELPERS ──────────────────────────────────────────────────
function ok(msg)  { return out(JSON.stringify({ ok: true, msg: msg })); }
function out(str) { return ContentService.createTextOutput(str).setMimeType(ContentService.MimeType.JSON); }

// ════════════════════════════════════════════════════════════
//  CUENTAS DE CLIENTE (login con telefono + contrasena)
//  ---------------------------------------------------------
//  Todo lo sensible (credenciales, saldos, abonos) vive en un
//  SEGUNDO archivo de Google Sheets que NO se comparte publicamente.
//  La hoja publica (SHEET_ID) solo tiene catalogo, config y banners.
//
//  Pasos la primera vez:
//    1) Ejecutar crearHojaPrivada() desde el editor. Copiar el ID
//       que aparece en el registro y pegarlo en PRIVATE_SHEET_ID.
//    2) Volver a publicar la app web (Implementar > Nueva implementacion).
//    3) Correr el sync de PowerShell: ya escribe CxC/Abonos ahi.
//    4) Borrar a mano las pestanas CuentasPorCobrar y Abonos del
//       archivo publico (quedaron expuestas hasta ahora).
// ════════════════════════════════════════════════════════════

const PRIVATE_SHEET_ID = '19aBoaT5zoAqO5ytzxtKVUDFn69E5xy5YgttNa1k0rMw';   // <-- paso 1

// estado: 'aprobado' | 'pendiente'. Quien no tiene saldo en RMS no tiene nada
// que filtrar, asi que nace aprobado. Quien SI tiene saldo nace pendiente y no
// ve ni un numero hasta que la duena confirme por WhatsApp que es esa persona:
// el nombre y el telefono no son secretos, cualquiera que los sepa podria
// crear la cuenta de otro y leerle la deuda.
const USER_HEADERS    = ['telefono','nombre','hash','salt','fecha_registro','ultimo_acceso','estado'];
const COL_ESTADO      = 7;   // columna de 'estado' en la hoja Usuarios
const SESSION_DIAS    = 90;      // cuanto dura la sesion antes de pedir clave otra vez
const MAX_INTENTOS    = 5;       // intentos de clave fallidos...
const VENTANA_BLOQUEO = 15 * 60; // ...por cada 15 minutos, por telefono

// Cuenta de servicio del sync de PowerShell. Se le da acceso de editor
// al archivo privado para que pueda escribir CuentasPorCobrar y Abonos.
const SYNC_SERVICE_ACCOUNT = 'gabys-sync@light-relic-496921-n3.iam.gserviceaccount.com';

// ── Utilidades ───────────────────────────────────────────────

// Honduras usa 8 digitos. Devuelve esos 8 SOLO cuando se puede justificar;
// si no, cadena vacia, que no coincide con nada.
//
// Antes esto hacia slice(-8) a ciegas y era peligroso: en RMS hay un cliente
// con prefijo 502 (Guatemala), otro con 00171 y dos con 46. Cortar los
// ultimos 8 de un numero guatemalteco lo vuelve indistinguible de uno
// hondureno y podria mostrarle a alguien la cuenta de otro. Ante la duda,
// preferimos NO reconocer el numero: el cliente pide activacion a la tienda.
function normTel(tel) {
  let d = (tel || '').toString().replace(/\D/g, '');

  if (d.length === 11 && d.slice(0, 3) === '504') d = d.slice(3);   // +504 9999-9999
  else if (d.length === 12 && d.slice(0, 4) === '0504') d = d.slice(4);
  else if (d.length === 9 && d.charAt(0) === '0') d = d.slice(1);   // 0 delante

  return d.length === 8 ? d : '';
}

// Para comparar nombres sin que estorben tildes, mayusculas o dobles espacios.
// El rango de diacriticos se escribe con \u.... a proposito: asi el archivo
// sigue siendo ASCII puro y no depende de como se guarde la codificacion.
const RE_DIACRITICOS = new RegExp('[\u0300-\u036f]', 'g');
function normNombre(n) {
  return (n || '').toString()
    .normalize('NFD').replace(RE_DIACRITICOS, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

// Palabras del nombre, sin puntuacion ni numeros ni particulas sueltas.
// "MARIA  JOSE LOPEZ G." -> ['maria','jose','lopez']
function tokensNombre(n) {
  return normNombre(n)
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1 && ['de','del','la','las','los','y'].indexOf(t) === -1);
}

// En RMS los nombres estan de todo: en mayusculas, con segundo nombre y dos
// apellidos, con espacios dobles, a veces con una referencia ("Esposo de X").
// Exigir el nombre identico dejaba afuera a mucha gente, asi que basta con
// que coincidan dos palabras (el nombre y algun apellido). Si el registro de
// RMS tiene una sola palabra, con esa alcanza.
function nombreCoincide(nombreRMS, escrito) {
  const a = tokensNombre(nombreRMS);
  const b = tokensNombre(escrito);
  if (!a.length || !b.length) return false;
  if (a.join(' ') === b.join(' ')) return true;

  let comunes = 0;
  for (let i = 0; i < b.length; i++) if (a.indexOf(b[i]) !== -1) comunes++;
  return comunes >= Math.min(2, a.length);
}

function hexDigest(str) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, str, Utilities.Charset.UTF_8);
  return bytes.map(b => ((b & 0xFF) + 0x100).toString(16).slice(1)).join('');
}

function hashPassword(password, salt) {
  // Estiramiento simple: mil vueltas de SHA-256 encarece un ataque por fuerza
  // bruta si algun dia se filtra la hoja, sin colgar el Apps Script.
  let h = salt + '|' + password + '|' + SECRET;
  for (let i = 0; i < 1000; i++) h = hexDigest(h);
  return h;
}

function nuevoSalt() {
  return hexDigest(Utilities.getUuid() + Date.now()).slice(0, 32);
}

// La sesion no se guarda en ninguna hoja: se firma con SECRET y se valida
// recalculando la firma. Si alguien la edita, deja de cuadrar.
function firmarSesion(tel, emitida) {
  return hexDigest(tel + '.' + emitida + '.' + SECRET).slice(0, 40);
}

function crearSesion(tel) {
  const emitida = Date.now();
  return emitida + '.' + firmarSesion(tel, emitida);
}

function sesionValida(tel, sesion) {
  const partes = (sesion || '').toString().split('.');
  if (partes.length !== 2) return false;
  const emitida = parseInt(partes[0], 10);
  if (!emitida) return false;
  if (Date.now() - emitida > SESSION_DIAS * 24 * 60 * 60 * 1000) return false;
  return firmarSesion(tel, emitida) === partes[1];
}

function privateSS() {
  if (!PRIVATE_SHEET_ID || PRIVATE_SHEET_ID === 'PEGAR_AQUI_EL_ID') {
    throw new Error('Falta configurar PRIVATE_SHEET_ID (ejecutar crearHojaPrivada)');
  }
  return SpreadsheetApp.openById(PRIVATE_SHEET_ID);
}

function hojaUsuarios() {
  const ss = privateSS();
  let sh = ss.getSheetByName('Usuarios');
  if (!sh) {
    sh = ss.insertSheet('Usuarios');
    sh.getRange(1, 1, 1, USER_HEADERS.length).setValues([USER_HEADERS]).setFontWeight('bold');
    return sh;
  }
  // La columna 'estado' se agrego despues: si la hoja viene de antes, se crea
  // y las cuentas que ya existian quedan aprobadas (son previas al cambio).
  if (sh.getLastColumn() < USER_HEADERS.length) {
    sh.getRange(1, COL_ESTADO).setValue('estado').setFontWeight('bold');
    const n = sh.getLastRow() - 1;
    if (n > 0) sh.getRange(2, COL_ESTADO, n, 1).setValue('aprobado');
  }
  return sh;
}

// Devuelve { fila, datos } o null. La fila sirve para actualizar despues.
function buscarUsuario(tel) {
  const sh = hojaUsuarios();
  if (sh.getLastRow() < 2) return null;
  const filas = sh.getRange(2, 1, sh.getLastRow() - 1, USER_HEADERS.length).getValues();
  for (let i = 0; i < filas.length; i++) {
    if (normTel(filas[i][0]) === tel) {
      return { fila: i + 2, datos: {
        telefono: filas[i][0], nombre: filas[i][1], hash: filas[i][2], salt: filas[i][3],
        // Sin valor = cuenta vieja, anterior a la aprobacion: se respeta
        estado: (filas[i][6] || 'aprobado').toString()
      } };
    }
  }
  return null;
}

// TODAS las fichas de RMS con ese telefono. Hay familias que comparten un
// mismo numero, asi que esto puede devolver mas de una.
function filasRMS(tel) {
  const sh = privateSS().getSheetByName('CuentasPorCobrar');
  if (!sh || sh.getLastRow() < 2) return [];
  const filas = sh.getRange(2, 1, sh.getLastRow() - 1, 6).getValues();
  const res = [];
  for (let i = 0; i < filas.length; i++) {
    if (normTel(filas[i][1]) === tel) {
      res.push({
        nombre:          filas[i][0],
        credito_total:   Number(filas[i][2]) || 0,
        saldo_pendiente: Number(filas[i][3]) || 0,
        ultimo_abono:    Number(filas[i][4]) || 0,
        fecha_ultimo_abono: filas[i][5] ? filas[i][5].toString() : ''
      });
    }
  }
  return res;
}

// Que sabemos de este telefono. Distingue tres cosas que NO son lo mismo:
//   'ninguno' -> no esta en Cuentas por Cobrar: no debe nada, y es seguro decirlo
//   'unico'   -> una sola ficha, sabemos exactamente quien es
//   'ambiguo' -> esta, pero no podemos determinar cual de las fichas es
// Confundir 'ambiguo' con 'ninguno' seria decirle a alguien que no debe
// nada cuando quiza si debe. Ante la ambiguedad se lo manda a WhatsApp.
function estadoRMS(tel, nombre) {
  const filas = filasRMS(tel);
  if (!filas.length) return { tipo: 'ninguno', ficha: null };
  if (filas.length === 1) return { tipo: 'unico', ficha: filas[0] };
  if (!nombre) return { tipo: 'ambiguo', ficha: null };

  const coinciden = afinarPorNombrePila(filas.filter(f => nombreCoincide(f.nombre, nombre)), nombre);
  return coinciden.length === 1
    ? { tipo: 'unico', ficha: coinciden[0] }
    : { tipo: 'ambiguo', ficha: null };
}

// Entre hermanos pasa que comparten telefono Y apellidos: "Luis Perez Diaz"
// y "Marta Perez Diaz" se parecen lo suficiente como para que la coincidencia
// normal (dos palabras iguales) acepte las dos. Cuando eso ocurre, el primer
// nombre desempata. Solo se usa para desempatar: si no resuelve, queda
// ambiguo y el cliente pide activacion.
function afinarPorNombrePila(candidatas, escrito) {
  if (candidatas.length <= 1) return candidatas;

  const pila = tokensNombre(escrito)[0];
  if (!pila) return candidatas;

  const conMismaPila = candidatas.filter(f => tokensNombre(f.nombre)[0] === pila);
  return conMismaPila.length === 1 ? conMismaPila : candidatas;
}

// Atajo para cuando solo interesa la ficha (null si no hay o es ambigua)
function buscarEnRMS(tel, nombre) {
  return estadoRMS(tel, nombre).ficha;
}

// Error que le dice a la pagina "esto necesita una persona": la pagina
// muestra el boton de WhatsApp en lugar de un mensaje sin salida.
function ayudaErr(msg) {
  return out(JSON.stringify({ ok: false, error: msg, ayuda: true }));
}

// Se queda con las filas de ESTA persona. El filtro por nombre solo se
// aplica cuando el telefono lo comparten varias: si no, un cliente que se
// registro escribiendo "Sofia" no veria nada porque en RMS figura como
// "Sofia Ramirez".
function filasDeLaPersona(filas, colTel, colNombre, tel, nombre) {
  const delTel = filas.filter(f => normTel(f[colTel]) === tel);
  if (!delTel.length) return [];

  const nombres = {};
  delTel.forEach(f => nombres[normNombre(f[colNombre])] = true);
  if (Object.keys(nombres).length <= 1) return delTel;   // una sola persona

  if (!nombre) return [];                                 // compartido y sin nombre: nada

  let mios = delTel.filter(f => nombreCoincide(f[colNombre], nombre));

  // Entre hermanos que comparten apellidos, el primer nombre desempata
  const pila = tokensNombre(nombre)[0];
  const nombresDistintos = () => {
    const s = {};
    mios.forEach(f => s[normNombre(f[colNombre])] = true);
    return Object.keys(s).length;
  };
  if (nombresDistintos() > 1 && pila) {
    const conPila = mios.filter(f => tokensNombre(f[colNombre])[0] === pila);
    const sPila = {};
    conPila.forEach(f => sPila[normNombre(f[colNombre])] = true);
    if (Object.keys(sPila).length === 1) mios = conPila;
  }

  // Si aun asi calza con varias personas, no se muestra nada: mejor que el
  // cliente pida activacion a que vea movimientos de otra.
  return nombresDistintos() === 1 ? mios : [];
}

function abonosDe(tel, nombre) {
  const sh = privateSS().getSheetByName('Abonos');
  if (!sh || sh.getLastRow() < 2) return [];
  const filas = sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues();
  return filasDeLaPersona(filas, 1, 0, tel, nombre)
    .map(f => ({ monto: Number(f[2]) || 0, fecha: f[3] ? f[3].toString() : '' }));
}

// Ultimas compras de esta persona (las llena el sync desde RMS).
// Igual que los abonos, se filtran por telefono Y nombre por si dos
// familiares comparten el numero.
function comprasDe(tel, nombre) {
  const sh = privateSS().getSheetByName('Compras');
  if (!sh || sh.getLastRow() < 2) return [];
  const filas = sh.getRange(2, 1, sh.getLastRow() - 1, 6).getValues();
  return filasDeLaPersona(filas, 1, 0, tel, nombre)
    .map(f => ({
      fecha:     f[2] instanceof Date
                   ? Utilities.formatDate(f[2], 'America/Tegucigalpa', 'dd/MM/yyyy')
                   : (f[2] ? f[2].toString() : ''),
      total:     Number(f[3]) || 0,
      articulos: Number(f[4]) || 0,
      detalle:   f[5] ? f[5].toString() : ''
    }));
}

// ── Carril rapido: verificarse solo con el saldo exacto ──────
//  Se eligio el saldo y no el ultimo abono porque se midio sobre los datos
//  reales: probando los 3 valores mas comunes, el ultimo abono abre el 43%
//  de las cuentas y el saldo apenas el 8%.
//  Los intentos aqui NO se reinician: son 3 y punto. Si se reiniciaran cada
//  15 minutos, bastaria con insistir para terminar adivinando.
const MAX_INTENTOS_SALDO = 3;

function intentosSaldo(tel) {
  const p = PropertiesService.getScriptProperties();
  return parseInt(p.getProperty('vsaldo_' + tel) || '0', 10);
}

function sumarIntentoSaldo(tel) {
  const p = PropertiesService.getScriptProperties();
  p.setProperty('vsaldo_' + tel, (intentosSaldo(tel) + 1).toString());
}

// El contador vive en las propiedades del script, o sea que NO se borra solo.
// Hay que limpiarlo cuando la cuenta se borra o se aprueba, o la persona que
// vuelva a crear su cuenta nacera sin intento de verificarse.
function limpiarIntentosSaldo(tel) {
  PropertiesService.getScriptProperties().deleteProperty('vsaldo_' + tel);
}

// Freno a la fuerza bruta: 5 fallos por telefono cada 15 minutos.
function intentosFallidos(tel) {
  const c = CacheService.getScriptCache();
  return parseInt(c.get('fail_' + tel) || '0', 10);
}
function sumarFallo(tel) {
  const c = CacheService.getScriptCache();
  c.put('fail_' + tel, (intentosFallidos(tel) + 1).toString(), VENTANA_BLOQUEO);
}
function limpiarFallos(tel) {
  CacheService.getScriptCache().remove('fail_' + tel);
}

function authErr(msg) { return out(JSON.stringify({ ok: false, error: msg })); }

// ── auth_check: que le toca hacer a este telefono ────────────
//  nuevo    -> no existe en ningun lado, registro normal
//  reclamar -> es cliente de RMS pero nunca creo cuenta web
//  login    -> ya tiene cuenta, pedir contrasena
//  La identidad es el telefono. El nombre ya no se valida contra RMS: no
//  era una barrera real (quien sabe el numero sabe el nombre) y dejaba
//  afuera a los clientes anotados como "Esposo de X" o con el nombre de su
//  trabajo, que nunca podrian acertarlo. Lo que protege el saldo es la
//  pregunta de la ultima compra mas la aprobacion de la duena.
function handleAuthCheck(data) {
  const tel = normTel(data.telefono);
  if (!tel) return authErr('Telefono invalido');

  if (buscarUsuario(tel)) return out(JSON.stringify({ ok: true, estado: 'login' }));

  const filas = filasRMS(tel);

  // Telefono compartido por dos personas: sin el nombre no hay forma de
  // saber cual es, y mostrar la ficha equivocada seria filtrar deuda ajena.
  if (filas.length > 1) {
    return out(JSON.stringify({ ok: false, estado: 'revision', ayuda: true,
      error: 'Ese numero esta registrado en mas de una cuenta de la tienda. Escribinos y te la activamos nosotros.' }));
  }

  // 'cliente' le avisa que ya lo tenemos en la tienda, asi entiende por que
  // despues le vamos a preguntar por su ultima compra.
  return out(JSON.stringify({ ok: true, estado: 'nuevo', cliente: filas.length === 1 }));
}

// ── auth_register: crear cuenta ──────────────────────────────
function handleAuthRegister(data) {
  const tel      = normTel(data.telefono);
  const nombre   = (data.nombre || '').toString().trim().substring(0, 60);
  const password = (data.password || '').toString();

  if (!tel)                 return authErr('Telefono invalido');
  if (nombre.length < 2)    return authErr('Escribi tu nombre');
  if (password.length < 6)  return authErr('La clave necesita al menos 6 caracteres');
  if (buscarUsuario(tel))   return authErr('Ese telefono ya tiene cuenta. Inicia sesion.');

  // El nombre NO se valida contra RMS: la cuenta se identifica por telefono.
  // Lo unico que se rechaza es el telefono compartido, porque ahi sin nombre
  // no se sabe de quien es la deuda y se enviaria a la persona equivocada.
  const filas = filasRMS(tel);
  if (filas.length > 1) {
    return ayudaErr('Ese numero esta registrado en mas de una cuenta de la tienda. Escribinos y te la activamos nosotros.');
  }
  const rms = filas.length === 1 ? filas[0] : null;
  limpiarFallos(tel);

  // Si el numero tiene saldo, la cuenta nace PENDIENTE: se crea y se puede
  // usar, pero no muestra ni un numero hasta que la duena la apruebe. Es lo
  // que evita que alguien que sepa el nombre y el telefono de otro le lea
  // la deuda; ni el nombre ni el telefono son datos secretos.
  const estado = rms ? 'pendiente' : 'aprobado';
  const salt   = nuevoSalt();
  const now    = new Date();
  hojaUsuarios().appendRow([
    tel, rms ? rms.nombre : nombre, hashPassword(password, salt), salt,
    Utilities.formatDate(now, 'America/Tegucigalpa', 'dd/MM/yyyy HH:mm'), '', estado
  ]);

  return out(JSON.stringify({
    ok: true, nombre: rms ? rms.nombre : nombre, telefono: tel,
    sesion: crearSesion(tel),
    // Mientras la cuenta no este aprobada ni siquiera se confirma que hay
    // deuda: "esta persona debe plata" ya es un dato privado de un tercero.
    tieneSaldo: !!(estado === 'aprobado' && rms && rms.saldo_pendiente > 0),
    estado: estado, pendiente: estado === 'pendiente'
  }));
}

// ── auth_login ───────────────────────────────────────────────
function handleAuthLogin(data) {
  const tel      = normTel(data.telefono);
  const password = (data.password || '').toString();
  if (tel.length < 8) return authErr('Telefono invalido');

  if (intentosFallidos(tel) >= MAX_INTENTOS) {
    return authErr('Demasiados intentos. Espera 15 minutos o escribinos por WhatsApp.');
  }

  const u = buscarUsuario(tel);
  // Mismo mensaje exista o no la cuenta: no se revela que numeros estan registrados.
  if (!u || hashPassword(password, u.datos.salt) !== u.datos.hash) {
    sumarFallo(tel);
    return authErr('Telefono o clave incorrectos');
  }

  limpiarFallos(tel);
  hojaUsuarios().getRange(u.fila, 6)
    .setValue(Utilities.formatDate(new Date(), 'America/Tegucigalpa', 'dd/MM/yyyy HH:mm'));

  // El nombre guardado en la cuenta desempata si el telefono esta compartido
  const rms = buscarEnRMS(tel, u.datos.nombre);
  const aprobada = u.datos.estado === 'aprobado';
  return out(JSON.stringify({
    ok: true, nombre: u.datos.nombre, telefono: tel,
    sesion: crearSesion(tel),
    // Mientras este pendiente no se avisa ni que hay saldo
    tieneSaldo: !!(aprobada && rms && rms.saldo_pendiente > 0),
    estado: u.datos.estado, pendiente: !aprobada
  }));
}

// ── auth_saldo: solo con sesion valida, solo la fila propia ──
function handleAuthSaldo(data) {
  const tel = normTel(data.telefono);
  if (!sesionValida(tel, data.sesion)) return authErr('Sesion vencida. Inicia sesion de nuevo.');

  const u = buscarUsuario(tel);
  if (!u) return authErr('Cuenta no encontrada');

  // Cuenta sin aprobar: no se devuelve NINGUN numero. Es el punto exacto
  // donde se corta la fuga; da igual que quien entro sepa el nombre.
  if (u.datos.estado !== 'aprobado') {
    return out(JSON.stringify({ ok: true, pendiente: true }));
  }

  // Se busca por telefono Y por el nombre con el que quedo creada la cuenta,
  // para no mostrarle el saldo de un familiar que comparte el numero.
  const est = estadoRMS(tel, u.datos.nombre);
  if (est.tipo === 'ambiguo') {
    return ayudaErr('Ese numero aparece en mas de una cuenta de la tienda y no queremos mostrarte la equivocada. Escribinos y lo resolvemos.');
  }
  const rms = est.ficha;
  if (!rms) return out(JSON.stringify({ ok: true, saldo_pendiente: 0, abonos: [] }));

  return out(JSON.stringify({
    ok: true,
    credito_total:      rms.credito_total,
    saldo_pendiente:    rms.saldo_pendiente,
    ultimo_abono:       rms.ultimo_abono,
    fecha_ultimo_abono: rms.fecha_ultimo_abono,
    abonos:             abonosDe(tel, rms.nombre).slice(0, 20)
  }));
}

// ── auth_compras: las ultimas 10 compras del cliente ─────────
//  Tambien detras de la aprobacion: lo que alguien compro es tan privado
//  como lo que debe.
function handleAuthCompras(data) {
  const tel = normTel(data.telefono);
  if (!sesionValida(tel, data.sesion)) return authErr('Sesion vencida. Inicia sesion de nuevo.');

  const u = buscarUsuario(tel);
  if (!u) return authErr('Cuenta no encontrada');
  if (u.datos.estado !== 'aprobado') return out(JSON.stringify({ ok: true, pendiente: true }));

  // Si el telefono da para varias personas, no se arriesga a mostrar las
  // compras de otra: se pide ayuda.
  if (estadoRMS(tel, u.datos.nombre).tipo === 'ambiguo') {
    return ayudaErr('Ese numero aparece en mas de una cuenta y no podemos saber cuales compras son tuyas. Escribinos y lo resolvemos.');
  }

  return out(JSON.stringify({ ok: true, compras: comprasDe(tel, u.datos.nombre).slice(0, 10) }));
}

// ── auth_update: cambiar nombre o clave ──────────────────────
function handleAuthUpdate(data) {
  const tel = normTel(data.telefono);
  if (!sesionValida(tel, data.sesion)) return authErr('Sesion vencida');

  const u = buscarUsuario(tel);
  if (!u) return authErr('Cuenta no encontrada');

  const sh     = hojaUsuarios();
  const nombre = (data.nombre || '').toString().trim().substring(0, 60);

  // Un cliente de RMS no puede cambiarse el nombre: es lo que amarra su saldo
  // (y lo que lo distingue de un familiar que use el mismo telefono).
  if (nombre.length >= 2 && !filasRMS(tel).length) sh.getRange(u.fila, 2).setValue(nombre);

  if (data.password_nueva) {
    const nueva = data.password_nueva.toString();
    if (nueva.length < 6) return authErr('La clave necesita al menos 6 caracteres');
    if (hashPassword((data.password_actual || '').toString(), u.datos.salt) !== u.datos.hash) {
      sumarFallo(tel);
      return authErr('La clave actual no es correcta');
    }
    const salt = nuevoSalt();
    sh.getRange(u.fila, 3, 1, 2).setValues([[hashPassword(nueva, salt), salt]]);
  }

  return out(JSON.stringify({ ok: true, nombre: sh.getRange(u.fila, 2).getValue() }));
}

// ── Reset de clave desde el panel (requiere SECRET) ──────────
//  Para cuando un cliente escribe por WhatsApp diciendo que la olvido.
function handleAuthReset(data) {
  const tel = normTel(data.telefono);
  const u   = buscarUsuario(tel);
  if (!u) return authErr('Ese telefono no tiene cuenta');

  const temporal = Math.random().toString(36).slice(-8);
  const salt     = nuevoSalt();
  hojaUsuarios().getRange(u.fila, 3, 1, 2).setValues([[hashPassword(temporal, salt), salt]]);
  limpiarFallos(tel);

  return out(JSON.stringify({ ok: true, nombre: u.datos.nombre, clave_temporal: temporal }));
}

// ── Activar la cuenta a mano desde el panel ──────────────────
//  Para los casos que la coincidencia de nombre no puede resolver: clientes
//  guardados en RMS como "Esposo de X", con el nombre de la empresa, mal
//  escritos, etc. La duena confirma por WhatsApp quien es y le activa la
//  cuenta con una clave temporal; no hace falta que acierte ningun nombre.
function handleAuthActivar(data) {
  const tel = normTel(data.telefono);
  if (tel.length < 8) return authErr('Telefono invalido');
  if (buscarUsuario(tel)) return authErr('Ese telefono ya tiene cuenta. Usa el boton de clave temporal.');

  // El panel manda el nombre de la ficha que la duena eligio en la tabla:
  // hace falta cuando dos personas comparten el mismo telefono.
  const rms = buscarEnRMS(tel, data.nombre);
  if (!rms) {
    return authErr(filasRMS(tel).length > 1
      ? 'Ese telefono lo comparten dos clientes. Volve a cargar la tabla e intenta de nuevo.'
      : 'Ese telefono no aparece en Cuentas por Cobrar');
  }

  const temporal = Math.random().toString(36).slice(-8);
  const salt     = nuevoSalt();
  const now      = new Date();
  // Creada por la duena desde el panel: ya viene confirmada de origen
  hojaUsuarios().appendRow([
    tel, rms.nombre, hashPassword(temporal, salt), salt,
    Utilities.formatDate(now, 'America/Tegucigalpa', 'dd/MM/yyyy HH:mm'), '', 'aprobado'
  ]);
  limpiarFallos(tel);

  return out(JSON.stringify({ ok: true, nombre: rms.nombre, clave_temporal: temporal }));
}

// ── Verificarse reconociendo la ultima compra ────────────────
//  Se le muestran 3 articulos: el ultimo que compro y dos que nunca compro.
//  UN solo intento. Con 3 opciones, dar 3 intentos equivaldria a no
//  preguntar nada: se agotan y se entra siempre.
//  La opcion correcta NO se manda al navegador: se guarda en el cache del
//  servidor contra un id de pregunta, y el navegador solo devuelve cual eligio.

// Todo lo que este cliente compro alguna vez (para no usarlo de senuelo)
function itemsDe(tel) {
  const sh = privateSS().getSheetByName('ComprasItems');
  if (!sh || sh.getLastRow() < 2) return [];
  const filas = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
  const mios = [];
  for (let i = 0; i < filas.length; i++) {
    if (normTel(filas[i][0]) === tel && filas[i][1]) mios.push(filas[i][1].toString());
  }
  return mios;
}

// Articulos comprados por OTROS clientes: sirven de senuelo y son productos
// reales de la tienda, asi que no se delatan por raros.
function itemsAjenos(tel, excluir) {
  const sh = privateSS().getSheetByName('ComprasItems');
  if (!sh || sh.getLastRow() < 2) return [];
  const filas = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
  const fuera = {};
  excluir.forEach(a => fuera[normNombre(a)] = true);
  const vistos = {}, res = [];
  for (let i = 0; i < filas.length; i++) {
    const art = filas[i][1] ? filas[i][1].toString() : '';
    if (!art || normTel(filas[i][0]) === tel) continue;
    const k = normNombre(art);
    if (fuera[k] || vistos[k]) continue;
    vistos[k] = true;
    res.push(art);
  }
  return res;
}

function handleAuthQuiz(data) {
  const tel = normTel(data.telefono);
  if (!sesionValida(tel, data.sesion)) return authErr('Sesion vencida. Inicia sesion de nuevo.');

  const u = buscarUsuario(tel);
  if (!u) return authErr('Cuenta no encontrada');
  if (u.datos.estado === 'aprobado') return out(JSON.stringify({ ok: true, aprobada: true }));
  if (intentosSaldo(tel) >= 1) {
    return out(JSON.stringify({ ok: false, agotado: true, ayuda: true,
      error: 'Ya usaste tu intento. Pedinos la autorizacion por WhatsApp.' }));
  }

  // La ultima compra: la hoja Compras viene ordenada de la mas nueva a la
  // mas vieja, y 'detalle' trae los primeros articulos de esa compra.
  const rms = buscarEnRMS(tel, u.datos.nombre);
  const compras = comprasDe(tel, rms ? rms.nombre : u.datos.nombre);
  const correcta = compras.length && compras[0].detalle
    ? compras[0].detalle.split(',')[0].trim()
    : '';
  if (!correcta) {
    return out(JSON.stringify({ ok: false, sinDatos: true, ayuda: true,
      error: 'No tenemos compras tuyas registradas. Pedinos la autorizacion por WhatsApp.' }));
  }

  const ajenos = itemsAjenos(tel, itemsDe(tel));
  if (ajenos.length < 2) {
    return out(JSON.stringify({ ok: false, sinDatos: true, ayuda: true,
      error: 'No pudimos armar la pregunta. Pedinos la autorizacion por WhatsApp.' }));
  }

  // Dos senuelos al azar
  const senuelos = [];
  while (senuelos.length < 2) {
    const cand = ajenos[Math.floor(Math.random() * ajenos.length)];
    if (senuelos.indexOf(cand) === -1) senuelos.push(cand);
  }

  const opciones = [correcta, senuelos[0], senuelos[1]];
  // Barajar para que la correcta no caiga siempre en la misma posicion
  for (let i = opciones.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = opciones[i]; opciones[i] = opciones[j]; opciones[j] = t;
  }

  const quizId = Utilities.getUuid();
  CacheService.getScriptCache().put('quiz_' + quizId,
    JSON.stringify({ tel: tel, correcta: correcta }), 600);   // 10 minutos

  return out(JSON.stringify({ ok: true, quizId: quizId, opciones: opciones }));
}

function handleAuthVerificarCompra(data) {
  const tel = normTel(data.telefono);
  if (!sesionValida(tel, data.sesion)) return authErr('Sesion vencida. Inicia sesion de nuevo.');

  const u = buscarUsuario(tel);
  if (!u) return authErr('Cuenta no encontrada');
  if (u.datos.estado === 'aprobado') return out(JSON.stringify({ ok: true, aprobada: true }));
  if (intentosSaldo(tel) >= 1) {
    return out(JSON.stringify({ ok: false, agotado: true, ayuda: true,
      error: 'Ya usaste tu intento. Pedinos la autorizacion por WhatsApp.' }));
  }

  const crudo = CacheService.getScriptCache().get('quiz_' + (data.quizId || ''));
  if (!crudo) {
    return out(JSON.stringify({ ok: false,
      error: 'La pregunta vencio. Volve a abrir tu cuenta e intenta de nuevo.' }));
  }
  const quiz = JSON.parse(crudo);
  // La pregunta era de este telefono, no de otro
  if (quiz.tel !== tel) return authErr('Pregunta invalida');

  // El intento se consume siempre, acierte o no: si solo se contara al
  // fallar, se podria pedir pregunta nueva hasta que salga una facil.
  CacheService.getScriptCache().remove('quiz_' + data.quizId);
  sumarIntentoSaldo(tel);

  if (normNombre(data.elegida || '') !== normNombre(quiz.correcta)) {
    return out(JSON.stringify({ ok: false, agotado: true, ayuda: true,
      error: 'Esa no era. Pedinos la autorizacion por WhatsApp y te la activamos.' }));
  }

  hojaUsuarios().getRange(u.fila, COL_ESTADO).setValue('aprobado');
  return out(JSON.stringify({ ok: true, aprobada: true }));
}

// ── Verificarse solo, respondiendo sobre el ultimo abono ─────
//  Dos preguntas que el cliente recuerda: CUANDO abono (por rango) y CUANTO.
//  Las dos son obligatorias, a proposito. Se midio sobre los datos reales:
//    - solo el rango          -> el atacante acierta el 41% (eligiendo el mas comun)
//    - solo el monto          -> 20%
//    - una U otra (2 chances) -> 61%   <- lo que parece mas amable es lo peor
//    - las dos juntas         -> 8%
//  Cada intento extra REGALA seguridad, por eso no se encadenan y por eso
//  los 3 intentos no se reinician nunca.
const RANGOS_ABONO = [
  { id: 'r7',   desde: 0,  hasta: 7 },
  { id: 'r15',  desde: 7,  hasta: 15 },
  { id: 'r30',  desde: 15, hasta: 30 },
  { id: 'r90',  desde: 30, hasta: 90 },
  { id: 'rmas', desde: 90, hasta: 99999 }
];

function rangoDeFecha(fechaTexto) {
  if (!fechaTexto) return null;
  // Las fechas vienen de RMS como yyyy-MM-dd
  const f = new Date(fechaTexto.toString().slice(0, 10) + 'T12:00:00');
  if (isNaN(f.getTime())) return null;
  const dias = (Date.now() - f.getTime()) / 86400000;
  const r = RANGOS_ABONO.filter(x => dias >= x.desde && dias < x.hasta)[0];
  return r ? r.id : null;
}

function handleAuthVerificar(data) {
  const tel = normTel(data.telefono);
  if (!sesionValida(tel, data.sesion)) return authErr('Sesion vencida. Inicia sesion de nuevo.');

  const u = buscarUsuario(tel);
  if (!u) return authErr('Cuenta no encontrada');
  if (u.datos.estado === 'aprobado') return out(JSON.stringify({ ok: true, aprobada: true }));

  if (MAX_INTENTOS_SALDO - intentosSaldo(tel) <= 0) {
    return out(JSON.stringify({ ok: false, agotado: true, ayuda: true,
      error: 'Ya usaste tus 3 intentos. Pedinos la autorizacion por WhatsApp.' }));
  }

  const rms = buscarEnRMS(tel, u.datos.nombre);
  if (!rms) return authErr('No encontramos tu cuenta en la tienda');

  const abonos = abonosDe(tel, rms.nombre);
  if (!abonos.length) {
    // Nunca abono: no hay nada que preguntarle, va por WhatsApp
    return out(JSON.stringify({ ok: false, sinDatos: true, ayuda: true,
      error: 'Todavia no tenemos abonos tuyos registrados. Pedinos la autorizacion por WhatsApp.' }));
  }

  const ultimo  = abonos[0];
  const esperado = rangoDeFecha(ultimo.fecha);
  const montoOk  = Math.round(Number(data.monto) || -1) === Math.round(ultimo.monto);
  const rangoOk  = esperado !== null && data.rango === esperado;

  // Las dos tienen que estar bien, y no se dice cual fallo: decirlo
  // convertiria dos preguntas en dos intentos separados.
  if (!montoOk || !rangoOk) {
    sumarIntentoSaldo(tel);
    const restan = MAX_INTENTOS_SALDO - intentosSaldo(tel);
    return out(JSON.stringify({ ok: false, restan: restan,
      error: restan > 0
        ? 'Los datos no coinciden. Te ' + (restan === 1 ? 'queda 1 intento' : 'quedan ' + restan + ' intentos') + '.'
        : 'Los datos no coinciden y ya no quedan intentos. Pedinos la autorizacion por WhatsApp.' }));
  }

  hojaUsuarios().getRange(u.fila, COL_ESTADO).setValue('aprobado');
  return out(JSON.stringify({ ok: true, aprobada: true }));
}

// ── Aprobar una cuenta pendiente (panel, requiere SECRET) ────
//  La duena confirma por WhatsApp que quien creo la cuenta es el cliente
//  y recien ahi se le habilita el saldo.
function handleAuthAprobar(data) {
  const tel = normTel(data.telefono);
  const u   = buscarUsuario(tel);
  if (!u) return authErr('Ese telefono no tiene cuenta');
  if (u.datos.estado === 'aprobado') return authErr('Esa cuenta ya estaba aprobada');

  hojaUsuarios().getRange(u.fila, COL_ESTADO).setValue('aprobado');
  limpiarIntentosSaldo(tel);
  return out(JSON.stringify({ ok: true, nombre: u.datos.nombre }));
}

// ── Devolver el intento de verificacion (panel, requiere SECRET) ──
//  La clienta tiene UN intento para reconocer su ultima compra. Si fallo
//  por despiste, esto le devuelve el intento sin tener que aprobarle la
//  cuenta a ciegas. Tambien sirve para probar el sistema las veces que haga
//  falta. No aprueba nada por si solo: solo permite volver a intentar.
function handleAuthReintento(data) {
  const tel = normTel(data.telefono);
  const u   = buscarUsuario(tel);
  if (!u) return authErr('Ese telefono no tiene cuenta');
  if (u.datos.estado === 'aprobado') return authErr('Esa cuenta ya esta aprobada, no necesita verificarse');

  limpiarIntentosSaldo(tel);
  return out(JSON.stringify({ ok: true, nombre: u.datos.nombre }));
}

// ── Borrar una cuenta (panel, requiere SECRET) ───────────────
//  Para cuando alguien creo la cuenta de otra persona, o el cliente quedo
//  bloqueado. Borra solo la credencial: no toca el saldo ni los abonos,
//  que vienen de RMS. Despues el cliente real puede crearla de nuevo.
function handleAuthBorrar(data) {
  const tel = normTel(data.telefono);
  const u   = buscarUsuario(tel);
  if (!u) return authErr('Ese telefono no tiene cuenta');

  const nombre = u.datos.nombre;
  hojaUsuarios().deleteRow(u.fila);
  limpiarFallos(tel);
  limpiarIntentosSaldo(tel);   // que pueda verificarse de nuevo al recrearla
  return out(JSON.stringify({ ok: true, nombre: nombre }));
}

// ── Todas las cuentas web, para el panel ─────────────────────
//  Hace falta una vista propia porque quien NO debe nada no aparece en
//  Cuentas por Cobrar: sin esto, esas cuentas eran invisibles.
function handleCuentasWeb(data) {
  const sh = hojaUsuarios();
  if (sh.getLastRow() < 2) return out(JSON.stringify({ ok: true, cuentas: [] }));

  const filas = sh.getRange(2, 1, sh.getLastRow() - 1, USER_HEADERS.length).getValues();
  const cuentas = filas.map(f => {
    const tel = normTel(f[0]);
    const fichas = tel ? filasRMS(tel) : [];
    const ficha  = fichas.length === 1 ? fichas[0] : null;
    return {
      telefono: f[0] ? f[0].toString() : '',
      nombre:   f[1] ? f[1].toString() : '',
      creada:   f[4] ? f[4].toString() : '',
      // Vacio = creo la cuenta pero nunca volvio a entrar
      ultimo_acceso: f[5] ? f[5].toString() : '',
      estado:   (f[6] || 'aprobado').toString(),
      saldo:    ficha ? ficha.saldo_pendiente : (fichas.length ? null : 0),
      compras:  tel ? comprasDe(tel, f[1] ? f[1].toString() : '').length : 0
    };
  });

  return out(JSON.stringify({ ok: true, cuentas: cuentas }));
}

// ── Cuentas por cobrar para el panel ─────────────────────────
//  El panel ya no puede leer estas hojas con gviz (estan en el archivo
//  privado), asi que las pide por aqui. Requiere SECRET.
function handleCobrosPanel(data) {
  const ss = privateSS();

  const leer = (nombre, cols) => {
    const sh = ss.getSheetByName(nombre);
    if (!sh || sh.getLastRow() < 2) return [];
    return sh.getRange(2, 1, sh.getLastRow() - 1, cols.length).getValues().map(f => {
      const o = {};
      cols.forEach((c, i) => {
        const v = f[i];
        o[c] = (v instanceof Date)
          ? Utilities.formatDate(v, 'America/Tegucigalpa', 'dd/MM/yyyy')
          : (v === undefined || v === null ? '' : v.toString());
      });
      return o;
    });
  };

  // Quien ya tiene cuenta web y en que estado, para mostrarlo en el panel
  const shU = hojaUsuarios();
  const cuentasWeb = (shU.getLastRow() > 1)
    ? shU.getRange(2, 1, shU.getLastRow() - 1, USER_HEADERS.length).getValues().map(f => ({
        telefono: normTel(f[0]),
        nombre:   f[1] ? f[1].toString() : '',
        estado:   (f[6] || 'aprobado').toString(),
        creada:   f[4] ? f[4].toString() : ''
      }))
    : [];

  return out(JSON.stringify({
    ok: true,
    cuentas: leer('CuentasPorCobrar', ['nombre','telefono','credito_total','saldo_pendiente','ultimo_abono','fecha_ultimo_abono']),
    abonos:  leer('Abonos', ['nombre','telefono','monto','fecha']),
    cuentas_web: cuentasWeb
  }));
}

// ── Preparacion inicial: crear el archivo privado ────────────
//  Ejecutar UNA vez desde el editor y copiar el ID al inicio del archivo.
function crearHojaPrivada() {
  // Si ya hay un archivo configurado, no crear otro: correr esto dos veces
  // solo deja archivos vacios sueltos en el Drive y confunde cual es el bueno.
  if (PRIVATE_SHEET_ID && PRIVATE_SHEET_ID !== 'PEGAR_AQUI_EL_ID') {
    const yaExiste = SpreadsheetApp.openById(PRIVATE_SHEET_ID);
    Logger.log('YA HAY UN ARCHIVO PRIVADO CONFIGURADO. No se creo ninguno nuevo.');
    Logger.log('Nombre: ' + yaExiste.getName());
    Logger.log('ID:     ' + PRIVATE_SHEET_ID);
    Logger.log('URL:    ' + yaExiste.getUrl());
    Logger.log('Si de verdad queres uno nuevo, borra el ID de PRIVATE_SHEET_ID y volve a ejecutar.');
    return;
  }

  const ss = SpreadsheetApp.create("Gaby's Fashion - Privado (cuentas y saldos)");

  const usuarios = ss.getSheets()[0].setName('Usuarios');
  usuarios.getRange(1, 1, 1, USER_HEADERS.length).setValues([USER_HEADERS]).setFontWeight('bold');

  ss.insertSheet('CuentasPorCobrar')
    .getRange(1, 1, 1, 6)
    .setValues([['nombre','telefono','credito_total','saldo_pendiente','ultimo_abono','fecha_ultimo_abono']])
    .setFontWeight('bold');

  ss.insertSheet('Abonos')
    .getRange(1, 1, 1, 4)
    .setValues([['nombre','telefono','monto','fecha']])
    .setFontWeight('bold');

  // El sync de PowerShell entra con la cuenta de servicio, necesita escribir.
  ss.addEditor(SYNC_SERVICE_ACCOUNT);

  Logger.log('LISTO. Pega este ID en PRIVATE_SHEET_ID:');
  Logger.log(ss.getId());
  Logger.log('Archivo: ' + ss.getUrl());
  Logger.log('IMPORTANTE: este archivo NO debe compartirse con "cualquiera con el enlace".');
}
