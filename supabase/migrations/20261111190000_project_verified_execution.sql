-- Read-only, RLS-preserving execution ledger. One biometric-verified person per day.
CREATE OR REPLACE FUNCTION public.project_verified_execution(p_date date)
RETURNS TABLE(employee_id uuid, full_name text, employee_no text, site_id uuid,
  specialty text, assignment_source text, first_punch timestamptz, conflicting boolean)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
WITH punches AS (
  SELECT l.employee_id, min(l.verify_time) AS first_punch
  FROM public.attendance_logs l
  WHERE auth.uid() IS NOT NULL AND l.employee_id IS NOT NULL AND l.is_suspicious IS NOT TRUE
    AND l.verify_time >= (p_date::timestamp AT TIME ZONE 'Asia/Baghdad')
    AND l.verify_time < ((p_date + 1)::timestamp AT TIME ZONE 'Asia/Baghdad')
  GROUP BY l.employee_id
), latest_plans AS (
  SELECT DISTINCT ON (p.site_id) p.site_id, p.assigned_staff
  FROM public.site_work_plans p WHERE p.status = 'finalized' AND p.request_date <= p_date
  ORDER BY p.site_id, p.request_date DESC, p.created_at DESC, p.id DESC
), candidates AS (
  SELECT l.employee_id, l.site_id, nullif(trim(l.role_label),'') AS specialty, 'individual'::text AS source, 1 AS priority
  FROM public.daily_workshop_report_lines l JOIN public.daily_workshop_reports r ON r.id = l.report_id
  WHERE r.report_date = p_date AND l.attended AND l.site_id IS NOT NULL
  UNION ALL
  SELECT l.employee_id, r.work_site_id, nullif(trim(l.role_label),''), 'workshop', 2
  FROM public.daily_workshop_report_lines l JOIN public.daily_workshop_reports r ON r.id = l.report_id
  WHERE r.report_date = p_date AND l.attended AND r.work_site_id IS NOT NULL AND l.site_id IS NULL
  UNION ALL
  SELECT m.employee_id, r.work_site_id, nullif(trim(m.role_label),''), 'workshop', 2
  FROM public.daily_workshop_reports r JOIN public.daily_workshop_members m ON m.workshop_id = r.workshop_id AND m.is_active
  JOIN public.daily_workshops w ON w.id = r.workshop_id AND w.is_active
  WHERE r.report_date = p_date AND r.work_site_id IS NOT NULL
    AND NOT EXISTS(SELECT 1 FROM public.daily_workshop_report_lines saved WHERE saved.report_id = r.id)
  UNION ALL
  SELECT e.id, p.site_id, nullif(trim(g.value->>'specialty'),''), 'plan', 3
  FROM latest_plans p CROSS JOIN LATERAL jsonb_array_elements(p.assigned_staff) g(value)
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(g.value->'employees','[]'::jsonb)) staff(value)
  JOIN public.employees e ON e.id::text = staff.value->>'id'
), best_priority AS (
  SELECT c.employee_id, min(c.priority) AS priority FROM candidates c GROUP BY c.employee_id
), chosen AS (
  SELECT c.employee_id, count(DISTINCT c.site_id) > 1 AS conflicting,
    (array_agg(c.site_id ORDER BY c.site_id,c.specialty))[1] AS site_id,
    (array_agg(c.specialty ORDER BY c.site_id,c.specialty))[1] AS specialty,
    min(c.source) AS source
  FROM candidates c JOIN best_priority b ON b.employee_id = c.employee_id AND b.priority = c.priority
  GROUP BY c.employee_id
)
SELECT e.id, e.full_name::text, e.employee_no::text,
  CASE WHEN c.conflicting THEN NULL ELSE c.site_id END,
  COALESCE(c.specialty,nullif(trim(e.position),''),'بدون صفة'),
  CASE WHEN c.conflicting THEN 'conflict' ELSE COALESCE(c.source,'unallocated') END,
  p.first_punch, COALESCE(c.conflicting,false)
FROM punches p JOIN public.employees e ON e.id = p.employee_id LEFT JOIN chosen c ON c.employee_id = p.employee_id
ORDER BY e.id;
$$;
REVOKE ALL ON FUNCTION public.project_verified_execution(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.project_verified_execution(date) TO authenticated;
-- Approval now commits the same site-wide verified ledger used by planning and project costs.
CREATE OR REPLACE FUNCTION public.approve_site_report_from_biometrics(p_plan_id uuid, p_report_date date)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_plan public.site_work_plans%ROWTYPE; v_report_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'hr') OR public.has_role(auth.uid(),'supervisor') OR public.has_role(auth.uid(),'data_entry')) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  SELECT * INTO v_plan FROM public.site_work_plans p WHERE p.id = p_plan_id AND p.status = 'finalized' AND p.request_date <= p_report_date FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No effective finalized plan'; END IF;
  INSERT INTO public.site_daily_reports(site_id,report_date,notes,created_by)
  VALUES(v_plan.site_id,p_report_date,'تم الاعتماد آلياً من مطابقة البصمة',auth.uid())
  ON CONFLICT(site_id,report_date) DO UPDATE SET notes=CASE
    WHEN position('تم الاعتماد آلياً من مطابقة البصمة' IN COALESCE(site_daily_reports.notes,''))>0 THEN site_daily_reports.notes
    ELSE concat_ws(E'\n',nullif(site_daily_reports.notes,''),'تم الاعتماد آلياً من مطابقة البصمة') END
  RETURNING id INTO v_report_id;
  DELETE FROM public.site_daily_report_lines WHERE report_id=v_report_id AND kind='worker_specialty';
  WITH actual AS (
    SELECT x.specialty,count(*)::integer AS present FROM public.project_verified_execution(p_report_date) x
    WHERE x.site_id=v_plan.site_id AND NOT x.conflicting GROUP BY x.specialty
  ), names AS (
    SELECT a.specialty FROM actual a UNION
    SELECT trim(COALESCE(s.value->>'specialty',s.value->>'name')) FROM jsonb_array_elements(COALESCE(v_plan.final_plan->'specialties',v_plan.specialties,'[]'::jsonb)) s(value)
  )
  INSERT INTO public.site_daily_report_lines(report_id,kind,item_name,total_count,working_count,idle_count,catalog_item_id)
  SELECT v_report_id,'worker_specialty',n.specialty,COALESCE(a.present,0),COALESCE(a.present,0),0,
    (SELECT c.id FROM public.report_catalog_items c WHERE c.kind='worker_specialty' AND c.name=n.specialty LIMIT 1)
  FROM names n LEFT JOIN actual a ON a.specialty=n.specialty WHERE n.specialty IS NOT NULL AND n.specialty<>'';
  RETURN v_report_id;
END; $$;
REVOKE ALL ON FUNCTION public.approve_site_report_from_biometrics(uuid,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_site_report_from_biometrics(uuid,date) TO authenticated;
