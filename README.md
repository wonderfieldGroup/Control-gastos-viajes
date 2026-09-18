# Portal de Control de Gastos de Viajes

Portal corporativo de Wonderfield Group para registrar, revisar, aprobar y liquidar gastos de viaje en varias divisas.

## Flujo operativo

1. El empleado inicia sesión, registra el gasto y adjunta un comprobante permitido.
2. El jefe directo revisa y aprueba o rechaza los gastos de su equipo.
3. Finanzas consulta los gastos aprobados, los liquida y puede exportar el detalle.
4. TI aprovisiona las cuentas, asigna roles y administra las jerarquías desde Supabase Auth y la base de datos; el portal no crea, muestra ni modifica contraseñas.

## Controles de seguridad implementados

- Supabase Auth con perfiles, roles y Row Level Security (RLS).
- Bucket de comprobantes privado, con límites de tamaño y tipos permitidos.
- URLs firmadas de corta duración para acceder a los comprobantes.
- Validación del tipo real de archivo antes de cargarlo.
- Separación de funciones entre empleado, jefe, finanzas y administrador.
- Política de seguridad de contenido y control de referencias en el cliente web.
- Sin credenciales de prueba ni datos ficticios incluidos en el código publicado.

## Operación y aprovisionamiento

No hay credenciales predeterminadas. TI debe crear las cuentas en Supabase Auth, confirmar que cada perfil tenga un registro en `public.profiles`, asignar el rol necesario y activar la cuenta. Las contraseñas se establecen o restablecen mediante Supabase Auth; nunca desde el navegador ni el repositorio.

Antes de publicar, configure en Supabase la URL oficial del portal, las URL de redirección permitidas y las políticas corporativas de contraseña. Mantenga la clave `service_role` exclusivamente en un entorno de servidor administrado: jamás en este repositorio ni en el navegador.

## Desarrollo local

Ejecute `start_app.bat` o `python start_app.py` y abra `http://localhost:8000/index.html`.

Para cambios de base de datos, aplique el script versionado en `supabase/schema.sql` o las migraciones de `supabase/migrations/` mediante el SQL Editor de Supabase, siguiendo el proceso de revisión de TI.
