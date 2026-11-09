-- =====================================================================
-- PolyPharmAI | Esquema de base de datos (Supabase / PostgreSQL)
--
-- Cómo usarlo:
--   Supabase > SQL Editor > New query > pegar TODO > Run.
--   Si existen las tablas del esquema anterior, ejecutar antes
--   00_reiniciar_tablas.sql (borra datos).
--   Se puede volver a ejecutar sin romper nada (IF NOT EXISTS).
--
-- Relaciones:
--
--   auth.users ─┬─ identidades                     (nombre)
--               └─ pacientes ─┬─ consentimientos
--                             ├─ lecturas          (imagen temporal + resultado de la IA)
--                             └─ tratamientos ── botiquin_items ── recordatorios ── tomas
--                                  (lectura_id → lecturas)
--
-- Decisiones de diseño:
--   * RNF-010: el nombre vive en 'identidades'. Las tablas de salud solo
--     conocen pacientes.id (UUID interno); el único puente con la persona
--     es pacientes.user_id.
--   * RNF-009: todas las tablas de salud llevan paciente_id y el servidor
--     filtra siempre por él. Los FK compuestos impiden que un hijo apunte
--     a un padre de otro paciente.
--   * RNF-002: el servidor usa la llave de servicio (salta RLS), por eso
--     se activa RLS SIN políticas y se revocan permisos a anon y
--     authenticated: la llave pública del navegador no lee nada.
--   * RF-014: borrar el usuario en Supabase Auth borra todo en cascada
--     (los archivos de Storage se borran desde el servidor).
--   * El catálogo COFEPRIS y las interacciones viven en JSON locales.
--     botiquin_items guarda una copia de los principios activos al
--     confirmar, para que la conciliación no dependa del JSON.
--   * Zona horaria: los días de 'tomas' se calculan en America/Mexico_City.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0. Utilidades
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- ---------------------------------------------------------------------
-- 1. identidades: quién es la persona (el correo se queda solo en Auth)
-- ---------------------------------------------------------------------
create table if not exists public.identidades (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  nombre     text not null check (char_length(trim(nombre)) between 1 and 120),
  created_at timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- 2. pacientes: lado de salud con identificador interno propio
--    condiciones = condiciones crónicas declaradas a mano (máx. 20)
-- ---------------------------------------------------------------------
create table if not exists public.pacientes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null unique references auth.users(id) on delete cascade,
  condiciones text[] not null default '{}' check (cardinality(condiciones) <= 20),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- 3. consentimientos: qué versión del aviso aceptó cada paciente y cuándo
--    Una fila por paciente y versión (no se duplica si se acepta dos veces).
-- ---------------------------------------------------------------------
create table if not exists public.consentimientos (
  id          bigint generated always as identity primary key,
  paciente_id uuid not null references public.pacientes(id) on delete cascade,
  version     text not null check (char_length(version) between 1 and 40),
  aceptado_at timestamptz not null default now(),
  unique (paciente_id, version)
);


-- ---------------------------------------------------------------------
-- 4. lecturas: cada vez que se procesa una imagen con la IA
--    imagen_path = ruta en Storage; se pone en NULL al borrar la imagen.
--    confirmada = false mientras el usuario no valide el resultado.
--    Una lectura sin confirmar y con imagen_path es "pendiente": sirve para
--    descartarla y limpiar imágenes abandonadas.
-- ---------------------------------------------------------------------
create table if not exists public.lecturas (
  id          uuid primary key default gen_random_uuid(),
  paciente_id uuid not null references public.pacientes(id) on delete cascade,
  imagen_path text,
  resultado   jsonb not null,
  confirmada  boolean not null default false,
  created_at  timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- 5. tratamientos: una receta (o grupo de medicamentos de un mismo origen)
--    base     = botiquín crónico (ej. receta del cardiólogo)
--    temporal = tratamiento agudo (ej. antibiótico de 7 días)
-- ---------------------------------------------------------------------
create table if not exists public.tratamientos (
  id           uuid primary key default gen_random_uuid(),
  paciente_id  uuid not null references public.pacientes(id) on delete cascade,
  lectura_id   uuid references public.lecturas(id) on delete set null,
  tipo         text not null check (tipo in ('base', 'temporal')),
  origen       text not null default 'receta'
               check (origen in ('receta', 'caja', 'manual')),
  fecha_receta date,
  created_at   timestamptz not null default now(),
  unique (id, paciente_id)  -- lo exigen los FK compuestos de las tablas hijas
);


-- ---------------------------------------------------------------------
-- 6. botiquin_items: cada fila es UN medicamento del paciente
--    El botiquín = el conjunto de filas activas. La baja es lógica
--    (activo = false) para conservar el historial.
-- ---------------------------------------------------------------------
create table if not exists public.botiquin_items (
  id                    uuid primary key default gen_random_uuid(),
  paciente_id           uuid not null references public.pacientes(id) on delete cascade,
  tratamiento_id        uuid not null,

  -- Identificación
  catalogo_id           text,                 -- id en medicamentos.json (sin FK: el catálogo es JSON)
  nombre_capturado      text not null
                        check (char_length(trim(nombre_capturado)) between 1 and 200),
  denominacion_generica text,                 -- RF-09
  principios_activos    text[] not null default '{}',  -- copia (DCI) al confirmar; la usa la conciliación
  concentracion         text,
  forma_farmaceutica    text,

  -- Posología
  dosis                 text,
  frecuencia            text,                 -- texto leído, ej. "cada 8 horas"
  frecuencia_horas      smallint
                        check (frecuencia_horas is null or frecuencia_horas between 1 and 168),
  duracion_dias         smallint
                        check (duracion_dias is null or duracion_dias between 1 and 3650),

  -- Confianza de la lectura (RF-07). Captura manual = 'rojo' + verificado false
  semaforo              text not null check (semaforo in ('verde', 'amarillo', 'rojo')),
  confianza             numeric(4,3) check (confianza is null or confianza between 0 and 1),
  verificado            boolean not null default false,  -- false = "No verificado"

  -- Estado y vigencia (las fechas también rigen los recordatorios)
  activo                boolean not null default true,
  fecha_inicio          date not null default ((now() at time zone 'America/Mexico_City')::date),
  fecha_fin             date,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  foreign key (tratamiento_id, paciente_id)
    references public.tratamientos (id, paciente_id) on delete cascade,
  unique (id, paciente_id),
  check (fecha_fin is null or fecha_fin >= fecha_inicio),
  check (verificado = false or catalogo_id is not null)  -- verificado implica coincidencia en catálogo
);


-- ---------------------------------------------------------------------
-- 7. recordatorios: un horario para un medicamento
--    Tres tomas al día = tres recordatorios. dias_semana: 1 = lunes ...
--    7 = domingo (ISO). Inicio y fin salen del propio medicamento.
-- ---------------------------------------------------------------------
create table if not exists public.recordatorios (
  id          uuid primary key default gen_random_uuid(),
  paciente_id uuid not null references public.pacientes(id) on delete cascade,
  item_id     uuid not null,
  hora        time not null,
  dias_semana smallint[] not null default '{1,2,3,4,5,6,7}'
              check (
                cardinality(dias_semana) between 1 and 7
                and dias_semana <@ array[1,2,3,4,5,6,7]::smallint[]
              ),
  activo      boolean not null default true,
  created_at  timestamptz not null default now(),

  foreign key (item_id, paciente_id)
    references public.botiquin_items (id, paciente_id) on delete cascade,
  unique (id, paciente_id)
);


-- ---------------------------------------------------------------------
-- 8. tomas: una fila por cada toma CONFIRMADA (registro de eventos)
--    "Pendiente" = no existe fila ese día. 'fecha' se calcula sola (día en
--    hora de México) y la restricción única impide confirmar dos veces
--    el mismo recordatorio el mismo día.
-- ---------------------------------------------------------------------
create table if not exists public.tomas (
  id              bigint generated always as identity primary key,
  paciente_id     uuid not null references public.pacientes(id) on delete cascade,
  recordatorio_id uuid not null,
  tomada_at       timestamptz not null default now(),
  fecha           date generated always as ((tomada_at at time zone 'America/Mexico_City')::date) stored,

  foreign key (recordatorio_id, paciente_id)
    references public.recordatorios (id, paciente_id) on delete cascade,
  unique (recordatorio_id, fecha)
);


-- ---------------------------------------------------------------------
-- 9. Índices
-- ---------------------------------------------------------------------
create index if not exists idx_lecturas_paciente        on public.lecturas (paciente_id);
create index if not exists idx_lecturas_pendientes      on public.lecturas (created_at) where confirmada = false;
create index if not exists idx_tratamientos_paciente    on public.tratamientos (paciente_id, tipo);
create index if not exists idx_items_paciente_activo    on public.botiquin_items (paciente_id, activo);
create index if not exists idx_items_tratamiento        on public.botiquin_items (tratamiento_id);
create index if not exists idx_recordatorios_paciente   on public.recordatorios (paciente_id, activo);
create index if not exists idx_recordatorios_item       on public.recordatorios (item_id);
create index if not exists idx_tomas_paciente_fecha     on public.tomas (paciente_id, fecha);


-- ---------------------------------------------------------------------
-- 10. Triggers de updated_at
-- ---------------------------------------------------------------------
drop trigger if exists trg_pacientes_updated on public.pacientes;
create trigger trg_pacientes_updated
  before update on public.pacientes
  for each row execute function public.set_updated_at();

drop trigger if exists trg_items_updated on public.botiquin_items;
create trigger trg_items_updated
  before update on public.botiquin_items
  for each row execute function public.set_updated_at();


-- ---------------------------------------------------------------------
-- 11. Seguridad: RLS activado SIN políticas + permisos revocados
--     Solo el servidor (llave de servicio) puede leer y escribir.
--     El panel de Supabase sigue funcionando para el equipo.
-- ---------------------------------------------------------------------
alter table public.identidades      enable row level security;
alter table public.pacientes        enable row level security;
alter table public.consentimientos  enable row level security;
alter table public.lecturas         enable row level security;
alter table public.tratamientos     enable row level security;
alter table public.botiquin_items   enable row level security;
alter table public.recordatorios    enable row level security;
alter table public.tomas            enable row level security;

revoke all on
  public.identidades,
  public.pacientes,
  public.consentimientos,
  public.lecturas,
  public.tratamientos,
  public.botiquin_items,
  public.recordatorios,
  public.tomas
from anon, authenticated;

revoke execute on function public.set_updated_at() from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 12. Storage: bucket PRIVADO para imágenes temporales de recetas
--     Ruta de archivo: '<paciente_id>/<lectura_id>.<ext>'
--     Sin políticas en storage.objects: solo el servidor accede.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'recetas-temp', 'recetas-temp', false, 10485760,  -- 10 MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do nothing;


-- ---------------------------------------------------------------------
-- 13. Verificación: rowsecurity debe ser true en las 8 tablas
-- ---------------------------------------------------------------------
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
order by tablename;
