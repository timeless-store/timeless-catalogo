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
    activa: false,
    texto: 'CYBER WOW · Descuentos de hasta 20% · Del 4 al 6 de noviembre',
    desde: '2026-11-04 00:00',
    hasta: '2026-11-06 23:59',
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
  // zona; "h48" = llega en 48 horas; "nota" se muestra al cliente.
  // Lo que pasa de S/15 muestra a Shalom como opción recomendada.
  DISTRITOS: [
    {n: 'San Isidro', min: 10}, {n: 'Lince', min: 10}, {n: 'Jesús María', min: 10},
    {n: 'Pueblo Libre', min: 10}, {n: 'Breña', min: 10},
    {n: 'San Miguel', min: 10}, {n: 'Magdalena del Mar', min: 10, alias: ['magdalena']},
    {n: 'Cercado de Lima', min: 10, alias: ['lima', 'cercado', 'lima cercado']},
    {n: 'Surquillo', min: 10}, {n: 'Santiago de Surco', min: 10, alias: ['surco']},
    {n: 'Miraflores', min: 10}, {n: 'San Luis', min: 10}, {n: 'La Victoria', min: 10}, {n: 'San Borja', min: 10},
    {n: 'San Martín de Porres', min: 10, max: 15, nota: 'Oquendo (zona alejada): S/15', alias: ['smp']},
    {n: 'Comas', min: 10}, {n: 'Los Olivos', min: 10}, {n: 'Independencia', min: 10},
    {n: 'Chorrillos', min: 10}, {n: 'Barranco', min: 10},
    {n: 'Villa María del Triunfo', min: 13, max: 16, nota: 'José Gálvez: S/16', alias: ['vmt']},
    {n: 'San Juan de Miraflores', min: 13, alias: ['sjm']}, {n: 'Villa El Salvador', min: 13, alias: ['ves']},
    {n: 'San Juan de Lurigancho', min: 13, alias: ['sjl']}, {n: 'El Agustino', min: 10}, {n: 'Rímac', min: 10},
    {n: 'La Molina', min: 10, max: 18, nota: 'Hasta Sol de La Molina: S/10 · Musa: S/18'},
    {n: 'Ate', min: 10, max: 18, nota: 'Huaycán: S/18 · Santa Clara: S/16', alias: ['ate vitarte', 'vitarte']},
    {n: 'Santa Anita', min: 10},
    {n: 'Callao', min: 10, max: 16, nota: 'Hasta Óvalo 200 Millas: S/10 · Oquendo: S/15 · Márquez: S/16'},
    {n: 'Bellavista', min: 10}, {n: 'Carmen de la Legua', min: 10}, {n: 'La Perla', min: 10}, {n: 'La Punta', min: 15},
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
     texto: 'En Plaza San Miguel o en Av. La Paz cdras. 6–8, San Miguel. Coordinamos el día y la hora por chat.'},
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

  // Estadísticas (GoatCounter, sin cookies): https://timeless.goatcounter.com
  // Vacío = no se cuenta nada.
  GOATCOUNTER: 'timeless',

  // Fotos de clientes con sus pedidos (carrusel "Clientes"). Ej: 'img/clientes/1.jpg'.
  // Vacío = la sección dice "Muy pronto".
  CLIENTES_FOTOS: [],

  // Dónde va la sección de Promociones cuando hay combos activos:
  // 'primero' (arriba de Más vendidos) o 'despues-de-mas-vendidos'.
  PROMOS_POSICION: 'primero',

  // Líneas dentro de una categoría (columna "Linea" de la hoja). Se muestran como
  // etiqueta en la tarjeta (con esta descripción al pasar el cursor) y en la ficha.
  LINEAS: [
    {clave: 'Premium', titulo: 'Línea Premium',
     descripcion: 'Hechos de eco cuero, con un dije más llamativo y aleación con recubrimiento de alta calidad.'},
  ],

  // Orden en que aparecen las categorías. Si en la hoja aparece una categoría
  // que no está en esta lista, igual se muestra, al final.
  CATEGORIAS: ['Cinturones', 'Collares', 'Pant chains', 'Anillos', 'Lentes'],

  // Frase con la que cierra cada categoría y cada ficha (la misma del Canva).
  FRASE_TALLA: '¿No sabes si te queda? Escríbenos por DM y te ayudamos a elegir tu talla',

  // "¿Cómo saber tu talla?" de los cinturones (el texto del Canva).
  GUIA_TALLA: [
    'Mide tu cintura en cm (con una cinta, o usa el número de tu pantalón favorito) y compara con el rango en cm de cada cinto. La talla de pantalón es solo referencial 👌',
    'A todos los cintos se les puede hacer huecos extra para cinturas más pequeñas o grandes, preguntando al DM.',
  ],
};
