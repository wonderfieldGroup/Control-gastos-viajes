# Control de Gastos de Empleados en Viajes Internacionales (4 Módulos)

Sistema corporativo integral para el control de gastos de viajes de negocios internacionales con soporte multidivisa (Europa, Dólar USD y Australia AUD), flujo de aprobación jerárquico, liquidación contable en finanzas y administración de usuarios y correos.

---

## 🏢 Módulos y Pestañas del Sistema

### 1. ✈️ Pestaña 1: Registro de Gastos (Empleado)
- **Acceso libre**: Ingreso del Area Manager / Empleado.
- **Sugerencias automáticas**: Al escribir el nombre del Area Manager, el sistema detecta de inmediato a su **Jefe Directo** asignado y su **correo electrónico**.
- **Formulario**:
  - Selector entre **Factura** y **Ticket**.
  - Si es Factura: Opción de IVA y cálculo de **Base Imponible** y **Cuota de IVA deducible**.
  - **Divisas internacionales**: Europa (EUR, GBP, CHF, SEK, NOK, DKK, PLN, CZK), Dólar (USD) y Australia (AUD) con **conversión automática a EUR (€)** a la tasa del día.
  - Subida de comprobante fotográfico.
  - Al registrar el gasto, se emite automáticamente la notificación al Jefe Directo asignado.

---

### 2. 👔 Pestaña 2: Aprobación Jefe Directo 🔒
- **Acceso Protegido**: Usuario `jefe` / Contraseña `jefe123`
- **Funcionalidades**:
  - Bandeja con contador de solicitudes de gastos pendientes de sus Area Managers.
  - Revisión del comprobante (foto, importes, IVA).
  - Acciones: **Aprobar Gasto** (pasa a Finanzas) o **Rechazar Gasto** (especificando motivo).

---

### 3. 💼 Pestaña 3: Gestión Financiera & Pagos 🔒
- **Acceso Protegido**: Usuario `finanzas` / Contraseña `finanzas123`
- **Funcionalidades**:
  - Visión global de todos los gastos de la empresa.
  - Indicadores KPI (Total General, Total Pagado, Pendiente de Liquidar, Total IVA).
  - Acción: **Marcar como Pagado / Transferido** (asigna referencia bancaria).
  - **DESCARGA DE EXCEL (.xlsx)**: Genera el libro contable con *Detalle de Gastos* y *Resumen Financiero*.

---

### 4. ⚙️ Pestaña 4: Panel de Administrador 🔒
- **Acceso Protegido**: Usuario `admin` / Contraseña `admin123`
- **Funcionalidades**:
  1. **Directorio de Area Managers & Jefes Directos**:
     - Lista y registro de Area Managers con su Jefe Directo y el **correo electrónico del Jefe** para el envío de alertas de gastos.
     - Botón **"✉️ Probar Correo"**: Vista previa de la notificación formateada y enlace `mailto:` directo.
     - Crear, Editar y Eliminar Area Managers.
  2. **Gestión Completa de Usuarios y Contraseñas**:
     - Crear nuevos usuarios para cualquier rol (*Jefe*, *Finanzas*, *Admin*, *Empleado*).
     - Modificar nombres, roles y cambiar contraseñas con generador de claves seguras.
     - Botón para ver/ocultar contraseñas.
     - Todos los cambios se guardan de forma persistente y se aplican en tiempo real en los logins de toda la aplicación.

---

## 🔑 Credenciales Predeterminadas de Acceso

| Pestaña | Rol | Usuario | Contraseña |
| :--- | :--- | :--- | :--- |
| **2. Aprobación Jefe** | Supervisor | `jefe` | `jefe123` |
| **3. Gestión Financiera** | Finanzas / Tesorería | `finanzas` | `finanzas123` |
| **4. Administrador** | Administrador del Sistema | `admin` | `admin123` |

*(En cada pantalla de login dispones de un botón de autocompletado rápido para facilitar las pruebas).*

---

## 🚀 Cómo Iniciar la Aplicación

- **Opción 1**: Ejecutar `start_app.bat` o `python start_app.py` para abrir en `http://localhost:8000/index.html`.
- **Opción 2**: Doble clic en `index.html` para abrir directamente en cualquier navegador.
