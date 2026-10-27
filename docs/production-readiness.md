# Preparación para producción — CHAIOBOUTIQUE

Actualización: 23 de octubre de 2026. Este informe sustituye la auditoría inicial y resume las correcciones realizadas. No se desplegó ni se modificó una base remota; no se realizaron pagos reales.

## Correcciones implementadas

| Punto de la auditoría               | Resultado                                                                                                                                                                                                     |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dependencias vulnerables            | Next 16.4.2 y librerías de correo, imágenes, XML y CSV actualizadas. Dependencias indirectas corregidas y generadores innecesarios retirados. Auditoría de producción: 0 vulnerabilidades conocidas.          |
| Límites en memoria                  | Contadores atómicos compartidos en PostgreSQL para producción y almacenamiento nativo de Better Auth en base. Desarrollo/pruebas conservan el respaldo en memoria.                                            |
| Cabeceras y proveedores ficticios   | CSP con nonce por respuesta, bloqueo de marcos, nosniff, política de referencia y rutas privadas sin indexación. Producción rechaza E2E_TEST_MODE, claves de cifrado faltantes y dominios públicos sin HTTPS. |
| Reservas sin programador            | GET/POST protegido compatible con Vercel; cron cada cinco minutos incluido. Exige un plan compatible o configurar un programador externo.                                                                     |
| Reembolsos y contracargos ignorados | Se concilian antes del retorno de pago ya aprobado. Historial financiero inmutable, importes netos y revisión administrativa; nunca se repone stock por un aviso financiero.                                  |
| Confirmaciones y recuperación       | Cola de correo persistente, payload cifrado, reintentos, recuperación de bloqueos y gestión de fallos. Confirmación de pedido/pago/entrega, avisos al comercio y recuperación privada por email.              |
| Preparación y entrega               | Transiciones con permisos y auditoría, seguimiento de transporte y notificaciones. Cobertura postal, costo y plazo deben configurarse para habilitar envíos.                                                  |
| Términos y privacidad               | Páginas públicas de términos, privacidad, envíos, cambios/devoluciones y arrepentimiento; aceptación versionada en checkout. Titular confirmado: SILVINA IVANA DANI.                                          |
| Solicitudes del consumidor          | Botón visible desde el primer acceso, formulario sin cuenta ni motivo obligatorio, constancia inmediata, aviso por correo y atención desde el panel.                                                          |
| Preparación y operación             | Panel de pendientes y correos fallidos, preflight de solo lectura, endpoint de salud, CI sin secretos reales, herramienta de copia de base y archivos, y guía de publicación/recuperación.                    |
| SEO básico                          | Metadata social, sitemap de productos visibles y exclusión de rutas privadas.                                                                                                                                 |

Las cinco nuevas migraciones operativas se aplicaron únicamente en desarrollo/pruebas locales; la última es `20261023170000_restrict_direct_data_access`. El seed de una instalación nueva incluye el titular, las redes y el contacto confirmados y la única sucursal vigente en Embalse.

## Pendientes externos que impiden dar por aceptada la salida comercial

- CUIT y email comercial de la titular, datos fiscales, condiciones reales de entrega y catálogo real revisado.
- Proyecto Vercel, dominio HTTPS y secretos del entorno, almacenamiento persistente y SMTP verificado. Un estado de configuración “Listo” no acredita que un servicio externo entregue correctamente.
- Ejecutar migraciones y seed contra el destino aprobado, configurar administrador y retirar las credenciales iniciales del alojamiento.
- Habilitar cron y sus alertas: la frecuencia de cinco minutos no está disponible en Hobby. No se contrató un plan ni un programador externo.
- Compra/reembolso controlados en el dominio real, confirmación de webhook, correo recibido, stock y operación de entrega. Las pruebas automatizadas usan un proveedor de pago simulado.
- Activar respaldo periódico y alertas en infraestructura y comprobar una restauración completa de base e imágenes. La herramienta incluida no instala una programación externa.
- Emisión fiscal mediante un sistema habilitado, registro de comprobantes y notas de crédito por el responsable contable. ARCA integrado continúa en homologación; no se habilitó emisión automática fiscal de producción.

La auditoría completa conserva cuatro avisos altos de desarrollo: brace-expansion, js-yaml, undici y node-forge (este último solo para certificados ficticios de pruebas), sin críticos. No se usan como servidores públicos ni en la firma fiscal de ejecución. Los informes JSON detallados locales están en `.taste-skill/`, excluidos de Git. Repetir la auditoría en cada actualización.

## Evidencia y entrega

La compilación de producción, análisis estático y pruebas se registran en [la guía de verificación](./production-verification.md). Para publicar y operar seguir [production-release.md](./production-release.md). La configuración de una instalación se inspecciona en `/admin/settings/production` o con `npm run preflight:production`.

Referencias contrastadas: [aviso de Next](https://github.com/vercel/next.js/security/advisories/GHSA-2464-fhr4-w9xw), [Vercel Cron](https://vercel.com/docs/cron-jobs/usage-and-pricing), [notificaciones de Mercado Pago](https://www.mercadopago.com.ar/developers/en/docs/checkout-pro-preferences/payment-notifications), [respaldos de Supabase](https://supabase.com/docs/guides/platform/backups) y [Ley 24.240](https://www.argentina.gob.ar/normativa/nacional/638/actualizacion).
