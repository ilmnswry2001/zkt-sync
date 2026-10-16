ALTER TABLE public.daily_workshop_report_lines
  ADD COLUMN site_id uuid REFERENCES public.sites(id) ON DELETE SET NULL;

CREATE INDEX daily_workshop_report_lines_site_idx
  ON public.daily_workshop_report_lines(site_id, report_id)
  WHERE site_id IS NOT NULL;
