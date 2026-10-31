-- Mi Bodega v3 · Ejecutar una sola vez en Supabase > SQL Editor
-- Cada cuenta autenticada accede EXCLUSIVAMENTE a su propio inventario.
-- NUNCA usar una service_role key en la aplicación web.
create table if not exists public.bodega_inventories (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revision bigint not null default 1 check (revision >= 1),
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.bodega_inventories enable row level security;
revoke all on public.bodega_inventories from anon;
grant select,insert,update on public.bodega_inventories to authenticated;

drop policy if exists "bodega_select_own" on public.bodega_inventories;
drop policy if exists "bodega_insert_own" on public.bodega_inventories;
drop policy if exists "bodega_update_own" on public.bodega_inventories;
create policy "bodega_select_own" on public.bodega_inventories
for select to authenticated using (auth.uid() = user_id);
create policy "bodega_insert_own" on public.bodega_inventories
for insert to authenticated with check (auth.uid() = user_id);
create policy "bodega_update_own" on public.bodega_inventories
for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Ensure updated_at changes for cloud diagnostics.
create or replace function public.bodega_set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists bodega_timestamp on public.bodega_inventories;
create trigger bodega_timestamp before update on public.bodega_inventories
for each row execute function public.bodega_set_updated_at();
