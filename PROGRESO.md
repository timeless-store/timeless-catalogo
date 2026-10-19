# Progreso del catálogo web — Timeless Store

**Última sesión:** 8 de octubre de 2026.
**Estado:** en línea (en pruebas, no anunciado) en `timeless-store.github.io/timeless-catalogo` (repositorio: `github.com/timeless-store/timeless-catalogo`). Con los productos del Canva, sin fotos todavía.

---

## 1. Qué hay hecho

- Inicio con presentación, botón "Ver catálogo" y botón "Escríbenos" (WhatsApp).
- Productos por categoría; dentro de cada una van primero los que hay, luego los "Próximamente" y al final los agotados.
- **Cinturones separados en Línea premium y Línea clásica**, con una frase que explica la premium.
- **Variantes de color**: Collar Gengar es un solo producto con selector Morado / Plateado, cada color con su propio agotado y su propia foto.
- **Videos**: en la columna Fotos se pueden poner enlaces a videos (.mp4); salen deslizando junto a las fotos.
- **Próximamente**: estado para lo que aún no llega (hoy el Black Spider). Tiene su propio "Avísame cuando llegue".
- **Etiquetas** Nuevo, Oferta, Próximamente y Agotado; "Envío gratis" por producto.
- **Más vendidos**: fila al inicio; aparece sola cuando marcas productos con BestSeller = SI.
- **Carrito con promociones automáticas** (hoja `promos.csv`): se aplican y se descuentan solas, y salen en el mensaje del pedido.
- **Envío en el carrito**: el cliente elige recojo, motorizado o Shalom (opcional) y ve un costo aproximado. Si el pedido tiene envío gratis, todo cuesta 0.
- "Avísame cuando vuelva" solo en agotados, por WhatsApp o Instagram.
- Envíos y pagos al final, botón de Instagram y TikTok, Libro de Reclamaciones provisional.
- **Fotos reales** en `fotos/<producto>/` (29 de 36 productos al 18 de octubre): primero las de persona, luego maniquí, luego mesa o en mano; los videos al final y siempre sin sonido.
- Se puede instalar en el celular. Versión del caché: `timeless-catalogo-v12`.

## 2. Las hojas

**`productos.csv`** — columnas, en este orden:
`Producto` · `Categoría` · `Precio` · `PrecioOferta` · `OfertaHasta` · `Disponible` · `Fotos` · `Descripción` · `Tallas` · `Nota` · `Nuevo` · `EnvioGratis` · `Grupo` · `Variante` · `BestSeller` · `Linea`

- **Disponible:** `SI`, `NO` (agotado) o `PRONTO` (todavía no llega).
- **Nuevo, EnvioGratis, BestSeller:** `SI` o vacío.
- **Grupo y Variante:** para juntar productos en uno con colores. Dos filas con el mismo Grupo ("Collar Gengar") y distinta Variante ("Morado", "Plateado"). La primera foto de la primera fila es la de portada: ahí va la que muestra ambos colores.
- **Linea:** `Premium` o `Clásica` (solo se usa en cinturones).
- **Fotos:** enlaces separados por coma, fotos y videos mezclados.

**`promos.csv`** — una fila por promoción:
`Nombre` · `Tipo` · `Productos` · `Cantidad` · `Valor` · `Hasta` · `Activa` · `Texto`

- **combo:** lleva todos los productos listados (separados con `|`) por un precio total en `Valor`.
- **paquete:** `Cantidad` unidades del alcance por `Valor` total (ej. 3 por S/110).
- **descuento:** por cada `Cantidad` unidades del alcance, se descuenta `Valor` soles.
- **Productos:** nombres separados con `|`, el nombre de un grupo ("Collar Gengar" cuenta ambos colores) o `categoria:Collares`.
- **Activa:** `SI` / `NO`. **Hasta:** fecha y hora de fin, opcional.
- **Texto:** lo que se muestra en la ficha del producto.
- Una unidad entra en una sola promo (la primera de la lista), para que los descuentos nunca se sumen por error.
- Hoy: combo Dark Knight + Demon Cross a S/60, Ameri Duki 2 por S/75 y 3 por S/110, Gengar 2 por S/55 (se activan cuando haya stock) y "segundo collar −S/5" **apagado** como ejemplo.

## 3. Cómo verlo en la computadora

1. Clic derecho sobre `serve.ps1` (en la carpeta del proyecto) → **Ejecutar con PowerShell**; déjalo abierto.
2. En Chrome entra a `http://localhost:8793`.

## 4. Pendientes de Alberto

1. ~~Organización de GitHub~~ — hecho el 9 de octubre: el catálogo vive en `timeless-store`. (No protege el dashboard; eso va por el chat del dashboard.)
2. **Decir cuáles son tus más vendidos** para armar la fila de Más vendidos.
3. **Fotos y videos** en las carpetas de `Escritorio\Alberto\Timeless\fotos de productos`.
4. **Revisar** el texto de la línea premium y los costos de envío mostrados (motorizado "desde S/10", Shalom "aprox. S/8"): están en `config.js`.
5. **Avisar** cuando cambies el usuario de Instagram/TikTok y cuando llegue el Black Spider.
6. **Libro de Reclamaciones oficial** (el prompt para armarlo lo preparo cuando lo pidas).
7. **Seguridad del dashboard** (chat del dashboard, antes de anunciar).

## 5. Lo que viene

- Productos desde una hoja de Google propia del catálogo (archivo aparte, sin costos). **Bloqueado hasta consultarlo con el chat del dashboard**: el Sheets de ventas es privado y no se lee desde afuera (regla del 17 de octubre). Por eso el agotado automático desde el stock tampoco se arma por ahora; mientras tanto, Alberto marca NO en `productos.csv` (me lo dice y lo cambio yo).
- Contador de visitas (GoatCounter) y medir cuántos tocan "Cerrar pedido" y "Avísame cuando vuelva". Antes de anunciar, no ahora.
- Banner / logo más profesional (cuando Alberto tenga el material actualizado).
- Revisión de seguridad completa y quitar el `noindex` antes de anunciar.
- Prompt para el Libro de Reclamaciones.

## 6. Decisiones y avisos importantes

- **Este repositorio es público.** No va nada interno del negocio (costos, márgenes, traspaso, enlaces del dashboard).
- **El Sheets de ventas es privado (regla fija del 17 de octubre de 2026):** nunca se publica ni se lee desde el catálogo.
- **Instagram y TikTok** usan `timeless.store._` hasta que Alberto avise el cambio.
- **Oferta sin fecha = permanente; fecha mal escrita = sin oferta** (también en las promos).
- **El costo de envío del carrito es aproximado**; la página lo dice y el valor exacto se confirma por chat. Si el pedido lleva un producto con envío gratis, todo es gratis.
- **Un agotado no muestra "Nuevo" ni "Oferta"**; un "Próximamente" tampoco.
- Los productos de las páginas ocultas del Canva están como agotados; Bullcore y White Chrome Hearts no están.

**Recordatorio técnico:** en cada cambio hay que subir el número de `timeless-catalogo-vN` en `service-worker.js`.

## 7. Actualización del 18 de octubre

- **Lista de productos según `Inventario Timeless.xlsx` (hoja Stocks)**: 36 productos. Se agregaron Black Cross Deluxe (Próximamente), White Chrome Hearts, Bullcore, Murciélago v2, Collar Angel y Demon Wings Duki y Lentes Chrome Hearts. No van "Collar punk" ni "Collar demon wings duki" (descontinuados).
- **Disponible según el stock de ese día**: pasaron a disponibles Black Spider (llegó), Cinturón Chrome Hearts, Collar Gothic Cross y Collar de Púas Punk; pasaron a agotados White Cross Deluxe, Pant Chain Spiderboy y Anillos Duki.
- Del Excel solo se leyeron nombre, precio de venta y stock. Nada de costos.
- Decisiones de Alberto (18 oct): Bullcore y White Chrome Hearts descontinuados para siempre (fuera del catálogo). Lentes Chrome Hearts fuera hasta que él lo pida. **Recordarle al terminar de pulir**: revisar qué productos se muestran (por ejemplo, el Collar Murciélago v2 no lo quiere visible, pero se guarda por si vuelve).

## 8. Envíos, materiales y orden (18 de octubre, tarde)

- **Columna `Visible`** en `productos.csv`: con `NO` el producto no sale en la página (hoy: Black Cross Deluxe, hasta que Alberto lo anuncie con teasers). El Collar Murciélago v2 salió del archivo.
- **Columnas `Material`, `Coleccion` y `Cuidado`**: etiquetas "Acero inoxidable" / "Acero 316L" / "Drop Duki" y nota de cuidado en los de aleación.
- **Cinturones juntos** (sin separar Premium/Clásica): disponibles primero, en el orden del archivo. La Línea Premium sale como etiqueta, con su explicación al pasar el cursor y dentro de la ficha.
- **Variantes**: Black & White Spider e Iced Y2K (Silver/Black) son una sola ficha con selector de color.
- **Más vendidos**: la columna `BestSeller` lleva el puesto (1, 2, 3…).
- **Envíos**: 4 opciones (recojo, delivery con cotizador por distrito, InDrive, Shalom) que salen de `config.js`; el carrito pide los datos de cada una y muestra el Yape cuando toca adelantar algo. Los datos del cliente no se guardan: solo viajan en el mensaje.
- **Franja de campañas** (Cyber Wow, Black Friday): `FRANJA` en `config.js`. Vista de prueba: agregar `?franja=prueba` al link.
- **Logo**: ícono de pestaña, ícono de la app y vista previa al compartir, sacados de una copia de "Bolsas de plástico 2026" (el original no se tocó). Copias del logo en la carpeta Branding.
- **Fotos**: lo suelto en la carpeta de un producto va a la web; las subcarpetas (otras versiones) no. Excepción temporal: Cemetery Cross usa de portada la foto 2 de "Versión 2".

## 9. Ajustes del 18 de octubre (noche)

- `Disponible` acepta también **POCOS** ("Quedan pocos") y **RESTOCK** ("Restock en camino": agotado pero ya pedido).
- **Más vendidos**: lista del chat del dashboard (últimos 60 días); se muestran hasta 10 disponibles y un agotado deja su lugar al siguiente.
- **Colores**: si hay foto de todos juntos, una sola tarjeta; si no, una tarjeta por color, cada una con sus fotos y el selector para pasar al otro.
- **Oferta en agotados**: como máximo 2 días; después vuelve a su precio normal. El envío gratis sí se muestra en agotados.
- **Instagram**: el botón del carrito abre directo el chat de la tienda.
- Envíos en dos columnas (InDrive debajo de Recojo); fotos de tarjetas siempre cuadradas.

## 10. Lista automática del dashboard (18 de octubre)

- La página lee la **lista pública del dashboard** (`CSV_ESTADO` en `config.js`): una hoja aparte con solo nombre, estado y puesto de best seller. El Sheets de ventas sigue privado. Esa lista manda sobre `Disponible` y `BestSeller`; si no carga, se usa la última guardada o `productos.csv`.
- Columna **`NombreInventario`** para los nombres distintos al inventario (Púas Punk y el par de anillos, que en el inventario son dos filas: se vende el par, así que vale el estado más bajo de las dos).
- Un teaser a mano (`Disponible` = PRONTO y `Visible` = SI) se muestra aunque la lista diga "oculto".
- **Más vendidos**: máximo 6; los que tienen "Restock en camino" se quedan con esa etiqueta.
- Un agotado no muestra una oferta sin fecha de fin.
- En PC, las fotos de cada tarjeta van cambiando al pasar el cursor.

## 11. Promos, preguntas frecuentes y diseño (18 de octubre, noche)

- **Promociones**: los combos activos de `promos.csv` salen en su propia sección (arriba de todo; se mueve con `PROMOS_POSICION` en `config.js`), con un botón llamativo en el inicio y "🔥 Promos" en el menú. En un combo, `A/B` = "A o B": el cliente elige el color del cinturón y el collar o pant chain; lo agotado sale tachado y, si un casillero se queda sin opciones, el combo dice "Agotado: mira los otros combos". El descuento lo aplica el carrito. Hoy: los 3 combos araña del Canva, hasta el 20-oct a las 23:59. Las promos viejas quedaron apagadas.
- **Olva Courier** como quinta forma de envío (paga productos antes; el envío se cotiza por chat).
- **Datos del envío opcionales** en el carrito.
- "Quedan pocos" ahora dice **"Últimas unidades"**. Aviso "!" cuando el envío gratis puede no cubrir todo. Nota en "Avísame por Instagram" sobre cambiar de usuario.
- **Preguntas frecuentes** (tiempos, pagos, separar, tallas, materiales, cambios, fallas, envío gratis).
- **Acento azul**, logo en la cabecera, **pantalla de carga negra con el logo**, íconos con la T más grande.
- **Libro de Reclamaciones**: datos del proveedor listos; falta el link del Google Forms (`LIBRO_RECLAMACIONES_FORM`).
- **Arma tu combo** (18-oct): cada combo muestra la foto del Canva (`Foto` en promos.csv, archivos en `img/promos/`) y abre su hoja: el cliente elige el color y el collar, ve las fotos y videos de lo elegido, y lo agrega con un toque. El combo de pant chain es solo con la Skeleton.

## 12. Correcciones desde PC (18 de octubre, noche)

- Combos: al abrirlos no hay nada elegido (se ve la foto completa del combo); al elegir, aparecen TODAS las fotos y videos de ese producto, sin recortes. Si un casillero tiene una sola opción, va elegida sola. Un combo que no se puede armar va al final.
- Cuenta regresiva en rojo cuando quedan menos de 24 horas.
- "Escríbenos" deja elegir WhatsApp o Instagram (Instagram abre directo el chat).
- La página siempre empieza arriba al entrar.
- Sección **Clientes** (carrusel que gira solo hacia la derecha; fotos en `CLIENTES_FOTOS` de `config.js`).
- Preguntas frecuentes: textos corregidos (cambios en 48 horas, vuelto, huecos, envío gratis) y una abierta a la vez.
- **Azul marino**; títulos con letra gótica (Grenze Gotisch) y texto en Montserrat (la del logo).
- Pant chains: "Aleación reforzada de alta calidad". Collares agotados en el orden de Alberto.

## 13. Correcciones desde celular (19 de octubre)

- Vuelve la letra de antes (sin Grenze/Montserrat).
- Libro de Reclamaciones conectado (Google Forms). Estadísticas con GoatCounter (timeless.goatcounter.com): visitas, productos vistos, carrito, "Avísame", combos y pedidos cerrados.
- Video de collares de fondo en el inicio (`img/inicio-collares.mp4`, 0.8 MB).
- Envíos: recojo, delivery, Shalom (con nota de Olva por chat), InDrive (Lima, se cotiza primero). Olva ya no es opción.
- "Cubre hasta S/16" solo aparece si el distrito elegido puede costar más. En el carrito: "Envío gratis aplicado" y el precio normal tachado.
- Carrito: distritos en lista desplegable, datos del envío plegados (el pago Yape/efectivo va dentro), tocar otra vez una opción la des-elige, "no hacemos envíos domingos ni feriados".
- Ficha: "− cantidad +" al agregar (máx. 10, "sujeto a disponibilidad"), sin saltar arriba; botón amarillo de restock; empaque (cajita premium / bolsa Ziploc); explicación del 316L; "Escríbenos por DM" con WhatsApp o Instagram; aviso de conexión lenta.
- "?" centrado en celular y se cierra al tocarlo de nuevo. Botones de Escríbenos más chicos.

## 14. Orden automático, foto del inicio y clientes (19 de octubre)

- **Orden automático**: la lista del dashboard trae "Orden" (qué tan rápido se vende cada producto en su categoría). Dentro de cada categoría: disponibles, restock y agotados, y en cada grupo el que más rápido se vende primero. Se apaga con `ORDEN_AUTOMATICO: false`.
- **Inicio**: foto de Cemetery Cross, Starglow y Collar Chrome Hearts (`img/inicio.jpg`) con degradado morado → negro: a la izquierda en PC y arriba en celular. Se quitó el video.
- **Clientes**: 13 capturas de chats recortadas a 3:4 (solo lo que escribió el cliente), en `img/clientes/`. Originales en Escritorio\Alberto\Timeless\Clientes.
- Combo Spider + Pant Chain Spiderboy (agotado: lleva a los otros combos). Link a Plaza San Miguel en el mapa. 316L: "El acero inoxidable más resistente".
- El menú de atajos marca solo la sección en la que estás.
- (19-oct, más tarde) El **orden automático queda APAGADO**: Alberto ordena a mano y avisa cuándo usar el del dashboard. Foto del inicio cambiada por una foto general de varios productos (para que no pregunten por uno en particular). "Agotado" sobre la foto del combo agotado. Carrusel de clientes: avanza de la 1 a la 13 y vuelve a empezar, con fotos de tamaño fijo.
- (19-oct) Inicio en PC: la foto completa a la izquierda y el degradado empieza donde ella termina. Carrusel de clientes 1.5x más rápido y retoma a los 1.5 s. El vuelto en el recojo "se coordina por chat" en todas partes.
- **Revisión final antes de publicar** (19-oct): sin costos ni claves en el repositorio; 142 archivos (fotos, videos, íconos) cargan; 29 fichas sin textos raros; los 4 envíos probados en celular sin que nada se salga del recuadro; sin errores en la consola.

## 15. Lanzamiento (19 de octubre)

- **Ya no está oculto de Google** (se quitó el `noindex`); se agregaron `sitemap.xml`, datos de la tienda para Google y la dirección principal.
- En la ficha, la palabra **"Combo"** (subrayada) abre el combo; en él, la flecha "← producto" vuelve a la ficha y la ✕ cierra todo.
- Cuando no hay promos activas se oculta TODO lo de promociones (sección, botón del inicio, atajo del menú y los textos de envíos y preguntas).
- **Distrito**: se escribe y salen sugerencias; la flechita ▾ muestra todos y se cierra al tocarla de nuevo.
- **Día de entrega**: botones por día (mañana a 7 días, sin domingos); nada viene marcado y se puede quitar tocándolo de nuevo. **Pago del producto** (Yape/efectivo): sin marcar y se puede quitar.
- **Ubicación** (delivery e InDrive): por defecto "te la mando por WhatsApp"; o pegar un link de Google Maps.
- Al enviar el pedido se pregunta "¿Ya lo enviaste?" y ofrece vaciar el carrito (no se vacía solo, por si el cliente no llegó a enviarlo).

## 16. Pulido final (19 de octubre)

- Inicio en PC: negro junto a la foto y morado al final; una copia borrosa de la foto la funde con el oscuro.
- Delivery/InDrive en San Miguel, Magdalena, Pueblo Libre o Callao: sugiere recojo sin costo o InDrive (marcados con `cerca: true` en `config.js`). InDrive también pide el distrito.
- Al volver del Libro de Reclamaciones, el catálogo vuelve al mismo lugar.
- Los atajos dejan ver el título de la sección (la cabecera ya no lo tapa). "Ver catálogo" baja a Más vendidos.
- Fotos: "Cargando foto…" hasta que están completas; "conexión lenta" a los 5 s; si fallan, un reintento y luego el aviso.
- Zoom: la página no hace zoom (ni doble toque ni pellizco); solo las fotos de la ficha: pellizco hasta 5x o botón + (2x), y se mueven con el dedo.
- Videos de la ficha: se reproducen solos al llegar, se pausan al tocarlos (aparece la barra de tiempo) y tienen fondo borroso (archivo `-fondo.jpg` que crea el script de fotos).
- Filtro por categoría: "En stock" (verde) y "Agotados" (rojo, se apaga → "Ver agotados").
- "¿No sabes si te queda?" solo en cinturones y anillos. Se quitó "Te ayudamos a elegir tu talla".
- Combos: videos verticales a su propio tamaño, sin franjas negras.
- "Últimas unidades" en rojo. Botones con efecto al presionar. Las tarjetas aparecen al bajar.
- Preguntas frecuentes: fallas dentro de 48 h (obligatorio) y daños por mal uso no aplican; InDrive también puede salir con envío gratis (se cotiza).
