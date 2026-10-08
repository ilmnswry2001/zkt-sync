CREATE TABLE IF NOT EXISTS public.employee_clearances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  clearance_status text NOT NULL DEFAULT 'draft' CHECK (clearance_status IN ('draft', 'approved', 'rejected')),
  cleared_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  has_open_custody boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.employee_clearances ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.employee_clearances TO authenticated;
DROP POLICY IF EXISTS "authenticated read employee clearances" ON public.employee_clearances;
CREATE POLICY "authenticated read employee clearances" ON public.employee_clearances FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "admin hr manage employee clearances" ON public.employee_clearances;
CREATE POLICY "admin hr manage employee clearances" ON public.employee_clearances FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'hr'))
WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'hr'));

CREATE OR REPLACE FUNCTION public.get_employee_custody(emp_id uuid)
RETURNS TABLE (item_id uuid, item_code text, item_name text, unit text, warehouse_id uuid, warehouse_name text, remaining_qty numeric, movement_id uuid, received_date date)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH issued AS (
    SELECT sm.item_id, sm.warehouse_id, sm.id AS movement_id, sm.movement_date AS received_date,
      SUM(sm.qty_delta) AS issued_qty
    FROM public.stock_movements sm
    WHERE sm.employee_id = emp_id AND sm.movement_type = 'tool_out'
    GROUP BY sm.item_id, sm.warehouse_id, sm.id, sm.movement_date
  ), returned AS (
    SELECT item_id, SUM(ABS(qty_delta)) AS returned_qty
    FROM public.stock_movements
    WHERE employee_id = emp_id AND movement_type = 'tool_back'
    GROUP BY item_id
  )
  SELECT wi.id, wi.code, wi.name, wi.unit, i.warehouse_id, w.name,
    GREATEST(0, i.issued_qty - COALESCE(r.returned_qty, 0)), i.movement_id, i.received_date
  FROM issued i
  JOIN public.warehouse_items wi ON wi.id = i.item_id
  JOIN public.warehouses w ON w.id = i.warehouse_id
  LEFT JOIN returned r ON r.item_id = i.item_id
  WHERE i.issued_qty - COALESCE(r.returned_qty, 0) > 0;
$$;
GRANT EXECUTE ON FUNCTION public.get_employee_custody(uuid) TO authenticated;
