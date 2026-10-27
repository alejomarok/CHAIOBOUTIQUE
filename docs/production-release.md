# Publicación y operación de CHAIOBOUTIQUE en Vercel

Actualizado: 23/10/2026. Este documento prepara la entrega; no acredita un despliegue ni una transacción real.

## Datos del negocio

Titular confirmado: **SILVINA IVANA DANI**. Sucursal vigente: Av. Pistarini 141, Embalse, Córdoba. WhatsApp: +54 9 3571 31-9469. Redes configuradas en el pie de página. **CUIT y correo comercial pendientes de la titular**: cargarlos en Configuración antes de abrir al público. Revisar con la titular las políticas publicadas, cobertura, tarifas, plazos y procedimiento de atención.

Las imágenes generadas del home son campaña editorial. Las fichas necesitan fotos reales de las prendas, variantes, precios y existencias revisados. No usar productos de prueba como catálogo comercial.

## Entornos y primera publicación

1. Crear proyectos y bases separados para ensayo y producción. La vista previa de una rama nunca debe compartir base, claves de pago, correos reales ni archivos con producción. Mantener los previews protegidos en Vercel.
2. Configurar Node 22.14 o una versión posterior compatible de la línea 22 y elegir una región de funciones cercana a la base Supabase. Instalar con el archivo de bloqueo. La compilación utiliza `npm run build`; no modifica el esquema ni carga datos comerciales.
3. Configurar en Vercel las variables de `.env.example`. `BETTER_AUTH_URL` y `NEXT_PUBLIC_APP_URL` deben identificar el mismo dominio HTTPS final. No usar la URL cambiante de cada preview como identidad de la tienda de producción.
4. Generar claves aleatorias independientes para `BETTER_AUTH_SECRET` (32 caracteres o más), `DATA_ENCRYPTION_KEY` (32 bytes representados por 64 caracteres hexadecimales) y `CRON_SECRET` (recomendado 32 caracteres o más). Mantenerlas en el gestor de secretos, nunca en Git, capturas, tickets ni variables `NEXT_PUBLIC_`. La clave de cifrado es persistente: perderla impide recuperar enlaces y mensajes ya guardados; rotarla exige una migración de recifrado.
5. Aplicar las migraciones contra el destino revisado con `npm run prisma:migrate:deploy`. Usar `DIRECT_URL` para migraciones y la conexión de aplicación adecuada para `DATABASE_URL`. Confirmar proyecto, entorno y copia previa antes de cualquier cambio remoto. La versión requiere `20261023170000_restrict_direct_data_access`. Esta migración protege las tablas con RLS y revoca el acceso de la API pública; la conexión Prisma debe ser la del propietario de las tablas o de un rol de servidor configurado expresamente. No crear políticas públicas para estas tablas: el catálogo también se consulta a través de Next.js. Ver [RLS de Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security).
6. Ejecutar `npm run prisma:seed` en ese mismo destino. El seed crea roles, permisos, depósito predeterminado, cuenta de sistema y configuración real inicial; no agrega un catálogo ficticio. `INITIAL_ADMIN_NAME/EMAIL/PASSWORD` crean el administrador inicial; usar credenciales fuertes, comprobar el acceso y retirar estas tres variables del alojamiento luego del alta. Reejecutar el seed no pisa configuraciones existentes.
7. Crear/verificar el bucket de imágenes `product-images`, sus permisos y los límites de carga. La clave de Supabase permanece en servidor. Probar carga y lectura desde el dominio final.
8. Completar Configuración y abrir `/admin/settings/production`. También puede ejecutarse `npm run preflight:production` desde un entorno confiable con las variables del destino. Es una inspección sin escrituras; devuelve código de error mientras existan pendientes. No copiar variables de producción al directorio de pruebas.

La integración Git de Vercel puede generar previews. `.github/workflows/verify.yml` verifica código, pruebas y compilación en servicios descartables sin secretos reales y sin publicar. Exigir ese control en la rama de lanzamiento y configurar los controles de despliegue de Vercel; crear el archivo no activa por sí solo la protección de ramas. No publicar automáticamente antes de completar la aceptación.

## Reservas, correos y tareas programadas

El proyecto usa Vercel Hobby. `vercel.json` no incluye un cron cada cinco minutos porque ese plan rechaza el despliegue antes de compilar. El mantenimiento se programa en Supabase con `pg_cron` y `pg_net`, y llama por POST a `/api/internal/expire-stale-orders`. El endpoint acepta `CRON_SECRET` o `INTERNAL_TASK_SECRET` como bearer; no admite llamadas sin secreto.

Preparación: `npx tsx scripts/setup-supabase-maintenance.ts --app-url https://DOMINIO` toma el secreto del entorno y crea el job desactivado. No pasar claves por argumentos. Después de comprobar el despliegue, repetir con `--activate`. El secreto y la URL se guardan en Supabase Vault; el comando visible del job solo contiene sus nombres. Las extensiones y Vault requieren permisos del propietario del proyecto. Confirmar el destino antes de ejecutar.

Verificar cada cinco minutos que se libera stock reservado y se entregan correos; revisar `cron.job_run_details` y las respuestas de `net._http_response`. La ejecución SQL exitosa por sí sola no prueba que la respuesta HTTP sea 200. Una reserva dura 20 minutos; un cron diario no sirve. No es necesario cambiar a Vercel Pro para este esquema. Si se cambia de programador, desactivar primero el anterior para evitar trabajos duplicados.

La confirmación del pedido, del pago, de entrega, del ajuste financiero y de solicitudes queda en una cola persistente. El texto que contiene enlaces privados se cifra; los eventos son idempotentes. `after()` intenta entregar algunos mensajes al finalizar la respuesta y el mantenimiento retoma lo pendiente. Si un proceso muere, otro recupera el trabajo al vencer su bloqueo. El envío SMTP es al menos una vez: un corte después de aceptar el correo puede ocasionar un duplicado; se conserva un Message-ID estable. Los mensajes que agotan reintentos aparecen en Configuración → Preparación para publicar; corregir el proveedor y usar “Reintentar correos fallidos”.

Usar un SMTP real con dominio verificado, SPF, DKIM y DMARC configurados según su proveedor. STARTTLS/TLS es obligatorio para el relay externo en producción. Probar recepción en varias casillas; que el SMTP acepte el mensaje no demuestra llegada a la bandeja. El correo comercial recibe avisos del negocio cuando se completa `publicEmail`. Nunca reenviar enlaces privados del cliente en alertas o logs.

## Pago, entrega y posventa

Configurar credenciales de Mercado Pago de **PRODUCTION**, firma de notificaciones y la URL HTTPS de `/api/webhooks/mercado-pago`. El regreso del navegador no confirma un cobro. El servidor consulta al proveedor, verifica correlación, moneda e importe y registra venta y salida de stock una sola vez.

Un reembolso parcial/total o contracargo posterior se registra en un historial financiero inmutable. No se vuelve a cobrar automáticamente ni se reintegra stock por una notificación del dinero. Revisar la alerta en el pedido, coordinar con el cliente y registrar la resolución. Efectuar el reintegro de dinero en el panel de Mercado Pago; esta aplicación concilia el resultado, no inicia reembolsos desde un botón. Una devolución física requiere recepción, revisión de las prendas y un ajuste de inventario explícito y auditado. Registrar la nota de crédito fiscal correspondiente en el sistema habilitado.

Desde Pedidos: Pagado → En preparación → Listo para retirar o Enviado → Entregado. En envíos pueden guardarse transportista, número y enlace HTTPS de seguimiento. Cada cambio notifica al cliente. Solo habilitar envío a domicilio después de informar tarifa, códigos postales y plazo real. Sin esos tres datos se ofrece retiro. El servidor rechaza direcciones fuera de cobertura.

Los clientes conservan el enlace privado recibido por correo y pueden recuperarlo en `/recover-order` con número de pedido y email. La respuesta no revela si el pedido existe; el enlace solo se entrega al correo del comprador. Los pedidos anteriores a esta versión, que solo tenían un hash del token, no tienen enlace recuperable y requieren asistencia por el contacto publicado.

## Solicitudes y comprobantes

El “Botón de arrepentimiento” está visible en el encabezado y pie de página. No exige cuenta, contraseña ni motivo; entrega una constancia inmediata y encola un correo. Atender `/admin/requests` diariamente y respetar los plazos legales; responder allí no mueve dinero ni inventario. Conservar la trazabilidad de la atención. Los términos y privacidad aceptados se registran con su versión y fecha en el pedido.

Para el lanzamiento, usar un sistema de facturación legalmente habilitado y registrar cada comprobante desde la venta mediante el flujo Manual/Sistema externo. **ARCA incorporado opera en homologación**; no se habilitó emisión automática fiscal de producción. Completar CUIT, condición fiscal, punto de venta y procedimiento con el responsable contable antes de vender. No confundir pedido, pago o comprobante de prueba con factura válida.

## Respaldos y recuperación

Activar backups de base en el proveedor, definir retención y ejecutar un ensayo de restauración. Los backups de PostgreSQL de Supabase **no incluyen los archivos binarios de Storage**. Mantener copia independiente de imágenes y claves de cifrado.

El script `node scripts/backup-production.mjs` es una herramienta de lectura para un host confiable con `pg_dump` compatible con la versión del servidor. Requiere `DIRECT_URL`, las credenciales de Storage y `BACKUP_DIRECTORY` absoluto **fuera del repositorio**. Exporta base y objetos del bucket configurado, con manifiesto de hashes; conserva una marca `INCOMPLETE` si falla. No incluye la clave de cifrado. El dump y las imágenes contienen información privada: cifrar el volumen/archivo, limitar permisos del sistema operativo (también ACL en Windows), transferir fuera del host y mantener las claves en un depósito separado. No publicar ni adjuntar los backups. El script no activa una programación remota: conectarlo al sistema de backups elegido y alertar por errores. Suspender cambios del catálogo durante la copia o usar una instantánea coordinada para evitar diferencias entre base y archivos.

Ensayo: crear una base/proyecto de recuperación vacío y aislado; verificar hashes del manifiesto; restaurar `database.dump` con `pg_restore --no-owner --no-acl --exit-on-error` usando credenciales por variables de entorno, y volver a cargar cada objeto de `storage/` al bucket conservando nombre y tipo. Verificar políticas del bucket y extensiones del proveedor; no restaurar sobre un proyecto que contenga datos útiles. Usar la misma `DATA_ENCRYPTION_KEY` de la copia, pero bloquear salidas de correo, pagos y cron durante el ensayo. Comprobar catálogo/imágenes, acceso de administrador, importes de ventas, saldos de stock y descifrado de un enlace. Registrar fecha, duración y resultado; sin este ensayo no dar por probado el respaldo.

## Monitoreo y aceptación final

`/api/health` devuelve solo disponibilidad pública del proceso. Con el bearer del mantenimiento verifica PostgreSQL y correos agotados; devuelve 503 si no está listo. El monitor debe usar esa autorización sin registrarla. Conectar alertas por 5xx, fallos de webhook, correos fallidos y ausencia de cron; usar logs con acceso restringido y evitar capturar URLs de `/order/[token]`, cuerpos de formularios y datos personales en servicios de terceros. El diagnóstico de arranque y el panel ayudan a investigar, no sustituyen alertas externas.

Antes de abrir: comprobar cuenta y recuperación, una carga de imagen real, compra con retiro y con envío habilitado, pago aprobado/pendiente/rechazado, notificación repetida, reserva vencida, reembolso, contracargo, solicitud pública y entrega. Hacer una prueba comercial controlada con la titular en el dominio final y confirmar dinero, correo y stock en los proveedores reales. Las pruebas locales con Mercado Pago simulado no la sustituyen.

Retroceso: conservar el despliegue anterior y una copia previa. En Vercel, preparar producción sin asignar el dominio, verificar y promover ese mismo build. Ante fallo, volver al despliegue anterior compatible con el esquema. No borrar ni revertir migraciones financieras a ciegas; preferir una corrección hacia adelante y reconciliar cualquier pago ocurrido durante la incidencia. Desactivar la apertura comercial mientras se resuelve una inconsistencia de cobros.

## Referencias

- [Vercel Cron](https://vercel.com/docs/cron-jobs) y [frecuencias por plan](https://vercel.com/docs/cron-jobs/usage-and-pricing).
- [Notificaciones de Checkout Pro](https://www.mercadopago.com.ar/developers/en/docs/checkout-pro-preferences/payment-notifications).
- [Respaldos de Supabase](https://supabase.com/docs/guides/platform/backups).
- [Ley 24.240](https://www.argentina.gob.ar/normativa/nacional/638/actualizacion), [Disposición 954/2025](https://www.argentina.gob.ar/normativa/nacional/disposici%C3%B3n-954-2025-417152/texto) y [derechos sobre datos personales](https://www.argentina.gob.ar/aaip/datospersonales/derechos).

### Conexión TLS de Supabase

La aplicación y Prisma confían en el certificado público Supabase Root 2021 CA con validación de cadena y hostname. `sslmode=require` del URL no debe descartar ese certificado en node-postgres. La CA pública está versionada en `src/lib/supabase-ca.ts`; no contiene claves privadas. No usar `rejectUnauthorized=false` ni `NODE_TLS_REJECT_UNAUTHORIZED=0`.

La carga técnica acotada puede inspeccionarse con `npx tsx scripts/repair-production-bootstrap.ts`; solo `--apply` agrega permisos y asignaciones predeterminadas, la cuenta técnica sin contraseña y Embalse. No ejecuta el seed general, no carga productos/clientes/talles ni cambia contraseñas. Requiere autorización del responsable para el destino de producción.
