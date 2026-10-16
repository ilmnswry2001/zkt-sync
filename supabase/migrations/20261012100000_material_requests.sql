DO $$
BEGIN
  IF to_regclass('public.warehouses') IS NULL
     OR to_regclass('public.warehouse_items') IS NULL
     OR to_regclass('public.stock_movements') IS NULL THEN
    RAISE EXCEPTION 'Material requests require the existing warehouse migration to be applied first';
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.material_request_counters (
  request_type text NOT NULL CHECK (request_type IN ('material', 'equipment')),
  request_year integer NOT NULL,
  last_value integer NOT NULL DEFAULT 0,
  PRIMARY KEY (request_type, request_year)
);

CREATE TABLE IF NOT EXISTS public.material_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_number text NOT NULL UNIQUE,
  request_type text NOT NULL CHECK (request_type IN ('material', 'equipment')),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  department_id uuid NOT NULL REFERENCES public.departments(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'pending_planning', 'returned', 'rejected', 'pending_warehouse',
    'pending_procurement', 'purchasing', 'pending_receipt', 'partially_received',
    'received', 'closed', 'cancelled'
  )),
  reason text NOT NULL DEFAULT '',
  need_by_date date,
  submitted_at timestamptz,
  closed_from_status text,
  close_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.material_request_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.material_requests(id) ON DELETE RESTRICT,
  original_qty numeric(14,3) NOT NULL CHECK (original_qty > 0),
  requested_qty numeric(14,3) NOT NULL CHECK (requested_qty > 0),
  item_name text NOT NULL CHECK (length(trim(item_name)) > 0),
  unit text NOT NULL CHECK (length(trim(unit)) > 0),
  specifications text,
  planning_approved_qty numeric(14,3) CHECK (planning_approved_qty IS NULL OR planning_approved_qty >= 0),
  planning_note text,
  warehouse_item_id uuid REFERENCES public.warehouse_items(id) ON DELETE RESTRICT,
  source_warehouse_id uuid REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  is_new_item boolean NOT NULL DEFAULT false,
  warehouse_available_qty numeric(14,3) NOT NULL DEFAULT 0 CHECK (warehouse_available_qty >= 0),
  issue_qty numeric(14,3) NOT NULL DEFAULT 0 CHECK (issue_qty >= 0),
  purchase_qty numeric(14,3) NOT NULL DEFAULT 0 CHECK (purchase_qty >= 0),
  purchased_qty numeric(14,3) NOT NULL DEFAULT 0 CHECK (purchased_qty >= 0),
  received_qty numeric(14,3) NOT NULL DEFAULT 0 CHECK (received_qty >= 0),
  allocation_reason text,
  not_purchased_reason text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'issue_from_stock', 'for_purchase', 'purchased', 'received_full',
    'received_partial', 'not_arrived', 'excluded', 'not_purchased'
  )),
  is_removed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.material_request_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.material_requests(id) ON DELETE RESTRICT,
  request_item_id uuid REFERENCES public.material_request_items(id) ON DELETE RESTRICT,
  action text NOT NULL,
  actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  note text,
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.material_procurement_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.material_requests(id) ON DELETE RESTRICT,
  supplier text NOT NULL CHECK (length(trim(supplier)) > 0),
  document_number text,
  purchase_date date NOT NULL DEFAULT CURRENT_DATE,
  notes text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent_to_warehouse')),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.material_procurement_batch_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.material_procurement_batches(id) ON DELETE RESTRICT,
  request_item_id uuid NOT NULL REFERENCES public.material_request_items(id) ON DELETE RESTRICT,
  purchased_qty numeric(14,3) NOT NULL DEFAULT 0 CHECK (purchased_qty >= 0),
  not_purchased_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (batch_id, request_item_id),
  CHECK (purchased_qty > 0 OR length(trim(coalesce(not_purchased_reason, ''))) >= 3)
);

CREATE TABLE IF NOT EXISTS public.material_request_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key uuid NOT NULL UNIQUE,
  request_id uuid NOT NULL REFERENCES public.material_requests(id) ON DELETE RESTRICT,
  batch_id uuid NOT NULL REFERENCES public.material_procurement_batches(id) ON DELETE RESTRICT,
  warehouse_id uuid REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  received_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  received_at timestamptz NOT NULL DEFAULT now(),
  notes text
);

CREATE TABLE IF NOT EXISTS public.material_request_receipt_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id uuid NOT NULL REFERENCES public.material_request_receipts(id) ON DELETE RESTRICT,
  request_item_id uuid NOT NULL REFERENCES public.material_request_items(id) ON DELETE RESTRICT,
  batch_item_id uuid NOT NULL REFERENCES public.material_procurement_batch_items(id) ON DELETE RESTRICT,
  warehouse_item_id uuid REFERENCES public.warehouse_items(id) ON DELETE RESTRICT,
  received_qty numeric(14,3) NOT NULL DEFAULT 0 CHECK (received_qty >= 0),
  serial_notes text,
  did_not_arrive boolean NOT NULL DEFAULT false,
  shortage_reason text,
  exclusion_reason text,
  exclusion_approved_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (receipt_id, batch_item_id),
  CHECK (NOT did_not_arrive OR received_qty = 0),
  CHECK (exclusion_reason IS NULL OR length(trim(exclusion_reason)) >= 3)
);
ALTER TABLE public.material_request_receipt_items ADD COLUMN IF NOT EXISTS serial_notes text;

CREATE INDEX IF NOT EXISTS material_requests_status_created_idx
  ON public.material_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS material_requests_department_created_idx
  ON public.material_requests(department_id, created_at DESC);
CREATE INDEX IF NOT EXISTS material_request_items_request_idx
  ON public.material_request_items(request_id, is_removed, created_at);
CREATE INDEX IF NOT EXISTS material_request_events_request_idx
  ON public.material_request_events(request_id, created_at DESC);
CREATE INDEX IF NOT EXISTS material_procurement_batches_request_idx
  ON public.material_procurement_batches(request_id, created_at);

CREATE OR REPLACE FUNCTION public.material_request_audit_append_only()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'سجل تدقيق الطلبات غير قابل للتعديل أو الحذف';
END;
$$;
DROP TRIGGER IF EXISTS material_request_events_append_only ON public.material_request_events;
CREATE TRIGGER material_request_events_append_only BEFORE UPDATE OR DELETE ON public.material_request_events
  FOR EACH ROW EXECUTE FUNCTION public.material_request_audit_append_only();

CREATE OR REPLACE FUNCTION public.stock_movement_prevent_negative_balance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_balance numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.material_request_id IS NOT NULL THEN
      RAISE EXCEPTION 'حركات طلبات المواد مرتبطة بسجل تدقيق ولا يمكن حذفها';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(OLD.warehouse_id::text||':'||OLD.item_id::text,0));
    SELECT coalesce(sum(movement.qty_delta),0) INTO v_balance
    FROM public.stock_movements movement
    WHERE movement.warehouse_id=OLD.warehouse_id AND movement.item_id=OLD.item_id AND movement.id<>OLD.id;
    IF v_balance < 0 THEN RAISE EXCEPTION 'حذف الحركة سيجعل الرصيد سالباً'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.material_request_id IS NOT NULL THEN
    RAISE EXCEPTION 'حركات طلبات المواد لا يمكن تعديلها';
  END IF;
  IF TG_OP = 'UPDATE' AND
    (NEW.warehouse_id IS DISTINCT FROM OLD.warehouse_id OR NEW.item_id IS DISTINCT FROM OLD.item_id) THEN
    RAISE EXCEPTION 'لا يمكن نقل حركة مخزنية؛ سجّل حركة تحويل مستقلة';
  END IF;
  IF NEW.qty_delta < 0 OR (TG_OP = 'UPDATE' AND NEW.qty_delta < OLD.qty_delta) THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.warehouse_id::text||':'||NEW.item_id::text,0));
    IF TG_OP = 'UPDATE' THEN
      SELECT coalesce(sum(movement.qty_delta),0) INTO v_balance
      FROM public.stock_movements movement
      WHERE movement.warehouse_id=NEW.warehouse_id AND movement.item_id=NEW.item_id AND movement.id<>OLD.id;
    ELSE
      SELECT coalesce(sum(movement.qty_delta),0) INTO v_balance
      FROM public.stock_movements movement
      WHERE movement.warehouse_id=NEW.warehouse_id AND movement.item_id=NEW.item_id;
    END IF;
    IF v_balance + NEW.qty_delta < 0 THEN
      RAISE EXCEPTION 'الرصيد غير كافٍ لهذه الحركة (المتاح %)', v_balance;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS stock_movements_prevent_negative_balance ON public.stock_movements;
CREATE TRIGGER stock_movements_prevent_negative_balance BEFORE INSERT OR UPDATE OR DELETE
  ON public.stock_movements FOR EACH ROW EXECUTE FUNCTION public.stock_movement_prevent_negative_balance();

ALTER TABLE public.stock_movements
  ADD COLUMN IF NOT EXISTS material_request_id uuid REFERENCES public.material_requests(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS material_request_item_id uuid REFERENCES public.material_request_items(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS material_request_receipt_id uuid REFERENCES public.material_request_receipts(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX IF NOT EXISTS stock_movements_material_request_issue_once_idx
  ON public.stock_movements(material_request_item_id)
  WHERE material_request_item_id IS NOT NULL AND movement_type = 'issue';
CREATE UNIQUE INDEX IF NOT EXISTS stock_movements_material_request_receipt_once_idx
  ON public.stock_movements(material_request_receipt_id, material_request_item_id)
  WHERE material_request_receipt_id IS NOT NULL AND material_request_item_id IS NOT NULL;

GRANT SELECT ON public.material_requests, public.material_request_items,
  public.material_request_events, public.material_procurement_batches,
  public.material_procurement_batch_items, public.material_request_receipts,
  public.material_request_receipt_items TO authenticated;
GRANT ALL ON public.material_requests, public.material_request_items,
  public.material_request_events, public.material_procurement_batches,
  public.material_procurement_batch_items, public.material_request_receipts,
  public.material_request_receipt_items, public.material_request_counters TO service_role;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.material_requests,
  public.material_request_items, public.material_request_events,
  public.material_procurement_batches, public.material_procurement_batch_items,
  public.material_request_receipts, public.material_request_receipt_items,
  public.material_request_counters FROM PUBLIC, anon, authenticated;

ALTER TABLE public.material_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_request_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_request_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_procurement_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_procurement_batch_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_request_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_request_receipt_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_request_counters ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.material_request_is_company_manager(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_admin(_user_id) OR public.has_form_role(_user_id, 'ceo')
$$;

CREATE OR REPLACE FUNCTION public.material_request_can_read(_request_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.material_requests request
    WHERE request.id = _request_id
      AND (
        request.created_by = auth.uid()
        OR public.material_request_is_company_manager(auth.uid())
        OR public.has_role(auth.uid(), 'planning_officer')
        OR public.has_role(auth.uid(), 'warehouse_keeper')
        OR public.has_role(auth.uid(), 'procurement_officer')
        OR (public.has_role(auth.uid(), 'department_manager')
          AND (public.can_access_department(auth.uid(), request.department_id)
            OR EXISTS (SELECT 1 FROM public.department_managers manager
              WHERE manager.user_id=auth.uid() AND manager.department_id=request.department_id)))
      )
  )
$$;

DROP POLICY IF EXISTS material_requests_read ON public.material_requests;
DROP POLICY IF EXISTS material_request_items_read ON public.material_request_items;
DROP POLICY IF EXISTS material_request_events_read ON public.material_request_events;
DROP POLICY IF EXISTS material_procurement_batches_read ON public.material_procurement_batches;
DROP POLICY IF EXISTS material_procurement_batch_items_read ON public.material_procurement_batch_items;
DROP POLICY IF EXISTS material_request_receipts_read ON public.material_request_receipts;
DROP POLICY IF EXISTS material_request_receipt_items_read ON public.material_request_receipt_items;
CREATE POLICY material_requests_read ON public.material_requests
  FOR SELECT TO authenticated USING (public.material_request_can_read(id));
CREATE POLICY material_request_items_read ON public.material_request_items
  FOR SELECT TO authenticated USING (public.material_request_can_read(request_id));
CREATE POLICY material_request_events_read ON public.material_request_events
  FOR SELECT TO authenticated USING (public.material_request_can_read(request_id));
CREATE POLICY material_procurement_batches_read ON public.material_procurement_batches
  FOR SELECT TO authenticated USING (public.material_request_can_read(request_id));
CREATE POLICY material_procurement_batch_items_read ON public.material_procurement_batch_items
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.material_procurement_batches batch
      WHERE batch.id = batch_id AND public.material_request_can_read(batch.request_id))
  );
CREATE POLICY material_request_receipts_read ON public.material_request_receipts
  FOR SELECT TO authenticated USING (public.material_request_can_read(request_id));
CREATE POLICY material_request_receipt_items_read ON public.material_request_receipt_items
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.material_request_receipts receipt
      WHERE receipt.id = receipt_id AND public.material_request_can_read(receipt.request_id))
  );

CREATE OR REPLACE FUNCTION public.material_request_actor_context()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_email text;
  v_department_ids uuid[];
  v_employee_department_id uuid;
  v_roles text[];
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  SELECT email INTO v_email FROM public.profiles WHERE id = v_user_id;
  SELECT coalesce(array_agg(DISTINCT role::text), ARRAY[]::text[])
    INTO v_roles FROM public.user_roles WHERE user_id = v_user_id;
  SELECT coalesce(array_agg(DISTINCT department_id), ARRAY[]::uuid[])
    INTO v_department_ids
    FROM (
      SELECT department_id FROM public.user_departments WHERE user_id = v_user_id
      UNION
      SELECT department_id FROM public.department_managers WHERE user_id = v_user_id
    ) scoped_departments;
  IF v_email IS NOT NULL THEN
    SELECT (array_agg(employee.department_id))[1] INTO v_employee_department_id
    FROM public.employees employee
    WHERE lower(trim(employee.email)) = lower(trim(v_email))
      AND employee.status = 'active'
      AND employee.department_id IS NOT NULL
      AND (SELECT count(*) FROM public.employees matched
        WHERE lower(trim(matched.email)) = lower(trim(v_email))
          AND matched.status = 'active') = 1;
  END IF;
  RETURN jsonb_build_object(
    'user_id', v_user_id,
    'email', v_email,
    'roles', to_jsonb(v_roles),
    'department_ids', to_jsonb(v_department_ids),
    'employee_department_id', v_employee_department_id,
    'company_manager', public.material_request_is_company_manager(v_user_id)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.material_request_can_request(_user_id uuid, _department_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.material_request_is_company_manager(_user_id)
    OR (
      (public.has_role(_user_id, 'engineer') OR public.has_role(_user_id, 'supervisor')
        OR public.has_role(_user_id, 'site_admin') OR public.has_role(_user_id, 'department_manager'))
      AND (
        public.can_access_department(_user_id, _department_id)
        OR EXISTS (SELECT 1 FROM public.department_managers manager
          WHERE manager.user_id=_user_id AND manager.department_id=_department_id)
        OR EXISTS (
          SELECT 1 FROM public.profiles profile
          JOIN public.employees employee ON lower(trim(employee.email)) = lower(trim(profile.email))
          WHERE profile.id = _user_id AND employee.status = 'active'
            AND employee.department_id = _department_id
        )
      )
    )
$$;

CREATE OR REPLACE FUNCTION public.material_request_guard_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF current_setting('app.material_requests_rpc', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'تغيير حالة الطلب متاح عبر إجراءات دورة العمل فقط';
  END IF;
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;
  IF NOT (
    (OLD.status = 'draft' AND NEW.status = 'pending_planning') OR
    (OLD.status = 'pending_planning' AND NEW.status IN ('returned','rejected','pending_warehouse','cancelled')) OR
    (OLD.status = 'returned' AND NEW.status = 'pending_planning') OR
    (OLD.status IN ('pending_warehouse','pending_procurement','purchasing','pending_receipt','partially_received','received') AND NEW.status = 'closed') OR
    (OLD.status = 'pending_warehouse' AND NEW.status IN ('pending_procurement','pending_receipt','partially_received','received')) OR
    (OLD.status = 'pending_procurement' AND NEW.status IN ('purchasing','pending_receipt')) OR
    (OLD.status = 'purchasing' AND NEW.status IN ('pending_receipt','partially_received','received')) OR
    (OLD.status = 'pending_receipt' AND NEW.status IN ('partially_received','received')) OR
    (OLD.status = 'partially_received' AND NEW.status = 'received') OR
    (OLD.status = 'closed' AND NEW.status = OLD.closed_from_status AND public.is_admin(auth.uid()))
  ) THEN RAISE EXCEPTION 'انتقال حالة الطلب غير مسموح'; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.material_request_guard_item()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_submitted_at timestamptz;
  v_status text;
BEGIN
  IF current_setting('app.material_requests_rpc', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'تعديل بنود الطلب متاح عبر إجراءات دورة العمل فقط';
  END IF;
  IF TG_OP = 'DELETE' THEN
    SELECT submitted_at INTO v_submitted_at FROM public.material_requests WHERE id = OLD.request_id;
    IF v_submitted_at IS NOT NULL THEN RAISE EXCEPTION 'لا يمكن حذف بند أُرسل سابقاً'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    SELECT submitted_at, status INTO v_submitted_at, v_status
      FROM public.material_requests WHERE id = OLD.request_id;
    IF OLD.original_qty IS DISTINCT FROM NEW.original_qty
      AND (v_submitted_at IS NOT NULL OR v_status <> 'draft') THEN
      RAISE EXCEPTION 'الكمية الأصلية للبند غير قابلة للتعديل بعد الإرسال';
    END IF;
    IF v_submitted_at IS NOT NULL AND v_status NOT IN ('draft','returned')
      AND (OLD.requested_qty IS DISTINCT FROM NEW.requested_qty
        OR OLD.item_name IS DISTINCT FROM NEW.item_name OR OLD.unit IS DISTINCT FROM NEW.unit
        OR OLD.specifications IS DISTINCT FROM NEW.specifications) THEN
      RAISE EXCEPTION 'لا يمكن تعديل بيانات مقدم الطلب بعد الإرسال إلا في المسودة أو عند الإعادة';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS material_request_status_guard ON public.material_requests;
CREATE TRIGGER material_request_status_guard BEFORE UPDATE OF status ON public.material_requests
  FOR EACH ROW EXECUTE FUNCTION public.material_request_guard_status();
DROP TRIGGER IF EXISTS material_request_item_guard ON public.material_request_items;
CREATE TRIGGER material_request_item_guard BEFORE INSERT OR UPDATE OR DELETE ON public.material_request_items
  FOR EACH ROW EXECUTE FUNCTION public.material_request_guard_item();

CREATE OR REPLACE FUNCTION public.material_request_create(
  _request_type text, _site_id uuid, _department_id uuid, _reason text,
  _need_by_date date, _items jsonb, _submit boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_year integer := extract(year FROM now())::integer;
  v_number integer;
  v_request_id uuid;
  v_request_number text;
  v_line jsonb;
  v_count integer := 0;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  IF _request_type NOT IN ('material','equipment') THEN RAISE EXCEPTION 'نوع الطلب غير صالح'; END IF;
  IF NOT public.material_request_can_request(v_user, _department_id) THEN
    RAISE EXCEPTION 'لا تملك صلاحية تقديم طلب لهذا القسم';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sites WHERE id = _site_id) THEN RAISE EXCEPTION 'الموقع غير موجود'; END IF;
  IF _submit AND jsonb_array_length(coalesce(_items, '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'لا يمكن إرسال طلب بلا بنود';
  END IF;
  PERFORM set_config('app.material_requests_rpc', 'on', true);
  INSERT INTO public.material_request_counters(request_type, request_year, last_value)
    VALUES (_request_type, v_year, 1)
    ON CONFLICT (request_type, request_year)
    DO UPDATE SET last_value = public.material_request_counters.last_value + 1
    RETURNING last_value INTO v_number;
  v_request_number := (CASE WHEN _request_type = 'material' THEN 'MAT-' ELSE 'EQP-' END)
    || v_year::text || '-' || lpad(v_number::text, 4, '0');
  INSERT INTO public.material_requests(request_number, request_type, created_by, department_id,
    site_id, status, reason, need_by_date, submitted_at)
  VALUES (v_request_number, _request_type, v_user, _department_id, _site_id,
    CASE WHEN _submit THEN 'pending_planning' ELSE 'draft' END,
    coalesce(_reason, ''), _need_by_date, CASE WHEN _submit THEN now() ELSE NULL END)
  RETURNING id INTO v_request_id;
  FOR v_line IN SELECT value FROM jsonb_array_elements(coalesce(_items, '[]'::jsonb))
  LOOP
    IF length(trim(coalesce(v_line->>'item_name',''))) = 0
      OR length(trim(coalesce(v_line->>'unit',''))) = 0
      OR coalesce((v_line->>'quantity')::numeric, 0) <= 0 THEN
      RAISE EXCEPTION 'تحقق من اسم البند ووحدته وكميته';
    END IF;
    INSERT INTO public.material_request_items(request_id, original_qty, requested_qty,
      item_name, unit, specifications)
    VALUES (v_request_id, (v_line->>'quantity')::numeric, (v_line->>'quantity')::numeric,
      trim(v_line->>'item_name'), trim(v_line->>'unit'), nullif(trim(v_line->>'specifications'),''));
    v_count := v_count + 1;
  END LOOP;
  INSERT INTO public.material_request_events(request_id, action, actor_id, note, new_value)
  VALUES (v_request_id, CASE WHEN _submit THEN 'submitted' ELSE 'draft_created' END,
    v_user, nullif(trim(coalesce(_reason,'')),''), jsonb_build_object('request_number',v_request_number,'item_count',v_count));
  RETURN jsonb_build_object('id',v_request_id,'request_number',v_request_number,'status',
    CASE WHEN _submit THEN 'pending_planning' ELSE 'draft' END);
END;
$$;

CREATE OR REPLACE FUNCTION public.material_request_edit(
  _request_id uuid, _site_id uuid, _reason text, _need_by_date date, _items jsonb, _submit boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_request public.material_requests%ROWTYPE;
  v_line jsonb;
  v_item_id uuid;
  v_old_item public.material_request_items%ROWTYPE;
  v_keep_ids uuid[] := ARRAY[]::uuid[];
  v_qty numeric;
  v_count integer := 0;
BEGIN
  SELECT * INTO v_request FROM public.material_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND OR v_request.created_by <> auth.uid() THEN RAISE EXCEPTION 'الطلب غير موجود أو لا تملكه'; END IF;
  IF v_request.status NOT IN ('draft','returned') THEN RAISE EXCEPTION 'لا يمكن تعديل الطلب في مرحلته الحالية'; END IF;
  IF NOT public.material_request_can_request(auth.uid(), v_request.department_id) THEN RAISE EXCEPTION 'لا تملك صلاحية تعديل هذا الطلب'; END IF;
  IF _submit AND jsonb_array_length(coalesce(_items, '[]'::jsonb)) = 0 THEN RAISE EXCEPTION 'لا يمكن إرسال طلب بلا بنود'; END IF;
  PERFORM set_config('app.material_requests_rpc', 'on', true);
  UPDATE public.material_requests SET site_id = _site_id, reason = coalesce(_reason,''),
    need_by_date = _need_by_date, updated_at = now() WHERE id = _request_id;
  FOR v_line IN SELECT value FROM jsonb_array_elements(coalesce(_items, '[]'::jsonb))
  LOOP
    v_qty := coalesce((v_line->>'quantity')::numeric, 0);
    IF length(trim(coalesce(v_line->>'item_name',''))) = 0 OR length(trim(coalesce(v_line->>'unit',''))) = 0 OR v_qty <= 0 THEN
      RAISE EXCEPTION 'تحقق من اسم البند ووحدته وكميته';
    END IF;
    v_item_id := nullif(v_line->>'id','')::uuid;
    IF v_item_id IS NULL THEN
      INSERT INTO public.material_request_items(request_id, original_qty, requested_qty, item_name, unit, specifications)
      VALUES (_request_id, v_qty, v_qty, trim(v_line->>'item_name'), trim(v_line->>'unit'), nullif(trim(v_line->>'specifications'),''))
      RETURNING id INTO v_item_id;
      INSERT INTO public.material_request_events(request_id,request_item_id,action,actor_id,new_value)
      VALUES (_request_id,v_item_id,'applicant_added_item',auth.uid(),jsonb_build_object(
        'item_name',trim(v_line->>'item_name'),'unit',trim(v_line->>'unit'),'quantity',v_qty));
    ELSE
      SELECT * INTO v_old_item FROM public.material_request_items
        WHERE id=v_item_id AND request_id=_request_id AND NOT is_removed FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'أحد بنود الطلب غير صالح'; END IF;
      UPDATE public.material_request_items SET requested_qty = v_qty, item_name = trim(v_line->>'item_name'),
        original_qty = CASE WHEN v_request.status='draft' THEN v_qty ELSE original_qty END,
        unit = trim(v_line->>'unit'), specifications = nullif(trim(v_line->>'specifications'),''),
        is_removed = false, updated_at = now()
      WHERE id = v_item_id AND request_id = _request_id AND is_removed = false;
      INSERT INTO public.material_request_events(request_id,request_item_id,action,actor_id,old_value,new_value)
      VALUES (_request_id,v_item_id,'applicant_edited_item',auth.uid(),to_jsonb(v_old_item),
        jsonb_build_object('requested_qty',v_qty,'item_name',trim(v_line->>'item_name'),
          'unit',trim(v_line->>'unit'),'specifications',nullif(trim(v_line->>'specifications'),'')));
    END IF;
    v_keep_ids := array_append(v_keep_ids, v_item_id);
    v_count := v_count + 1;
  END LOOP;
  INSERT INTO public.material_request_events(request_id,request_item_id,action,actor_id,old_value,new_value)
  SELECT _request_id,item.id,'applicant_removed_item',auth.uid(),to_jsonb(item),jsonb_build_object('is_removed',true)
  FROM public.material_request_items item
  WHERE item.request_id=_request_id AND item.is_removed=false AND NOT (item.id=ANY(v_keep_ids));
  UPDATE public.material_request_items SET is_removed = true, status = 'excluded', updated_at = now()
  WHERE request_id = _request_id AND is_removed = false AND NOT (id = ANY(v_keep_ids));
  IF _submit THEN
    UPDATE public.material_requests SET status = 'pending_planning',
      submitted_at = coalesce(submitted_at, now()), updated_at = now() WHERE id = _request_id;
  END IF;
  INSERT INTO public.material_request_events(request_id, action, actor_id, note, old_value, new_value)
  VALUES (_request_id, CASE WHEN _submit THEN 'resubmitted' ELSE 'edited' END, auth.uid(),
    nullif(trim(coalesce(_reason,'')),''), to_jsonb(v_request), jsonb_build_object('item_count',v_count));
  RETURN jsonb_build_object('id',_request_id,'request_number',v_request.request_number,
    'status',CASE WHEN _submit THEN 'pending_planning' ELSE v_request.status END);
END;
$$;

CREATE OR REPLACE FUNCTION public.material_request_planning_review(
  _request_id uuid, _action text, _note text, _items jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_request public.material_requests%ROWTYPE;
  v_line jsonb;
  v_item public.material_request_items%ROWTYPE;
  v_qty numeric;
  v_count integer := 0;
  v_target text;
BEGIN
  IF NOT (public.is_admin(auth.uid()) OR public.material_request_is_company_manager(auth.uid())
      OR public.has_role(auth.uid(),'planning_officer')) THEN RAISE EXCEPTION 'هذا الإجراء لمسؤول التخطيط'; END IF;
  SELECT * INTO v_request FROM public.material_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND OR v_request.status <> 'pending_planning' THEN RAISE EXCEPTION 'الطلب ليس بانتظار التخطيط'; END IF;
  IF _action NOT IN ('approve','return','reject') THEN RAISE EXCEPTION 'الإجراء غير صالح'; END IF;
  IF _action IN ('return','reject') AND length(trim(coalesce(_note,''))) < 3 THEN RAISE EXCEPTION 'الملاحظة أو سبب الرفض إلزامي'; END IF;
  PERFORM set_config('app.material_requests_rpc','on',true);
  IF _action = 'approve' THEN
    IF jsonb_array_length(coalesce(_items,'[]'::jsonb)) < 1 OR
      (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(coalesce(_items,'[]'::jsonb)))
        <> jsonb_array_length(_items) THEN
      RAISE EXCEPTION 'تأكد من إرسال كل بند مرة واحدة';
    END IF;
    FOR v_line IN SELECT value FROM jsonb_array_elements(coalesce(_items,'[]'::jsonb)) LOOP
      SELECT * INTO v_item FROM public.material_request_items
        WHERE id = (v_line->>'id')::uuid AND request_id = _request_id AND NOT is_removed FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'بند غير صالح في المراجعة'; END IF;
      v_qty := coalesce((v_line->>'approved_qty')::numeric, -1);
      IF v_qty < 0 OR v_qty > v_item.requested_qty THEN RAISE EXCEPTION 'لا يمكن رفع الكمية عن طلب مقدم الطلب'; END IF;
      IF v_qty < v_item.requested_qty AND length(trim(coalesce(v_line->>'note',''))) < 3 THEN
        RAISE EXCEPTION 'ملاحظة إلزامية عند تخفيض الكمية';
      END IF;
      UPDATE public.material_request_items SET planning_approved_qty = v_qty,
        planning_note = nullif(trim(coalesce(v_line->>'note','')),''),
        status = CASE WHEN v_qty = 0 THEN 'excluded' ELSE 'pending' END, updated_at = now()
      WHERE id = v_item.id;
      INSERT INTO public.material_request_events(request_id,request_item_id,action,actor_id,note,old_value,new_value)
      VALUES (_request_id,v_item.id,'planning_quantity',auth.uid(),nullif(trim(coalesce(v_line->>'note','')),''),
        jsonb_build_object('requested_qty',v_item.requested_qty),jsonb_build_object('approved_qty',v_qty));
      v_count := v_count + 1;
    END LOOP;
    IF v_count <> (SELECT count(*) FROM public.material_request_items WHERE request_id = _request_id AND NOT is_removed)
      OR NOT EXISTS (SELECT 1 FROM public.material_request_items
        WHERE request_id = _request_id AND NOT is_removed AND coalesce(planning_approved_qty,0) > 0) THEN
      RAISE EXCEPTION 'اعتمد جميع البنود بكمية موجبة أو أعد الطلب';
    END IF;
    v_target := 'pending_warehouse';
  ELSE
    v_target := CASE WHEN _action = 'return' THEN 'returned' ELSE 'rejected' END;
  END IF;
  UPDATE public.material_requests SET status = v_target, updated_at = now() WHERE id = _request_id;
  INSERT INTO public.material_request_events(request_id,action,actor_id,note,old_value,new_value)
  VALUES (_request_id,'planning_'||_action,auth.uid(),nullif(trim(coalesce(_note,'')),''),
    jsonb_build_object('status',v_request.status),jsonb_build_object('status',v_target));
  RETURN jsonb_build_object('id',_request_id,'status',v_target);
END;
$$;

CREATE OR REPLACE FUNCTION public.material_request_warehouse_review(_request_id uuid, _items jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_request public.material_requests%ROWTYPE;
  v_line jsonb;
  v_item public.material_request_items%ROWTYPE;
  v_available numeric;
  v_issue numeric;
  v_purchase numeric;
  v_target text;
  v_pending boolean := false;
  v_partial boolean := false;
BEGIN
  IF NOT (public.is_admin(auth.uid()) OR public.material_request_is_company_manager(auth.uid())
      OR public.has_role(auth.uid(),'warehouse_keeper')) THEN RAISE EXCEPTION 'هذا الإجراء لمسؤول المخازن'; END IF;
  SELECT * INTO v_request FROM public.material_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND OR v_request.status <> 'pending_warehouse' THEN RAISE EXCEPTION 'الطلب ليس بانتظار مراجعة المخازن'; END IF;
  IF (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(coalesce(_items,'[]'::jsonb)))
      <> (SELECT count(*) FROM public.material_request_items WHERE request_id=_request_id AND NOT is_removed AND coalesce(planning_approved_qty,0)>0)
    OR jsonb_array_length(coalesce(_items,'[]'::jsonb)) <>
      (SELECT count(*) FROM public.material_request_items WHERE request_id=_request_id AND NOT is_removed AND coalesce(planning_approved_qty,0)>0) THEN
    RAISE EXCEPTION 'يجب مراجعة كل البنود المعتمدة مرة واحدة';
  END IF;
  PERFORM set_config('app.material_requests_rpc','on',true);
  FOR v_line IN SELECT value FROM jsonb_array_elements(coalesce(_items,'[]'::jsonb)) LOOP
    SELECT * INTO v_item FROM public.material_request_items
      WHERE id = (v_line->>'id')::uuid AND request_id = _request_id AND NOT is_removed FOR UPDATE;
    IF NOT FOUND OR coalesce(v_item.planning_approved_qty,0) <= 0 THEN RAISE EXCEPTION 'بند غير صالح للمراجعة'; END IF;
    v_issue := coalesce((v_line->>'issue_qty')::numeric,0);
    v_purchase := coalesce((v_line->>'purchase_qty')::numeric,0);
    IF v_issue < 0 OR v_purchase < 0 OR v_issue + v_purchase > v_item.planning_approved_qty THEN
      RAISE EXCEPTION 'مجموع الصرف والشراء يتجاوز الكمية المعتمدة';
    END IF;
    IF v_issue + v_purchase < v_item.planning_approved_qty AND length(trim(coalesce(v_line->>'reason',''))) < 3 THEN
      RAISE EXCEPTION 'سبب إلزامي للكمية غير المغطاة';
    END IF;
    v_available := 0;
    IF nullif(v_line->>'warehouse_item_id','') IS NOT NULL THEN
      PERFORM 1 FROM public.warehouse_items WHERE id = (v_line->>'warehouse_item_id')::uuid FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'الصنف المخزني غير موجود'; END IF;
      IF (SELECT kind FROM public.warehouse_items WHERE id = (v_line->>'warehouse_item_id')::uuid)
        <> (CASE WHEN v_request.request_type = 'equipment' THEN 'tool' ELSE 'material' END) THEN
        RAISE EXCEPTION 'نوع الصنف لا يطابق نوع الطلب';
      END IF;
      IF nullif(v_line->>'warehouse_id','') IS NOT NULL THEN
        SELECT greatest(coalesce(sum(qty_delta),0),0) INTO v_available FROM public.stock_movements
        WHERE warehouse_id = (v_line->>'warehouse_id')::uuid AND item_id = (v_line->>'warehouse_item_id')::uuid;
      END IF;
    ELSIF v_issue > 0 THEN
      RAISE EXCEPTION 'ربط الصنف المخزني مطلوب عند الصرف';
    END IF;
    IF v_issue > v_available THEN RAISE EXCEPTION 'الرصيد الحالي لا يكفي للصرف'; END IF;
    IF v_issue > 0 AND nullif(v_line->>'warehouse_id','') IS NULL THEN RAISE EXCEPTION 'اختر المخزن مصدر الصرف'; END IF;
    UPDATE public.material_request_items SET warehouse_item_id = nullif(v_line->>'warehouse_item_id','')::uuid,
      source_warehouse_id = nullif(v_line->>'warehouse_id','')::uuid,
      is_new_item = coalesce((v_line->>'is_new_item')::boolean,false), warehouse_available_qty = v_available,
      issue_qty = v_issue, purchase_qty = v_purchase, allocation_reason = nullif(trim(coalesce(v_line->>'reason','')),''),
      status = CASE WHEN v_issue + v_purchase >= v_item.planning_approved_qty THEN
        CASE WHEN v_purchase > 0 THEN 'for_purchase' ELSE 'received_full' END
        WHEN v_issue > 0 THEN 'received_partial' ELSE 'not_purchased' END,
      updated_at = now()
    WHERE id = v_item.id;
    INSERT INTO public.material_request_events(request_id,request_item_id,action,actor_id,old_value,new_value)
    VALUES (_request_id,v_item.id,'warehouse_item_allocation',auth.uid(),
      jsonb_build_object('available_qty',v_item.warehouse_available_qty,'issue_qty',v_item.issue_qty,'purchase_qty',v_item.purchase_qty),
      jsonb_build_object('available_qty',v_available,'issue_qty',v_issue,'purchase_qty',v_purchase,
        'warehouse_item_id',nullif(v_line->>'warehouse_item_id','')::uuid,
        'warehouse_id',nullif(v_line->>'warehouse_id','')::uuid));
    IF v_issue > 0 THEN
      INSERT INTO public.stock_movements(warehouse_id,item_id,movement_type,qty_delta,movement_date,site_id,notes,created_by,material_request_id,material_request_item_id)
      VALUES ((v_line->>'warehouse_id')::uuid,(v_line->>'warehouse_item_id')::uuid,'issue',-v_issue,CURRENT_DATE,
        v_request.site_id,'صرف طلب '||v_request.request_number,auth.uid(),_request_id,v_item.id);
    END IF;
    IF v_purchase > 0 THEN v_pending := true; END IF;
    IF v_issue + v_purchase < v_item.planning_approved_qty THEN v_partial := true; END IF;
  END LOOP;
  IF v_pending THEN v_target := 'pending_procurement';
  ELSIF v_partial THEN v_target := 'partially_received';
  ELSE v_target := 'received'; END IF;
  UPDATE public.material_requests SET status = v_target, updated_at = now() WHERE id = _request_id;
  INSERT INTO public.material_request_events(request_id,action,actor_id,old_value,new_value)
  VALUES (_request_id,'warehouse_review_confirmed',auth.uid(),jsonb_build_object('status',v_request.status),jsonb_build_object('status',v_target));
  RETURN jsonb_build_object('id',_request_id,'status',v_target);
END;
$$;

CREATE OR REPLACE FUNCTION public.material_request_add_purchase_batch(
  _request_id uuid, _supplier text, _document_number text, _purchase_date date, _notes text, _items jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_request public.material_requests%ROWTYPE;
  v_batch_id uuid;
  v_line jsonb;
  v_item public.material_request_items%ROWTYPE;
  v_qty numeric;
  v_reason text;
  v_count integer := 0;
BEGIN
  IF NOT (public.is_admin(auth.uid()) OR public.material_request_is_company_manager(auth.uid())
      OR public.has_role(auth.uid(),'procurement_officer')) THEN RAISE EXCEPTION 'هذا الإجراء لمسؤول المشتريات'; END IF;
  SELECT * INTO v_request FROM public.material_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND OR v_request.status NOT IN ('pending_procurement','purchasing','partially_received') THEN RAISE EXCEPTION 'الطلب ليس في مرحلة المشتريات'; END IF;
  IF length(trim(coalesce(_supplier,''))) < 2 THEN RAISE EXCEPTION 'اسم المورد مطلوب'; END IF;
  PERFORM set_config('app.material_requests_rpc','on',true);
  INSERT INTO public.material_procurement_batches(request_id,supplier,document_number,purchase_date,notes,created_by)
  VALUES (_request_id,trim(_supplier),nullif(trim(coalesce(_document_number,'')),''),coalesce(_purchase_date,CURRENT_DATE),nullif(trim(coalesce(_notes,'')),''),auth.uid())
  RETURNING id INTO v_batch_id;
  FOR v_line IN SELECT value FROM jsonb_array_elements(coalesce(_items,'[]'::jsonb)) LOOP
    SELECT * INTO v_item FROM public.material_request_items
      WHERE id = (v_line->>'id')::uuid AND request_id = _request_id AND NOT is_removed FOR UPDATE;
    IF NOT FOUND OR v_item.purchase_qty <= 0 THEN RAISE EXCEPTION 'بند غير صالح للشراء'; END IF;
    IF v_item.not_purchased_reason IS NOT NULL THEN RAISE EXCEPTION 'تم حسم عدم شراء المتبقي لهذا البند'; END IF;
    v_qty := coalesce((v_line->>'quantity')::numeric,0);
    v_reason := nullif(trim(coalesce(v_line->>'not_purchased_reason','')),'');
    IF v_qty < 0 OR v_item.purchased_qty + v_qty > v_item.purchase_qty THEN RAISE EXCEPTION 'الكمية المشتراة تتجاوز المطلوب'; END IF;
    IF v_qty = 0 AND v_reason IS NULL THEN CONTINUE; END IF;
    IF v_qty = 0 AND length(coalesce(v_reason,'')) < 3 THEN RAISE EXCEPTION 'اذكر سبب عدم شراء البند'; END IF;
    INSERT INTO public.material_procurement_batch_items(batch_id,request_item_id,purchased_qty,not_purchased_reason)
    VALUES (v_batch_id,v_item.id,v_qty,v_reason);
    UPDATE public.material_request_items SET purchased_qty = purchased_qty + v_qty,
      not_purchased_reason = coalesce(v_reason,not_purchased_reason),
      status = CASE WHEN v_reason IS NOT NULL AND v_qty = 0 THEN 'not_purchased' ELSE 'purchased' END,
      updated_at = now() WHERE id = v_item.id;
    v_count := v_count + 1;
  END LOOP;
  IF v_count = 0 THEN RAISE EXCEPTION 'أدخل بند شراء واحداً على الأقل'; END IF;
  UPDATE public.material_requests SET status = 'purchasing',updated_at=now()
    WHERE id = _request_id AND status='pending_procurement';
  INSERT INTO public.material_request_events(request_id,action,actor_id,note,new_value)
  VALUES (_request_id,'purchase_batch_created',auth.uid(),nullif(trim(coalesce(_notes,'')),''),
    jsonb_build_object('batch_id',v_batch_id,'supplier',_supplier));
  RETURN jsonb_build_object('id',v_batch_id,'request_id',_request_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.material_request_send_purchase_batch(_batch_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_batch public.material_procurement_batches%ROWTYPE;
  v_request public.material_requests%ROWTYPE;
  v_complete boolean;
  v_request_status text;
BEGIN
  IF NOT (public.is_admin(auth.uid()) OR public.material_request_is_company_manager(auth.uid())
      OR public.has_role(auth.uid(),'procurement_officer')) THEN RAISE EXCEPTION 'هذا الإجراء لمسؤول المشتريات'; END IF;
  SELECT * INTO v_batch FROM public.material_procurement_batches WHERE id = _batch_id FOR UPDATE;
  IF NOT FOUND OR v_batch.status <> 'draft' THEN RAISE EXCEPTION 'دفعة الشراء أرسلت سابقاً أو غير موجودة'; END IF;
  SELECT * INTO v_request FROM public.material_requests WHERE id=v_batch.request_id FOR UPDATE;
  IF v_request.status NOT IN ('pending_procurement','purchasing','partially_received') THEN
    RAISE EXCEPTION 'الطلب مغلق أو لم يعد في مرحلة المشتريات';
  END IF;
  UPDATE public.material_procurement_batches SET status='sent_to_warehouse',sent_at=now() WHERE id=_batch_id;
  SELECT NOT EXISTS (
    SELECT 1 FROM public.material_request_items item
    WHERE item.request_id=v_batch.request_id AND NOT item.is_removed AND item.purchase_qty>0
      AND item.purchased_qty < item.purchase_qty AND item.not_purchased_reason IS NULL
  ) AND NOT EXISTS (
    SELECT 1 FROM public.material_procurement_batches pending_batch
    WHERE pending_batch.request_id=v_batch.request_id AND pending_batch.status='draft'
  ) INTO v_complete;
  IF v_complete AND (SELECT status FROM public.material_requests WHERE id=v_batch.request_id)='purchasing' THEN
    UPDATE public.material_requests SET status='pending_receipt',updated_at=now()
      WHERE id=v_batch.request_id AND status='purchasing';
    v_request_status := 'pending_receipt';
  ELSE
    SELECT status INTO v_request_status FROM public.material_requests WHERE id=v_batch.request_id;
  END IF;
  INSERT INTO public.material_request_events(request_id,action,actor_id,new_value)
  VALUES (v_batch.request_id,'purchase_batch_sent_to_warehouse',auth.uid(),jsonb_build_object('batch_id',_batch_id));
  RETURN jsonb_build_object('batch_id',_batch_id,'request_status',v_request_status);
END;
$$;

CREATE OR REPLACE FUNCTION public.material_request_receive_batch(
  _batch_id uuid, _warehouse_id uuid, _idempotency_key uuid, _notes text, _items jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_batch public.material_procurement_batches%ROWTYPE;
  v_request public.material_requests%ROWTYPE;
  v_receipt_id uuid;
  v_line jsonb;
  v_batch_item public.material_procurement_batch_items%ROWTYPE;
  v_request_item public.material_request_items%ROWTYPE;
  v_qty numeric;
  v_remaining numeric;
  v_stock_item_id uuid;
  v_received_total numeric;
  v_all_complete boolean;
  v_any_received boolean;
  v_approval uuid;
  v_exclusion_reason text;
  v_existing_batch_id uuid;
BEGIN
  IF NOT (public.is_admin(auth.uid()) OR public.material_request_is_company_manager(auth.uid())
      OR public.has_role(auth.uid(),'warehouse_keeper')) THEN RAISE EXCEPTION 'هذا الإجراء لمسؤول المخازن'; END IF;
  SELECT id,batch_id INTO v_receipt_id,v_existing_batch_id
    FROM public.material_request_receipts WHERE idempotency_key=_idempotency_key;
  IF v_receipt_id IS NOT NULL THEN
    IF v_existing_batch_id<>_batch_id THEN RAISE EXCEPTION 'مفتاح الاستلام مستخدم لدفعة أخرى'; END IF;
    RETURN jsonb_build_object('id',v_receipt_id,'duplicate',true);
  END IF;
  IF jsonb_array_length(coalesce(_items,'[]'::jsonb)) = 0 THEN RAISE EXCEPTION 'أدخل بنود الاستلام'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.warehouses WHERE id=_warehouse_id AND is_main AND is_active) THEN
    RAISE EXCEPTION 'اختر المخزن الرئيسي النشط للاستلام';
  END IF;
  SELECT * INTO v_batch FROM public.material_procurement_batches WHERE id=_batch_id FOR UPDATE;
  IF NOT FOUND OR v_batch.status <> 'sent_to_warehouse' THEN RAISE EXCEPTION 'دفعة الشراء غير جاهزة للاستلام'; END IF;
  SELECT * INTO v_request FROM public.material_requests WHERE id=v_batch.request_id FOR UPDATE;
  IF v_request.status NOT IN ('pending_receipt','partially_received') THEN
    RAISE EXCEPTION 'الطلب مغلق أو ليس في مرحلة الاستلام';
  END IF;
  PERFORM set_config('app.material_requests_rpc','on',true);
  INSERT INTO public.material_request_receipts(idempotency_key,request_id,batch_id,warehouse_id,received_by,notes)
  VALUES (_idempotency_key,v_request.id,_batch_id,_warehouse_id,auth.uid(),nullif(trim(coalesce(_notes,'')),''))
  ON CONFLICT (idempotency_key) DO NOTHING RETURNING id INTO v_receipt_id;
  IF v_receipt_id IS NULL THEN
    SELECT id INTO v_receipt_id FROM public.material_request_receipts WHERE idempotency_key=_idempotency_key;
    RETURN jsonb_build_object('id',v_receipt_id,'duplicate',true);
  END IF;
  FOR v_line IN SELECT value FROM jsonb_array_elements(coalesce(_items,'[]'::jsonb)) LOOP
    SELECT * INTO v_batch_item FROM public.material_procurement_batch_items
      WHERE id=(v_line->>'batch_item_id')::uuid AND batch_id=_batch_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'بند دفعة غير صالح'; END IF;
    SELECT * INTO v_request_item FROM public.material_request_items WHERE id=v_batch_item.request_item_id FOR UPDATE;
    v_qty := coalesce((v_line->>'received_qty')::numeric,0);
    SELECT coalesce(sum(received_qty),0) INTO v_received_total
      FROM public.material_request_receipt_items WHERE batch_item_id=v_batch_item.id;
    v_remaining := v_batch_item.purchased_qty-v_received_total;
    IF v_qty < 0 OR v_qty > v_remaining THEN RAISE EXCEPTION 'الكمية المستلمة تتجاوز غير المستلم من هذه الدفعة'; END IF;
    IF coalesce((v_line->>'did_not_arrive')::boolean,false) AND v_qty > 0 THEN
      RAISE EXCEPTION 'لا يمكن تسجيل كمية مستلمة وبند لم يصل في الوقت نفسه';
    END IF;
    v_exclusion_reason := nullif(trim(coalesce(v_line->>'exclusion_reason','')),'');
    v_approval := nullif(v_line->>'approved_by','')::uuid;
    IF v_exclusion_reason IS NOT NULL AND (length(v_exclusion_reason)<3 OR v_approval IS NULL OR NOT (
      public.is_admin(v_approval) OR public.has_form_role(v_approval,'ceo') OR public.has_role(v_approval,'planning_officer')
    )) THEN RAISE EXCEPTION 'الاستبعاد يحتاج سبباً وموافقة التخطيط أو مدير الشركة أو الأدمن'; END IF;
    v_stock_item_id := coalesce(nullif(v_line->>'warehouse_item_id','')::uuid,v_request_item.warehouse_item_id);
    IF v_qty > 0 AND v_stock_item_id IS NULL THEN
      IF length(trim(coalesce(v_line->>'new_item_name',''))) < 2 THEN RAISE EXCEPTION 'اختر مادة مخزنية أو أدخل اسم المادة الجديدة'; END IF;
      INSERT INTO public.warehouse_items(name,kind,unit)
      VALUES (trim(v_line->>'new_item_name'),CASE WHEN v_request.request_type='equipment' THEN 'tool' ELSE 'material' END,
        coalesce(nullif(trim(v_line->>'new_item_unit'),''),v_request_item.unit))
      RETURNING id INTO v_stock_item_id;
    END IF;
    IF v_stock_item_id IS NOT NULL AND v_qty > 0 AND
      (SELECT kind FROM public.warehouse_items WHERE id=v_stock_item_id) <> (CASE WHEN v_request.request_type='equipment' THEN 'tool' ELSE 'material' END) THEN
      RAISE EXCEPTION 'نوع المادة المخزنية لا يطابق نوع الطلب';
    END IF;
    INSERT INTO public.material_request_receipt_items(receipt_id,request_item_id,batch_item_id,warehouse_item_id,
      received_qty,serial_notes,did_not_arrive,shortage_reason,exclusion_reason,exclusion_approved_by)
    VALUES (v_receipt_id,v_request_item.id,v_batch_item.id,v_stock_item_id,v_qty,
      nullif(trim(coalesce(v_line->>'serial_notes','')),''),
      coalesce((v_line->>'did_not_arrive')::boolean,false),nullif(trim(coalesce(v_line->>'shortage_reason','')),''),
      v_exclusion_reason,v_approval);
    IF v_qty > 0 THEN
      INSERT INTO public.stock_movements(warehouse_id,item_id,movement_type,qty_delta,movement_date,notes,created_by,
        material_request_id,material_request_item_id,material_request_receipt_id)
      VALUES (_warehouse_id,v_stock_item_id,'in',v_qty,CURRENT_DATE,
        'استلام '||v_receipt_id::text||' لطلب '||v_request.request_number,auth.uid(),v_request.id,v_request_item.id,v_receipt_id);
      UPDATE public.material_request_items SET warehouse_item_id=v_stock_item_id,received_qty=received_qty+v_qty,
        status=CASE WHEN issue_qty+received_qty+v_qty >= coalesce(planning_approved_qty,requested_qty) THEN 'received_full' ELSE 'received_partial' END,
        updated_at=now() WHERE id=v_request_item.id;
    ELSIF coalesce((v_line->>'did_not_arrive')::boolean,false) THEN
      UPDATE public.material_request_items SET status='not_arrived',updated_at=now()
        WHERE id=v_request_item.id AND received_qty=0 AND issue_qty=0;
    END IF;
    IF v_exclusion_reason IS NOT NULL THEN
      UPDATE public.material_request_items SET status='excluded',not_purchased_reason=v_exclusion_reason,updated_at=now()
        WHERE id=v_request_item.id;
    END IF;
  END LOOP;
  SELECT bool_and(item.status='excluded' OR
      (item.issue_qty+item.received_qty >= coalesce(item.planning_approved_qty,item.requested_qty)) OR
      (item.not_purchased_reason IS NOT NULL AND item.received_qty >= item.purchased_qty)),
    bool_or(item.issue_qty+item.received_qty>0)
    INTO v_all_complete,v_any_received
    FROM public.material_request_items item WHERE item.request_id=v_request.id AND NOT item.is_removed;
  UPDATE public.material_requests SET status=CASE WHEN coalesce(v_all_complete,false) THEN 'received'
    WHEN coalesce(v_any_received,false) THEN 'partially_received' ELSE status END,updated_at=now()
  WHERE id=v_request.id;
  INSERT INTO public.material_request_events(request_id,action,actor_id,note,new_value)
  VALUES (v_request.id,'receipt_confirmed',auth.uid(),nullif(trim(coalesce(_notes,'')),''),
    jsonb_build_object('receipt_id',v_receipt_id,'batch_id',_batch_id));
  RETURN jsonb_build_object('id',v_receipt_id,'duplicate',false);
END;
$$;

CREATE OR REPLACE FUNCTION public.material_request_close(_request_id uuid,_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_request public.material_requests%ROWTYPE;
BEGIN
  IF NOT (public.is_admin(auth.uid()) OR public.material_request_is_company_manager(auth.uid())) THEN
    RAISE EXCEPTION 'إغلاق الطلب يتطلب الأدمن أو مدير الشركة';
  END IF;
  IF length(trim(coalesce(_reason,'')))<3 THEN RAISE EXCEPTION 'سبب الإغلاق إلزامي'; END IF;
  SELECT * INTO v_request FROM public.material_requests WHERE id=_request_id FOR UPDATE;
  IF NOT FOUND OR v_request.status IN ('draft','pending_planning','returned','rejected','cancelled','closed') THEN
    RAISE EXCEPTION 'لا يمكن إغلاق الطلب في مرحلته الحالية';
  END IF;
  PERFORM set_config('app.material_requests_rpc','on',true);
  UPDATE public.material_requests SET closed_from_status=status,status='closed',close_reason=trim(_reason),updated_at=now()
    WHERE id=_request_id;
  INSERT INTO public.material_request_events(request_id,action,actor_id,note,old_value,new_value)
  VALUES (_request_id,'closed',auth.uid(),trim(_reason),jsonb_build_object('status',v_request.status),jsonb_build_object('status','closed'));
  RETURN jsonb_build_object('id',_request_id,'status','closed');
END;
$$;

CREATE OR REPLACE FUNCTION public.material_request_reopen(_request_id uuid,_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_request public.material_requests%ROWTYPE;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'إعادة فتح الطلب للأدمن فقط'; END IF;
  IF length(trim(coalesce(_reason,'')))<3 THEN RAISE EXCEPTION 'سبب إعادة الفتح إلزامي'; END IF;
  SELECT * INTO v_request FROM public.material_requests WHERE id=_request_id FOR UPDATE;
  IF NOT FOUND OR v_request.status<>'closed' OR v_request.closed_from_status IS NULL THEN RAISE EXCEPTION 'الطلب ليس مغلقاً'; END IF;
  PERFORM set_config('app.material_requests_rpc','on',true);
  UPDATE public.material_requests SET status=closed_from_status,closed_from_status=NULL,close_reason=NULL,updated_at=now()
    WHERE id=_request_id;
  INSERT INTO public.material_request_events(request_id,action,actor_id,note,old_value,new_value)
  VALUES (_request_id,'reopened',auth.uid(),trim(_reason),jsonb_build_object('status','closed'),jsonb_build_object('status',v_request.closed_from_status));
  RETURN jsonb_build_object('id',_request_id,'status',v_request.closed_from_status);
END;
$$;

CREATE OR REPLACE FUNCTION public.material_request_cancel(_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_request public.material_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_request FROM public.material_requests WHERE id=_request_id FOR UPDATE;
  IF NOT FOUND OR v_request.created_by<>auth.uid() OR v_request.status<>'pending_planning' THEN
    RAISE EXCEPTION 'يمكن إلغاء طلبك ما دام بانتظار التخطيط فقط';
  END IF;
  PERFORM set_config('app.material_requests_rpc','on',true);
  UPDATE public.material_requests SET status='cancelled',updated_at=now() WHERE id=_request_id;
  INSERT INTO public.material_request_events(request_id,action,actor_id) VALUES (_request_id,'cancelled',auth.uid());
  RETURN jsonb_build_object('id',_request_id,'status','cancelled');
END;
$$;

CREATE OR REPLACE FUNCTION public.material_request_options()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  RETURN jsonb_build_object(
    'actor',public.material_request_actor_context(),
    'sites',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) ORDER BY name),'[]'::jsonb) FROM public.sites),
    'departments',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) ORDER BY name),'[]'::jsonb) FROM public.departments),
    'warehouses',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'is_main',is_main) ORDER BY is_main DESC,name),'[]'::jsonb) FROM public.warehouses WHERE is_active),
    'items',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'kind',kind,'unit',unit) ORDER BY name),'[]'::jsonb) FROM public.warehouse_items WHERE is_active),
    'stock',(SELECT coalesce(jsonb_agg(jsonb_build_object('warehouse_id',stock.warehouse_id,'item_id',stock.item_id,'quantity',stock.quantity)),'[]'::jsonb)
      FROM (SELECT warehouse.id AS warehouse_id, item.id AS item_id, coalesce(sum(movement.qty_delta),0) AS quantity
        FROM public.warehouses warehouse CROSS JOIN public.warehouse_items item
        LEFT JOIN public.stock_movements movement ON movement.warehouse_id=warehouse.id AND movement.item_id=item.id
        WHERE warehouse.is_active AND item.is_active GROUP BY warehouse.id,item.id) stock),
    'approvers',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',authorized.user_id,
      'name',coalesce(profile.full_name,profile.email,'مستخدم')) ORDER BY profile.full_name),'[]'::jsonb)
      FROM (SELECT user_id FROM public.user_roles WHERE role IN ('admin','planning_officer')
        UNION SELECT user_id FROM public.form_role_assignments WHERE role='ceo') authorized
      LEFT JOIN public.profiles profile ON profile.id=authorized.user_id)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.material_request_list(
  _request_type text DEFAULT NULL, _search text DEFAULT NULL, _status text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_requests jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',request.id,'request_number',request.request_number,'request_type',request.request_type,
    'created_by',request.created_by,'created_by_name',profile.full_name,
    'department_id',request.department_id,'department_name',department.name,
    'site_id',request.site_id,'site_name',site.name,'status',request.status,'reason',request.reason,
    'need_by_date',request.need_by_date,'submitted_at',request.submitted_at,'created_at',request.created_at,
    'items',(SELECT coalesce(jsonb_agg(to_jsonb(item) ORDER BY item.created_at),'[]'::jsonb)
      FROM public.material_request_items item WHERE item.request_id=request.id AND NOT item.is_removed),
    'events',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',event.id,'action',event.action,
      'actor_id',event.actor_id,'actor_name',actor.full_name,'note',event.note,'old_value',event.old_value,
      'new_value',event.new_value,'created_at',event.created_at) ORDER BY event.created_at),'[]'::jsonb)
      FROM public.material_request_events event LEFT JOIN public.profiles actor ON actor.id=event.actor_id
      WHERE event.request_id=request.id),
    'batches',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',batch.id,'supplier',batch.supplier,
      'document_number',batch.document_number,'purchase_date',batch.purchase_date,'notes',batch.notes,
      'status',batch.status,'sent_at',batch.sent_at,'items',(SELECT coalesce(jsonb_agg(to_jsonb(line)),'[]'::jsonb)
        FROM public.material_procurement_batch_items line WHERE line.batch_id=batch.id)) ORDER BY batch.created_at),'[]'::jsonb)
      FROM public.material_procurement_batches batch WHERE batch.request_id=request.id),
    'receipts',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',receipt.id,'batch_id',receipt.batch_id,
      'warehouse_id',receipt.warehouse_id,'received_by',receipt.received_by,'received_at',receipt.received_at,
      'notes',receipt.notes,'items',(SELECT coalesce(jsonb_agg(to_jsonb(line)),'[]'::jsonb)
        FROM public.material_request_receipt_items line WHERE line.receipt_id=receipt.id)) ORDER BY receipt.received_at),'[]'::jsonb)
      FROM public.material_request_receipts receipt WHERE receipt.request_id=request.id)
  ) ORDER BY request.created_at DESC),'[]'::jsonb) INTO v_requests
  FROM public.material_requests request
  JOIN public.departments department ON department.id=request.department_id
  JOIN public.sites site ON site.id=request.site_id
  LEFT JOIN public.profiles profile ON profile.id=request.created_by
  WHERE public.material_request_can_read(request.id)
    AND (_request_type IS NULL OR request.request_type=_request_type)
    AND (_status IS NULL OR request.status=_status)
    AND (nullif(trim(coalesce(_search,'')),'') IS NULL OR
      request.request_number ILIKE '%'||trim(_search)||'%' OR site.name ILIKE '%'||trim(_search)||'%' OR
      department.name ILIKE '%'||trim(_search)||'%' OR profile.full_name ILIKE '%'||trim(_search)||'%' OR
      EXISTS(SELECT 1 FROM public.material_request_items item
        WHERE item.request_id=request.id AND item.item_name ILIKE '%'||trim(_search)||'%'));
  RETURN jsonb_build_object('requests',v_requests,'actor',public.material_request_actor_context());
END;
$$;

REVOKE ALL ON FUNCTION public.material_request_is_company_manager(uuid),
  public.material_request_can_read(uuid),public.material_request_can_request(uuid,uuid),
  public.material_request_guard_status(),public.material_request_guard_item(),
  public.material_request_audit_append_only(),public.stock_movement_prevent_negative_balance()
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.material_request_actor_context(),public.material_request_options(),
  public.material_request_list(text,text,text),public.material_request_create(text,uuid,uuid,text,date,jsonb,boolean),
  public.material_request_edit(uuid,uuid,text,date,jsonb,boolean),
  public.material_request_planning_review(uuid,text,text,jsonb),public.material_request_warehouse_review(uuid,jsonb),
  public.material_request_add_purchase_batch(uuid,text,text,date,text,jsonb),
  public.material_request_send_purchase_batch(uuid),public.material_request_receive_batch(uuid,uuid,uuid,text,jsonb),
  public.material_request_close(uuid,text),public.material_request_reopen(uuid,text),
  public.material_request_cancel(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.material_request_can_read(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.material_request_actor_context(),public.material_request_options(),
  public.material_request_list(text,text,text),public.material_request_create(text,uuid,uuid,text,date,jsonb,boolean),
  public.material_request_edit(uuid,uuid,text,date,jsonb,boolean),
  public.material_request_planning_review(uuid,text,text,jsonb),public.material_request_warehouse_review(uuid,jsonb),
  public.material_request_add_purchase_batch(uuid,text,text,date,text,jsonb),
  public.material_request_send_purchase_batch(uuid),public.material_request_receive_batch(uuid,uuid,uuid,text,jsonb),
  public.material_request_close(uuid,text),public.material_request_reopen(uuid,text),
  public.material_request_cancel(uuid) TO authenticated;
