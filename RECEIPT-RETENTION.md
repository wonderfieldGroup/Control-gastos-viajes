# Conservación de fotos y tickets PDF

Preparación desactivada por defecto. La migración no instala ni activa ninguna tarea de borrado.

## Regla solicitada

- El plazo empieza en la aprobación registrada por Finanzas (`finance_decided_at` con decisión `APPROVED`), no en el envío, aprobación del jefe ni pago.
- Fotos JPG/PNG y tickets PDF se eliminan de Storage tras 15 días completos (360 horas), incluso si el gasto todavía no figura como pagado.
- Una tarea horaria procesa como máximo 25 comprobantes por ejecución, nunca antes del vencimiento. Los fallos se reintentan posteriormente; una pausa del proyecto también retrasará la limpieza.
- Se conservan el gasto, importes, nombres/ruta del comprobante, decisiones, referencias de pago e historial. Se añade la fecha de eliminación y un evento de auditoría.
- No se borran borradores, rechazados, pendientes de Finanzas, archivos ajenos ni gastos históricos sin fecha explícita de aprobación de Finanzas. No se infiere esa fecha a partir de `paid_at`.
- El borrado es definitivo: el portal no puede recuperar fotos/PDF. Los originales que la empresa necesite conservar deben guardarse fuera del portal antes del vencimiento.

## Diseño y seguridad

La tarea invoca la API de Storage, no ejecuta DELETE en `storage.objects`. Solo marca el comprobante eliminado después de una respuesta correcta y de comprobar su ausencia. No toma rutas, plazos ni destinos desde el cliente web.

Las funciones son privadas, SECURITY INVOKER, sin permisos de ejecución para `anon`, `authenticated` ni `service_role`. Solo el proceso programado de PostgreSQL las ejecuta. La tarea usa una clave backend existente, guardada cifrada en Vault con el nombre `travel_storage_cleanup_service_role`. Nunca se incluye una clave en el repositorio, frontend, comando de cron o capturas.

La interfaz evita enlaces rotos de archivos eliminados, vacía sus URL firmadas en caché y muestra el motivo en ES/EN/IT. Los usuarios no pueden falsificar la fecha de retirada ni volver a subir un archivo sobre una ruta enviada.

## Activación coordinada, pendiente de confirmación

1. Confirmar borrado irreversible y uso de la clave backend existente en Vault del mismo proyecto Wonderfield. No generar ni rotar credenciales.
2. Aplicar una sola vez `20261023014129_receipt_retention_after_finance_approval.sql`. La preparación queda desactivada.
3. Verificar permisos, `select private.receipt_retention_tick(true);` y estado desactivado. Este modo no hace llamadas de borrado.
4. Guardar de forma segura la clave existente en Vault, fuera de SQL guardado y del chat. No mostrar su valor.
5. Publicar la interfaz y ejecutar, como postgres, la activación siguiente:

```sql
begin;
update private.receipt_retention_control set enabled=true where singleton;
select cron.schedule('travel-receipt-retention-hourly', '23 * * * *',
  'select private.receipt_retention_tick(false);');
commit;
```

6. Comprobar el cron activo, su próxima ejecución y los últimos resultados:

```sql
select * from private.receipt_retention_control;
select jobname,schedule,active from cron.job where jobname='travel-receipt-retention-hourly';
```

Pausa segura sin borrar nada: `update private.receipt_retention_control set enabled=false where singleton;`.

Las pruebas locales simulan la API de Storage sobre PostgreSQL aislado; comprueban límite temporal, PDF, aprobados sin pagar, exclusiones, fallos de API, reintentos, auditoría, RLS y avisos de interfaz. No eliminan comprobantes reales.
