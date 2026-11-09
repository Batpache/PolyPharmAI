# PolyPharmAI | Estructura de los Catálogos JSON y Función de Cada Dato

Este documento define la estructura técnica, tipos de datos y la función clínica y de negocio de cada campo en los archivos de conocimiento local ubicados en `back/src/data/`:
- **`medicamentos.json`**: Diccionario determinista basado en el Padrón de Registros Sanitarios de COFEPRIS.
- **`interacciones.json`**: Matriz curada de fuentes oficiales para detección de interacciones fármaco-fármaco.

---

## 1. `medicamentos.json` (Catálogo Oficial de Medicamentos)

### 1.1 Propósito
Sirve como la **fuente de verdad farmacológica en México**. Al evitar dependencias de APIs externas o internacionales (como RxNorm u OpenFDA, que demostraron discordancias con el mercado nacional), permite:
1. Autocompletado ultrarrápido en el buscador del paciente (`GET /api/catalogo/buscar`).
2. Cotejo y verificación del texto extraído por la IA (Gemini) en recetas médicas.
3. Asignación del semáforo de confianza (**Verde**, **Amarillo** o **Rojo**).
4. Extracción de los principios activos (DCI) para la conciliación.

### 1.2 Ejemplo de Estructura JSON
```json
{
  "id": "COF-001",
  "nombre_comercial": "Cozaar",
  "denominacion_generica": "Losartán potásico",
  "principios_activos": ["losartan"],
  "concentracion": "50 mg",
  "forma_farmaceutica": "Comprimido",
  "registro_sanitario": "123M95 SSA"
}
```

### 1.3 Función de Cada Dato
| Campo | Tipo | Función y Uso en el Sistema |
| :--- | :--- | :--- |
| **`id`** | `string` | **Identificador único en catálogo.** Se almacena en la columna `botiquin_items.catalogo_id`. Permite saber con certeza a qué fármaco oficial corresponde el registro. Si un medicamento fue capturado a mano o no verificado, este campo queda en `null`. |
| **`nombre_comercial`** | `string` | **Nombre de marca o fantasía comercial en México** (ej. *Tempra*, *Cozaar*, *Losec*). Es el nombre con el que comúnmente el paciente o la receta se refieren al producto. Se utiliza para búsquedas y para el cotejo con el texto leído por Gemini. |
| **`denominacion_generica`** | `string` | **Nombre genérico oficial** según el Artículo 225 de la Ley General de Salud (ej. *Paracetamol*, *Losartán potásico*). Se copia a `botiquin_items.denominacion_generica` para que el paciente conozca qué sustancia toma, previniendo duplicidades involuntarias por tomar dos marcas distintas con la misma sustancia. |
| **`principios_activos`** | `string[]` | **Lista normalizada de Denominaciones Comunes Internacionales (DCI)** en minúsculas y sin acentos (ej. `["losartan"]`, o `["sitagliptina", "metformina"]` en fármacos combinados). **Es el campo más crítico**: se copia directamente a `botiquin_items.principios_activos` y es el insumo exclusivo que usa el motor de conciliación para detectar interacciones y duplicidades. |
| **`concentracion`** | `string` | **Cantidad de sustancia activa por unidad de dosis** (ej. `50 mg`, `850 mg`, `50 mcg`). Permite mostrar la dosificación precisa y ayuda a desempatar presentaciones de un mismo medicamento. |
| **`forma_farmaceutica`** | `string` | **Presentación física** (ej. `Tableta`, `Cápsula`, `Comprimido`, `Solución oral`). Se muestra en el botiquín y en los recordatorios para orientar al paciente sobre cómo debe tomarlo. |
| **`registro_sanitario`** | `string` | **Número de registro otorgado por COFEPRIS / Secretaría de Salud** (ej. `123M95 SSA`). Acredita la validez regulatoria del fármaco en territorio mexicano. |

---

## 2. `interacciones.json` (Matriz Curada de Interacciones)

### 2.1 Propósito
Es la base de conocimiento para el endpoint **`/api/conciliacion`**. Al comparar los medicamentos de base contra tratamientos agudos/temporales:
1. Detecta cruces peligrosos entre fármacos.
2. Emite avisos **estrictamente preventivos e informativos** (sin diagnósticos ni juicios de gravedad médica propia).
3. Cita la fuente oficial (COFEPRIS, PLM, Guías de Práctica Clínica CENETEC).

### 2.2 Ejemplo de Estructura JSON
```json
{
  "id": "INT-001",
  "farmaco_a": "losartan",
  "farmaco_b": "ibuprofeno",
  "tipo": "farmacodinamica",
  "severidad": "moderada",
  "efecto": "Los AINEs como el ibuprofeno pueden reducir el efecto antihipertensivo del losartán y aumentar el riesgo de deterioro de la función renal.",
  "fuente": "PLM / Ficha Técnica Oficial COFEPRIS",
  "mensaje_paciente": "El uso simultáneo puede disminuir el control de la presión arterial y afectar los riñones. Consulta a tu médico antes de combinarlos."
}
```

### 2.3 Función de Cada Dato
| Campo | Tipo | Función y Uso en el Sistema |
| :--- | :--- | :--- |
| **`id`** | `string` | **Identificador único de la regla de interacción** (ej. `INT-001`). Sirve para trazabilidad, pruebas unitarias y auditoría médica de la regla. |
| **`farmaco_a`** | `string` | **Principio activo DCI del primer fármaco** (en minúsculas, sin acentos). El algoritmo revisa si este valor existe en el arreglo `principios_activos` de cualquier medicamento del paciente. |
| **`farmaco_b`** | `string` | **Principio activo DCI del segundo fármaco** que entra en conflicto con `farmaco_a`. La comparación es bidireccional (A con B es equivalente a B con A). |
| **`tipo`** | `string` | **Mecanismo farmacológico**: `farmacocinetica` (alteración en absorción, metabolismo como citocromos CYP, o excreción) o `farmacodinamica` (efectos aditivos o antagónicos sobre receptores u órganos). Da sustento científico a la alerta. |
| **`severidad`** | `string` | **Nivel de impacto clínico documental**: `moderada` o `alta`. Ayuda a la interfaz a priorizar visualmente la advertencia sin alarmar innecesariamente al paciente. |
| **`efecto`** | `string` | **Explicación técnica/clínica del efecto adverso**. Resume la consecuencia fisiológica documentada (ej. *hiperpotasemia*, *reducción de eficacia antiagregante*, *sangrado gastrointestinal*). |
| **`fuente`** | `string` | **Referencia documental oficial** (ej. *Ficha Técnica Oficial COFEPRIS*, *PLM*, *Guías CENETEC*). Garantiza la legitimidad regulatoria y médica ante COFEPRIS, demostrando que la app no "inventa" opiniones médicas. |
| **`mensaje_paciente`** | `string` | **Texto redactado en lenguaje claro, empático y preventivo para el usuario lego.** Siempre remite a la consulta médica o farmacéutica (ej. *"Consulta a tu médico antes de combinarlos"*), cumpliendo la regla de nunca prescribir ni suspender tratamientos por cuenta propia. |

