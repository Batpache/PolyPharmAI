/**
 * modules/catalogo/catalogo.service.js
 * Servicio de búsqueda y normalización de medicamentos basado en el catálogo COFEPRIS (medicamentos.json).
 * Operaciones ultrarrápidas en memoria (< 5 ms).
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Carga en memoria al iniciar el servidor
const rutaMedicamentos = join(__dirname, '../../data/medicamentos.json');
let catalogoMedicamentos = [];

try {
  const contenido = readFileSync(rutaMedicamentos, 'utf-8');
  catalogoMedicamentos = JSON.parse(contenido);
} catch (err) {
  console.warn('[catalogo] No se pudo cargar medicamentos.json:', err.message);
}

/**
 * Normaliza cadenas de texto: minúsculas, sin tildes ni caracteres especiales.
 * @param {string} texto
 * @returns {string}
 */
export function normalizarTexto(texto = '') {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/**
 * Busca medicamentos por término (nombre comercial, denominación genérica o principio activo).
 * @param {string} termino
 * @param {number} limite
 * @returns {Array}
 */
export function buscarMedicamentos(termino = '', limite = 15) {
  const query = normalizarTexto(termino);
  if (!query) return [];

  const resultados = [];

  for (const item of catalogoMedicamentos) {
    const nomCom = normalizarTexto(item.nombre_comercial);
    const denGen = normalizarTexto(item.denominacion_generica);
    const principios = (item.principios_activos || []).map(normalizarTexto);

    const coincide =
      nomCom.includes(query) ||
      denGen.includes(query) ||
      principios.some((p) => p.includes(query));

    if (coincide) {
      resultados.push(item);
      if (resultados.length >= limite) break;
    }
  }

  return resultados;
}

/**
 * Obtiene un medicamento del catálogo por su ID.
 * @param {string} id
 * @returns {object|null}
 */
export function obtenerMedicamentoPorId(id) {
  return catalogoMedicamentos.find((m) => m.id === id) ?? null;
}

/**
 * Coteja el texto leído de una receta contra el catálogo para asignar semáforo.
 * - Verde: coincidencia exacta o muy alta.
 * - Amarillo: coincidencia parcial.
 * - Rojo: sin coincidencia.
 *
 * @param {string} nombreLeido
 * @returns {{ semaforo: 'verde'|'amarillo'|'rojo', item: object|null, verificado: boolean }}
 */
export function cotejarMedicamento(nombreLeido = '') {
  const query = normalizarTexto(nombreLeido);
  if (!query || query.length < 3) {
    return { semaforo: 'rojo', item: null, verificado: false };
  }

  // 1. Coincidencia exacta por nombre comercial o denominación genérica
  const exacto = catalogoMedicamentos.find(
    (m) =>
      normalizarTexto(m.nombre_comercial) === query ||
      normalizarTexto(m.denominacion_generica) === query
  );

  if (exacto) {
    return { semaforo: 'verde', item: exacto, verificado: true };
  }

  // 2. Coincidencia parcial por prefijo o contiene
  const parciales = buscarMedicamentos(query, 1);
  if (parciales.length > 0) {
    return { semaforo: 'amarillo', item: parciales[0], verificado: true };
  }

  return { semaforo: 'rojo', item: null, verificado: false };
}

