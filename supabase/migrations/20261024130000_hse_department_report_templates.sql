-- Department-specific HSE/PA checklists. Report items remain immutable snapshots.
ALTER TABLE public.hse_reports
  ADD COLUMN department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL;
DO $$
DECLARE constraint_row record;
BEGIN
  FOR constraint_row IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.hse_reports'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) = 'UNIQUE (employee_id, site_id, work_date, shift, report_kind)'
  LOOP
    EXECUTE format('ALTER TABLE public.hse_reports DROP CONSTRAINT %I', constraint_row.conname);
  END LOOP;
END;
$$;
ALTER TABLE public.hse_reports
  ADD CONSTRAINT hse_reports_department_scope_unique
  UNIQUE (employee_id, department_id, site_id, work_date, shift, report_kind);
CREATE INDEX hse_reports_department_idx ON public.hse_reports(department_id, work_date DESC);

CREATE TABLE public.hse_report_template_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  report_kind text NOT NULL CHECK (report_kind IN ('hse', 'permit_authorizer')),
  item_key text NOT NULL,
  item_label text NOT NULL CHECK (char_length(trim(item_label)) BETWEEN 2 AND 240),
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (department_id, report_kind, item_key)
);
CREATE INDEX hse_report_template_items_lookup_idx
  ON public.hse_report_template_items(department_id, report_kind, active, sort_order);
ALTER TABLE public.hse_report_template_items ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hse_report_template_items TO authenticated;
GRANT ALL ON public.hse_report_template_items TO service_role;

CREATE OR REPLACE FUNCTION public.hse_can_manage_report_template(_user_id uuid, _department_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(_user_id, 'admin') OR public.has_role(_user_id, 'hr') OR (
    public.has_role(_user_id, 'department_manager')
    AND public.can_access_department(_user_id, _department_id)
  )
$$;
REVOKE ALL ON FUNCTION public.hse_can_manage_report_template(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hse_can_manage_report_template(uuid, uuid) TO authenticated;

CREATE POLICY hse_report_templates_read ON public.hse_report_template_items
  FOR SELECT TO authenticated USING (
    public.hse_is_staff(auth.uid())
    OR public.hse_can_manage_report_template(auth.uid(), department_id)
  );
CREATE POLICY hse_report_templates_insert ON public.hse_report_template_items
  FOR INSERT TO authenticated WITH CHECK (
    created_by = auth.uid()
    AND public.hse_can_manage_report_template(auth.uid(), department_id)
  );
CREATE POLICY hse_report_templates_update ON public.hse_report_template_items
  FOR UPDATE TO authenticated USING (
    public.hse_can_manage_report_template(auth.uid(), department_id)
  ) WITH CHECK (
    public.hse_can_manage_report_template(auth.uid(), department_id)
  );
CREATE POLICY hse_report_templates_delete ON public.hse_report_template_items
  FOR DELETE TO authenticated USING (
    public.hse_can_manage_report_template(auth.uid(), department_id)
  );

-- Seed each department with its own editable HSE and permit-authorizer checklists.
INSERT INTO public.hse_report_template_items
  (department_id, report_kind, item_key, item_label, sort_order)
SELECT d.id, defaults.report_kind, defaults.item_key, defaults.item_label,
       defaults.sort_order
FROM public.departments d
CROSS JOIN (VALUES
  ('hse','tbt','تم تنفيذ Toolbox Talk (TBT) للطاقم',10),
  ('hse','ppe','الالتزام بمعدات الوقاية الشخصية (PPE)',20),
  ('hse','ptw','التصاريح (PTW) معلقة وسارية في موقع العمل',30),
  ('hse','gas','فحص الغاز (H2S / LEL) وأجهزة الكشف تعمل',40),
  ('hse','housekeeping','النظافة والترتيب (Housekeeping)',50),
  ('hse','lifting','عمليات الرفع آمنة ومخططة',60),
  ('hse','journey','سلامة القيادة والمركبات (Journey Management)',70),
  ('hse','fire','معدات الإطفاء ونقاط التجمع جاهزة',80),
  ('hse','environment','لا توجد تسربات أو انسكابات بيئية',90),
  ('hse','incident','لم تسجل حوادث أو Near Miss',100),
  ('hse','driver','وثائق السائقين الجدد مكتملة',110),
  ('permit_authorizer','ptw_valid','تصاريح العمل سارية وموقعة',10),
  ('permit_authorizer','jsa','JSA وتقييم المخاطر مرفقان ومشروحان للطاقم',20),
  ('permit_authorizer','loto','العزل (LOTO / Isolation Certificate) مطبق',30),
  ('permit_authorizer','gas_test','فحص الغاز قبل البدء ومسجل على التصريح',40),
  ('permit_authorizer','hot_work','الأماكن المحصورة والأعمال الساخنة تحت إشراف',50),
  ('permit_authorizer','handover','تسليم واستلام التصاريح بين الشفتات',60),
  ('permit_authorizer','closeout','إغلاق التصاريح المنتهية وإعادة الموقع آمناً',70),
  ('permit_authorizer','equipment','فحص المعدات وصلاحية الشهادات',80),
  ('permit_authorizer','emergency','الفريق يعرف إجراءات الطوارئ ونقاط التجمع',90),
  ('permit_authorizer','site_safe','ترك موقع العمل آمناً ومرتباً عند التعليق أو الإكمال',100)
) AS defaults(report_kind, item_key, item_label, sort_order)
ON CONFLICT (department_id, report_kind, item_key) DO NOTHING;
