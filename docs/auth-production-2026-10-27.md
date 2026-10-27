# Acceso y recuperación en producción — 27/10/2026

La autenticación rechazaba solicitudes porque `BETTER_AUTH_URL` y
`NEXT_PUBLIC_APP_URL` apuntaban a `http://localhost:3000` en Vercel Production.
Ambas se corrigieron a `https://chaioboutique.vercel.app`. El acceso con la
contraseña existente respondió 200 y la sesión de comprobación se cerró.
No se cambió ninguna contraseña. Los enlaces de despliegues anteriores no
deben usarse para iniciar sesión; la versión nueva redirige sus páginas
de producción al origen oficial y conserva las comprobaciones de origen.

La recuperación usaba exclusivamente SMTP pese a existir una variable de
Resend. Se agregó Resend como proveedor compartido por autenticación y cola
de pedidos, con deduplicación de reintentos para esta última.

El responsable no dispone todavía de un dominio de correo verificado. Se
preparó el remitente temporal `onboarding@resend.dev`, con dirección de respuesta
y destinatario de prueba indicados por el responsable. `RESEND_TEST_RECIPIENT`
impide enviar a otros destinatarios; este modo no habilita correo a clientes.
Para ello se requiere un dominio verificado, cambiar `EMAIL_FROM` y retirar
la restricción del destinatario.

La única prueba de recuperación autorizada no envió el correo: Resend rechazó
la clave configurada con HTTP 401. Better Auth ocultó ese fallo en su respuesta
pública 200. Se añadió un control global previo, independiente de la existencia
de la cuenta, para responder 503 cuando el proveedor rechaza sus credenciales.
El control se comparte durante un minuto y no necesita acceso de administración
de dominios para claves limitadas al envío. El formulario muestra errores y
permite reintentar después de un fallo de red.

Pendiente: el responsable debe reemplazar `RESEND_API_KEY` en Vercel Production
por una clave válida, sin compartirla en el chat, y desplegar nuevamente. La
configuración protegida puede comprobarse en `/api/health?email=1`. La entrega
a la bandeja de entrada aún no está confirmada.
