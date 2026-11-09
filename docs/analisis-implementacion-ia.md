# PolyPharmAI | Análisis de Implementación de Inteligencia Artificial

Este documento describe la arquitectura, flujo técnico, modelos y consideraciones normativas para la integración de Inteligencia Artificial (IA) en PolyPharmAI.

---

## 1. Objetivo y Rol de la IA

La Inteligencia Artificial en PolyPharmAI tiene como único propósito la **extracción, digitalización y estructuración de datos de recetas médicas (multimodal)** a partir de imágenes (recetas impresas o manuscritas).

### Principios Fundamentales:
1. **Asistencial e informativa:** La IA no prescribe, no diagnostica, no sugiere marcas ni altera posologías.
2. **Confirmación obligatoria:** Ningún dato extraído por la IA entra directamente al botiquín ni a la base de datos de tratamientos activos sin que el usuario lo revise y confirme explícitamente en el cliente.
3. **Privacidad estricta (LFPDPPP y RNF-010):** Las imágenes subidas son temporales y se eliminan inmediatamente de Supabase Storage en cuanto la lectura es confirmada o descartada.
4. **Verificación híbrida:** La IA propone el texto leído, pero la validación farmacológica se realiza mediante un cotejo determinista contra el catálogo local de COFEPRIS (`medicamentos.json`).

---

## 2. Modelo Seleccionado

- **Modelo:** `gemini-1.5-flash` o `gemini-2.0-flash` (a través de la API oficial de Google Gen AI).
- **Justificación técnica:**
  - **Superación de OCRs tradicionales:** Los OCRs clásicos (como Tesseract) presentaron una tasa de acierto inferior al 25% en recetas manuscritas o con caligrafía médica compleja. Gemini Flash comprende el contexto semántico de abreviaturas médicas (ej. *c/8h*, *tab*, *VO*).
  - **Latencia y costo:** Respuestas en 1 a 3 segundos con costo operativo mínimo.
  - **Soporte de Salida Estructurada (*Structured Outputs*):** Garantiza que la respuesta sea un JSON estricto sin alucinaciones de formato.

---

## 3. Flujo Técnico de Lectura de Recetas

```text
[ Cliente (Front) ]
       │  1. Sube foto (multipart/form-data)
       ▼
[ Servidor Express (Back) ]
       │  2. Sube imagen a Supabase Storage (recetas-temp/<paciente_id>/<lectura_id>.<ext>)
       │  3. Registra fila en tabla 'lecturas' (confirmada=false)
       │  4. Envía imagen a Gemini con prompt estructurado
       ▼
[ API Gemini Flash ]
       │  5. Devuelve JSON estructurado con medicamentos y posología
       ▼
[ Servidor Express (Back) ]
       │  6. Normaliza contra catálogo local (COFEPRIS): asigna semáforos (Verde/Amarillo/Rojo)
       │  7. Actualiza 'resultado' en 'lecturas'
       │  8. Devuelve propuesta al Cliente (200 OK)
       ▼
[ Cliente (Front) ]
       │  9. El usuario revisa, edita si es necesario y CONFIRMA
       ▼
[ Servidor Express (Back) ]
       │ 10. Inserta 'tratamientos' y 'botiquin_items'
       │ 11. Marca lectura como 'confirmada=true'
       │ 12. BORRA la imagen de Storage y pone imagen_path=null
```

---

## 4. Requerimientos de Software e Infraestructura

1. **Variables de Entorno (`back/.env`):**
   ```env
   GEMINI_API_KEY=tu_api_key_de_google_ai_studio
   GEMINI_MODEL=gemini-1.5-flash
   ```

2. **Librería npm:**
   - Instalar `@google/genai` (SDK oficial).

3. **Archivos de Conocimiento Local (`back/src/data/`):**
   - `medicamentos.json`: Diccionario basado en el Padrón de Registros Sanitarios de COFEPRIS con DCI (Denominación Común Internacional / principios activos).
   - `interacciones.json`: Matriz curada de fuentes oficiales para interacciones fármaco-fármaco.

---

## 5. Esquema de Salida Estructurada (JSON Schema de Gemini)

Para asegurar que Gemini devuelva exactamente la estructura requerida por el backend:

```json
{
  "type": "object",
  "properties": {
    "tipo_receta": { "type": "string", "enum": ["base", "temporal"] },
    "fecha_receta": { "type": ["string", "null"] },
    "medicamentos": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "nombre_leido": { "type": "string" },
          "concentracion": { "type": ["string", "null"] },
          "forma_farmaceutica": { "type": ["string", "null"] },
          "dosis": { "type": ["string", "null"] },
          "frecuencia": { "type": ["string", "null"] },
          "frecuencia_horas": { "type": ["integer", "null"] },
          "duracion_dias": { "type": ["integer", "null"] },
          "confianza": { "type": "number" }
        },
        "required": ["nombre_leido"]
      }
    }
  },
  "required": ["medicamentos"]
}
```

---

## 6. Endpoints a Implementar en la Siguiente Fase

- `POST /api/recetas/leer`: Carga de imagen, inferencia con Gemini y cotejo inicial de catálogo.
- `POST /api/recetas/:id/confirmar`: Aprobación del usuario, traspaso a botiquín/tratamiento y purga de imagen.
- `POST /api/recetas/:id/descartar`: Rechazo de lectura, purga de imagen y limpieza de lectura pendiente.
- `GET /api/catalogo/buscar`: Búsqueda autocompletable sobre `medicamentos.json`.
- `POST /api/conciliacion`: Cotejo cruzado de tratamientos temporales vs botiquín base (duplicidades e interacciones).

