-- Applicant-facing workspace additions. The existing request workflow and its transitions remain unchanged.
ALTER TABLE public.material_requests
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.material_request_items ADD COLUMN IF NOT EXISTS sort_order integer;
WITH ranked_items AS (
  SELECT id,row_number() OVER (PARTITION BY request_id ORDER BY created_at,id)-1 AS position
  FROM public.material_request_items WHERE sort_order IS NULL
)
UPDATE public.material_request_items item SET sort_order=ranked_items.position
FROM ranked_items WHERE item.id=ranked_items.id;
ALTER TABLE public.material_request_items ALTER COLUMN sort_order SET DEFAULT 0;
ALTER TABLE public.material_request_items ALTER COLUMN sort_order SET NOT NULL;

CREATE OR REPLACE FUNCTION public.material_request_can_read(_request_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.material_requests request
    WHERE request.id = _request_id
      AND request.deleted_at IS NULL
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

CREATE OR REPLACE FUNCTION public.material_request_options()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  IF NOT (
    public.material_request_is_company_manager(auth.uid())
    OR public.has_role(auth.uid(), 'engineer')
    OR public.has_role(auth.uid(), 'department_manager')
    OR public.has_role(auth.uid(), 'supervisor')
    OR public.has_role(auth.uid(), 'site_admin')
    OR public.has_role(auth.uid(), 'planning_officer')
    OR public.has_role(auth.uid(), 'warehouse_keeper')
    OR public.has_role(auth.uid(), 'procurement_officer')
  ) THEN RAISE EXCEPTION 'لا تملك صلاحية الوصول إلى خيارات دورة الطلبات'; END IF;
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

CREATE OR REPLACE FUNCTION public.material_request_delete_draft(_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_request public.material_requests%ROWTYPE;
BEGIN
  IF NOT (public.has_role(auth.uid(),'engineer') OR public.has_role(auth.uid(),'department_manager')
    OR public.has_role(auth.uid(),'supervisor') OR public.has_role(auth.uid(),'site_admin')) THEN
    RAISE EXCEPTION 'حذف المسودات متاح لمقدمي الطلبات فقط';
  END IF;
  SELECT * INTO v_request FROM public.material_requests
    WHERE id=_request_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR v_request.created_by<>auth.uid() OR v_request.status<>'draft' OR v_request.submitted_at IS NOT NULL THEN
    RAISE EXCEPTION 'يمكن أرشفة مسودتك غير المرسلة فقط';
  END IF;
  UPDATE public.material_requests SET deleted_at=now(),updated_at=now() WHERE id=_request_id;
  INSERT INTO public.material_request_events(request_id,action,actor_id,old_value,new_value)
  VALUES (_request_id,'draft_deleted',auth.uid(),
    jsonb_build_object('status',v_request.status,'deleted_at',null),
    jsonb_build_object('status',v_request.status,'deleted_at',now()));
  RETURN jsonb_build_object('id',_request_id,'status','deleted');
END;
$$;

CREATE OR REPLACE FUNCTION public.material_request_copy(_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_source public.material_requests%ROWTYPE;
  v_item public.material_request_items%ROWTYPE;
  v_year integer := extract(year FROM now())::integer;
  v_number integer;
  v_copy_id uuid;
  v_copy_number text;
  v_count integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  IF NOT (public.has_role(auth.uid(),'engineer') OR public.has_role(auth.uid(),'department_manager')
    OR public.has_role(auth.uid(),'supervisor') OR public.has_role(auth.uid(),'site_admin')) THEN
    RAISE EXCEPTION 'نسخ الطلبات متاح لمقدمي الطلبات فقط';
  END IF;
  SELECT * INTO v_source FROM public.material_requests
    WHERE id=_request_id AND deleted_at IS NULL FOR SHARE;
  IF NOT FOUND OR v_source.created_by<>auth.uid() THEN
    RAISE EXCEPTION 'يمكن نسخ طلباتك السابقة فقط';
  END IF;
  IF NOT public.material_request_can_request(auth.uid(),v_source.department_id) THEN
    RAISE EXCEPTION 'لم تعد تملك صلاحية إنشاء طلب لهذا القسم';
  END IF;
  PERFORM set_config('app.material_requests_rpc','on',true);
  INSERT INTO public.material_request_counters(request_type,request_year,last_value)
    VALUES (v_source.request_type,v_year,1)
    ON CONFLICT (request_type,request_year)
    DO UPDATE SET last_value=public.material_request_counters.last_value+1
    RETURNING last_value INTO v_number;
  v_copy_number := (CASE WHEN v_source.request_type='material' THEN 'MAT-' ELSE 'EQP-' END)
    || v_year::text || '-' || lpad(v_number::text,4,'0');
  INSERT INTO public.material_requests(request_number,request_type,created_by,department_id,site_id,status,reason,need_by_date)
    VALUES (v_copy_number,v_source.request_type,auth.uid(),v_source.department_id,v_source.site_id,'draft',v_source.reason,v_source.need_by_date)
    RETURNING id INTO v_copy_id;
  FOR v_item IN SELECT * FROM public.material_request_items
    WHERE request_id=_request_id AND NOT is_removed ORDER BY created_at,id
  LOOP
    INSERT INTO public.material_request_items(request_id,original_qty,requested_qty,item_name,unit,specifications)
      VALUES (v_copy_id,v_item.requested_qty,v_item.requested_qty,v_item.item_name,v_item.unit,v_item.specifications);
    v_count := v_count+1;
  END LOOP;
  INSERT INTO public.material_request_events(request_id,action,actor_id,note,old_value,new_value)
    VALUES (v_copy_id,'copied',auth.uid(),'نسخة جديدة من طلب سابق',
      jsonb_build_object('source_request_id',_request_id,'source_request_number',v_source.request_number),
      jsonb_build_object('item_count',v_count,'status','draft'));
  INSERT INTO public.material_request_events(request_id,action,actor_id,note,new_value)
    VALUES (_request_id,'copied_from',auth.uid(),'تم إنشاء مسودة من هذا الطلب',
      jsonb_build_object('new_request_id',v_copy_id,'new_request_number',v_copy_number));
  RETURN jsonb_build_object('id',v_copy_id,'request_number',v_copy_number,'status','draft');
END;
$$;

REVOKE ALL ON FUNCTION public.material_request_delete_draft(uuid),public.material_request_copy(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.material_request_delete_draft(uuid),public.material_request_copy(uuid) TO authenticated;
