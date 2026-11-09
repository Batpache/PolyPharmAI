/**
 * modules/recordatorios/recordatorios.routes.js
 * Rutas de recordatorios y confirmación de tomas.
 *
 * GET   /api/recordatorios             – recordatorios del día (con filtro opcional ?fecha=YYYY-MM-DD)
 * POST  /api/recordatorios             – crear recordatorio para un medicamento activo
 * PATCH /api/recordatorios/:id/tomado  – confirmar la toma de hoy (idempotente)
 */

import { Router } from 'express';
import { z } from 'zod';
import { autenticar, requerirConsentimiento } from '../../middleware/auth.js';
import { hoyLocal } from '../../lib/fecha.js';
import {
  listarRecordatoriosDelDia,
  crearRecordatorio,
  registrarTomaHoy,
} from './recordatorios.service.js';

const router = Router();
router.use(autenticar, requerirConsentimiento);

// ─── Schemas de validación ────────────────────────────────────────────────────

const uuidSchema = z.string().uuid();

const queryListadoSchema = z
  .object({
    fecha: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato YYYY-MM-DD')
      .optional(),
  })
  .strict();

const horaRegex = /^([01]\d|2[0-3]):[0-5]\d$/;

const crearRecordatorioSchema = z
  .object({
    item_id: z.string().uuid(),
    hora: z.string().regex(horaRegex, 'Formato HH:MM (24h)'),
    dias_semana: z
      .array(z.number().int().min(1).max(7))
      .min(1)
      .max(7)
      .refine((arr) => new Set(arr).size === arr.length, {
        message: 'dias_semana no debe tener números duplicados.',
      })
      .optional(),
  })
  .strict();

// ─── GET /api/recordatorios ───────────────────────────────────────────────────

router.get('/', async (req, res, next) => {
  try {
    const queryResult = queryListadoSchema.safeParse(req.query);

    if (!queryResult.success) {
      return res.status(400).json({
        error: { codigo: 'VALIDACION', mensaje: queryResult.error.issues },
      });
    }

    const fecha = queryResult.data.fecha ?? hoyLocal();
    const data = await listarRecordatoriosDelDia(req.pacienteId, fecha);

    return res.status(200).json({ data });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/recordatorios ──────────────────────────────────────────────────

router.post('/', async (req, res, next) => {
  try {
    const result = crearRecordatorioSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        error: { codigo: 'VALIDACION', mensaje: result.error.issues },
      });
    }

    const recordatorio = await crearRecordatorio(req.pacienteId, result.data);

    if (!recordatorio) {
      return res.status(404).json({
        error: {
          codigo: 'NO_ENCONTRADO',
          mensaje: 'Medicamento no encontrado o inactivo.',
        },
      });
    }

    return res.status(201).json({ data: recordatorio });
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/recordatorios/:id/tomado ──────────────────────────────────────

router.patch('/:id/tomado', async (req, res, next) => {
  try {
    const idResult = uuidSchema.safeParse(req.params.id);

    if (!idResult.success) {
      return res.status(400).json({
        error: { codigo: 'VALIDACION', mensaje: 'El parámetro :id debe ser un UUID.' },
      });
    }

    const resultado = await registrarTomaHoy(req.pacienteId, req.params.id);

    if (!resultado.ok) {
      if (resultado.razon === 'NO_ENCONTRADO') {
        return res.status(404).json({
          error: {
            codigo: 'NO_ENCONTRADO',
            mensaje: 'Recordatorio o medicamento no encontrado o inactivo.',
          },
        });
      }

      if (resultado.razon === 'NO_PROGRAMADO_HOY') {
        return res.status(409).json({
          error: {
            codigo: 'NO_PROGRAMADO_HOY',
            mensaje: 'Este recordatorio no está programado para el día de hoy.',
          },
        });
      }
    }

    return res.status(200).json({ data: resultado.data });
  } catch (err) {
    next(err);
  }
});

export default router;

