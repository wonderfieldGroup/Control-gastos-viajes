# Solicitudes de Admin y papelera

La pestaña **Admin → 3. Solicitudes** permite buscar por empleado, motivo, destino o identificador y filtrar por estado. Lista 25 registros por página, con paginación en el servidor.

**Eliminar solicitud** abre una confirmación con empleado, fecha, concepto e importe. Exige un motivo de 3 a 500 caracteres. Solo retira ese gasto, nunca la carpeta completa. **Papelera → Restaurar solicitud** recupera el registro con sus decisiones, referencia de pago y comprobante originales. Un gasto pagado muestra una advertencia: retirarlo no cancela ni devuelve una transferencia bancaria.

## Seguridad y coherencia

- Las dos operaciones verifican el rol Admin activo en el servidor. No se usan claves privilegiadas en el navegador. No se amplían los permisos de empleados, jefes ni Finanzas.
- Los registros retirados se excluyen mediante RLS de bandejas, filtros, totales, exportaciones, historial visible y nuevas URLs de comprobantes. Los RPC de revisión, envío y pago trabajan solo con registros activos, incluso si se invocan sin la interfaz nueva.
- La función administrativa bloquea primero la carpeta y después el gasto, igual que revisión/pago. Comprueba fecha de modificación, revisión de carpeta y versión de papelera. Una pestaña desactualizada no puede sobrescribir otra acción.
- Si es parte de una carpeta, esta se recalcula y cambia su revisión sin modificar decisiones ni pagos de otros gastos. Restaurar un pendiente puede devolverla a la etapa de revisión del jefe; Finanzas volverá a recibirla al concluir esa revisión.
- Se conservan el gasto, todos los eventos y el archivo físico. El actor, motivo y fecha de cada retirada/restauración se registran en tablas privadas con RLS, sin acceso directo del cliente.
- Un enlace firmado emitido antes de retirar un gasto puede seguir funcionando hasta su vencimiento existente (máximo 5 minutos). No se emiten nuevos enlaces mientras esté en la papelera.
- Las notificaciones en cola se cancelan al retirar el gasto; restaurarlo no reenvía mensajes antiguos. Los correos siguen desactivados.

No hay purga, borrado definitivo, tarea programada ni eliminación automática de imágenes/PDF. No se elimina ninguna solicitud al instalar la migración.

## Verificación

Las pruebas usan PostgreSQL aislado (PGlite), RLS real y la interfaz DOM. Cubren permisos, papelera/restauración, pagos conservados, referencias, comprobantes retenidos, versiones desactualizadas, carpetas parcialmente revisadas y etiquetas ES/EN/IT. No utilizan ni modifican solicitudes de producción.
