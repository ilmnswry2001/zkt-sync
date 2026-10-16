CREATE TABLE public.daily_workshops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE CHECK (length(trim(name)) BETWEEN 2 AND 120),
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.daily_workshop_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workshop_id uuid NOT NULL REFERENCES public.daily_workshops(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  role_label text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workshop_id, employee_id),
  CHECK (role_label IS NULL OR length(role_label) <= 120)
);

CREATE TABLE public.daily_workshop_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workshop_id uuid NOT NULL REFERENCES public.daily_workshops(id) ON DELETE RESTRICT,
  report_date date NOT NULL,
  notes text,
  recorded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workshop_id, report_date),
  CHECK (notes IS NULL OR length(notes) <= 2000)
);

CREATE TABLE public.daily_workshop_report_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.daily_workshop_reports(id) ON DELETE CASCADE,
  employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  employee_no_snapshot text NOT NULL,
  employee_name_snapshot text NOT NULL,
  role_label text,
  attended boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (report_id, employee_id),
  CHECK (length(employee_name_snapshot) BETWEEN 1 AND 200),
  CHECK (role_label IS NULL OR length(role_label) <= 120)
);

CREATE INDEX daily_workshop_members_roster_idx
  ON public.daily_workshop_members(workshop_id, is_active, created_at);
CREATE INDEX daily_workshop_reports_date_idx
  ON public.daily_workshop_reports(report_date DESC, workshop_id);
CREATE INDEX daily_workshop_report_lines_report_idx
  ON public.daily_workshop_report_lines(report_id, attended);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_workshops TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_workshop_members TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_workshop_reports TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_workshop_report_lines TO authenticated;

ALTER TABLE public.daily_workshops ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_workshop_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_workshop_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_workshop_report_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read daily workshops" ON public.daily_workshops
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "staff manage daily workshops" ON public.daily_workshops
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'hr') OR public.has_role(auth.uid(),'supervisor') OR public.has_role(auth.uid(),'data_entry'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'hr') OR public.has_role(auth.uid(),'supervisor') OR public.has_role(auth.uid(),'data_entry'));

CREATE POLICY "authenticated read daily workshop members" ON public.daily_workshop_members
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "staff manage daily workshop members" ON public.daily_workshop_members
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'hr') OR public.has_role(auth.uid(),'supervisor') OR public.has_role(auth.uid(),'data_entry'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'hr') OR public.has_role(auth.uid(),'supervisor') OR public.has_role(auth.uid(),'data_entry'));

CREATE POLICY "authenticated read daily workshop reports" ON public.daily_workshop_reports
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "staff manage daily workshop reports" ON public.daily_workshop_reports
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'hr') OR public.has_role(auth.uid(),'supervisor') OR public.has_role(auth.uid(),'data_entry'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'hr') OR public.has_role(auth.uid(),'supervisor') OR public.has_role(auth.uid(),'data_entry'));

CREATE POLICY "authenticated read daily workshop report lines" ON public.daily_workshop_report_lines
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "staff manage daily workshop report lines" ON public.daily_workshop_report_lines
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'hr') OR public.has_role(auth.uid(),'supervisor') OR public.has_role(auth.uid(),'data_entry'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'hr') OR public.has_role(auth.uid(),'supervisor') OR public.has_role(auth.uid(),'data_entry'));

CREATE TRIGGER trg_daily_workshops_updated BEFORE UPDATE ON public.daily_workshops
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_daily_workshop_members_updated BEFORE UPDATE ON public.daily_workshop_members
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_daily_workshop_reports_updated BEFORE UPDATE ON public.daily_workshop_reports
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_daily_workshop_report_lines_updated BEFORE UPDATE ON public.daily_workshop_report_lines
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
