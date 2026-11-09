/**
 * modules/botiquin/botiquin.routes.js
 * CRUD del botiquín del paciente.
 *
 * GET    /api/botiquin          – listar ítems (con filtros tipo/activo)
 * POST   /api/botiquin          – captura manual de un medicamento
 * PATCH  /api/botiquin/:id      – editar campos permitidos
 * DELETE /api/botiquin/:id      – baja lógica
 */

import { Router } from 'express';
import { z } from 'zod';
import { autenticar, requerirConsentimiento } from '../../middleware/auth.js';
import {
  listarItems,
  crearItemManual,
  obtenerItem,
  actualizarItem,
  darDeBajaItem,
} from './botiquin.service.js';

const router = Router();
router.use(autenticar, requerirConsentimiento);

// ─── Schemas de validación ────────────────────────────────────────────────────

const uuidSchema = z.string().uuid();

const queryListadoSchema = z
  .object({
    tipo: z.enum(['base', 'temporal', 'todos']).default('base'),
    activo: z.enum(['true', 'false', 'todos']).default('true'),
  })
  .strict();

// Campos permitidos en POST (captura manual)
// El cliente NO puede enviar semaforo, verificado, principios_activos ni catalogo_id
const crearItemSchema = z
  .object({
    nombre_capturado: z.string().min(1).max(200),
    concentracion: z.string().max(100).optional(),
    forma_farmaceutica: z.string().max(100).optional(),
    dosis: z.string().max(200).optional(),
    frecuencia: z.string().max(200).optional(),
    frecuencia_horas: z.number().int().min(1).max(168).optional(),
    duracion_dias: z.number().int().min(1).max(3650).optional(),
    fecha_inicio: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato YYYY-MM-DD')
      .optional(),
  })
  .strict(); // cualquier campo desconocido = 400

// Campos editables en PATCH (lista blanca)
const CAMPOS_EDITABLES = [
  'dosis',
  'frecuencia',
  'frecuencia_horas',
  'duracion_dias',
  'fecha_inicio',
  'fecha_fin',
  'activo',
];

const patchItemSchema = z
  .object({
    dosis: z.string().max(200).optional(),
    frecuencia: z.string().max(200).optional(),
    frecuencia_horas: z.number().int().min(1).max(168).optional(),
    duracion_dias: z.number().int().min(1).max(3650).optional(),
    fecha_inicio: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    fecha_fin: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
    activo: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, {
    message: 'El body no puede estar vacío.',
  });

// ─── GET /api/botiquin ────────────────────────────────────────────────────────

router.get('/', async (req, res, next) => {
  try {
    const result = queryListadoSchema.safeParse(req.query);

    if (!result.success) {
      return res.status(400).json({
        error: { codigo: 'VALIDACION', mensaje: result.error.issues },
      });
    }

    const items = await listarItems(req.pacienteId, result.data);
    return res.status(200).json({ data: items });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/botiquin ───────────────────────────────────────────────────────

router.post('/', async (req, res, next) => {
  try {
    const result = crearItemSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        error: { codigo: 'VALIDACION', mensaje: result.error.issues },
      });
    }

    const item = await crearItemManual(req.pacienteId, result.data);
    return res.status(201).json({ data: item });
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/botiquin/:id ──────────────────────────────────────────────────

router.patch('/:id', async (req, res, next) => {
  try {
    const idResult = uuidSchema.safeParse(req.params.id);
    if (!idResult.success) {
      return res.status(400).json({
        error: { codigo: 'VALIDACION', mensaje: 'El parámetro :id debe ser un UUID.' },
      });
    }

    const result = patchItemSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        error: { codigo: 'VALIDACION', mensaje: result.error.issues },
      });
    }

    const item = await actualizarItem(req.pacienteId, req.params.id, result.data);

    if (!item) {
      return res.status(404).json({
        error: { codigo: 'NO_ENCONTRADO', mensaje: 'Medicamento no encontrado.' },
      });
    }

    return res.status(200).json({ data: item });
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/botiquin/:id ─────────────────────────────────────────────────

router.delete('/:id', async (req, res, next) => {
  try {
    const idResult = uuidSchema.safeParse(req.params.id);
    if (!idResult.success) {
      return res.status(400).json({
        error: { codigo: 'VALIDACION', mensaje: 'El parámetro :id debe ser un UUID.' },
      });
    }

    const resultado = await darDeBajaItem(req.pacienteId, req.params.id);

    if (!resultado) {
      return res.status(404).json({
        error: { codigo: 'NO_ENCONTRADO', mensaje: 'Medicamento no encontrado.' },
      });
    }

    return res.status(200).json({ data: resultado });
  } catch (err) {
    next(err);
  }
});

export default router;

