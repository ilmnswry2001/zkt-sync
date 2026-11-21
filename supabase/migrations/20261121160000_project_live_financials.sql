BEGIN;

CREATE OR REPLACE FUNCTION public.get_employee_custody(emp_id uuid)
RETURNS TABLE (item_id uuid, item_code text, item_name text, unit text, warehouse_id uuid, warehouse_name text, remaining_qty numeric, movement_id uuid, received_date date)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR (
    public.is_admin(auth.uid())
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'hr')
    OR public.has_role(auth.uid(), 'warehouse_keeper')
    OR emp_id = public.erp_own_employee_id()
  ) IS NOT TRUE THEN
    RAISE EXCEPTION 'غير مصرح لك بالاطلاع على عهد هذا الموظف' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH issued AS (
    SELECT sm.item_id, sm.warehouse_id, sm.id AS movement_id, sm.movement_date AS received_date,
      SUM(sm.qty_delta) AS issued_qty
    FROM public.stock_movements sm
    WHERE sm.employee_id = emp_id AND sm.movement_type = 'tool_out'
    GROUP BY sm.item_id, sm.warehouse_id, sm.id, sm.movement_date
  ), returned AS (
    SELECT sm.item_id, SUM(ABS(sm.qty_delta)) AS returned_qty
    FROM public.stock_movements sm
    WHERE sm.employee_id = emp_id AND sm.movement_type = 'tool_back'
    GROUP BY sm.item_id
  )
  SELECT wi.id, wi.code, wi.name, wi.unit, i.warehouse_id, w.name,
    GREATEST(0, i.issued_qty - COALESCE(r.returned_qty, 0)), i.movement_id, i.received_date
  FROM issued i
  JOIN public.warehouse_items wi ON wi.id = i.item_id
  JOIN public.warehouses w ON w.id = i.warehouse_id
  LEFT JOIN returned r ON r.item_id = i.item_id
  WHERE i.issued_qty - COALESCE(r.returned_qty, 0) > 0;
END;
$$;
REVOKE ALL ON FUNCTION public.get_employee_custody(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_employee_custody(uuid) TO authenticated;


-- The contract budget is separate from each day's planned labor cost.
CREATE TABLE public.site_ctr_budgets (
  site_id uuid PRIMARY KEY REFERENCES public.sites(id) ON DELETE CASCADE,
  budget_iqd numeric(16,2) NOT NULL CHECK (budget_iqd > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
ALTER TABLE public.site_ctr_budgets ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.site_ctr_budgets TO service_role;

CREATE INDEX IF NOT EXISTS stock_movements_project_issues_idx
  ON public.stock_movements (site_id, movement_date DESC, id) WHERE movement_type = 'issue';

CREATE FUNCTION public.set_site_ctr_budget(p_site_id uuid, p_budget numeric) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF public.is_admin(auth.uid()) IS NOT TRUE THEN
    RAISE EXCEPTION 'تعديل موازنة العقد متاح لمدير النظام فقط' USING ERRCODE = '42501';
  END IF;
  IF p_budget IS NULL OR p_budget <= 0 OR p_budget > 99999999999999.99 THEN
    RAISE EXCEPTION 'أدخل موازنة عقد موجبة بالدينار العراقي' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.site_ctr_budgets (site_id, budget_iqd, updated_by)
    VALUES (p_site_id, p_budget, auth.uid())
    ON CONFLICT (site_id) DO UPDATE SET budget_iqd = excluded.budget_iqd,
      updated_by = excluded.updated_by, updated_at = now();
END;
$$;

-- Internal priced movement projection shared by totals and paginated inspection.
CREATE FUNCTION public.site_material_issue_costs(p_site_id uuid, p_start date, p_end date)
RETURNS TABLE (id uuid, movement_date date, item_name text, item_code text,
  unit text, quantity numeric, unit_cost numeric, cost numeric, warehouse_name text, notes text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT m.id, m.movement_date, i.name, i.code, i.unit, abs(m.qty_delta),
    nullif(greatest(i.unit_cost, 0), 0),
    CASE WHEN i.unit_cost > 0 THEN round(abs(m.qty_delta) * i.unit_cost, 2) END, w.name, m.notes
  FROM public.stock_movements m
  JOIN public.warehouse_items i ON i.id = m.item_id
  JOIN public.warehouses w ON w.id = m.warehouse_id
  WHERE m.site_id = p_site_id AND m.movement_type = 'issue'
    AND m.movement_date <= p_end AND (p_start IS NULL OR m.movement_date >= p_start)
$$;

CREATE FUNCTION public.read_project_financials(p_site_id uuid, p_start date, p_end date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE result jsonb;
BEGIN
  IF (public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'hr')) IS NOT TRUE THEN
    RAISE EXCEPTION 'لا تملك صلاحية الاطلاع على تكاليف المشروع' USING ERRCODE = '42501';
  END IF;
  IF p_end IS NULL OR p_start > p_end THEN RAISE EXCEPTION 'حدد نطاقاً زمنياً صالحاً'; END IF;

  WITH approved AS (
    SELECT r.id, r.report_date FROM public.site_daily_reports r
    WHERE r.site_id = p_site_id AND r.report_date <= p_end
      AND EXISTS (
        SELECT FROM regexp_split_to_table(coalesce(r.notes, ''), E'\n') AS note(line)
        WHERE btrim(note.line, E' \t\r') = 'تم الاعتماد آلياً من مطابقة البصمة'
      )
  ), crew AS (
    SELECT btrim(l.item_name) AS name,
      coalesce(sum(greatest(0, coalesce(l.working_count, l.total_count))) FILTER (
        WHERE p_start IS NULL OR r.report_date >= p_start
      ), 0) AS period_count,
      sum(greatest(0, coalesce(l.working_count, l.total_count))) AS cumulative_count
    FROM approved r JOIN public.site_daily_report_lines l ON l.report_id = r.id
    WHERE l.kind = 'worker_specialty' GROUP BY btrim(l.item_name)
  ), materials AS (
    SELECT
      coalesce(sum(m.cost) FILTER (WHERE p_start IS NULL OR m.movement_date >= p_start), 0) AS period_cost,
      coalesce(sum(m.cost), 0) AS cumulative_cost,
      count(*) FILTER (WHERE m.unit_cost IS NULL AND m.quantity > 0
        AND (p_start IS NULL OR m.movement_date >= p_start)) AS period_unpriced,
      count(*) FILTER (WHERE m.unit_cost IS NULL AND m.quantity > 0) AS cumulative_unpriced
    FROM public.site_material_issue_costs(p_site_id, NULL, p_end) m
  )
  SELECT jsonb_build_object(
    'budget', (SELECT budget_iqd FROM public.site_ctr_budgets WHERE site_id = p_site_id),
    'canEditBudget', public.is_admin(auth.uid()),
    'crew', coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.name) FROM crew c), '[]'::jsonb),
    'approvedReports', (SELECT count(*) FROM approved WHERE p_start IS NULL OR report_date >= p_start),
    'materials', to_jsonb(materials),
    'syncedAt', now()
  ) INTO result FROM materials;
  RETURN result;
END;
$$;

CREATE FUNCTION public.read_project_material_issues(
  p_site_id uuid, p_start date, p_end date, p_offset integer DEFAULT 0, p_limit integer DEFAULT 20
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE result jsonb;
BEGIN
  IF (public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'hr')) IS NOT TRUE THEN
    RAISE EXCEPTION 'لا تملك صلاحية الاطلاع على تكاليف المشروع' USING ERRCODE = '42501';
  END IF;
  IF p_end IS NULL OR p_start > p_end THEN RAISE EXCEPTION 'حدد نطاقاً زمنياً صالحاً'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(page) ORDER BY page.movement_date DESC, page.id), '[]'::jsonb) INTO result
  FROM (
    SELECT * FROM public.site_material_issue_costs(p_site_id, p_start, p_end)
    ORDER BY movement_date DESC, id OFFSET greatest(0, p_offset) LIMIT least(1000, greatest(1, p_limit))
  ) page;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.site_material_issue_costs(uuid, date, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_site_ctr_budget(uuid, numeric),
  public.read_project_financials(uuid, date, date),
  public.read_project_material_issues(uuid, date, date, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_site_ctr_budget(uuid, numeric),
  public.read_project_financials(uuid, date, date),
  public.read_project_material_issues(uuid, date, date, integer, integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
