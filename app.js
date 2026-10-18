/* Timeless Catálogo — lee UN solo CSV (el de productos) y pinta el catálogo público.
   Sin librerías ni build. El pedido no se cobra aquí: se arma el carrito y se
   cierra por chat (WhatsApp o Instagram), que es donde Alberto vende.

   🚨 Esta página es pública. Solo puede leer CSV_PRODUCTOS (config.js).
   Nunca la pestaña Stocks ni el Apps Script del dashboard: tienen costos y márgenes. */

const cfg = (typeof CATALOGO_CONFIG !== 'undefined') ? CATALOGO_CONFIG : {};
const CARRITO_KEY = 'timeless_catalogo_carrito';
const ENVIO_KEY = 'timeless_catalogo_envio';
const CACHE_KEY = 'timeless_catalogo_productos';
const CANT_MAX = 20;

// Foto de reserva: se usa si un producto no tiene fotos o si un enlace está roto.
const FOTO_VACIA = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><rect width="400" height="400" fill="#222"/>' +
  '<text x="200" y="210" text-anchor="middle" font-family="sans-serif" font-size="22" font-weight="700" fill="#8a8680">FOTO PRONTO</text></svg>');

/* ---------- Utilidades de formato / parseo ---------- */
function esc(s){ const d=document.createElement('div'); d.textContent=String(s); return d.innerHTML.replace(/"/g,'&quot;'); }
// Compara textos sin acentos ni mayúsculas ("Categoría" = "categoria").
function norm(s){ return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g,'').trim().toLowerCase(); }
function slug(s){ return norm(s).replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,''); }
// "S/40" si es entero (como en el Canva), "S/24.90" si tiene céntimos.
function fmtPrecio(n){ return 'S/' + (Math.round(n * 100) % 100 === 0 ? String(Math.round(n)) : n.toFixed(2)); }

// Parser CSV con soporte de comillas (celdas con comas o saltos de línea).
// Es el mismo del dashboard.
function parseCSV(text){
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for(let i=0; i<text.length; i++){
    const c = text[i];
    if(inQuotes){
      if(c === '"'){
        if(text[i+1] === '"'){ field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if(c === '"') inQuotes = true;
      else if(c === ','){ row.push(field); field = ''; }
      else if(c === '\n'){ row.push(field); rows.push(row); row = []; field = ''; }
      else if(c !== '\r') field += c;
    }
  }
  if(field !== '' || row.length){ row.push(field); rows.push(row); }
  return rows.filter(r => r.some(cell => String(cell).trim() !== ''));
}

// "S/ 1,234.56" | "1234.56" | "1.234,56" | "23,9" -> número.
// Los CSV de Google en configuración regional de Perú traen COMA decimal:
// "23,9" es 23.90, no 239. Mismo parseo del dashboard.
function parseMoney(s){
  if(typeof s === 'number') return s;
  let t = String(s == null ? '' : s).replace(/[^\d.,\-]/g, '');
  if(!t) return 0;
  const lastComma = t.lastIndexOf(','), lastDot = t.lastIndexOf('.');
  if(lastComma > -1 && lastDot > -1){
    // El separador que aparece más a la derecha es el decimal
    if(lastComma > lastDot) t = t.replace(/\./g,'').replace(',', '.');
    else t = t.replace(/,/g,'');
  } else if(lastComma > -1){
    // Solo comas: decimal si parece "12,5" / "12,50"; si no, separador de miles
    const dec = t.length - lastComma - 1;
    t = (dec === 1 || dec === 2) && t.indexOf(',') === lastComma ? t.replace(',', '.') : t.replace(/,/g,'');
  }
  const n = parseFloat(t);
  return isNaN(n) ? 0 : n;
}

// Fecha de fin de oferta -> instante exacto (milisegundos).
// Acepta "2026-10-31 23:59" y también "31/10/2026 23:59[:00]", que es como
// Sheets suele reescribir las fechas. Sin hora = hasta el final de ese día.
// La hora se interpreta SIEMPRE como hora de Lima (UTC-5, Perú no cambia de
// hora): así la oferta vence a la misma medianoche para todos, aunque el
// celular del cliente esté en otra zona horaria.
// Devuelve null si está vacía y NaN si está escrita de una forma que no se entiende.
function parseFechaLima(s){
  s = String(s == null ? '' : s).trim();
  if(!s) return null;
  let y, mo, d, resto;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(.*)$/);
  if(m){ y = +m[1]; mo = +m[2]; d = +m[3]; resto = m[4]; }
  else {
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(.*)$/);   // dd/mm/yyyy (Perú)
    if(!m) return NaN;
    d = +m[1]; mo = +m[2]; y = +m[3]; resto = m[4];
  }
  let h = 23, mi = 59, se = 59;
  const t = resto.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if(t){ h = +t[1]; mi = +t[2]; se = t[3] ? +t[3] : 0; }
  return Date.UTC(y, mo - 1, d, h + 5, mi, se);
}

// "SI", "sí", "x", "1"… cuentan como marcado.
function esSi(s){ return ['si', 'x', '1', 'true', 'verdadero', 'yes'].indexOf(norm(s)) > -1; }

/* ---------- Productos ---------- */
let PRODUCTOS = [];      // una fila del CSV = un producto vendible (con su propio stock y precio)
let POR_ID = {};
let ENTRADAS = [];       // lo que se ve en la grilla: un producto suelto, o un grupo de variantes (colores)
let ENTRADA_POR_ID = {}; // id de entrada o de variante -> entrada
let PROMOS = [];

// Un enlace de Fotos que termine en .mp4/.webm/.mov se muestra como video.
const EXT_VIDEO = /\.(mp4|webm|mov|m4v)(\?|#|$)/i;
function esVideo(url){ return EXT_VIDEO.test(url); }

// Convierte las filas del CSV en productos. Las columnas se buscan por NOMBRE
// (sin importar acentos, mayúsculas ni el orden), así que mover una columna en
// la hoja no rompe la página.
function filasAProductos(rows){
  if(!rows.length) return [];
  const idx = {};
  rows[0].forEach((h, i) => { idx[norm(h)] = i; });
  const col = (r, nombre) => { const i = idx[nombre]; return i == null ? '' : String(r[i] == null ? '' : r[i]).trim(); };
  const usados = {};
  const out = [];
  rows.slice(1).forEach(r => {
    const nombre = col(r, 'producto');
    if(!nombre) return;
    let id = slug(nombre) || 'producto';
    // Dos productos con el mismo nombre no pueden compartir identificador.
    if(usados[id]){ usados[id]++; id += '-' + usados[id]; } else usados[id] = 1;
    // Disponible: SI (o vacío) = hay; NO = agotado; PRONTO = todavía no llega.
    const disp = norm(col(r, 'disponible'));
    const pronto = ['pronto', 'proximamente', 'proximo'].indexOf(disp) > -1;
    // BestSeller: un número es su puesto en "Más vendidos" (1 = primero); SI = al final.
    const bs = col(r, 'bestseller');
    out.push({
      id: id,
      nombre: nombre,
      categoria: col(r, 'categoria') || 'Otros',
      precio: parseMoney(col(r, 'precio')),
      precioOferta: parseMoney(col(r, 'preciooferta')),
      ofertaHasta: parseFechaLima(col(r, 'ofertahasta')),
      // Solo se marca agotado con un NO explícito. Una celda vacía cuenta como disponible.
      disponible: !pronto && ['no', 'agotado', '0', 'false', 'falso'].indexOf(disp) === -1,
      proximamente: pronto,
      fotos: col(r, 'fotos').split(/[,\n]/).map(f => f.trim()).filter(Boolean),
      descripcion: col(r, 'descripcion'),
      tallas: col(r, 'tallas'),
      nota: col(r, 'nota'),
      // Columnas opcionales: se marcan con SI. Vacío = no.
      nuevo: esSi(col(r, 'nuevo')),
      envioGratis: esSi(col(r, 'enviogratis')),
      bestSeller: /^\d+$/.test(bs) ? Number(bs) : (esSi(bs) ? 99 : 0),
      // Visible = NO: el producto no sale en la página (ej. un lanzamiento que
      // todavía no se anuncia). Vacío = sí se ve.
      visible: ['no', 'oculto', '0', 'false', 'falso'].indexOf(norm(col(r, 'visible'))) === -1,
      material: col(r, 'material'),
      coleccion: col(r, 'coleccion'),
      cuidado: col(r, 'cuidado'),
      // Variantes: dos filas con el mismo Grupo se muestran como UN producto
      // con selector de opción (ej. Collar Gengar: Morado / Plateado).
      grupo: col(r, 'grupo'),
      variante: col(r, 'variante'),
      // Línea dentro de la categoría (ej. Premium / Clásica en cinturones).
      linea: col(r, 'linea'),
    });
  });
  // Un producto sin precio no se puede mostrar ni vender; uno oculto, tampoco.
  return out.filter(p => p.precio > 0 && p.visible);
}

// Arma lo que se pinta en la grilla: cada producto suelto es una entrada, y las
// filas con el mismo Grupo se juntan en una sola entrada con varias variantes.
function construirEntradas(){
  ENTRADAS = []; ENTRADA_POR_ID = {};
  const porGrupo = {};
  PRODUCTOS.forEach(p => {
    let e;
    if(p.grupo){
      const k = norm(p.grupo);
      e = porGrupo[k];
      if(!e){
        e = {id: 'g-' + slug(p.grupo), nombre: p.grupo, categoria: p.categoria, variantes: []};
        porGrupo[k] = e;
        ENTRADAS.push(e);
      }
    } else {
      e = {id: p.id, nombre: p.nombre, categoria: p.categoria, variantes: []};
      ENTRADAS.push(e);
    }
    e.variantes.push(p);
    ENTRADA_POR_ID[p.id] = e;
    ENTRADA_POR_ID[e.id] = e;
  });
  ENTRADAS.forEach(e => {
    const v = e.variantes;
    e.disponible = v.some(p => p.disponible);
    e.proximamente = !e.disponible && v.some(p => p.proximamente);
    e.nuevo = v.some(p => p.nuevo);
    const puestos = v.map(p => p.bestSeller).filter(n => n > 0);
    e.bestSeller = puestos.length ? Math.min.apply(null, puestos) : 0;
    e.linea = (v.find(p => p.linea) || {}).linea || '';
    e.material = (v.find(p => p.material) || {}).material || '';
    e.coleccion = (v.find(p => p.coleccion) || {}).coleccion || '';
    // Fotos de la ficha: las de todas las variantes, sin repetir y en orden.
    // La foto "de los dos colores" va primero en la hoja y queda de portada.
    e.fotos = [];
    v.forEach(p => p.fotos.forEach(f => { if(e.fotos.indexOf(f) === -1) e.fotos.push(f); }));
    // Al elegir una variante, la galería salta a la primera foto que solo es suya.
    v.forEach(p => {
      const propia = p.fotos.find(f => !v.some(o => o !== p && o.fotos.indexOf(f) > -1));
      p.indiceFoto = Math.max(0, e.fotos.indexOf(propia || p.fotos[0]));
    });
  });
}

// Variante que representa a la entrada en la grilla: la primera con stock.
function repVariante(e){
  return e.variantes.find(p => p.disponible) || e.variantes.find(p => p.proximamente) || e.variantes[0];
}
function rangoEstado(e){ return e.disponible ? 0 : (e.proximamente ? 1 : 2); }

// ¿La oferta está vigente en este instante?
// - Sin PrecioOferta (o si no es menor al precio normal): no hay oferta.
// - Con PrecioOferta y sin fecha: oferta sin fecha de fin (sin cuenta regresiva).
// - Con fecha mal escrita: NO se aplica. Es preferible cobrar el precio normal
//   a regalar un descuento por un error de tipeo.
function ofertaActiva(p, ahora){
  if(!(p.precioOferta > 0 && p.precioOferta < p.precio)) return false;
  if(p.ofertaHasta === null) return true;
  if(isNaN(p.ofertaHasta)) return false;
  return ahora < p.ofertaHasta;
}
function precioVigente(p, ahora){ return ofertaActiva(p, ahora) ? p.precioOferta : p.precio; }

// Foto para miniaturas: la primera que no sea video (propia, o de su grupo).
function fotoEntrada(e){ return e.fotos.find(f => !esVideo(f)) || FOTO_VACIA; }
function fotoDe(p){
  const e = ENTRADA_POR_ID[p.id];
  return p.fotos.find(f => !esVideo(f)) || (e ? fotoEntrada(e) : FOTO_VACIA);
}

function fmtCuenta(ms){
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const dos = n => String(n).padStart(2, '0');
  const hms = dos(Math.floor(s % 86400 / 3600)) + ':' + dos(Math.floor(s % 3600 / 60)) + ':' + dos(s % 60);
  return (d > 0 ? d + 'd ' : '') + hms;
}

function preciosHTML(p, ahora){
  if(ofertaActiva(p, ahora)){
    return '<div class="precios"><span class="precio-antes">' + fmtPrecio(p.precio) + '</span>' +
           '<span class="precio-oferta">' + fmtPrecio(p.precioOferta) + '</span></div>';
  }
  return '<div class="precios"><span class="precio">' + fmtPrecio(p.precio) + '</span></div>';
}
function cuentaHTML(p, ahora, clase){
  if(!ofertaActiva(p, ahora) || p.ofertaHasta === null) return '';
  return '<div class="cuenta ' + (clase || '') + '">Oferta termina en <b class="mono" data-hasta="' + p.ofertaHasta + '">' +
         fmtCuenta(p.ofertaHasta - ahora) + '</b></div>';
}

/* ---------- Promociones automáticas ----------
   Viven en su propio CSV (CSV_PROMOS), una fila por promo, así Alberto las
   prende y apaga desde la hoja sin tocar código. Tipos:
   - combo:     lleva TODOS los productos listados (A|B) por un precio total.
   - paquete:   N unidades del alcance por un precio total (ej. 3 por S/110).
   - descuento: por cada N unidades del alcance, se descuentan S/ Valor.
   Alcance: nombres de producto o de grupo separados por "|", o "categoria:Collares".
   Una unidad entra en UNA sola promo (la primera de la lista que la use), para
   que nunca se sumen descuentos por error. */
function filasAPromos(rows){
  if(!rows.length) return [];
  const idx = {};
  rows[0].forEach((h, i) => { idx[norm(h)] = i; });
  const col = (r, nombre) => { const i = idx[nombre]; return i == null ? '' : String(r[i] == null ? '' : r[i]).trim(); };
  return rows.slice(1).map(r => ({
    nombre: col(r, 'nombre'),
    tipo: norm(col(r, 'tipo')),
    alcance: col(r, 'productos').split('|').map(s => s.trim()).filter(Boolean),
    cantidad: parseInt(col(r, 'cantidad'), 10) || 0,
    valor: parseMoney(col(r, 'valor')),
    hasta: parseFechaLima(col(r, 'hasta')),
    activa: esSi(col(r, 'activa')),
    texto: col(r, 'texto'),
  })).filter(pr => pr.nombre && pr.alcance.length && pr.valor > 0);
}
function promoActiva(pr, ahora){
  if(!pr.activa) return false;
  if(pr.hasta === null) return true;
  if(isNaN(pr.hasta)) return false;   // fecha mal escrita: no se aplica
  return ahora < pr.hasta;
}
function coincideAlcance(token, p){
  const t = norm(token);
  if(t.indexOf('categoria:') === 0) return norm(p.categoria) === t.slice(10).trim();
  return norm(p.nombre) === t || (!!p.grupo && norm(p.grupo) === t);
}
function enAlcance(pr, p){ return pr.alcance.some(t => coincideAlcance(t, p)); }
const centavos = n => Math.round(n * 100) / 100;

// Calcula qué promos se aplican a las líneas del carrito y cuánto descuentan.
function aplicarPromos(lineas, ahora){
  const unidades = [];
  lineas.forEach(l => { for(let i = 0; i < l.cant; i++) unidades.push({p: l.p, precio: l.unit, usada: false}); });
  const items = [];
  let total = 0;
  PROMOS.filter(pr => promoActiva(pr, ahora)).forEach(pr => {
    let veces = 0, monto = 0;
    if(pr.tipo === 'combo'){
      for(;;){
        const tomadas = [];
        const completo = pr.alcance.every(t => {
          const u = unidades.find(x => !x.usada && tomadas.indexOf(x) === -1 && coincideAlcance(t, x.p));
          if(u) tomadas.push(u);
          return !!u;
        });
        if(!completo) break;
        const normal = tomadas.reduce((a, u) => a + u.precio, 0);
        if(normal - pr.valor <= 0) break;     // el combo no conviene: no se aplica
        tomadas.forEach(u => { u.usada = true; });
        veces++; monto += normal - pr.valor;
      }
    } else if(pr.cantidad >= 1 && (pr.tipo === 'paquete' || pr.tipo === 'descuento')){
      // Las unidades más caras entran primero al paquete.
      const pool = unidades.filter(u => !u.usada && enAlcance(pr, u.p)).sort((a, b) => b.precio - a.precio);
      for(let i = 0; i + pr.cantidad <= pool.length; i += pr.cantidad){
        const grupo = pool.slice(i, i + pr.cantidad);
        const normal = grupo.reduce((a, u) => a + u.precio, 0);
        const d = pr.tipo === 'paquete' ? normal - pr.valor : Math.min(pr.valor, normal);
        if(d <= 0) continue;
        grupo.forEach(u => { u.usada = true; });
        veces++; monto += d;
      }
    }
    if(veces){ items.push({promo: pr, veces: veces, monto: centavos(monto)}); total += monto; }
  });
  return {items: items, total: centavos(total)};
}
// Textos de promo que se muestran en la ficha de un producto.
function promosDe(p, ahora){
  return PROMOS.filter(pr => pr.texto && promoActiva(pr, ahora) && enAlcance(pr, p)).map(pr => pr.texto);
}

/* ---------- Carga de datos ---------- */
const PROMOS_KEY = 'timeless_catalogo_promos';
function fetchCSV(url){
  const sep = url.indexOf('?') > -1 ? '&' : '?';
  return fetch(url + sep + '_cb=' + Date.now(), {cache:'no-store'})
    .then(r => { if(!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
    .then(parseCSV);
}
function loadCache(key){
  try{ return JSON.parse(localStorage.getItem(key || CACHE_KEY)) || null; }catch(e){ return null; }
}
function saveCache(rows, key){
  try{ localStorage.setItem(key || CACHE_KEY, JSON.stringify(rows)); }catch(e){}
}

function usarFilas(rows){
  PRODUCTOS = filasAProductos(rows);
  POR_ID = {};
  PRODUCTOS.forEach(p => { POR_ID[p.id] = p; });
  construirEntradas();
  firmaOfertas = calcFirma(Date.now());
  renderTodo();
}

// Las promos son opcionales: si no cargan, la página funciona igual sin ellas.
function cargarPromos(){
  if(!cfg.CSV_PROMOS) return Promise.resolve();
  return fetchCSV(cfg.CSV_PROMOS).then(rows => {
    saveCache(rows, PROMOS_KEY);
    PROMOS = filasAPromos(rows);
  }).catch(() => {
    const guardado = loadCache(PROMOS_KEY);
    if(guardado) PROMOS = filasAPromos(guardado);
  });
}

function cargar(){
  const estado = document.getElementById('estado');
  if(!cfg.CSV_PRODUCTOS){
    estado.textContent = 'Falta configurar CSV_PRODUCTOS en config.js.';
    return;
  }
  const promosListas = cargarPromos();
  fetchCSV(cfg.CSV_PRODUCTOS).then(rows => {
    saveCache(rows);
    return promosListas.then(() => usarFilas(rows));
  }).catch(err => {
    // Sin conexión (o Google caído): se muestra la última copia que vio este
    // celular. Puede estar desactualizada, pero al cerrar por chat Alberto
    // confirma stock y precio de todas formas.
    const guardado = loadCache();
    if(guardado){ promosListas.then(() => usarFilas(guardado)); return; }
    console.log('No se pudo leer el catálogo:', err);
    estado.innerHTML = location.protocol === 'file:'
      ? 'Esta página no funciona abriendo el archivo con doble clic:<br>el navegador bloquea la lectura de los productos.<br>Hay que abrirla desde el servidor local (ver PROGRESO.md) o ya publicada.'
      : 'No pudimos cargar el catálogo. Revisa tu conexión y vuelve a intentar.';
  });
}

/* ---------- Grilla ---------- */
// Agrupa por categoría respetando el orden de config.js. Una categoría que no
// esté en esa lista igual aparece, al final. Dentro de cada una van primero los
// que hay, luego los que llegan pronto y al final los agotados (respetando el
// orden de la hoja entre iguales), para que lo que se puede comprar se vea primero.
function agrupar(){
  const orden = (cfg.CATEGORIAS || []).map(norm);
  const grupos = {};
  ENTRADAS.forEach((e, i) => {
    const k = norm(e.categoria);
    if(!grupos[k]) grupos[k] = {nombre: e.categoria, id: 'cat-' + slug(e.categoria), items: []};
    grupos[k].items.push({e: e, i: i});
  });
  Object.keys(grupos).forEach(k => {
    grupos[k].items.sort((a, b) => (rangoEstado(a.e) - rangoEstado(b.e)) || (a.i - b.i));
    grupos[k].items = grupos[k].items.map(x => x.e);
  });
  return Object.keys(grupos).sort((a, b) => {
    const ia = orden.indexOf(a), ib = orden.indexOf(b);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  }).map(k => grupos[k]);
}

// La línea (ej. Premium) con su título y descripción de config.js.
function lineaDe(e){
  if(!e.linea) return null;
  return (cfg.LINEAS || []).find(l => norm(l.clave) === norm(e.linea)) || {titulo: 'Línea ' + e.linea, descripcion: ''};
}
// Etiquetas chicas sobre el nombre: línea, acero inoxidable y colección.
// La de la línea muestra su descripción al pasar el cursor.
function etiquetasHTML(e){
  const out = [];
  const l = lineaDe(e);
  if(l) out.push('<span class="etq etq-linea"' + (l.descripcion ? ' data-tip="' + esc(l.descripcion) + '"' : '') + '>' + esc(l.titulo) + '</span>');
  if(/^acero inoxidable/i.test(e.material)) out.push('<span class="etq">' + esc(/316l/i.test(e.material) ? 'Acero 316L' : 'Acero inoxidable') + '</span>');
  if(e.coleccion) out.push('<span class="etq etq-col">' + esc(e.coleccion) + '</span>');
  return out.length ? '<div class="etqs">' + out.join('') + '</div>' : '';
}

function tarjetaHTML(e, ahora){
  const p = repVariante(e);
  const oferta = e.disponible && ofertaActiva(p, ahora);
  // Un agotado solo dice "Agotado": anunciarlo como nuevo o en oferta sería prometer algo que no hay.
  let tags = '';
  if(e.proximamente) tags = '<span class="tag tag-nuevo">Próximamente</span>';
  else if(!e.disponible) tags = '<span class="tag tag-agotado">Agotado</span>';
  else {
    if(e.nuevo) tags += '<span class="tag tag-nuevo">Nuevo</span>';
    if(oferta) tags += '<span class="tag tag-oferta">Oferta</span>';
  }
  const apagado = !e.disponible && !e.proximamente;
  const opciones = e.variantes.length > 1 ? '<div class="variantes-txt">' + esc(e.variantes.map(v => v.variante || v.nombre).join(' · ')) + '</div>' : '';
  return '<a class="prod' + (apagado ? ' agotado' : '') + '" href="#/p/' + esc(e.id) + '">' +
    '<div class="prod-foto"><img loading="lazy" src="' + esc(fotoEntrada(e)) + '" alt="' + esc(e.nombre) + '">' +
    '<div class="tags">' + tags + '</div></div>' +
    '<div class="prod-info">' + etiquetasHTML(e) + '<div class="prod-nombre">' + esc(e.nombre) + '</div>' + opciones +
    preciosHTML(p, ahora) +
    (e.disponible && p.envioGratis ? '<div class="envio-gratis">Envío gratis</div>' : '') +
    (e.disponible ? cuentaHTML(p, ahora) : '') +
    '</div></a>';
}

function renderGrilla(){
  const ahora = Date.now();
  const main = document.getElementById('catalogo');
  const nav = document.getElementById('catsNav');
  const grupos = agrupar();
  if(!grupos.length){
    nav.innerHTML = '';
    main.innerHTML = '<div class="estado">Todavía no hay productos en el catálogo.</div>';
    return;
  }
  // "Más vendidos": solo aparece si en la hoja hay productos marcados con BestSeller = SI.
  // Van primero los que hay, y entre iguales, por su puesto (columna BestSeller).
  const mas = ENTRADAS.filter(e => e.bestSeller)
    .sort((a, b) => (rangoEstado(a) - rangoEstado(b)) || (a.bestSeller - b.bestSeller));
  const masHTML = mas.length
    ? '<section class="cat" id="cat-mas-vendidos"><h2 class="cat-titulo">Más vendidos</h2>' +
      '<div class="fila">' + mas.map(e => tarjetaHTML(e, ahora)).join('') + '</div></section>'
    : '';
  nav.innerHTML = (mas.length ? '<a href="#cat-mas-vendidos" data-cat="cat-mas-vendidos">Más vendidos</a>' : '') +
    grupos.map(g => '<a href="#' + esc(g.id) + '" data-cat="' + esc(g.id) + '">' + esc(g.nombre) + '</a>').join('') +
    '<a href="#envios" data-cat="envios">Envíos y pagos</a>';
  main.innerHTML = masHTML + grupos.map(g =>
    '<section class="cat" id="' + esc(g.id) + '">' +
    '<h2 class="cat-titulo">' + esc(g.nombre) + ' <span class="cat-cuenta">' + g.items.length + '</span></h2>' +
    '<div class="grilla">' + g.items.map(e => tarjetaHTML(e, ahora)).join('') + '</div>' +
    (cfg.FRASE_TALLA ? '<p class="frase-talla">' + esc(cfg.FRASE_TALLA) + '</p>' : '') +
    '</section>'
  ).join('');
}

// Los atajos bajan con scroll en vez de cambiar la dirección: el "#" de la
// dirección se reserva para la ficha y el carrito.
document.addEventListener('click', e => {
  const s = e.target.closest('[data-scroll]');
  if(s){
    e.preventDefault();
    const sec = document.getElementById(s.dataset.scroll);
    if(sec) sec.scrollIntoView();
  }
});
document.getElementById('catsNav').addEventListener('click', e => {
  const a = e.target.closest('a[data-cat]');
  if(!a) return;
  e.preventDefault();
  const sec = document.getElementById(a.dataset.cat);
  if(sec) sec.scrollIntoView();
});
document.getElementById('marcaLink').addEventListener('click', e => {
  e.preventDefault();
  window.scrollTo(0, 0);
});

/* ---------- Carrito (persistente) ---------- */
// Se guarda solo {id: cantidad}. El precio NO se guarda: siempre se calcula
// con el dato vigente, así una oferta vencida no se queda pegada en el carrito.
let carrito = {};
try{ carrito = JSON.parse(localStorage.getItem(CARRITO_KEY)) || {}; }catch(e){ carrito = {}; }
if(typeof carrito !== 'object' || Array.isArray(carrito)) carrito = {};
// Cómo quiere recibirlo el cliente (opcional). Vacío = "lo coordino por chat".
let envioSel = '';
try{ envioSel = localStorage.getItem(ENVIO_KEY) || ''; }catch(e){ envioSel = ''; }
// Distrito para el delivery (se recuerda en el celular; no es un dato sensible).
const DISTRITO_KEY = 'timeless_catalogo_distrito';
let distritoTxt = '';
try{ distritoTxt = localStorage.getItem(DISTRITO_KEY) || ''; }catch(e){ distritoTxt = ''; }
let puntoRecojo = 0;          // índice en PUNTOS_RECOJO
let fechaEntrega = '';        // "2026-10-25" (solo delivery)
let pagoProducto = 'Yape';    // delivery: cómo paga el producto al recibir
// Datos del cliente para el envío (nombre, DNI…). Solo viven mientras la página
// está abierta: NO se guardan en el celular ni en ningún otro lado; viajan
// únicamente dentro del mensaje que el cliente manda por chat.
const datos = {};
const CAMPOS_DATOS = {
  moto: [['nombres', 'Nombres'], ['celular', 'Celular', 'tel'], ['direccion', 'Dirección'], ['maps', 'Dirección en Google Maps (link)', 'url']],
  indrive: [['nombres', 'Nombres'], ['celular', 'Celular', 'tel'], ['direccion', 'Dirección'], ['maps', 'Dirección en Google Maps (link)', 'url']],
  shalom: [['nombres', 'Nombres y apellidos completos'], ['celular', 'Celular', 'tel'], ['dni', 'DNI', 'text', 'numeric'],
           ['departamento', 'Departamento'], ['provincia', 'Provincia'], ['distrito', 'Distrito'],
           ['agencia', 'Agencia de Shalom'], ['correo', 'Correo (opcional)', 'email']],
};

/* ---------- Costo de envío por distrito ---------- */
function buscarDistrito(txt){
  const t = norm(txt);
  if(!t) return null;
  return (cfg.DISTRITOS || []).find(d => norm(d.n) === t || (d.alias || []).some(a => norm(a) === t)) || null;
}
// El delivery cuesta mínimo S/10 aunque la tarifa del courier sea menor.
function rangoDistrito(d){
  const piso = cfg.ENVIO_MINIMO_MOTO || 0;
  const a = Math.max(piso, d.min), b = Math.max(piso, d.max || d.min);
  return {min: a, max: b};
}
function textoRango(r){ return r.max > r.min ? fmtPrecio(r.min) + ' – ' + fmtPrecio(r.max) + ' según la zona' : fmtPrecio(r.min); }
const cubreGratis = () => cfg.ENVIO_GRATIS_CUBRE || 0;
const costoShalom = () => cfg.SHALOM_COSTO || 8;
// Desde cuánto conviene recomendar Shalom en vez del delivery.
const RECOMENDAR_SHALOM_DESDE = 15;

// Recuadro con el costo aproximado del delivery a un distrito. Se usa en la
// sección "Envíos y pagos" y en el carrito (ahí con el botón "Cambiar a Shalom").
function cotizacionHTML(txt, gratis, enCarrito){
  if(!norm(txt)) return '';
  const d = buscarDistrito(txt);
  if(!d) return '<div class="cotiz cotiz-no">No encontramos ese distrito. Escríbenos y revisamos si llegamos, o elige Shalom (' +
    fmtPrecio(costoShalom()) + ' a todo el Perú).</div>';
  const r = rangoDistrito(d);
  let h = '<div class="cotiz"><div class="cotiz-fila"><span>Delivery a ' + esc(d.n) + '</span><b>' + textoRango(r) + '</b></div>';
  if(d.nota) h += '<div class="cotiz-nota">' + esc(d.nota) + '</div>';
  h += '<div class="cotiz-nota">' + (d.h48 ? 'Llega en 48 horas.' : 'Llega de un día para otro.') + ' Sujeto a cobertura: lo confirmamos por chat.</div>';
  if(gratis) h += '<div class="cotiz-nota cotiz-ok">Tu envío gratis cubre hasta ' + fmtPrecio(cubreGratis()) +
    (r.max > cubreGratis() ? '; si tu zona sale más, pagas solo la diferencia.' : '.') + '</div>';
  if(r.max > RECOMENDAR_SHALOM_DESDE){
    h += '<div class="recomendado"><b>Opción recomendada: Shalom, ' + fmtPrecio(costoShalom()) + '</b>' +
      '<span>Sale más barato a tu distrito. Pagas el producto antes, el envío al recibir, y lo recoges cuando puedas en tu agencia.</span>' +
      (enCarrito ? '<button type="button" class="btn-link" data-envio="shalom">Cambiar a Shalom</button>' : '') + '</div>';
  }
  return h + '</div>';
}

// Costo del envío elegido: {texto, costo}. costo = null cuando no hay un número
// fijo (depende de la zona o se cotiza por chat).
function envioEstimado(id, gratis){
  const cubre = cubreGratis();
  if(id === 'recojo') return {texto: 'Sin costo', costo: 0};
  if(id === 'shalom') return gratis ? {texto: 'Gratis', costo: 0} : {texto: fmtPrecio(costoShalom()) + ' al recibir', costo: costoShalom()};
  if(id === 'indrive') return {texto: gratis ? 'Gratis hasta ' + fmtPrecio(cubre) : 'Se cotiza por chat', costo: null};
  if(id === 'moto'){
    const d = buscarDistrito(distritoTxt);
    if(!d) return {texto: 'desde ' + fmtPrecio(cfg.ENVIO_MINIMO_MOTO || 10), costo: null};
    const r = rangoDistrito(d);
    if(!gratis) return {texto: textoRango(r), costo: r.max === r.min ? r.min : null};
    const a = Math.max(0, r.min - cubre), b = Math.max(0, r.max - cubre);
    if(b === 0) return {texto: 'Gratis', costo: 0};
    return a === b ? {texto: 'Pagas ' + fmtPrecio(a) + ' de diferencia', costo: a}
                   : {texto: 'Gratis o hasta ' + fmtPrecio(b) + ' de diferencia', costo: null};
  }
  return {texto: '', costo: null};
}

/* ---------- Fecha de entrega del delivery (lun–sáb, máx. 1 semana) ---------- */
function fechaISO(d){ return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function limitesFecha(){
  const a = new Date(), b = new Date();
  a.setDate(a.getDate() + 1);
  b.setDate(b.getDate() + 7);
  return {min: fechaISO(a), max: fechaISO(b)};
}
function avisoFecha(v){
  if(!v) return '';
  const l = limitesFecha();
  if(v < l.min) return 'Elige desde mañana en adelante.';
  if(v > l.max) return 'Solo se puede programar hasta 1 semana. Si lo necesitas para más adelante, coordínalo por chat.';
  if(new Date(v + 'T12:00:00').getDay() === 0) return 'Los domingos no hay entregas: elige de lunes a sábado.';
  return '';
}
function fechaBonita(v){
  return new Date(v + 'T12:00:00').toLocaleDateString('es-PE', {weekday: 'long', day: 'numeric', month: 'long'});
}

// Botón "?" que muestra una explicación al pasar el cursor (PC) o al tocarlo (celular).
function infoHTML(etiqueta, contenido){
  return '<span class="info"><button type="button" class="info-btn" aria-label="' + esc(etiqueta) + '">?</button>' +
    '<span class="info-pop" role="tooltip">' + contenido + '</span></span>';
}
document.addEventListener('click', e => {
  const b = e.target.closest('.info-btn');
  document.querySelectorAll('.info.abierto').forEach(x => { if(!b || x !== b.parentNode) x.classList.remove('abierto'); });
  if(b){ e.preventDefault(); e.stopPropagation(); b.parentNode.classList.toggle('abierto'); }
});

function guardarCarrito(){
  try{ localStorage.setItem(CARRITO_KEY, JSON.stringify(carrito)); }catch(e){}
}
function guardarEnvio(){
  try{ localStorage.setItem(ENVIO_KEY, envioSel); }catch(e){}
}
function sePuedePedir(p){ return !!p && p.disponible; }
function setCantidad(id, n){
  n = Math.max(0, Math.min(CANT_MAX, n));
  if(n === 0) delete carrito[id]; else carrito[id] = n;
  guardarCarrito();
  renderContador();
}
function agregar(id){
  // Doble candado: el botón ya sale deshabilitado, pero un agotado tampoco
  // entra al carrito por ningún otro camino.
  if(!sePuedePedir(POR_ID[id])) return false;
  setCantidad(id, (carrito[id] || 0) + 1);
  return true;
}
// Líneas que sí van en el pedido: producto que existe y está disponible.
function lineasValidas(ahora){
  return Object.keys(carrito).filter(id => sePuedePedir(POR_ID[id])).map(id => {
    const p = POR_ID[id], cant = carrito[id], unit = precioVigente(p, ahora);
    return {p: p, cant: cant, unit: unit, sub: unit * cant, oferta: ofertaActiva(p, ahora)};
  });
}
function renderContador(){
  const n = lineasValidas(Date.now()).reduce((a, l) => a + l.cant, 0);
  const el = document.getElementById('carritoNum');
  el.textContent = n;
  el.classList.toggle('con', n > 0);
}

// Basta UN producto marcado con EnvioGratis para que todo el pedido vaya con
// envío gratis (regla de Alberto: "si llevas ese producto, el envío es gratis").
function pedidoConEnvioGratis(lineas){ return lineas.some(l => l.p.envioGratis); }

// Todo lo que muestra el carrito y lleva el mensaje: productos, promos y envío.
function calcularPedido(ahora){
  const lineas = lineasValidas(ahora);
  const subtotal = centavos(lineas.reduce((a, l) => a + l.sub, 0));
  const pr = aplicarPromos(lineas, ahora);
  const productos = centavos(subtotal - pr.total);
  const gratis = pedidoConEnvioGratis(lineas);
  const envio = (cfg.ENVIOS || []).find(x => x.id === envioSel) || null;
  const est = envio ? envioEstimado(envio.id, gratis) : null;
  return {lineas: lineas, subtotal: subtotal, promos: pr.items, descuento: pr.total,
          productos: productos, gratis: gratis, envio: envio, est: est,
          costoEnvio: est ? est.costo : null};
}

// El pedido tal como le llega a Alberto por chat: productos, envío y datos.
function textoPedido(){
  const ped = calcularPedido(Date.now());
  const y = cfg.YAPE || {};
  let t = '¡Hola Timeless! Quiero hacer este pedido:\n\n' +
    ped.lineas.map(l => '• ' + l.cant + ' × ' + l.p.nombre + ' — ' + fmtPrecio(l.unit) +
      (l.cant > 1 ? ' c/u' : '') + (l.oferta ? ' (oferta)' : '')).join('\n');
  if(ped.promos.length){
    t += '\n\nPromos aplicadas:\n' + ped.promos.map(x => '• ' + x.promo.nombre +
      (x.veces > 1 ? ' (×' + x.veces + ')' : '') + ': −' + fmtPrecio(x.monto)).join('\n');
  }
  t += '\n\nTotal productos: ' + fmtPrecio(ped.productos);
  const id = ped.envio ? ped.envio.id : '';
  if(!ped.envio) t += '\nEnvío: por coordinar';
  else {
    let lugar = '';
    if(id === 'recojo') lugar = ' en ' + ((cfg.PUNTOS_RECOJO || [])[puntoRecojo] || '');
    if(id === 'moto'){ const d = buscarDistrito(distritoTxt); lugar = d ? ' a ' + d.n : (distritoTxt ? ' a ' + distritoTxt : ''); }
    t += '\nEnvío: ' + ped.envio.nombre + lugar + ' (' + (ped.gratis && ped.est.texto !== 'Gratis' ? 'envío gratis · ' : '') + ped.est.texto + ')';
    if(ped.costoEnvio > 0) t += '\nTotal aprox.: ' + fmtPrecio(ped.productos + ped.costoEnvio);
    if(id === 'moto'){
      if(fechaEntrega && !avisoFecha(fechaEntrega)) t += '\nDía de entrega: ' + fechaBonita(fechaEntrega);
      t += '\nEl producto lo pago al recibir con: ' + pagoProducto;
    }
    if(id === 'shalom' || id === 'indrive') t += '\nYapeo ' + fmtPrecio(ped.productos) + ' (productos) al ' + (y.numero || '') + ' y te envío la captura.';
    const campos = (CAMPOS_DATOS[id] || []).filter(c => String(datos[c[0]] || '').trim());
    if(campos.length) t += '\n\nMis datos:\n' + campos.map(c => c[1].replace(/ \(.*\)$/, '') + ': ' + String(datos[c[0]]).trim()).join('\n');
  }
  return t + '\n\nPedido armado desde el catálogo web.';
}

/* ---------- "Avísame cuando vuelva" ----------
   La lista de espera NO se guarda en la página (es pública y no tiene dónde
   guardar datos privados). El cliente manda un mensaje ya escrito por WhatsApp
   o Instagram: a Alberto le llega como un chat más, con el contacto de la
   persona, y solo él lo ve. */
let avisoCopiado = null;   // id del producto cuyo mensaje ya se copió para Instagram
function textoAviso(p){
  return p.proximamente
    ? '¡Hola Timeless! Quiero que me avisen cuando llegue: ' + p.nombre
    : '¡Hola Timeless! Quiero que me avisen cuando vuelva a haber stock de: ' + p.nombre;
}
function avisoHTML(p){
  return '<button type="button" class="btn" disabled>' + (p.proximamente ? 'Próximamente' : 'Agotado') + '</button>' +
    '<p class="aviso-titulo">' + (p.proximamente ? '¿Quieres que te avisemos cuando llegue?' : '¿Quieres que te avisemos cuando vuelva?') + '</p>' +
    '<a class="btn btn-wa" href="' + esc(urlWhatsApp(textoAviso(p))) + '" target="_blank" rel="noopener">Avísame por WhatsApp</a>' +
    (avisoCopiado === p.id
      ? '<div class="copiado" style="margin-top:14px">✓ Mensaje copiado. Pégalo en nuestro chat de Instagram.</div>' +
        '<a class="btn" href="' + esc(urlInstagram()) + '" target="_blank" rel="noopener">Abrir Instagram</a>'
      : '<button type="button" class="btn" data-aviso-ig="' + esc(p.id) + '">Avísame por Instagram</button>');
}

/* ---------- Ficha de producto ---------- */
let fichaEntradaId = null;   // qué ficha está abierta
let fichaVarId = null;       // y qué variante (color) tiene elegida

// Posición actual de la galería (0 = primera foto), para no perderla al repintar.
function indiceGaleria(){
  const pista = document.getElementById('galPista');
  return pista && pista.clientWidth ? Math.round(pista.scrollLeft / pista.clientWidth) : 0;
}

function renderFicha(indice){
  const e = ENTRADA_POR_ID[fichaEntradaId];
  const p = POR_ID[fichaVarId];
  const ahora = Date.now();
  const medios = e.fotos.length ? e.fotos : [FOTO_VACIA];
  const varias = medios.length > 1;
  const dato = (titulo, valor) => valor ? '<div class="dato"><dt>' + titulo + '</dt><dd>' + esc(valor) + '</dd></div>' : '';
  const enCarrito = carrito[p.id] || 0;
  const promos = e.disponible ? promosDe(p, ahora) : [];
  const linea = lineaDe(e);
  const esCinturon = norm(p.categoria) === 'cinturones';
  const guia = (cfg.GUIA_TALLA || []).map(t => '<p>' + esc(t) + '</p>').join('');
  document.getElementById('fichaBody').innerHTML =
    '<div class="galeria"><div class="galeria-pista" id="galPista">' +
      medios.map((f, i) => esVideo(f)
        ? '<video src="' + esc(f) + '#t=0.1" controls muted playsinline preload="metadata" aria-label="Video de ' + esc(e.nombre) + '"></video>'
        : '<img src="' + esc(f) + '" alt="' + esc(e.nombre) + ' — foto ' + (i + 1) + '">').join('') +
    '</div>' +
    (varias ? '<button type="button" class="galeria-nav galeria-prev" data-gal="-1" aria-label="Foto anterior">‹</button>' +
              '<button type="button" class="galeria-nav galeria-next" data-gal="1" aria-label="Foto siguiente">›</button>' +
              '<div class="galeria-cuenta mono" id="galCuenta">1/' + medios.length + '</div>' : '') +
    '</div>' +
    '<div class="sheet-pad">' +
      '<div class="eyebrow">' + esc(e.categoria) + (e.nuevo && e.disponible ? ' · Nuevo' : '') + '</div>' +
      '<h2>' + esc(e.nombre) + '</h2>' +
      etiquetasHTML(e) +
      (linea && linea.descripcion ? '<p class="linea-desc"><b>' + esc(linea.titulo) + ':</b> ' + esc(linea.descripcion) + '</p>' : '') +
      (e.variantes.length > 1
        ? '<div class="variantes"><div class="variantes-titulo">Color</div><div class="chips">' +
          e.variantes.map(v => '<button type="button" class="chip' + (v.id === p.id ? ' activo' : '') + (v.disponible ? '' : ' agotado') +
            '" data-variante="' + esc(v.id) + '">' + esc(v.variante || v.nombre) +
            (v.disponible ? '' : (v.proximamente ? ' · Próximamente' : ' · Agotado')) + '</button>').join('') +
          '</div></div>'
        : '') +
      '<div class="ficha-precios">' + preciosHTML(p, ahora) + '</div>' +
      (p.disponible ? cuentaHTML(p, ahora, 'ficha-cuenta') : '') +
      (p.disponible && p.envioGratis ? '<div class="envio-gratis" style="margin-top:8px">🚚 Envío gratis llevando este producto</div>' : '') +
      (promos.length ? '<div class="promo-caja">' + promos.map(t => '<div>🏷 ' + esc(t) + '</div>').join('') + '</div>' : '') +
      '<dl class="datos">' +
        dato('Descripción y medidas', p.descripcion) +
        // En cinturones la talla es la del pantalón (así está en el Canva), con
        // una "?" que explica cómo medirse; en el resto, "Tallas" a secas.
        (esCinturon && p.tallas
          ? '<div class="dato"><dt>Tallas de pantalón ' + infoHTML('¿Cómo saber tu talla?', '<b>¿Cómo saber tu talla?</b>' + guia) + '</dt><dd>' + esc(p.tallas) + '</dd></div>'
          : dato('Tallas', p.tallas)) +
        dato('Material', p.material) +
        dato('Nota', p.nota) +
        dato('Cuidado', p.cuidado) +
      '</dl>' +
      (esCinturon && guia ? '<div class="guia-talla"><div class="guia-titulo">¿Cómo saber tu talla?</div>' + guia + '</div>' : '') +
      (p.disponible
        ? '<button type="button" class="btn btn-primario" data-agregar="' + esc(p.id) + '">Agregar al carrito</button>'
        : avisoHTML(p)) +
      (enCarrito && p.disponible ? '<div class="en-carrito">Tienes ' + enCarrito + ' en tu carrito · <a href="#/carrito">Ver carrito</a></div>' : '') +
      (cfg.FRASE_TALLA ? '<p class="frase-talla">' + esc(cfg.FRASE_TALLA) + '</p>' : '') +
    '</div>';
  const pista = document.getElementById('galPista');
  if(varias){
    pista.addEventListener('scroll', () => {
      const i = Math.round(pista.scrollLeft / pista.clientWidth) + 1;
      document.getElementById('galCuenta').textContent = i + '/' + medios.length;
    }, {passive:true});
  }
  if(indice > 0) pista.scrollLeft = pista.clientWidth * indice;
}

document.getElementById('fichaBody').addEventListener('click', e => {
  const nav = e.target.closest('[data-gal]');
  if(nav){
    const pista = document.getElementById('galPista');
    pista.scrollBy({left: pista.clientWidth * Number(nav.dataset.gal), behavior:'smooth'});
    return;
  }
  const chip = e.target.closest('[data-variante]');
  if(chip){
    fichaVarId = chip.dataset.variante;
    renderFicha(POR_ID[fichaVarId].indiceFoto);
    return;
  }
  const aviso = e.target.closest('[data-aviso-ig]');
  if(aviso){
    const p = POR_ID[aviso.dataset.avisoIg];
    copiar(textoAviso(p)).then(ok => {
      if(ok){ avisoCopiado = p.id; renderFicha(indiceGaleria()); }
      else toast('No se pudo copiar. Escríbenos por Instagram con el nombre del producto.');
    });
    return;
  }
  const add = e.target.closest('[data-agregar]');
  if(add){
    if(agregar(add.dataset.agregar)){
      toast('Agregado al carrito');
      renderFicha(indiceGaleria());
    }
  }
});

/* ---------- Carrito: vista y cierre del pedido ---------- */
// Pasos: 'lista' -> 'canal' (¿WhatsApp o Instagram?) -> 'instagram' (pedido copiado).
let pasoCarrito = 'lista';
let copiadoOk = false;

// Lo que se abre debajo de la opción de envío elegida.
function detalleEnvioHTML(id, ped){
  const y = cfg.YAPE || {};
  const yape = (monto, para) => '<div class="yape"><div class="yape-monto">Yapea ' + monto + '</div>' +
    '<div>al <b class="mono">' + esc(y.numero || '') + '</b> · ' + esc(y.nombre || '') + '</div>' +
    '<div class="nota-chica">' + para + ' Luego envía la captura en el chat junto con tu pedido.</div></div>';
  const campos = (titulo, extra) => '<div class="datos-form"><div class="variantes-titulo">' + titulo + '</div>' +
    (CAMPOS_DATOS[id] || []).map(c =>
      '<label class="campo"><span>' + esc(c[1]) + (c[0] === 'maps' ? ' ' + infoHTML('Cómo mandar tu ubicación',
        '<b>¿No tienes el link?</b> Mándanos por WhatsApp tu <b>ubicación actual</b> (no "en tiempo real"): se ve así 👇' +
        '<img src="img/ubicacion-actual.jpg" alt="Ejemplo de ubicación actual en WhatsApp" loading="lazy">' +
        'O en Google Maps busca tu casa → Compartir → Copiar enlace, y pégalo aquí.') : '') + '</span>' +
      '<input type="' + (c[2] || 'text') + '"' + (c[3] ? ' inputmode="' + c[3] + '"' : '') + ' data-dato="' + c[0] + '" value="' + esc(datos[c[0]] || '') + '" autocomplete="off"></label>'
    ).join('') + (extra || '') + '</div>';
  let h = '';
  if(id === 'recojo'){
    h += '<div class="chips">' + (cfg.PUNTOS_RECOJO || []).map((pt, i) =>
      '<label class="chip' + (i === puntoRecojo ? ' activo' : '') + '"><input type="radio" name="punto" value="' + i + '"' + (i === puntoRecojo ? ' checked' : '') + '>' + esc(pt) + '</label>').join('') + '</div>' +
      '<p class="nota-chica">Coordinamos el día y la hora por chat. Pagas al recibir (o por adelantado, si prefieres).</p>';
  }
  if(id === 'moto'){
    const l = limitesFecha();
    const aviso = avisoFecha(fechaEntrega);
    h += '<label class="campo"><span>Tu distrito</span><input id="distritoCarrito" list="listaDistritos" data-distrito value="' + esc(distritoTxt) + '" placeholder="Escribe o elige tu distrito" autocomplete="off"></label>' +
      cotizacionHTML(distritoTxt, ped.gratis, true) +
      '<label class="campo"><span>¿Qué día lo quieres? (lunes a sábado, 11am a 7pm)</span><input type="date" data-fecha min="' + l.min + '" max="' + l.max + '" value="' + esc(fechaEntrega) + '"></label>' +
      (aviso ? '<div class="cotiz cotiz-no">' + esc(aviso) + '</div>' : '') +
      '<div class="variantes-titulo" style="margin-top:12px">El producto lo pagas al recibir con</div><div class="chips">' +
      ['Yape', 'Efectivo (monto exacto)'].map(v => '<label class="chip' + (v === pagoProducto ? ' activo' : '') + '"><input type="radio" name="pagoprod" value="' + esc(v) + '"' + (v === pagoProducto ? ' checked' : '') + '>' + esc(v) + '</label>').join('') + '</div>';
    if(ped.costoEnvio > 0) h += yape(fmtPrecio(ped.costoEnvio) + ' del envío', 'Así tu pedido queda separado (máximo 1 semana).');
    else if(ped.costoEnvio === 0) h += '<p class="nota-chica">Tu envío es gratis: te escribimos para confirmar y separar tu pedido.</p>';
    else if(ped.gratis) h += '<p class="nota-chica">Tu envío gratis cubre hasta ' + fmtPrecio(cubreGratis()) + '. Te confirmamos por chat si tu zona tiene alguna diferencia.</p>';
    else h += '<p class="nota-chica">Te confirmamos el costo exacto por chat y ahí yapeas solo el envío para separar tu pedido (máximo 1 semana).</p>';
    h += campos('Tus datos para el delivery');
  }
  if(id === 'indrive'){
    h += yape(fmtPrecio(ped.productos), 'Es el pago de tus productos; el envío lo pagas al recibir (te lo cotizamos por chat).') +
      '<p class="nota-chica">Coordinamos el día y la hora por chat. Te mandamos foto al dejarlo con el conductor y el seguimiento en vivo.</p>' +
      campos('Tus datos para el envío');
  }
  if(id === 'shalom'){
    h += yape(fmtPrecio(ped.productos), 'Es el pago de tus productos; el envío (' + (ped.gratis ? 'gratis' : fmtPrecio(costoShalom())) + ') lo pagas al recibir.') +
      '<p class="nota-chica">S/12 solo en algunas zonas de la selva. El día en que lo dejamos en Shalom se coordina por chat; te enviamos la guía y la clave al registrarlo y la boleta al dejarlo. ¿Lo quieres más rápido? Pregúntanos por el envío express por avión.</p>' +
      campos('Datos para Shalom', '<p class="nota-chica">Los datos deben ser de una persona mayor de edad.</p>');
  }
  return h ? '<div class="envio-detalle">' + h + '</div>' : '';
}

function renderCarrito(){
  const ahora = Date.now();
  const body = document.getElementById('carritoBody');
  const ids = Object.keys(carrito);
  const ped = calcularPedido(ahora);
  const validas = ped.lineas;

  if(pasoCarrito !== 'lista' && !validas.length) pasoCarrito = 'lista';

  if(pasoCarrito === 'canal'){
    body.innerHTML = '<div class="sheet-pad">' +
      '<h2>Cerrar pedido</h2>' +
      '<p class="pregunta">¿Coordinamos por WhatsApp o por Instagram?</p>' +
      '<p class="nota-chica">Te respondemos por el chat que elijas para confirmar stock y tu envío. Si justo algo se agotó, te avisamos ahí.</p>' +
      '<button type="button" class="btn btn-wa" data-canal="whatsapp">WhatsApp</button>' +
      '<button type="button" class="btn" data-canal="instagram">Instagram</button>' +
      '<button type="button" class="btn-link" data-paso="lista">← Volver al carrito</button>' +
      '</div>';
    return;
  }

  if(pasoCarrito === 'instagram'){
    // Instagram no permite abrir un DM con el mensaje ya escrito (es una regla
    // de ellos, no hay forma de evitarla). Por eso: se copia el pedido y el
    // cliente lo pega en el chat.
    body.innerHTML = '<div class="sheet-pad">' +
      '<h2>Instagram</h2>' +
      (copiadoOk
        ? '<div class="copiado">✓ Tu pedido ya está copiado</div>'
        : '<div class="copiado fallo">No pudimos copiarlo solo. Mantén presionado el texto de abajo y elige "Copiar".</div>') +
      '<ol class="pasos"><li>Toca <b>Abrir Instagram</b>.</li><li>En nuestro perfil toca <b>Mensaje</b>.</li><li>Mantén presionado y elige <b>Pegar</b>. Envía.</li></ol>' +
      '<a class="btn btn-primario" href="' + esc(urlInstagram()) + '" target="_blank" rel="noopener">Abrir Instagram (@' + esc(cfg.INSTAGRAM_USUARIO || '') + ')</a>' +
      '<textarea class="pedido-texto" readonly id="pedidoTexto">' + esc(textoPedido()) + '</textarea>' +
      '<button type="button" class="btn-link" data-paso="canal">← Elegir otro medio</button>' +
      '</div>';
    return;
  }

  if(!ids.length){
    body.innerHTML = '<div class="sheet-pad"><h2>Tu pedido</h2>' +
      '<div class="estado">Tu carrito está vacío.<br>Toca un producto y agrégalo.</div>' +
      '<button type="button" class="btn" data-cerrar>Seguir viendo</button></div>';
    return;
  }

  const filas = ids.map(id => {
    const p = POR_ID[id], cant = carrito[id];
    if(!sePuedePedir(p)){
      // Estaba en el carrito y se agotó (o salió del catálogo): se avisa y no entra al pedido.
      return '<div class="linea fuera">' +
        '<img src="' + esc(p ? fotoDe(p) : FOTO_VACIA) + '" alt="">' +
        '<div><div class="linea-nombre">' + esc(p ? p.nombre : 'Producto que ya no está en el catálogo') + '</div>' +
        '<div class="linea-sub">Se agotó: no se incluye en el pedido</div></div>' +
        '<div class="linea-der"><button type="button" class="btn-link" data-quitar="' + esc(id) + '">Quitar</button></div></div>';
    }
    const unit = precioVigente(p, ahora);
    return '<div class="linea">' +
      '<img src="' + esc(fotoDe(p)) + '" alt="">' +
      '<div><div class="linea-nombre">' + esc(p.nombre) + '</div>' +
      '<div class="linea-sub">' + fmtPrecio(unit) + (ofertaActiva(p, ahora) ? ' · oferta' : '') + (cant > 1 ? ' c/u' : '') + '</div></div>' +
      '<div class="linea-der"><div class="linea-total">' + fmtPrecio(unit * cant) + '</div>' +
      '<div class="cant"><button type="button" data-cant="-1" data-id="' + esc(id) + '" aria-label="Quitar uno">−</button>' +
      '<span>' + cant + '</span>' +
      '<button type="button" data-cant="1" data-id="' + esc(id) + '" aria-label="Agregar uno">+</button></div></div></div>';
  }).join('');

  // Promos aplicadas (solo si hay).
  const promosHTML = ped.promos.length
    ? '<div class="fila-total"><span>Subtotal</span><span>' + fmtPrecio(ped.subtotal) + '</span></div>' +
      ped.promos.map(x => '<div class="promo-linea"><span>🏷 ' + esc(x.promo.nombre) + (x.veces > 1 ? ' ×' + x.veces : '') +
        '</span><span>−' + fmtPrecio(x.monto) + '</span></div>').join('')
    : '';

  // Cómo lo recibe: opcional. Al elegir una opción se abre su detalle (distrito,
  // fecha, datos, a cuánto yapear).
  const envios = cfg.ENVIOS || [];
  const opcionHTML = (id, nombre, precio, pago, sel) =>
    '<label class="opcion' + (sel ? ' sel' : '') + '"><input type="radio" name="envio" value="' + esc(id) + '"' + (sel ? ' checked' : '') + '>' +
    '<span class="opcion-cuerpo"><span class="opcion-fila"><span class="opcion-nombre">' + esc(nombre) + '</span>' +
    (precio ? '<span class="opcion-precio">' + esc(precio) + '</span>' : '') + '</span>' +
    (pago ? '<span class="opcion-nota">' + esc(pago) + '</span>' : '') + '</span></label>' +
    (sel ? detalleEnvioHTML(id, ped) : '');
  const enviosHTML = envios.length && validas.length
    ? '<div class="envio-bloque"><div class="variantes-titulo">¿Cómo lo recibes? Cotiza tu envío</div>' +
      envios.map(x => opcionHTML(x.id, x.nombre, envioEstimado(x.id, ped.gratis).texto, x.pago, envioSel === x.id)).join('') +
      opcionHTML('', 'Lo coordino por chat', '', 'Te ayudamos a elegir la mejor opción.', !envioSel) +
      '</div>'
    : '';
  const totalAprox = (ped.envio && ped.costoEnvio > 0)
    ? '<div class="fila-total"><span>Envío aprox.</span><span>' + fmtPrecio(ped.costoEnvio) + '</span></div>' +
      '<div class="total"><span>Total aprox.</span><b>' + fmtPrecio(ped.productos + ped.costoEnvio) + '</b></div>'
    : '<div class="total"><span>Total productos</span><b>' + fmtPrecio(ped.productos) + '</b></div>';

  body.innerHTML = '<div class="sheet-pad"><h2>Tu pedido</h2>' + filas + promosHTML + enviosHTML +
    '<div class="resumen-total">' + totalAprox + '</div>' +
    (ped.gratis
      ? '<div class="envio-gratis envio-gratis-caja">🚚 Tu pedido va con envío gratis (cubre hasta ' + fmtPrecio(cubreGratis()) + ')</div>'
      : '') +
    '<p class="nota-chica">El costo de envío es aproximado y se confirma por chat. Solo enviamos dentro del Perú. En cualquier opción también puedes pagar todo por adelantado.</p>' +
    (validas.length
      ? '<button type="button" class="btn btn-primario" data-paso="canal">Cerrar pedido</button>'
      : '<button type="button" class="btn" disabled>No hay productos disponibles en tu carrito</button>') +
    '<button type="button" class="btn-link" data-vaciar>Vaciar carrito</button>' +
    '</div>';
}

function urlInstagram(){
  return 'https://www.instagram.com/' + encodeURIComponent(cfg.INSTAGRAM_USUARIO || '') + '/';
}
function urlWhatsApp(texto){
  let num = String(cfg.WHATSAPP_NUMERO || '').replace(/\D/g, '');
  // Si alguien pega solo los 9 dígitos del celular, se le pone el código de Perú.
  if(num.length === 9 && num[0] === '9') num = '51' + num;
  return 'https://wa.me/' + num + '?text=' + encodeURIComponent(texto);
}

// Copia al portapapeles. Primero el método moderno; si el navegador no lo
// tiene (o lo niega), el método viejo con un campo de texto oculto.
function copiar(texto){
  const viejo = () => {
    try{
      const ta = document.createElement('textarea');
      ta.value = texto;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, texto.length);
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    }catch(e){ return false; }
  };
  if(navigator.clipboard && navigator.clipboard.writeText){
    return navigator.clipboard.writeText(texto).then(() => true).catch(() => viejo());
  }
  return Promise.resolve(viejo());
}

function guardarDistrito(){
  try{ localStorage.setItem(DISTRITO_KEY, distritoTxt); }catch(e){}
}
// Repinta el carrito sin perder dónde estaba el cliente (scroll y, si estaba
// escribiendo su distrito, el cursor).
function repintarCarrito(enfocar){
  const sheet = document.querySelector('#carritoOverlay .sheet');
  const top = sheet ? sheet.scrollTop : 0;
  renderCarrito();
  if(sheet) sheet.scrollTop = top;
  if(enfocar){
    const el = document.getElementById(enfocar);
    if(el){ el.focus(); try{ el.setSelectionRange(el.value.length, el.value.length); }catch(err){} }
  }
}
document.getElementById('carritoBody').addEventListener('change', e => {
  const t = e.target;
  if(t.name === 'envio'){ envioSel = t.value; guardarEnvio(); repintarCarrito(); }
  else if(t.name === 'punto'){ puntoRecojo = Number(t.value) || 0; repintarCarrito(); }
  else if(t.name === 'pagoprod'){ pagoProducto = t.value; repintarCarrito(); }
  else if(t.hasAttribute('data-fecha')){ fechaEntrega = t.value; repintarCarrito(); }
  else if(t.hasAttribute('data-distrito')){ distritoTxt = t.value; guardarDistrito(); repintarCarrito(); }
});
document.getElementById('carritoBody').addEventListener('input', e => {
  const t = e.target;
  if(t.dataset.dato){ datos[t.dataset.dato] = t.value; return; }
  if(t.hasAttribute('data-distrito')){
    distritoTxt = t.value;
    guardarDistrito();
    // Apenas lo escrito coincide con un distrito, se muestra el costo.
    if(buscarDistrito(distritoTxt)) repintarCarrito('distritoCarrito');
  }
});
document.getElementById('carritoBody').addEventListener('click', e => {
  const t = e.target;
  const cambio = t.closest('[data-envio]');
  if(cambio){ envioSel = cambio.dataset.envio; guardarEnvio(); repintarCarrito(); return; }
  const cant = t.closest('[data-cant]');
  if(cant){ setCantidad(cant.dataset.id, (carrito[cant.dataset.id] || 0) + Number(cant.dataset.cant)); renderCarrito(); return; }
  const quitar = t.closest('[data-quitar]');
  if(quitar){ setCantidad(quitar.dataset.quitar, 0); renderCarrito(); return; }
  if(t.closest('[data-vaciar]')){ carrito = {}; guardarCarrito(); renderContador(); renderCarrito(); return; }
  const paso = t.closest('[data-paso]');
  if(paso){ pasoCarrito = paso.dataset.paso; renderCarrito(); return; }
  const canal = t.closest('[data-canal]');
  if(canal){
    const texto = textoPedido();
    if(canal.dataset.canal === 'whatsapp'){
      window.open(urlWhatsApp(texto), '_blank', 'noopener');
    } else {
      copiar(texto).then(ok => { copiadoOk = ok; pasoCarrito = 'instagram'; renderCarrito(); });
    }
  }
});

/* ---------- Navegación: la ficha y el carrito viven en el "#" de la dirección ----------
   Así el botón "atrás" del celular cierra la ficha en vez de sacar al cliente
   de la página, y un producto se puede compartir con su propio enlace. */
let navegoAdentro = false;

function ruta(){
  const h = location.hash;
  const fichaOv = document.getElementById('fichaOverlay');
  const carritoOv = document.getElementById('carritoOverlay');
  let abierto = null;
  let indiceNuevo = 0;
  fichaEntradaId = h.indexOf('#/p/') === 0 ? fichaEntradaId : null;
  if(h.indexOf('#/p/') === 0){
    // El enlace puede ser el de un grupo (g-collar-gengar) o el de una variante.
    const clave = decodeURIComponent(h.slice(4));
    const e = ENTRADA_POR_ID[clave];
    if(e){
      if(fichaEntradaId !== e.id){
        fichaEntradaId = e.id;
        fichaVarId = (clave !== e.id && POR_ID[clave]) ? clave : repVariante(e).id;
        indiceNuevo = POR_ID[fichaVarId].indiceFoto;
      } else {
        indiceNuevo = indiceGaleria();   // repintado (ej. venció una oferta): se queda donde estaba
      }
      abierto = fichaOv;
    }
  } else if(h === '#/carrito'){
    abierto = carritoOv;
  }
  // Primero se muestra la hoja y recién después se pinta: así la galería ya
  // tiene ancho y puede saltar a la foto de la variante elegida.
  fichaOv.hidden = abierto !== fichaOv;
  carritoOv.hidden = abierto !== carritoOv;
  document.body.classList.toggle('sin-scroll', !!abierto);
  if(abierto === fichaOv) renderFicha(indiceNuevo);
  if(abierto === carritoOv) renderCarrito();
  if(abierto) abierto.querySelector('.sheet').scrollTop = 0;
}
function cerrarHoja(){
  // Si se llegó tocando dentro de la página, "cerrar" es lo mismo que "atrás".
  // Si se entró directo con un enlace a un producto, no hay a dónde volver:
  // se limpia la dirección y queda el catálogo.
  if(navegoAdentro) history.back();
  else { history.replaceState(null, '', location.pathname + location.search); ruta(); }
}
window.addEventListener('hashchange', () => {
  navegoAdentro = true;
  // Al entrar al carrito siempre se empieza por la lista.
  if(location.hash === '#/carrito') pasoCarrito = 'lista';
  ruta();
});
document.addEventListener('click', e => {
  // Cierra con la ✕, con un botón "seguir viendo" o tocando el fondo oscuro.
  if(e.target.closest('[data-cerrar]') || e.target.classList.contains('overlay')) cerrarHoja();
});
document.addEventListener('keydown', e => {
  if(e.key === 'Escape' && document.body.classList.contains('sin-scroll')) cerrarHoja();
});
// Una foto con el enlace roto no deja un hueco: se cambia por la de reserva.
document.addEventListener('error', e => {
  const img = e.target;
  if(img && img.tagName === 'IMG' && img.src !== FOTO_VACIA) img.src = FOTO_VACIA;
}, true);

/* ---------- Ofertas con temporizador ---------- */
// Cada segundo se actualizan las cuentas regresivas. Además se compara qué
// ofertas y promos están vigentes contra el segundo anterior: en el instante en
// que una vence, se vuelve a pintar todo y el producto regresa SOLO a su precio
// normal (grilla, ficha abierta y carrito), sin recargar y sin que nadie toque nada.
let firmaOfertas = '';
function calcFirma(ahora){
  return PRODUCTOS.map(p => ofertaActiva(p, ahora) ? '1' : '0').join('') + '|' +
         PROMOS.map(pr => promoActiva(pr, ahora) ? '1' : '0').join('');
}
setInterval(() => {
  renderFranja();
  const ahora = Date.now();
  const firma = calcFirma(ahora);
  if(firma !== firmaOfertas){
    firmaOfertas = firma;
    renderTodo();
    return;
  }
  document.querySelectorAll('[data-hasta]').forEach(el => {
    el.textContent = fmtCuenta(Number(el.dataset.hasta) - ahora);
  });
}, 1000);

/* ---------- Avisos ---------- */
let toastTimer = null;
function toast(msg){
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('ver');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('ver'), 1800);
}

// Aviso de "modo prueba": aparece mientras falte algo por configurar, para que
// la página no se publique por descuido con datos de mentira o sin WhatsApp.
function renderAvisoConfig(){
  const faltan = [];
  if(!String(cfg.WHATSAPP_NUMERO || '').replace(/\D/g, '')) faltan.push('Falta el <b>número de WhatsApp</b>: el pedido se abre sin destinatario.');
  if(!cfg.TIKTOK_USUARIO) faltan.push('Falta el <b>usuario de TikTok</b>: el botón no aparece hasta ponerlo.');
  if(!cfg.INSTAGRAM_USUARIO) faltan.push('Falta el <b>usuario de Instagram</b>.');
  const card = document.getElementById('setupCard');
  card.hidden = !faltan.length;
  document.getElementById('setupBody').innerHTML = '<ul>' + faltan.map(f => '<li>' + f + '</li>').join('') + '</ul>' +
    'Este aviso desaparece solo cuando todo esté configurado en <b>config.js</b>.';
}

// Franja animada de campañas (Cyber Wow, Black Friday…), configurada en config.js.
function renderFranja(){
  const f = cfg.FRANJA || {};
  const el = document.getElementById('franja');
  if(!el) return;
  const prueba = /[?&]franja=prueba\b/.test(location.search);
  const ahora = Date.now(), d = parseFechaLima(f.desde), h = parseFechaLima(f.hasta);
  const vigente = f.activa && f.texto &&
    (d === null || (!isNaN(d) && ahora >= d)) && (h === null || (!isNaN(h) && ahora < h));
  if(!(vigente || (prueba && f.texto))){ el.hidden = true; el.innerHTML = ''; return; }
  if(el.hidden){
    // Dos mitades iguales: al llegar al final de una, empieza la otra sin salto.
    const mitad = ('<span>' + esc(f.texto) + '</span><span class="franja-sep" aria-hidden="true">✦</span>').repeat(6);
    el.innerHTML = '<div class="franja-pista"><div class="franja-mitad">' + mitad + '</div><div class="franja-mitad" aria-hidden="true">' + mitad + '</div></div>';
    el.setAttribute('aria-label', f.texto);
    el.hidden = false;
  }
}

// Sección "Envíos y pagos" de la página: sale de config.js (lo mismo que el carrito).
function renderEnviosSeccion(){
  const cont = document.getElementById('enviosCards');
  if(!cont) return;
  cont.innerHTML = (cfg.ENVIOS || []).map(x =>
    '<div class="envio-card"><div class="envio-titulo">' + esc(x.nombre) + '</div>' +
    '<div class="envio-pago">' + esc(x.pago) + '</div><p>' + esc(x.texto) + '</p>' +
    (x.id === 'moto'
      ? '<label class="campo"><span>Cotiza tu envío</span><input id="distritoHome" list="listaDistritos" placeholder="Escribe o elige tu distrito" autocomplete="off" value="' + esc(distritoTxt) + '"></label>' +
        '<div id="cotizHome">' + cotizacionHTML(distritoTxt, false, false) + '</div>'
      : '') +
    '</div>').join('');
  const lista = document.getElementById('listaDistritos');
  if(lista) lista.innerHTML = (cfg.DISTRITOS || []).map(d => '<option value="' + esc(d.n) + '">').join('');
  const inp = document.getElementById('distritoHome');
  if(inp){
    const act = () => {
      distritoTxt = inp.value;
      guardarDistrito();
      document.getElementById('cotizHome').innerHTML = cotizacionHTML(distritoTxt, false, false);
    };
    inp.addEventListener('change', act);
    inp.addEventListener('input', () => { if(buscarDistrito(inp.value) || !inp.value) act(); });
  }
}

function renderTodo(){
  renderFranja();
  renderGrilla();
  renderContador();
  ruta();
}

/* ---------- Arranque ---------- */
document.getElementById('pieInstagram').href = urlInstagram();
document.getElementById('heroWa').href = urlWhatsApp('¡Hola Timeless! Quiero consultar por un producto');
if(cfg.TIKTOK_USUARIO){
  const tk = document.getElementById('pieTikTok');
  tk.href = 'https://www.tiktok.com/@' + encodeURIComponent(cfg.TIKTOK_USUARIO);
  tk.hidden = false;
}
renderAvisoConfig();
renderFranja();
renderEnviosSeccion();
renderContador();
cargar();
