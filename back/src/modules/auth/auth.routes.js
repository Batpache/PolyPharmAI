/**
 * modules/auth/auth.routes.js
 * Rutas de autenticación, perfil y cuenta.
 *
 * POST   /api/auth/registro   – alta inicial (idempotente)
 * GET    /api/perfil          – leer nombre + condiciones
 * PUT    /api/perfil          – actualizar condiciones
 * DELETE /api/cuenta          – eliminar cuenta y todos los datos
 */

import { Router } from 'express';
import { z } from 'zod';
import { autenticar, requerirConsentimiento } from '../../middleware/auth.js';
import { env } from '../../config/env.js';
import {
  registrar,
  obtenerPerfil,
  actualizarCondiciones,
  eliminarCuenta,
} from './auth.service.js';

const router = Router();

// ─── Schemas de validación ────────────────────────────────────────────────────

const registroSchema = z
  .object({
    nombre: z.string().min(1).max(120),
    aceptar_consentimiento: z.literal(true),
    version: z.string().min(1).max(40),
  })
  .strict();

const perfilSchema = z
  .object({
    condiciones: z
      .array(z.string().min(1).max(80))
      .max(20),
  })
  .strict();

const cuentaSchema = z
  .object({
    confirmar: z.literal(true),
  })
  .strict();

// ─── POST /api/auth/registro ──────────────────────────────────────────────────

router.post('/auth/registro', autenticar, async (req, res, next) => {
  try {
    const result = registroSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        error: { codigo: 'VALIDACION', mensaje: result.error.issues },
      });
    }

    const { nombre, version } = result.data;

    if (version !== env.VERSION_AVISO_VIGENTE) {
      return res.status(409).json({
        error: {
          codigo: 'AVISO_DESACTUALIZADO',
          mensaje: `La versión del aviso debe ser "${env.VERSION_AVISO_VIGENTE}".`,
        },
      });
    }

    await registrar(req.user.id, nombre.trim(), version);

    return res.status(201).json({ data: { registrado: true, version } });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/perfil ──────────────────────────────────────────────────────────

router.get('/perfil', autenticar, requerirConsentimiento, async (req, res, next) => {
  try {
    const perfil = await obtenerPerfil(req.user.id, req.pacienteId);
    return res.status(200).json({ data: perfil });
  } catch (err) {
    next(err);
  }
});

// ─── PUT /api/perfil ──────────────────────────────────────────────────────────

router.put('/perfil', autenticar, requerirConsentimiento, async (req, res, next) => {
  try {
    const result = perfilSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        error: { codigo: 'VALIDACION', mensaje: result.error.issues },
      });
    }

    // Trim y deduplicar condiciones
    const condiciones = [
      ...new Set(result.data.condiciones.map((c) => c.trim()).filter(Boolean)),
    ];

    if (condiciones.length > 20) {
      return res.status(400).json({
        error: { codigo: 'VALIDACION', mensaje: 'Máximo 20 condiciones.' },
      });
    }

    const data = await actualizarCondiciones(req.pacienteId, condiciones);
    return res.status(200).json({ data });
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/cuenta ───────────────────────────────────────────────────────

router.delete('/cuenta', autenticar, async (req, res, next) => {
  try {
    const result = cuentaSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        error: {
          codigo: 'CONFIRMACION_REQUERIDA',
          mensaje: 'Envía { confirmar: true } para eliminar la cuenta.',
        },
      });
    }

    await eliminarCuenta(req.user.id, req.pacienteId);
    return res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;

