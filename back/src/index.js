/**
 * index.js
 * Punto de entrada del servidor Express de PolyPharmAI.
 */

import express from 'express';
import cors from 'cors';
import { env } from './config/env.js';
import authRoutes from './modules/auth/auth.routes.js';
import botiquinRoutes from './modules/botiquin/botiquin.routes.js';
import recordatoriosRoutes from './modules/recordatorios/recordatorios.routes.js';

const app = express();

// ─── Middlewares globales ─────────────────────────────────────────────────────

app.use(
  cors({
    origin: env.CORS_ORIGIN,
    credentials: true,
  })
);

app.use(express.json());

// ─── Health check ─────────────────────────────────────────────────────────────

app.get('/api/health', (_req, res) => {
  res.status(200).json({ status: 'ok', app: 'PolyPharmAI API' });
});

// ─── Rutas de la API ──────────────────────────────────────────────────────────

// /api/auth/registro, /api/perfil, /api/cuenta
app.use('/api', authRoutes);

// /api/botiquin (CRUD)
app.use('/api/botiquin', botiquinRoutes);

// /api/recordatorios y tomas
app.use('/api/recordatorios', recordatoriosRoutes);

// ─── Manejo de 404 (rutas no encontradas) ──────────────────────────────────────

app.use((_req, res) => {
  res.status(404).json({
    error: {
      codigo: 'RUTA_NO_ENCONTRADA',
      mensaje: 'El recurso solicitado no existe.',
    },
  });
});

// ─── Manejador global de errores ──────────────────────────────────────────────
// Regla 7: Nunca registrar datos de salud ni tokens en logs
// Regla: Errores internos responden 500 genérico sin detalles de BD
app.use((err, _req, res, _next) => {
  console.error('[error-servidor]', err?.message || 'Error no especificado');

  res.status(500).json({
    error: {
      codigo: 'ERROR_INTERNO',
      mensaje: 'Ocurrió un error en el servidor. Intenta de nuevo más tarde.',
    },
  });
});

// ─── Arranque ─────────────────────────────────────────────────────────────────

app.listen(env.PORT, () => {
  console.log(`🚀 Servidor PolyPharmAI escuchando en http://localhost:${env.PORT}`);
  console.log(`   CORS permitido para: ${env.CORS_ORIGIN}`);
  console.log(`   Versión de aviso vigente: ${env.VERSION_AVISO_VIGENTE}`);
  console.log(`   Zona horaria: ${env.TZ_APP}`);
});

