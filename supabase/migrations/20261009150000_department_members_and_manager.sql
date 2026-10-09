ALTER TABLE public.departments
  ADD COLUMN IF NOT EXISTS manager_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS departments_manager_user_idx
  ON public.departments(manager_user_id);

CREATE OR REPLACE FUNCTION public.set_department_manager(
  _department_id uuid,
  _employee_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_old_user_id uuid;
  v_email text;
  v_profile_count integer;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'يجب أن تكون مدير نظام لتعيين مسؤول القسم';
  END IF;

  SELECT manager_user_id INTO v_old_user_id
  FROM public.departments
  WHERE id = _department_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'القسم غير موجود'; END IF;

  IF _employee_id IS NOT NULL THEN
    SELECT email INTO v_email
    FROM public.employees
    WHERE id = _employee_id AND department_id = _department_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'يجب أن يكون مسؤول القسم من موظفي القسم'; END IF;
    IF v_email IS NULL OR length(trim(v_email)) = 0 THEN
      RAISE EXCEPTION 'اربط الموظف بحساب دخول قبل تعيينه مسؤولاً للقسم';
    END IF;

    SELECT count(*) INTO v_profile_count
    FROM public.profiles
    WHERE lower(trim(email)) = lower(trim(v_email));
    IF v_profile_count = 0 THEN
      RAISE EXCEPTION 'لا يوجد حساب دخول مرتبط ببريد الموظف';
    END IF;
    IF v_profile_count > 1 THEN
      RAISE EXCEPTION 'يوجد أكثر من حساب مرتبط ببريد الموظف؛ عالج تكرار الحسابات أولاً';
    END IF;
    SELECT id INTO v_user_id FROM public.profiles
    WHERE lower(trim(email)) = lower(trim(v_email));
  END IF;

  DELETE FROM public.department_managers WHERE department_id = _department_id;
  UPDATE public.departments SET manager_user_id = v_user_id WHERE id = _department_id;

  IF v_user_id IS NOT NULL THEN
    INSERT INTO public.department_managers (department_id, user_id)
    VALUES (_department_id, v_user_id)
    ON CONFLICT (department_id, user_id) DO NOTHING;
    INSERT INTO public.user_departments (user_id, department_id)
    VALUES (v_user_id, _department_id)
    ON CONFLICT (user_id, department_id) DO NOTHING;
    INSERT INTO public.user_roles (user_id, role)
    VALUES (v_user_id, 'department_manager'::public.app_role)
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;

  IF v_old_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.department_managers WHERE user_id = v_old_user_id
  ) THEN
    DELETE FROM public.user_roles
    WHERE user_id = v_old_user_id AND role = 'department_manager'::public.app_role;
  END IF;

  RETURN v_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_department_manager(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_department_manager(uuid, uuid) TO authenticated, service_role;
