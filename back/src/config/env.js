/**
 * config/env.js
 * Carga y valida todas las variables de entorno al arrancar el servidor.
 * Si falta alguna variable requerida, el proceso termina con mensaje claro.
 */

import 'dotenv/config';

const REQUIRED = [
  'PORT',
  'CORS_ORIGIN',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'VERSION_AVISO_VIGENTE',
  'TZ_APP',
];

const missing = REQUIRED.filter((key) => !process.env[key]);

if (missing.length > 0) {
  console.error(
    `[env] ❌ Faltan variables de entorno requeridas: ${missing.join(', ')}\n` +
      `      Copia .env.example a .env y rellena los valores.`
  );
  process.exit(1);
}

export const env = {
  PORT: Number(process.env.PORT),
  CORS_ORIGIN: process.env.CORS_ORIGIN,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  VERSION_AVISO_VIGENTE: process.env.VERSION_AVISO_VIGENTE,
  TZ_APP: process.env.TZ_APP,
};

