begin;
-- Direct reads: existing write policies and service-role ingestion remain independent.
do $$
declare
  rule record;
  predicate text;
  admin_hr text := '(public.is_admin((select auth.uid())) or public.has_role((select auth.uid()),''hr''))';
  staff text := admin_hr || ' or public.has_role((select auth.uid()),''supervisor'') or public.has_role((select auth.uid()),''data_entry'')';
  managers text := admin_hr || ' or public.has_role((select auth.uid()),''supervisor'') or public.has_role((select auth.uid()),''department_manager'')';
  own_employee text := case when exists(select from information_schema.columns where table_schema='public' and table_name='employees' and column_name='user_id')
    then 'employee_id in (select e.id from public.employees e where e.user_id=(select auth.uid()))'
    else 'employee_id=(select public.erp_own_employee_id())' end;
begin
  for rule in select * from (values
    ('employee_weekly_schedules','authenticated read weekly schedules','schedule'),
    ('attendance_daily_overtime','authenticated read daily overtime','overtime'),
    ('vehicles','authenticated read vehicles','fleet'),('vehicle_fuel_vouchers','authenticated read fuel vouchers','fleet'),
    ('vehicle_maintenance_schedules','authenticated read vehicle maintenance schedules','fleet'),
    ('vehicle_monthly_operations','authenticated read vehicle operations','fleet'),
    ('machinery_monthly_operations','authenticated read machinery operations','fleet'),
    ('stock_counts','read counts','stock'),('stock_count_lines','read count lines','stock'),
    ('stock_movements','read movements','stock'),('devices','authenticated read devices','staff'),
    ('department_managers','read dept managers','owner'),('form_role_assignments','read form roles','owner'),
    ('form_events','read form events','event'),('uploaded_files','authenticated read files','upload'),
    ('maintenance_workshops','authenticated read maintenance workshops','staff'),
    ('training_course_types','training course types readable to auth users','member'),
    ('self_attendance_settings','authenticated read self attendance settings','member'),
    ('gamification_badges','authenticated read gamification badges','member'),
    ('report_catalog_items','authenticated read report catalogs','member')
  ) as rules(tbl,old_policy,scope)
  loop
    predicate := case rule.scope
      when 'schedule' then managers || ' or ' || own_employee
      when 'overtime' then admin_hr || ' or public.has_role((select auth.uid()),''accountant'') or public.has_role((select auth.uid()),''supervisor'') or ' || own_employee
      when 'fleet' then staff || ' or public.has_role((select auth.uid()),''accountant'')'
      when 'stock' then staff || ' or public.has_role((select auth.uid()),''warehouse_keeper'')'
      when 'staff' then staff
      when 'owner' then admin_hr || ' or user_id=(select auth.uid())'
      when 'event' then managers || ' or actor=(select auth.uid())'
      when 'upload' then admin_hr || ' or uploaded_by=(select auth.uid())'
      when 'member' then 'public.is_admin((select auth.uid())) or exists(select from public.user_roles ur where ur.user_id=(select auth.uid()))'
    end;
    execute format('alter table public.%I enable row level security',rule.tbl);
    execute format('revoke select on public.%I from public,anon',rule.tbl);
    execute format('drop policy if exists %I on public.%I',rule.old_policy,rule.tbl);
    execute format('create policy erp_scoped_read on public.%I for select to authenticated using (%s)',rule.tbl,predicate);
    -- A permissive FOR ALL policy may also grant SELECT. Intersect those grants with this boundary.
    execute format('create policy erp_scoped_read_guard on public.%I as restrictive for select to authenticated using (%s)',rule.tbl,predicate);
  end loop;
end $$;

alter policy erp_attachment_read on storage.objects using (
  bucket_id in ('vehicle-images','maintenance-attachments','fuel-receipts') and
  (owner_id=(select auth.uid()::text) or public.is_admin((select auth.uid())) or
   public.has_role((select auth.uid()),'hr') or public.has_role((select auth.uid()),'supervisor'))
);
create policy erp_media_read_guard on storage.objects as restrictive for select to authenticated using (
  bucket_id not in ('vehicle-images','maintenance-attachments','fuel-receipts') or
  owner_id=(select auth.uid()::text) or public.is_admin((select auth.uid())) or
  public.has_role((select auth.uid()),'hr') or public.has_role((select auth.uid()),'supervisor')
);

create function public.payroll_read_schedules(p_start date,p_end date) returns table(employee_id public.employee_weekly_schedules.employee_id%type, weekday public.employee_weekly_schedules.weekday%type, start_time public.employee_weekly_schedules.start_time%type, end_time public.employee_weekly_schedules.end_time%type, grace_minutes public.employee_weekly_schedules.grace_minutes%type, effective_from public.employee_weekly_schedules.effective_from%type, effective_until public.employee_weekly_schedules.effective_until%type)
language sql stable security definer set search_path='' as $$
  select r.employee_id, r.weekday, r.start_time, r.end_time, r.grace_minutes, r.effective_from, r.effective_until from public.employee_weekly_schedules r
  where (select public.erp_finance_access()) and r.effective_from < p_end and (r.effective_until is null or r.effective_until >= p_start)
$$;
revoke all on function public.payroll_read_schedules(date,date) from public,anon;
grant execute on function public.payroll_read_schedules(date,date) to authenticated;

create function public.payroll_read_overtime(p_start date,p_end date) returns table(employee_id public.attendance_daily_overtime.employee_id%type, work_date public.attendance_daily_overtime.work_date%type, overtime_hours public.attendance_daily_overtime.overtime_hours%type)
language sql stable security definer set search_path='' as $$
  select r.employee_id, r.work_date, r.overtime_hours from public.attendance_daily_overtime r
  where (select public.erp_finance_access()) and r.work_date >= p_start and r.work_date < p_end
$$;
revoke all on function public.payroll_read_overtime(date,date) from public,anon;
grant execute on function public.payroll_read_overtime(date,date) to authenticated;

create function public.payroll_read_vehicles() returns table(id public.vehicles.id%type, vehicle_no public.vehicles.vehicle_no%type, name public.vehicles.name%type, vehicle_class public.vehicles.vehicle_class%type, daily_rate public.vehicles.daily_rate%type, currency public.vehicles.currency%type, is_active public.vehicles.is_active%type)
language sql stable security definer set search_path='' as $$
  select r.id, r.vehicle_no, r.name, r.vehicle_class, r.daily_rate, r.currency, r.is_active from public.vehicles r
  where (select public.erp_finance_access()) and r.is_active
$$;
revoke all on function public.payroll_read_vehicles() from public,anon;
grant execute on function public.payroll_read_vehicles() to authenticated;

create function public.payroll_read_vehicle_ops(p_start date) returns table(vehicle_id public.vehicle_monthly_operations.vehicle_id%type, month public.vehicle_monthly_operations.month%type, operating_days public.vehicle_monthly_operations.operating_days%type)
language sql stable security definer set search_path='' as $$
  select r.vehicle_id, r.month, r.operating_days from public.vehicle_monthly_operations r
  where (select public.erp_finance_access()) and r.month = p_start
$$;
revoke all on function public.payroll_read_vehicle_ops(date) from public,anon;
grant execute on function public.payroll_read_vehicle_ops(date) to authenticated;

create function public.payroll_read_machinery_ops(p_start date) returns table(machinery_id public.machinery_monthly_operations.machinery_id%type, month public.machinery_monthly_operations.month%type, operating_days public.machinery_monthly_operations.operating_days%type, operating_dates public.machinery_monthly_operations.operating_dates%type)
language sql stable security definer set search_path='' as $$
  select r.machinery_id, r.month, r.operating_days, r.operating_dates from public.machinery_monthly_operations r
  where (select public.erp_finance_access()) and r.month = p_start
$$;
revoke all on function public.payroll_read_machinery_ops(date) from public,anon;
grant execute on function public.payroll_read_machinery_ops(date) to authenticated;
commit;
