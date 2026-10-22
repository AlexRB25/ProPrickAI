-- ProPicksAI: usuarios, suscripciones y créditos (Mercado Pago), caché compartido de análisis,
-- picks para la sección de efectividad, historial de consultas y reportes de fallas.
-- Pegar completo en Supabase → SQL Editor → Run. Se puede volver a correr sin perder datos
-- (los precios ya guardados no se sobrescriben).

-- ---------- Perfiles ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  is_admin boolean not null default false,
  credits int not null default 0 check (credits >= 0),
  blocked boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.profiles add column if not exists credits int not null default 0;
alter table public.profiles add column if not exists blocked boolean not null default false;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Planes, paquetes y tarifas (editables desde /admin) ----------
-- Precios en dólares; Mercado Pago cobra en pesos con MP_USD_RATE.
create table if not exists public.plans (
  id text primary key,
  name text not null,
  price_usd numeric(10, 2) not null check (price_usd > 0),
  months int not null check (months > 0),    -- cada cuántos meses se cobra
  credits int not null check (credits >= 0),  -- créditos que da cada cobro
  active boolean not null default true,
  sort int not null default 0
);

create table if not exists public.credit_packs (
  id text primary key,
  name text not null,
  credits int not null check (credits > 0),
  price_usd numeric(10, 2) not null check (price_usd > 0),
  active boolean not null default true,
  sort int not null default 0
);

-- Créditos que cuesta cada acción.
create table if not exists public.tarifas (
  accion text primary key,
  creditos int not null check (creditos >= 0),
  descripcion text not null
);

insert into public.plans (id, name, price_usd, months, credits, sort) values
  ('mensual', 'Mensual', 9.99, 1, 60, 1),
  ('anual', 'Anual', 99.99, 12, 720, 2)
on conflict (id) do nothing;

insert into public.credit_packs (id, name, credits, price_usd, sort) values
  ('p50', '50 créditos', 50, 5.99, 1),
  ('p120', '120 créditos', 120, 12.99, 2),
  ('p300', '300 créditos', 300, 29.99, 3),
  ('p700', '700 créditos', 700, 64.99, 4)
on conflict (id) do nothing;

insert into public.tarifas (accion, creditos, descripcion) values
  ('analisis', 15, 'Análisis nuevo de un partido'),
  ('analisis_extendido', 5, 'Extra si se eligen más de 3 mercados de estadísticas (córners, props…)'),
  ('analisis_cache', 3, 'Análisis que ya estaba en el caché'),
  ('parlay_partido', 10, 'Parlay: cada partido analizado nuevo'),
  ('parlay_cache', 2, 'Parlay: cada partido que ya estaba en el caché'),
  ('ganador_partido', 3, 'Ganadores: cada partido analizado nuevo'),
  ('ganador_cache', 1, 'Ganadores: cada partido que ya estaba en el caché'),
  ('captura', 15, 'Análisis de captura de pantalla (ventana flotante)')
on conflict (accion) do nothing;

-- ---------- Suscripciones ----------
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  plan_id text not null references public.plans (id),
  source text not null default 'mercadopago' check (source in ('mercadopago', 'admin')),
  status text not null default 'pending' check (status in ('pending', 'authorized', 'paused', 'cancelled')),
  mp_preapproval_id text unique,
  amount numeric(12, 2),
  currency text,
  payer_email text,
  next_payment_date timestamptz,
  paid_until timestamptz,  -- hasta cuándo tiene acceso
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists subscriptions_user_idx on public.subscriptions (user_id, paid_until desc);

-- ¿Tiene acceso hoy? (autorizada, o cancelada pero con el periodo pagado todavía vigente)
create or replace function public.has_active_subscription(p_user uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from public.subscriptions
    where user_id = p_user
      and status in ('authorized', 'cancelled', 'paused')
      and paid_until > now()
  );
$$;

-- ---------- Créditos ----------
-- Todo movimiento de créditos pasa por move_credits y queda en credit_moves.
create table if not exists public.credit_moves (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  delta int not null,
  balance_after int not null,
  reason text not null check (reason in ('suscripcion', 'paquete', 'consulta', 'reembolso', 'admin')),
  ref text,
  admin_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists credit_moves_user_idx on public.credit_moves (user_id, created_at desc);

-- Suma o resta créditos. Lanza 'saldo_insuficiente' si quedaría negativo. Devuelve el saldo nuevo.
create or replace function public.move_credits(p_user uuid, p_delta int, p_reason text, p_ref text default null, p_admin uuid default null)
returns int
language plpgsql
as $$
declare
  bal int;
begin
  update public.profiles set credits = credits + p_delta
  where id = p_user and credits + p_delta >= 0
  returning credits into bal;
  if bal is null then
    if exists (select 1 from public.profiles where id = p_user) then
      raise exception 'saldo_insuficiente';
    end if;
    raise exception 'usuario_no_existe';
  end if;
  insert into public.credit_moves (user_id, delta, balance_after, reason, ref, admin_id)
  values (p_user, p_delta, bal, p_reason, p_ref, p_admin);
  return bal;
end;
$$;

-- ---------- Pagos de Mercado Pago ----------
-- Un renglón por cobro aprobado; el id de Mercado Pago evita dar créditos dos veces.
create table if not exists public.payments (
  mp_id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('suscripcion', 'paquete')),
  ref text not null,        -- plan o paquete
  amount numeric(12, 2) not null,
  currency text not null,
  credits int not null,
  created_at timestamptz not null default now()
);
create index if not exists payments_created_idx on public.payments (created_at desc);

-- Registra un cobro aprobado y da sus créditos una sola vez. true si era nuevo.
create or replace function public.grant_payment(
  p_mp_id text, p_user uuid, p_kind text, p_ref text, p_amount numeric, p_currency text, p_credits int
)
returns boolean
language plpgsql
as $$
begin
  insert into public.payments (mp_id, user_id, kind, ref, amount, currency, credits)
  values (p_mp_id, p_user, p_kind, p_ref, p_amount, p_currency, p_credits)
  on conflict (mp_id) do nothing;
  if not found then
    return false;
  end if;
  if p_credits > 0 then
    perform public.move_credits(p_user, p_credits, p_kind, p_mp_id);
  end if;
  return true;
end;
$$;

-- ---------- Caché de análisis ----------
create table if not exists public.analyses (
  id uuid primary key default gen_random_uuid(),
  cache_key text not null,
  kind text not null check (kind in ('partido', 'parlay')),
  game_id text,
  sport text,
  league text,
  game_date timestamptz,
  result jsonb not null,
  model text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists analyses_key_idx on public.analyses (cache_key, created_at desc);

-- ---------- Historial de consultas (y costo real de la IA) ----------
create table if not exists public.consultas (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete set null,  -- null = tarea automática (calificar)
  tipo text not null check (tipo in ('analisis', 'parlay', 'captura', 'calificacion')),
  titulo text not null,
  creditos int not null default 0,
  costo_usd numeric(10, 4) not null default 0,
  cache boolean not null default false,
  ok boolean not null default true,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists consultas_user_idx on public.consultas (user_id, created_at desc);
create index if not exists consultas_created_idx on public.consultas (created_at desc);

-- ---------- Picks (efectividad) ----------
create table if not exists public.picks (
  id uuid primary key default gen_random_uuid(),
  pick_key text not null unique,
  analysis_id uuid references public.analyses (id) on delete set null,
  origen text not null check (origen in ('partido', 'parlay')),
  game_id text not null,
  game jsonb not null,
  sport text not null,
  league text not null,
  league_name text not null,
  title text not null,
  game_date timestamptz not null,
  mercado text not null,
  seleccion text not null,
  selecciones jsonb,
  probabilidad int not null check (probabilidad between 1 and 99),
  cuota text,
  cuota_estimada boolean not null default true,
  status text not null default 'pendiente'
    check (status in ('pendiente', 'ganada', 'perdida', 'push', 'anulada')),
  resultado text,
  graded_by text check (graded_by in ('espn', 'web', 'admin')),
  graded_at timestamptz,
  intentos int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists picks_pending_idx on public.picks (status, game_date);
create index if not exists picks_recent_idx on public.picks (game_date desc);
create index if not exists picks_sport_idx on public.picks (sport, league, game_date desc);

-- ---------- Reportes de fallas ----------
create table if not exists public.bug_reports (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete set null,
  email text,
  mensaje text not null check (length(mensaje) between 5 and 4000),
  pagina text,
  user_agent text,
  estado text not null default 'nuevo' check (estado in ('nuevo', 'revisado', 'resuelto')),
  nota_admin text,
  created_at timestamptz not null default now()
);
create index if not exists bug_reports_created_idx on public.bug_reports (created_at desc);

-- ---------- Sección pública "Apuestas": parlays publicados, votos y comentarios ----------
-- Nombre que se muestra en comentarios (si no hay, se usa el inicio del correo con asteriscos).
alter table public.profiles add column if not exists alias text;

-- Cada parlay que se armó, una sola vez (parlay_key = picks que lo forman, ordenados).
create table if not exists public.parlays (
  id uuid primary key default gen_random_uuid(),
  parlay_key text not null unique,
  tipo text not null,
  piernas jsonb not null,       -- [{ pick_id, partido, selecciones, probabilidad, cuota, razon, ... }]
  pick_ids uuid[] not null,
  apuestas int not null,
  partidos int not null,
  probabilidad numeric(6, 2) not null,
  cuota_americana text,
  sports text[] not null,
  first_game timestamptz not null, -- se vota hasta que empieza el primer partido
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists parlays_created_idx on public.parlays (created_at desc);
create index if not exists picks_origen_idx on public.picks (origen, created_at desc);

-- Un voto por usuario y apuesta: 1 = le entra, -1 = no le entra.
create table if not exists public.votos (
  user_id uuid not null references auth.users (id) on delete cascade,
  target_type text not null check (target_type in ('pick', 'parlay')),
  target_id uuid not null,
  valor smallint not null check (valor in (-1, 1)),
  created_at timestamptz not null default now(),
  primary key (user_id, target_type, target_id)
);
create index if not exists votos_target_idx on public.votos (target_type, target_id);

create table if not exists public.comentarios (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  target_type text not null check (target_type in ('pick', 'parlay')),
  target_id uuid not null,
  texto text not null check (length(texto) between 1 and 1000),
  oculto boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists comentarios_target_idx on public.comentarios (target_type, target_id, created_at desc);

-- ---------- Tipos agregados después (para bases creadas con una versión anterior de este archivo) ----------
alter table public.analyses drop constraint if exists analyses_kind_check;
alter table public.analyses add constraint analyses_kind_check check (kind in ('partido', 'parlay', 'ganador'));
alter table public.consultas drop constraint if exists consultas_tipo_check;
alter table public.consultas add constraint consultas_tipo_check
  check (tipo in ('analisis', 'parlay', 'ganadores', 'captura', 'calificacion'));

-- ---------- Limpieza de la versión anterior (límite diario) ----------
drop function if exists public.use_quota(uuid, int);
drop function if exists public.refund_quota(uuid);
drop table if exists public.usage;

-- ---------- Seguridad ----------
-- Todo se lee y escribe desde el servidor con la llave secreta. El navegador solo usa Auth
-- y puede leer su propio perfil y los precios.
alter table public.profiles enable row level security;
alter table public.plans enable row level security;
alter table public.credit_packs enable row level security;
alter table public.tarifas enable row level security;
alter table public.subscriptions enable row level security;
alter table public.credit_moves enable row level security;
alter table public.payments enable row level security;
alter table public.analyses enable row level security;
alter table public.consultas enable row level security;
alter table public.picks enable row level security;
alter table public.bug_reports enable row level security;
alter table public.parlays enable row level security;
alter table public.votos enable row level security;
alter table public.comentarios enable row level security;

drop policy if exists "perfil propio" on public.profiles;
create policy "perfil propio" on public.profiles for select using (auth.uid() = id);
drop policy if exists "planes visibles" on public.plans;
create policy "planes visibles" on public.plans for select using (active);
drop policy if exists "paquetes visibles" on public.credit_packs;
create policy "paquetes visibles" on public.credit_packs for select using (active);
drop policy if exists "tarifas visibles" on public.tarifas;
create policy "tarifas visibles" on public.tarifas for select using (true);

revoke all on function public.move_credits(uuid, int, text, text, uuid) from public, anon, authenticated;
revoke all on function public.grant_payment(text, uuid, text, text, numeric, text, int) from public, anon, authenticated;
revoke all on function public.has_active_subscription(uuid) from public, anon, authenticated;
grant execute on function public.move_credits(uuid, int, text, text, uuid) to service_role;
grant execute on function public.grant_payment(text, uuid, text, text, numeric, text, int) to service_role;
grant execute on function public.has_active_subscription(uuid) to service_role;

-- Para hacerte administrador (consultas gratis y acceso a /admin):
-- update public.profiles set is_admin = true where email = 'tu-correo@ejemplo.com';
