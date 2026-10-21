-- Pronósticos IA: caché compartido de análisis, picks para la sección de efectividad,
-- límite diario de consultas a la IA y perfiles de usuario.
-- Pegar completo en Supabase → SQL Editor → Run. Se puede volver a correr sin perder datos.

-- ---------- Perfiles ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

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

-- ---------- Caché de análisis ----------
-- Un renglón por análisis de la IA. cache_key identifica la consulta (partido + mercados + pregunta);
-- el más reciente que no haya vencido se reutiliza para cualquier usuario.
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

-- ---------- Picks (efectividad) ----------
-- Cada pick que dio la IA, una sola vez aunque lo consulten muchos usuarios (pick_key único).
create table if not exists public.picks (
  id uuid primary key default gen_random_uuid(),
  pick_key text not null unique,
  analysis_id uuid references public.analyses (id) on delete set null,
  origen text not null check (origen in ('partido', 'parlay')),
  game_id text not null,
  game jsonb not null,              -- copia del partido al momento del análisis
  sport text not null,
  league text not null,
  league_name text not null,
  title text not null,
  game_date timestamptz not null,
  mercado text not null,
  seleccion text not null,
  selecciones jsonb,                -- combinadas del mismo partido
  probabilidad int not null check (probabilidad between 1 and 99),
  cuota text,
  cuota_estimada boolean not null default true,
  status text not null default 'pendiente'
    check (status in ('pendiente', 'ganada', 'perdida', 'push', 'anulada')),
  resultado text,                   -- por qué se calificó así
  graded_by text check (graded_by in ('espn', 'web', 'admin')),
  graded_at timestamptz,
  intentos int not null default 0,  -- veces que se intentó calificar sin resultado
  created_at timestamptz not null default now()
);
create index if not exists picks_pending_idx on public.picks (status, game_date);
create index if not exists picks_recent_idx on public.picks (game_date desc);
create index if not exists picks_sport_idx on public.picks (sport, league, game_date desc);

-- ---------- Límite diario de consultas a la IA ----------
create table if not exists public.usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  count int not null default 0,
  primary key (user_id, day)
);

-- Suma una consulta si no se pasó del límite. Devuelve cuántas le quedan, o -1 si ya no tiene.
create or replace function public.use_quota(p_user uuid, p_limit int)
returns int
language plpgsql
as $$
declare
  n int;
begin
  insert into public.usage as u (user_id, day, count)
  values (p_user, current_date, 1)
  on conflict (user_id, day) do update set count = u.count + 1
  where u.count < p_limit
  returning u.count into n;
  if n is null then
    return -1;
  end if;
  return p_limit - n;
end;
$$;

-- Devuelve la consulta si la IA falló.
create or replace function public.refund_quota(p_user uuid)
returns void
language sql
as $$
  update public.usage set count = greatest(count - 1, 0)
  where user_id = p_user and day = current_date;
$$;

-- ---------- Seguridad ----------
-- Todo se lee y escribe desde el servidor con la llave secreta. El navegador solo usa Auth
-- y puede leer su propio perfil.
alter table public.profiles enable row level security;
alter table public.analyses enable row level security;
alter table public.picks enable row level security;
alter table public.usage enable row level security;

drop policy if exists "perfil propio" on public.profiles;
create policy "perfil propio" on public.profiles for select using (auth.uid() = id);

revoke all on function public.use_quota(uuid, int) from public, anon, authenticated;
revoke all on function public.refund_quota(uuid) from public, anon, authenticated;
grant execute on function public.use_quota(uuid, int) to service_role;
grant execute on function public.refund_quota(uuid) to service_role;

-- Para hacerte administrador (sin límite diario y con botón de calificar):
-- update public.profiles set is_admin = true where email = 'tu-correo@ejemplo.com';
