ALTER TABLE public.site_work_plans
  ADD COLUMN IF NOT EXISTS applicant_name TEXT,
  ADD COLUMN IF NOT EXISTS engineer_notes TEXT;

COMMENT ON COLUMN public.site_work_plans.applicant_name IS 'اسم طالب الخطة';
COMMENT ON COLUMN public.site_work_plans.engineer_notes IS 'ملاحظات المهندس على الخطة النهائية';
