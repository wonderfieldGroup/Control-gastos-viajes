# Correos del Portal de Viajes

## Estado de entrega

**Preparado, pero desactivado.** No se ha configurado ninguna clave de Resend ni un remitente. El trabajo de Supabase Cron queda pausado. No se ha enviado ningun correo real.

La instalacion del servidor esta versionada en [supabase/email-notifications.sql](supabase/email-notifications.sql). Se aplica una sola vez mediante SQL Editor como postgres, despues del esquema y las migraciones existentes. No volver a ejecutarla sobre una instalacion existente.

## Destinatarios

| Cambio confirmado en la base de datos | Aviso |
| --- | --- |
| Nuevo gasto PENDING | Acuse al Area Manager y aviso a su jefe directo activo |
| APPROVED | Estado al Area Manager y aviso a cada cuenta activa de Finanzas |
| REJECTED | Estado al Area Manager; el motivo se consulta tras iniciar sesion |
| PAID | Estado al Area Manager; no representa una transferencia realizada por el portal |

Los correos se obtienen de profiles.email, el jefe de direct_boss_id y Finanzas del rol finance. No se envian automaticamente al administrador. Hay que registrar correos reales y asignar el jefe de cada empleado. Si falta un destinatario se registra recipient_missing, sin impedir guardar el gasto.

## Activacion posterior: solo configuracion, sin cambiar el codigo

1. IT autoriza Resend y verifica un dominio o subdominio de envio mediante DNS. Una direccion proton.me no puede utilizarse como remitente de Resend. Puede usarse como Reply-To.
2. En Resend, crear una clave restringida a envio y al dominio autorizado. En **Supabase > Vault**, guardarla con el nombre exacto **travel_resend_api_key**. No poner la clave en GitHub, JavaScript, capturas, este documento ni una consulta SQL guardada.
3. Revisar los destinatarios del portal y realizar la prueba acordada con IT. Para una prueba real utilizar solo cuentas y buzones autorizados, no datos de terceros.
4. En SQL Editor, actualizar la unica fila de configuracion con el remitente verificado. El ejemplo siguiente es una plantilla: sustituir la direccion antes de ejecutarlo y activar unicamente cuando IT lo autorice.

```sql
update notification_private.settings
set from_address = 'notificaciones@SUBDOMINIO-AUTORIZADO.EMPRESA',
    reply_to = 'wonderfieldgroup@proton.me',
    enabled = true
where singleton = true;
```

Al activar, se reanuda automaticamente el trabajo travel-expense-email. Procesa un mensaje por minuto; con varios destinatarios, cada uno puede recibirlo unos minutos despues. Supabase debe estar activo para ejecutarlo: esta preparacion no garantiza que el plan gratuito nunca se pause.

**No hay envio retroactivo:** los avisos generados mientras esta apagado quedan suppressed y no se convierten en envios al activar. Los cambios de configuracion cancelan pendientes de la configuracion anterior. Un mensaje ya entregado al proveedor no se puede retirar.

## Pausar

```sql
update notification_private.settings set enabled=false where singleton=true;
```

Esto pausa Cron y cancela los pendientes. No modifica gastos ni usuarios.

## Seguridad y funcionamiento

- Esquema notification_private no expuesto por la API, sin acceso de anon/authenticated; tablas con RLS y funciones internas sin ejecucion publica.
- Conservar **net**, **vault** y **notification_private** fuera de los esquemas expuestos de la Data API. pg_net es una extension administrada: sus solicitudes internas pueden contener cabeceras de autorizacion; solo TI debe tener acceso SQL al proyecto.
- La cola se genera con el cambio confirmado del gasto, en la misma transaccion. No depende de la pestaña del usuario ni acepta destinatarios arbitrarios desde el navegador.
- Mensajes individuales de texto: estado, identificador y enlace HTTPS al portal. Sin nombres, importes, adjuntos, URLs publicas de tickets ni datos bancarios.
- Se comprueba de nuevo que el destinatario este activo y conserve el rol o la asignacion al enviar.
- Dedupe por gasto/estado/tipo/destinatario; clave Idempotency-Key estable por mensaje y contenido congelado en el primer intento. Hasta seis intentos, con espera creciente. No se reintenta fuera de la ventana de idempotencia de 24 horas de Resend.
- Limite conservador: 80 mensajes nuevos en 24 horas y 2.500 en 31 dias. Usar una cuenta/proyecto Resend dedicado o revisar el consumo de otros sistemas; este limite no conoce los envios ajenos al portal.
- Los pendientes caducan a las 24 horas; los casos fallidos o bloqueados requieren revision de TI y no se reenvian indiscriminadamente.
- accepted significa que Resend acepto la solicitud, **no** que llego a la bandeja. La entrega, rebotes y spam se revisan en Resend; no se ha implementado un webhook de entrega.
- La cola queda asociada al gasto. No se ha activado una purga automatica: IT debe definir su retencion antes del uso sostenido.

## Comprobaciones de TI

```sql
select enabled, from_address, reply_to, updated_at from notification_private.settings;
select jobname, active, schedule from cron.job where jobname='travel-expense-email';
select state, count(*) from notification_private.outbox group by state;
select id, expense_id, event_status, recipient_kind, state, attempts, last_error
from notification_private.outbox where state in ('failed','blocked') order by created_at desc;
```

Las pruebas [supabase/tests/email-notifications.sql](supabase/tests/email-notifications.sql) usan datos ficticios y respuestas HTTP simuladas dentro de BEGIN/ROLLBACK. Requieren envio desactivado y ausencia de travel_resend_api_key; no deben ejecutarse despues de configurar una clave real. Verifican routing, duplicados, modo apagado, ausencia de credencial, aislamiento, aceptacion simulada, timeout, fallos definitivos y agotamiento de reintentos. Una prueba real de entrega queda pendiente de la cuenta y dominio oficiales.
