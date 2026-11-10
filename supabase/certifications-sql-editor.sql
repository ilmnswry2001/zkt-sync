BEGIN;
-- Resolve the signed-in account using the existing personnel link.
create or replace function public.get_employee_id_for_user(_user_id uuid)
returns uuid language sql stable security invoker set search_path = public
as $$ select employee_id from public.profiles where id = _user_id and id = auth.uid() $$;
revoke all on function public.get_employee_id_for_user(uuid) from public, anon;
grant execute on function public.get_employee_id_for_user(uuid) to authenticated;

-- Certification, training, and digital form center schema
CREATE TABLE IF NOT EXISTS public.training_course_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name_ar text NOT NULL,
  code text NOT NULL UNIQUE,
  default_validity_months integer NOT NULL DEFAULT 12 CHECK (default_validity_months > 0),
  department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.training_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  course_type_id uuid NOT NULL REFERENCES public.training_course_types(id) ON DELETE RESTRICT,
  request_type text NOT NULL CHECK (request_type IN ('new', 'renewal')),
  target_department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  target_approver_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending_approval' CHECK (status IN ('pending_approval', 'approved', 'rejected', 'completed')),
  notes text,
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.employee_certifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  course_type_id uuid NOT NULL REFERENCES public.training_course_types(id) ON DELETE RESTRICT,
  certificate_no text,
  issue_date date,
  expiry_date date,
  renewal_date date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expiring_soon', 'expired')),
  issuer_name text,
  attachment_url text,
  request_id uuid REFERENCES public.training_requests(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.digital_form_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  category text,
  fields_schema jsonb NOT NULL DEFAULT '[]'::jsonb,
  target_audience text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.digital_form_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.digital_form_templates(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  form_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review', 'approved', 'rejected')),
  reviewer_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  review_notes text,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz
);

CREATE INDEX IF NOT EXISTS training_course_types_active_idx ON public.training_course_types(is_active, department_id);
CREATE INDEX IF NOT EXISTS training_requests_employee_status_idx ON public.training_requests(employee_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS employee_certifications_employee_status_idx ON public.employee_certifications(employee_id, status, expiry_date);
CREATE INDEX IF NOT EXISTS digital_form_submissions_status_idx ON public.digital_form_submissions(status, submitted_at DESC);

ALTER TABLE public.training_course_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_certifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.digital_form_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.digital_form_submissions ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.training_course_types, public.training_requests, public.employee_certifications, public.digital_form_templates, public.digital_form_submissions TO authenticated;
GRANT ALL ON public.training_course_types, public.training_requests, public.employee_certifications, public.digital_form_templates, public.digital_form_submissions TO service_role;

CREATE POLICY "training course types readable to auth users" ON public.training_course_types FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "training course types manage by hr admins" ON public.training_course_types FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'hr') OR public.has_form_role(auth.uid(), 'ceo'))
  WITH CHECK (public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'hr') OR public.has_form_role(auth.uid(), 'ceo'));

CREATE POLICY "training requests employee read own" ON public.training_requests FOR SELECT TO authenticated
  USING (
    employee_id = public.get_employee_id_for_user(auth.uid())
    OR public.is_admin(auth.uid())
    OR public.has_role(auth.uid(), 'hr')
    OR public.has_form_role(auth.uid(), 'ceo')
    OR target_approver_id = public.get_employee_id_for_user(auth.uid())
  );
CREATE POLICY "training requests employee create own" ON public.training_requests FOR INSERT TO authenticated
  WITH CHECK (
    requested_by = auth.uid()
    OR public.is_admin(auth.uid())
    OR public.has_role(auth.uid(), 'hr')
  );
CREATE POLICY "training requests department approvers update" ON public.training_requests FOR UPDATE TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR public.has_role(auth.uid(), 'hr')
    OR public.has_form_role(auth.uid(), 'ceo')
    OR target_approver_id = public.get_employee_id_for_user(auth.uid())
  )
  WITH CHECK (
    public.is_admin(auth.uid())
    OR public.has_role(auth.uid(), 'hr')
    OR public.has_form_role(auth.uid(), 'ceo')
    OR target_approver_id = public.get_employee_id_for_user(auth.uid())
  );

CREATE POLICY "employee certifications employee read own" ON public.employee_certifications FOR SELECT TO authenticated
  USING (
    employee_id = public.get_employee_id_for_user(auth.uid())
    OR public.is_admin(auth.uid())
    OR public.has_role(auth.uid(), 'hr')
    OR public.has_form_role(auth.uid(), 'ceo')
  );
CREATE POLICY "employee certifications hr manage" ON public.employee_certifications FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'hr') OR public.has_form_role(auth.uid(), 'ceo'))
  WITH CHECK (public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'hr') OR public.has_form_role(auth.uid(), 'ceo'));

CREATE POLICY "digital form templates readable to auth users" ON public.digital_form_templates FOR SELECT TO authenticated
  USING (is_active = true OR public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'hr'));
CREATE POLICY "digital form templates manage by hr admins" ON public.digital_form_templates FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'hr'))
  WITH CHECK (public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'hr'));

CREATE POLICY "digital submissions employee read own" ON public.digital_form_submissions FOR SELECT TO authenticated
  USING (
    employee_id = public.get_employee_id_for_user(auth.uid())
    OR public.is_admin(auth.uid())
    OR public.has_role(auth.uid(), 'hr')
    OR public.has_form_role(auth.uid(), 'ceo')
  );
CREATE POLICY "digital submissions employee insert own" ON public.digital_form_submissions FOR INSERT TO authenticated
  WITH CHECK (employee_id = public.get_employee_id_for_user(auth.uid()));
CREATE POLICY "digital submissions hr review" ON public.digital_form_submissions FOR UPDATE TO authenticated
  USING (public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'hr') OR public.has_form_role(auth.uid(), 'ceo'))
  WITH CHECK (public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'hr') OR public.has_form_role(auth.uid(), 'ceo'));

CREATE TRIGGER trg_employee_certifications_updated_at BEFORE UPDATE ON public.employee_certifications FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.training_course_types (name_ar, code, default_validity_months, department_id, is_active)
SELECT * FROM (VALUES
  ('ريكر', 'RCR', 12, NULL::uuid, true),
  ('مسعف', 'EMS', 12, NULL, true),
  ('إطفائي', 'FIR', 12, NULL, true),
  ('إنقاذ أماكن مرتفعة', 'HEI', 6, NULL, true),
  ('إنقاذ أماكن مغلقة', 'CON', 6, NULL, true)
) AS v(name_ar, code, default_validity_months, department_id, is_active)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.digital_form_templates (title, description, category, fields_schema, target_audience, is_active)
VALUES
  ('تحديث المستمسكات', 'تحديث المستمسكات الشخصية والوثائق الرسمية.', 'هوية', '[{"name":"document_type","label":"نوع المستند","type":"select"},{"name":"document_number","label":"رقم المستند","type":"text"}]'::jsonb, 'جميع الموظفين', true),
  ('الحساب المصرفي', 'تحديث بيانات الحساب البنكي لاستلام الرواتب.', 'مالية', '[{"name":"bank_name","label":"اسم البنك","type":"text"},{"name":"iban","label":"IBAN","type":"text"}]'::jsonb, 'جميع الموظفين', true),
  ('السكن وأرقام الطوارئ', 'تحديث عنوان السكن وأرقام الطوارئ.', 'ملف شخصي', '[{"name":"home_address","label":"عنوان السكن","type":"text"},{"name":"emergency_phone","label":"رقم الطوارئ","type":"text"}]'::jsonb, 'جميع الموظفين', true),
  ('استبيان السلامة', 'استبيان السلامة والقيود التشغيلية.', 'السلامة', '[{"name":"hazard_level","label":"مستوى الخطر","type":"select"},{"name":"notes","label":"ملاحظات","type":"textarea"}]'::jsonb, 'الطاقم الميداني', true)
ON CONFLICT DO NOTHING;

create or replace function public.complete_training_request(p_request uuid, p_number text, p_issue date, p_expiry date, p_renewal date, p_attachment text)
returns void language plpgsql security invoker set search_path = public as $$
declare r public.training_requests;
begin
  if p_issue is null or p_expiry is null or p_expiry < p_issue or
    (p_attachment is not null and p_attachment !~* '^https?://') then
    raise exception 'تحقق من تاريخ الإصدار والانتهاء ورابط المرفق';
  end if;
  update public.training_requests set status = 'completed'
  where id = p_request and status = 'approved' returning * into strict r;
  insert into public.employee_certifications(employee_id,course_type_id,request_id,certificate_no,issue_date,expiry_date,renewal_date,attachment_url,created_by,status)
  values (r.employee_id,r.course_type_id,r.id,p_number,p_issue,p_expiry,p_renewal,p_attachment,auth.uid(),
    case when p_expiry < current_date then 'expired' when p_expiry <= current_date + 30 then 'expiring_soon' else 'active' end);
end $$;
revoke all on function public.complete_training_request(uuid,text,date,date,date,text) from public,anon;
grant execute on function public.complete_training_request(uuid,text,date,date,date,text) to authenticated;

-- Resolve the approval recipient from the selected department on the server.
create function public.assign_training_approver() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.employees where id = new.employee_id and status = 'active')
    or not exists (select 1 from public.training_course_types where id = new.course_type_id and is_active) then
    raise exception 'يجب اختيار موظف ودورة نشطين';
  end if;
  select p.employee_id into new.target_approver_id
    from public.departments d join public.profiles p on p.id = d.manager_user_id
    where d.id = new.target_department_id;
  if new.target_approver_id is null then raise exception 'مسؤول القسم غير مرتبط بملف موظف'; end if;
  return new;
end $$;
revoke all on function public.assign_training_approver() from public,anon,authenticated;
create trigger assign_training_request_approver before insert or update of target_department_id
on public.training_requests for each row execute function public.assign_training_approver();

alter policy "digital submissions employee insert own" on public.digital_form_submissions
with check (
  employee_id = public.get_employee_id_for_user(auth.uid()) and status = 'pending_review'
  and exists (select 1 from public.digital_form_templates t where t.id = template_id and t.is_active)
);

NOTIFY pgrst, 'reload schema';
COMMIT;
