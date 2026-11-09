# PolyPharmAI | Contexto del backend para implementar los endpoints básicos

Este documento es la fuente de verdad para implementar la primera fase de la API. Léelo completo antes de escribir código. Si algo no está aquí o contradice otro archivo del repo, **pregunta antes de inventar**.

La base de datos está definida en `db/schema.sql` (ya ejecutado en Supabase). Los nombres de tablas y columnas de este documento coinciden con ese archivo; si hay diferencias, manda `schema.sql`.

---

## 1. Qué es el proyecto (en corto)

PolyPharmAI es un prototipo web para pacientes con polifarmacia. Permite registrar sus medicamentos (botiquín base), cargar recetas temporales, detectar duplicidades e interacciones con una tabla curada de fuentes oficiales y programar recordatorios de tomas. Es **informativo**: nunca recomienda, diagnostica ni sustituye marcas, y siempre remite al médico o farmacéutico.

El contexto completo del proyecto (requisitos, alcance, resumen) se entrega aparte.

## 2. Stack y estructura

| Capa | Tecnología |
| --- | --- |
| Servidor | Node.js + Express (API REST modular) |
| Base de datos | PostgreSQL en Supabase |
| Autenticación | Supabase Auth (el cliente inicia sesión; el servidor solo verifica el token) |
| Almacenamiento | Supabase Storage, bucket privado `recetas-temp` |
| Validación | `zod` (instalar si no está) |
| Apoyo | dotenv, cors, multer |

```
server/src/
├── index.js
├── config/            # env.js, supabase.js
├── lib/               # fecha.js (hoy local y día de la semana)
├── middleware/        # auth.js
├── modules/
│   ├── auth/          # registro, perfil, cuenta
│   ├── botiquin/
│   └── recordatorios/
├── data/              # medicamentos.json, interacciones.json (no tocar en esta fase)
└── scripts/
```

Cada módulo se organiza así:

- `<modulo>.routes.js`: define rutas, valida la entrada con zod y llama al servicio.
- `<modulo>.service.js`: **todo** acceso a Supabase. Las rutas no hacen consultas.

## 3. Alcance de esta fase

**Implementar ahora:**

- Middleware de autenticación y de consentimiento.
- `POST /api/auth/registro`, `GET/PUT /api/perfil`.
- `GET/POST/PATCH/DELETE /api/botiquin`.
- `GET/POST /api/recordatorios` y `PATCH /api/recordatorios/:id/tomado`.
- `DELETE /api/cuenta`.

**NO implementar todavía** (son tareas posteriores; no crees archivos ni stubs para ellas):

- `/api/recetas/*` (leer con Gemini, confirmar, descartar).
- `/api/catalogo/*`.
- `/api/conciliacion`.
- `/api/resumen/pdf`.
- Caché y respaldo de Gemini.

## 4. Reglas que no se pueden romper

1. **La llave de servicio y cualquier otra clave solo existen en el servidor**, leídas de variables de entorno. Nunca en código, logs, respuestas ni en el repositorio.
2. **Toda consulta a tablas de salud filtra por `paciente_id`**, tomado de `req.pacienteId` (resuelto desde el token). Nunca de `req.body`, `req.params` ni `req.query`. El servidor usa la llave de servicio, que salta RLS; esta regla es la única barrera entre pacientes.
3. **Los servicios reciben `pacienteId` como primer parámetro** y lo aplican en cada consulta (`select`, `update`, `delete`).
4. **Un recurso ajeno o inexistente responde igual: 404.** Así no se revela qué ids existen.
5. **Separación identidad / salud (RNF-010).** El nombre vive solo en `identidades`; las tablas de salud no llevan nombre ni correo. `identidades` se une con salud únicamente en `GET /api/perfil`.
6. **Nunca incluyas `paciente_id` ni `user_id` en las respuestas.** Usa selecciones de columnas explícitas (no `select('*')`), de modo que el identificador interno no llegue al cliente.
7. **Nunca registrar en logs** nombres de medicamentos, condiciones, tokens ni cuerpos de petición completos.
8. **Sin consentimiento vigente no se tocan datos de salud** (ver middleware).
9. **Lenguaje informativo:** ningún mensaje de la API da consejos médicos.
10. Los nombres de campos en JSON son los mismos que en la base de datos (`snake_case`). No renombres ni mapees, salvo el alias de relaciones indicado en el endpoint de botiquín.

## 5. Variables de entorno

Archivo `server/.env.example` (sin valores reales; `.env` va en `.gitignore`):

```
PORT=3001
CORS_ORIGIN=http://localhost:5173
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
VERSION_AVISO_VIGENTE=2026-11-v1
TZ_APP=America/Mexico_City
```

`config/env.js` valida que todas existan al arrancar y falla con un mensaje claro si falta alguna.

`TZ_APP` **debe ser `America/Mexico_City`**: la columna `tomas.fecha` de la base se calcula con esa zona, y el "hoy" de la API tiene que coincidir con ella.

## 6. Modelo de datos

```
auth.users ─┬─ identidades                      (nombre)
            └─ pacientes ─┬─ consentimientos
                          ├─ lecturas            (fase posterior)
                          └─ tratamientos ── botiquin_items ── recordatorios ── tomas
```

| Tabla | Para qué sirve | Notas |
| --- | --- | --- |
| `identidades` | Nombre de la persona | PK `user_id` = id de Supabase Auth. El correo solo está en Auth. |
| `pacientes` | Lado de salud, con UUID interno | `user_id` único; `condiciones text[]` (máx. 20, escritas a mano) |
| `consentimientos` | Qué versión del aviso aceptó y cuándo | Columnas `version` y `aceptado_at`; única por (`paciente_id`, `version`) |
| `lecturas` | Imagen temporal y resultado de la IA | Fase posterior |
| `tratamientos` | Una receta o grupo de medicamentos de un mismo origen | `tipo`: `base` o `temporal`; `origen`: `receta`, `caja`, `manual`; `fecha_receta`; `lectura_id` opcional |
| `botiquin_items` | **Un medicamento del paciente por fila** | Baja = `activo=false`, no se borra |
| `recordatorios` | Un horario para un medicamento | `hora`, `dias_semana` (1=lunes ... 7=domingo) |
| `tomas` | Una toma confirmada | Una por recordatorio por día (`fecha` se calcula sola) |

Columnas de `botiquin_items`: `id`, `tratamiento_id`, `catalogo_id`, `nombre_capturado`, `denominacion_generica`, `principios_activos` (text[]), `concentracion`, `forma_farmaceutica`, `dosis`, `frecuencia`, `frecuencia_horas`, `duracion_dias`, `semaforo` (obligatorio: `verde`/`amarillo`/`rojo`), `confianza`, `verificado`, `activo`, `fecha_inicio`, `fecha_fin`, `created_at`, `updated_at`.

Todas las tablas de salud llevan `paciente_id`. Borrar el usuario de Supabase Auth borra todo en cascada.

## 7. Fecha y día de la semana (`lib/fecha.js`)

Todo el cálculo de "hoy" usa `TZ_APP`, nunca la zona del servidor.

```js
export function hoyLocal(tz = process.env.TZ_APP) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date()); // 'YYYY-MM-DD'
}

// 1 = lunes ... 7 = domingo (ISO), a partir de 'YYYY-MM-DD'
export function diaSemanaISO(fecha) {
  const d = new Date(`${fecha}T12:00:00Z`).getUTCDay(); // 0 = domingo
  return d === 0 ? 7 : d;
}
```

## 8. Middleware (`middleware/auth.js`)

### `autenticar`

1. Lee `Authorization: Bearer <jwt>`. Si falta o es inválido: `401`.
2. Verifica con `supabase.auth.getUser(jwt)` usando el cliente de servicio. Si falla: `401`.
3. Deja `req.user = { id }` (id de Auth).
4. Busca el paciente: `pacientes` donde `user_id = req.user.id` y deja `req.pacienteId` (o `null` si todavía no se registró). Solo `POST /api/auth/registro` y `DELETE /api/cuenta` pueden continuar con `pacienteId = null`.

### `requerirConsentimiento`

Se aplica a **todas** las rutas de datos de salud (perfil, botiquín, recordatorios).

- Si `req.pacienteId` es null, o no existe una fila en `consentimientos` con `paciente_id = req.pacienteId` y `version = VERSION_AVISO_VIGENTE`: responde `403` con código `CONSENTIMIENTO_REQUERIDO`.
- Así, si el aviso cambia de versión, los pacientes deben volver a aceptar.

## 9. Convenciones de la API

- Éxito: `{ "data": ... }`. Error: `{ "error": { "codigo": "TEXTO_CORTO", "mensaje": "..." } }`.
- Códigos HTTP: `200`, `201` (creación), `204` (sin contenido), `400` (validación), `401`, `403`, `404`, `409` (conflicto), `500`.
- Valida **siempre** con zod: body, params (`:id` debe ser UUID) y query. Rechaza campos desconocidos (`.strict()`).
- Un manejador de errores global al final de `index.js`; los errores internos devuelven `500` con mensaje genérico (sin detalles de la base de datos).
- Violación de unicidad de Postgres (código `23505`): en los endpoints que lo indican significa "ya existía" y no es un error.

Patrón obligatorio en un servicio:

```js
// modules/botiquin/botiquin.service.js
const COLUMNAS_ITEM = 'id, nombre_capturado, denominacion_generica, principios_activos, concentracion, forma_farmaceutica, dosis, frecuencia, frecuencia_horas, duracion_dias, semaforo, verificado, activo, fecha_inicio, fecha_fin';

export async function obtenerItem(pacienteId, itemId) {
  const { data, error } = await supabase
    .from('botiquin_items')
    .select(COLUMNAS_ITEM)
    .eq('paciente_id', pacienteId)   // SIEMPRE
    .eq('id', itemId)
    .maybeSingle();
  if (error) throw error;
  return data; // null => la ruta responde 404
}
```

## 10. Endpoints

Todos requieren `Authorization: Bearer <jwt>`. "Consent." indica si pasa por `requerirConsentimiento`.

| Método | Ruta | Consent. | Requisito |
| --- | --- | --- | --- |
| POST | `/api/auth/registro` | No | RF-01 |
| GET | `/api/perfil` | Sí | RF-02 |
| PUT | `/api/perfil` | Sí | RF-02 |
| GET | `/api/botiquin` | Sí | RF-08 |
| POST | `/api/botiquin` | Sí | RF-07 (captura manual) |
| PATCH | `/api/botiquin/:id` | Sí | RF-08 |
| DELETE | `/api/botiquin/:id` | Sí | RF-08 |
| GET | `/api/recordatorios` | Sí | RF-12 |
| POST | `/api/recordatorios` | Sí | RF-12 |
| PATCH | `/api/recordatorios/:id/tomado` | Sí | RF-12 |
| DELETE | `/api/cuenta` | No | RF-14 |

`POST /api/botiquin` no está en el contrato original; es necesario para la captura manual. Agrégalo a `docs/api.md`.

### POST `/api/auth/registro`

Se llama justo después de crear la cuenta en Supabase Auth desde el cliente.

- Body: `{ nombre: string (1-120), aceptar_consentimiento: true, version: string }`.
- Si `aceptar_consentimiento !== true`: `400`. Si `version !== VERSION_AVISO_VIGENTE`: `409` con código `AVISO_DESACTUALIZADO`.
- Debe ser **idempotente** (se puede llamar dos veces sin error):
  1. `upsert` en `identidades` (`user_id`, `nombre`) con `onConflict: 'user_id'`.
  2. Crear el paciente si no existe, **sin pisar `condiciones`**: `upsert` en `pacientes` con `onConflict: 'user_id'` e `ignoreDuplicates: true`; luego lee su `id`.
  3. `insert` en `consentimientos` (`paciente_id`, `version`); si devuelve `23505`, ya estaba aceptado: ignóralo.
- Respuesta `201`: `{ data: { registrado: true, version } }`. No devuelvas ids internos.

### GET `/api/perfil`

- Respuesta `200`: `{ data: { nombre, condiciones } }`. El `nombre` viene de `identidades` y `condiciones` de `pacientes`; es el único lugar donde se unen identidad y salud.

### PUT `/api/perfil`

- Body: `{ condiciones: string[] }`, máximo 20 elementos, cada uno de 1 a 80 caracteres; aplica `trim` y elimina duplicados.
- Reemplaza la lista completa en `pacientes.condiciones`. Respuesta `200` con `{ condiciones }`.
- Las condiciones solo se muestran en el perfil y encabezarán el resumen en PDF; **no las interpretes** ni las uses para generar alertas.

### GET `/api/botiquin`

- Query opcional: `tipo` = `base` (por defecto), `temporal` o `todos`; `activo` = `true` (por defecto), `false` o `todos`.
- Devuelve los ítems del paciente ordenados por `created_at` descendente, con su tratamiento, usando el alias `tratamiento`:
  `.select(`${COLUMNAS_ITEM}, tratamiento:tratamientos!inner(id, tipo, origen, fecha_receta)`)`
  y `.eq('tratamientos.tipo', tipo)` cuando `tipo != todos`.
- Si la relación embebida da error por la llave compuesta, resuélvelo con dos consultas (tratamientos del paciente y luego sus ítems) en lugar de quitar el filtro por `paciente_id`.
- Respuesta `200`: `{ data: [ ... ] }`.

### POST `/api/botiquin`

Captura **manual** de un medicamento (semáforo rojo o sin coincidencia en el catálogo).

- Body (estricto): `nombre_capturado` (obligatorio), `concentracion`, `forma_farmaceutica`, `dosis`, `frecuencia`, `frecuencia_horas` (1-168), `duracion_dias` (1-3650), `fecha_inicio` (por defecto `hoyLocal()`).
- Reutiliza el `tratamiento` más reciente del paciente con `tipo='base'` y `origen='manual'`; si no existe, créalo.
- Crea el ítem con `semaforo='rojo'`, `verificado=false`, `principios_activos='{}'` y `catalogo_id=null`.
- Si viene `duracion_dias`, calcula `fecha_fin = fecha_inicio + duracion_dias`.
- El cliente **no** puede enviar `semaforo`, `verificado`, `principios_activos` ni `catalogo_id` (campo desconocido: `400`).
- Respuesta `201` con el ítem.
- Limitación para la fase de conciliación: un ítem sin `principios_activos` no se puede cotejar y la conciliación deberá avisarlo.

### PATCH `/api/botiquin/:id`

- Campos editables (lista blanca): `dosis`, `frecuencia`, `frecuencia_horas`, `duracion_dias`, `fecha_inicio`, `fecha_fin`, `activo`.
- **No editables:** `nombre_capturado`, `catalogo_id`, `denominacion_generica`, `principios_activos`, `forma_farmaceutica`, `concentracion`, `verificado`, `semaforo`. Cambiarlos invalidaría la verificación contra el catálogo.
- Body vacío: `400`. Ítem ajeno o inexistente: `404`. Respuesta `200` con el ítem.
- Reactivar un ítem (`activo=true`) **no** reactiva sus recordatorios.

### DELETE `/api/botiquin/:id`

- **Baja lógica:** `activo=false` y, si no tenía, `fecha_fin = hoyLocal()`. Además desactiva sus recordatorios (`recordatorios.activo=false`, filtrando por `item_id` y `paciente_id`).
- Respuesta `200`: `{ data: { id, activo: false } }`. Ajeno o inexistente: `404`.

### GET `/api/recordatorios`

- Query opcional: `fecha=YYYY-MM-DD` (por defecto `hoyLocal()`).
- Devuelve los recordatorios del paciente que **aplican ese día**:
  - `recordatorios.activo = true`.
  - Su ítem (`botiquin_items!inner`) está `activo`, con `fecha_inicio <= fecha` y (`fecha_fin` nulo o `>= fecha`).
  - `dias_semana` contiene `diaSemanaISO(fecha)`.
- Cada elemento: `{ id, hora, dias_semana, item: { id, nombre_capturado, denominacion_generica, dosis }, tomada: boolean, tomada_at }`. `tomada` es verdadero si existe una fila en `tomas` con ese `recordatorio_id` y `fecha`.
- Ordena por `hora`. "Pendiente" significa que no hay fila de toma ese día.

### POST `/api/recordatorios`

- Body: `{ item_id: uuid, hora: "HH:MM", dias_semana?: number[] }`. `dias_semana` por defecto `[1,2,3,4,5,6,7]`; valores de 1 a 7, sin repetir ni vacío.
- Verifica que el ítem pertenezca al paciente y esté `activo` (si no, `404`).
- Respuesta `201` con el recordatorio. Una medicación varias veces al día se programa con varios recordatorios (uno por hora).

### PATCH `/api/recordatorios/:id/tomado`

- `:id` es el id del **recordatorio**. Solo permite registrar la toma de **hoy** (la hora es la real: `tomada_at = now()`); no recibe fecha.
- Si el recordatorio o su ítem están inactivos: `404`. Si hoy no está en `dias_semana`: `409` con código `NO_PROGRAMADO_HOY`.
- Inserta en `tomas` (`paciente_id`, `recordatorio_id`). Si Postgres devuelve `23505`, la toma de hoy ya existía: **no es error**; conserva la original.
- Luego lee la toma de hoy y respóndela: `200` con `{ data: { recordatorio_id, tomada: true, tomada_at } }`. Es idempotente.

### DELETE `/api/cuenta`

- Body: `{ confirmar: true }`; si no, `400`.
- Orden obligatorio:
  1. Si existe `req.pacienteId`: listar y borrar con la API de Storage los archivos del bucket `recetas-temp` bajo el prefijo `<paciente_id>/`.
  2. `supabase.auth.admin.deleteUser(req.user.id)`. La cascada de la base borra identidad, paciente y todo lo demás.
- Respuesta `204`. No borres filas a mano: la cascada lo hace.

## 11. Para fases posteriores (no implementar ahora)

Solo para que lo implementado hoy no choque con lo que viene:

- **Leer receta:** inserta una fila en `lecturas` (`imagen_path`, `resultado`, `confirmada=false`) con la imagen en `recetas-temp/<paciente_id>/<lectura_id>.<ext>`.
- **Confirmar:** crea un `tratamiento` con `lectura_id`, inserta sus `botiquin_items`, marca la lectura como `confirmada`, borra la imagen de Storage y pone `imagen_path=null`. Si la lectura ya estaba confirmada: `409`. Verifica que la lectura pertenezca al paciente.
- **Descartar y limpiar:** una lectura con `confirmada=false` e `imagen_path` no nulo es pendiente. No borres lecturas confirmadas.
- **Conciliación:** compara los ítems de un tratamiento temporal contra los ítems activos de tratamientos base; los ítems sin `principios_activos` se reportan como "no cotejables".

## 12. Cómo probar (Postman)

Crea una colección con un entorno por usuario (`token_A`, `token_B`) y verifica:

1. Sin token: todas las rutas dan `401`.
2. Token válido sin registro: `GET /api/perfil` da `403 CONSENTIMIENTO_REQUERIDO`.
3. Registro dos veces seguidas: ambos exitosos, sin filas duplicadas en `consentimientos`.
4. Con la cuenta A crea un ítem; con la cuenta B intenta `PATCH` y `DELETE` sobre ese id y crear un recordatorio con ese `item_id`: siempre `404` (**RNF-09**).
5. `PATCH .../tomado` dos veces el mismo día: la segunda no cambia `tomada_at` y no crea otra fila.
6. Un recordatorio con `dias_semana` sin el día de hoy: `PATCH .../tomado` da `409`.
7. Dar de baja un ítem desactiva sus recordatorios y deja de aparecer en `GET /api/recordatorios`.
8. Ninguna respuesta contiene `paciente_id` ni `user_id`.
9. `DELETE /api/cuenta`: el usuario deja de existir y sus tablas quedan vacías.

Comprueba además, con la llave pública (anon) desde el navegador o con una petición directa, que **no** se puede leer ninguna tabla.

## 13. Entregable esperado

- Módulos `auth`, `botiquin` y `recordatorios` con su `routes` y `service`.
- `middleware/auth.js`, `lib/fecha.js`, `config/env.js` y `config/supabase.js`.
- `server/.env.example` actualizado.
- Sección de `docs/api.md` con los contratos de este documento.
- `README` con los pasos para levantar el servidor.

No agregues dependencias distintas a las de la sección 2 sin avisar.
