-- Correct ambiguous workshop IDs without changing permissions or stored data.
CREATE OR REPLACE FUNCTION public.set_workshop_daily_tasks(p_ids uuid[], p_date date, p_site uuid, p_activity text, p_apply boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_line record;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'hr') OR public.has_role(auth.uid(),'supervisor') OR public.has_role(auth.uid(),'data_entry')) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF p_date IS NULL OR cardinality(p_ids) IS NULL OR cardinality(p_ids) NOT BETWEEN 1 AND 2000
     OR length(COALESCE(p_activity,'')) > 200 THEN RAISE EXCEPTION 'Invalid task'; END IF;
  IF EXISTS(SELECT 1 FROM unnest(p_ids) AS requested(workshop_id) LEFT JOIN public.daily_workshops w ON w.id = requested.workshop_id WHERE w.id IS NULL OR NOT w.is_active) THEN RAISE EXCEPTION 'Invalid workshop'; END IF;
  INSERT INTO public.daily_workshop_reports(workshop_id, report_date, work_site_id, work_activity, recorded_by)
  SELECT DISTINCT requested.workshop_id, p_date, p_site, trim(COALESCE(p_activity,'')), auth.uid() FROM unnest(p_ids) AS requested(workshop_id) ORDER BY requested.workshop_id
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
        UPDATE public.daily_workshop_report_lines SET site_id = p_site WHERE daily_workshop_report_lines.id = v_line.id AND daily_workshop_report_lines.site_id IS NULL;
      END IF;
    END LOOP;
  END IF;
END; $$;
REVOKE ALL ON FUNCTION public.set_workshop_daily_tasks(uuid[], date, uuid, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_workshop_daily_tasks(uuid[], date, uuid, text, boolean) TO authenticated;
