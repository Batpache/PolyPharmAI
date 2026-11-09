# PolyPharmAI | Especificación de la API (Fase 1: Endpoints Básicos)

API REST modular para PolyPharmAI.

**Convenciones Generales:**
- **Base URL:** `/api`
- **Autenticación:** Cabecera `Authorization: Bearer <jwt_supabase>`.
- **Formato Respuestas Exitosas:** `{ "data": ... }`
- **Formato Respuestas de Error:** `{ "error": { "codigo": "CODIGO_CORTO", "mensaje": "..." } }`
- **Códigos HTTP usuales:** `200` (OK), `201` (Creado), `204` (Sin contenido), `400` (Validación), `401` (No autenticado), `403` (Consentimiento requerido / Prohibido), `404` (No encontrado), `409` (Conflicto de estado o regla de negocio), `500` (Error interno).

---

## 1. Autenticación y Consentimiento

### POST `/api/auth/registro`
Registra el perfil del paciente tras crear la cuenta en Supabase Auth y acepta el consentimiento vigente. Operación idempotente.

- **Requiere Consentimiento previo:** No (este endpoint lo registra).
- **Body:**
  ```json
  {
    "nombre": "Juan Pérez",
    "aceptar_consentimiento": true,
    "version": "2026-11-v1"
  }
  ```
- **Respuestas:**
  - `201 Created`:
    ```json
    {
      "data": {
        "registrado": true,
        "version": "2026-11-v1"
      }
    }
    ```
  - `400 Bad Request`: Parámetros inválidos o `aceptar_consentimiento !== true`.
  - `409 Conflict`: Versión de aviso desactualizada (`AVISO_DESACTUALIZADO`).

---

## 2. Perfil

### GET `/api/perfil`
Obtiene los datos del perfil (nombre de la persona y lista de condiciones de salud).

- **Requiere Consentimiento:** Sí.
- **Respuestas:**
  - `200 OK`:
    ```json
    {
      "data": {
        "nombre": "Juan Pérez",
        "condiciones": ["Hipertensión", "Diabetes tipo 2"]
      }
    }
    ```

### PUT `/api/perfil`
Actualiza la lista completa de condiciones crónicas declaradas por el paciente (máximo 20).

- **Requiere Consentimiento:** Sí.
- **Body:**
  ```json
  {
    "condiciones": ["Hipertensión", "Diabetes tipo 2", "Asma"]
  }
  ```
- **Respuestas:**
  - `200 OK`:
    ```json
    {
      "data": {
        "condiciones": ["Hipertensión", "Diabetes tipo 2", "Asma"]
      }
    }
    ```
  - `400 Bad Request`: Si excede 20 condiciones o formato inválido.

---

## 3. Botiquín (Medicamentos)

### GET `/api/botiquin`
Obtiene los medicamentos del paciente ordenados cronológicamente por `created_at` desc.

- **Requiere Consentimiento:** Sí.
- **Query params (opcionales):**
  - `tipo`: `base` (default) | `temporal` | `todos`
  - `activo`: `true` (default) | `false` | `todos`
- **Respuestas:**
  - `200 OK`:
    ```json
    {
      "data": [
        {
          "id": "uuid-medicamento",
          "nombre_capturado": "Losartán 50mg",
          "denominacion_generica": "Losartán",
          "principios_activos": ["losartan"],
          "concentracion": "50 mg",
          "forma_farmaceutica": "Comprimido",
          "dosis": "1 tableta",
          "frecuencia": "cada 12 horas",
          "frecuencia_horas": 12,
          "duracion_dias": null,
          "semaforo": "verde",
          "confianza": 0.985,
          "verificado": true,
          "activo": true,
          "fecha_inicio": "2026-11-01",
          "fecha_fin": null,
          "created_at": "2026-11-01T10:00:00Z",
          "updated_at": "2026-11-01T10:00:00Z",
          "tratamiento": {
            "id": "uuid-tratamiento",
            "tipo": "base",
            "origen": "receta",
            "fecha_receta": "2026-11-01"
          }
        }
      ]
    }
    ```

### POST `/api/botiquin`
Captura manual de un medicamento. Asigna `semaforo: 'rojo'`, `verificado: false`, `principios_activos: []` y reutiliza/crea un tratamiento base manual.

- **Requiere Consentimiento:** Sí.
- **Body:**
  ```json
  {
    "nombre_capturado": "Paracetamol 500mg",
    "concentracion": "500 mg",
    "forma_farmaceutica": "Tableta",
    "dosis": "1 tableta",
    "frecuencia": "cada 8 horas",
    "frecuencia_horas": 8,
    "duracion_dias": 5,
    "fecha_inicio": "2026-11-09"
  }
  ```
- **Respuestas:**
  - `201 Created`: Devuelve el ítem creado.
  - `400 Bad Request`: Si incluye campos no permitidos (`semaforo`, `catalogo_id`, etc.) o campos requeridos faltantes.

### PATCH `/api/botiquin/:id`
Actualiza posología y estado de vigencia del medicamento.

- **Requiere Consentimiento:** Sí.
- **Campos permitidos:** `dosis`, `frecuencia`, `frecuencia_horas`, `duracion_dias`, `fecha_inicio`, `fecha_fin`, `activo`.
- **Respuestas:**
  - `200 OK`: Devuelve el ítem actualizado.
  - `400 Bad Request`: Body vacío o campos desconocidos.
  - `404 Not Found`: Si no existe o no pertenece al paciente.

### DELETE `/api/botiquin/:id`
Baja lógica del medicamento (`activo = false`, fija `fecha_fin = hoy` si era nula y desactiva sus recordatorios).

- **Requiere Consentimiento:** Sí.
- **Respuestas:**
  - `200 OK`: `{ "data": { "id": "uuid", "activo": false } }`
  - `404 Not Found`: Si no existe o no pertenece al paciente.

---

## 4. Recordatorios y Tomas

### GET `/api/recordatorios`
Lista los recordatorios vigentes programados para un día específico.

- **Requiere Consentimiento:** Sí.
- **Query params (opcional):**
  - `fecha`: `YYYY-MM-DD` (por defecto hoy en `America/Mexico_City`).
- **Respuestas:**
  - `200 OK`:
    ```json
    {
      "data": [
        {
          "id": "uuid-recordatorio",
          "hora": "08:00:00",
          "dias_semana": [1, 2, 3, 4, 5, 6, 7],
          "item": {
            "id": "uuid-item",
            "nombre_capturado": "Losartán 50mg",
            "denominacion_generica": "Losartán",
            "dosis": "1 tableta"
          },
          "tomada": true,
          "tomada_at": "2026-11-09T08:05:00-06:00"
        }
      ]
    }
    ```

### POST `/api/recordatorios`
Crea un nuevo horario de recordatorio para un medicamento activo.

- **Requiere Consentimiento:** Sí.
- **Body:**
  ```json
  {
    "item_id": "uuid-item",
    "hora": "08:00",
    "dias_semana": [1, 2, 3, 4, 5, 6, 7]
  }
  ```
- **Respuestas:**
  - `201 Created`: Devuelve el objeto del recordatorio creado.
  - `404 Not Found`: Si el ítem no existe o está inactivo.

### PATCH `/api/recordatorios/:id/tomado`
Confirma la toma correspondiente al día de HOY para el recordatorio indicado. Operación idempotente.

- **Requiere Consentimiento:** Sí.
- **Respuestas:**
  - `200 OK`:
    ```json
    {
      "data": {
        "recordatorio_id": "uuid-recordatorio",
        "tomada": true,
        "tomada_at": "2026-11-09T08:10:00-06:00"
      }
    }
    ```
  - `404 Not Found`: Si el recordatorio o medicamento está inactivo o no existe.
  - `409 Conflict`: Si el día de hoy no forma parte de `dias_semana` (`NO_PROGRAMADO_HOY`).

---

## 5. Cuenta

### DELETE `/api/cuenta`
Elimina la cuenta del usuario de forma irreversible.
1. Elimina archivos asociados en Storage (`recetas-temp/<paciente_id>/*`).
2. Elimina el usuario en Supabase Auth (`supabase.auth.admin.deleteUser`).
3. La base de datos elimina en cascada identidades, pacientes, consentimientos, tratamientos, ítems, recordatorios y tomas.

- **Requiere Consentimiento:** No (permite eliminar incluso sin consentimiento vigente).
- **Body:**
  ```json
  {
    "confirmar": true
  }
  ```
- **Respuestas:**
  - `204 No Content`
  - `400 Bad Request`: Si no se envía `{ "confirmar": true }`.

