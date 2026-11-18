begin;

alter table public.employee_advance_installments
  drop constraint employee_advance_installments_status_check,
  add constraint employee_advance_installments_status_check
    check (status in ('scheduled', 'deducted', 'waived', 'settled_outside_payroll'));

create table public.employee_advance_closures (
  advance_id uuid primary key references public.employee_advances(id) on delete restrict,
  action text not null check (action in ('waive', 'complete')),
  reason text not null check (char_length(btrim(reason)) between 2 and 2000),
  amount numeric(12,2) not null check (amount > 0),
  closed_at timestamptz not null default now(),
  closed_by uuid references auth.users(id) on delete set null
);

alter table public.employee_advance_closures enable row level security;
revoke all on public.employee_advance_closures from public, anon, authenticated;
grant select on public.employee_advance_closures to authenticated;
grant all on public.employee_advance_closures to service_role;
create policy "finance reads advance closures"
  on public.employee_advance_closures for select to authenticated
  using ((select public.erp_finance_access()));

create function public.close_employee_advance(p_advance_id uuid, p_action text, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_run record;
  v_status text;
  v_amount numeric;
  v_reason text := regexp_replace(coalesce(p_reason, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g');
begin
  if v_user is null or not (
    public.is_admin(v_user) or public.has_role(v_user, 'hr') or public.has_role(v_user, 'accountant')
  ) then
    raise exception 'لا تملك صلاحية إنهاء السلف' using errcode = '42501';
  end if;
  if p_action is null or p_action not in ('waive', 'complete')
    or char_length(v_reason) not between 2 and 2000 then
    raise exception 'حدد الإجراء وأدخل السبب أو التوجيه (من حرفين إلى 2000 حرف)';
  end if;

  -- Payroll payment locks the run before changing its installments.
  for v_run in
    select r.status from public.payroll_runs r
    where exists (
      select 1 from public.employee_advance_installments i
      where i.advance_id = p_advance_id and i.month = r.month and i.status = 'scheduled'
    )
    order by r.month for update of r
  loop
    if v_run.status in ('review', 'approved') then
      raise exception 'يوجد قسط ضمن مسير قيد المراجعة أو معتمد. عالج المسير أولاً ثم أعد المحاولة';
    end if;
  end loop;

  select status into v_status from public.employee_advances
  where id = p_advance_id for update;
  if not found or v_status <> 'active' then
    raise exception 'السلفة غير نشطة أو تم إغلاقها مسبقاً';
  end if;

  with closed_installments as (
    update public.employee_advance_installments
    set status = case p_action when 'waive' then 'waived' else 'settled_outside_payroll' end
    where advance_id = p_advance_id and status = 'scheduled' and deducted_amount < amount
    returning amount - deducted_amount as balance
  )
  select coalesce(sum(balance), 0) into v_amount from closed_installments;
  if v_amount <= 0 then
    raise exception 'لا يوجد رصيد متبقٍ لهذه السلفة';
  end if;

  update public.employee_advances
  set status = case p_action when 'waive' then 'cancelled' else 'settled' end
  where id = p_advance_id;

  insert into public.employee_advance_closures (advance_id, action, reason, amount, closed_by)
  values (p_advance_id, p_action, v_reason, v_amount, v_user);
end;
$$;

revoke all on function public.close_employee_advance(uuid, text, text) from public, anon;
grant execute on function public.close_employee_advance(uuid, text, text) to authenticated;

commit;
