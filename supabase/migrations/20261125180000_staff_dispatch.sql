BEGIN;

CREATE TABLE public.staff_dispatches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispatch_date date NOT NULL DEFAULT ((now() AT TIME ZONE 'Asia/Baghdad')::date + 1),
  site_id uuid REFERENCES public.sites(id),
  workshop_id uuid REFERENCES public.daily_workshops(id),
  location_name text,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
  notes text NOT NULL DEFAULT '' CHECK (length(notes) <= 3000),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','confirmed','completed')),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(site_id, workshop_id, location_name) = 1),
  CHECK (location_name IS NULL OR length(btrim(location_name)) BETWEEN 1 AND 180)
);

CREATE TABLE public.staff_dispatch_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispatch_id uuid NOT NULL REFERENCES public.staff_dispatches(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id),
  specialty_category text NOT NULL,
  official_position text,
  sort_order integer NOT NULL CHECK (sort_order >= 0),
  UNIQUE (dispatch_id, employee_id)
);

CREATE INDEX staff_dispatches_date_idx ON public.staff_dispatches (dispatch_date, updated_at DESC, id);
CREATE INDEX staff_dispatches_owner_date_idx ON public.staff_dispatches (created_by, dispatch_date, updated_at DESC);
ALTER TABLE public.staff_dispatches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_dispatch_lines ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.staff_dispatches, public.staff_dispatch_lines TO authenticated;
GRANT ALL ON public.staff_dispatches, public.staff_dispatch_lines TO service_role;

CREATE FUNCTION public.can_use_staff_dispatch() RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM unnest(ARRAY['admin','hr','supervisor','planning_officer','site_admin']::public.app_role[]) AS roles(role)
    WHERE public.has_role(auth.uid(), roles.role)
  );
$$;

CREATE POLICY "staff read accessible dispatches" ON public.staff_dispatches FOR SELECT TO authenticated
  USING (public.can_use_staff_dispatch() AND (
    created_by = auth.uid() OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'hr')
  ));
CREATE POLICY "staff read accessible dispatch lines" ON public.staff_dispatch_lines FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.staff_dispatches d WHERE d.id = dispatch_id));

CREATE FUNCTION public.search_staff_dispatch(p_mode text, p_term text DEFAULT '', p_category text DEFAULT '', p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_names CONSTANT text[] := regexp_split_to_array($roster$حسين محسن محتون جولان
عدنان ايوب طعمة طلاع
حبيب اسماعيل عبود عثمان
جلال شاكر علي حمود
محمد عبدالرضا نوفل عبدالله
علي شاكر حسن هاشم
نعيم عبدالله فالح سلطان
عبد علي طالب يوسف فرحان
كرار حيدر حسن كاظم
حسين صبيح شويلي
طالب صبيح شويل
انور عبدالهادي مدلول
مصطفى عبدالكاظم خلف
حسين جوري خضير
نجاح سعيد سكر جابر
حسين رعد عبدالزهرة
قاسم سعيد داغر
نعيم حسين كرمش
علي جبر
موسى وارد
سجاد عبدالزهره مطر
مجتبى قاسم بلعوط عبيد
علي محسن بدوي عليوي
ميثم عبدالامير خليفة جبر
علي كاظم لفته
حسين حميد توفيق
زياد سنافي غضيب رخيص
حسين علي دحام لفتة
محمد سالم ضهيد ضيوف
علي جابر بندر مفضي
زين الدين وديع غافل مزيعل
حميد عبيد وادي زغير
كاظم جواد كاظم جاسم
محمد عبدالوصي يوسف محمد
مصطفى عقيل عبدالكريم جاسم
عباس فاضل كاظم جاسم
مهدي دعير جعفر علي
سعدون جابر بندر مفيظي
مصطفى نعمه كميت صبيح
حسين فاضل غافل مزيعل
فاروق علي احمد صقر
محمد مؤيد فيصل سوادي
عبد الفتاح كاظم مكطوف مهوس
جاسم بريسم عنيد عبد
محمد رزاق حمدان عزيز
زكريا يحيى فيصل سوادي
هاشم علي عبد العالي جابر
حيدر كاظم سلمان معلة
علي داخل حمدان
صلاح حسن عاشور
محمد حازم محمد
بسام فضل زاجي مهدي
ايمن عبد الرحيم جاسم
مصطفى جعفر صادق
حسين جمعه عبدالعباس
عدنان صابر حسن
محمد سنافي غضيب رخيص
عبدالامير محمد حسين عزيز
محمد اسماعيل عتوي عبد السادة
مهدي جعفر خيرالله شخموت
مصطفى عباس ثجيل
محمود قاسم عبدعلي جابر
عبدالنبي عبدالوهاب جازع كايم
مسلم عبد العظيم هاني
وعد ابراهيم شبار راضي
غافل فاضل غافل مزيعل
حسنين نعمان رسن
تحسين نعمان رسن
عبدالله مسلم طالب
عباس كاظم حسين بدر
عباس قاسم محمد جميل
قاسم محمد حسين
عبدالله ضياء عودة كنعان
علي ناصر مدهوش
سجاد عدنان كاظم
وليد لازم عطيه
حكيم جبار منصور
محمد رضا حامد موسى
حيدر قاسم محمد جودة
علي مؤيد فيصل
حسين جبر فياض
عدنان عيدان عبيد مناحي
حسن عبداللطيف ابراهيم
حسين حسن مرزوق
حسين كاطع لعيوس
محمد حسين داود القطراني
رائد جواد كاظم
عباس كاظم عبود
عبدالكريم عبدالوهاب
عبود جواد كاظم
احمد مسلم طالب
علي هاني كريم
كاظم عبدالجليل
حسين عيدان نصير
مسلم رمضان مطر
مهند توفيق منصور حسون
حسن عبد الكريم عبد الوهاب
وسام عباس مهدي
مرتضى سمير عبدالوهاب
حبيب عبدالكريم علي جاسم
مهيمن واثق علوان ثاني كاظم
احمد حسين علي كريدي
احمد عايد راضي منشد
محمد حسين طماطة وحيوه
حسن منشد حطاب خليفه
سجاد حيدر حسن
رضا علي خضير وادي
زين العابدين محمد منعثر
كرار علي جمعة مجمان
حيدر محمد نعمان يوسف
حسن موفق رفيق توفيق
احمد جليل سالم زباله
عبدالله توفيق منصور حسون
عباس حسين طماطة الونيس
جعفر صادق صباح
عون عبدالحسين علي
علي ناصر سكر جابر
مصطفى عقيل شايع
رضا محمد عيسى خالد
عباس سعد مشيهد
محمد لعيبي حطاب
جهاد عبد جبار عبيد
وليد عبدالمعبود عبدالعزيز عبدالامام
علي خليف عبدالحسين
رضا عباس توفيق
حيدر بشير دخيل
سليم ابوالريحة بدوي
عون احمد سلمان
ضيف الله عبد الدائم حرب
سجاد عيسى عبد اليرهب
مقتدى هاني فالح
علي فلاح حسن
رضا كاظم عباس
علي مسلم مهوس
حسين صالح عبدالواحد بصيراوي
صالح حاتم فايق الاجود
احمد جاسم محمد
رحيم حسن
صالح جاسب محمد
فواز جمعة هليل
محمد جاسم محمد ناصر
عبدالله فزع جابر لافي
احمد ذياب عاصي
محمد علي خالد
ارشد عباس شبار
مانع مذاع مسرهد
مناحي جاسم محمد ناصر
احمد صادق راضي
منصور مناحي منصور
سالم صباح سالم صبيح
جواد كاظم لفته يطان
حيدر رزاق شعو
جواد كاظم جواد ماشالله
محمد علي حسين منصور
حسين وليد عبدالعالي
علي ناظم داوود
محمد جعفر خالد بري
جاسم عدنان جاسم محمد
مرتضى حسن باسم
رضا قصي جمعة
كاظم صابر عبدالكاظم حنون
سمير عبدالوهاب
مرتضى شعلان سويلم
عبدالحليم عبدالسيد مصطفى
علي باقر كريم يعقوب
جعفر محمود كاظم جمعه$roster$, '[[:cntrl:]]+');
  v_result jsonb;
  v_term text := lower(btrim(coalesce(p_term,'')));
BEGIN
  IF NOT public.can_use_staff_dispatch() THEN RAISE insufficient_privilege; END IF;
  IF p_mode IS NULL OR p_mode NOT IN ('categories','roster','directory') OR length(v_term) > 100 OR coalesce(p_offset,0) < 0 THEN
    RAISE EXCEPTION 'Invalid dispatch search';
  END IF;
  IF p_mode = 'directory' AND length(v_term) < 2 THEN RETURN '[]'::jsonb; END IF;

  IF p_mode = 'categories' THEN
    SELECT coalesce(jsonb_agg(category ORDER BY (category = 'كوسرجي') DESC, category), '[]'::jsonb)
    INTO v_result FROM (
      SELECT DISTINCT coalesce(nullif(btrim(e.position),''), 'بدون تخصص') AS category
      FROM public.employees e WHERE e.status = 'active'
    ) categories;
    RETURN v_result;
  END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(result) ORDER BY result.full_name, result.id),'[]'::jsonb) INTO v_result
  FROM (
    SELECT e.id, e.full_name, e.employee_no, e.position, e.phone1,
      CASE WHEN p_mode = 'directory' THEN e.id_no END AS id_no,
      coalesce(nullif(btrim(e.position),''), 'بدون تخصص') AS category
    FROM public.employees e
    WHERE e.status = 'active'
      AND (p_mode = 'directory' OR (
        coalesce(nullif(btrim(e.position),''), 'بدون تخصص') = p_category
        AND (p_category = 'كوسرجي' OR regexp_replace(btrim(e.full_name), '[[:space:]]+', ' ', 'g') = ANY(v_names))
      ))
      AND NOT EXISTS (
        SELECT 1 FROM regexp_split_to_table(v_term, '[[:space:]]+') AS tokens(token)
        WHERE strpos(lower(e.full_name),token) = 0 AND strpos(lower(e.employee_no),token) = 0
      )
    ORDER BY e.full_name, e.id LIMIT 21 OFFSET coalesce(p_offset,0)
  ) result;
  RETURN v_result;
END;
$$;

CREATE FUNCTION public.save_staff_dispatch(
  p_id uuid, p_expected_updated_at timestamptz, p_date date, p_site uuid, p_workshop uuid, p_location text,
  p_title text, p_notes text, p_status text, p_employees uuid[]
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_id uuid;
  v_updated_at timestamptz;
  v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL OR NOT public.can_use_staff_dispatch() THEN RAISE insufficient_privilege; END IF;
  IF p_employees IS NULL OR cardinality(p_employees) > 1000 OR (
    p_status <> 'draft' AND cardinality(p_employees) = 0
  ) OR cardinality(p_employees) <> (SELECT count(DISTINCT e) FROM unnest(p_employees) AS employees(e)) THEN
    RAISE EXCEPTION 'Invalid staff list';
  END IF;
  IF p_site IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.sites WHERE id = p_site AND status = 'active'
  ) THEN RAISE EXCEPTION 'Site is not active'; END IF;
  IF p_workshop IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.daily_workshops WHERE id = p_workshop AND is_active
  ) THEN RAISE EXCEPTION 'Workshop is not active'; END IF;
  IF p_id IS NULL THEN
    INSERT INTO public.staff_dispatches (dispatch_date, site_id, workshop_id, location_name, title, notes, status, created_by)
    VALUES (p_date, p_site, p_workshop, nullif(btrim(p_location),''), btrim(p_title), coalesce(btrim(p_notes),''), p_status, v_user)
    RETURNING id, updated_at INTO v_id, v_updated_at;
  ELSE
    UPDATE public.staff_dispatches
    SET dispatch_date = p_date, site_id = p_site, workshop_id = p_workshop,
      location_name = nullif(btrim(p_location),''), title = btrim(p_title), notes = coalesce(btrim(p_notes),''),
      status = p_status, updated_at = clock_timestamp()
    WHERE id = p_id AND updated_at = p_expected_updated_at
      AND (created_by = v_user OR public.has_role(v_user,'admin') OR public.has_role(v_user,'hr'))
    RETURNING id, updated_at INTO v_id, v_updated_at;
    IF v_id IS NULL THEN RAISE EXCEPTION 'Dispatch changed or is no longer accessible' USING ERRCODE = '40001'; END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(p_employees) AS picked(id)
    JOIN public.employees e ON e.id = picked.id
    WHERE e.status <> 'active' AND NOT EXISTS (
      SELECT 1 FROM public.staff_dispatch_lines l WHERE l.dispatch_id = v_id AND l.employee_id = picked.id
    )
  ) OR (SELECT count(*) FROM public.employees WHERE id = ANY(p_employees)) <> cardinality(p_employees) THEN
    RAISE EXCEPTION 'Employee missing or inactive';
  END IF;

  DELETE FROM public.staff_dispatch_lines WHERE dispatch_id = v_id AND employee_id <> ALL(p_employees);
  INSERT INTO public.staff_dispatch_lines (dispatch_id, employee_id, specialty_category, official_position, sort_order)
    SELECT v_id, e.id, coalesce(nullif(btrim(e.position),''), 'بدون تخصص'), e.position, picked.ordinality - 1
    FROM unnest(p_employees) WITH ORDINALITY AS picked(id,ordinality)
    JOIN public.employees e ON e.id = picked.id
    ON CONFLICT (dispatch_id, employee_id) DO UPDATE SET sort_order = excluded.sort_order;
  RETURN jsonb_build_object('id',v_id,'updated_at',v_updated_at);
END;
$$;

CREATE FUNCTION public.read_staff_dispatch(p_date date, p_id uuid DEFAULT NULL, p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_result jsonb;
BEGIN
  IF NOT public.can_use_staff_dispatch() THEN RAISE insufficient_privilege; END IF;
  IF p_id IS NULL THEN
    SELECT coalesce(jsonb_agg(to_jsonb(result) ORDER BY result.updated_at DESC, result.id),'[]'::jsonb) INTO v_result
    FROM (
      SELECT d.id, d.title, d.status, d.updated_at, coalesce(d.location_name, w.name, s.name) AS destination
      FROM public.staff_dispatches d
      LEFT JOIN public.daily_workshops w ON w.id = d.workshop_id
      LEFT JOIN public.sites s ON s.id = d.site_id
      WHERE d.dispatch_date = p_date
      ORDER BY d.updated_at DESC, d.id LIMIT 11 OFFSET greatest(0,p_offset)
    ) result;
  ELSE
    SELECT to_jsonb(d) || jsonb_build_object(
      'destination', coalesce(d.location_name, w.name, concat_ws(' · ',s.ctr_code,s.name)),
      'employees', coalesce((
        SELECT jsonb_agg(jsonb_build_object('id', e.id, 'full_name', e.full_name, 'employee_no', e.employee_no,
          'position', l.official_position, 'category', l.specialty_category, 'phone1', e.phone1,
          'id_no', e.id_no) ORDER BY l.sort_order, l.id)
        FROM public.staff_dispatch_lines l JOIN public.employees e ON e.id = l.employee_id WHERE l.dispatch_id = d.id
      ),'[]'::jsonb)
    ) INTO v_result
    FROM public.staff_dispatches d
    LEFT JOIN public.daily_workshops w ON w.id = d.workshop_id
    LEFT JOIN public.sites s ON s.id = d.site_id
    WHERE d.id = p_id;
  END IF;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.read_staff_dispatch(date,uuid,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.read_staff_dispatch(date,uuid,integer) TO authenticated;

REVOKE ALL ON FUNCTION public.can_use_staff_dispatch(), public.search_staff_dispatch(text,text,text,integer),
  public.save_staff_dispatch(uuid,timestamptz,date,uuid,uuid,text,text,text,text,uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_use_staff_dispatch(), public.search_staff_dispatch(text,text,text,integer),
  public.save_staff_dispatch(uuid,timestamptz,date,uuid,uuid,text,text,text,text,uuid[]) TO authenticated;

COMMIT;
