-- Persist the order chosen by the applicant without changing the request state machine.
ALTER TABLE public.material_request_items ADD COLUMN IF NOT EXISTS sort_order integer;
WITH ranked_items AS (
  SELECT id,row_number() OVER (PARTITION BY request_id ORDER BY created_at,id)-1 AS position
  FROM public.material_request_items WHERE sort_order IS NULL
)
UPDATE public.material_request_items item SET sort_order=ranked_items.position
FROM ranked_items WHERE item.id=ranked_items.id;
ALTER TABLE public.material_request_items ALTER COLUMN sort_order SET DEFAULT 0;
ALTER TABLE public.material_request_items ALTER COLUMN sort_order SET NOT NULL;

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
  v_position integer := 0;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  IF _request_type NOT IN ('material','equipment') THEN RAISE EXCEPTION 'نوع الطلب غير صالح'; END IF;
  IF NOT (public.has_role(v_user,'engineer') OR public.has_role(v_user,'department_manager')
    OR public.has_role(v_user,'supervisor') OR public.has_role(v_user,'site_admin')) THEN
    RAISE EXCEPTION 'إنشاء الطلبات متاح لمقدمي الطلبات فقط';
  END IF;
  IF NOT public.material_request_can_request(v_user,_department_id) THEN RAISE EXCEPTION 'لا تملك صلاحية تقديم طلب لهذا القسم'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sites WHERE id=_site_id) THEN RAISE EXCEPTION 'الموقع غير موجود'; END IF;
  IF _submit AND jsonb_array_length(coalesce(_items,'[]'::jsonb))=0 THEN RAISE EXCEPTION 'لا يمكن إرسال طلب بلا بنود'; END IF;
  PERFORM set_config('app.material_requests_rpc','on',true);
  INSERT INTO public.material_request_counters(request_type,request_year,last_value)
    VALUES (_request_type,v_year,1)
    ON CONFLICT (request_type,request_year)
    DO UPDATE SET last_value=public.material_request_counters.last_value+1
    RETURNING last_value INTO v_number;
  v_request_number := (CASE WHEN _request_type='material' THEN 'MAT-' ELSE 'EQP-' END)
    || v_year::text || '-' || lpad(v_number::text,4,'0');
  INSERT INTO public.material_requests(request_number,request_type,created_by,department_id,site_id,status,reason,need_by_date,submitted_at)
    VALUES (v_request_number,_request_type,v_user,_department_id,_site_id,
      CASE WHEN _submit THEN 'pending_planning' ELSE 'draft' END,coalesce(_reason,''),_need_by_date,
      CASE WHEN _submit THEN now() ELSE NULL END) RETURNING id INTO v_request_id;
  FOR v_line IN SELECT value FROM jsonb_array_elements(coalesce(_items,'[]'::jsonb))
  LOOP
    IF length(trim(coalesce(v_line->>'item_name','')))=0 OR length(trim(coalesce(v_line->>'unit','')))=0
      OR coalesce((v_line->>'quantity')::numeric,0)<=0 THEN RAISE EXCEPTION 'تحقق من اسم البند ووحدته وكميته'; END IF;
    INSERT INTO public.material_request_items(request_id,original_qty,requested_qty,item_name,unit,specifications,sort_order)
      VALUES (v_request_id,(v_line->>'quantity')::numeric,(v_line->>'quantity')::numeric,
        trim(v_line->>'item_name'),trim(v_line->>'unit'),nullif(trim(v_line->>'specifications'),''),v_position);
    v_count:=v_count+1;
    v_position:=v_position+1;
  END LOOP;
  INSERT INTO public.material_request_events(request_id,action,actor_id,note,new_value)
    VALUES (v_request_id,CASE WHEN _submit THEN 'submitted' ELSE 'draft_created' END,v_user,
      nullif(trim(coalesce(_reason,'')),''),jsonb_build_object('request_number',v_request_number,'item_count',v_count));
  RETURN jsonb_build_object('id',v_request_id,'request_number',v_request_number,
    'status',CASE WHEN _submit THEN 'pending_planning' ELSE 'draft' END);
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
  v_position integer := 0;
BEGIN
  IF NOT (public.has_role(auth.uid(),'engineer') OR public.has_role(auth.uid(),'department_manager')
    OR public.has_role(auth.uid(),'supervisor') OR public.has_role(auth.uid(),'site_admin')) THEN
    RAISE EXCEPTION 'تعديل الطلبات متاح لمقدمي الطلبات فقط';
  END IF;
  SELECT * INTO v_request FROM public.material_requests WHERE id=_request_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR v_request.created_by<>auth.uid() THEN RAISE EXCEPTION 'الطلب غير موجود أو لا تملكه'; END IF;
  IF v_request.status NOT IN ('draft','returned') THEN RAISE EXCEPTION 'لا يمكن تعديل الطلب في مرحلته الحالية'; END IF;
  IF NOT public.material_request_can_request(auth.uid(),v_request.department_id) THEN RAISE EXCEPTION 'لا تملك صلاحية تعديل هذا الطلب'; END IF;
  IF _submit AND jsonb_array_length(coalesce(_items,'[]'::jsonb))=0 THEN RAISE EXCEPTION 'لا يمكن إرسال طلب بلا بنود'; END IF;
  PERFORM set_config('app.material_requests_rpc','on',true);
  UPDATE public.material_requests SET site_id=_site_id,reason=coalesce(_reason,''),need_by_date=_need_by_date,updated_at=now()
    WHERE id=_request_id;
  FOR v_line IN SELECT value FROM jsonb_array_elements(coalesce(_items,'[]'::jsonb))
  LOOP
    v_qty:=coalesce((v_line->>'quantity')::numeric,0);
    IF length(trim(coalesce(v_line->>'item_name','')))=0 OR length(trim(coalesce(v_line->>'unit','')))=0 OR v_qty<=0
      THEN RAISE EXCEPTION 'تحقق من اسم البند ووحدته وكميته'; END IF;
    v_item_id:=nullif(v_line->>'id','')::uuid;
    IF v_item_id IS NULL THEN
      INSERT INTO public.material_request_items(request_id,original_qty,requested_qty,item_name,unit,specifications,sort_order)
        VALUES (_request_id,v_qty,v_qty,trim(v_line->>'item_name'),trim(v_line->>'unit'),nullif(trim(v_line->>'specifications'),''),v_position)
        RETURNING id INTO v_item_id;
      INSERT INTO public.material_request_events(request_id,request_item_id,action,actor_id,new_value)
        VALUES (_request_id,v_item_id,'applicant_added_item',auth.uid(),jsonb_build_object(
          'item_name',trim(v_line->>'item_name'),'unit',trim(v_line->>'unit'),'quantity',v_qty,'sort_order',v_position));
    ELSE
      SELECT * INTO v_old_item FROM public.material_request_items
        WHERE id=v_item_id AND request_id=_request_id AND NOT is_removed FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'أحد بنود الطلب غير صالح'; END IF;
      UPDATE public.material_request_items SET requested_qty=v_qty,item_name=trim(v_line->>'item_name'),
        original_qty=CASE WHEN v_request.status='draft' THEN v_qty ELSE original_qty END,
        unit=trim(v_line->>'unit'),specifications=nullif(trim(v_line->>'specifications'),''),
        sort_order=v_position,is_removed=false,updated_at=now()
        WHERE id=v_item_id AND request_id=_request_id AND is_removed=false;
      INSERT INTO public.material_request_events(request_id,request_item_id,action,actor_id,old_value,new_value)
        VALUES (_request_id,v_item_id,'applicant_edited_item',auth.uid(),to_jsonb(v_old_item),
          jsonb_build_object('requested_qty',v_qty,'item_name',trim(v_line->>'item_name'),
            'unit',trim(v_line->>'unit'),'specifications',nullif(trim(v_line->>'specifications'),''),'sort_order',v_position));
    END IF;
    v_keep_ids:=array_append(v_keep_ids,v_item_id);
    v_count:=v_count+1;
    v_position:=v_position+1;
  END LOOP;
  INSERT INTO public.material_request_events(request_id,request_item_id,action,actor_id,old_value,new_value)
    SELECT _request_id,item.id,'applicant_removed_item',auth.uid(),to_jsonb(item),jsonb_build_object('is_removed',true)
    FROM public.material_request_items item WHERE item.request_id=_request_id AND item.is_removed=false
      AND NOT (item.id=ANY(v_keep_ids));
  UPDATE public.material_request_items SET is_removed=true,status='excluded',updated_at=now()
    WHERE request_id=_request_id AND is_removed=false AND NOT (id=ANY(v_keep_ids));
  IF _submit THEN
    UPDATE public.material_requests SET status='pending_planning',submitted_at=coalesce(submitted_at,now()),updated_at=now()
      WHERE id=_request_id;
  END IF;
  INSERT INTO public.material_request_events(request_id,action,actor_id,note,old_value,new_value)
    VALUES (_request_id,CASE WHEN _submit THEN 'resubmitted' ELSE 'edited' END,auth.uid(),
      nullif(trim(coalesce(_reason,'')),''),to_jsonb(v_request),jsonb_build_object('item_count',v_count));
  RETURN jsonb_build_object('id',_request_id,'request_number',v_request.request_number,
    'status',CASE WHEN _submit THEN 'pending_planning' ELSE v_request.status END);
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
  SELECT * INTO v_source FROM public.material_requests WHERE id=_request_id AND deleted_at IS NULL FOR SHARE;
  IF NOT FOUND OR v_source.created_by<>auth.uid() THEN RAISE EXCEPTION 'يمكن نسخ طلباتك السابقة فقط'; END IF;
  IF NOT public.material_request_can_request(auth.uid(),v_source.department_id) THEN RAISE EXCEPTION 'لم تعد تملك صلاحية إنشاء طلب لهذا القسم'; END IF;
  PERFORM set_config('app.material_requests_rpc','on',true);
  INSERT INTO public.material_request_counters(request_type,request_year,last_value)
    VALUES (v_source.request_type,v_year,1)
    ON CONFLICT (request_type,request_year)
    DO UPDATE SET last_value=public.material_request_counters.last_value+1 RETURNING last_value INTO v_number;
  v_copy_number := (CASE WHEN v_source.request_type='material' THEN 'MAT-' ELSE 'EQP-' END)
    || v_year::text || '-' || lpad(v_number::text,4,'0');
  INSERT INTO public.material_requests(request_number,request_type,created_by,department_id,site_id,status,reason,need_by_date)
    VALUES (v_copy_number,v_source.request_type,auth.uid(),v_source.department_id,v_source.site_id,'draft',v_source.reason,v_source.need_by_date)
    RETURNING id INTO v_copy_id;
  FOR v_item IN SELECT * FROM public.material_request_items
    WHERE request_id=_request_id AND NOT is_removed ORDER BY sort_order,created_at,id
  LOOP
    INSERT INTO public.material_request_items(request_id,original_qty,requested_qty,item_name,unit,specifications,sort_order)
      VALUES (v_copy_id,v_item.requested_qty,v_item.requested_qty,v_item.item_name,v_item.unit,v_item.specifications,v_count);
    v_count:=v_count+1;
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
    'items',(SELECT coalesce(jsonb_agg(to_jsonb(item) ORDER BY item.sort_order,item.created_at,item.id),'[]'::jsonb)
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
    AND (nullif(trim(coalesce(_search,'')),'') IS NULL OR request.request_number ILIKE '%'||trim(_search)||'%'
      OR site.name ILIKE '%'||trim(_search)||'%' OR department.name ILIKE '%'||trim(_search)||'%'
      OR profile.full_name ILIKE '%'||trim(_search)||'%' OR EXISTS(SELECT 1 FROM public.material_request_items item
        WHERE item.request_id=request.id AND item.item_name ILIKE '%'||trim(_search)||'%'));
  RETURN jsonb_build_object('requests',v_requests,'actor',public.material_request_actor_context());
END;
$$;

CREATE OR REPLACE FUNCTION public.material_request_cancel(_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_request public.material_requests%ROWTYPE;
BEGIN
  IF NOT (public.has_role(auth.uid(),'engineer') OR public.has_role(auth.uid(),'department_manager')
    OR public.has_role(auth.uid(),'supervisor') OR public.has_role(auth.uid(),'site_admin')) THEN
    RAISE EXCEPTION 'إلغاء الطلب متاح لمقدمي الطلبات فقط';
  END IF;
  SELECT * INTO v_request FROM public.material_requests WHERE id=_request_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR v_request.created_by<>auth.uid() OR v_request.status<>'pending_planning' THEN
    RAISE EXCEPTION 'يمكن إلغاء طلبك ما دام بانتظار التخطيط فقط';
  END IF;
  PERFORM set_config('app.material_requests_rpc','on',true);
  UPDATE public.material_requests SET status='cancelled',updated_at=now() WHERE id=_request_id;
  INSERT INTO public.material_request_events(request_id,action,actor_id) VALUES (_request_id,'cancelled',auth.uid());
  RETURN jsonb_build_object('id',_request_id,'status','cancelled');
END;
$$;
