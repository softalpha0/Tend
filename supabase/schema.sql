-- Tend: live shared gardens.
-- Run once in your Supabase project: Dashboard > SQL Editor > New query > paste > Run.
--
-- Anyone can read the public part of a garden by its friend code.
-- Only the device that created a garden can update it: it proves this with a
-- random secret that is stored on the device and only ever compared as a hash.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.gardens (
  code text primary key check (code ~ '^[A-Z0-9]{6,10}$'),
  secret_hash text not null,
  name text not null default '' check (char_length(name) <= 20),
  streak integer not null default 0 check (streak between 0 and 9999),
  plants jsonb not null default '[]'::jsonb
    check (jsonb_typeof(plants) = 'array' and jsonb_array_length(plants) <= 12),
  updated_at timestamptz not null default now()
);

-- No policies: the anonymous role cannot read or write the table directly.
alter table public.gardens enable row level security;
revoke all on public.gardens from anon, authenticated;

-- The readable part of each garden (never the secret hash).
create or replace view public.public_gardens as
  select code, name, streak, plants, updated_at from public.gardens;
grant select on public.public_gardens to anon, authenticated;

-- Create or update your own garden.
create or replace function public.upsert_garden(
  p_code text, p_secret text, p_name text, p_streak integer, p_plants jsonb
) returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  existing text;
  hashed text := encode(digest(p_secret, 'sha256'), 'hex');
begin
  if p_secret is null or char_length(p_secret) < 16 then
    raise exception 'invalid secret';
  end if;
  select secret_hash into existing from public.gardens where code = p_code;
  if existing is null then
    insert into public.gardens (code, secret_hash, name, streak, plants)
    values (p_code, hashed, left(coalesce(p_name, ''), 20), greatest(0, least(p_streak, 9999)), p_plants);
  elsif existing = hashed then
    update public.gardens
       set name = left(coalesce(p_name, ''), 20),
           streak = greatest(0, least(p_streak, 9999)),
           plants = p_plants,
           updated_at = now()
     where code = p_code;
  else
    raise exception 'this garden belongs to another device';
  end if;
end;
$$;

revoke all on function public.upsert_garden(text, text, text, integer, jsonb) from public;
grant execute on function public.upsert_garden(text, text, text, integer, jsonb) to anon, authenticated;
