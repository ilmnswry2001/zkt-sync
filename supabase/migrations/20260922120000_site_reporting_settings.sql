-- Report catalog items and daily site reports
CREATE TABLE IF NOT EXISTS public.report_catalog_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('worker_specialty', 'equipment_type')),
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(kind, name)
);

CREATE TABLE IF NOT EXISTS public.site_daily_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  report_date date NOT NULL,
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(site_id, report_date)
);

CREATE TABLE IF NOT EXISTS public.site_daily_report_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.site_daily_reports(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('worker_specialty', 'equipment_type')),
  catalog_item_id uuid REFERENCES public.report_catalog_items(id) ON DELETE SET NULL,
  item_name text NOT NULL,
  total_count integer NOT NULL DEFAULT 0 CHECK (total_count >= 0),
  working_count integer NOT NULL DEFAULT 0 CHECK (working_count >= 0),
  idle_count integer NOT NULL DEFAULT 0 CHECK (idle_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(report_id, kind, item_name)
);

CREATE INDEX IF NOT EXISTS report_catalog_items_order_idx
  ON public.report_catalog_items(kind, is_archived, sort_order, name);
CREATE INDEX IF NOT EXISTS site_daily_reports_date_idx
  ON public.site_daily_reports(report_date, site_id);
CREATE INDEX IF NOT EXISTS site_daily_report_lines_kind_idx
  ON public.site_daily_report_lines(kind, item_name);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.report_catalog_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.site_daily_reports TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.site_daily_report_lines TO authenticated;
GRANT ALL ON public.report_catalog_items, public.site_daily_reports, public.site_daily_report_lines TO service_role;

ALTER TABLE public.report_catalog_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_daily_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_daily_report_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read report catalogs" ON public.report_catalog_items
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin manage report catalogs" ON public.report_catalog_items
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "authenticated read site reports" ON public.site_daily_reports
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "staff manage site reports" ON public.site_daily_reports
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'hr') OR public.has_role(auth.uid(),'supervisor') OR public.has_role(auth.uid(),'data_entry'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'hr') OR public.has_role(auth.uid(),'supervisor') OR public.has_role(auth.uid(),'data_entry'));

CREATE POLICY "authenticated read site report lines" ON public.site_daily_report_lines
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "staff manage site report lines" ON public.site_daily_report_lines
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'hr') OR public.has_role(auth.uid(),'supervisor') OR public.has_role(auth.uid(),'data_entry'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'hr') OR public.has_role(auth.uid(),'supervisor') OR public.has_role(auth.uid(),'data_entry'));

CREATE TRIGGER trg_report_catalog_items_upd BEFORE UPDATE ON public.report_catalog_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_site_daily_reports_upd BEFORE UPDATE ON public.site_daily_reports
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.report_catalog_items (kind, name, sort_order)
VALUES
  ('worker_specialty', 'إدارة وإشراف', 10),
  ('worker_specialty', 'مهندس موقع', 20),
  ('worker_specialty', 'مهندس ميكانيك', 30),
  ('worker_specialty', 'مهندس كهرباء', 40),
  ('worker_specialty', 'مهندس مدني', 50),
  ('worker_specialty', 'جيولوجي / فني مختبر', 60),
  ('worker_specialty', 'فني أجهزة وتحكم', 70),
  ('worker_specialty', 'فني صيانة', 80),
  ('worker_specialty', 'لحام وفابريكيشن', 90),
  ('worker_specialty', 'سائق', 100),
  ('worker_specialty', 'مشغل آلية', 110),
  ('worker_specialty', 'عامل حفر', 120),
  ('worker_specialty', 'عامل خدمات / نظافة', 130),
  ('worker_specialty', 'حراسة وأمن', 140),
  ('worker_specialty', 'إسعاف وسلامة HSE', 150),
  ('equipment_type', 'حفارة', 10),
  ('equipment_type', 'رافعة', 20),
  ('equipment_type', 'شيول / لودر', 30),
  ('equipment_type', 'بلدوزر', 40),
  ('equipment_type', 'كريدر', 50),
  ('equipment_type', 'قلّاب', 60),
  ('equipment_type', 'صهريج ماء', 70),
  ('equipment_type', 'صهريج وقود', 80),
  ('equipment_type', 'مركبة دفع رباعي', 90),
  ('equipment_type', 'باص نقل', 100),
  ('equipment_type', 'مولدة كهرباء', 110),
  ('equipment_type', 'ضاغطة هواء', 120),
  ('equipment_type', 'معدات رفع', 130)
ON CONFLICT (kind, name) DO NOTHING;
