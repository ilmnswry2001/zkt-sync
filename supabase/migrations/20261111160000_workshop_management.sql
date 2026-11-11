ALTER TABLE public.daily_workshops
  ADD COLUMN home_site_id uuid REFERENCES public.sites(id) ON DELETE SET NULL,
  ADD COLUMN supervisor_name text NOT NULL DEFAULT '' CHECK(length(supervisor_name) <= 120),
  ADD COLUMN specialty text NOT NULL DEFAULT '' CHECK(length(specialty) <= 120),
  ADD COLUMN description text NOT NULL DEFAULT '' CHECK(length(description) <= 1000),
  ADD COLUMN sort_order integer NOT NULL DEFAULT 0;
CREATE INDEX daily_workshops_home_idx ON public.daily_workshops(home_site_id, sort_order);
ALTER TABLE public.daily_workshop_reports
  ADD COLUMN work_site_id uuid REFERENCES public.sites(id) ON DELETE SET NULL,
  ADD COLUMN work_activity text NOT NULL DEFAULT '' CHECK(length(work_activity) <= 200);

-- Reordering is atomic and inherits workshop RLS.
CREATE FUNCTION public.reorder_daily_workshops(p_ids uuid[]) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'hr') OR public.has_role(auth.uid(),'supervisor') OR public.has_role(auth.uid(),'data_entry')) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF cardinality(p_ids) > 2000 OR cardinality(p_ids) <> (SELECT count(DISTINCT id) FROM unnest(p_ids) id) THEN RAISE EXCEPTION 'Invalid order'; END IF;
  UPDATE public.daily_workshops w SET sort_order = ordered.n::integer
  FROM unnest(p_ids) WITH ORDINALITY ordered(id,n) WHERE w.id = ordered.id;
END; $$;
REVOKE ALL ON FUNCTION public.reorder_daily_workshops(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reorder_daily_workshops(uuid[]) TO authenticated;

-- Only unallocated staff inherit a daily assignment. Explicit individual allocations remain intact.
CREATE FUNCTION public.workshop_daily_default_site() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_day date;
BEGIN
  IF NEW.site_id IS NULL AND NEW.attended THEN
    SELECT report_date INTO v_day FROM public.daily_workshop_reports WHERE id = NEW.report_id;
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.employee_id::text || v_day::text, 0));
    IF NOT EXISTS (
      SELECT 1 FROM public.daily_workshop_report_lines l
      JOIN public.daily_workshop_reports r ON r.id = l.report_id
      WHERE l.employee_id = NEW.employee_id AND r.report_date = v_day AND l.site_id IS NOT NULL AND l.attended
    ) THEN
      SELECT work_site_id INTO NEW.site_id FROM public.daily_workshop_reports WHERE id = NEW.report_id;
    END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER workshop_daily_default_site BEFORE INSERT OR UPDATE OF attended ON public.daily_workshop_report_lines
FOR EACH ROW EXECUTE FUNCTION public.workshop_daily_default_site();
CREATE FUNCTION public.set_workshop_daily_tasks(p_ids uuid[], p_date date, p_site uuid, p_activity text, p_apply boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_line record;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'hr') OR public.has_role(auth.uid(),'supervisor') OR public.has_role(auth.uid(),'data_entry')) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF p_date IS NULL OR cardinality(p_ids) IS NULL OR cardinality(p_ids) NOT BETWEEN 1 AND 2000
     OR length(COALESCE(p_activity,'')) > 200 THEN RAISE EXCEPTION 'Invalid task'; END IF;
  IF EXISTS(SELECT 1 FROM unnest(p_ids) id LEFT JOIN public.daily_workshops w ON w.id = id WHERE w.id IS NULL OR NOT w.is_active) THEN RAISE EXCEPTION 'Invalid workshop'; END IF;
  INSERT INTO public.daily_workshop_reports(workshop_id, report_date, work_site_id, work_activity, recorded_by)
  SELECT DISTINCT id, p_date, p_site, trim(COALESCE(p_activity,'')), auth.uid() FROM unnest(p_ids) id ORDER BY id
  ON CONFLICT(workshop_id,report_date) DO UPDATE SET work_site_id = EXCLUDED.work_site_id, work_activity = EXCLUDED.work_activity;
  IF p_apply AND p_site IS NOT NULL THEN
    FOR v_line IN SELECT l.id, l.employee_id FROM public.daily_workshop_report_lines l
      JOIN public.daily_workshop_reports r ON r.id = l.report_id
      WHERE r.workshop_id = ANY(p_ids) AND r.report_date = p_date AND l.attended AND l.site_id IS NULL AND l.employee_id IS NOT NULL
      ORDER BY l.employee_id,l.id
    LOOP
      PERFORM pg_advisory_xact_lock(hashtextextended(v_line.employee_id::text || p_date::text,0));
      IF NOT EXISTS(SELECT 1 FROM public.daily_workshop_report_lines l JOIN public.daily_workshop_reports r ON r.id = l.report_id
        WHERE l.employee_id = v_line.employee_id AND r.report_date = p_date AND l.attended AND l.site_id IS NOT NULL) THEN
        UPDATE public.daily_workshop_report_lines SET site_id = p_site WHERE id = v_line.id AND site_id IS NULL;
      END IF;
    END LOOP;
  END IF;
END; $$;
REVOKE ALL ON FUNCTION public.set_workshop_daily_tasks(uuid[], date, uuid, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_workshop_daily_tasks(uuid[], date, uuid, text, boolean) TO authenticated;
