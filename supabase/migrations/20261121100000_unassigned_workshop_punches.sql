BEGIN;

CREATE FUNCTION public.list_unassigned_workshop_punches(
  p_date date, p_device_ids uuid[] DEFAULT NULL, p_excluded_employee_ids uuid[] DEFAULT NULL,
  p_page integer DEFAULT 0
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  WITH day_punches AS MATERIALIZED (
    SELECT l.id, l.employee_id, l.employee_no, l.verify_time, l.device_id
    FROM public.attendance_logs l
    WHERE l.verify_time >= (p_date::timestamp AT TIME ZONE 'Asia/Baghdad')
      AND l.verify_time < ((p_date + 1)::timestamp AT TIME ZONE 'Asia/Baghdad')
      AND (p_device_ids IS NULL OR l.device_id = ANY(p_device_ids))
      AND l.is_suspicious = false
      AND (l.self_event_type = 'check_in' OR (l.self_event_type IS NULL AND
        (l.status = 0 OR (l.status IS NULL AND l.verify_type = 0))))
  ), resolved AS (
    SELECT p.id, COALESCE(identified.id, legacy.id) AS employee_id, p.verify_time, p.device_id
    FROM day_punches p
    LEFT JOIN public.employees identified ON identified.id = p.employee_id AND identified.status = 'active'
    LEFT JOIN public.employees legacy ON identified.id IS NULL AND legacy.employee_no = p.employee_no AND legacy.status = 'active'
  ), first_punches AS MATERIALIZED (
    SELECT DISTINCT ON (r.employee_id) r.*
    FROM resolved r
    WHERE r.employee_id IS NOT NULL
      AND NOT (r.employee_id = ANY(COALESCE(p_excluded_employee_ids, '{}'::uuid[])))
      AND NOT EXISTS (
        SELECT 1 FROM public.daily_workshop_members m
        JOIN public.daily_workshops w ON w.id = m.workshop_id AND w.is_active
        WHERE m.employee_id = r.employee_id AND m.is_active
      )
    ORDER BY r.employee_id, r.verify_time, r.id
  ), page AS (
    SELECT f.id AS punch_id, f.verify_time, f.device_id, e.id AS employee_id, e.employee_no, e.full_name, e.position
    FROM first_punches f JOIN public.employees e ON e.id = f.employee_id
    ORDER BY f.verify_time, f.employee_id
    LIMIT 20 OFFSET (GREATEST(0, LEAST(COALESCE(p_page, 0), 100000)) * 20)
  )
  SELECT jsonb_build_object(
    'totalCount', (SELECT count(*) FROM first_punches),
    'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'employee', jsonb_build_object('id', employee_id, 'employee_no', employee_no, 'full_name', full_name, 'position', position),
      'punch', jsonb_build_object('id', punch_id, 'verify_time', verify_time, 'device_id', device_id)
    ) ORDER BY verify_time, employee_id) FROM page), '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION public.list_unassigned_workshop_punches(date, uuid[], uuid[], integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_unassigned_workshop_punches(date, uuid[], uuid[], integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
