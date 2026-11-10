-- Resolve the signed-in account using the existing personnel link.
create or replace function public.get_employee_id_for_user(_user_id uuid)
returns uuid language sql stable security invoker set search_path = public
as $$ select employee_id from public.profiles where id = _user_id and id = auth.uid() $$;
revoke all on function public.get_employee_id_for_user(uuid) from public, anon;
grant execute on function public.get_employee_id_for_user(uuid) to authenticated;
