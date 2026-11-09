/**
 * middleware/auth.js
 * Dos middlewares de seguridad que se aplican a todos los endpoints.
 *
 *  autenticar          – verifica el JWT de Supabase Auth y adjunta
 *                        req.user y req.pacienteId.
 *  requerirConsentimiento – bloquea el acceso a datos de salud si el
 *                        paciente no tiene consentimiento vigente.
 */

import { supabase } from '../config/supabase.js';
import { env } from '../config/env.js';

/**
 * autenticar
 *
 * 1. Lee el token del header Authorization: Bearer <jwt>
 * 2. Verifica con supabase.auth.getUser()
 * 3. Deja req.user = { id } y req.pacienteId (puede ser null si aún no se registró)
 */
export async function autenticar(req, res, next) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({
      error: { codigo: 'TOKEN_REQUERIDO', mensaje: 'Se requiere autenticación.' },
    });
  }

  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data?.user) {
    return res.status(401).json({
      error: { codigo: 'TOKEN_INVALIDO', mensaje: 'Token inválido o expirado.' },
    });
  }

  req.user = { id: data.user.id };

  // Buscar el paciente asociado al usuario (puede no existir aún)
  const { data: paciente } = await supabase
    .from('pacientes')
    .select('id')
    .eq('user_id', req.user.id)
    .maybeSingle();

  req.pacienteId = paciente?.id ?? null;

  next();
}

/**
 * requerirConsentimiento
 *
 * Se aplica a todas las rutas de datos de salud (perfil, botiquín, recordatorios).
 * Si no existe un consentimiento vigente para VERSION_AVISO_VIGENTE, responde 403.
 */
export async function requerirConsentimiento(req, res, next) {
  if (!req.pacienteId) {
    return res.status(403).json({
      error: {
        codigo: 'CONSENTIMIENTO_REQUERIDO',
        mensaje: 'Debes completar el registro y aceptar el aviso de privacidad.',
      },
    });
  }

  const { data } = await supabase
    .from('consentimientos')
    .select('id')
    .eq('paciente_id', req.pacienteId)
    .eq('version', env.VERSION_AVISO_VIGENTE)
    .maybeSingle();

  if (!data) {
    return res.status(403).json({
      error: {
        codigo: 'CONSENTIMIENTO_REQUERIDO',
        mensaje: `Debes aceptar el aviso de privacidad versión ${env.VERSION_AVISO_VIGENTE}.`,
      },
    });
  }

  next();
}

