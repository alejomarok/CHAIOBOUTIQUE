# Verificación de la entrega

Fecha: 23/10/2026. Destino preparado: Vercel; pruebas realizadas exclusivamente en bases locales descartables o de desarrollo. No hubo despliegues, migraciones remotas, mensajes reales a clientes ni cobros reales.

**Recorrido verificado:** catálogo → carrito → aceptación de políticas → pedido → proveedor simulado → webhook firmado → venta/stock → consulta y atención administrativa; las solicitudes públicas registran una constancia y admiten respuesta desde el panel.

## Resultados

| Comprobación              | Evidencia                                                                                                                                                                                                                                                                              |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Compilación de producción | Next 16.4.2 compiló correctamente, con TypeScript y `Proxy (Middleware)` reconocido.                                                                                                                                                                                                   |
| Análisis estático         | `npm run lint` y validación de tipos sin errores.                                                                                                                                                                                                                                      |
| Pruebas unitarias         | 483 pruebas de la suite y 3 adicionales de configuración de producción aprobadas: 486 verificaciones distintas. Incluye firma CMS comprobada criptográficamente.                                                                                                                       |
| Integración               | Suite final completa: 34 archivos, 333 pruebas aprobadas, con RLS activo.                                                                                                                                                                                                              |
| Navegador funcional       | 10 recorridos: 9 pasaron directamente y el de compra/pago aprobado pasó al reintentar tras exceder el plazo de compilación en desarrollo. El plazo de ese recorrido se ajustó a 180 segundos para sus múltiples rutas y acceso administrativo. No fue una repetición de cobros reales. |
| Navegador de producción   | Home, términos, privacidad, envíos, devoluciones, arrepentimiento, recuperación y acceso responden 200; CSP presente, nonce diferente entre documentos y scripts autorizados. Sin errores JavaScript ni violaciones CSP. Inicio de sesión y panel de preparación comprobados.          |
| Mantenimiento y salud     | La llamada sin bearer al mantenimiento responde 401; el estado interno autorizado valida PostgreSQL y correos sin fallos.                                                                                                                                                              |
| Móvil y redes             | Menú móvil operativo; Instagram, Facebook y WhatsApp con enlaces confirmados y controles de 44 px en anchos 1440, 768, 390 y 320. Solo Embalse; sin desbordamiento horizontal. Formulario legal visible a 390 px y con movimiento reducido.                                            |
| Protección de datos       | Cobertura de todas las tablas Prisma; un rol sin privilegios no ve filas, no puede insertar y no modifica/elimina filas. Roles anon/authenticated sin permisos de lectura, escritura o truncado. Sus cambios de prueba se revierten al terminar.                                       |
| Dependencias              | `npm audit --omit=dev`: 0 vulnerabilidades conocidas. Auditoría completa: 4 avisos altos en herramientas de desarrollo; 0 críticos. Node-forge no aparece en los archivos de ejecución trazados por Next.                                                                              |
| Respaldo                  | Sintaxis y rechazo de un destino dentro del repositorio comprobados. Exportación remota y restauración completa pendientes del entorno operativo; no se afirma que un backup ya esté instalado o probado.                                                                              |

La prueba local de producción utilizó un administrador temporal. Al terminar se revocaron sus sesiones, se retiraron contraseña y roles y se desactivó la cuenta, conservando el historial de auditoría. Las bases de pruebas se reinician con un control que exige host, puerto y nombre locales concretos; nunca apuntan a Supabase remoto.

## Límites de la aceptación

Las pruebas no confirman el cobro comercial real, la recepción de SMTP en casillas externas, la ejecución del cron en Vercel ni las copias de infraestructura. Antes de abrir, completar CUIT y correo comercial, configurar los servicios del destino, revisar catálogo y operación fiscal, y efectuar la aceptación descrita en [production-release.md](./production-release.md).

La aplicación permanece disponible en `http://localhost:3000` con la compilación de producción y la base local de desarrollo. Para continuar editando con recarga automática, detener ese servidor y ejecutar `npm run dev`.

Las capturas y los informes técnicos de esta revisión se conservan localmente en `.taste-skill/` (excluido de Git); no contienen credenciales de acceso activas. La preparación actual del entorno se consulta en `/admin/settings/production`.
