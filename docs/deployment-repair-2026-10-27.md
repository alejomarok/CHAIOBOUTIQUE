# Reparación del despliegue — 27/10/2026

## Fallos confirmados en los registros

- Vercel rechazó el despliegue `dpl_AppyXDgXBJHmLLTUZiDiY6J1PzEL` antes de compilar: el plan Hobby no admite la frecuencia `*/5 * * * *` declarada en `vercel.json`.
- GitHub Actions, ejecución `40515517821`, falló en `npm ci`: faltaban `@emnapi/runtime@1.11.3` y `@emnapi/core@1.11.3` en el archivo de dependencias.
- El control de la integración «Supabase Preview» agotó el tiempo de conexión a PostgreSQL por IPv6. Este fallo de conectividad es independiente del estado de las migraciones de Prisma.
- La base de producción tenía 8 de las 23 migraciones del repositorio aplicadas.
- La conexión de `pg` necesitaba la autoridad certificadora de Supabase para verificar TLS. No se debe desactivar la verificación del certificado.

## Acciones realizadas

- Copia de seguridad cifrada antes de modificar la base, almacenada fuera del repositorio en el directorio privado de copias de ChaioBoutique del usuario.
- Aplicadas las 15 migraciones pendientes de Prisma: 23 completas, ninguna fallida. Verificada la restricción del acceso directo de los roles públicos.
- Creadas las variables de producción `DATA_ENCRYPTION_KEY` y `CRON_SECRET` en Vercel, con valores nuevos conservados fuera del repositorio. No se reemplazaron claves existentes.
- Preparado el uso del certificado raíz público de Supabase con verificación de certificado y nombre del servidor, tanto en la aplicación como en Prisma CLI.
- Eliminada la configuración de cron incompatible con Hobby. Preparado un instalador para Supabase Cron, con el token guardado en Vault y la tarea inicialmente inactiva.
- Preparada una reparación limitada a permisos y roles, cuenta técnica sin inicio de sesión y sucursal Embalse. Su ejecución predeterminada solo consulta el estado.
- Regenerado `package-lock.json` con las entradas faltantes, sin cambiar las versiones existentes. La validación `npm ci --dry-run --ignore-scripts --offline` terminó correctamente.

## Verificación local

Compilación de producción, TypeScript y ESLint correctos. Pasaron las nueve pruebas focalizadas de conexión TLS, configuración de producción y seguridad. La publicación nueva todavía no se ha ejecutado.

## Pendiente de autorización y comprobación remota

El responsable autorizó expresamente la reparación limitada, configurar el cron y publicar. Ejecutada la reparación: 62 permisos presentes, cuenta técnica creada y Embalse presente.

La instalación inicial se revirtió porque Supabase restringe la escritura directa en `cron.job`. Se corrigió para usar `cron.alter_job`, la función de administración. El job 1 quedó instalado cada cinco minutos e inactivo, con el secreto cifrado en Vault. No activar la tarea hasta que la versión nueva esté publicada y responda correctamente.

Después de publicar, verificar los controles de GitHub, los registros de Vercel, la salud de la aplicación y una ejecución HTTP del mantenimiento. La integración Supabase Preview debe volver a comprobarse: aplicar migraciones por el pooler no demuestra que su conexión IPv6 esté reparada.
