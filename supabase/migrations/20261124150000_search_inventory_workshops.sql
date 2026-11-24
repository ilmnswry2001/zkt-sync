BEGIN;

CREATE FUNCTION public.search_inventory_workshops(p_term text, p_date date, p_offset integer DEFAULT 0)
RETURNS TABLE (workshop_id uuid, workshop_name text, employee_id uuid, match_kind text, detail text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  WITH input AS (
    SELECT lower(trim(p_term)) AS term
    WHERE length(trim(p_term)) BETWEEN 2 AND 100
  ), matches AS (
    SELECT w.id, w.name, NULL::uuid AS employee, field.kind, field.value, field.rank
    FROM public.daily_workshops w
    LEFT JOIN public.sites home ON home.id = w.home_site_id
    LEFT JOIN public.daily_workshop_reports r ON r.workshop_id = w.id AND r.report_date = p_date
    LEFT JOIN public.sites dest ON dest.id = r.work_site_id
    CROSS JOIN LATERAL (VALUES
      (1, 'ورشة', w.name), (2, 'مسؤول الورشة', w.supervisor_name),
      (3, 'تخصص الورشة', w.specialty), (4, 'وصف الورشة', w.description),
      (5, 'مقر الورشة', concat_ws(' · ', home.name, home.ctr_code)),
      (6, 'موقع التنفيذ', concat_ws(' · ', dest.name, dest.ctr_code)),
      (7, 'عمل اليوم', r.work_activity), (8, 'ملاحظات الجرد', r.notes)
    ) field(rank, kind, value)
    CROSS JOIN input
    WHERE w.is_active AND strpos(lower(field.value), input.term) > 0
    UNION ALL
    SELECT w.id, w.name, e.id, 'عضو الكادر',
      concat_ws(' · ', e.full_name, e.employee_no, nullif(m.role_label,''), nullif(e.position,'')), 9
    FROM public.daily_workshop_members m
    JOIN public.daily_workshops w ON w.id = m.workshop_id AND w.is_active
    JOIN public.employees e ON e.id = m.employee_id AND e.status = 'active'
    CROSS JOIN input
    WHERE m.is_active AND (
      strpos(lower(e.full_name), input.term) > 0 OR strpos(lower(e.employee_no), input.term) > 0
      OR strpos(lower(e.position), input.term) > 0 OR strpos(lower(m.role_label), input.term) > 0
    )
  )
  SELECT id, name, employee, kind, value FROM matches
  ORDER BY rank, name, id, value, employee
  LIMIT 21 OFFSET greatest(0, p_offset);
$$;
REVOKE ALL ON FUNCTION public.search_inventory_workshops(text,date,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_inventory_workshops(text,date,integer) TO authenticated;

COMMIT;
