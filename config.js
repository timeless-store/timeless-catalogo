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

  // Cómo recibe el cliente su pedido. El costo es APROXIMADO: Alberto lo confirma
  // por chat según el distrito. Si el pedido ya tiene envío gratis, todos cuestan 0.
  // "costo" es el número que se suma al total aproximado; "etiqueta", lo que se lee.
  ENVIOS: [
    {id: 'recojo', nombre: 'Recojo en Plaza San Miguel', costo: 0, etiqueta: 'Gratis',
     nota: 'Pagas al recibir (contraentrega). Coordinamos día y hora por chat.'},
    {id: 'moto', nombre: 'Motorizado en Lima', costo: 10, etiqueta: 'desde S/10',
     nota: 'Pagas al recibir (contraentrega). Llega de un día para otro, de 11am a 7pm. El costo exacto depende del distrito.'},
    {id: 'shalom', nombre: 'Shalom — Lima y provincias', costo: 8, etiqueta: 'aprox. S/8',
     nota: 'Pagas el producto antes de enviar (Yape o transferencia) y el envío al recibir. Llega de 1 a 3 días.'},
  ],

  // Líneas dentro de una categoría (columna "Linea" de la hoja). Si ningún
  // producto de la categoría tiene línea, no se muestran los subtítulos.
  // TODO(Alberto): revisar el texto de la línea premium; lo armé con lo que me
  // dijiste (eco cuero, dije más llamativo, aleación de alta calidad).
  LINEAS: [
    {clave: 'Premium', titulo: 'Línea premium',
     descripcion: 'Hechos de eco cuero, con un dije más llamativo y aleación de alta calidad.'},
    {clave: 'Clásica', titulo: 'Línea clásica', descripcion: ''},
  ],

  // Orden en que aparecen las categorías. Si en la hoja aparece una categoría
  // que no está en esta lista, igual se muestra, al final.
  CATEGORIAS: ['Cinturones', 'Collares', 'Pant chains', 'Anillos', 'Lentes'],

  // Frase con la que cierra cada categoría y cada ficha (la misma del Canva).
  FRASE_TALLA: '¿No sabes si te queda? Escríbenos por DM y te ayudamos a elegir tu talla',
};
