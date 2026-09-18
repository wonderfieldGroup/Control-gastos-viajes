# Revisión de seguridad para puesta en producción

Fecha: 18 de septiembre de 2026

## Estado

El portal queda preparado con un nivel de seguridad técnico apropiado para una primera publicación corporativa. La aprobación definitiva de TI depende de completar los dos requisitos operativos que figuran al final de este documento.

## Riesgos identificados y tratamiento

| Área | Riesgo detectado | Control aplicado |
| --- | --- | --- |
| Código público | Las cuentas de demostración y sus contraseñas estaban incluidas en JavaScript. | Se eliminaron las credenciales, los botones de autocompletado y los datos ficticios. |
| Administración de cuentas | El navegador podía mostrar contraseñas y simulaba altas, bajas y cambios de rol. | El directorio administrativo es solo lectura. El ciclo de vida de las cuentas queda exclusivamente en Supabase Auth/TI. |
| Autenticación | Estaba habilitado el registro público. | Se deshabilitó. Se conservan la confirmación de correo y el bloqueo de acceso anónimo. |
| Contraseñas | No había una política reforzada configurada. | Se exige cambio seguro, contraseña actual para actualizarla y requisitos de mayúscula, minúscula, número y símbolo; el mínimo se elevó a 12 caracteres. |
| Sesiones | Un perfil inactivo podía conservar una sesión local. | La aplicación cierra la sesión y rechaza operaciones si el perfil no está activo; las políticas de datos también exigen perfil activo. |
| Autorización de datos | Las reglas RLS eran amplias y una regla de jefe directo tenía la dirección invertida. | Se reescribieron las funciones de autorización, se restringieron por rol y se separó la aprobación de la liquidación. |
| Privilegios | Funciones internas y tablas tenían permisos más amplios de lo necesario. | Se retiraron privilegios por defecto y se concedió únicamente el acceso mínimo para las operaciones del portal. |
| Integridad de gastos | Un cliente podía intentar manipular propietario, totales, moneda, texto o el estado de un gasto. | Se añadieron restricciones, trigger de integridad, normalización del empleado desde el perfil y RPCs auditadas para aprobar, rechazar y pagar. |
| Comprobantes | Era posible intentar referenciar el fichero de otro usuario o ampliar el tiempo de acceso. | Storage sigue privado; la ruta queda ligada a empleado y gasto, las URLs firmadas duran 5 minutos y las políticas validan propietario y acceso. |
| Carga de archivos | El tipo se comprobaba solo por la extensión/MIME del navegador. | Se comprueba tamaño, MIME permitido y cabecera real de JPEG, PNG o PDF antes de cargar. |
| Auditoría | No existía evento al crear o editar un gasto. | Se registran eventos `CREATED` y `UPDATED`; los cambios de estado ya quedan registrados como `APPROVED`, `REJECTED` o `PAID`. |
| Navegador y dependencias | Faltaba política de contenido y había dependencias CDN sin versión fija. | Se añadió CSP, política de referrer y versiones fijas para Tailwind, Lucide, SheetJS, Canvas Confetti y Supabase JS. |
| Disponibilidad | El RPC de mantenimiento podría perder acceso tras restringir funciones. | Se conserva únicamente `keep_alive` expuesto a anon/autenticado; se verificó respuesta HTTP 200. |

## Validaciones realizadas

- Base actual: 4 perfiles, 0 gastos y 0 comprobantes; no había registros incompatibles con las nuevas restricciones.
- RLS de `expenses` rechaza una consulta anónima con HTTP 401.
- `keep_alive` responde HTTP 200 tras la restricción de permisos.
- La interfaz local carga sin accesos de prueba y los cuatro paneles exigen autenticación.
- Supabase informa que el proyecto está sano; el editor SQL aplicó la transacción de endurecimiento.

## Requisitos pendientes de TI antes del lanzamiento

1. **Rotar las contraseñas de las cuatro cuentas existentes.** Las claves de prueba estuvieron presentes durante el desarrollo; deben considerarse expuestas aunque ya no estén en el código. La rotación también obligará a cumplir la política nueva.
2. **Configurar la URL oficial.** Supabase aún tiene `http://localhost:3000` como Site URL y no tiene Redirect URLs permitidas. Debe sustituirse por el dominio HTTPS oficial del portal y añadirse únicamente ese dominio a la lista permitida.

## Controles recomendados para una fase posterior

- Activar CAPTCHA cuando TI disponga de proveedor/clave compatible; en el plan actual figura deshabilitado.
- Activar MFA para administradores y finanzas cuando el flujo corporativo de soporte esté definido.
- Analizar antivirus los comprobantes en una función de servidor antes de permitir su descarga, si la política corporativa exige análisis antimalware.
- Alojar los recursos estáticos detrás de un dominio corporativo/CDN que añada cabeceras HTTP de seguridad (HSTS, `X-Content-Type-Options`, `frame-ancestors`) además de la CSP incluida en el HTML.
- Revisar y aprobar la integración de cotizaciones externas antes de usarla para contabilización definitiva; no debe ser la fuente única para pagos.
