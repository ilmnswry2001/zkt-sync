-- Link maintenance parts to a dedicated maintenance warehouse and issue stock
-- atomically when a completed maintenance record consumes parts.
ALTER TABLE public.warehouses
  ADD COLUMN IF NOT EXISTS is_maintenance boolean NOT NULL DEFAULT false;

INSERT INTO public.warehouses (name, is_main, is_maintenance)
SELECT 'مخزن الصيانة', false, true
WHERE NOT EXISTS (SELECT 1 FROM public.warehouses WHERE is_maintenance = true);

ALTER TABLE public.maintenance_records
  DROP CONSTRAINT IF EXISTS maintenance_records_status_check;
ALTER TABLE public.maintenance_records
  ADD CONSTRAINT maintenance_records_status_check
  CHECK (status IN ('pending', 'in_progress', 'waiting_parts', 'completed', 'cancelled'));

ALTER TABLE public.maintenance_record_parts
  ADD COLUMN IF NOT EXISTS warehouse_item_id uuid REFERENCES public.warehouse_items(id) ON DELETE SET NULL;

ALTER TABLE public.stock_movements
  ADD COLUMN IF NOT EXISTS maintenance_record_id uuid REFERENCES public.maintenance_records(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS stock_movements_maintenance_record_idx
  ON public.stock_movements(maintenance_record_id)
  WHERE maintenance_record_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.replace_maintenance_record_parts(
  _record_id uuid,
  _parts jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_record public.maintenance_records%ROWTYPE;
  v_warehouse_id uuid;
  v_part jsonb;
  v_item_id uuid;
  v_quantity numeric;
BEGIN
  IF NOT public.is_maintenance_staff(auth.uid()) THEN
    RAISE EXCEPTION 'لا تملك صلاحية إدارة قطع الصيانة';
  END IF;

  SELECT * INTO v_record FROM public.maintenance_records WHERE id = _record_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'سجل الصيانة غير موجود'; END IF;

  SELECT id INTO v_warehouse_id FROM public.warehouses
  WHERE is_maintenance = true AND is_active = true
  ORDER BY name LIMIT 1;
  IF v_record.status = 'completed' AND v_warehouse_id IS NULL THEN
    RAISE EXCEPTION 'مخزن الصيانة غير مهيأ أو غير نشط';
  END IF;

  -- Replacing a record also reverses its previous issue movements.
  DELETE FROM public.stock_movements WHERE maintenance_record_id = _record_id;
  DELETE FROM public.maintenance_record_parts WHERE record_id = _record_id;

  FOR v_part IN SELECT value FROM jsonb_array_elements(coalesce(_parts, '[]'::jsonb)) LOOP
    v_quantity := coalesce((v_part->>'quantity')::numeric, 0);
    IF nullif(trim(coalesce(v_part->>'part_name','')), '') IS NULL OR v_quantity <= 0 THEN
      RAISE EXCEPTION 'بيانات قطعة الغيار غير مكتملة';
    END IF;
    v_item_id := nullif(v_part->>'warehouse_item_id','')::uuid;
    INSERT INTO public.maintenance_record_parts(record_id, warehouse_item_id, part_name, quantity, unit_cost, line_total)
    VALUES (
      _record_id, v_item_id, trim(v_part->>'part_name'), v_quantity,
      coalesce((v_part->>'unit_cost')::numeric, 0),
      v_quantity * coalesce((v_part->>'unit_cost')::numeric, 0)
    );
    IF v_record.status = 'completed' AND v_item_id IS NOT NULL THEN
      INSERT INTO public.stock_movements(warehouse_id, item_id, movement_type, qty_delta, movement_date, notes, created_by, maintenance_record_id)
      VALUES (v_warehouse_id, v_item_id, 'issue', -v_quantity, v_record.maintenance_date,
        'صرف قطع غيار للصيانة ' || v_record.record_no, auth.uid(), _record_id);
    END IF;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.replace_maintenance_record_parts(uuid, jsonb) TO authenticated;
