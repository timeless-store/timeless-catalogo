// ==================== CONFIGURACIÓN DEL CATÁLOGO ====================
//
// Todo lo que cambia sin tocar el resto del código vive aquí.
// OJO: este archivo es PÚBLICO (cualquiera puede verlo desde el navegador).
// Aquí NO va ninguna URL del dashboard, ni la de Stocks, ni el Apps Script.

const CATALOGO_CONFIG = {

  // De dónde se leen los productos. Hoy: el archivo productos.csv de este repo.
  //
  // 🚨 REGLA FIJA: el Sheets "Timeless - Ventas e Inventario" es PRIVADO (costos,
  // márgenes, gastos). Nunca se publica ni se lee desde aquí. Si algún día los
  // productos salen de una hoja de Google, tendría que ser un archivo APARTE y
  // sin costos, y antes se consulta con el chat del dashboard.
  CSV_PRODUCTOS: 'productos.csv',

  // Lista pública que arma el dashboard (18-oct-2026): SOLO nombre, estado
  // ("en stock", "quedan pocos", "restock en camino", "agotado", "oculto") y
  // puesto de best seller. Es una hoja APARTE, sin costos ni cantidades; el
  // Sheets de ventas sigue privado. Manda sobre las columnas Disponible y
  // BestSeller de productos.csv. Si no carga, se usa productos.csv tal cual.
  // Nombres distintos al inventario: columna "NombreInventario" de productos.csv.
  CSV_ESTADO: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vS7n4RPZuRsT3npjH1tL8WxN5PPZrv87Yj815p8UKa0uboP8fFyvj7T9HD3fPiJBagUrR--AqJ6zzrr/pub?gid=0&single=true&output=csv',

  // Número de WhatsApp del negocio (el mismo del catálogo de Canva). Va con
  // código de país y sin espacios ni "+".
  WHATSAPP_NUMERO: '51960612770',

  // TODO(Alberto): cambiar a 'timeless.pe' EL MISMO DÍA que cambie el usuario
  // en Instagram, no antes: si se cambia aquí primero, el botón llevaría a un
  // perfil que no existe (o al de otra persona). Este es el ÚNICO lugar donde
  // se escribe: sin "@" y sin la dirección completa.
  INSTAGRAM_USUARIO: 'timeless.store._',

  // Usuario de TikTok (sin "@"). Hoy es el mismo de Instagram; si cambia uno,
  // revisar el otro. Si se deja vacío,
  // el botón de TikTok del pie no aparece.
  TIKTOK_USUARIO: 'timeless.store._',

  // Promociones automáticas (combos, 2 x S/75, "segundo collar -S/5"…). Se prenden
  // y apagan en promos.csv. Si el archivo no carga, la página funciona sin promos.
  CSV_PROMOS: 'promos.csv',

  // Yape para los pagos por adelantado (Shalom, InDrive, o el envío del delivery).
  YAPE: {numero: '960612770', nombre: 'José Herrera'},

  // Franja animada arriba de todo (Black Friday, Cyber Wow…). Solo aparece entre
  // "desde" y "hasta" (hora de Lima). Para apagarla: activa: false.
  // Para verla de prueba sin prenderla: abrir la página con ?franja=prueba al final.
  FRANJA: {
    activa: true,
    texto: 'CYBER WOW · Hasta -20% de descuento en el catálogo · Del 2 al 6 de noviembre',
    desde: '2026-11-01 00:00',
    hasta: '2026-11-06 23:59',
    // Etapas: desde cada fecha cambia el texto (y el fin). urgente = franja roja.
    etapas: [
      {desde: '2026-11-06 21:00', hasta: '2026-11-07 23:59',
       texto: 'CYBER WOW · ¡Se extiende 1 día más! · Hasta -20% de descuento en el catálogo · Del 2 al 7 de noviembre'},
      {desde: '2026-11-07 00:00', urgente: true,
       texto: 'ÚLTIMO DÍA DEL CYBER WOW · Hasta -20% de descuento en el catálogo · Solo hoy sábado 7 hasta las 11:59 pm'},
    ],
  },

  // ---------- ENVÍOS ----------
  // Solo enviamos dentro del Perú. Los costos son APROXIMADOS: se confirman por chat.
  // El envío gratis (cinturones premium o promos) aplica al recojo, al delivery
  // con motorizado (hasta este monto: SOLO se menciona si el distrito puede
  // costar más) y a Shalom. InDrive se cotiza por chat.
  ENVIO_GRATIS_CUBRE: 16,
  ENVIO_MINIMO_MOTO: 10,
  SHALOM_COSTO: 8,

  // Puntos de recojo sin costo (pago contraentrega).
  PUNTOS_RECOJO: ['Plaza San Miguel', 'Av. La Paz cdras. 6–8, San Miguel'],

  // Delivery con motorizado: costo por distrito. "min"/"max" cuando depende de la
  // zona; "h48" = llega en 48 horas; "nota" se muestra al cliente; "cerca" =
  // cerca de San Miguel: se sugiere el recojo sin costo en Plaza San Miguel o InDrive;
  // "indrive" = solo se recomienda InDrive (Cercado de Lima).
  // Lo que pasa de S/15 muestra a Shalom como opción recomendada.
  DISTRITOS: [
    {n: 'San Isidro', min: 10}, {n: 'Lince', min: 10}, {n: 'Jesús María', min: 10},
    {n: 'Pueblo Libre', min: 10, cerca: true}, {n: 'Breña', min: 10},
    {n: 'San Miguel', min: 10, cerca: true}, {n: 'Magdalena del Mar', min: 10, alias: ['magdalena'], cerca: true},
    {n: 'Cercado de Lima', min: 10, alias: ['lima', 'cercado', 'lima cercado'], indrive: true},
    {n: 'Surquillo', min: 10}, {n: 'Santiago de Surco', min: 10, alias: ['surco']},
    {n: 'Miraflores', min: 10}, {n: 'San Luis', min: 10}, {n: 'La Victoria', min: 10}, {n: 'San Borja', min: 10},
    {n: 'San Martín de Porres', min: 10, max: 15, nota: 'Oquendo (zona alejada): S/15', alias: ['smp'], cerca: true},
    {n: 'Comas', min: 10}, {n: 'Los Olivos', min: 10}, {n: 'Independencia', min: 10},
    {n: 'Chorrillos', min: 10}, {n: 'Barranco', min: 10},
    {n: 'Villa María del Triunfo', min: 13, max: 16, nota: 'José Gálvez: S/16', alias: ['vmt']},
    {n: 'San Juan de Miraflores', min: 13, alias: ['sjm']}, {n: 'Villa El Salvador', min: 13, alias: ['ves']},
    {n: 'San Juan de Lurigancho', min: 13, alias: ['sjl']}, {n: 'El Agustino', min: 10}, {n: 'Rímac', min: 10},
    {n: 'La Molina', min: 10, max: 18, nota: 'Hasta Sol de La Molina: S/10 · Musa: S/18'},
    {n: 'Ate', min: 10, max: 18, nota: 'Huaycán: S/18 · Santa Clara: S/16', alias: ['ate vitarte', 'vitarte']},
    {n: 'Santa Anita', min: 10},
    {n: 'Callao', min: 10, max: 16, cerca: true, nota: 'Hasta Óvalo 200 Millas: S/10 · Oquendo: S/15 · Márquez: S/16'},
    {n: 'Bellavista', min: 10, cerca: true}, {n: 'Carmen de la Legua', min: 10}, {n: 'La Perla', min: 10}, {n: 'La Punta', min: 15},
    {n: 'Puente Piedra', min: 15}, {n: 'Carabayllo', min: 15},
    {n: 'Ventanilla', min: 18, h48: true}, {n: 'Chaclacayo', min: 18},
    {n: 'Lurigancho (Chosica)', min: 18, h48: true, alias: ['chosica', 'lurigancho']},
    {n: 'Lurín', min: 18, h48: true}, {n: 'Ancón', min: 18, h48: true}, {n: 'Cieneguilla', min: 20, h48: true},
  ],

  // Formas de recibir el pedido (el orden es el del carrito y el de la sección
  // "Envíos y pagos"). "id" no se cambia: lo usa el código.
  // Olva Courier no va como opción (Alberto prefiere Shalom): solo una nota en Shalom.
  ENVIOS: [
    {id: 'recojo', nombre: 'Recojo sin costo', pago: 'Pago contraentrega',
     texto: 'En Plaza San Miguel o en Av. La Paz cdras. 6–8, San Miguel (el punto exacto te lo damos por chat). Coordinamos el día y la hora por chat; si pagas en efectivo, el vuelto se coordina.',
     mapa: {texto: '📍 Ver Plaza San Miguel en el mapa', url: 'https://www.google.com/maps/search/?api=1&query=Plaza%20San%20Miguel%2C%20Lima'}},
    {id: 'moto', nombre: 'Delivery con motorizado', pago: 'Pago contraentrega · adelantas solo el envío',
     texto: 'A casi todo Lima Metropolitana, de lunes a sábado de 11am a 7pm (no hacemos envíos domingos ni feriados). Elige tu distrito y te mostramos el costo aproximado. Adelantando el envío por Yape, tu pedido queda separado; el producto lo pagas al recibir.'},
    {id: 'shalom', nombre: 'Shalom — todo el Perú', pago: 'Pagas el producto antes · el envío al recibir',
     texto: 'Envío S/8 que pagas al recibir (S/12 solo en algunas zonas de la selva). En Lima llega al día siguiente de dejarlo y lo recoges cuando puedas, en el horario de tu agencia. Te mandamos la guía y la clave al registrarlo.',
     extra: '¿Prefieres Olva Courier? Pregúntanos por chat.'},
    {id: 'indrive', nombre: 'Envío express por InDrive (Lima)', pago: 'Pagas el producto antes · el envío al recibir',
     texto: 'Dentro de Lima. Enviamos desde San Miguel: recomendado para distritos cercanos. Mándanos tu ubicación y te cotizamos el envío antes de pagar; el día y la hora se coordinan por chat. Te mandamos foto y el seguimiento en vivo.'},
  ],

  // Link del Google Forms del Libro de Reclamaciones (lo crea Alberto). Vacío =
  // la página muestra el aviso de "falta el formulario".
  LIBRO_RECLAMACIONES_FORM: 'https://forms.gle/Pdt3bpxdMpRHXtVGA',

  // Píxel de Meta (para medir anuncios). Es el número del píxel que sale en el Administrador
  // de eventos de Meta (15 o 16 dígitos; NO es un secreto). Vacío = no se carga nada.
  // La página de pruebas lo deja siempre vacío.
  META_PIXEL_ID: '',

  // Estadísticas (GoatCounter, sin cookies): https://timeless.goatcounter.com
  // Vacío = no se cuenta nada.
  GOATCOUNTER: 'timeless',

  // Fotos de clientes con sus pedidos (carrusel "Clientes"). Ej: 'img/clientes/1.jpg'.
  // Vacío = la sección dice "Muy pronto".
  CLIENTES_FOTOS: ['img/clientes/01.jpg', 'img/clientes/02.jpg', 'img/clientes/03.jpg', 'img/clientes/04.jpg', 'img/clientes/05.jpg', 'img/clientes/06.jpg', 'img/clientes/07.jpg', 'img/clientes/08.jpg', 'img/clientes/09.jpg', 'img/clientes/10.jpg', 'img/clientes/11.jpg', 'img/clientes/12.jpg', 'img/clientes/13.jpg', 'img/clientes/14.jpg'],

  // Ordenar por la velocidad de venta que manda el dashboard (columna Orden).
  // APAGADO: Alberto decide el orden a mano y pide usar este solo cuando él diga.
  // Ordenar los productos de cada categoría por la velocidad de venta que manda
  // el dashboard (columna Orden de la lista). false = el orden de productos.csv.
  ORDEN_AUTOMATICO: false,

  // "Más vendidos" siempre muestra 6. Si se agota alguno y la fila queda con menos, se llena con
  // estos productos (en este orden), AUNQUE estén agotados o en restock: así la gente puede
  // dejar su "Avísame". Hoy hay 6 disponibles, así que esto no se nota hasta que se agote uno.
  MAS_VENDIDOS_RELLENO: ['Anillos Demon & Angel Wings Duki', 'Collar Phantom Star'],

  // Al entrar, cada categoría que tenga algo disponible abre como si ya hubieran tocado
  // "Ocultar agotados" (el botón "Ver agotados" los muestra). Pedido de Alberto el 11-nov-2026
  // porque hay poco stock y se veían más agotados que productos. Cuando llegue mercadería,
  // poner false. Una categoría sin NADA disponible sigue mostrando todo (para no quedar vacía).
  OCULTAR_AGOTADOS_AL_ENTRAR: true,

  // Dónde va la sección de Promociones cuando hay combos activos:
  // 'primero' (arriba de Más vendidos) o 'despues-de-mas-vendidos'.
  PROMOS_POSICION: 'despues-de-mas-vendidos',

  // Minutos que la cuenta de una promo se queda en 00:00:00 ("Promo terminada")
  // antes de que desaparezca todo lo de promos.
  PROMO_GRACIA_MIN: 5,

  // Textos de la sección de promos. Título vacío = "Promociones" de siempre. Combos con el
  // Demon Cross desde el 9-nov-2026. Si hay una campaña con tema (Halloween, Black Friday),
  // se ponen aquí su título, etiqueta y botón.
  PROMOS_TITULO: '',
  PROMOS_ETIQUETA: '',                           // arriba del título al abrir un combo (vacío = "Promoción")
  PROMOS_HERO: '',                                // botón grande del inicio (vacío = "🔥 Promos disponibles")
  PROMOS_HERO_SUB: 'Combo cinturón premium + collar con envío gratis desde S/79',    // primera parte de la línea de abajo del botón (vacío = solo la fecha)
  PROMOS_SUBTITULO: 'Envío gratis en estos combos. Toca un combo para ver las fotos y videos de cada producto y agrégalo al carrito: el precio de la promo se aplica solo.',

  // Solo para la página de PRUEBAS: muestra las promos aunque todavía no llegue su
  // fecha de inicio ("Desde" en promos.csv). En el catálogo real va en false.
  VER_PROMOS_ANTES: false,

  // Foto del INICIO por fechas (banners de campaña). Cada una se muestra solo entre sus
  // fechas (hora de Lima) y fuera de ellas vuelve img/inicio.jpg. Imagen CUADRADA (1080x1080),
  // con lo importante al centro y un poco arriba. Si el archivo no existe, no pasa nada.
  // Ejemplo (se agrega cuando el banner esté listo):
  //   {desde: '2026-10-25 00:00', hasta: '2026-10-31 23:59', foto: 'img/promos/hero-halloween.jpg'},
  //   {desde: '2026-11-01 00:00', hasta: '2026-11-0X 23:59', foto: 'img/promos/hero-cyberwow-v2.jpg'},
  // Se usa la PRIMERA de la lista que esté vigente (por eso las más cortas van antes).
  HERO_FOTOS: [
    {desde: '2026-10-25 00:00', hasta: '2026-10-31 23:59',
     foto: 'img/promos/hero-halloween-pc.jpg', fotoCel: 'img/promos/hero-halloween-cel.jpg'},
    // Cyber Wow +1 día: desde el anuncio (viernes 6, 9 pm) dice "Del 02/11 al 07/11".
    {desde: '2026-11-06 21:00', hasta: '2026-11-07 00:00',
     foto: 'img/promos/hero-cyberwow-ext-pc.jpg', fotoCel: 'img/promos/hero-cyberwow-ext-cel.jpg'},
    // Sábado 7: "ÚLTIMO DÍA · HOY 07/11" en rojo.
    {desde: '2026-11-07 00:00', hasta: '2026-11-07 23:59',
     foto: 'img/promos/hero-cyberwow-ultimo-pc.jpg', fotoCel: 'img/promos/hero-cyberwow-ultimo-cel.jpg'},
    {desde: '2026-11-01 00:00', hasta: '2026-11-06 23:59',
     foto: 'img/promos/hero-cyberwow-pc.jpg', fotoCel: 'img/promos/hero-cyberwow-v2.jpg'},
    // Después del Cyber: el logo clásico de Timeless en negro (hasta la próxima campaña).
    {desde: '2026-11-07 23:59', hasta: '2027-12-31 23:59',
     foto: 'img/promos/hero-logo-pc.jpg', fotoCel: 'img/promos/hero-logo-cel.jpg'},
  ],

  // Precios de una CAMPAÑA (Cyber Wow, Black Friday): { desde, hasta, precios: {'Nombre exacto': precio} }.
  // Del "desde" al "hasta" sale el precio normal tachado + el de campaña; fuera de esas fechas
  // vuelve todo al precio normal. Mientras haya nombres aquí, ESTE precio manda sobre PrecioOferta
  // de productos.csv (aunque la campaña ya haya terminado), por eso entre campañas se deja vacío.
  // Opcional: ampliacion: {anuncio: 'AAAA-MM-DD HH:MM', hasta: 'AAAA-MM-DD HH:MM'} (extiende la
  // campaña desde esa hora). El Cyber Wow (2 al 7 de noviembre de 2026) ya terminó: vacío.
  CAMPANA_PRECIOS: {desde: '', hasta: '', precios: {}},

  // Botón azul del inicio mientras dura el Cyber Wow (sale cuando no hay combos de promos).
  CAMPANA_HERO: {desde: '2026-11-01 00:00', hasta: '2026-11-06 23:59',
    titulo: '⚡ CYBER WOW', sub: 'Hasta -20% de descuento · Del 2 al 6 de noviembre', boton: 'Ver catálogo →',
    ir: 'cat-mas-vendidos', eyebrow: 'Cyber Wow 2026',
    etapas: [
      {desde: '2026-11-06 21:00', hasta: '2026-11-07 23:59', sub: '¡1 día más! · Hasta -20% · Del 2 al 7 de noviembre'},
      {desde: '2026-11-07 00:00', urgente: true, titulo: '⚡ CYBER WOW · ÚLTIMO DÍA', sub: 'Hasta -20% · Solo hoy hasta las 11:59 pm'},
    ]},

  // Lanzamientos programados (NEW DROP). El producto debe estar en productos.csv con
  // Disponible = PRONTO y Visible = SI: antes de "desde" se ve oscuro con las fotos y
  // "Sale hoy a las 6:00 pm", y a esa hora sale solo (la página se recarga sola).
  // Hasta "hasta" lleva la etiqueta NEW DROP (vacío = 7 días).
  LANZAMIENTOS: {
    'Cinturón Black Cross Deluxe': {desde: '2026-10-29 18:00', hasta: '2026-11-05 23:59'},
  },

  // Etiqueta roja temporal sobre un producto, solo entre sus fechas (hora de Lima).
  // Sábado 7-nov: último día del Cyber Wow en el Dark Knight. Se apaga sola a las 11:59 pm.
  ETIQUETAS_TEMP: {
    'Cinturón Dark Knight': {texto: 'ÚLTIMO DÍA DE CYBER', desde: '2026-11-07 00:00', hasta: '2026-11-07 23:59'},
  },

  // Productos que NO muestran "Restock en camino" aunque el dashboard lo diga (salen como Agotado).
  SIN_AVISO_RESTOCK: ['Pant Chain Chrome Hearts'],

  // Botoncito extra al inicio de los avisos del inicio (antes de "Puntos de recojo sin costo").
  // Sale solo hasta "hasta" y mientras el producto esté disponible.
  AVISO_CHIP: {producto: 'Anillos Demon & Angel Wings Duki', texto: 'Volvieron los anillos Duki 🖤', hasta: '2026-11-04 23:59'},

  // Líneas dentro de una categoría (columna "Linea" de la hoja). Se muestran como
  // etiqueta en la tarjeta (con esta descripción al pasar el cursor) y en la ficha.
  LINEAS: [
    {clave: 'Premium', titulo: 'Línea Premium',
     descripcion: 'Hechos de eco cuero, con un dije más llamativo y aleación con recubrimiento de alta calidad.'},
  ],

  // Orden en que aparecen las categorías. Si en la hoja aparece una categoría
  // que no está en esta lista, igual se muestra, al final.
  CATEGORIAS: ['Cinturones', 'Collares', 'Anillos', 'Pant chains', 'Lentes'],

  // Frase con la que cierra cada categoría y cada ficha (la misma del Canva).
  FRASE_TALLA: '¿No sabes si te queda? Escríbenos por DM y te ayudamos a elegir tu talla',

  // "¿Cómo saber tu talla?" de los cinturones (el texto del Canva).
  GUIA_TALLA: [
    'Mide tu cintura en cm (con una cinta, o usa el número de tu pantalón favorito) y compara con el rango en cm de cada cinto. La talla de pantalón es solo referencial 👌',
    'A todos los cintos se les puede hacer huecos extra para cinturas más pequeñas o grandes, preguntando al DM.',
  ],
};
