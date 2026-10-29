# Categorías de gastos

En **Admin > 4. Categorías de gastos** se pueden añadir, retirar y restaurar categorías.
El catálogo se comparte en Supabase y se actualiza al entrar, volver a la ventana o cada 15 segundos mientras esté visible.

- Solo un administrador activo puede cambiar el catálogo. Empleados, Managers y Finanzas lo consultan.
- Quitar una categoría la retira de los gastos nuevos; no borra gastos, historial, comprobantes ni límites.
- Los borradores anteriores pueden conservar su categoría retirada. Las nuevas solicitudes y correcciones deben seleccionar una categoría disponible.
- Restaurar recupera la misma categoría y su límite de Finanzas anterior.
- Cada categoría nueva empieza sin límite; Finanzas puede configurarlo en su sección habitual.
- Los nombres admiten de 1 a 80 caracteres y no se duplican cambiando mayúsculas o espacios.
- Dos cambios simultáneos sobre una categoría se protegen con revisión; el segundo usuario debe actualizar.
- Con cero categorías activas se avisa al empleado para contactar con Admin. Si falla la carga no se utiliza un catálogo obsoleto para registrar gastos.

## Instalación

Aplicar primero `supabase/migrations/20261029192030_admin_expense_categories.sql` en el proyecto Wonderfield, y publicar después el frontend.
La migración crea las siete categorías originales activas y conserva los límites existentes. No modifica gastos ni cuentas.
RLS, permisos de columna y RPCs con `SECURITY INVOKER` limitan las escrituras a Admin; no se concede borrado físico del catálogo.

## Verificación local

Ejecutar `node --test tests/category-catalog.test.cjs tests/fortnight-ui.test.cjs tests/fortnight-workflow.test.cjs tests/admin-reporting.test.cjs` con JSDOM y PGlite disponibles.
Las pruebas cubren RLS real de PostgreSQL, duplicados, conservación, restauración, límites, validación al insertar gastos y controles del panel en español, inglés e italiano, además del flujo completo de carpetas y pagos.
