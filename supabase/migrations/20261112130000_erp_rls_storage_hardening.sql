-- Apply as one transaction. Intersection policies preserve existing site/department write scopes.
begin;
-- Account provisioning assigns roles explicitly in accounts.functions.ts. A public signup
-- must not grant itself directory access (or become admin when user_roles is empty).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id,full_name,email) values(new.id,coalesce(new.raw_user_meta_data->>'full_name',new.email),new.email)
  on conflict(id) do nothing;
  return new;
end $$;
revoke all on function public.handle_new_user() from public, anon, authenticated;
create function public.erp_finance_access() returns boolean language sql stable security invoker set search_path = '' as $$
  select auth.uid() is not null and (public.is_admin(auth.uid()) or public.has_role(auth.uid(),'hr')
    or public.has_role(auth.uid(),'accountant') or public.has_form_role(auth.uid(),'ceo'))
$$;
revoke all on function public.erp_finance_access() from public, anon;
grant execute on function public.erp_finance_access() to authenticated;

-- Same verified account email linkage as self-attendance, without trusting editable profile names.
create function public.erp_own_employee_id() returns uuid language sql stable security definer set search_path = '' as $$
  select case when count(*) = 1 then min(e.id::text)::uuid end
  from auth.users u join public.employees e on lower(e.email) = lower(u.email)
  where u.id = auth.uid() and u.email_confirmed_at is not null
$$;
revoke all on function public.erp_own_employee_id() from public, anon;
grant execute on function public.erp_own_employee_id() to authenticated;

do $$
declare
  t text; p record;
  staff text := $p$(public.is_admin(auth.uid()) or public.has_role(auth.uid(),'hr') or public.has_role(auth.uid(),'supervisor')
    or public.has_role(auth.uid(),'department_manager') or public.has_role(auth.uid(),'data_entry') or public.has_role(auth.uid(),'site_admin'))$p$;
  member text := '(public.is_admin(auth.uid()) or exists (select 1 from public.user_roles ur where ur.user_id = (select auth.uid())))';
  condition text;
begin
  foreach t in array array['employees','profiles','wage_rates','salary_additions','employee_penalties',
    'daily_workshops','daily_workshop_members','daily_workshop_reports','daily_workshop_report_lines',
    'attendance_logs','attendance_day_status','site_daily_reports','site_daily_report_lines','site_work_plans',
    'departments','shifts','sites','leave_types','leave_settings','warehouses','warehouse_items','machinery','maintenance_types','navigation_settings']
  loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on table public.%I from anon, public',t);
    if t = any(array['wage_rates','salary_additions','employee_penalties']) then
      for p in select policyname from pg_policies where schemaname='public' and tablename=t and permissive='PERMISSIVE' and roles && array['public','authenticated']::name[] loop
        execute format('drop policy %I on public.%I',p.policyname,t);
      end loop;
      execute format('create policy finance_access on public.%I for all to authenticated using (public.erp_finance_access()) with check (public.erp_finance_access())',t);
      continue;
    end if;
    if t='employees' then
      condition := staff || ' or ' || case when exists(select from information_schema.columns where table_schema='public' and table_name=t and column_name='user_id')
        then 'user_id = (select auth.uid())' else 'id = (select public.erp_own_employee_id())' end;
    elsif t='profiles' then
      condition := 'id = (select auth.uid()) or public.is_admin(auth.uid()) or public.has_role(auth.uid(),''hr'')';
    else
      condition := member;
    end if;
    -- Replace unconditional SELECTs, retain narrower existing permissive policies and intersect ALL-policy grants too.
    for p in select policyname from pg_policies where schemaname='public' and tablename=t and cmd='SELECT'
      and permissive='PERMISSIVE' and qual in ('true','(true)') loop
      execute format('alter policy %I on public.%I using (%s)',p.policyname,t,condition);
    end loop;
    if t in ('employees','profiles') then
      execute format('create policy erp_read_boundary on public.%I as restrictive for select to authenticated using (%s)',t,condition);
    else
      execute format('create policy erp_member_boundary on public.%I as restrictive for all to authenticated using (%s) with check (%s)',t,condition,condition);
      for p in select policyname from pg_policies where schemaname='public' and tablename=t and cmd='INSERT'
        and permissive='PERMISSIVE' and with_check in ('true','(true)') loop
        execute format('alter policy %I on public.%I with check (%s)',p.policyname,t,condition);
      end loop;
    end if;
  end loop;
end $$;

update storage.buckets set public=false where id in ('zk-backups','vehicle-images','maintenance-attachments','fuel-receipts');
do $$
declare prefix text; op text;
begin
  foreach prefix in array array['vehicle images','maintenance attachments','fuel receipts'] loop
    foreach op in array array['read','insert','update','delete'] loop
      execute format('drop policy if exists %I on storage.objects',prefix||' '||op);
    end loop;
  end loop;
end $$;
drop policy if exists "auth upload zk-backups" on storage.objects;
drop policy if exists "auth read zk-backups" on storage.objects;
drop policy if exists "admin delete zk-backups" on storage.objects;
create policy backup_admin on storage.objects for all to authenticated
  using(bucket_id='zk-backups' and public.is_admin(auth.uid())) with check(bucket_id='zk-backups' and public.is_admin(auth.uid()));
create policy erp_attachment_read on storage.objects for select to authenticated
  using(bucket_id in ('vehicle-images','maintenance-attachments','fuel-receipts'));
create policy erp_attachment_write on storage.objects for all to authenticated
  using(bucket_id in ('vehicle-images','maintenance-attachments','fuel-receipts') and
    (public.is_admin(auth.uid()) or public.has_role(auth.uid(),'supervisor') or owner_id=auth.uid()::text))
  with check(bucket_id in ('vehicle-images','maintenance-attachments','fuel-receipts') and
    (public.is_admin(auth.uid()) or public.has_role(auth.uid(),'supervisor') or owner_id=auth.uid()::text));

-- An unrelated permissive policy in storage.objects must not reopen these buckets.
create policy erp_private_bucket_anon on storage.objects as restrictive for all to anon
  using(bucket_id not in ('zk-backups','vehicle-images','maintenance-attachments','fuel-receipts'))
  with check(bucket_id not in ('zk-backups','vehicle-images','maintenance-attachments','fuel-receipts'));
create policy erp_backup_guard on storage.objects as restrictive for all to authenticated
  using(bucket_id <> 'zk-backups' or public.is_admin(auth.uid()))
  with check(bucket_id <> 'zk-backups' or public.is_admin(auth.uid()));
do $$
declare
  writable text := $p$(bucket_id not in ('vehicle-images','maintenance-attachments','fuel-receipts')
    or public.is_admin(auth.uid()) or public.has_role(auth.uid(),'supervisor') or owner_id=auth.uid()::text)$p$;
begin
  execute format('create policy erp_media_insert_guard on storage.objects as restrictive for insert to authenticated with check (%s)',writable);
  execute format('create policy erp_media_update_guard on storage.objects as restrictive for update to authenticated using (%s) with check (%s)',writable,writable);
  execute format('create policy erp_media_delete_guard on storage.objects as restrictive for delete to authenticated using (%s)',writable);
end $$;

-- Payroll reads a fixed projection; financial users do not gain general employee-directory access.
create function public.payroll_employee_directory()
returns table(id uuid, employee_no text, full_name text, "position" text, base_salary numeric, pay_type text,
  salary_type text, contract_type text, bank_name text, bank_account text, iban text, sites jsonb, departments jsonb, wage_rates jsonb, shifts jsonb)
language sql stable security definer set search_path = '' as $$
  select e.id,e.employee_no::text,e.full_name::text,e.position::text,e.base_salary::numeric,e.pay_type::text,
    e.salary_type::text,e.contract_type::text,e.bank_name::text,e.bank_account::text,e.iban::text,
    jsonb_build_object('name',s.name),jsonb_build_object('name',d.name),
    case when w.id is not null then jsonb_build_object('title',w.title,'monthly_rate',w.monthly_rate,'daily_rate',w.daily_rate,'overtime_hour_rate',w.overtime_hour_rate,'currency',w.currency) end,
    case when sh.id is not null then jsonb_build_object('end_time',sh.end_time,'grace_minutes',sh.grace_minutes) end
  from public.employees e left join public.sites s on s.id=e.site_id left join public.departments d on d.id=e.department_id
  left join public.wage_rates w on w.id=e.wage_rate_id left join public.shifts sh on sh.id=e.shift_id
  where (select public.erp_finance_access())
$$;
revoke all on function public.payroll_employee_directory() from public, anon;
grant execute on function public.payroll_employee_directory() to authenticated;
-- The absence-execution RPC also consults this helper under SECURITY DEFINER.
create or replace function public.can_access_employee_penalty(_employee_id uuid) returns boolean
language sql stable security invoker set search_path = '' as $$ select public.erp_finance_access() $$;
create function public.payroll_read_logs(p_start timestamptz,p_end timestamptz) returns table(id public.attendance_logs.id%type, employee_no public.attendance_logs.employee_no%type, verify_time public.attendance_logs.verify_time%type, status public.attendance_logs.status%type, source public.attendance_logs.source%type, self_event_type public.attendance_logs.self_event_type%type)
language sql stable security definer set search_path = '' as $$
  select r.id, r.employee_no, r.verify_time, r.status, r.source, r.self_event_type from public.attendance_logs r where (select public.erp_finance_access()) and r.verify_time >= p_start and r.verify_time < p_end
$$;
revoke all on function public.payroll_read_logs(timestamptz,timestamptz) from public, anon;
grant execute on function public.payroll_read_logs(timestamptz,timestamptz) to authenticated;
create function public.payroll_read_days(p_start date,p_end date) returns table(employee_id public.attendance_day_status.employee_id%type, work_date public.attendance_day_status.work_date%type, status public.attendance_day_status.status%type, notes public.attendance_day_status.notes%type, overtime_hours public.attendance_day_status.overtime_hours%type)
language sql stable security definer set search_path = '' as $$
  select r.employee_id, r.work_date, r.status, r.notes, r.overtime_hours from public.attendance_day_status r where (select public.erp_finance_access()) and r.work_date >= p_start and r.work_date < p_end
$$;
revoke all on function public.payroll_read_days(date,date) from public, anon;
grant execute on function public.payroll_read_days(date,date) to authenticated;
create function public.payroll_read_machinery() returns table(id public.machinery.id%type, code public.machinery.code%type, asset_number public.machinery.asset_number%type, name public.machinery.name%type, category public.machinery.category%type, status public.machinery.status%type, daily_rent public.machinery.daily_rent%type)
language sql stable security definer set search_path = '' as $$
  select r.id, r.code, r.asset_number, r.name, r.category, r.status, r.daily_rent from public.machinery r where (select public.erp_finance_access())
$$;
revoke all on function public.payroll_read_machinery() from public, anon;
grant execute on function public.payroll_read_machinery() to authenticated;
create function public.payroll_read_leave_types() returns table(id public.leave_types.id%type, is_paid public.leave_types.is_paid%type, count_non_working_days public.leave_types.count_non_working_days%type)
language sql stable security definer set search_path = '' as $$
  select r.id, r.is_paid, r.count_non_working_days from public.leave_types r where (select public.erp_finance_access())
$$;
revoke all on function public.payroll_read_leave_types() from public, anon;
grant execute on function public.payroll_read_leave_types() to authenticated;
commit;
-- Hosted Auth, configured separately: Authentication > Sign In / Providers > Email >
-- enable leaked password protection (HIBP) and save. Requires Supabase Pro or higher.
