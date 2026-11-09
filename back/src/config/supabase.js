/**
 * config/supabase.js
 * Cliente de Supabase con la llave de servicio (service role key).
 * Esta llave salta RLS; el filtro por paciente_id en cada consulta
 * es la única barrera de aislamiento entre pacientes.
 *
 * NUNCA exponer esta llave al cliente ni incluirla en logs.
 */

import { createClient } from '@supabase/supabase-js';
import { env } from './env.js';

export const supabase = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      // Desactiva la persistencia de sesión en el servidor; solo verificamos tokens
      persistSession: false,
      autoRefreshToken: false,
    },
  }
);

