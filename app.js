/* Timeless Catálogo — lee UN solo CSV (el de productos) y pinta el catálogo público.
   Sin librerías ni build. El pedido no se cobra aquí: se arma el carrito y se
   cierra por chat (WhatsApp o Instagram), que es donde Alberto vende.

   🚨 Esta página es pública. Solo puede leer CSV_PRODUCTOS (config.js).
   Nunca la pestaña Stocks ni el Apps Script del dashboard: tienen costos y márgenes. */

const cfg = (typeof CATALOGO_CONFIG !== 'undefined') ? CATALOGO_CONFIG : {};
const CARRITO_KEY = 'timeless_catalogo_carrito';
const ENVIO_KEY = 'timeless_catalogo_envio';
const CACHE_KEY = 'timeless_catalogo_productos';
// Máximo por producto en el carrito. No se muestra el stock: si piden más de 1,
// el carrito avisa "sujeto a disponibilidad" y Alberto confirma por chat.
const CANT_MAX = 10;

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
let TARJETAS = [];       // lo que se pinta en la grilla (ver construirEntradas)
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
    // Disponible: SI (o vacío) = hay; POCOS = hay, pero quedan pocos; NO = agotado;
    // RESTOCK = agotado pero ya está pedido ("Restock en camino");
    // PRONTO = producto nuevo que todavía no llega.
    const disp = norm(col(r, 'disponible'));
    const pronto = ['pronto', 'proximamente', 'proximo'].indexOf(disp) > -1;
    const restock = ['restock', 'restock en camino', 'en camino'].indexOf(disp) > -1;
    const pocos = ['pocos', 'quedan pocos'].indexOf(disp) > -1;
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
      disponible: !pronto && !restock && ['no', 'agotado', '0', 'false', 'falso'].indexOf(disp) === -1,
      proximamente: pronto,
      restock: restock,
      pocos: pocos,
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
      // Visible = SI escrito a mano: se muestra aunque la lista del dashboard
      // diga "oculto" (ej. el teaser de un lanzamiento con Disponible = PRONTO).
      visibleSi: esSi(col(r, 'visible')),
      // Nombre(s) en el inventario del dashboard, si son distintos ("A|B" si
      // este producto junta varias filas, como el par de anillos).
      inventario: col(r, 'nombreinventario').split('|').map(s => s.trim()).filter(Boolean),
      material: col(r, 'material'),
      coleccion: col(r, 'coleccion'),
      cuidado: col(r, 'cuidado'),
      empaque: col(r, 'empaque'),   // ej. "Cajita premium" o "Bolsa Ziploc"
      // Variantes: dos filas con el mismo Grupo se muestran como UN producto
      // con selector de opción (ej. Collar Gengar: Morado / Plateado).
      grupo: col(r, 'grupo'),
      variante: col(r, 'variante'),
      // Línea dentro de la categoría (ej. Premium / Clásica en cinturones).
      linea: col(r, 'linea'),
    });
  });
  // Un producto sin precio no se puede mostrar ni vender. Los ocultos se
  // filtran después, cuando ya se aplicó la lista del dashboard.
  return out.filter(p => p.precio > 0);
}

/* ---------- Lista de estado del dashboard (CSV_ESTADO) ----------
   Por producto: Estado y puesto de BestSeller. Manda sobre productos.csv.
   Solo trae nombre, estado y puesto: nada de costos, cantidades ni ventas. */
const ESTADO_KEY = 'timeless_catalogo_estado';
const RANGO_ESTADO = {'en stock': 0, 'quedan pocos': 1, 'restock en camino': 2, 'agotado': 3, 'oculto': 4};
let sinEmpatar = [];   // productos que no se encontraron en la lista (para revisar)
function aplicarEstado(productos, filas){
  sinEmpatar = [];
  if(!filas || filas.length < 2) return;
  const idx = {};
  filas[0].forEach((h, i) => { idx[norm(h)] = i; });
  const celda = (r, k) => String(idx[k] == null ? '' : (r[idx[k]] == null ? '' : r[idx[k]])).trim();
  const mapa = {};
  filas.slice(1).forEach(r => {
    const n = norm(celda(r, 'producto'));
    // "Quedan": 1, 2 o 3 SOLO cuando el stock real es ese; vacío = no mostrar cantidad.
    if(n) mapa[n] = {estado: norm(celda(r, 'estado')), puesto: parseInt(celda(r, 'bestseller'), 10) || 0,
                      orden: parseInt(celda(r, 'orden'), 10) || 0, quedan: parseInt(celda(r, 'quedan'), 10) || 0};
  });
  productos.forEach(p => {
    const nombres = p.inventario.length ? p.inventario : [p.nombre];
    const suyas = nombres.map(n => mapa[norm(n)]).filter(Boolean);
    if(suyas.length !== nombres.length || suyas.some(f => !(f.estado in RANGO_ESTADO))){
      sinEmpatar.push(p.nombre);
      return;   // se queda con lo que dice productos.csv
    }
    // Si junta varias filas (el par de anillos), se vende completo: manda la peor.
    const est = suyas.reduce((a, f) => RANGO_ESTADO[f.estado] > RANGO_ESTADO[a] ? f.estado : a, 'en stock');
    if(!(p.proximamente && p.visibleSi)){
      p.disponible = est === 'en stock' || est === 'quedan pocos';
      p.pocos = est === 'quedan pocos';
      // Unidades que quedan (1 a 3). Si junta varias filas, la menor de las que traen número.
      const qs = suyas.map(f => f.quedan).filter(n => n >= 1 && n <= 3);
      p.quedan = p.disponible && qs.length ? Math.min.apply(null, qs) : 0;
      p.restock = est === 'restock en camino';
      p.proximamente = false;
      p.visible = p.visible && (est !== 'oculto' || p.visibleSi);
    }
    // Orden = qué tan rápido se vende dentro de su categoría (1 = el más rápido).
    // El par de anillos son dos filas: vale la menor.
    const ordenes = suyas.map(f => f.orden).filter(n => n > 0);
    p.orden = ordenes.length ? Math.min.apply(null, ordenes) : 0;
    const puestos = suyas.map(f => f.puesto).filter(n => n > 0);
    p.bestSeller = puestos.length ? Math.min.apply(null, puestos) : 0;
  });
  if(sinEmpatar.length) console.warn('Productos que no están en la lista del dashboard:', sinEmpatar.join(', '));
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
    resumirEstado(e, v);
    // Fotos de la ficha: las de todas las variantes, sin repetir y en orden.
    // La foto "de los dos colores" va primero en la hoja y queda de portada.
    e.fotos = [];
    v.forEach(p => p.fotos.forEach(f => { if(e.fotos.indexOf(f) === -1) e.fotos.push(f); }));
    // ¿Hay una foto con todos los colores juntos? Entonces el grupo es UNA
    // tarjeta con esa foto de portada (ej. Black & White Spider, Gengar). Si no,
    // cada color sale como su propia tarjeta y su ficha muestra solo sus fotos
    // (con el selector para pasar al otro color).
    const conFotos = v.filter(p => p.fotos.length);
    e.juntos = v.length === 1 || (conFotos.length > 0 && conFotos.every(p => p.fotos[0] === e.fotos[0]));
    // Al elegir una variante, la galería salta a la primera foto que solo es suya.
    v.forEach(p => {
      const propia = p.fotos.find(f => !v.some(o => o !== p && o.fotos.indexOf(f) > -1));
      p.indiceFoto = e.juntos ? Math.max(0, e.fotos.indexOf(propia || p.fotos[0])) : 0;
    });
  });
  // Lo que se pinta en la grilla: una tarjeta por entrada, o una por color si
  // el grupo no tiene foto de todos juntos. Cada tarjeta tiene la misma forma
  // que una entrada (nombre, fotos, estado…) y su "id" es el del enlace.
  TARJETAS = [];
  ENTRADAS.forEach(e => {
    if(e.juntos){ TARJETAS.push(e); return; }
    e.variantes.forEach(p => {
      const t = {id: p.id, nombre: p.nombre, categoria: p.categoria, variantes: [p],
                 fotos: p.fotos.length ? p.fotos : e.fotos};
      resumirEstado(t, [p]);
      TARJETAS.push(t);
    });
  });
}
// Estado de una entrada o tarjeta a partir de sus variantes.
function resumirEstado(e, v){
  e.disponible = v.some(p => p.disponible);
  e.proximamente = !e.disponible && v.some(p => p.proximamente);
  e.restock = !e.disponible && !e.proximamente && v.some(p => p.restock);
  e.pocos = e.disponible && v.filter(p => p.disponible).every(p => p.pocos);
  // Cuántas quedan: solo cuando hay UNA variante disponible (el número es de ese producto).
  const dispo = v.filter(p => p.disponible);
  e.quedan = dispo.length === 1 && dispo[0].quedan ? dispo[0].quedan : 0;
  e.nuevo = v.some(p => p.nuevo);
  const puestos = v.map(p => p.bestSeller).filter(n => n > 0);
  e.bestSeller = puestos.length ? Math.min.apply(null, puestos) : 0;
  const ords = v.map(p => p.orden).filter(n => n > 0);
  e.orden = ords.length ? Math.min.apply(null, ords) : 0;
  e.linea = (v.find(p => p.linea) || {}).linea || '';
  e.material = (v.find(p => p.material) || {}).material || '';
  e.coleccion = (v.find(p => p.coleccion) || {}).coleccion || '';
  e.empaque = (v.find(p => p.empaque) || {}).empaque || '';
}

// Variante que representa a la entrada en la grilla: la primera con stock.
function repVariante(e){
  return e.variantes.find(p => p.disponible) || e.variantes.find(p => p.proximamente) || e.variantes[0];
}
// Orden dentro de cada categoría: disponibles, próximamente, restock en camino, agotados.
function rangoEstado(e){ return e.disponible ? 0 : (e.proximamente ? 1 : (e.restock ? 2 : 3)); }

// ¿La oferta está vigente en este instante?
// - Sin PrecioOferta (o si no es menor al precio normal): no hay oferta.
// - Con PrecioOferta y sin fecha: oferta sin fecha de fin (sin cuenta regresiva).
// - Con fecha mal escrita: NO se aplica. Es preferible cobrar el precio normal
//   a regalar un descuento por un error de tipeo.
function ofertaActiva(p, ahora){
  if(!(p.precioOferta > 0 && p.precioOferta < p.precio)) return false;
  // Un agotado no muestra una oferta sin fecha de fin: así nadie espera que
  // vuelva a ese precio. Con fecha (máx. 2 días después de agotarse), sí.
  if(!p.disponible && p.ofertaHasta === null) return false;
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
    desde: parseFechaLima(col(r, 'desde')),   // vacío = ya empezó
    hasta: parseFechaLima(col(r, 'hasta')),
    activa: esSi(col(r, 'activa')),
    texto: col(r, 'texto'),
    foto: col(r, 'foto'),   // foto del combo (la del Canva), opcional
    // "Producto=ruta;Producto2=ruta": si ese producto se agota, se QUITA del combo y
    // la foto cambia a esa ruta (solo para los que Alberto no puede fotografiar de nuevo).
    fotoSiAgota: col(r, 'fotosiagota').split(';').map(s => s.trim()).filter(Boolean).map(s => {
      const k = s.indexOf('=');
      return k > 0 ? {producto: norm(s.slice(0, k)), foto: s.slice(k + 1).trim()} : null;
    }).filter(Boolean),
  })).filter(pr => pr.nombre && pr.alcance.length && pr.valor > 0);
}
// ¿Ya empezó? (VER_PROMOS_ANTES solo está prendido en la página de pruebas.)
function promoYaEmpezo(pr, ahora){
  if(cfg.VER_PROMOS_ANTES) return true;
  if(pr.desde === null) return true;
  if(isNaN(pr.desde)) return false;   // fecha mal escrita: no se muestra
  return ahora >= pr.desde;
}
function promoActiva(pr, ahora){
  if(!pr.activa) return false;
  if(!promoYaEmpezo(pr, ahora)) return false;
  if(pr.hasta === null) return true;
  if(isNaN(pr.hasta)) return false;   // fecha mal escrita: no se aplica
  return ahora < pr.hasta;
}
// Un token puede traer opciones separadas por "/": en un combo, "Cinturón Black
// Spider/Cinturón White Spider" quiere decir "cualquiera de los dos".
function coincideAlcance(token, p){
  return String(token).split('/').some(alt => {
    const t = norm(alt);
    if(!t) return false;
    if(t.indexOf('categoria:') === 0) return norm(p.categoria) === t.slice(10).trim();
    return norm(p.nombre) === t || (!!p.grupo && norm(p.grupo) === t);
  });
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
  return PROMOS.map((pr, i) => ({pr: pr, i: i})).filter(x => x.pr.texto && promoActiva(x.pr, ahora) && enAlcance(x.pr, p))
    .map(x => ({texto: x.pr.texto, i: x.i, combo: x.pr.tipo === 'combo'}));
}

/* ---------- Estadísticas (GoatCounter) ----------
   Sin cookies y sin datos personales: solo cuenta visitas y acciones (ver un
   producto, agregarlo, pedir "Avísame", cerrar el pedido). Se ve en
   https://timeless.goatcounter.com. Si no está configurado, no hace nada. */
function contar(path, titulo){
  try{
    if(cfg.GOATCOUNTER && window.goatcounter && window.goatcounter.count)
      window.goatcounter.count({path: path, title: titulo || path, event: true});
  }catch(e){}
}
document.addEventListener('click', e => {
  const el = e.target.closest('[data-contar]');
  if(el) contar(el.dataset.contar, el.textContent.trim());
});

/* ---------- Píxel de Meta (para medir los anuncios) ----------
   Solo se activa si config.js trae META_PIXEL_ID (un número). Manda ÚNICAMENTE eventos
   de la tienda: página vista, producto visto, agregado al carrito, "Hacer pedido" y
   pedido enviado (con el monto). NUNCA manda nombre, teléfono, distrito ni dirección. */
let pixelActivo = false;
function iniciarPixel(){
  const id = String(cfg.META_PIXEL_ID || '').trim();
  if(!/^\d{8,20}$/.test(id)) return;
  try{
    !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
    window.fbq('init', id);
    window.fbq('track', 'PageView');
    pixelActivo = true;
    const aviso = document.getElementById('pixelAviso');
    if(aviso) aviso.hidden = false;
  }catch(e){}
}
function pixel(evento, datos){
  try{ if(pixelActivo && window.fbq) window.fbq('track', evento, datos || {}); }catch(e){}
}
iniciarPixel();

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

// Pantalla negra de carga: se va apenas el catálogo está pintado (mínimo
// 0.7 s para que no parpadee, y máximo 4 s por si algo tarda de más).
// Si el cliente se fue al Libro de Reclamaciones (u otra página nuestra) y vuelve,
// regresa al mismo lugar donde estaba, no al inicio. Se guarda solo por 30 min.
const VOLVER_KEY = 'timeless_volver_scroll';
function posicionGuardada(){
  try{
    const v = JSON.parse(sessionStorage.getItem(VOLVER_KEY) || 'null');
    sessionStorage.removeItem(VOLVER_KEY);
    return v && Date.now() - v.t < 30 * 60 * 1000 ? v.y : null;
  }catch(e){ return null; }
}
let volverA = posicionGuardada();
document.addEventListener('click', e => {
  if(e.target.closest('.libro-link')){
    try{ sessionStorage.setItem(VOLVER_KEY, JSON.stringify({y: window.scrollY, t: Date.now()})); }catch(err){}
  }
});
function quitarCarga(){
  const c = document.getElementById('carga');
  if(!c || c.classList.contains('fuera')) return;
  // Arranca arriba (el navegador a veces la movía mientras cargaba), salvo que
  // el cliente esté volviendo de otra página nuestra: ahí vuelve a donde estaba.
  if(volverA !== null){ window.scrollTo({top: volverA, behavior: 'instant'}); volverA = null; }
  else if(!location.hash) window.scrollTo(0, 0);
  setTimeout(() => {
    c.classList.add('fuera');
    setTimeout(() => { if(c.parentNode) c.parentNode.removeChild(c); }, 600);
  }, Math.max(0, 700 - performance.now()));
}
setTimeout(quitarCarga, 4000);

function usarFilas(rows){
  const todos = filasAProductos(rows);
  aplicarEstado(todos, FILAS_ESTADO);
  PRODUCTOS = todos.filter(p => p.visible);
  POR_ID = {};
  PRODUCTOS.forEach(p => { POR_ID[p.id] = p; });
  construirEntradas();
  ajustarCarritoAStock();
  firmaOfertas = calcFirma(Date.now());
  renderTodo();
  quitarCarga();
}

// La lista de estado del dashboard es opcional: si no carga, se usa la última
// que vio este celular y, si no hay, lo que diga productos.csv.
let FILAS_ESTADO = null;
function cargarEstado(){
  if(!cfg.CSV_ESTADO) return Promise.resolve();
  return fetchCSV(cfg.CSV_ESTADO).then(rows => {
    saveCache(rows, ESTADO_KEY);
    FILAS_ESTADO = rows;
  }).catch(() => { FILAS_ESTADO = loadCache(ESTADO_KEY); });
}

// Las promos son opcionales: si no cargan, la página funciona igual sin ellas.
function cargarPromos(){
  if(!cfg.CSV_PROMOS) return Promise.resolve();
  return fetchCSV(cfg.CSV_PROMOS).then(rows => {
    saveCache(rows, PROMOS_KEY);
    PROMOS = filasAPromos(rows);
    PROMOS_LISTAS = true;
  }).catch(() => {
    const guardado = loadCache(PROMOS_KEY);
    if(guardado){ PROMOS = filasAPromos(guardado); PROMOS_LISTAS = true; }
  });
}

function cargar(){
  const estado = document.getElementById('estado');
  if(!cfg.CSV_PRODUCTOS){
    estado.textContent = 'Falta configurar CSV_PRODUCTOS en config.js.';
    return;
  }
  const promosListas = Promise.all([cargarPromos(), cargarEstado()]);
  fetchCSV(cfg.CSV_PRODUCTOS).then(rows => {
    saveCache(rows);
    return promosListas.then(() => usarFilas(rows));
  }).catch(err => {
    // Sin conexión (o Google caído): se muestra la última copia que vio este
    // celular. Puede estar desactualizada, pero al cerrar por chat Alberto
    // confirma stock y precio de todas formas.
    const guardado = loadCache();
    if(guardado){ promosListas.then(() => usarFilas(guardado)); return; }
    quitarCarga();
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
  TARJETAS.forEach((e, i) => {
    const k = norm(e.categoria);
    if(!grupos[k]) grupos[k] = {nombre: e.categoria, id: 'cat-' + slug(e.categoria), items: []};
    grupos[k].items.push({e: e, i: i});
  });
  Object.keys(grupos).forEach(k => {
    // Primero los que hay, luego próximamente, restock y agotados; entre iguales,
    // por el Orden del dashboard (el que más rápido se vende primero) y, si no
    // hay, por el orden de la hoja.
    const ord = x => (cfg.ORDEN_AUTOMATICO !== false && x.e.orden) ? x.e.orden : 999;
    grupos[k].items.sort((a, b) => (rangoEstado(a.e) - rangoEstado(b.e)) || (ord(a) - ord(b)) || (a.i - b.i));
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
  if(/cajita/i.test(e.empaque || '')) out.push('<span class="etq">Cajita premium</span>');
  return out.length ? '<div class="etqs">' + out.join('') + '</div>' : '';
}

function tarjetaHTML(e, ahora){
  const p = repVariante(e);
  const oferta = e.disponible && ofertaActiva(p, ahora);
  // Un agotado solo dice "Agotado": anunciarlo como nuevo o en oferta sería prometer algo que no hay.
  let tags = '';
  if(e.proximamente) tags = '<span class="tag tag-nuevo">Próximamente</span>';
  else if(e.restock) tags = '<span class="tag tag-restock">Restock en camino</span>';
  else if(!e.disponible) tags = '<span class="tag tag-agotado">Agotado</span>';
  else {
    if(e.nuevo) tags += '<span class="tag tag-nuevo">Nuevo</span>';
    if(oferta) tags += '<span class="tag tag-oferta">Oferta</span>';
    if(e.pocos) tags += '<span class="tag tag-pocos">' + (e.quedan ? textoQuedan(e.quedan, false) : 'Últimas unidades') + '</span>';
  }
  const apagado = !e.disponible && !e.proximamente;
  // Un grupo en una sola tarjeta lista sus colores; una tarjeta de un color avisa que hay otros.
  const grupo = ENTRADA_POR_ID[p.id];
  const opciones = e.variantes.length > 1
    ? '<div class="variantes-txt">' + esc(e.variantes.map(v => v.variante || v.nombre).join(' · ')) + '</div>'
    : (grupo && grupo.variantes.length > 1 ? '<div class="variantes-txt">También en ' + esc(grupo.variantes.filter(v => v !== p).map(v => v.variante || v.nombre).join(' · ')) + '</div>' : '');
  return '<a class="prod' + (apagado ? ' agotado' : '') + '" href="#/p/' + esc(e.id) + '">' +
    '<div class="prod-foto"><img loading="lazy" src="' + esc(fotoEntrada(e)) + '" data-fotos="' + esc(e.fotos.filter(f => !esVideo(f)).slice(0, 5).join('|')) + '" alt="' + esc(e.nombre) + '">' +
    '<div class="tags">' + tags + '</div></div>' +
    '<div class="prod-info">' + etiquetasHTML(e) + '<div class="prod-nombre">' + esc(e.nombre) + '</div>' + opciones +
    preciosHTML(p, ahora) +
    // El envío gratis se muestra también en agotados: así se sabe que vuelve con envío gratis.
    (p.envioGratis ? '<div class="envio-gratis">Envío gratis</div>' : '') +
    (e.disponible ? cuentaHTML(p, ahora) : '') +
    '</div></a>';
}

/* ---------- Sección de promociones (combos que arma el cliente) ----------
   Sale sola mientras haya combos activos en promos.csv. Cada combo tiene
   "casilleros" (Productos separados por "|") y cada casillero sus opciones
   (separadas por "/"): el cliente elige una de cada uno y agrega el combo. El
   descuento lo calcula el carrito con las mismas reglas de siempre. */
const comboSel = {};   // índice del combo en PROMOS -> ids elegidos por casillero
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'setiembre', 'octubre', 'noviembre', 'diciembre'];
// "20 de octubre" a partir de un instante (en hora de Lima).
function fechaCortaLima(ms){
  const d = new Date(ms - 5 * 3600 * 1000);
  return d.getUTCDate() + ' de ' + MESES[d.getUTCMonth()];
}
function combosActivos(ahora){
  return PROMOS.map((pr, i) => ({pr: pr, i: i})).filter(x => x.pr.tipo === 'combo' && promoActiva(x.pr, ahora));
}
// REGLA de Alberto: cuando una promo termina, la cuenta se queda en 00:00:00 unos
// minutos (ya sin precio de promo: "Promo terminada") y recién después desaparece
// TODO lo de promos: la sección, el botón "🔥 Promos disponibles" del inicio y el
// atajo "🔥 Promos" del menú.
const PROMO_GRACIA_MS = (cfg.PROMO_GRACIA_MIN == null ? 5 : cfg.PROMO_GRACIA_MIN) * 60 * 1000;
function promoVisible(pr, ahora){
  if(!pr.activa) return false;
  if(!promoYaEmpezo(pr, ahora)) return false;
  if(pr.hasta === null) return true;
  if(isNaN(pr.hasta)) return false;
  return ahora < pr.hasta + PROMO_GRACIA_MS;
}
function combosVisibles(ahora){
  return PROMOS.map((pr, i) => ({pr: pr, i: i})).filter(x => x.pr.tipo === 'combo' && promoVisible(x.pr, ahora));
}
// Productos que entran en un casillero, en el orden en que están escritos.
function opcionesCasillero(token){
  const out = [];
  String(token).split('/').forEach(alt => PRODUCTOS.forEach(p => {
    if(coincideAlcance(alt, p) && out.indexOf(p) === -1) out.push(p);
  }));
  return out;
}
// "Black" para un color; "Demon Cross" para un collar (sin "Collar" adelante).
function nombreCorto(p){
  if(p.grupo && p.variante) return p.variante;
  return p.nombre.replace(/^(cintur[oó]n|collar(es)?|pant chain|anillos?)\s+(de\s+)?/i, '');
}
const ELIGE = {cinturones: 'Elige tu cinturón', collares: 'Elige tu collar', 'pant chains': 'Elige tu pant chain', anillos: 'Elige tus anillos'};

// Foto que es solo de ese producto (en un grupo con foto de todos juntos, la
// primera de su color; si no, su primera foto).
function fotoPropia(p){
  if(!p) return FOTO_VACIA;
  const e = ENTRADA_POR_ID[p.id];
  const f = e && e.juntos ? e.fotos[p.indiceFoto] : null;
  return f && !esVideo(f) ? f : fotoDe(p);
}
// Estado de un combo: sus casilleros y lo elegido en cada uno. Al abrirlo no hay
// nada elegido (se ve la foto del combo completo); si un casillero tiene una
// sola opción (ej. la Pant Chain Skeleton), va elegida sola. Si lo elegido se
// agota, se des-elige.
function estadoCombo(x, ahora){
  // Productos de "FotoSiAgota" (en promos.csv): si se agotan se QUITAN del combo (no se
  // muestran como "Agotado") y la portada cambia a la foto alterna. Los demás
  // productos agotados se quedan visibles como "Agotado". Nunca se vacía un casillero.
  const especiales = x.pr.fotoSiAgota || [];
  let fotoAlt = '';
  const casilleros = x.pr.alcance.map(token => {
    const ops = opcionesCasillero(token);
    const quitar = ops.filter(p => !p.disponible && especiales.some(f => f.producto === norm(p.nombre)));
    if(!quitar.length || quitar.length === ops.length) return ops;
    const f = especiales.find(f => f.producto === norm(quitar[0].nombre));
    if(f && f.foto) fotoAlt = f.foto;
    return ops.filter(p => quitar.indexOf(p) === -1);
  });
  const sel = comboSel[x.i] = casilleros.map((ops, s) => {
    const previo = (comboSel[x.i] || [])[s];
    const ok = ops.find(p => p.id === previo && p.disponible);
    if(ok) return ok.id;
    return ops.length === 1 && ops[0].disponible ? ops[0].id : null;
  });
  const elegidos = sel.map(id => POR_ID[id]).filter(Boolean);
  return {casilleros: casilleros, sel: sel, completo: sel.every(Boolean), fotoAlt: fotoAlt,
          // ¿Se puede armar? Cada casillero tiene que tener al menos una opción con stock.
          disponible: casilleros.every(ops => ops.some(p => p.disponible)),
          normal: elegidos.reduce((a, p) => a + precioVigente(p, ahora), 0),
          // Envío gratis si alguna opción lo trae (el cinturón premium, en estos combos).
          gratis: casilleros.some(ops => ops.length && ops.every(p => p.envioGratis))};
}
// Tarjeta del combo en la página: la foto del combo (la del Canva), precio y "Arma tu combo".
// Lo que costarían las opciones sin promo, de la más barata a la más cara (para
// mostrar "antes S/95–100" tachado). Solo cuentan las opciones disponibles.
function rangoNormal(st, ahora){
  let min = 0, max = 0;
  st.casilleros.forEach(ops => {
    const hay = ops.filter(p => p.disponible), lista = (hay.length ? hay : ops).map(p => precioVigente(p, ahora));
    if(!lista.length) return;
    min += Math.min.apply(null, lista); max += Math.max.apply(null, lista);
  });
  return {min: min, max: max};
}
const fmtRango = (a, b) => a === b ? fmtPrecio(a) : fmtPrecio(a) + '–' + fmtPrecio(b).replace('S/', '');
function comboHTML(x, ahora){
  const st = estadoCombo(x, ahora);
  const foto = st.fotoAlt || x.pr.foto || fotoPropia((st.casilleros[0] || [])[0]);
  const rn = rangoNormal(st, ahora);
  // Ya pasó la hora de fin (los minutos en 00:00:00 antes de que desaparezca).
  if(!promoActiva(x.pr, ahora)){
    return '<div class="combo combo-agotado">' +
      '<div class="combo-foto"><img loading="lazy" src="' + esc(foto) + '" alt="' + esc(x.pr.nombre) + '">' +
        '<div class="tags"><span class="tag tag-agotado">Terminó</span></div></div>' +
      '<div class="combo-cuerpo"><div class="combo-nombre">' + esc(x.pr.nombre) + '</div>' +
        '<div class="cuenta cuenta-urgente">Termina en <b class="mono">' + fmtCuenta(0) + '</b></div>' +
        '<span class="btn" aria-disabled="true">Promo terminada</span></div></div>';
  }
  return '<a class="combo' + (st.disponible ? '' : ' combo-agotado') + '" href="#/combo/' + x.i + '">' +
    '<div class="combo-foto"><img loading="lazy" src="' + esc(foto) + '" alt="' + esc(x.pr.nombre) + '">' +
      (st.disponible ? '' : '<div class="tags"><span class="tag tag-agotado">Agotado</span></div>') + '</div>' +
    '<div class="combo-cuerpo">' +
      '<div class="combo-nombre">' + esc(x.pr.nombre) + '</div>' +
      '<div class="precios">' + (rn.max > x.pr.valor ? '<span class="precio-antes">' + fmtRango(rn.min, rn.max) + '</span>' : '') +
        '<span class="precio-oferta combo-precio">' + fmtPrecio(x.pr.valor) + '</span></div>' +
      (st.gratis ? '<div class="envio-gratis">Con envío gratis</div>' : '') +
      (x.pr.hasta ? '<div class="cuenta">Termina en <b class="mono" data-hasta="' + x.pr.hasta + '">' + fmtCuenta(x.pr.hasta - ahora) + '</b></div>' : '') +
      (st.disponible ? '<span class="btn btn-primario">Arma tu combo</span>' : '<span class="btn" aria-disabled="true">Agotado: mira los otros combos</span>') +
    '</div></a>';
}
// Todas las fotos y videos de un producto, en una tira que se desliza. Las
// fotos se ven completas (sin recortar), para que el dije se vea entero.
function tiraMediosHTML(p){
  const medios = p.fotos.length ? p.fotos : fotoEntradaLista(p);
  return '<div class="combo-tira">' + medios.map(f => esVideo(f)
    ? '<video src="' + esc(f) + '#t=0.1" controls muted playsinline preload="metadata"></video>'
    : '<img loading="lazy" src="' + esc(f) + '" alt="' + esc(p.nombre) + '">').join('') + '</div>';
}
function fotoEntradaLista(p){ const e = ENTRADA_POR_ID[p.id]; return e && e.fotos.length ? e.fotos : [FOTO_VACIA]; }

// "Arma tu combo": se abre en su propia hoja (#/combo/N).
let comboAbierto = null;
function renderCombo(){
  const ahora = Date.now();
  const body = document.getElementById('comboBody');
  const x = combosActivos(ahora).find(c => c.i === comboAbierto);
  if(!x){
    body.innerHTML = '<div class="sheet-pad"><h2>Promoción</h2><div class="estado">Esta promoción ya terminó.</div>' +
      '<button type="button" class="btn" data-cerrar>Ver el catálogo</button></div>';
    return;
  }
  const st = estadoCombo(x, ahora);
  const falta = st.casilleros.map((ops, s) => st.sel[s] ? '' : (ELIGE[norm(ops[0] ? ops[0].categoria : '')] || 'Elige uno').replace(/^Elige tu /, 'tu ')).filter(Boolean);
  body.innerHTML =
    (comboDesdeFicha ? '<button type="button" class="sheet-volver" data-volver aria-label="Volver">← ' + esc(ultimaFichaNombre) + '</button>' : '') +
    (st.fotoAlt || x.pr.foto ? '<div class="galeria"><img class="combo-portada" src="' + esc(st.fotoAlt || x.pr.foto) + '" alt="' + esc(x.pr.nombre) + '"></div>' : '') +
    '<div class="sheet-pad">' +
      '<div class="eyebrow">' + esc(cfg.PROMOS_ETIQUETA || 'Promoción') + '</div>' +
      '<h2>' + esc(x.pr.nombre) + '</h2>' +
      '<div class="ficha-precios"><div class="precios"><span class="precio-oferta">' + fmtPrecio(x.pr.valor) + '</span>' +
        (st.completo && st.normal > x.pr.valor ? '<span class="precio-antes">' + fmtPrecio(st.normal) + '</span>' : '') + '</div></div>' +
      (st.gratis ? '<div class="envio-gratis" style="margin-top:8px">🚚 Con envío gratis</div>' : '') +
      (x.pr.hasta ? '<div class="cuenta ficha-cuenta">Termina en <b class="mono" data-hasta="' + x.pr.hasta + '">' + fmtCuenta(x.pr.hasta - ahora) + '</b></div>' : '') +
      st.casilleros.map((ops, s) => {
        const elegido = POR_ID[st.sel[s]];
        const titulo = ops.length > 1 ? (ELIGE[norm(ops[0] ? ops[0].categoria : '')] || 'Elige uno') : 'Incluye';
        return '<div class="combo-paso"><div class="variantes-titulo">' + (s + 1) + '. ' + esc(titulo) + '</div>' +
          (ops.length > 1
            ? '<div class="chips">' + ops.map(p => '<button type="button" class="chip' + (p.id === st.sel[s] ? ' activo' : '') + (p.disponible ? '' : ' agotado') + '"' +
                (p.disponible ? '' : ' disabled') + ' data-casillero="' + s + '" data-op="' + esc(p.id) + '">' +
                esc(nombreCorto(p)) + (p.disponible ? (p.quedan ? ' · ' + textoQuedan(p.quedan, false) : '') : ' · Agotado') + '</button>').join('') + '</div>'
            : '') +
          (elegido
            ? '<div class="combo-elegido">' + esc(elegido.nombre) + '</div>' + tiraMediosHTML(elegido)
            : (ops.length > 1 ? '<p class="nota-chica">Toca uno para ver todas sus fotos.</p>' : '')) +
          '</div>';
      }).join('') +
      (!st.disponible
        ? '<p class="nota-chica combo-agotado-txt">Este combo se agotó. ¿Quieres otra pant chain o un collar?</p>' +
          '<button type="button" class="btn btn-primario" data-otros-combos>Ver los otros combos</button>'
        : (st.completo
          ? '<button type="button" class="btn btn-primario" data-combo-agregar="' + x.i + '">Agregar combo al carrito · ' + fmtPrecio(x.pr.valor) + '</button>'
          : '<button type="button" class="btn" disabled>Elige ' + esc(falta.join(' y ')) + '</button>')) +
      '<p class="nota-chica" style="text-align:center">Entra a tu carrito como un solo ítem, con su precio de promo. ¿Quieres algo más? Agrégalo aparte, a su precio normal.</p>' +
    '</div>';
}
document.getElementById('comboBody').addEventListener('click', e => {
  // Flecha: vuelve a la ficha desde la que se abrió el combo.
  if(e.target.closest('[data-volver]')){ history.back(); return; }
  // Combo agotado: vuelve a la sección de promos para elegir otro.
  if(e.target.closest('[data-otros-combos]')){
    cerrarHoja();
    setTimeout(() => irASeccion('promos'), 150);
    return;
  }
  const op = e.target.closest('[data-op]');
  if(op && comboAbierto !== null){
    (comboSel[comboAbierto] = comboSel[comboAbierto] || [])[Number(op.dataset.casillero)] = op.dataset.op;
    const sheet = document.querySelector('#comboOverlay .sheet');
    const top = sheet.scrollTop;
    renderCombo();
    sheet.scrollTop = top;
    return;
  }
  const add = e.target.closest('[data-combo-agregar]');
  if(add){
    const i = Number(add.dataset.comboAgregar), pr = PROMOS[i];
    const ids = comboSel[i] || [];
    if(pr && ids.length && ids.every(id => sePuedePedir(POR_ID[id])) && promoActiva(pr, Date.now())){
      // El combo entra al carrito como UN solo ítem (con su precio de promo). Si no
      // queda stock para otro igual (ej.: queda 1 y ya lo tiene), setCantidad avisa.
      const k = claveCombo(pr, ids), antes = carrito[k] || 0;
      setCantidad(k, antes + 1);
      if((carrito[k] || 0) > antes){
        contar('combo/' + i, 'Agregó combo: ' + pr.nombre);
        pixel('AddToCart', {content_ids: ids, content_name: pr.nombre, content_type: 'product', value: pr.valor, currency: 'PEN'});
        toast('Combo agregado al carrito');
        location.hash = '#/carrito';
      }
    }
  }
});
function promosSeccionHTML(ahora){
  const combos = combosVisibles(ahora);
  if(!combos.length) return '';
  // Título y subtítulo de la campaña (config.js). Vacíos = los de siempre.
  const titulo = cfg.PROMOS_TITULO || 'Promociones';
  const sub = cfg.PROMOS_SUBTITULO || 'Toca un combo, elige tus productos (con sus fotos y videos) y agrégalo: el precio de la promo se aplica solo en tu carrito.';
  return '<section class="cat" id="promos"><h2 class="cat-titulo">' + esc(titulo) + '</h2>' +
    '<p class="sub-desc">' + esc(sub) + '</p>' +
    (cfg.PROMOS_TITULO ? '<p class="sub-desc">Toca un combo, elige tus productos (con sus fotos y videos) y agrégalo al carrito.</p>' : '') +
    // Los combos que ya no se pueden armar (algo agotado) van al final.
    '<div class="combos">' + combos.map(x => ({x: x, ok: estadoCombo(x, ahora).disponible}))
      .sort((a, b) => (b.ok - a.ok) || (a.x.i - b.x.i)).map(c => comboHTML(c.x, ahora)).join('') + '</div></section>';
}
// Botón llamativo del inicio cuando hay promos.
function renderHeroPromo(ahora){
  const el = document.getElementById('heroPromo');
  if(!el) return;
  const combos = combosVisibles(ahora);
  if(!combos.length){ el.innerHTML = ''; return; }
  const fines = combos.map(x => x.pr.hasta).filter(h => h && !isNaN(h));
  // Los minutos en 00:00:00: ya no quedan promos vigentes.
  if(!combosActivos(ahora).length){
    el.innerHTML = '<a class="hero-promo" href="#promos" data-scroll="promos"><span class="hero-promo-titulo">🔥 Promos terminadas</span>' +
      '<span class="hero-promo-sub">Terminaron el ' + fechaCortaLima(Math.min.apply(null, fines)) + ' · Atento a las próximas</span></a>';
    return;
  }
  el.innerHTML = '<a class="hero-promo" href="#promos" data-scroll="promos"><span class="hero-promo-titulo">' + esc(cfg.PROMOS_HERO || '🔥 Promos disponibles') + '</span>' +
    '<span class="hero-promo-sub">' + (cfg.PROMOS_HERO_SUB ? esc(cfg.PROMOS_HERO_SUB) + ' · ' : '') + (fines.length ? 'Hasta el ' + fechaCortaLima(Math.min.apply(null, fines)) + ' · ' : '') + 'Ver promos →</span></a>';
}

/* Foto del inicio por fechas (config.js, HERO_FOTOS): cada campaña (Halloween, Cyber Wow…)
   tiene su banner en la portada SOLO entre sus fechas; fuera de ellas vuelve la foto
   de siempre (img/inicio.jpg). Si la imagen no carga, se queda la de siempre. */
const HERO_FOTO_NORMAL = 'img/inicio.jpg';
let heroFotoActual = HERO_FOTO_NORMAL, heroCargando = '';
// Cada entrada puede traer "foto" (PC) y "fotoCel" (celular); si falta una, se usa la otra.
function fotoDelInicio(ahora){
  const lista = cfg.HERO_FOTOS || [];
  const esPC = window.matchMedia ? matchMedia('(min-width:760px)').matches : true;
  for(let i = 0; i < lista.length; i++){
    const f = lista[i], d = parseFechaLima(f.desde), h = parseFechaLima(f.hasta);
    const foto = esPC ? (f.foto || f.fotoCel) : (f.fotoCel || f.foto);
    if(!foto || isNaN(d) || isNaN(h)) continue;
    // En la página de pruebas (VER_PROMOS_ANTES) se ve la primera aunque no haya llegado la fecha.
    if(cfg.VER_PROMOS_ANTES ? ahora < h : (d === null || ahora >= d) && (h === null || ahora < h)) return foto;
  }
  return HERO_FOTO_NORMAL;
}
function aplicarFotoInicio(ahora){
  const quiere = fotoDelInicio(ahora);
  if(quiere === heroFotoActual || quiere === heroCargando) return;
  const poner = ruta => {
    heroFotoActual = ruta; heroCargando = '';
    document.querySelectorAll('.hero-foto, .hero-foto-fondo').forEach(img => { img.src = ruta; });
    // Con banner de campaña la portada se acomoda para que se vea completo (ver .hero-campana).
    const hero = document.querySelector('.hero');
    if(hero) hero.classList.toggle('hero-campana', ruta !== HERO_FOTO_NORMAL);
  };
  if(quiere === HERO_FOTO_NORMAL){ poner(quiere); return; }
  heroCargando = quiere;
  const prueba = new Image();
  prueba.onload = () => poner(quiere);
  prueba.onerror = () => { heroCargando = ''; };   // no existe o no cargó: se queda la foto de siempre
  prueba.src = quiere;
}
aplicarFotoInicio(Date.now());   // ya al abrir (sin esperar a los productos), para que no parpadee la foto de siempre

function renderGrilla(){
  const ahora = Date.now();
  const main = document.getElementById('catalogo');
  const nav = document.getElementById('catsNav');
  const grupos = agrupar();
  renderHeroPromo(ahora);
  aplicarFotoInicio(ahora);
  document.body.classList.toggle('hay-promos', combosVisibles(ahora).length > 0);
  if(!grupos.length){
    nav.innerHTML = '';
    main.innerHTML = '<div class="estado">Todavía no hay productos en el catálogo.</div>';
    return;
  }
  const promosHTML = promosSeccionHTML(ahora);
  // Dónde va la sección de promos: 'primero' (arriba de Más vendidos) o
  // 'despues-de-mas-vendidos'. Se cambia en config.js.
  const promosPrimero = cfg.PROMOS_POSICION !== 'despues-de-mas-vendidos';
  // "Más vendidos": los que tienen puesto de BestSeller (1 = primero), máximo 6.
  // Un agotado sale de la fila y entra el siguiente; uno con "Restock en camino"
  // se queda en su puesto con esa etiqueta, para que la gente sepa que vuelve.
  const MAS_VENDIDOS_MAX = 6;
  const mas = TARJETAS.filter(e => e.bestSeller && (e.disponible || e.restock))
    .sort((a, b) => a.bestSeller - b.bestSeller).slice(0, MAS_VENDIDOS_MAX);
  const masHTML = mas.length
    ? '<section class="cat" id="cat-mas-vendidos"><h2 class="cat-titulo">Más vendidos</h2>' +
      '<div class="fila">' + mas.map(e => tarjetaHTML(e, ahora)).join('') + '</div></section>'
    : '';
  const navPromos = promosHTML ? '<a href="#promos" data-cat="promos" class="nav-promos">🔥 Promos</a>' : '';
  const navMas = mas.length ? '<a href="#cat-mas-vendidos" data-cat="cat-mas-vendidos">Más vendidos</a>' : '';
  nav.innerHTML = (promosPrimero ? navPromos + navMas : navMas + navPromos) +
    grupos.map(g => '<a href="#' + esc(g.id) + '" data-cat="' + esc(g.id) + '">' + esc(g.nombre) + '</a>').join('') +
    '<a href="#envios" data-cat="envios">Envíos y pagos</a><a href="#clientes" data-cat="clientes">Clientes</a><a href="#faq" data-cat="faq">Preguntas</a>';
  main.innerHTML = (promosPrimero ? promosHTML + masHTML : masHTML + promosHTML) + grupos.map(g => {
    const hayAgotados = g.items.some(e => !e.disponible);
    const verAgotados = !ocultarAgotados[g.id];
    return '<section class="cat" id="' + esc(g.id) + '">' +
      '<h2 class="cat-titulo">' + esc(g.nombre) + ' <span class="cat-cuenta">' + g.items.length + '</span></h2>' +
      // Filtro: "En stock" siempre activo (verde); "Ocultar agotados" (rojo) los esconde
      // y entonces el botón dice "Ver agotados" para volver a mostrarlos.
      (hayAgotados
        ? '<div class="filtro-stock"><span class="filtro filtro-stock-on">En stock</span>' +
          '<button type="button" class="filtro ' + (verAgotados ? 'filtro-agot-on' : 'filtro-agot-off') + '" data-agotados="' + esc(g.id) + '" aria-pressed="' + verAgotados + '">' +
          (verAgotados ? 'Ocultar agotados' : 'Ver agotados') + '</button></div>'
        : '') +
      '<div class="grilla">' + g.items.filter(e => verAgotados || e.disponible).map(e => tarjetaHTML(e, ahora)).join('') + '</div>' +
      // "¿No sabes si te queda?" solo donde hay talla: cinturones y anillos.
      (CON_TALLA.indexOf(norm(g.nombre)) > -1 ? fraseTallaHTML(null) : '') +
      '</section>';
  }).join('');
  marcarCargadas(main);
  animarTarjetas(main);
}
// Categorías con talla (ahí va el "¿No sabes si te queda?").
const CON_TALLA = ['cinturones', 'anillos'];
// Agotados ocultos por categoría (id de la sección -> true). Empieza mostrando todo.
const ocultarAgotados = {};
document.getElementById('catalogo').addEventListener('click', e => {
  const b = e.target.closest('[data-agotados]');
  if(!b) return;
  ocultarAgotados[b.dataset.agotados] = !ocultarAgotados[b.dataset.agotados];
  renderGrilla();
});

/* Animación al bajar: las tarjetas aparecen (suben y se aclaran) al llegar a
   ellas, una tras otra. Quien pidió "menos movimiento" en su celular no la ve. */
let tarjetasObservador = null;
function animarTarjetas(raiz){
  if(!('IntersectionObserver' in window) || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
  if(!tarjetasObservador){
    // Aparecen un poco ANTES de entrar a la pantalla (margen de 25% hacia abajo): en
    // iPhone, al bajar rápido, el observador avisa tarde y quedaban huecos negros.
    tarjetasObservador = new IntersectionObserver(entradas => entradas.forEach(en => {
      if(en.isIntersecting){ en.target.classList.add('visible'); tarjetasObservador.unobserve(en.target); }
    }), {rootMargin: '0px 0px 25% 0px', threshold: 0});
  }
  raiz.querySelectorAll('.grilla, .fila, .combos').forEach(cont => {
    Array.prototype.forEach.call(cont.children, (t, i) => {
      t.classList.add('aparece');
      t.style.transitionDelay = (i % 4) * 50 + 'ms';
      tarjetasObservador.observe(t);
    });
  });
  revisarTarjetas();
}
// Respaldo: si el observador se atrasa (iPhone, deslizamiento con impulso), al
// bajar se revisa a mano que ninguna tarjeta cercana quede invisible.
let revisandoTarjetas = false;
function revisarTarjetas(){
  const limite = window.innerHeight * 1.25;
  document.querySelectorAll('.aparece:not(.visible)').forEach(t => {
    const r = t.getBoundingClientRect();
    if(r.top < limite && r.bottom > -200){ t.classList.add('visible'); if(tarjetasObservador) tarjetasObservador.unobserve(t); }
  });
  // Fotos perezosas que ya están cerca: se piden ya (Safari las pide muy tarde).
  document.querySelectorAll('img[loading="lazy"]').forEach(img => {
    const r = img.getBoundingClientRect();
    if(r.top < window.innerHeight + 1200 && r.bottom > -600) img.loading = 'eager';
  });
}
window.addEventListener('scroll', () => {
  if(revisandoTarjetas) return;
  revisandoTarjetas = true;
  setTimeout(() => { revisandoTarjetas = false; revisarTarjetas(); }, 120);
}, {passive: true});
window.addEventListener('scrollend', revisarTarjetas);

// Los atajos bajan con scroll en vez de cambiar la dirección: el "#" de la
// dirección se reserva para la ficha y el carrito.
// Baja a una sección dejando su título visible debajo de la cabecera fija (antes
// la cabecera tapaba el título y se veía desde la primera foto).
// Con la ficha, el carrito o un combo abiertos, la página de atrás queda FIJA: al
// deslizar se mueve solo la ventana. (En iPhone "overflow:hidden" no basta, por eso
// se fija el body donde estaba y al cerrar se vuelve a esa misma altura.)
let fondoBloqueado = false, fondoY = 0;
function bloquearFondo(si){
  if(si === fondoBloqueado) return;
  fondoBloqueado = si;
  const b = document.body;
  if(si){
    fondoY = window.scrollY;
    b.style.top = -fondoY + 'px';
    b.classList.add('sin-scroll');
    document.documentElement.classList.add('sin-scroll');
  } else {
    b.classList.remove('sin-scroll');
    document.documentElement.classList.remove('sin-scroll');
    b.style.top = '';
    window.scrollTo({top: fondoY, behavior: 'instant'});
  }
}
function irASeccion(id){
  const sec = document.getElementById(id) || document.getElementById('catalogo');
  if(!sec) return;
  const alto = document.querySelector('.top').getBoundingClientRect().height;
  // Con una ventana abierta la página está fija: se anota a dónde ir y se va al cerrarla.
  if(fondoBloqueado){ fondoY = sec.getBoundingClientRect().top + fondoY - alto - 8; return; }
  window.scrollTo({top: sec.getBoundingClientRect().top + window.scrollY - alto - 8, behavior: 'smooth'});
}
document.addEventListener('click', e => {
  const s = e.target.closest('[data-scroll]');
  if(s){
    e.preventDefault();
    irASeccion(s.dataset.scroll);
  }
});
document.getElementById('catsNav').addEventListener('click', e => {
  const a = e.target.closest('a[data-cat]');
  if(!a) return;
  e.preventDefault();
  irASeccion(a.dataset.cat);
});
/* ---------- Fotos que van cambiando al pasar el cursor (solo en PC) ----------
   En celular no: ahí se toca la tarjeta para entrar a la ficha, y que todas las
   tarjetas roten solas gastaría datos y distrae. */
let rotaImg = null, rotaTimer = null;
function pararRotacion(){
  clearInterval(rotaTimer);
  rotaTimer = null;
  if(rotaImg){ rotaImg.src = rotaImg.dataset.fotos.split('|')[0] || rotaImg.src; rotaImg = null; }
}
if(window.matchMedia && matchMedia('(hover: hover) and (pointer: fine)').matches){
  document.addEventListener('mouseover', e => {
    const card = e.target.closest('.prod');
    const img = card ? card.querySelector('img[data-fotos]') : null;
    if(img === rotaImg) return;
    pararRotacion();
    if(!img) return;
    const fotos = img.dataset.fotos.split('|').filter(Boolean);
    if(fotos.length < 2) return;
    rotaImg = img;
    fotos.slice(1).forEach(f => { new Image().src = f; });   // las deja listas
    let i = 0;
    const siguiente = () => { i = (i + 1) % fotos.length; img.src = fotos[i]; };
    siguiente();                          // apenas entra el cursor, pasa a la 2
    rotaTimer = setInterval(siguiente, 1200);
  });
}

/* ---------- Menú de atajos: se marca solo la sección en la que estás ----------
   Al bajar por la página, el atajo de la sección visible (Promos, Más vendidos,
   Cinturones…) queda resaltado y el menú se desliza para que se vea. */
let seccionMarcada = null, marcando = false;
function marcarSeccion(){
  marcando = false;
  const nav = document.getElementById('catsNav');
  const links = Array.prototype.slice.call(nav.querySelectorAll('a[data-cat]'));
  const limite = document.querySelector('.top').getBoundingClientRect().bottom + 60;
  let actual = null;
  links.forEach(a => {
    const s = document.getElementById(a.dataset.cat);
    if(s && s.getBoundingClientRect().top <= limite) actual = a;
  });
  links.forEach(a => a.classList.toggle('activo', a === actual));
  if(actual && actual !== seccionMarcada){
    seccionMarcada = actual;
    nav.scrollTo({left: actual.offsetLeft - (nav.clientWidth - actual.offsetWidth) / 2, behavior: 'smooth'});
  }
  if(!actual) seccionMarcada = null;
}
window.addEventListener('scroll', () => {
  if(!marcando){ marcando = true; setTimeout(marcarSeccion, 80); }
}, {passive: true});

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
let fechaEntrega = '';        // "2026-10-25" (solo delivery); vacío = sin elegir
let pagoProducto = '';        // delivery: cómo paga el producto al recibir (vacío = sin elegir)
let ubicacionModo = 'whatsapp'; // 'whatsapp' (por defecto) o 'maps' (pega un link)
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

// Distrito: se puede ESCRIBIR (salen sugerencias: "San" → San Miguel, San Martín de
// Porres…) o abrir la flechita ▾ para ver todos. Un segundo toque a la flechita la cierra.
function selectDistritoHTML(id, valor){
  const d = buscarDistrito(valor);
  const texto = d ? d.n : (valor && valor !== '__otro' ? valor : '');
  return '<div class="cd" data-cd="' + id + '">' +
    '<input type="text" class="cd-input" id="' + id + '" value="' + esc(texto) + '" placeholder="Escribe o elige tu distrito" autocomplete="off" autocapitalize="words" role="combobox" aria-expanded="false">' +
    '<button type="button" class="cd-flecha" aria-label="Ver todos los distritos" tabindex="-1">▾</button>' +
    '<ul class="cd-lista" role="listbox" hidden></ul></div>';
}
function opcionesDistrito(txt){
  const lista = (cfg.DISTRITOS || []).slice().sort((a, b) => a.n.localeCompare(b.n, 'es'));
  const t = norm(txt);
  if(!t) return lista;
  const empieza = [], contiene = [];
  lista.forEach(d => {
    const nombres = [d.n].concat(d.alias || []).map(norm);
    if(nombres.some(n => n.indexOf(t) === 0 || n.split(' ').some(pal => pal.indexOf(t) === 0))) empieza.push(d);
    else if(nombres.some(n => n.indexOf(t) > -1)) contiene.push(d);
  });
  return empieza.concat(contiene);
}
function pintarListaDistrito(cd, todos){
  const inp = cd.querySelector('.cd-input'), ul = cd.querySelector('.cd-lista');
  const ops = opcionesDistrito(todos ? '' : inp.value);
  ul.innerHTML = ops.length
    ? ops.map(d => '<li role="option" class="cd-opcion" data-valor="' + esc(d.n) + '">' + esc(d.n) + '</li>').join('')
    : '<li class="cd-nada">No aparece ese distrito. Escríbenos y revisamos si llegamos.</li>';
  ul.hidden = false;
  inp.setAttribute('aria-expanded', 'true');
}
function cerrarListaDistrito(cd){
  cd.querySelector('.cd-lista').hidden = true;
  cd.querySelector('.cd-input').setAttribute('aria-expanded', 'false');
}
// Guarda el distrito elegido y actualiza el costo (en el carrito o en la sección de envíos).
function aplicarDistrito(cd, valor){
  distritoTxt = valor;
  guardarDistrito();
  cd.querySelector('.cd-input').value = valor;   // el campo muestra el nombre completo
  cerrarListaDistrito(cd);
  if(cd.dataset.cd === 'distritoHome'){
    const c = document.getElementById('cotizHome');
    if(c) c.innerHTML = cotizacionHTML(distritoTxt, false, false);
  } else repintarCarrito();
}
document.addEventListener('input', e => {
  const inp = e.target.closest('.cd-input');
  if(inp) pintarListaDistrito(inp.closest('.cd'), false);
});
// Tocar el campo solo deja escribir (ya NO selecciona todo el texto: eso movía la
// página y sacaba el menú de copiar).
// Elegir un distrito: se elige al TOCAR y soltar (click). Antes se elegía apenas el
// dedo tocaba la lista, así que al querer deslizarla para ver más distritos se
// elegía uno sin querer, la lista se cerraba y se movía la página de atrás (y el
// toque caía en lo que estaba detrás: "toco Bellavista y se selecciona lo de atrás").
let tocandoOpcion = null;
document.addEventListener('click', e => {
  const op = e.target.closest('.cd-opcion');
  if(!op) return;
  tocandoOpcion = null;
  aplicarDistrito(op.closest('.cd'), op.dataset.valor);
});
document.addEventListener('pointercancel', () => { tocandoOpcion = null; });
document.addEventListener('pointerdown', e => {
  const op = e.target.closest('.cd-opcion');
  // Se marca que el dedo está en la lista (para que al salir del campo no se aplique
  // lo escrito a medias, "Bell", antes de elegir "Bellavista").
  if(op){ tocandoOpcion = op; return; }
  tocandoOpcion = null;
  const fl = e.target.closest('.cd-flecha');
  if(fl){
    e.preventDefault();
    const cd = fl.closest('.cd'), ul = cd.querySelector('.cd-lista');
    if(ul.hidden) pintarListaDistrito(cd, true); else cerrarListaDistrito(cd);
    return;
  }
  // Tocar afuera cierra las listas abiertas.
  document.querySelectorAll('.cd-lista:not([hidden])').forEach(ul => { if(!ul.closest('.cd').contains(e.target)) cerrarListaDistrito(ul.closest('.cd')); });
});
// Al salir del campo (o Enter): si lo escrito es un distrito, se aplica; si está vacío, se borra.
document.addEventListener('change', e => {
  const inp = e.target.closest('.cd-input');
  if(!inp) return;
  const cd = inp.closest('.cd');
  if(tocandoOpcion && cd.contains(tocandoOpcion)) return;   // está eligiendo de la lista
  const d = buscarDistrito(inp.value);
  aplicarDistrito(cd, d ? d.n : inp.value.trim());
});
document.addEventListener('keydown', e => {
  const inp = e.target.closest && e.target.closest('.cd-input');
  if(!inp) return;
  const cd = inp.closest('.cd');
  if(e.key === 'Escape'){ cerrarListaDistrito(cd); return; }
  if(e.key === 'Enter'){
    const primera = cd.querySelector('.cd-opcion');
    if(!cd.querySelector('.cd-lista').hidden && primera && !buscarDistrito(inp.value)){ e.preventDefault(); aplicarDistrito(cd, primera.dataset.valor); }
  }
});

// Recuadro con el costo aproximado del delivery a un distrito. Se usa en la
// sección "Envíos y pagos" y en el carrito (ahí con el botón "Cambiar a Shalom").
// Lo de "el envío gratis cubre hasta S/16" SOLO aparece si el distrito puede
// costar más que eso (pedido de Alberto: no anunciarlo en ninguna otra parte).
function cotizacionHTML(txt, gratis, enCarrito){
  if(!txt) return '';
  const d = buscarDistrito(txt);
  if(!d) return '<div class="cotiz cotiz-no">¿No aparece tu distrito? Escríbenos y revisamos si llegamos, o elige Shalom (' +
    fmtPrecio(costoShalom()) + ' a todo el Perú).</div>';
  const r = rangoDistrito(d);
  let h = '<div class="cotiz"><div class="cotiz-fila"><span>Delivery a ' + esc(d.n) + '</span><b>' +
    (gratis && r.max <= cubreGratis() ? '<s class="tachado">' + textoRango(r) + '</s> Gratis' : textoRango(r)) + '</b></div>';
  if(r.max === r.min && !gratis) h += '<div class="cotiz-nota">Tarifa fija.</div>';
  if(d.nota) h += '<div class="cotiz-nota">' + esc(d.nota) + '</div>';
  h += '<div class="cotiz-nota">' + (d.h48 ? 'Llega en 48 horas.' : 'Llega de un día para otro.') + ' Sujeto a cobertura: lo confirmamos por chat.</div>';
  if(gratis && r.max > cubreGratis()) h += '<div class="cotiz-nota cotiz-aviso"><b class="excl">!</b> A tu zona el envío gratis cubre hasta ' + fmtPrecio(cubreGratis()) +
    ': pagas solo la diferencia. Por Shalom es 100% gratis.</div>';
  if(d.cerca) h += cercaHTML('moto', enCarrito);
  else if(d.indrive) h += indriveHTML(enCarrito);
  if(r.max > RECOMENDAR_SHALOM_DESDE){
    h += '<div class="recomendado"><b>Opción recomendada: Shalom, ' + (gratis ? 'gratis' : fmtPrecio(costoShalom())) + '</b>' +
      '<span>Sale más barato a tu distrito. Pagas el producto antes, el envío al recibir, y lo recoges cuando puedas en tu agencia.</span>' +
      (enCarrito ? '<button type="button" class="btn-link" data-envio="shalom">Cambiar a Shalom</button>' : '') + '</div>';
  }
  return h + '</div>';
}

// Distritos donde conviene InDrive pero no tanto el recojo (Cercado de Lima).
function indriveHTML(enCarrito){
  return '<div class="recomendado"><b>Recomendado: envío por InDrive</b>' +
    '<span>A tu distrito suele salir rápido y a buen precio: te lo cotizamos por chat antes de pagar. Si prefieres pagar al recibir, el delivery de 11am a 7pm sigue disponible.</span>' +
    (enCarrito ? '<span class="recomendado-btns"><button type="button" class="btn-link" data-envio="indrive">Cambiar a InDrive</button></span>' : '') + '</div>';
}
// Distritos cerca de San Miguel (San Miguel, Magdalena, Pueblo Libre, Callao,
// Bellavista, San Martín de Porres): se
// sugiere el recojo sin costo en Plaza San Miguel o InDrive (casi siempre sale menos
// de S/10). Es solo una sugerencia: el delivery contraentrega sigue disponible.
function cercaHTML(desde, enCarrito){
  const btn = (id, txt) => enCarrito ? '<button type="button" class="btn-link" data-envio="' + id + '">' + txt + '</button>' : '';
  return '<div class="recomendado"><b>Te queda cerca de nosotros</b>' +
    '<span>Puedes recogerlo <b>sin costo en Plaza San Miguel</b>' + (desde === 'moto' ? ', o pedirlo por <b>InDrive</b>, que casi siempre sale menos de S/10' : '') + '.' +
    (desde === 'moto' ? ' Si prefieres pagar al recibir, el delivery de 11am a 7pm sigue disponible.' : '') + '</span>' +
    '<span class="recomendado-btns">' + btn('recojo', 'Cambiar a recojo sin costo') + (desde === 'moto' ? btn('indrive', 'Cambiar a InDrive') : '') + '</span></div>';
}

// Costo del envío elegido: {texto, costo, tachado}. costo = null cuando no hay
// un número fijo (depende de la zona o se cotiza por chat); "tachado" es el
// precio normal que se muestra tachado cuando el pedido va con envío gratis.
function envioEstimado(id, gratis){
  const cubre = cubreGratis();
  if(id === 'recojo') return {texto: 'Sin costo', costo: 0};
  if(id === 'shalom') return gratis ? {texto: 'Gratis', costo: 0, tachado: fmtPrecio(costoShalom())} : {texto: fmtPrecio(costoShalom()) + ' al recibir', costo: costoShalom()};
  // InDrive: siempre se cotiza (el envío gratis aplica al delivery y a Shalom).
  if(id === 'indrive') return {texto: 'Se cotiza por chat', costo: null};
  if(id === 'moto'){
    const d = buscarDistrito(distritoTxt);
    const desde = 'desde ' + fmtPrecio(cfg.ENVIO_MINIMO_MOTO || 10);
    if(!d) return gratis ? {texto: 'Gratis', costo: null, tachado: desde} : {texto: desde, costo: null};
    const r = rangoDistrito(d);
    if(!gratis) return {texto: textoRango(r), costo: r.max === r.min ? r.min : null};
    const a = Math.max(0, r.min - cubre), b = Math.max(0, r.max - cubre);
    if(b === 0) return {texto: 'Gratis', costo: 0, tachado: textoRango(r)};
    return a === b ? {texto: 'Pagas ' + fmtPrecio(a) + ' de diferencia', costo: a}
                   : {texto: 'Gratis o hasta ' + fmtPrecio(b) + ' de diferencia', costo: null};
  }
  return {texto: '', costo: null};
}

/* ---------- Fecha de entrega del delivery (lun–sáb, máx. 1 semana) ---------- */
function fechaISO(d){ return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
// Días que se pueden elegir para el delivery: de mañana a 7 días, sin domingos. No se
// marca ninguno solo (el cliente toca el que quiera y puede tocarlo de nuevo para quitarlo).
const DIAS_TXT = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
function fechasEntrega(){
  const out = [];
  for(let k = 1; k <= 7; k++){
    const d = new Date(); d.setDate(d.getDate() + k);
    if(d.getDay() === 0) continue;
    out.push({iso: fechaISO(d), txt: (k === 1 ? 'Mañana ' : '') + DIAS_TXT[d.getDay()] + ' ' + d.getDate()});
  }
  return out;
}
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

// "¿No sabes si te queda? Escríbenos por DM…": "Escríbenos por DM" es un botón
// que deja elegir WhatsApp (con el mensaje ya escrito) o Instagram (se copia y
// se abre el chat). Con producto, el mensaje lo nombra.
function fraseTallaHTML(producto){
  return '<div class="frase-talla">¿No sabes si te queda? <button type="button" class="dm-link" data-dm="' + esc(producto || '') + '">Escríbenos por DM</button> y te ayudamos a elegir tu talla' +
    '<div class="dm-menu" hidden></div></div>';
}
function textoDM(producto){
  return producto ? '¡Hola Timeless! Quiero saber cómo me queda: ' + producto : '¡Hola Timeless! Quiero saber qué talla me queda';
}
document.addEventListener('click', e => {
  const b = e.target.closest('.dm-link');
  if(b){
    const menu = b.parentNode.querySelector('.dm-menu');
    menu.innerHTML = '<a class="btn btn-wa" target="_blank" rel="noopener" href="' + esc(urlWhatsApp(textoDM(b.dataset.dm))) + '">WhatsApp</a>' +
      '<button type="button" class="btn btn-ig" data-dm-ig="' + esc(b.dataset.dm) + '">Instagram</button>';
    menu.hidden = !menu.hidden;
    return;
  }
  const ig = e.target.closest('[data-dm-ig]');
  if(ig){
    // Se copia y se abre el chat en el mismo toque (si se abre después, el
    // navegador lo bloquea como ventana emergente).
    copiar(textoDM(ig.dataset.dmIg)).then(ok => toast(ok ? 'Mensaje copiado: pégalo en el chat' : 'Escríbenos el nombre del producto en el chat'));
    window.open(urlInstagramChat(), '_blank', 'noopener');
  }
});

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
// Textos de "cuántas quedan" (solo cuando el dashboard avisa 1, 2 o 3).
function textoQuedan(n, conAdmiracion){
  const t = n === 1 ? 'Queda 1' : 'Quedan ' + n;
  return conAdmiracion ? '¡' + t + '!' : t;
}
/* ---------- Combos como UN solo ítem del carrito ----------
   Un combo se guarda en el carrito con la clave 'combo|<nombre de la promo>|<id1>|<id2>…'
   y su cantidad. Así el pedido dice "Spider + collar Starboy (White Spider + Starboy) —
   S/89" y los productos de adentro cuentan para el stock ("Queda 1"). Si la promo
   vence, se convierte solo en sus productos sueltos a precio normal. */
const COMBO_PREFIJO = 'combo|';
const esClaveCombo = k => String(k).indexOf(COMBO_PREFIJO) === 0;
const claveCombo = (pr, ids) => COMBO_PREFIJO + pr.nombre + '|' + ids.join('|');
function leerCombo(k){
  const partes = String(k).split('|');
  const ids = partes.slice(2);
  return {pr: PROMOS.find(p => p.nombre === partes[1]) || null, ids: ids, ps: ids.map(id => POR_ID[id])};
}
// Cuántas unidades de un producto hay en el carrito, sueltas y dentro de combos.
function unidadesDe(id){
  let n = carrito[id] || 0;
  Object.keys(carrito).forEach(k => {
    if(esClaveCombo(k)) n += leerCombo(k).ids.filter(x => x === id).length * carrito[k];
  });
  return n;
}
// Lo máximo que se puede llevar EN TOTAL de un producto: 10, o lo que queda si quedan 3 o menos.
function maxDe(id){
  const p = POR_ID[id];
  return p && p.quedan ? Math.min(CANT_MAX, p.quedan) : CANT_MAX;
}
// Lo máximo que puede valer esa línea del carrito (producto suelto o combo), contando
// lo que ya está en otras líneas.
function topeLinea(k){
  if(esClaveCombo(k)){
    const ids = leerCombo(k).ids, cuenta = {};
    ids.forEach(id => { cuenta[id] = (cuenta[id] || 0) + 1; });
    let tope = CANT_MAX;
    Object.keys(cuenta).forEach(id => {
      if(!POR_ID[id]) return;
      const otros = unidadesDe(id) - cuenta[id] * (carrito[k] || 0);
      tope = Math.min(tope, Math.floor((maxDe(id) - otros) / cuenta[id]));
    });
    return Math.max(0, tope);
  }
  const enCombos = unidadesDe(k) - (carrito[k] || 0);
  return Math.max(0, maxDe(k) - enCombos);
}
function setCantidad(k, n){
  const tope = topeLinea(k);
  if(n > tope && tope < CANT_MAX){
    toast(esClaveCombo(k)
      ? (tope === 0 ? 'Ya no quedan unidades para otro combo igual' : 'Solo quedan ' + tope + ' de este combo')
      : (tope === 0 ? 'Ya no queda más de este producto' : tope === 1 ? 'Solo queda 1 de este producto' : 'Solo quedan ' + tope + ' de este producto'));
  }
  n = Math.max(0, Math.min(tope, n));
  if(n === 0) delete carrito[k]; else carrito[k] = n;
  guardarCarrito();
  renderContador();
}
// Si el stock bajó mientras el carrito estaba guardado, se baja a lo que queda.
function ajustarCarritoAStock(){
  let cambio = false;
  Object.keys(carrito).forEach(k => {
    if(esClaveCombo(k)){
      const c = leerCombo(k);
      if(!c.ps.every(Boolean)) return;
    } else if(!POR_ID[k]) return;
    const tope = topeLinea(k);
    if(carrito[k] > tope){ if(tope > 0) carrito[k] = tope; else delete carrito[k]; cambio = true; }
  });
  if(cambio){ guardarCarrito(); renderContador(); }
}
// Cuando una promo vence (o se borra o se apaga), el combo del carrito se convierte
// en sus productos sueltos: vuelven solos a su precio normal.
let PROMOS_LISTAS = false;   // ¿ya se leyó promos.csv? (si no, no se toca nada)
function deshacerCombosVencidos(ahora){
  if(!PROMOS_LISTAS || !PRODUCTOS.length) return;
  let cambio = false;
  Object.keys(carrito).forEach(k => {
    if(!esClaveCombo(k)) return;
    const c = leerCombo(k);
    if(c.pr && promoActiva(c.pr, ahora)) return;
    c.ids.forEach(id => { carrito[id] = (carrito[id] || 0) + carrito[k]; });
    delete carrito[k];
    cambio = true;
  });
  if(cambio){ guardarCarrito(); ajustarCarritoAStock(); }
}
function agregar(id){
  // Doble candado: el botón ya sale deshabilitado, pero un agotado tampoco
  // entra al carrito por ningún otro camino.
  if(!sePuedePedir(POR_ID[id])) return false;
  if((carrito[id] || 0) >= topeLinea(id)){ setCantidad(id, (carrito[id] || 0) + 1); return false; }
  setCantidad(id, (carrito[id] || 0) + 1);
  contar('carrito/' + id, 'Agregó al carrito: ' + POR_ID[id].nombre);
  pixel('AddToCart', {content_ids: [id], content_name: POR_ID[id].nombre, content_type: 'product', value: precioVigente(POR_ID[id], Date.now()), currency: 'PEN'});
  return true;
}
// Líneas que sí van en el pedido: producto que existe y está disponible, o combo
// vigente cuyos productos están todos disponibles. Un combo es UNA línea con el
// precio de la promo (l.combo = la promo, l.ps = sus productos, l.normal = lo que
// costaría sin promo).
function lineasValidas(ahora){
  deshacerCombosVencidos(ahora);
  return Object.keys(carrito).filter(k => {
    if(!esClaveCombo(k)) return sePuedePedir(POR_ID[k]);
    const c = leerCombo(k);
    return !!c.pr && c.ps.every(sePuedePedir);
  }).map(k => {
    if(esClaveCombo(k)){
      const c = leerCombo(k), cant = carrito[k], unit = c.pr.valor;
      return {combo: c.pr, ps: c.ps, key: k, p: c.ps[0], cant: cant, unit: unit, sub: unit * cant,
              normal: c.ps.reduce((a, p) => a + precioVigente(p, ahora), 0), oferta: false};
    }
    const p = POR_ID[k], cant = carrito[k], unit = precioVigente(p, ahora);
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
function pedidoConEnvioGratis(lineas){ return lineas.some(l => (l.combo ? l.ps : [l.p]).some(p => p.envioGratis)); }

// Todo lo que muestra el carrito y lleva el mensaje: productos, promos y envío.
function calcularPedido(ahora){
  const lineas = lineasValidas(ahora);
  const subtotal = centavos(lineas.reduce((a, l) => a + l.sub, 0));
  // Los combos ya traen su precio de promo: no entran a las demás promos.
  const pr = aplicarPromos(lineas.filter(l => !l.combo), ahora);
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
    ped.lineas.map(l => l.combo
      // Combo: nombre de la promo, lo que eligió y el precio de la promo.
      ? '• ' + l.cant + ' × ' + l.combo.nombre + ' (' + l.ps.map(p => p.nombre).join(' + ') + ') — ' + fmtPrecio(l.unit) +
        ' precio promo' + (l.cant > 1 ? ' c/u' : '') + (l.normal > l.unit ? ' (antes ' + fmtPrecio(l.normal) + ')' : '')
      : '• ' + l.cant + ' × ' + l.p.nombre + ' — ' + fmtPrecio(l.unit) +
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
    if(id === 'moto' || id === 'indrive'){ const d = buscarDistrito(distritoTxt); lugar = d ? ' a ' + d.n : (distritoTxt ? ' a ' + distritoTxt : ''); }
    t += '\nEnvío: ' + ped.envio.nombre + lugar + ' (' + (ped.gratis && ped.est.texto !== 'Gratis' ? 'envío gratis · ' : '') + ped.est.texto + ')';
    if(ped.costoEnvio > 0) t += '\nTotal aprox.: ' + fmtPrecio(ped.productos + ped.costoEnvio);
    if(id === 'moto'){
      if(fechaEntrega) t += '\nDía de entrega: ' + fechaBonita(fechaEntrega);
      if(pagoProducto) t += '\nEl producto lo pago al recibir con: ' + pagoProducto;
    }
    if(id === 'indrive') t += '\nQuiero que me cotices el envío por InDrive.';
    if(id === 'shalom') t +='\nYapeo ' + fmtPrecio(ped.productos) + ' (productos) al ' + (y.numero || '') + ' y te envío la captura.';
    // La ubicación va por WhatsApp (por defecto) o como link de Google Maps.
    const conMapa = (id === 'moto' || id === 'indrive');
    const campos = (CAMPOS_DATOS[id] || []).filter(c => !(c[0] === 'maps' && ubicacionModo === 'whatsapp') && String(datos[c[0]] || '').trim());
    if(conMapa && ubicacionModo === 'whatsapp') t += '\nMi ubicación: te la mando por WhatsApp (ubicación actual).';
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
  const estado = p.proximamente ? 'Próximamente' : (p.restock ? 'Restock en camino' : 'Agotado');
  return '<button type="button" class="btn" disabled>' + estado + '</button>' +
    '<p class="aviso-titulo">' + (p.proximamente || p.restock ? '¿Quieres que te avisemos cuando llegue?' : '¿Quieres que te avisemos cuando vuelva?') + '</p>' +
    '<a class="btn btn-wa" href="' + esc(urlWhatsApp(textoAviso(p))) + '" target="_blank" rel="noopener" data-contar="avisame/' + esc(p.id) + '">Avísame por WhatsApp</a>' +
    (avisoCopiado === p.id
      ? '<div class="copiado" style="margin-top:14px">✓ Mensaje copiado. Pégalo en el chat que se abre.</div>' +
        '<a class="btn" href="' + esc(urlInstagramChat()) + '" target="_blank" rel="noopener">Abrir chat de Instagram</a>'
      : '<button type="button" class="btn" data-aviso-ig="' + esc(p.id) + '" data-contar="avisame/' + esc(p.id) + '">Avísame por Instagram</button>' +
        '<p class="nota-chica aviso-ig">Ojo: si cambias tu usuario de Instagram o desactivas tu cuenta, no podremos avisarte. Por WhatsApp es más seguro.</p>');
}

/* ---------- Ficha de producto ---------- */
let fichaEntradaId = null;   // qué ficha está abierta
let fichaVarId = null;       // y qué variante (color) tiene elegida
let avisoLento = false;      // ¿ya se avisó que la conexión está lenta?
let ultimaFichaNombre = '';   // para el botón "← volver" del combo
let comboDesdeFicha = false;  // ¿se abrió el combo desde la ficha de un producto?
let hashActual = location.hash, hashPrevio = '';

// Posición actual de la galería (0 = primera foto), para no perderla al repintar.
function indiceGaleria(){
  const pista = document.getElementById('galPista');
  return pista && pista.clientWidth ? Math.round(pista.scrollLeft / pista.clientWidth) : 0;
}

// Cinturón: la gente cree que cada talla de pantalón es un cinturón distinto. Se explica
// que es UN solo cinturón para varias tallas. Lee "28–40 aprox. (79–102cm de cintura)";
// si el texto no tiene esa forma, se muestra tal cual.
function tallasCinturonHTML(t){
  const m = String(t || '').match(/^\s*(\d+)\s*[–-]\s*(\d+)\s*(?:aprox\.?)?\s*(?:\(\s*(\d+)\s*[–-]\s*(\d+)\s*cm[^)]*\))?/i);
  if(!m) return esc(t);
  return '<b>Sirve para las tallas ' + m[1] + ' a ' + m[2] + '</b> <span class="aprox">(aprox.)</span>' +
    '<span class="nota-316">Es UN solo cinturón para todas esas tallas: no tienes que elegir talla.' +
    (m[3] ? ' Cintura de ' + m[3] + ' a ' + m[4] + ' cm.' : '') + '</span>';
}
function renderFicha(indice){
  const e = ENTRADA_POR_ID[fichaEntradaId];
  const p = POR_ID[fichaVarId];
  const ahora = Date.now();
  // Grupo con foto de todos juntos: todas las fotos. Si no, solo las del color elegido.
  const fotos = e.juntos ? e.fotos : (p.fotos.length ? p.fotos : e.fotos);
  const medios = fotos.length ? fotos : [FOTO_VACIA];
  const titulo = e.juntos ? e.nombre : p.nombre;
  ultimaFichaNombre = titulo;
  const varias = medios.length > 1;
  const dato = (titulo, valor) => valor ? '<div class="dato"><dt>' + titulo + '</dt><dd>' + esc(valor) + '</dd></div>' : '';
  const enCarrito = carrito[p.id] || 0;
  const promos = e.disponible ? promosDe(p, ahora) : [];
  const linea = lineaDe(e);
  const esCinturon = norm(p.categoria) === 'cinturones';
  const guia = (cfg.GUIA_TALLA || []).map(t => '<p>' + esc(t) + '</p>').join('');
  document.getElementById('fichaBody').innerHTML =
    '<div class="galeria"><div class="galeria-pista" id="galPista">' +
      // Cada foto en su caja (con "Cargando…" hasta que esté completa) y cada video
      // con el fondo borroso de su propio cuadro (archivo "-fondo.jpg" al lado del video).
      medios.map((f, i) => esVideo(f)
        ? '<div class="vid-caja" style="background-image:url(&quot;' + esc(f.replace(/\.(mp4|webm|mov|m4v)$/i, '-fondo.jpg')) + '&quot;)">' +
          '<video src="' + esc(f) + '#t=0.1" muted playsinline loop preload="metadata" aria-label="Video de ' + esc(e.nombre) + '"></video></div>'
        : '<div class="foto-caja"><img src="' + esc(f) + '" alt="' + esc(e.nombre) + ' — foto ' + (i + 1) + '" draggable="false"></div>').join('') +
    '</div>' +
    (varias ? '<button type="button" class="galeria-nav galeria-prev" data-gal="-1" aria-label="Foto anterior">‹</button>' +
              '<button type="button" class="galeria-nav galeria-next" data-gal="1" aria-label="Foto siguiente">›</button>' +
              '<div class="galeria-cuenta mono" id="galCuenta">1/' + medios.length + '</div>' : '') +
    '<button type="button" class="zoom-btn" id="zoomBtn" aria-label="Acercar la foto">+</button>' +
    '</div>' +
    '<div class="sheet-pad">' +
      '<div class="eyebrow">' + esc(e.categoria) + (e.nuevo && e.disponible ? ' · Nuevo' : '') + '</div>' +
      '<h2>' + esc(titulo) + '</h2>' +
      etiquetasHTML(e) +
      (linea && linea.descripcion ? '<p class="linea-desc"><b>' + esc(linea.titulo) + ':</b> ' + esc(linea.descripcion) + '</p>' : '') +
      (e.variantes.length > 1
        ? '<div class="variantes"><div class="variantes-titulo">Color</div><div class="chips">' +
          e.variantes.map(v => '<button type="button" class="chip' + (v.id === p.id ? ' activo' : '') + (v.disponible ? '' : ' agotado') +
            '" data-variante="' + esc(v.id) + '">' + esc(v.variante || v.nombre) +
            (v.disponible ? '' : (v.proximamente ? ' · Próximamente' : (v.restock ? ' · En camino' : ' · Agotado'))) + '</button>').join('') +
          '</div></div>'
        : '') +
      '<div class="ficha-precios">' + preciosHTML(p, ahora) + '</div>' +
      // Restock en camino: botón amarillo que baja al "Avísame".
      (p.restock ? '<button type="button" class="btn btn-restock" data-ir-aviso>Restock en camino · Te avisamos apenas llegue</button>' : '') +
      (p.disponible && p.pocos ? '<div class="pocos">' + (p.quedan ? textoQuedan(p.quedan, true) : 'Últimas unidades') + '</div>' : '') +
      (p.disponible ? cuentaHTML(p, ahora, 'ficha-cuenta') : '') +
      (p.envioGratis ? '<div class="envio-gratis" style="margin-top:8px">🚚 Envío gratis llevando este producto</div>' : '') +
      // La palabra "Combo" es un enlace a la hoja del combo (con flecha para volver aquí).
      (promos.length ? '<div class="promo-caja">' + promos.map(x => '<div>🏷 ' + (x.combo && /^Combo:/i.test(x.texto)
        ? '<a class="combo-link" href="#/combo/' + x.i + '">Combo</a>:' + esc(x.texto.replace(/^Combo:/i, ''))
        : esc(x.texto)) + '</div>').join('') + '</div>' : '') +
      '<dl class="datos">' +
        dato('Descripción y medidas', p.descripcion) +
        // En cinturones la talla es la del pantalón (así está en el Canva), con
        // una "?" que explica cómo medirse; en el resto, "Tallas" a secas.
        (esCinturon && p.tallas
          ? '<div class="dato"><dt>Tallas de pantalón ' + infoHTML('¿Cómo saber tu talla?', '<b>¿Cómo saber tu talla?</b>' + guia) + '</dt><dd>' + tallasCinturonHTML(p.tallas) + '</dd></div>'
          : dato('Tallas', p.tallas)) +
        (p.material
          ? '<div class="dato"><dt>Material</dt><dd>' + esc(p.material) +
            // El 316L se explica: es lo que justifica su precio.
            (/316l/i.test(p.material) ? '<span class="nota-316">El acero inoxidable más resistente.</span>' : '') +
            '</dd></div>'
          : '') +
        dato('Empaque', p.empaque) +
        dato('Nota', p.nota) +
        dato('Cuidado', p.cuidado) +
      '</dl>' +
      (esCinturon && guia ? '<div class="guia-talla"><div class="guia-titulo">¿Cómo saber tu talla?</div>' + guia + '</div>' : '') +
      (p.disponible
        // Ya en el carrito: el botón se vuelve "− cantidad +" (sin mover la ficha).
        ? (enCarrito
          ? '<div class="cant-ficha"><button type="button" data-ficha-cant="-1" aria-label="Quitar uno">−</button>' +
            '<span><b>' + enCarrito + '</b> en tu carrito</span>' +
            '<button type="button" data-ficha-cant="1" aria-label="Agregar uno"' + (enCarrito >= topeLinea(p.id) ? ' disabled' : '') + '>+</button></div>' +
            '<div class="en-carrito">' + (enCarrito > 1 ? 'Más de 1 unidad: sujeto a disponibilidad. ' : '') + '<a href="#/carrito">Ver carrito</a></div>'
          : '<button type="button" class="btn btn-primario" data-agregar="' + esc(p.id) + '">Agregar al carrito</button>')
        : '<div id="avisoFicha">' + avisoHTML(p) + '</div>') +
      (CON_TALLA.indexOf(norm(p.categoria)) > -1 ? fraseTallaHTML(titulo) : '') +
    '</div>';
  const pista = document.getElementById('galPista');
  if(varias){
    pista.addEventListener('scroll', () => {
      const i = Math.round(pista.scrollLeft / pista.clientWidth) + 1;
      document.getElementById('galCuenta').textContent = i + '/' + medios.length;
    }, {passive:true});
  }
  // Grupo con fotos de todos juntos (Black/White Spider): el color elegido sigue a la
  // foto que se está viendo, para que nadie pida un color distinto al que miraba.
  if(varias && e.juntos && e.variantes.length > 1){
    let finDeslizar = null;
    pista.addEventListener('scroll', () => {
      clearTimeout(finDeslizar);
      finDeslizar = setTimeout(() => {
        if(!pista.clientWidth || !pista.isConnected || ENTRADA_POR_ID[fichaEntradaId] !== e) return;
        const f = medios[Math.round(pista.scrollLeft / pista.clientWidth)];
        // Solo si la foto es de UN color (la portada compartida no cambia nada).
        const duenas = e.variantes.filter(v => v.fotos.indexOf(f) > -1);
        if(duenas.length !== 1 || duenas[0].id === fichaVarId) return;
        const i = Math.round(pista.scrollLeft / pista.clientWidth);
        fichaVarId = duenas[0].id;
        const sheet = document.querySelector('#fichaOverlay .sheet');
        const top = sheet ? sheet.scrollTop : 0;
        renderFicha(i);
        if(sheet) sheet.scrollTop = top;
      }, 180);
    }, {passive:true});
  }
  if(indice > 0){
    pista.scrollLeft = pista.clientWidth * indice;
    if(varias) document.getElementById('galCuenta').textContent = (indice + 1) + '/' + medios.length;
  }
  prepararGaleria(pista);
}

/* ---------- Galería de la ficha: carga, videos y zoom ---------- */
// Cada foto muestra "Cargando foto…" hasta que está completa; si a los 5 s no
// terminó, avisa que es la conexión; si falla, lo intenta una vez más y, si
// vuelve a fallar, lo dice (así no parece un error de la página).
function marcarCargadas(raiz){
  (raiz || document).querySelectorAll('.foto-caja img, .prod-foto img').forEach(img => {
    if(img.complete && img.naturalWidth) img.parentNode.classList.add('cargada');
  });
}
document.addEventListener('load', e => {
  const img = e.target;
  if(img.tagName !== 'IMG' || !img.parentNode || !img.parentNode.classList) return;
  const caja = img.parentNode;
  if(caja.classList.contains('foto-caja') || caja.classList.contains('prod-foto')){
    caja.classList.remove('lenta', 'fallo');
    caja.classList.add('cargada');
  }
}, true);

let videoObservador = null;
function prepararGaleria(pista){
  marcarCargadas(pista);
  setTimeout(() => pista.querySelectorAll('.foto-caja:not(.cargada)').forEach(c => c.classList.add('lenta')), 5000);

  // Videos: se reproducen solos al llegar a ellos y se pausan al salir.
  if(videoObservador) videoObservador.disconnect();
  if('IntersectionObserver' in window){
    videoObservador = new IntersectionObserver(entradas => entradas.forEach(en => {
      const v = en.target;
      if(en.isIntersecting && en.intersectionRatio > 0.6){ const p = v.play(); if(p && p.catch) p.catch(() => {}); }
      else v.pause();
    }), {root: pista, threshold: [0, 0.6, 1]});
    pista.querySelectorAll('video').forEach(v => videoObservador.observe(v));
  }
  pista.querySelectorAll('video').forEach(v => {
    // En pausa aparece la barra para moverse por el video; al reproducir, se esconde.
    v.addEventListener('pause', () => { v.controls = true; });
    v.addEventListener('play', () => { v.controls = false; });
    v.addEventListener('click', () => { if(!v.paused && !v.controls){ v.pause(); } });
  });

  zoomReiniciar();
  actualizarBotonZoom();
  pista.addEventListener('scroll', () => {
    if(zoom.escala > 1) return;
    actualizarBotonZoom();
  }, {passive: true});
}

/* Zoom: solo en las fotos de la ficha. Pellizco con dos dedos (hasta 5x) o el
   botón + (2x; otro toque vuelve al tamaño normal). Con zoom, la foto se mueve
   con el dedo (o arrastrando con el mouse) y la galería deja de deslizarse. */
const ZOOM_MAX = 5, ZOOM_BOTON = 2;
const zoom = {escala: 1, x: 0, y: 0, caja: null, pellizco: null, arrastre: null};
function cajaActual(){
  const pista = document.getElementById('galPista');
  if(!pista) return null;
  const i = Math.round(pista.scrollLeft / (pista.clientWidth || 1));
  return pista.children[i] || null;
}
function actualizarBotonZoom(){
  const b = document.getElementById('zoomBtn');
  if(!b) return;
  const c = cajaActual();
  b.hidden = !(c && c.classList.contains('foto-caja'));
  b.textContent = zoom.escala > 1 ? '−' : '+';
  b.setAttribute('aria-label', zoom.escala > 1 ? 'Volver al tamaño normal' : 'Acercar la foto');
}
function limitarZoom(){
  if(!zoom.caja) return;
  const w = zoom.caja.clientWidth, h = zoom.caja.clientHeight;
  const mx = (zoom.escala - 1) * w / 2, my = (zoom.escala - 1) * h / 2;
  zoom.x = Math.max(-mx, Math.min(mx, zoom.x));
  zoom.y = Math.max(-my, Math.min(my, zoom.y));
}
function pintarZoom(){
  if(!zoom.caja) return;
  limitarZoom();
  const img = zoom.caja.querySelector('img');
  img.style.transform = zoom.escala > 1 ? 'translate(' + zoom.x + 'px,' + zoom.y + 'px) scale(' + zoom.escala + ')' : '';
  zoom.caja.classList.toggle('con-zoom', zoom.escala > 1);
  const pista = document.getElementById('galPista');
  if(pista) pista.classList.toggle('zoom-activo', zoom.escala > 1);
  actualizarBotonZoom();
}
function zoomReiniciar(){
  if(zoom.caja){
    const img = zoom.caja.querySelector('img');
    if(img) img.style.transform = '';
    zoom.caja.classList.remove('con-zoom');
  }
  const pista = document.getElementById('galPista');
  if(pista) pista.classList.remove('zoom-activo');
  zoom.escala = 1; zoom.x = 0; zoom.y = 0; zoom.caja = null; zoom.pellizco = null; zoom.arrastre = null;
}
const distancia = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
// Celular: pellizco y arrastre con los dedos (eventos táctiles, para poder frenar el
// deslizamiento de la galería mientras hay zoom).
document.getElementById('fichaBody').addEventListener('touchstart', e => {
  const caja = e.target.closest && e.target.closest('.foto-caja');
  if(!caja) return;
  if(e.touches.length === 2){
    if(zoom.caja !== caja){ zoomReiniciar(); zoom.caja = caja; }
    zoom.pellizco = {d: distancia(e.touches[0], e.touches[1]), s: zoom.escala};
    e.preventDefault();
  } else if(e.touches.length === 1 && zoom.escala > 1 && zoom.caja === caja){
    zoom.arrastre = {x: e.touches[0].clientX, y: e.touches[0].clientY};
  }
}, {passive: false});
document.getElementById('fichaBody').addEventListener('touchmove', e => {
  if(zoom.pellizco && e.touches.length === 2){
    e.preventDefault();
    zoom.escala = Math.max(1, Math.min(ZOOM_MAX, zoom.pellizco.s * distancia(e.touches[0], e.touches[1]) / zoom.pellizco.d));
    pintarZoom();
  } else if(zoom.arrastre && e.touches.length === 1 && zoom.escala > 1){
    e.preventDefault();
    const t = e.touches[0];
    zoom.x += t.clientX - zoom.arrastre.x; zoom.y += t.clientY - zoom.arrastre.y;
    zoom.arrastre = {x: t.clientX, y: t.clientY};
    pintarZoom();
  }
}, {passive: false});
document.getElementById('fichaBody').addEventListener('touchend', e => {
  if(e.touches.length < 2) zoom.pellizco = null;
  if(e.touches.length === 0) zoom.arrastre = null;
  if(zoom.escala <= 1.03 && zoom.caja && !zoom.pellizco){ zoomReiniciar(); actualizarBotonZoom(); }
});
// PC: con zoom, la foto se arrastra con el mouse.
document.getElementById('fichaBody').addEventListener('mousedown', e => {
  const caja = e.target.closest('.foto-caja');
  if(!caja || zoom.escala <= 1 || zoom.caja !== caja) return;
  e.preventDefault();
  zoom.arrastre = {x: e.clientX, y: e.clientY};
});
window.addEventListener('mousemove', e => {
  if(!zoom.arrastre || e.buttons !== 1) return;
  zoom.x += e.clientX - zoom.arrastre.x; zoom.y += e.clientY - zoom.arrastre.y;
  zoom.arrastre = {x: e.clientX, y: e.clientY};
  pintarZoom();
});
window.addEventListener('mouseup', () => { if(zoom.escala > 1) zoom.arrastre = null; });
// Botón +/−
document.getElementById('fichaBody').addEventListener('click', e => {
  if(!e.target.closest('#zoomBtn')) return;
  if(zoom.escala > 1){ zoomReiniciar(); actualizarBotonZoom(); return; }
  const c = cajaActual();
  if(!c || !c.classList.contains('foto-caja')) return;
  zoom.caja = c; zoom.escala = ZOOM_BOTON; zoom.x = 0; zoom.y = 0;
  pintarZoom();
});
// Fuera de las fotos no hay zoom: se bloquea el pellizco del navegador (Safari en
// iPhone no respeta "user-scalable=no") y el doble toque (ver style.css).
document.addEventListener('gesturestart', e => e.preventDefault());
document.addEventListener('gesturechange', e => e.preventDefault());
document.addEventListener('touchmove', e => {
  if(e.touches.length > 1 && !(e.target.closest && e.target.closest('.foto-caja'))) e.preventDefault();
}, {passive: false});

document.getElementById('fichaBody').addEventListener('click', e => {
  const nav = e.target.closest('[data-gal]');
  if(nav){
    const pista = document.getElementById('galPista');
    zoomReiniciar();
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
  // Restock en camino: baja al "¿Quieres que te avisemos?".
  if(e.target.closest('[data-ir-aviso]')){
    const a = document.getElementById('avisoFicha');
    if(a) a.scrollIntoView({behavior: 'smooth', block: 'center'});
    return;
  }
  const add = e.target.closest('[data-agregar]');
  const mas = e.target.closest('[data-ficha-cant]');
  if(add || mas){
    if(add){ if(agregar(add.dataset.agregar)) toast('Agregado al carrito'); else return; }
    else setCantidad(fichaVarId, (carrito[fichaVarId] || 0) + Number(mas.dataset.fichaCant));
    // Se repinta sin mover la ficha (antes saltaba hasta la foto de arriba).
    const sheet = document.querySelector('#fichaOverlay .sheet');
    const top = sheet ? sheet.scrollTop : 0;
    renderFicha(indiceGaleria());
    if(sheet) sheet.scrollTop = top;
  }
});

/* ---------- Carrito: vista y cierre del pedido ---------- */
// Pasos: 'lista' -> 'canal' (¿WhatsApp o Instagram?) -> 'instagram' (pedido copiado).
let pasoCarrito = 'lista';
let copiadoOk = false;

// Lo que se abre debajo de la opción de envío elegida. Los datos del cliente
// van plegados (se abren con la flechita) para que pedir sea rápido.
const datosAbiertos = {};   // id del envío -> ¿el bloque de datos está abierto?
function detalleEnvioHTML(id, ped){
  const y = cfg.YAPE || {};
  const yape = (monto, para) => '<div class="yape"><div class="yape-monto">Yapea ' + monto + '</div>' +
    '<div>al <b class="mono">' + esc(y.numero || '') + '</b> · ' + esc(y.nombre || '') + '</div>' +
    '<div class="nota-chica">' + para + ' Luego envía la captura en el chat junto con tu pedido.</div></div>';
  // Ubicación: por defecto se manda por WhatsApp (a la gente le resulta más fácil);
  // o se pega un link de Google Maps.
  const ubicacionHTML = () => '<div class="ubi"><div class="variantes-titulo">Tu ubicación</div><div class="chips">' +
    '<button type="button" class="chip' + (ubicacionModo === 'whatsapp' ? ' activo' : '') + '" data-ubi="whatsapp">Te la mando por WhatsApp</button>' +
    '<button type="button" class="chip' + (ubicacionModo === 'maps' ? ' activo' : '') + '" data-ubi="maps">Pego un link de Google Maps</button></div>' +
    (ubicacionModo === 'whatsapp'
      ? '<p class="nota-chica">Lo más fácil: después de enviar tu pedido, mándanos tu <b>ubicación actual</b> por WhatsApp (no "en tiempo real"). Se ve así:</p>' +
        '<img class="ubi-img" src="img/ubicacion-actual.jpg" alt="Ejemplo de ubicación actual en WhatsApp" loading="lazy">'
      : '<label class="campo"><span>Link de Google Maps ' + infoHTML('Cómo sacar el link',
          'En Google Maps busca tu casa → <b>Compartir</b> → <b>Copiar enlace</b>, y pégalo aquí.') + '</span>' +
        '<input type="url" data-dato="maps" value="' + esc(datos.maps || '') + '" autocomplete="off" placeholder="https://maps.app.goo.gl/…"></label>') +
    '</div>';
  const campos = (titulo, antes, despues) => '<details class="datos-form" data-datos="' + id + '"' + (datosAbiertos[id] ? ' open' : '') + '>' +
    '<summary>' + titulo + ' <span class="opc">(opcional)</span></summary>' +
    '<p class="nota-chica datos-opc">Si los llenas, llegan junto con tu pedido y es más rápido. Si prefieres, mándanoslos por chat.</p>' +
    (antes || '') +
    (CAMPOS_DATOS[id] || []).map(c => c[0] === 'maps' ? ubicacionHTML() :
      '<label class="campo"><span>' + esc(c[1]) + '</span>' +
      '<input type="' + (c[2] || 'text') + '"' + (c[3] ? ' inputmode="' + c[3] + '"' : '') + ' data-dato="' + c[0] + '" value="' + esc(datos[c[0]] || '') + '" autocomplete="off"></label>'
    ).join('') + (despues || '') + '</details>';
  let h = '';
  if(id === 'recojo'){
    h += '<div class="chips">' + (cfg.PUNTOS_RECOJO || []).map((pt, i) =>
      '<label class="chip' + (i === puntoRecojo ? ' activo' : '') + '"><input type="radio" name="punto" value="' + i + '"' + (i === puntoRecojo ? ' checked' : '') + '>' + esc(pt) + '</label>').join('') + '</div>' +
      '<p class="nota-chica">Coordinamos el día y la hora por chat. Pagas al recibir (o por adelantado, si prefieres). Si pagas en efectivo, el vuelto se coordina por chat.</p>' +
      (((cfg.ENVIOS || []).find(x => x.id === 'recojo') || {}).mapa ? '<a class="mapa-link" target="_blank" rel="noopener" href="' + esc(cfg.ENVIOS.find(x => x.id === 'recojo').mapa.url) + '">' + esc(cfg.ENVIOS.find(x => x.id === 'recojo').mapa.texto) + '</a>' : '');
  }
  if(id === 'moto'){
    h += '<div class="campo"><span>Tu distrito</span>' + selectDistritoHTML('distritoCarrito', distritoTxt) + '</div>' +
      cotizacionHTML(distritoTxt, ped.gratis, true) +
      '<div class="campo"><span>¿Qué día lo quieres? (opcional · lunes a sábado, 11am a 7pm)</span><div class="chips dias">' +
        fechasEntrega().map(f => '<button type="button" class="chip' + (f.iso === fechaEntrega ? ' activo' : '') + '" data-dia="' + f.iso + '">' + f.txt + '</button>').join('') + '</div></div>' +
      '<p class="nota-chica">No hacemos envíos domingos ni feriados.</p>' +
      '';
    if(ped.costoEnvio > 0) h += yape(fmtPrecio(ped.costoEnvio) + ' del envío', 'Así tu pedido queda separado (máximo 1 semana).');
    else if(ped.costoEnvio === 0) h += '<p class="nota-chica">Tu envío es gratis: te escribimos para confirmar y separar tu pedido.</p>';
    else if(!ped.gratis) h += '<p class="nota-chica">Te confirmamos el costo exacto por chat y ahí yapeas solo el envío para separar tu pedido (máximo 1 semana).</p>';
    // El medio de pago del producto es parte de los datos del delivery.
    h += campos('Tus datos para el delivery', '',
      '<div class="variantes-titulo" style="margin-top:12px">El producto lo pagas al recibir con (opcional)</div><div class="chips">' +
      ['Yape', 'Efectivo (monto exacto)'].map(v => '<button type="button" class="chip' + (v === pagoProducto ? ' activo' : '') + '" data-pago="' + esc(v) + '">' + esc(v) + '</button>').join('') + '</div>');
  }
  if(id === 'shalom'){
    h += yape(fmtPrecio(ped.productos), 'Es el pago de tus productos; el envío (' + (ped.gratis ? 'gratis' : fmtPrecio(costoShalom())) + ') lo pagas al recibir.') +
      '<p class="nota-chica">S/12 solo en algunas zonas de la selva. El día en que lo dejamos en Shalom se coordina por chat; te enviamos la guía y la clave al registrarlo y la boleta al dejarlo. ¿Lo quieres más rápido? Pregúntanos por el envío express por avión.</p>' +
      '<p class="nota-chica">¿Prefieres Olva Courier? Pregúntanos por chat.</p>' +
      campos('Datos para Shalom', '', '<p class="nota-chica">Los datos deben ser de una persona mayor de edad.</p>');
  }
  if(id === 'indrive'){
    const dI = buscarDistrito(distritoTxt);
    h += '<div class="campo"><span>Tu distrito (para cotizar)</span>' + selectDistritoHTML('distritoCarrito', distritoTxt) + '</div>' +
      (dI && dI.cerca ? cercaHTML('indrive', true) : '') +
      '<p class="nota-chica"><b>Dentro de Lima.</b> Enviamos desde San Miguel: es lo más recomendado para distritos cercanos. ' +
      'Antes de pagar, mándanos tu ubicación y te cotizamos el envío (si estás lejos puede salir más caro que el delivery). ' +
      'Coordinamos el día y la hora por chat, y te mandamos foto al dejarlo con el conductor y el seguimiento en vivo.</p>' +
      '<p class="nota-chica">Cuando confirmes, yapeas tus productos (' + fmtPrecio(ped.productos) + ') y el envío lo pagas al recibir.</p>' +
      campos('Tus datos para el envío');
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
      '<h2>Hacer pedido</h2>' +
      '<p class="pregunta">¿Coordinamos por WhatsApp o por Instagram?</p>' +
      '<p class="nota-chica">Te respondemos por el chat que elijas para confirmar stock y tu envío. Si justo algo se agotó, te avisamos ahí.</p>' +
      notaReintentoHTML() +
      '<button type="button" class="btn btn-wa" data-canal="whatsapp">WhatsApp</button>' +
      '<button type="button" class="btn" data-canal="instagram">Instagram</button>' +
      '<button type="button" class="btn-link" data-paso="lista">← Volver al carrito</button>' +
      '</div>';
    return;
  }

  if(pasoCarrito === 'enviado'){
    // Después de mandar el pedido NO se vacía solo (por si el cliente no llegó a
    // enviarlo): se le pregunta.
    body.innerHTML = '<div class="sheet-pad"><h2>¿Ya enviaste tu pedido?</h2>' +
      '<p class="nota-chica">Cuando lo envíes te respondemos por el chat para confirmar stock y envío.</p>' +
      notaReintentoHTML() +
      '<button type="button" class="btn btn-primario" data-vaciar-listo>Sí, ya lo envié: vaciar mi carrito</button>' +
      '<button type="button" class="btn" data-paso="lista">Todavía no, volver a mi carrito</button>' +
      '<button type="button" class="btn-link" data-paso="canal">Enviarlo otra vez</button></div>';
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
      '<ol class="pasos"><li>Toca <b>Abrir chat de Instagram</b>: se abre directo nuestro chat.</li><li>Mantén presionado el cuadro de mensaje y elige <b>Pegar</b>. Envía.</li></ol>' +
      '<a class="btn btn-primario" href="' + esc(urlInstagramChat()) + '" target="_blank" rel="noopener">Abrir chat de Instagram (@' + esc(cfg.INSTAGRAM_USUARIO || '') + ')</a>' +
      '<textarea class="pedido-texto" readonly id="pedidoTexto">' + esc(textoPedido()) + '</textarea>' +
      '<button type="button" class="btn" data-paso="enviado">Ya lo envié ✓</button>' +
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
    // Combo: UNA fila con el precio de la promo y lo que eligió el cliente.
    if(esClaveCombo(id)){
      const c = leerCombo(id), ok = !!c.pr && c.ps.every(sePuedePedir);
      if(!ok){
        return '<div class="linea fuera">' +
          '<img src="' + esc(c.pr && c.pr.foto ? c.pr.foto : FOTO_VACIA) + '" alt="">' +
          '<div><div class="linea-nombre">' + esc(c.pr ? c.pr.nombre : 'Promo que ya terminó') + '</div>' +
          '<div class="linea-sub">Se agotó algo del combo: no se incluye en el pedido</div></div>' +
          '<div class="linea-der"><button type="button" class="btn-link" data-quitar="' + esc(id) + '">Quitar</button></div></div>';
      }
      const normal = c.ps.reduce((a, q) => a + precioVigente(q, ahora), 0);
      return '<div class="linea linea-combo">' +
        '<img src="' + esc(c.pr.foto || fotoPropia(c.ps[0])) + '" alt="">' +
        '<div><div class="linea-nombre">' + esc(c.pr.nombre) + '</div>' +
        '<div class="linea-sub">' + esc(c.ps.map(q => q.nombre).join(' + ')) + '</div>' +
        '<div class="linea-sub">' + fmtPrecio(c.pr.valor) + ' promo' + (normal > c.pr.valor ? ' · <s class="tachado">' + fmtPrecio(normal) + '</s>' : '') + (cant > 1 ? ' c/u' : '') + '</div></div>' +
        '<div class="linea-der"><div class="linea-total">' + fmtPrecio(c.pr.valor * cant) + '</div>' +
        '<div class="cant"><button type="button" data-cant="-1" data-id="' + esc(id) + '" aria-label="Quitar uno">−</button>' +
        '<span>' + cant + '</span>' +
        '<button type="button" data-cant="1" data-id="' + esc(id) + '" aria-label="Agregar uno"' + (cant >= topeLinea(id) ? ' disabled' : '') + '>+</button></div></div></div>';
    }
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
      '<button type="button" data-cant="1" data-id="' + esc(id) + '" aria-label="Agregar uno"' + (cant >= topeLinea(id) ? ' disabled' : '') + '>+</button></div>' +
      (p.quedan ? '<div class="linea-quedan">' + textoQuedan(p.quedan, true) + '</div>' : '') + '</div></div>';
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
  const opcionHTML = (id, nombre, est, pago, sel) =>
    '<label class="opcion' + (sel ? ' sel' : '') + '" data-opcion="' + esc(id) + '"><input type="radio" name="envio" value="' + esc(id) + '"' + (sel ? ' checked' : '') + '>' +
    '<span class="opcion-cuerpo"><span class="opcion-fila"><span class="opcion-nombre">' + esc(nombre) + '</span>' +
    (est && est.texto ? '<span class="opcion-precio">' + (est.tachado ? '<s class="tachado">' + esc(est.tachado) + '</s> ' : '') + esc(est.texto) + '</span>' : '') + '</span>' +
    (pago ? '<span class="opcion-nota">' + esc(pago) + '</span>' : '') + '</span></label>' +
    (sel ? detalleEnvioHTML(id, ped) : '');
  const enviosHTML = envios.length && validas.length
    ? '<div class="envio-bloque"><div class="variantes-titulo">¿Cómo lo recibes? Cotiza tu envío</div>' +
      envios.map(x => opcionHTML(x.id, x.nombre, envioEstimado(x.id, ped.gratis), x.pago, envioSel === x.id)).join('') +
      opcionHTML('', 'Lo coordino por chat', null, 'Te ayudamos a elegir la mejor opción.', !envioSel) +
      '</div>'
    : '';
  const totalAprox = (ped.envio && ped.costoEnvio > 0)
    ? '<div class="fila-total"><span>Envío aprox.</span><span>' + fmtPrecio(ped.costoEnvio) + '</span></div>' +
      '<div class="total"><span>Total aprox.</span><b>' + fmtPrecio(ped.productos + ped.costoEnvio) + '</b></div>'
    : '<div class="total"><span>Total productos</span><b>' + fmtPrecio(ped.productos) + '</b></div>';

  body.innerHTML = '<div class="sheet-pad"><h2>Tu pedido</h2>' + filas + promosHTML + enviosHTML +
    '<div class="resumen-total">' + totalAprox + '</div>' +
    (ped.gratis
      ? '<div class="envio-gratis envio-gratis-caja">🚚 Envío gratis aplicado</div>'
      : '') +
    '<p class="nota-chica">El costo de envío es aproximado y se confirma por chat. Solo enviamos dentro del Perú. En cualquier opción también puedes pagar todo por adelantado.</p>' +
    (validas.length
      ? '<button type="button" class="btn btn-primario" data-paso="canal">Hacer pedido</button>'
      : '<button type="button" class="btn" disabled>No hay productos disponibles en tu carrito</button>') +
    '<button type="button" class="btn-link" data-vaciar>Vaciar carrito</button>' +
    '</div>';
}

// A veces WhatsApp tarda en mostrar o "pierde" los primeros mensajes de un número
// nuevo: se le avisa al cliente qué hacer si no le respondemos.
function notaReintentoHTML(){
  return '<p class="nota-reintento"><b>¿No te respondemos?</b> A veces WhatsApp se demora en mostrar los mensajes. ' +
    'Escríbenos otra vez o mándanos un DM por Instagram' + (cfg.INSTAGRAM_USUARIO ? ' (@' + esc(cfg.INSTAGRAM_USUARIO) + ')' : '') + '.</p>';
}
function urlInstagram(){
  return 'https://www.instagram.com/' + encodeURIComponent(cfg.INSTAGRAM_USUARIO || '') + '/';
}
// Abre directo el chat (DM) con la tienda, no el perfil: así el cliente no se
// distrae en el camino. Instagram no deja mandar el mensaje ya escrito (es una
// regla de ellos), por eso el pedido se copia antes y el cliente solo lo pega.
function urlInstagramChat(){
  return 'https://ig.me/m/' + encodeURIComponent(cfg.INSTAGRAM_USUARIO || '');
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
  if(t.name === 'envio'){
    envioSel = t.value; guardarEnvio(); repintarCarrito();
    // Se muestra desde el comienzo de la opción elegida (no desde el fondo de sus datos).
    const op = document.querySelector('#carritoBody .opcion.sel');
    if(op) op.scrollIntoView({block: 'start'});
  }
  else if(t.name === 'punto'){ puntoRecojo = Number(t.value) || 0; repintarCarrito(); }
});
document.getElementById('carritoBody').addEventListener('input', e => {
  const t = e.target;
  if(t.dataset.dato){ datos[t.dataset.dato] = t.value; return; }
});
document.getElementById('carritoBody').addEventListener('click', e => {
  const t = e.target;
  // Tocar otra vez la opción ya elegida la des-selecciona ("lo coordino por chat").
  if(t.name === 'envio' && t.value && t.value === envioSel){ envioSel = ''; guardarEnvio(); repintarCarrito(); return; }
  // Recordar si el cliente abrió o cerró sus datos (la flechita).
  const sum = t.closest('.datos-form > summary');
  if(sum){ const d = sum.parentNode; datosAbiertos[d.dataset.datos] = !d.open; return; }
  // Día de entrega, pago del producto y forma de mandar la ubicación: botones que
  // se pueden tocar otra vez para quitarlos (nada viene marcado de antemano).
  const dia = t.closest('[data-dia]');
  if(dia){ fechaEntrega = fechaEntrega === dia.dataset.dia ? '' : dia.dataset.dia; repintarCarrito(); return; }
  const pago = t.closest('[data-pago]');
  if(pago){ pagoProducto = pagoProducto === pago.dataset.pago ? '' : pago.dataset.pago; repintarCarrito(); return; }
  const ubi = t.closest('[data-ubi]');
  if(ubi){ ubicacionModo = ubi.dataset.ubi; repintarCarrito(); return; }
  const cambio = t.closest('[data-envio]');
  if(cambio){ envioSel = cambio.dataset.envio; guardarEnvio(); repintarCarrito(); return; }
  const cant = t.closest('[data-cant]');
  if(cant){ setCantidad(cant.dataset.id, (carrito[cant.dataset.id] || 0) + Number(cant.dataset.cant)); renderCarrito(); return; }
  const quitar = t.closest('[data-quitar]');
  if(quitar){ setCantidad(quitar.dataset.quitar, 0); renderCarrito(); return; }
  if(t.closest('[data-vaciar-listo]')){ carrito = {}; guardarCarrito(); renderContador(); pasoCarrito = 'lista'; toast('Listo, tu carrito quedó vacío'); renderCarrito(); return; }
  if(t.closest('[data-vaciar]')){ carrito = {}; guardarCarrito(); renderContador(); renderCarrito(); return; }
  const paso = t.closest('[data-paso]');
  if(paso){
    pasoCarrito = paso.dataset.paso;
    if(pasoCarrito === 'canal'){ const pd = calcularPedido(Date.now()); pixel('InitiateCheckout', {value: pd.productos, currency: 'PEN', num_items: pd.lineas.reduce((a, l) => a + l.cant, 0)}); }
    renderCarrito(); return;
  }
  const canal = t.closest('[data-canal]');
  if(canal){
    const texto = textoPedido();
    contar('cerrar-pedido/' + canal.dataset.canal, 'Cerró pedido por ' + canal.dataset.canal);
    pixel('Lead', {value: calcularPedido(Date.now()).productos, currency: 'PEN', content_category: canal.dataset.canal});
    if(canal.dataset.canal === 'whatsapp'){
      window.open(urlWhatsApp(texto), '_blank', 'noopener');
      pasoCarrito = 'enviado'; renderCarrito();
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
  const comboOv = document.getElementById('comboOverlay');
  let abierto = null;
  let indiceNuevo = 0;
  fichaEntradaId = h.indexOf('#/p/') === 0 ? fichaEntradaId : null;
  if(h.indexOf('#/combo/') !== 0) comboAbierto = null;
  if(h.indexOf('#/p/') === 0){
    // El enlace puede ser el de un grupo (g-collar-gengar) o el de una variante.
    const clave = decodeURIComponent(h.slice(4));
    const e = ENTRADA_POR_ID[clave];
    if(e){
      if(fichaEntradaId !== e.id){
        fichaEntradaId = e.id;
        fichaVarId = (clave !== e.id && POR_ID[clave]) ? clave : repVariante(e).id;
        contar('producto/' + fichaVarId, 'Vio: ' + POR_ID[fichaVarId].nombre);
        pixel('ViewContent', {content_ids: [fichaVarId], content_name: POR_ID[fichaVarId].nombre, content_type: 'product', value: precioVigente(POR_ID[fichaVarId], Date.now()), currency: 'PEN'});
        indiceNuevo = POR_ID[fichaVarId].indiceFoto;
      } else {
        indiceNuevo = indiceGaleria();   // repintado (ej. venció una oferta): se queda donde estaba
      }
      abierto = fichaOv;
    }
  } else if(h.indexOf('#/combo/') === 0){
    const nuevoCombo = Number(h.slice(8));
    if(nuevoCombo !== comboAbierto) contar('combo/' + nuevoCombo, 'Abrió un combo');
    comboAbierto = nuevoCombo;
    abierto = comboOv;
  } else if(h === '#/carrito'){
    abierto = carritoOv;
  }
  // Primero se muestra la hoja y recién después se pinta: así la galería ya
  // tiene ancho y puede saltar a la foto de la variante elegida.
  fichaOv.hidden = abierto !== fichaOv;
  carritoOv.hidden = abierto !== carritoOv;
  comboOv.hidden = abierto !== comboOv;
  bloquearFondo(!!abierto);
  if(abierto === fichaOv) renderFicha(indiceNuevo);
  if(abierto === carritoOv) renderCarrito();
  if(abierto === comboOv) renderCombo();
  if(abierto) abierto.querySelector('.sheet').scrollTop = 0;
}
function cerrarHoja(){
  // Un combo abierto desde una ficha: la ✕ cierra TODO (para volver a la ficha
  // está la flecha "←"); si no, "cerrar" es lo mismo que "atrás".
  if(comboDesdeFicha && location.hash.indexOf('#/combo/') === 0){
    comboDesdeFicha = false;
    history.replaceState(null, '', location.pathname + location.search);
    hashActual = '';
    ruta();
    return;
  }
  // Si se llegó tocando dentro de la página, "cerrar" es lo mismo que "atrás".
  // Si se entró directo con un enlace a un producto, no hay a dónde volver:
  // se limpia la dirección y queda el catálogo.
  if(navegoAdentro) history.back();
  else { history.replaceState(null, '', location.pathname + location.search); ruta(); }
}
window.addEventListener('hashchange', () => {
  navegoAdentro = true;
  hashPrevio = hashActual; hashActual = location.hash;
  // ¿El combo se abrió desde la ficha de un producto? Entonces tendrá flecha para volver.
  comboDesdeFicha = location.hash.indexOf('#/combo/') === 0 && hashPrevio.indexOf('#/p/') === 0;
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
// Foto que no carga: en la galería y en las tarjetas se reintenta una vez y, si
// vuelve a fallar, se avisa "No se pudo cargar la foto. Revisa tu conexión." En el
// resto (sin caja), se cambia por la foto de reserva para no dejar un hueco.
document.addEventListener('error', e => {
  const img = e.target;
  if(!img || img.tagName !== 'IMG' || img.src === FOTO_VACIA) return;
  const caja = img.parentNode;
  if(caja && caja.classList && (caja.classList.contains('foto-caja') || caja.classList.contains('prod-foto'))){
    if(!img.dataset.reintento){
      img.dataset.reintento = '1';
      setTimeout(() => { img.src = img.src.split('?')[0] + '?r=' + Date.now(); }, 1500);
    } else {
      caja.classList.remove('lenta');
      caja.classList.add('fallo');
    }
    return;
  }
  img.src = FOTO_VACIA;
}, true);

/* ---------- Ofertas con temporizador ---------- */
// Cada segundo se actualizan las cuentas regresivas. Además se compara qué
// ofertas y promos están vigentes contra el segundo anterior: en el instante en
// que una vence, se vuelve a pintar todo y el producto regresa SOLO a su precio
// normal (grilla, ficha abierta y carrito), sin recargar y sin que nadie toque nada.
let firmaOfertas = '';
function calcFirma(ahora){
  return PRODUCTOS.map(p => ofertaActiva(p, ahora) ? '1' : '0').join('') + '|' +
         PROMOS.map(pr => (promoActiva(pr, ahora) ? '1' : '0') + (promoVisible(pr, ahora) ? '1' : '0')).join('');
}
setInterval(() => {
  renderFranja();
  const ahora = Date.now();
  aplicarFotoInicio(ahora);
  const firma = calcFirma(ahora);
  if(firma !== firmaOfertas){
    firmaOfertas = firma;
    renderTodo();
    return;
  }
  document.querySelectorAll('[data-hasta]').forEach(el => {
    const ms = Number(el.dataset.hasta) - ahora;
    el.textContent = fmtCuenta(ms);
    // Menos de 24 horas: la cuenta se pone en rojo.
    if(el.parentElement) el.parentElement.classList.toggle('cuenta-urgente', ms < 86400000);
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
  // Dos columnas que se llenan hacia abajo; leídas de izquierda a derecha quedan
  // en el orden de config.js (recojo, delivery, Shalom, InDrive).
  const tarjetas = (cfg.ENVIOS || []).map(x =>
    '<div class="envio-card"><div class="envio-titulo">' + esc(x.nombre) + '</div>' +
    '<div class="envio-pago">' + esc(x.pago) + '</div><p>' + esc(x.texto) + '</p>' +
    (x.extra ? '<p class="envio-extra">' + esc(x.extra) + '</p>' : '') +
    (x.mapa ? '<a class="mapa-link" href="' + esc(x.mapa.url) + '" target="_blank" rel="noopener">' + esc(x.mapa.texto) + '</a>' : '') +
    (x.id === 'moto'
      ? '<div class="campo"><span>Cotiza tu envío</span>' + selectDistritoHTML('distritoHome', distritoTxt) + '</div>' +
        '<div id="cotizHome">' + cotizacionHTML(distritoTxt, false, false) + '</div>'
      : '') +
    '</div>');
  cont.innerHTML = [0, 1].map(c => '<div class="envios-col">' + tarjetas.filter((t, i) => i % 2 === c).join('') + '</div>').join('');
}

function renderTodo(){
  renderFranja();
  renderGrilla();
  renderContador();
  ruta();
}

/* ---------- Arranque ---------- */
// Al entrar, la página empieza SIEMPRE arriba (el navegador a veces la dejaba
// donde estaba la última vez, por ejemplo en las preguntas frecuentes).
if('scrollRestoration' in history) history.scrollRestoration = 'manual';
if(!location.hash) window.scrollTo(0, 0);

// "Escríbenos": se elige WhatsApp o Instagram (Instagram abre directo el chat).
document.getElementById('heroIg').href = urlInstagramChat();
document.getElementById('escribenosBtn').addEventListener('click', e => {
  e.stopPropagation();
  const menu = document.getElementById('escribenosMenu');
  menu.hidden = !menu.hidden;
  e.currentTarget.setAttribute('aria-expanded', String(!menu.hidden));
});
document.addEventListener('click', e => {
  const menu = document.getElementById('escribenosMenu');
  if(!menu.hidden && !e.target.closest('.escribenos')){
    menu.hidden = true;
    document.getElementById('escribenosBtn').setAttribute('aria-expanded', 'false');
  }
});

// Preguntas frecuentes: al abrir una, se cierra la que estaba abierta.
document.querySelectorAll('.faq details').forEach(d => d.addEventListener('toggle', () => {
  if(d.open) document.querySelectorAll('.faq details[open]').forEach(o => { if(o !== d) o.open = false; });
}));

/* ---------- Clientes: carrusel que gira solo hacia la derecha ----------
   Las fotos se ponen en config.js (CLIENTES_FOTOS). Se puede deslizar con el
   dedo o el mouse; al soltar, sigue girando solo. */
function renderClientes(){
  const cont = document.getElementById('clientesCarrusel');
  if(!cont) return;
  const fotos = cfg.CLIENTES_FOTOS || [];
  if(!fotos.length){
    cont.innerHTML = '<div class="estado">Muy pronto: fotos de nuestros clientes con sus pedidos.</div>';
    return;
  }
  // Dos vueltas iguales: al terminar una, se salta sin que se note a la otra.
  const vuelta = fotos.map(f => '<img loading="lazy" src="' + esc(f) + '" alt="Pedido entregado a un cliente">').join('');
  cont.innerHTML = '<div class="clientes-pista" id="clientesPista">' + vuelta + vuelta + '</div>';
  const pista = document.getElementById('clientesPista');
  if(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let pausa = false, reanudar = null;
  const parar = () => { pausa = true; clearTimeout(reanudar); };
  const seguir = () => { clearTimeout(reanudar); reanudar = setTimeout(() => { pausa = false; }, 1500); };
  ['pointerdown', 'touchstart', 'wheel', 'mouseenter'].forEach(ev => pista.addEventListener(ev, parar, {passive: true}));
  ['pointerup', 'touchend', 'mouseleave'].forEach(ev => pista.addEventListener(ev, seguir, {passive: true}));
  // Avanza de la foto 1 a la 13 y vuelve a empezar sin corte (son dos vueltas
  // iguales: al terminar la primera se salta al inicio). La posición se lleva
  // con decimales aparte, porque algunos celulares redondean scrollLeft y el
  // carrusel se quedaba quieto.
  let previo = null, pos = 0;
  const VELOCIDAD = 0.06;   // px por milisegundo (~60 px por segundo)
  const paso = t => {
    const mitad = pista.scrollWidth / 2;
    if(previo !== null && mitad > pista.clientWidth){
      if(pausa) pos = pista.scrollLeft;          // si el cliente lo movió, sigue desde ahí
      else {
        pos += (t - previo) * VELOCIDAD;
        if(pos >= mitad) pos -= mitad;
        pista.scrollLeft = pos;
      }
    }
    previo = t;
    requestAnimationFrame(paso);
  };
  pista.scrollLeft = 0;
  requestAnimationFrame(paso);
}
renderClientes();

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
