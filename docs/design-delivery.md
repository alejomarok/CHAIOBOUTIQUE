# CHAIOBOUTIQUE — renovación visual

## Propuesta

Tienda de moda femenina con una dirección editorial cálida: marfil, tinta y oliva; fotografía de campaña protagonista; Playfair Display para títulos y Geist para navegación y lectura. El colibrí y el archivo original del logo se conservaron. Los iconos de pestaña y acceso móvil derivan del mismo logo.

La dirección Taste seleccionada fue **The object, large** (`hero-object`, seed `1924161757`). Se adaptó la composición a una tienda real con navegación de categorías y productos, conservando la fotografía dominante. La biblioteca Awesome DESIGN.md aportó la referencia de superficies naturales y jerarquía tipográfica de Oura, sin copiar su marca ni su interfaz. El panel siguió **Achromatic ledger**, seed `1798749090`.

Idea: la libertad y el movimiento del colibrí original se trasladan al modo de vestir y a una campaña de prendas naturales en movimiento. El recorrido interactivo principal es descubrir la colección, filtrar, elegir talle/color y comprar.

## Implementación

- Home con campaña, novedades reales, categorías administrables y una historia editorial con cuatro fotografías originales generadas para este proyecto.
- Sin fotos de producto inventadas: las imágenes de campaña funcionan como inspiración; las fichas conservan las imágenes reales cargadas por administración. Las novedades sin fotografía se muestran como enlaces con nombre y precio.
- Animaciones breves de entrada y desplazamiento, interacción en controles, imágenes con movimiento inicial suave y preferencia de movimiento reducido respetada. No se incorporó video ni animación continua para mantener una experiencia simple y liviana.
- Encabezado con búsqueda, navegación y carrito; menú móvil con cierre al navegar; enlaces y contactos reales en el pie.
- Íconos de Instagram, Facebook y WhatsApp de 44 px conectados a las cuentas y al teléfono confirmados por el cliente. La sucursal cerrada de Río Tercero queda inactiva y solo se publica Embalse. La migración `20261023120000_update_public_business_details` lleva estos datos a instalaciones existentes; la carga inicial ya no crea Río Tercero.
- Catálogo con paginación que conserva búsqueda, categoría y orden; validación de número de página; selector de variantes accesible incluso con combinaciones dispersas; límite de cantidad alineado al servidor.
- Ficha con galería, controles táctiles de tamaño cómodo y acción de compra visible. Acceso con fotografía editorial y formularios protegidos frente al envío nativo prematuro de credenciales antes de la hidratación.
- Administración con navegación adaptable, estados activos de rutas anidadas, resumen de datos reales, ventas recientes, estado de publicación del catálogo, actualización y accesos según permisos. Los formularios, tablas y diálogos comparten el nuevo tema.

## Recursos

Las cuatro imágenes WEBP de campaña pesan aproximadamente 500 KB en total antes de la optimización de Next Image. Los prompts y archivos están documentados en [design-assets.md](design-assets.md). Se generaron con la herramienta de imágenes integrada. No hay fotografías externas ni nuevos datos comerciales ficticios en el código de producción.

## Verificación

- Compilación de producción, TypeScript y ESLint.
- 478 pruebas unitarias existentes aprobadas, más dos regresiones nuevas de protección de formularios antes de hidratar. Se repitieron también las diez pruebas del acceso tras el cambio compartido.
- Nueve pruebas de integración de configuración y sucursales aprobadas con PostgreSQL local.
- Última ejecución de navegador: 12 pruebas aprobadas y una intermitente aprobada al reintentar, entre clientes, publicación completa de producto y pie adaptable. El primer intento de publicación agotó la espera de navegación durante la compilación local; el reintento completó categoría, precio, variantes, stock, imagen, publicación y aparición en catálogo. El recorrido de pago aprobado/rechazado y su vista móvil también se verificaron con proveedor simulado en la ejecución anterior con Webpack.
- Revisión visual de home en 1440, 768, 390 y 320 px; galería y carrito en móvil; preferencia de movimiento reducido.
- Revisión del panel en 1440 y 390 px: navegación, actualización, lista de productos, formulario sin guardar, menú móvil y menú de cuenta; sin desbordes ni errores de ejecución.
- El inspector de diseño aprobó los tres tamaños requeridos sin errores bloqueantes. Las observaciones de estilo aceptadas son el fondo marfil de baja saturación, una escala de tamaños que contempla controles de comercio y la ausencia intencional de video. El contraste del texto sobre fotografía se revisó visualmente porque su medición automática asume un fondo plano.
- La comprobación final de contactos pasó en 1440, 768, 390 y 320 px: URLs exactas, controles de 44 px, solo Embalse, menú móvil funcional y cero errores de ejecución. Se archivaron los ocho productos propios de prueba, se ocultaron las tres categorías propias de prueba y se desactivó la cuenta temporal; se conservaron los 76 productos previos.

La aplicación Next.js existente requiere JavaScript para el comercio y el contenido transmitido por streaming. Las animaciones se implementaron como mejora progresiva y no como requisito para revelar contenido tras la hidratación.

Las comprobaciones con base de datos se ejecutaron con PostgreSQL local y proveedores de pago/almacenamiento simulados. No se publicó un despliegue ni se modificaron datos de producción. Antes de publicar se debe aplicar la migración nueva en el entorno de destino. Los archivos de capturas y herramientas temporales de verificación se guardan en `.taste-skill/`, excluido de Git.

En Windows se configuró Webpack para desarrollo y pruebas de navegador: durante la verificación, Turbopack de Next 16.2.11 omitió rutas anidadas de edición y retorno de pago. Las mismas rutas respondieron correctamente con Webpack. La compilación de producción conserva su configuración original. El diagnóstico de arranque ahora usa la condición positiva `NEXT_RUNTIME === "nodejs"` recomendada por la documentación instalada de Next, para excluir dependencias de Node del paquete Edge.

## Revisión visual

ROUND 1
Seen in one second: boutique de moda con fotografía editorial y una acción de colección clara.
Idea (one sentence): el movimiento del colibrí se convierte en libertad para vestirse.
Live thing: catálogo real, filtros, selección de variantes y carrito.
Layout words by section: hero=fotografía dominante / novedades=selección real / categorías=exploración visual / esencia=mosaico editorial / cierre=servicio y contacto.
Scores: design 7.5 · usability 8.0 · creativity 6.5 · content 7.0 → overall 7.4
Caps applied: creatividad contenida por un recurso editorial reconocible en otras boutiques; falta de fotos reales de algunos productos en los datos de prueba.
Top three problems (most visible first), each with the screenshot it shows in and the fix:

1. `desktop-fold.jpg`: el recorte inicial cortaba el rostro; se ajustó la posición vertical de la fotografía.
2. `home-full-390.png`: imágenes faltantes de productos/categorías dominaban la pantalla; novedades sin foto pasan a enlaces de producto y categorías usan inspiración de campaña cuando el administrador no cargó una imagen.
3. `mobile-page-01.jpg`: texto secundario demasiado suave en la sección editorial; se cambió a la tinta de primer plano y se incorporó una cuarta imagen de detalle.

ROUND 2
Seen in one second: fotografía, identidad existente y colección en una composición simple y cálida.
Idea (one sentence): vestir a tu manera conecta la campaña en movimiento con la elección real de prendas.
Live thing: compra real mediante catálogo y carrito, con un panel que permite gestionar esa selección.
Layout words by section: hero=campaña / novedades=compra / categorías=descubrimiento / esencia=textura y movimiento / cierre=contacto real.
Scores: design 8.0 · usability 8.5 · creativity 7.0 · content 8.0 → overall 8.0
Caps applied: creatividad limitada a 7 por compartir el lenguaje editorial de la categoría; no se presenta la autoevaluación como una validación externa.
Top three problems (most visible first), each with the screenshot it shows in and the fix:

1. No se detectan problemas nuevos bloqueantes en las capturas finales.
2. Algunas prendas del catálogo no tienen fotografías reales cargadas; se conserva un estado de imagen faltante en la ficha, sin inventar la apariencia del artículo.
3. Las redes confirmadas ya están configuradas y siguen siendo editables desde administración; en una instalación sin configuración los íconos no abren enlaces ficticios.
