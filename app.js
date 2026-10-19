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
    if(n) mapa[n] = {estado: norm(celda(r, 'estado')), puesto: parseInt(celda(r, 'bestseller'), 10) || 0,
                      orden: parseInt(celda(r, 'orden'), 10) || 0};
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
    hasta: parseFechaLima(col(r, 'hasta')),
    activa: esSi(col(r, 'activa')),
    texto: col(r, 'texto'),
    foto: col(r, 'foto'),   // foto del combo (la del Canva), opcional
  })).filter(pr => pr.nombre && pr.alcance.length && pr.valor > 0);
}
function promoActiva(pr, ahora){
  if(!pr.activa) return false;
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
  return PROMOS.filter(pr => pr.texto && promoActiva(pr, ahora) && enAlcance(pr, p)).map(pr => pr.texto);
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
function quitarCarga(){
  const c = document.getElementById('carga');
  if(!c || c.classList.contains('fuera')) return;
  // Por si el navegador movió la página mientras cargaba: arranca arriba.
  if(!location.hash) window.scrollTo(0, 0);
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
    if(e.pocos) tags += '<span class="tag tag-pocos">Últimas unidades</span>';
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
  const casilleros = x.pr.alcance.map(opcionesCasillero);
  const sel = comboSel[x.i] = casilleros.map((ops, s) => {
    const previo = (comboSel[x.i] || [])[s];
    const ok = ops.find(p => p.id === previo && p.disponible);
    if(ok) return ok.id;
    return ops.length === 1 && ops[0].disponible ? ops[0].id : null;
  });
  const elegidos = sel.map(id => POR_ID[id]).filter(Boolean);
  return {casilleros: casilleros, sel: sel, completo: sel.every(Boolean),
          // ¿Se puede armar? Cada casillero tiene que tener al menos una opción con stock.
          disponible: casilleros.every(ops => ops.some(p => p.disponible)),
          normal: elegidos.reduce((a, p) => a + precioVigente(p, ahora), 0),
          // Envío gratis si alguna opción lo trae (el cinturón premium, en estos combos).
          gratis: casilleros.some(ops => ops.length && ops.every(p => p.envioGratis))};
}
// Tarjeta del combo en la página: la foto del combo (la del Canva), precio y "Arma tu combo".
function comboHTML(x, ahora){
  const st = estadoCombo(x, ahora);
  const foto = x.pr.foto || fotoPropia((st.casilleros[0] || [])[0]);
  return '<a class="combo' + (st.disponible ? '' : ' combo-agotado') + '" href="#/combo/' + x.i + '">' +
    '<div class="combo-foto"><img loading="lazy" src="' + esc(foto) + '" alt="' + esc(x.pr.nombre) + '">' +
      (st.disponible ? '' : '<div class="tags"><span class="tag tag-agotado">Agotado</span></div>') + '</div>' +
    '<div class="combo-cuerpo">' +
      '<div class="combo-nombre">' + esc(x.pr.nombre) + '</div>' +
      '<div class="precios"><span class="precio-oferta combo-precio">' + fmtPrecio(x.pr.valor) + '</span></div>' +
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
    (x.pr.foto ? '<div class="galeria"><img class="combo-portada" src="' + esc(x.pr.foto) + '" alt="' + esc(x.pr.nombre) + '"></div>' : '') +
    '<div class="sheet-pad">' +
      '<div class="eyebrow">Promoción</div>' +
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
                esc(nombreCorto(p)) + (p.disponible ? '' : ' · Agotado') + '</button>').join('') + '</div>'
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
      '<p class="nota-chica" style="text-align:center">El precio de la promo se aplica solo en tu carrito.</p>' +
    '</div>';
}
document.getElementById('comboBody').addEventListener('click', e => {
  // Combo agotado: vuelve a la sección de promos para elegir otro.
  if(e.target.closest('[data-otros-combos]')){
    cerrarHoja();
    setTimeout(() => { const s = document.getElementById('promos'); if(s) s.scrollIntoView({behavior: 'smooth'}); }, 150);
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
    const ids = comboSel[Number(add.dataset.comboAgregar)] || [];
    if(ids.length && ids.every(id => sePuedePedir(POR_ID[id]))){
      ids.forEach(id => agregar(id));
      toast('Combo agregado: el precio de la promo ya está en tu carrito');
      location.hash = '#/carrito';
    }
  }
});
function promosSeccionHTML(ahora){
  const combos = combosActivos(ahora);
  if(!combos.length) return '';
  return '<section class="cat" id="promos"><h2 class="cat-titulo">Promociones</h2>' +
    '<p class="sub-desc">Toca un combo, elige tus productos (con sus fotos y videos) y agrégalo: el precio de la promo se aplica solo en tu carrito.</p>' +
    // Los combos que ya no se pueden armar (algo agotado) van al final.
    '<div class="combos">' + combos.map(x => ({x: x, ok: estadoCombo(x, ahora).disponible}))
      .sort((a, b) => (b.ok - a.ok) || (a.x.i - b.x.i)).map(c => comboHTML(c.x, ahora)).join('') + '</div></section>';
}
// Botón llamativo del inicio cuando hay promos.
function renderHeroPromo(ahora){
  const el = document.getElementById('heroPromo');
  if(!el) return;
  const combos = combosActivos(ahora);
  if(!combos.length){ el.innerHTML = ''; return; }
  const fines = combos.map(x => x.pr.hasta).filter(h => h && !isNaN(h));
  el.innerHTML = '<a class="hero-promo" href="#promos" data-scroll="promos"><span class="hero-promo-titulo">🔥 Promos disponibles</span>' +
    '<span class="hero-promo-sub">' + (fines.length ? 'Hasta el ' + fechaCortaLima(Math.min.apply(null, fines)) + ' · ' : '') + 'Ver promos →</span></a>';
}

function renderGrilla(){
  const ahora = Date.now();
  const main = document.getElementById('catalogo');
  const nav = document.getElementById('catsNav');
  const grupos = agrupar();
  renderHeroPromo(ahora);
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
  main.innerHTML = (promosPrimero ? promosHTML + masHTML : masHTML + promosHTML) + grupos.map(g =>
    '<section class="cat" id="' + esc(g.id) + '">' +
    '<h2 class="cat-titulo">' + esc(g.nombre) + ' <span class="cat-cuenta">' + g.items.length + '</span></h2>' +
    '<div class="grilla">' + g.items.map(e => tarjetaHTML(e, ahora)).join('') + '</div>' +
    fraseTallaHTML(null) +
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

// Lista desplegable con TODOS los distritos (en orden alfabético) + "otro".
function selectDistritoHTML(id, valor){
  const lista = (cfg.DISTRITOS || []).slice().sort((a, b) => a.n.localeCompare(b.n, 'es'));
  const elegido = buscarDistrito(valor);
  return '<select id="' + id + '" data-distrito>' +
    '<option value="">Elige tu distrito</option>' +
    lista.map(d => '<option value="' + esc(d.n) + '"' + (elegido === d ? ' selected' : '') + '>' + esc(d.n) + '</option>').join('') +
    '<option value="__otro"' + (valor === '__otro' ? ' selected' : '') + '>Otro / no aparece mi distrito</option>' +
    '</select>';
}

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
  if(r.max > RECOMENDAR_SHALOM_DESDE){
    h += '<div class="recomendado"><b>Opción recomendada: Shalom, ' + (gratis ? 'gratis' : fmtPrecio(costoShalom())) + '</b>' +
      '<span>Sale más barato a tu distrito. Pagas el producto antes, el envío al recibir, y lo recoges cuando puedas en tu agencia.</span>' +
      (enCarrito ? '<button type="button" class="btn-link" data-envio="shalom">Cambiar a Shalom</button>' : '') + '</div>';
  }
  return h + '</div>';
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
  contar('carrito/' + id, 'Agregó al carrito: ' + POR_ID[id].nombre);
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
    if(id === 'indrive') t += '\nTe mando mi ubicación para que me cotices el envío.';
    if(id === 'shalom') t +='\nYapeo ' + fmtPrecio(ped.productos) + ' (productos) al ' + (y.numero || '') + ' y te envío la captura.';
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

// Posición actual de la galería (0 = primera foto), para no perderla al repintar.
function indiceGaleria(){
  const pista = document.getElementById('galPista');
  return pista && pista.clientWidth ? Math.round(pista.scrollLeft / pista.clientWidth) : 0;
}

function renderFicha(indice){
  const e = ENTRADA_POR_ID[fichaEntradaId];
  const p = POR_ID[fichaVarId];
  const ahora = Date.now();
  // Grupo con foto de todos juntos: todas las fotos. Si no, solo las del color elegido.
  const fotos = e.juntos ? e.fotos : (p.fotos.length ? p.fotos : e.fotos);
  const medios = fotos.length ? fotos : [FOTO_VACIA];
  const titulo = e.juntos ? e.nombre : p.nombre;
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
      (p.disponible && p.pocos ? '<div class="pocos">Últimas unidades</div>' : '') +
      (p.disponible ? cuentaHTML(p, ahora, 'ficha-cuenta') : '') +
      (p.envioGratis ? '<div class="envio-gratis" style="margin-top:8px">🚚 Envío gratis llevando este producto</div>' : '') +
      (promos.length ? '<div class="promo-caja">' + promos.map(t => '<div>🏷 ' + esc(t) + '</div>').join('') + '</div>' : '') +
      '<dl class="datos">' +
        dato('Descripción y medidas', p.descripcion) +
        // En cinturones la talla es la del pantalón (así está en el Canva), con
        // una "?" que explica cómo medirse; en el resto, "Tallas" a secas.
        (esCinturon && p.tallas
          ? '<div class="dato"><dt>Tallas de pantalón ' + infoHTML('¿Cómo saber tu talla?', '<b>¿Cómo saber tu talla?</b>' + guia) + '</dt><dd>' + esc(p.tallas) + '</dd></div>'
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
            '<button type="button" data-ficha-cant="1" aria-label="Agregar uno"' + (enCarrito >= CANT_MAX ? ' disabled' : '') + '>+</button></div>' +
            '<div class="en-carrito">' + (enCarrito > 1 ? 'Más de 1 unidad: sujeto a disponibilidad. ' : '') + '<a href="#/carrito">Ver carrito</a></div>'
          : '<button type="button" class="btn btn-primario" data-agregar="' + esc(p.id) + '">Agregar al carrito</button>')
        : '<div id="avisoFicha">' + avisoHTML(p) + '</div>') +
      fraseTallaHTML(titulo) +
    '</div>';
  const pista = document.getElementById('galPista');
  if(varias){
    pista.addEventListener('scroll', () => {
      const i = Math.round(pista.scrollLeft / pista.clientWidth) + 1;
      document.getElementById('galCuenta').textContent = i + '/' + medios.length;
    }, {passive:true});
  }
  if(indice > 0) pista.scrollLeft = pista.clientWidth * indice;
  // Si a los 6 s alguna foto no terminó de cargar, se avisa que es la conexión
  // (para que no piensen que la página falla). Una vez por visita.
  setTimeout(() => {
    if(avisoLento) return;
    const lentas = Array.prototype.filter.call(document.querySelectorAll('#galPista img'), i => !i.complete);
    if(lentas.length){ avisoLento = true; toast('Tu conexión está lenta: las fotos pueden tardar un poco en cargar'); }
  }, 6000);
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
  const campos = (titulo, antes, despues) => '<details class="datos-form" data-datos="' + id + '"' + (datosAbiertos[id] ? ' open' : '') + '>' +
    '<summary>' + titulo + ' <span class="opc">(opcional)</span></summary>' +
    '<p class="nota-chica datos-opc">Si los llenas, llegan junto con tu pedido y es más rápido. Si prefieres, mándanoslos por chat.</p>' +
    (antes || '') +
    (CAMPOS_DATOS[id] || []).map(c =>
      '<label class="campo"><span>' + esc(c[1]) + (c[0] === 'maps' ? ' ' + infoHTML('Cómo mandar tu ubicación',
        '<b>¿No tienes el link?</b> Mándanos por WhatsApp tu <b>ubicación actual</b> (no "en tiempo real"): se ve así 👇' +
        '<img src="img/ubicacion-actual.jpg" alt="Ejemplo de ubicación actual en WhatsApp" loading="lazy">' +
        'O en Google Maps busca tu casa → Compartir → Copiar enlace, y pégalo aquí.') : '') + '</span>' +
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
    const l = limitesFecha();
    const aviso = avisoFecha(fechaEntrega);
    h += '<label class="campo"><span>Tu distrito</span>' + selectDistritoHTML('distritoCarrito', distritoTxt) + '</label>' +
      cotizacionHTML(distritoTxt, ped.gratis, true) +
      '<label class="campo"><span>¿Qué día lo quieres? (lunes a sábado, 11am a 7pm)</span><input type="date" data-fecha min="' + l.min + '" max="' + l.max + '" value="' + esc(fechaEntrega) + '"></label>' +
      '<p class="nota-chica">No hacemos envíos domingos ni feriados.</p>' +
      (aviso ? '<div class="cotiz cotiz-no">' + esc(aviso) + '</div>' : '');
    if(ped.costoEnvio > 0) h += yape(fmtPrecio(ped.costoEnvio) + ' del envío', 'Así tu pedido queda separado (máximo 1 semana).');
    else if(ped.costoEnvio === 0) h += '<p class="nota-chica">Tu envío es gratis: te escribimos para confirmar y separar tu pedido.</p>';
    else if(!ped.gratis) h += '<p class="nota-chica">Te confirmamos el costo exacto por chat y ahí yapeas solo el envío para separar tu pedido (máximo 1 semana).</p>';
    // El medio de pago del producto es parte de los datos del delivery.
    h += campos('Tus datos para el delivery', '',
      '<div class="variantes-titulo" style="margin-top:12px">El producto lo pagas al recibir con</div><div class="chips">' +
      ['Yape', 'Efectivo (monto exacto)'].map(v => '<label class="chip' + (v === pagoProducto ? ' activo' : '') + '"><input type="radio" name="pagoprod" value="' + esc(v) + '"' + (v === pagoProducto ? ' checked' : '') + '>' + esc(v) + '</label>').join('') + '</div>');
  }
  if(id === 'shalom'){
    h += yape(fmtPrecio(ped.productos), 'Es el pago de tus productos; el envío (' + (ped.gratis ? 'gratis' : fmtPrecio(costoShalom())) + ') lo pagas al recibir.') +
      '<p class="nota-chica">S/12 solo en algunas zonas de la selva. El día en que lo dejamos en Shalom se coordina por chat; te enviamos la guía y la clave al registrarlo y la boleta al dejarlo. ¿Lo quieres más rápido? Pregúntanos por el envío express por avión.</p>' +
      '<p class="nota-chica">¿Prefieres Olva Courier? Pregúntanos por chat.</p>' +
      campos('Datos para Shalom', '', '<p class="nota-chica">Los datos deben ser de una persona mayor de edad.</p>');
  }
  if(id === 'indrive'){
    h += '<p class="nota-chica"><b>Dentro de Lima.</b> Enviamos desde San Miguel: es lo más recomendado para distritos cercanos. ' +
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
      '<ol class="pasos"><li>Toca <b>Abrir chat de Instagram</b>: se abre directo nuestro chat.</li><li>Mantén presionado el cuadro de mensaje y elige <b>Pegar</b>. Envía.</li></ol>' +
      '<a class="btn btn-primario" href="' + esc(urlInstagramChat()) + '" target="_blank" rel="noopener">Abrir chat de Instagram (@' + esc(cfg.INSTAGRAM_USUARIO || '') + ')</a>' +
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
      ? '<button type="button" class="btn btn-primario" data-paso="canal">Cerrar pedido</button>'
      : '<button type="button" class="btn" disabled>No hay productos disponibles en tu carrito</button>') +
    '<button type="button" class="btn-link" data-vaciar>Vaciar carrito</button>' +
    '</div>';
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
  // Tocar otra vez la opción ya elegida la des-selecciona ("lo coordino por chat").
  if(t.name === 'envio' && t.value && t.value === envioSel){ envioSel = ''; guardarEnvio(); repintarCarrito(); return; }
  // Recordar si el cliente abrió o cerró sus datos (la flechita).
  const sum = t.closest('.datos-form > summary');
  if(sum){ const d = sum.parentNode; datosAbiertos[d.dataset.datos] = !d.open; return; }
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
    contar('cerrar-pedido/' + canal.dataset.canal, 'Cerró pedido por ' + canal.dataset.canal);
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
  document.body.classList.toggle('sin-scroll', !!abierto);
  if(abierto === fichaOv) renderFicha(indiceNuevo);
  if(abierto === carritoOv) renderCarrito();
  if(abierto === comboOv) renderCombo();
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
      ? '<label class="campo"><span>Cotiza tu envío</span>' + selectDistritoHTML('distritoHome', distritoTxt) + '</label>' +
        '<div id="cotizHome">' + cotizacionHTML(distritoTxt, false, false) + '</div>'
      : '') +
    '</div>');
  cont.innerHTML = [0, 1].map(c => '<div class="envios-col">' + tarjetas.filter((t, i) => i % 2 === c).join('') + '</div>').join('');
  const sel = document.getElementById('distritoHome');
  if(sel) sel.addEventListener('change', () => {
    distritoTxt = sel.value;
    guardarDistrito();
    document.getElementById('cotizHome').innerHTML = cotizacionHTML(distritoTxt, false, false);
  });
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
