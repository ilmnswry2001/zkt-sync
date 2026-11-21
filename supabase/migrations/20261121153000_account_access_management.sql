BEGIN;

-- Some deployments already have this table from the planning module.
CREATE TABLE IF NOT EXISTS public.plan_staffing_permissions (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  can_request boolean NOT NULL DEFAULT false,
  can_approve boolean NOT NULL DEFAULT false,
  can_staff_all boolean NOT NULL DEFAULT false,
  specialties text[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.plan_staffing_permissions ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON public.plan_staffing_permissions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.plan_staffing_permissions TO authenticated;
GRANT ALL ON public.plan_staffing_permissions TO service_role;
CREATE POLICY account_plan_permissions_read ON public.plan_staffing_permissions
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()) OR public.is_admin((SELECT auth.uid())));
CREATE POLICY account_plan_permissions_read_guard ON public.plan_staffing_permissions AS RESTRICTIVE
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()) OR public.is_admin((SELECT auth.uid())));

CREATE FUNCTION public.read_account_directory(
  p_search text DEFAULT '', p_role text DEFAULT '', p_page integer DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE result jsonb;
BEGIN
  IF public.is_admin(auth.uid()) IS NOT TRUE THEN
    RAISE EXCEPTION 'هذه العملية متاحة لمدير النظام فقط' USING ERRCODE = '42501';
  END IF;

  WITH matching AS (
    SELECT p.id, p.full_name, p.email, p.created_at
    FROM public.profiles p
    WHERE (
      strpos(lower(coalesce(p.full_name, '')), lower(btrim(p_search))) > 0
      OR strpos(lower(coalesce(p.email, '')), lower(btrim(p_search))) > 0
    ) AND (
      p_role = ''
      OR (p_role = 'unassigned' AND NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = p.id))
      OR EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = p.id AND r.role::text = p_role)
    )
  ), page AS (
    SELECT * FROM matching ORDER BY created_at DESC, id
    LIMIT 20 OFFSET greatest(0, p_page)::bigint * 20
  ), totals AS (
    SELECT count(*) AS total,
      count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = p.id)) AS unassigned
    FROM public.profiles p
  )
  SELECT jsonb_build_object(
    'accounts', coalesce((
      SELECT jsonb_agg(to_jsonb(p) || jsonb_build_object('roles', ARRAY(
        SELECT r.role FROM public.user_roles r WHERE r.user_id = p.id ORDER BY r.role
      )) ORDER BY p.created_at DESC, p.id)
      FROM page p
    ), '[]'::jsonb),
    'filteredCount', (SELECT count(*) FROM matching),
    'total', totals.total,
    'unassigned', totals.unassigned,
    'admins', (SELECT count(*) FROM public.user_roles WHERE role = 'admin')
  ) INTO result FROM totals;
  RETURN result;
END;
$$;

CREATE FUNCTION public.read_account_access(p_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE result jsonb;
BEGIN
  IF public.is_admin(auth.uid()) IS NOT TRUE THEN
    RAISE EXCEPTION 'هذه العملية متاحة لمدير النظام فقط' USING ERRCODE = '42501';
  END IF;
  SELECT jsonb_build_object(
    'fullName', p.full_name,
    'email', p.email,
    'roles', ARRAY(SELECT r.role FROM public.user_roles r WHERE r.user_id = p.id ORDER BY r.role),
    'departments', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name) ORDER BY d.name, d.id)
      FROM public.user_departments u JOIN public.departments d ON d.id = u.department_id
      WHERE u.user_id = p.id
    ), '[]'::jsonb),
    'allowedSections', coalesce(p.allowed_sections, '{}'),
    'plan', jsonb_build_object(
      'canRequest', coalesce(s.can_request, false),
      'canApprove', coalesce(s.can_approve, false),
      'canStaffAll', coalesce(s.can_staff_all, false),
      'specialties', coalesce(s.specialties, '{}')
    )
  ) INTO result
  FROM public.profiles p LEFT JOIN public.plan_staffing_permissions s ON s.user_id = p.id
  WHERE p.id = p_user_id;
  IF result IS NULL THEN RAISE EXCEPTION 'الحساب المطلوب غير موجود'; END IF;
  RETURN result;
END;
$$;

CREATE FUNCTION public.keep_last_account_admin() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF OLD.role = 'admin' THEN
    IF TG_OP = 'UPDATE' AND NEW.role = OLD.role AND NEW.user_id = OLD.user_id THEN RETURN NEW; END IF;
    IF OLD.user_id = auth.uid() THEN
      RAISE EXCEPTION 'لا يمكن إزالة دور مدير النظام من حسابك الحالي' USING ERRCODE = '42501';
    END IF;
    PERFORM pg_advisory_xact_lock(7011893456780123);
    IF NOT EXISTS (
      SELECT 1 FROM public.user_roles r WHERE r.role = 'admin' AND r.id <> OLD.id
    ) THEN
      RAISE EXCEPTION 'لا يمكن إزالة صلاحية المدير الوحيد في النظام' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' THEN RETURN NEW; END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER keep_last_account_admin BEFORE DELETE OR UPDATE OF role, user_id ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.keep_last_account_admin();

-- Keep the account's page restrictions managed by administrators, including direct API writes.
CREATE FUNCTION public.protect_account_page_scope() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND public.is_admin(auth.uid()) IS NOT TRUE THEN
    IF TG_OP = 'INSERT' AND NEW.allowed_sections IS NOT NULL
      OR TG_OP = 'UPDATE' AND NEW.allowed_sections IS DISTINCT FROM OLD.allowed_sections THEN
      RAISE EXCEPTION 'تعديل نطاق الصفحات متاح لمدير النظام فقط' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER protect_account_page_scope BEFORE INSERT OR UPDATE OF allowed_sections ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.protect_account_page_scope();
REVOKE ALL ON FUNCTION public.protect_account_page_scope() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.save_account_access(
  p_user_id uuid, p_full_name text, p_roles public.app_role[], p_departments uuid[],
  p_sections text[], p_can_request boolean, p_can_approve boolean, p_can_staff_all boolean,
  p_specialties text[], p_expected jsonb DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE current_access jsonb;
BEGIN
  IF public.is_admin(auth.uid()) IS NOT TRUE THEN
    RAISE EXCEPTION 'هذه العملية متاحة لمدير النظام فقط' USING ERRCODE = '42501';
  END IF;

  PERFORM 1 FROM auth.users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الحساب المطلوب غير موجود'; END IF;
  current_access := public.read_account_access(p_user_id);
  IF p_expected IS NOT NULL AND current_access IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'تغيرت بيانات الحساب أثناء التعديل. أعد فتحه للاطلاع على أحدث إعدادات.' USING ERRCODE = '40001';
  END IF;
  IF p_full_name IS NULL OR char_length(btrim(p_full_name)) NOT BETWEEN 2 AND 160
    OR p_roles IS NULL OR cardinality(p_roles) > 13 OR array_position(p_roles, NULL) IS NOT NULL
    OR p_departments IS NULL OR cardinality(p_departments) > 100 OR array_position(p_departments, NULL) IS NOT NULL
    OR p_sections IS NULL OR cardinality(p_sections) > 100
    OR EXISTS (SELECT FROM unnest(p_sections) AS s(path) WHERE path IS NULL OR path !~ '^/[a-z0-9_-]+(/[a-z0-9_-]+)*$' OR length(path) > 60)
    OR p_can_request IS NULL OR p_can_approve IS NULL OR p_can_staff_all IS NULL
    OR p_specialties IS NULL OR cardinality(p_specialties) > 100
    OR EXISTS (SELECT FROM unnest(p_specialties) AS s(name) WHERE name IS NULL OR length(btrim(name)) NOT BETWEEN 1 AND 120)
  THEN RAISE EXCEPTION 'تحقق من الاسم والأدوار والأقسام والصفحات والتخصصات المدخلة' USING ERRCODE = '22023';
  END IF;
  IF p_user_id = auth.uid() AND NOT ('admin' = ANY(p_roles)) THEN
    RAISE EXCEPTION 'لا يمكن إزالة دور مدير النظام من حسابك الحالي' USING ERRCODE = '42501';
  END IF;
  IF 'department_manager' = ANY(p_roles) AND (SELECT count(DISTINCT id) FROM unnest(p_departments) AS d(id)) <> 1 THEN
    RAISE EXCEPTION 'حدد قسماً واحداً لحساب مدير القسم' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.user_roles (user_id, role)
    SELECT DISTINCT p_user_id, r.role FROM unnest(p_roles) AS r(role) ON CONFLICT (user_id, role) DO NOTHING;
  DELETE FROM public.user_roles WHERE user_id = p_user_id AND NOT (role = ANY(p_roles));

  INSERT INTO public.user_departments (user_id, department_id)
    SELECT DISTINCT p_user_id, d.id FROM unnest(p_departments) AS d(id) ON CONFLICT (user_id, department_id) DO NOTHING;
  DELETE FROM public.user_departments WHERE user_id = p_user_id AND NOT (department_id = ANY(p_departments));

  UPDATE public.profiles SET full_name = btrim(p_full_name),
    allowed_sections = CASE WHEN cardinality(p_sections) > 0 THEN p_sections END
    WHERE id = p_user_id;

  IF p_can_request OR p_can_approve OR p_can_staff_all OR cardinality(p_specialties) > 0
    OR EXISTS (SELECT FROM public.plan_staffing_permissions WHERE user_id = p_user_id) THEN
    INSERT INTO public.plan_staffing_permissions (user_id, can_request, can_approve, can_staff_all, specialties)
    VALUES (p_user_id, p_can_request, p_can_approve, p_can_staff_all,
      ARRAY(SELECT DISTINCT btrim(s.name) FROM unnest(p_specialties) AS s(name) ORDER BY btrim(s.name)))
    ON CONFLICT (user_id) DO UPDATE SET can_request = EXCLUDED.can_request, can_approve = EXCLUDED.can_approve,
      can_staff_all = EXCLUDED.can_staff_all, specialties = EXCLUDED.specialties, updated_at = now();
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.keep_last_account_admin() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.read_account_directory(text, text, integer),
  public.read_account_access(uuid),
  public.save_account_access(uuid, text, public.app_role[], uuid[], text[], boolean, boolean, boolean, text[], jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.read_account_directory(text, text, integer),
  public.read_account_access(uuid),
  public.save_account_access(uuid, text, public.app_role[], uuid[], text[], boolean, boolean, boolean, text[], jsonb)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
