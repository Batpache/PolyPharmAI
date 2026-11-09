/**
 * modules/auth/auth.service.js
 * Acceso a Supabase para registro de identidad, perfil y eliminación de cuenta.
 * Nunca se llama desde las rutas directamente: solo a través de auth.routes.js
 */

import { supabase } from '../../config/supabase.js';
import { env } from '../../config/env.js';

// ─── Registro ────────────────────────────────────────────────────────────────

/**
 * Registra (o actualiza de forma idempotente) a un usuario recién creado.
 *
 * Pasos:
 *  1. Upsert en identidades (nombre)
 *  2. Upsert en pacientes sin pisar condiciones existentes (ignoreDuplicates)
 *  3. Insert en consentimientos; si ya existe (23505) se ignora
 *
 * @param {string} userId       - id de Supabase Auth
 * @param {string} nombre       - nombre de la persona (1–120 chars)
 * @param {string} version      - versión del aviso aceptado
 * @returns {{ version: string }}
 */
export async function registrar(userId, nombre, version) {
  // 1. Identidad
  const { error: errId } = await supabase
    .from('identidades')
    .upsert({ user_id: userId, nombre }, { onConflict: 'user_id' });

  if (errId) throw errId;

  // 2. Paciente (sin pisar condiciones)
  const { error: errPac } = await supabase
    .from('pacientes')
    .upsert({ user_id: userId }, { onConflict: 'user_id', ignoreDuplicates: true });

  if (errPac) throw errPac;

  // Leer el id del paciente para consentimientos
  const { data: paciente, error: errRead } = await supabase
    .from('pacientes')
    .select('id')
    .eq('user_id', userId)
    .single();

  if (errRead) throw errRead;

  // 3. Consentimiento (idempotente)
  const { error: errCons } = await supabase
    .from('consentimientos')
    .insert({ paciente_id: paciente.id, version });

  // 23505 = violación de unicidad → ya estaba aceptado, no es error
  if (errCons && errCons.code !== '23505') throw errCons;

  return { version };
}

// ─── Perfil ───────────────────────────────────────────────────────────────────

/**
 * Obtiene el perfil del paciente (nombre + condiciones).
 * El nombre vive en identidades; las condiciones en pacientes.
 *
 * @param {string} userId
 * @param {string} pacienteId
 * @returns {{ nombre: string, condiciones: string[] }}
 */
export async function obtenerPerfil(userId, pacienteId) {
  const [{ data: identidad, error: errId }, { data: paciente, error: errPac }] =
    await Promise.all([
      supabase
        .from('identidades')
        .select('nombre')
        .eq('user_id', userId)
        .single(),
      supabase
        .from('pacientes')
        .select('condiciones')
        .eq('id', pacienteId)
        .single(),
    ]);

  if (errId) throw errId;
  if (errPac) throw errPac;

  return { nombre: identidad.nombre, condiciones: paciente.condiciones };
}

/**
 * Actualiza las condiciones crónicas del paciente.
 * El nombre NO se puede cambiar aquí.
 *
 * @param {string} pacienteId
 * @param {string[]} condiciones - lista limpia (trim + dedup) de hasta 20 elementos
 * @returns {{ condiciones: string[] }}
 */
export async function actualizarCondiciones(pacienteId, condiciones) {
  const { data, error } = await supabase
    .from('pacientes')
    .update({ condiciones })
    .eq('id', pacienteId)
    .select('condiciones')
    .single();

  if (error) throw error;
  return { condiciones: data.condiciones };
}

// ─── Eliminar cuenta ──────────────────────────────────────────────────────────

/**
 * Borra los archivos del paciente en Storage y luego elimina el usuario de Auth.
 * La cascada de la BD borra identidad, paciente y todos sus datos.
 *
 * @param {string} userId
 * @param {string|null} pacienteId
 */
export async function eliminarCuenta(userId, pacienteId) {
  // 1. Limpiar Storage si el paciente existe
  if (pacienteId) {
    const { data: archivos, error: errList } = await supabase.storage
      .from('recetas-temp')
      .list(pacienteId);

    if (errList) throw errList;

    if (archivos && archivos.length > 0) {
      const rutas = archivos.map((f) => `${pacienteId}/${f.name}`);
      const { error: errDel } = await supabase.storage
        .from('recetas-temp')
        .remove(rutas);
      if (errDel) throw errDel;
    }
  }

  // 2. Eliminar usuario de Auth (cascada borra todo lo demás)
  const { error } = await supabase.auth.admin.deleteUser(userId);
  if (error) throw error;
}

