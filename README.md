# PolyPharmAI

Prototipo web para pacientes con polifarmacia: botiquín base, recetas temporales, recordatorios e información de medicamentos.

---

## Estructura del Proyecto

- `back/`: Servidor de backend (Node.js + Express + Supabase SDK).
- `front/`: Cliente web frontend.
- `db/`: Scripts y esquemas de base de datos PostgreSQL/Supabase (`schema.sql`).
- `docs/`: Documentación de arquitectura, endpoints y contexto de requerimientos.

---

## Levantar el Backend (`back/`)

### 1. Requisitos
- Node.js >= 20
- npm >= 10

### 2. Configuración de Variables de Entorno
Copia `back/.env.example` a `back/.env` y completa los valores correspondientes:

```bash
cd back
cp .env.example .env
```

Variables configuradas:
```env
PORT=3001
CORS_ORIGIN=http://localhost:5173
SUPABASE_URL=https://tstvilqgnftkpezysijo.supabase.co
SUPABASE_SERVICE_ROLE_KEY=tu_service_role_key
VERSION_AVISO_VIGENTE=2026-11-v1
TZ_APP=America/Mexico_City
```

### 3. Instalación de dependencias
```bash
cd back
npm install
```

### 4. Ejecución en modo desarrollo
```bash
npm run dev
```

El servidor escuchará en `http://localhost:3001`. Puedes probar el estado con:
```bash
curl http://localhost:3001/api/health
```

---

## Documentación Detallada

- [**Arquitectura, Manejo de Datos y Endpoints**](docs/arquitectura-backend-y-endpoints.md): Explicación exhaustiva del diseño de seguridad (disociación de identidad/salud, multi-tenancy, zona horaria), lógica de negocio y comportamiento de cada endpoint.
- [**Estructura de Catálogos JSON y Función de Datos**](docs/estructura-catalogos-json.md): Detalle técnico de los campos, formatos y propósito clínico/regulatorio de `medicamentos.json` (COFEPRIS) e `interacciones.json`.
- [**Análisis de Implementación de IA**](docs/analisis-implementacion-ia.md): Arquitectura de integración con Gemini Flash, structured outputs y ciclo de vida de recetas médicas.
- [**Contratos de la API (Endpoints)**](docs/api.md): Especificación técnica de parámetros, esquemas Zod y payloads de respuesta.
- [**Colección Postman**](docs/polypharmai_postman_collection.json): Archivo JSON listo para importar y probar los flujos completos.
