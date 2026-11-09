/**
 * modules/recordatorios/recordatorios.service.js
 * Acceso a Supabase para recordatorios y tomas.
 *
 * Todas las operaciones reciben pacienteId como primer parámetro y filtran por él.
 */

import { supabase } from '../../config/supabase.js';
import { hoyLocal, diaSemanaISO } from '../../lib/fecha.js';

const COLUMNAS_RECORDATORIO = 'id, hora, dias_semana, activo, created_at';

// ─── Listar recordatorios del día ─────────────────────────────────────────────

/**
 * Devuelve los recordatorios del paciente programados para una fecha específica.
 *
 * Criterios:
 *  - recordatorio.activo = true
 *  - item.activo = true
 *  - item.fecha_inicio <= fecha y (item.fecha_fin es null o >= fecha)
 *  - recordatorio.dias_semana incluye diaSemanaISO(fecha)
 *
 * @param {string} pacienteId
 * @param {string} fecha - 'YYYY-MM-DD'
 * @returns {Promise<Array>}
 */
export async function listarRecordatoriosDelDia(pacienteId, fecha) {
  const diaISO = diaSemanaISO(fecha);

  // 1. Obtener ítems activos y vigentes para esa fecha
  const { data: items, error: errItems } = await supabase
    .from('botiquin_items')
    .select('id, nombre_capturado, denominacion_generica, dosis, fecha_inicio, fecha_fin')
    .eq('paciente_id', pacienteId)
    .eq('activo', true)
    .lte('fecha_inicio', fecha);

  if (errItems) throw errItems;
  if (!items || items.length === 0) return [];

  // Filtrar items cuya fecha_fin no haya vencido
  const itemsVigentes = items.filter(
    (it) => !it.fecha_fin || it.fecha_fin >= fecha
  );
  if (itemsVigentes.length === 0) return [];

  const itemMap = Object.fromEntries(
    itemsVigentes.map((it) => [
      it.id,
      {
        id: it.id,
        nombre_capturado: it.nombre_capturado,
        denominacion_generica: it.denominacion_generica,
        dosis: it.dosis,
      },
    ])
  );
  const itemIds = Object.keys(itemMap);

  // 2. Obtener recordatorios activos de esos ítems
  const { data: recordatorios, error: errRec } = await supabase
    .from('recordatorios')
    .select('id, item_id, hora, dias_semana')
    .eq('paciente_id', pacienteId)
    .eq('activo', true)
    .in('item_id', itemIds)
    .order('hora', { ascending: true });

  if (errRec) throw errRec;
  if (!recordatorios || recordatorios.length === 0) return [];

  // Filtrar por dia_semana aplicable
  const recsDelDia = recordatorios.filter((r) =>
    Array.isArray(r.dias_semana) && r.dias_semana.includes(diaISO)
  );
  if (recsDelDia.length === 0) return [];

  // 3. Consultar tomas registradas en esa fecha para esos recordatorios
  const recIds = recsDelDia.map((r) => r.id);
  const { data: tomas, error: errTomas } = await supabase
    .from('tomas')
    .select('recordatorio_id, tomada_at')
    .eq('paciente_id', pacienteId)
    .eq('fecha', fecha)
    .in('recordatorio_id', recIds);

  if (errTomas) throw errTomas;

  const tomasMap = Object.fromEntries(
    (tomas ?? []).map((t) => [t.recordatorio_id, t.tomada_at])
  );

  // 4. Mapear respuesta final (sin ids internos extra)
  return recsDelDia.map((r) => {
    const tomada_at = tomasMap[r.id] ?? null;
    return {
      id: r.id,
      hora: r.hora,
      dias_semana: r.dias_semana,
      item: itemMap[r.item_id],
      tomada: Boolean(tomada_at),
      tomada_at,
    };
  });
}

// ─── Crear recordatorio ───────────────────────────────────────────────────────

/**
 * Crea un recordatorio para un medicamento existente y activo del paciente.
 *
 * @param {string} pacienteId
 * @param {{ item_id: string, hora: string, dias_semana?: number[] }} datos
 * @returns {Promise<object>}
 */
export async function crearRecordatorio(pacienteId, { item_id, hora, dias_semana = [1, 2, 3, 4, 5, 6, 7] }) {
  // Verificar que el ítem exista, pertenezca al paciente y esté activo
  const { data: item, error: errItem } = await supabase
    .from('botiquin_items')
    .select('id, activo')
    .eq('paciente_id', pacienteId)
    .eq('id', item_id)
    .maybeSingle();

  if (errItem) throw errItem;
  if (!item || !item.activo) {
    return null; // Ruta responderá 404
  }

  const nuevo = {
    paciente_id: pacienteId,
    item_id,
    hora,
    dias_semana,
    activo: true,
  };

  const { data, error } = await supabase
    .from('recordatorios')
    .insert(nuevo)
    .select('id, hora, dias_semana, activo, created_at')
    .single();

  if (error) throw error;
  return data;
}

// ─── Registrar toma de hoy ────────────────────────────────────────────────────

/**
 * Registra la toma de HOY para el recordatorio indicado.
 * Idempotente: si ya se tomó hoy (23505), devuelve la toma original sin error.
 *
 * @param {string} pacienteId
 * @param {string} recordatorioId
 * @returns {Promise<{ ok: true, data: object } | { ok: false, razon: 'NO_ENCONTRADO'|'NO_PROGRAMADO_HOY' }>}
 */
export async function registrarTomaHoy(pacienteId, recordatorioId) {
  const hoy = hoyLocal();
  const diaISO = diaSemanaISO(hoy);

  // 1. Obtener recordatorio y verificar su ítem asociado
  const { data: rec, error: errRec } = await supabase
    .from('recordatorios')
    .select('id, dias_semana, activo, item_id')
    .eq('paciente_id', pacienteId)
    .eq('id', recordatorioId)
    .maybeSingle();

  if (errRec) throw errRec;
  if (!rec || !rec.activo) {
    return { ok: false, razon: 'NO_ENCONTRADO' };
  }

  // Verificar que el ítem esté activo
  const { data: item, error: errItem } = await supabase
    .from('botiquin_items')
    .select('id, activo')
    .eq('paciente_id', pacienteId)
    .eq('id', rec.item_id)
    .maybeSingle();

  if (errItem) throw errItem;
  if (!item || !item.activo) {
    return { ok: false, razon: 'NO_ENCONTRADO' };
  }

  // Verificar si hoy está programado
  if (!Array.isArray(rec.dias_semana) || !rec.dias_semana.includes(diaISO)) {
    return { ok: false, razon: 'NO_PROGRAMADO_HOY' };
  }

  // 2. Insertar toma (idempotente)
  const { error: errIns } = await supabase
    .from('tomas')
    .insert({
      paciente_id: pacienteId,
      recordatorio_id: recordatorioId,
    });

  // 23505 = ya existía toma para hoy, no es error
  if (errIns && errIns.code !== '23505') {
    throw errIns;
  }

  // 3. Leer la toma de hoy
  const { data: toma, error: errToma } = await supabase
    .from('tomas')
    .select('tomada_at')
    .eq('paciente_id', pacienteId)
    .eq('recordatorio_id', recordatorioId)
    .eq('fecha', hoy)
    .single();

  if (errToma) throw errToma;

  return {
    ok: true,
    data: {
      recordatorio_id: recordatorioId,
      tomada: true,
      tomada_at: toma.tomada_at,
    },
  };
}

