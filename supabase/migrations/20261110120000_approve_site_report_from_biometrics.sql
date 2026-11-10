-- Atomic approval: derive verified counts on the server; retain equipment and notes.
CREATE OR REPLACE FUNCTION public.approve_site_report_from_biometrics(p_plan_id uuid, p_report_date date)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_plan public.site_work_plans%ROWTYPE;
  v_report_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'hr') OR
    public.has_role(auth.uid(), 'supervisor') OR public.has_role(auth.uid(), 'data_entry')
  ) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF p_report_date IS NULL THEN RAISE EXCEPTION 'Report date required'; END IF;
  SELECT * INTO v_plan FROM public.site_work_plans WHERE id = p_plan_id AND status = 'finalized' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Finalized plan not found'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(v_plan.assigned_staff::jsonb, '[]'::jsonb)) g
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(g->'employees', '[]'::jsonb)) e
    WHERE e->>'id' IS NOT NULL
  ) THEN RAISE EXCEPTION 'Plan has no named employees'; END IF;

  INSERT INTO public.site_daily_reports(site_id, report_date, notes, created_by)
  VALUES(v_plan.site_id, p_report_date, 'تم الاعتماد آلياً من مطابقة البصمة', auth.uid())
  ON CONFLICT(site_id, report_date) DO UPDATE SET notes = CASE
    WHEN position('تم الاعتماد آلياً من مطابقة البصمة' in COALESCE(site_daily_reports.notes, '')) > 0
    THEN site_daily_reports.notes
    ELSE concat_ws(E'\n', nullif(site_daily_reports.notes, ''), 'تم الاعتماد آلياً من مطابقة البصمة') END
  RETURNING id INTO v_report_id;

  DELETE FROM public.site_daily_report_lines WHERE report_id = v_report_id AND kind = 'worker_specialty';
  WITH staff AS (
    SELECT DISTINCT ON (e->>'id') e->>'id' AS employee_id, trim(g->>'specialty') AS specialty
    FROM jsonb_array_elements(COALESCE(v_plan.assigned_staff::jsonb, '[]'::jsonb)) WITH ORDINALITY groups(g, n)
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(g->'employees', '[]'::jsonb)) e
    WHERE e->>'id' IS NOT NULL
    ORDER BY e->>'id', n DESC
  ), counts AS (
    SELECT specialty, count(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM public.attendance_logs l WHERE l.employee_id::text = staff.employee_id
      AND l.is_suspicious IS NOT TRUE
      AND l.verify_time >= (p_report_date::timestamp AT TIME ZONE 'Asia/Baghdad')
      AND l.verify_time < ((p_report_date + 1)::timestamp AT TIME ZONE 'Asia/Baghdad')
    ))::integer AS present FROM staff GROUP BY specialty
  )
  INSERT INTO public.site_daily_report_lines(report_id, kind, item_name, total_count, working_count, idle_count, catalog_item_id)
  SELECT v_report_id, 'worker_specialty', specialty, present, present, 0,
    (SELECT id FROM public.report_catalog_items WHERE kind = 'worker_specialty' AND name = specialty LIMIT 1)
  FROM counts;
  RETURN v_report_id;
END;
$$;
REVOKE ALL ON FUNCTION public.approve_site_report_from_biometrics(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_site_report_from_biometrics(uuid, date) TO authenticated;
