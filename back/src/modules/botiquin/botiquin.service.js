/**
 * modules/botiquin/botiquin.service.js
 * Todo el acceso a Supabase relacionado con botiquin_items y tratamientos.
 * Nunca se llama directamente desde las rutas; siempre pasa por botiquin.routes.js.
 *
 * Regla de oro: pacienteId es siempre el primer parámetro y se aplica
 * en CADA consulta como filtro obligatorio.
 */

import { supabase } from '../../config/supabase.js';
import { hoyLocal } from '../../lib/fecha.js';

// Columnas devueltas al cliente (nunca paciente_id ni user_id)
const COLUMNAS_ITEM =
  'id, nombre_capturado, denominacion_generica, principios_activos, ' +
  'concentracion, forma_farmaceutica, dosis, frecuencia, frecuencia_horas, ' +
  'duracion_dias, semaforo, confianza, verificado, activo, fecha_inicio, fecha_fin, ' +
  'created_at, updated_at';

// ─── Listar ───────────────────────────────────────────────────────────────────

/**
 * Devuelve los ítems del botiquín del paciente con su tratamiento embebido.
 *
 * @param {string} pacienteId
 * @param {{ tipo: 'base'|'temporal'|'todos', activo: 'true'|'false'|'todos' }} filtros
 * @returns {object[]}
 */
export async function listarItems(pacienteId, { tipo = 'base', activo = 'true' } = {}) {
  // Primero obtenemos los tratamientos del paciente (con filtro de tipo si aplica)
  let tratQ = supabase
    .from('tratamientos')
    .select('id, tipo, origen, fecha_receta')
    .eq('paciente_id', pacienteId);

  if (tipo !== 'todos') {
    tratQ = tratQ.eq('tipo', tipo);
  }

  const { data: tratamientos, error: errTrat } = await tratQ;
  if (errTrat) throw errTrat;
  if (!tratamientos || tratamientos.length === 0) return [];

  const tratamientoIds = tratamientos.map((t) => t.id);
  const tratamientoMap = Object.fromEntries(tratamientos.map((t) => [t.id, t]));

  // Luego obtenemos los ítems de esos tratamientos
  let itemQ = supabase
    .from('botiquin_items')
    .select(`${COLUMNAS_ITEM}, tratamiento_id`)
    .eq('paciente_id', pacienteId)
    .in('tratamiento_id', tratamientoIds)
    .order('created_at', { ascending: false });

  if (activo !== 'todos') {
    itemQ = itemQ.eq('activo', activo === 'true');
  }

  const { data: items, error: errItems } = await itemQ;
  if (errItems) throw errItems;

  // Embebemos el tratamiento en cada ítem y quitamos tratamiento_id interno
  return (items ?? []).map(({ tratamiento_id, ...item }) => ({
    ...item,
    tratamiento: tratamientoMap[tratamiento_id] ?? null,
  }));
}

// ─── Leer uno ─────────────────────────────────────────────────────────────────

/**
 * Obtiene un ítem por id, filtrando siempre por pacienteId.
 * Devuelve null si no existe o pertenece a otro paciente.
 *
 * @param {string} pacienteId
 * @param {string} itemId
 * @returns {object|null}
 */
export async function obtenerItem(pacienteId, itemId) {
  const { data, error } = await supabase
    .from('botiquin_items')
    .select(COLUMNAS_ITEM)
    .eq('paciente_id', pacienteId)
    .eq('id', itemId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

// ─── Crear (captura manual) ───────────────────────────────────────────────────

/**
 * Reutiliza o crea un tratamiento base/manual y añade el ítem.
 *
 * @param {string} pacienteId
 * @param {object} campos - datos del body ya validados
 * @returns {object} ítem creado
 */
export async function crearItemManual(pacienteId, campos) {
  // Buscar el tratamiento más reciente de tipo 'base' y origen 'manual'
  const { data: tratExistente, error: errTrat } = await supabase
    .from('tratamientos')
    .select('id')
    .eq('paciente_id', pacienteId)
    .eq('tipo', 'base')
    .eq('origen', 'manual')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (errTrat) throw errTrat;

  let tratamientoId = tratExistente?.id;

  // Si no existe, crear uno
  if (!tratamientoId) {
    const { data: nuevoTrat, error: errNuevo } = await supabase
      .from('tratamientos')
      .insert({ paciente_id: pacienteId, tipo: 'base', origen: 'manual' })
      .select('id')
      .single();

    if (errNuevo) throw errNuevo;
    tratamientoId = nuevoTrat.id;
  }

  // Preparar datos del ítem
  const fecha_inicio = campos.fecha_inicio ?? hoyLocal();
  let fecha_fin = null;

  if (campos.duracion_dias) {
    const inicio = new Date(`${fecha_inicio}T12:00:00Z`);
    inicio.setUTCDate(inicio.getUTCDate() + Number(campos.duracion_dias));
    fecha_fin = inicio.toISOString().slice(0, 10);
  }

  const nuevoItem = {
    paciente_id: pacienteId,
    tratamiento_id: tratamientoId,
    nombre_capturado: campos.nombre_capturado,
    concentracion: campos.concentracion ?? null,
    forma_farmaceutica: campos.forma_farmaceutica ?? null,
    dosis: campos.dosis ?? null,
    frecuencia: campos.frecuencia ?? null,
    frecuencia_horas: campos.frecuencia_horas ?? null,
    duracion_dias: campos.duracion_dias ?? null,
    fecha_inicio,
    fecha_fin,
    // Fijos en captura manual
    semaforo: 'rojo',
    verificado: false,
    principios_activos: '{}',
    catalogo_id: null,
  };

  const { data, error } = await supabase
    .from('botiquin_items')
    .insert(nuevoItem)
    .select(COLUMNAS_ITEM)
    .single();

  if (error) throw error;
  return data;
}

// ─── Actualizar ───────────────────────────────────────────────────────────────

/**
 * Actualiza los campos editables de un ítem.
 *
 * @param {string} pacienteId
 * @param {string} itemId
 * @param {object} cambios - solo campos de la lista blanca
 * @returns {object|null} ítem actualizado o null si no existe
 */
export async function actualizarItem(pacienteId, itemId, cambios) {
  const { data, error } = await supabase
    .from('botiquin_items')
    .update(cambios)
    .eq('paciente_id', pacienteId)
    .eq('id', itemId)
    .select(COLUMNAS_ITEM)
    .maybeSingle();

  if (error) throw error;
  return data;
}

// ─── Baja lógica ──────────────────────────────────────────────────────────────

/**
 * Desactiva el ítem (baja lógica) y desactiva todos sus recordatorios.
 *
 * @param {string} pacienteId
 * @param {string} itemId
 * @returns {{ id: string, activo: false }|null}
 */
export async function darDeBajaItem(pacienteId, itemId) {
  const hoy = hoyLocal();

  // Verificar existencia
  const { data: existente, error: errEx } = await supabase
    .from('botiquin_items')
    .select('id, fecha_fin')
    .eq('paciente_id', pacienteId)
    .eq('id', itemId)
    .maybeSingle();

  if (errEx) throw errEx;
  if (!existente) return null;

  // Baja lógica del ítem
  const { error: errItem } = await supabase
    .from('botiquin_items')
    .update({
      activo: false,
      fecha_fin: existente.fecha_fin ?? hoy,
    })
    .eq('paciente_id', pacienteId)
    .eq('id', itemId);

  if (errItem) throw errItem;

  // Desactivar recordatorios del ítem
  const { error: errRec } = await supabase
    .from('recordatorios')
    .update({ activo: false })
    .eq('paciente_id', pacienteId)
    .eq('item_id', itemId);

  if (errRec) throw errRec;

  return { id: itemId, activo: false };
}

