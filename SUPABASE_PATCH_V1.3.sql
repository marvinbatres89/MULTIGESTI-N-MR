-- =========================================================
-- MULTIGESTION MR V1.3
-- PARCHE SUPABASE: CAMPOS + ENLACES PRIVADOS
-- Ejecutar UNA VEZ en SQL Editor después de BASE CENTRAL V1.0
-- =========================================================

alter table public.movements
  add column if not exists unit_price numeric(14,2) not null default 0,
  add column if not exists party text;

create or replace function public.redeem_access_link(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_link public.access_links%rowtype;
  v_hash text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  v_hash := encode(digest(p_token, 'sha256'), 'hex');

  select * into v_link
  from public.access_links
  where token_hash = v_hash
    and active = true
    and (expires_at is null or expires_at > now())
    and (max_uses is null or uses_count < max_uses)
  for update;

  if not found then
    raise exception 'Invalid, expired or inactive access link';
  end if;

  insert into public.business_members (business_id, user_id, role, active)
  values (v_link.business_id, auth.uid(), v_link.role, true)
  on conflict (business_id, user_id)
  do update set role = excluded.role, active = true;

  update public.access_links
  set uses_count = uses_count + 1
  where id = v_link.id;

  return v_link.business_id;
end;
$$;

grant execute on function public.redeem_access_link(text) to authenticated;

-- Refuerzo: un colaborador no puede cambiar created_by al editar.
drop policy if exists "movements_update_admin_or_creator" on public.movements;
create policy "movements_update_admin_or_creator"
on public.movements
for update
to authenticated
using (
  public.is_business_admin(business_id)
  or (
    public.can_add_movement(business_id)
    and created_by = auth.uid()
  )
)
with check (
  public.is_business_admin(business_id)
  or (
    public.can_add_movement(business_id)
    and created_by = auth.uid()
  )
);

-- =========================================================
-- FIN PARCHE V1.3
-- =========================================================
