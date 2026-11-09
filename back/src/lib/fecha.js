/**
 * lib/fecha.js
 * Utilidades de fecha en la zona horaria de la aplicación (America/Mexico_City).
 *
 * Toda la lógica de "hoy" usa TZ_APP para coincidir con la columna
 * tomas.fecha que PostgreSQL calcula con esa misma zona.
 */

import { env } from '../config/env.js';

/**
 * Devuelve la fecha local del servidor en formato 'YYYY-MM-DD'
 * usando la zona horaria TZ_APP (America/Mexico_City por defecto).
 *
 * @param {string} [tz] - zona horaria IANA; por defecto env.TZ_APP
 * @returns {string} 'YYYY-MM-DD'
 */
export function hoyLocal(tz = env.TZ_APP) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
}

/**
 * Devuelve el día de la semana ISO (1 = lunes … 7 = domingo)
 * a partir de una fecha en formato 'YYYY-MM-DD'.
 *
 * Se interpreta el mediodía UTC para evitar desplazamientos de zona.
 *
 * @param {string} fecha - 'YYYY-MM-DD'
 * @returns {number} 1–7
 */
export function diaSemanaISO(fecha) {
  const d = new Date(`${fecha}T12:00:00Z`).getUTCDay(); // 0 = domingo
  return d === 0 ? 7 : d;
}

