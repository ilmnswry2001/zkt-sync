ALTER TABLE public.forms
  ADD COLUMN IF NOT EXISTS leave_end_date date,
  ADD COLUMN IF NOT EXISTS leave_days integer NOT NULL DEFAULT 0;

UPDATE public.forms
SET leave_end_date = work_date, leave_days = 1
WHERE kind = 'leave' AND (leave_end_date IS NULL OR leave_days = 0);

CREATE TABLE IF NOT EXISTS public.leave_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  annual_allowance_days integer NOT NULL DEFAULT 21 CHECK (annual_allowance_days BETWEEN 0 AND 365),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_leave_settings_upd ON public.leave_settings;
CREATE TRIGGER trg_leave_settings_upd BEFORE UPDATE ON public.leave_settings
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.leave_settings (id, annual_allowance_days) VALUES (1, 21)
ON CONFLICT (id) DO NOTHING;

GRANT SELECT, INSERT, UPDATE ON public.leave_settings TO authenticated;
GRANT ALL ON public.leave_settings TO service_role;
ALTER TABLE public.leave_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "read leave settings" ON public.leave_settings;
CREATE POLICY "read leave settings" ON public.leave_settings FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "manage leave settings" ON public.leave_settings;
CREATE POLICY "manage leave settings" ON public.leave_settings FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'hr'))
WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'hr'));
