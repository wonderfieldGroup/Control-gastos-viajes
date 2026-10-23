# Flujo de carpetas quincenales

## Reglas confirmadas

- Periodos por fecha del gasto: 1–15 y 16–último día del mes. Año y mes forman parte de la agrupación.
- Guardar crea un borrador privado. No entra en las bandejas del jefe ni de Finanzas.
- El cierre usa la fecha UTC del servidor, no el reloj del dispositivo. La carpeta indica «Quincena vencida» y se habilita su envío manual. No hay envío automático.
- Los gastos antiguos pertenecen a su quincena original, aunque se registren meses después.
- «Enviar gasto individual» permite excepciones, incluso después de un envío anterior, sin modificar sus integrantes.
- Cada envío agrupa solo gastos del mismo empleado y quincena. Hasta 250 por envío. Clave de idempotencia y bloqueo para impedir envíos duplicados.
- Cualquiera de los dos jefes asignados puede decidir. Se revisa un gasto o todos los pendientes; nunca se revierten decisiones previas en una acción masiva.
- Finanzas recibe juntos los aprobados solo cuando no queda ningún gasto pendiente del jefe. Los rechazados por el jefe permanecen visibles para empleado y jefes.
- Finanzas dispone únicamente de «Marcar como Pagado» por gasto o «Marcar carpeta como Pagada» para todos los aprobados que falten por pagar. No hay botones de segunda aprobación o rechazo en esa vista.
- El registro de pago, individual o conjunto, exige una referencia. Registra la conformidad de Finanzas y el pago de forma atómica, con identidad y fecha, sin alterar la aprobación del jefe. No se ejecutan transferencias bancarias.
- Los pagos conjuntos excluyen rechazados y ya pagados, conservando sus decisiones y referencias previas. Los envíos existentes en fase FINANCE o PAYMENT son compatibles, sin modificar automáticamente sus datos.
- Todos los perfiles de Finanzas ven el mismo estado. Revisión optimista de la carpeta y bloqueo transaccional para evitar sobrescrituras y pagos registrados dos veces.
- Las ediciones y borrados del empleado se limitan a borradores. No se cambian comprobantes de gastos enviados.
- Los gastos que existían antes de la migración conservan sus estados e historial y siguen su circuito individual anterior. No se reenvían ni se vuelven a pagar.
- No se crean usuarios ni se cambian credenciales. No se activa el servicio de correos. Los nuevos borradores/carpetas no generan correos diarios; el correo de carpetas requerirá una adaptación separada antes de activarlo.

## Despliegue coordinado

El flujo quincenal base ya se publicó mediante PR #23. Para el ajuste de Finanzas, aplicar únicamente la nueva migración `20261023020158_finance_direct_folder_payment.sql` y publicar `index.html`, `js/i18n.js` y `js/expenseFolders.js`. No aplicar la migración de retención del PR #24, no crear tareas de limpieza y no cambiar claves ni cuentas.

1. Revisar y ejecutar una sola vez la migración `supabase/migrations/20261023010659_fortnight_expense_submissions.sql` en el proyecto Wonderfield. Transacción: si falla, revertir antes de seguir. No aplicar esquemas iniciales ni todas las migraciones antiguas de nuevo.
2. Comprobar tablas, RLS, funciones y la configuración de correo desactivada. No modificar registros reales para las pruebas.
3. Publicar conjuntamente `index.html`, `js/app.js`, `js/i18n.js`, `js/expenseFolders.js` y `js/services/db.js`.
4. Probar la vista previa con una sesión autorizada y comprobar CodeQL y Cloudflare antes de integrar en main.
5. Recargar las pestañas antiguas. La versión anterior no conoce las carpetas: tras la migración, sus altas quedan como borradores seguros pero su mensaje anterior puede seguir diciendo «enviado» hasta recargar.

## Pruebas locales reproducibles

Dependencias de desarrollo: `@electric-sql/pglite@0.5.10` y `jsdom@27.0.1`. Los tests admiten `PGLITE_MODULE` y `JSDOM_MODULE` como rutas a instalaciones ya disponibles.

Ejecutar `node --test tests/fortnight-workflow.test.cjs tests/fortnight-ui.test.cjs`.

Incluyen PostgreSQL real aislado, RLS por identidad/rol, fechas bisiestas, privacidad de borradores, aprobación parcial, rechazo, pagos simulados, envíos individuales, concurrencia por revisión e integración de los botones reales con PostgreSQL aislado. El formulario completo, los dashboards, los límites y ES/EN/IT también se comprueban. Ninguna prueba toca Supabase de producción.
