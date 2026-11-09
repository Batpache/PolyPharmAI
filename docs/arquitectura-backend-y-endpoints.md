# PolyPharmAI | Arquitectura del Backend, Manejo de Datos y Endpoints

Este documento detalla la estructura implementada en el backend, las decisiones de diseño para el manejo y protección de datos sensibles, el propósito de cada endpoint y el flujo de información en la Fase 1.

---

## 1. Estructura General del Proyecto

Se definió una separación limpia en la raíz del repositorio:
- **`back/`**: Contiene la API REST desarrollada con Node.js, Express y el SDK oficial de Supabase.
- **`front/`**: Código de la aplicación web cliente.
- **`db/`**: Esquemas y utilidades SQL para Supabase (`schema.sql`).
- **`docs/`**: Especificaciones de arquitectura, endpoints y contratos.

### 1.1 Organización interna de `back/`

```text
back/
├── src/
│   ├── config/
│   │   ├── env.js                # Validación estricta de variables de entorno al arrancar
│   │   └── supabase.js           # Cliente Supabase inicializado con service_role key
│   ├── lib/
│   │   └── fecha.js              # Helpers de fecha y día ISO en zona horaria America/Mexico_City
│   ├── middleware/
│   │   └── auth.js               # Middlewares: autenticar y requerirConsentimiento
│   ├── modules/
│   │   ├── auth/                 # Registro, lectura/actualización de perfil y borrado de cuenta
│   │   │   ├── auth.routes.js
│   │   │   └── auth.service.js
│   │   ├── botiquin/             # Gestión de medicamentos y captura manual
│   │   │   ├── botiquin.routes.js
│   │   │   └── botiquin.service.js
│   │   └── recordatorios/        # Horarios y confirmación de tomas
│   │       ├── recordatorios.routes.js
│   │       └── recordatorios.service.js
│   ├── data/                     # Catálogos JSON futuros (medicamentos, interacciones)
│   ├── scripts/                  # Scripts de mantenimiento o pruebas
│   └── index.js                  # Inicialización de Express, CORS, rutas y error handler
├── .env                          # Variables de entorno locales (ignorado por Git)
├── .env.example                  # Plantilla de variables de entorno
└── package.json                  # Dependencias y scripts de ejecución
```

---

## 2. Cómo se Manejan los Datos (Principios y Seguridad)

### A. Separación entre Identidad y Salud (RNF-010)
Para cumplir con estándares de privacidad y disociación de datos médicos:
- La tabla **`identidades`** contiene el `user_id` de Supabase Auth y el `nombre` de la persona.
- Las tablas de salud (**`pacientes`**, **`consentimientos`**, **`tratamientos`**, **`botiquin_items`**, **`recordatorios`**, **`tomas`**) solo conocen un UUID interno `paciente_id`.
- En ninguna tabla de salud se guarda el nombre ni el correo del usuario.
- `identidades` y `pacientes` solo se cruzan en un único punto: al consultar `GET /api/perfil`.

### B. Aislamiento Multi-inquilino sin RLS en Servidor (RNF-009)
- El backend utiliza la **llave de servicio (`service_role`)**, que intencionalmente salta las políticas de Row Level Security (RLS) en Postgres. A su vez, los permisos directos para roles `anon` y `authenticated` están revocados en la base de datos para que ningún cliente web pueda leer tablas directamente.
- Para garantizar aislamiento absoluto, **toda consulta a tablas de salud filtra obligatoriamente por `paciente_id`**.
- El `paciente_id` proviene exclusivamente del token JWT validado en `req.pacienteId`. **Nunca** se toma de `req.body`, `req.params` ni `req.query`.
- Si un usuario intenta acceder a un recurso ajeno o inexistente, la respuesta siempre es `404 Not Found`, previniendo que se descubra la existencia de IDs de otros usuarios.

### C. Privacidad en Respuestas
- Ninguna respuesta JSON de la API incluye `paciente_id` ni `user_id`.
- Se realizan selecciones explícitas de columnas en Supabase (evitando `select('*')`).

### D. Vigencia del Consentimiento
- El acceso a datos de salud requiere haber aceptado la versión en vigor del aviso de privacidad (`VERSION_AVISO_VIGENTE`, por ejemplo `2026-11-v1`).
- Si en el futuro se actualiza dicha versión en `.env`, el middleware `requerirConsentimiento` devolverá automáticamente `403 CONSENTIMIENTO_REQUERIDO` hasta que el paciente acepte la nueva versión.

### E. Manejo de Zona Horaria Local (`America/Mexico_City`)
- Los días de semana (1 = lunes ... 7 = domingo) y la fecha de hoy se calculan en la zona `America/Mexico_City` mediante `lib/fecha.js`.
- Esto garantiza sincronía con la columna generada en la base de datos `tomas.fecha`, la cual computa la fecha en esa misma zona horaria.

### F. Baja Lógica de Medicamentos
- Los medicamentos no se eliminan físicamente al llamar `DELETE /api/botiquin/:id`.
- Se realiza una baja lógica (`activo = false`, fijando `fecha_fin = hoy` si no tenía fin).
- Al darse de baja un medicamento, sus recordatorios activos pasan automáticamente a `activo = false`.

### G. Idempotencia y Códigos de Unicidad
- El registro (`POST /api/auth/registro`) y la confirmación de tomas (`PATCH /api/recordatorios/:id/tomado`) son idempotentes: si se invocan dos veces seguidas, capturan el error de unicidad `23505` de PostgreSQL y conservan el registro original sin generar errores ni duplicados.

---

## 3. Explicación de Endpoints

### 3.1 Módulo: Auth y Perfil

#### `POST /api/auth/registro`
- **Propósito:** Se ejecuta desde el cliente web inmediatamente después de registrarse en Supabase Auth (`supabase.auth.signUp`). Da de alta el perfil inicial del paciente y su consentimiento.
- **Manejo de datos:**
  1. Realiza un `upsert` en `identidades` con el `user_id` del token y el `nombre`.
  2. Realiza un `upsert` en `pacientes` con `ignoreDuplicates: true` para que, si el usuario ya existía, no se borren sus condiciones previas.
  3. Inserta el registro en `consentimientos` vinculando `paciente_id` con la versión del aviso.
- **Respuesta:** `{ data: { registrado: true, version: "..." } }`.

#### `GET /api/perfil`
- **Propósito:** Mostrar al paciente su nombre y su lista de condiciones crónicas declaradas.
- **Manejo de datos:** Realiza dos lecturas en paralelo: el `nombre` desde `identidades` y el arreglo `condiciones` desde `pacientes`.
- **Respuesta:** `{ data: { nombre: "...", condiciones: [...] } }`.

#### `PUT /api/perfil`
- **Propósito:** Permitir al paciente actualizar las enfermedades crónicas que padece (máximo 20, ej. "Hipertensión", "Diabetes").
- **Manejo de datos:** Valida cada texto con Zod, aplica `trim`, elimina duplicados y actualiza la columna `condiciones text[]` en `pacientes`.
- **Respuesta:** `{ data: { condiciones: [...] } }`.

#### `DELETE /api/cuenta`
- **Propósito:** Cumplir con el derecho de supresión de datos (RF-014).
- **Manejo de datos:**
  1. Conexión a Supabase Storage: lista y elimina todos los archivos bajo el prefijo `<paciente_id>/` en el bucket privado `recetas-temp`.
  2. Borrado del usuario en Supabase Auth mediante `supabase.auth.admin.deleteUser(req.user.id)`.
  3. Las restricciones de llave foránea en `schema.sql` (`on delete cascade`) eliminan en automático todas las filas dependientes: `identidades`, `pacientes`, `consentimientos`, `tratamientos`, `botiquin_items`, `recordatorios` y `tomas`.
- **Respuesta:** `204 No Content`.

---

### 3.2 Módulo: Botiquín

#### `GET /api/botiquin`
- **Propósito:** Consultar el listado de medicamentos registrados por el paciente.
- **Manejo de datos:**
  - Soporta filtros por query params: `tipo` (`base` [default], `temporal`, `todos`) y `activo` (`true` [default], `false`, `todos`).
  - Obtiene los tratamientos del paciente y luego sus `botiquin_items`, incrustando la información del tratamiento (`id, tipo, origen, fecha_receta`) dentro de cada ítem devuelto.
- **Respuesta:** Lista de medicamentos ordenada de más reciente a más antiguo.

#### `POST /api/botiquin`
- **Propósito:** Alta manual de un medicamento que no provenga de receta leída por IA o que requiera captura directa.
- **Manejo de datos:**
  - Busca o crea un tratamiento del paciente con `tipo='base'` y `origen='manual'`.
  - Asigna obligatoriamente `semaforo='rojo'`, `verificado=false`, `principios_activos='{}'` y `catalogo_id=null`.
  - Si se proporciona `duracion_dias`, calcula automáticamente la fecha de término (`fecha_fin`).
  - Zod rechaza cualquier intento de inyectar semáforos o estatus de verificación desde el cliente.
- **Respuesta:** `201 Created` con el medicamento recién registrado.

#### `PATCH /api/botiquin/:id`
- **Propósito:** Modificar datos posológicos o vigencia del medicamento (por ejemplo, cambio de dosis o suspensión).
- **Manejo de datos:**
  - Solo admite campos de la lista blanca: `dosis`, `frecuencia`, `frecuencia_horas`, `duracion_dias`, `fecha_inicio`, `fecha_fin`, `activo`.
  - Bloquea la edición de nombres o principios activos para no invalidar cotejos futuros.
- **Respuesta:** `200 OK` con los datos actualizados del medicamento.

#### `DELETE /api/botiquin/:id`
- **Propósito:** Retirar un medicamento del botiquín activo sin perder el registro histórico.
- **Manejo de datos:**
  - Marca `activo = false` en `botiquin_items`.
  - Si `fecha_fin` era nula, le asigna la fecha actual en hora de México.
  - Actualiza todos los recordatorios asociados a dicho medicamento a `activo = false`.
- **Respuesta:** `200 OK` con `{ data: { id: "...", activo: false } }`.

---

### 3.3 Módulo: Recordatorios y Tomas

#### `GET /api/recordatorios`
- **Propósito:** Mostrar la agenda diaria de tomas que le corresponden al paciente para una fecha determinada.
- **Manejo de datos:**
  - Query opcional `?fecha=YYYY-MM-DD` (por defecto hoy en horario de México).
  - Determina el día de la semana ISO (1 a 7).
  - Filtra medicamentos activos y vigentes para esa fecha (`fecha_inicio <= fecha` y `fecha_fin >= fecha` o nulo).
  - Filtra recordatorios activos cuyo arreglo `dias_semana` incluya el día actual.
  - Cruza con la tabla `tomas` para indicar con `tomada: true/false` y `tomada_at` si la toma ya fue confirmada.
  - Ordena los recordatorios cronológicamente por hora.
- **Respuesta:** Lista de tomas programadas del día con el detalle de dosis y nombre del fármaco.

#### `POST /api/recordatorios`
- **Propósito:** Programar un horario de toma para un medicamento.
- **Manejo de datos:**
  - Valida que el `item_id` pertenezca al paciente y esté activo.
  - Recibe la hora en formato `HH:MM` y opcionalmente los días de la semana (por defecto de lunes a domingo: `[1,2,3,4,5,6,7]`).
  - Permite crear múltiples recordatorios para un mismo medicamento si este se toma varias veces al día.
- **Respuesta:** `201 Created` con el recordatorio registrado.

#### `PATCH /api/recordatorios/:id/tomado`
- **Propósito:** Registrar que el paciente tomó su medicamento el día de HOY.
- **Manejo de datos:**
  - Verifica que el recordatorio y su medicamento continúen activos.
  - Valida que el día de hoy esté programado en `dias_semana` (si no, responde `409 NO_PROGRAMADO_HOY`).
  - Realiza un `insert` en `tomas` con `paciente_id` y `recordatorio_id`.
  - Si ya se había marcado hoy, la restricción única `(recordatorio_id, fecha)` genera el código `23505`, el cual se captura limpiamente devolviendo la toma ya existente.
- **Respuesta:** `{ data: { recordatorio_id: "...", tomada: true, tomada_at: "..." } }`.

---

## 4. Respuestas de Error Estandarizadas

Todos los errores de la API siguen la estructura:
```json
{
  "error": {
    "codigo": "CODIGO_ERROR",
    "mensaje": "Descripción legible o detalle de validación"
  }
}
```

Códigos frecuentes:
- `TOKEN_REQUERIDO` / `TOKEN_INVALIDO`: Faltante o fallo en autenticación (401).
- `CONSENTIMIENTO_REQUERIDO`: Falta aceptar el aviso o la versión cambió (403).
- `NO_ENCONTRADO`: Recurso inexistente o no perteneciente al paciente autenticado (404).
- `AVISO_DESACTUALIZADO`: La versión del aviso enviada no coincide con la vigente (409).
- `NO_PROGRAMADO_HOY`: Intento de registrar una toma en un día no contemplado en `dias_semana` (409).
- `VALIDACION`: Entrada rechazada por los esquemas estrictos de Zod (400).
- `ERROR_INTERNO`: Error no controlado del servidor (500, sin revelar detalles de la BD).

