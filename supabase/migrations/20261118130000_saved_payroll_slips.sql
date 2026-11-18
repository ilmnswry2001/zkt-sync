begin;

create table public.payroll_slip_reports (
  revision uuid primary key default gen_random_uuid(),
  month date not null check (extract(day from month) = 1),
  generated_at timestamptz not null default now(),
  generated_by uuid references auth.users(id) on delete set null,
  rows jsonb not null check (jsonb_typeof(rows) = 'array' and jsonb_array_length(rows) > 0)
);
alter table public.payroll_slip_reports enable row level security;
revoke all on public.payroll_slip_reports from public, anon, authenticated;
grant all on public.payroll_slip_reports to service_role;

create function public.read_latest_payroll_slips(p_page integer, p_search text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_report public.payroll_slip_reports%rowtype;
  v_rows jsonb;
  v_count bigint;
begin
  if not coalesce(public.erp_finance_access(), false) then
    raise exception 'لا تملك صلاحية الاطلاع على قصاصات الرواتب' using errcode = '42501';
  end if;
  if p_page is null or p_page not between 0 and 100000 or length(coalesce(p_search, '')) > 100 then
    raise exception 'مدخلات البحث غير صالحة';
  end if;
  select * into v_report from public.payroll_slip_reports order by generated_at desc, revision desc limit 1;
  if not found then return null; end if;

  with matching as (
    select slip.value, slip.ordinality
    from jsonb_array_elements(v_report.rows) with ordinality as slip(value, ordinality)
    where not exists (
      select 1 from regexp_split_to_table(lower(btrim(coalesce(p_search, ''))), '[[:space:]]+') as term(word)
      where strpos(lower(concat_ws(' ', slip.value #>> '{employee,full_name}', slip.value #>> '{employee,employee_no}')), term.word) = 0
    )
  )
  select
    (select count(*) from matching),
    (select coalesce(jsonb_agg(page.value order by page.ordinality), '[]'::jsonb)
      from (select * from matching order by ordinality limit 20 offset (p_page * 20)) as page)
  into v_count, v_rows;
  return jsonb_build_object(
    'month', to_char(v_report.month, 'YYYY-MM'), 'revision', v_report.revision,
    'generated_at', v_report.generated_at, 'employee_count', jsonb_array_length(v_report.rows),
    'matching_count', v_count, 'rows', v_rows
  );
end;
$$;

create function public.save_payroll_slips(p_month date, p_rows jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null or not (public.is_admin(v_user) or public.has_role(v_user,'hr') or public.has_role(v_user,'accountant')) then
    raise exception 'لا تملك صلاحية إنشاء قصاصات الرواتب' using errcode = '42501';
  end if;
  if p_month is null or extract(day from p_month) <> 1 or jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'بيانات القصاصات غير صالحة';
  end if;
  if jsonb_array_length(p_rows) not between 1 and 20000 or exists (
    select 1 from jsonb_array_elements(p_rows) as slip(row_data)
    where jsonb_typeof(row_data #> '{employee,full_name}') is distinct from 'string'
      or jsonb_typeof(row_data #> '{employee,employee_no}') is distinct from 'string'
      or jsonb_typeof(row_data #> '{summary,presentDays}') is distinct from 'number'
      or jsonb_typeof(row_data #> '{payroll,basePay}') is distinct from 'number'
      or jsonb_typeof(row_data #> '{payroll,overtimeHours}') is distinct from 'number'
      or jsonb_typeof(row_data #> '{payroll,overtimePay}') is distinct from 'number'
      or jsonb_typeof(row_data->'additions') is distinct from 'number'
      or jsonb_typeof(row_data->'deductions') is distinct from 'number'
      or jsonb_typeof(row_data->'total') is distinct from 'number'
      or jsonb_typeof(row_data->'penalties') is distinct from 'array'
  ) then
    raise exception 'تحتوي القصاصات على بيانات ناقصة أو تجاوزت الحد المسموح';
  end if;

  insert into public.payroll_slip_reports (month, rows, generated_by)
  values (p_month, p_rows, v_user);
end;
$$;

create function public.delete_payroll_slips(p_revision uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null or not (public.is_admin(v_user) or public.has_role(v_user,'hr') or public.has_role(v_user,'accountant')) then
    raise exception 'لا تملك صلاحية حذف قصاصات الرواتب' using errcode = '42501';
  end if;
  delete from public.payroll_slip_reports where revision = p_revision;
  if not found then raise exception 'تغير التقرير. حدّث الصفحة قبل الحذف'; end if;
end;
$$;

revoke all on function public.read_latest_payroll_slips(integer, text), public.save_payroll_slips(date, jsonb),
  public.delete_payroll_slips(uuid) from public, anon;
grant execute on function public.read_latest_payroll_slips(integer, text), public.save_payroll_slips(date, jsonb),
  public.delete_payroll_slips(uuid) to authenticated;

commit;
