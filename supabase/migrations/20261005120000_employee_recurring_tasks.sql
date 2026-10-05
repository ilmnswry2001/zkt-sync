-- Recurring work items are materialized once per assigned employee and date.
CREATE TABLE IF NOT EXISTS public.employee_task_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  target_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  title text NOT NULL CHECK (char_length(trim(title)) BETWEEN 2 AND 200),
  description text,
  frequency text NOT NULL CHECK (frequency IN ('daily', 'weekly')),
  weekday smallint,
  starts_on date NOT NULL DEFAULT (timezone('Asia/Baghdad', now()))::date,
  ends_on date,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((frequency = 'daily' AND weekday IS NULL) OR (frequency = 'weekly' AND weekday BETWEEN 0 AND 6)),
  CHECK (ends_on IS NULL OR ends_on >= starts_on)
);

CREATE INDEX IF NOT EXISTS employee_task_schedules_target_active_idx
  ON public.employee_task_schedules(target_user_id, is_active, starts_on, ends_on);
CREATE UNIQUE INDEX IF NOT EXISTS employee_task_schedules_unique_active_idx
  ON public.employee_task_schedules (
    employee_id,
    target_user_id,
    lower(trim(title)),
    frequency,
    coalesce(weekday, -1)
  ) WHERE is_active;

ALTER TABLE public.employee_tasks
  ADD COLUMN IF NOT EXISTS assigned_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS task_source_schedule_id uuid REFERENCES public.employee_task_schedules(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS employee_tasks_schedule_date_unique_idx
  ON public.employee_tasks(task_source_schedule_id, task_date)
  WHERE task_source_schedule_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS employee_tasks_assigned_date_idx
  ON public.employee_tasks(assigned_user_id, task_date, archived_at);

CREATE OR REPLACE FUNCTION public.can_manage_employee_task_schedule(_department_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL AND (
    public.has_role(auth.uid(), 'admin') OR
    public.has_role(auth.uid(), 'hr') OR
    (
      _department_id IS NOT NULL
      AND (public.has_role(auth.uid(), 'supervisor') OR public.has_role(auth.uid(), 'department_manager'))
      AND public.can_access_department(auth.uid(), _department_id)
    )
  );
$$;
GRANT EXECUTE ON FUNCTION public.can_manage_employee_task_schedule(uuid) TO authenticated;

ALTER TABLE public.employee_task_schedules ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_task_schedules TO authenticated;
GRANT ALL ON public.employee_task_schedules TO service_role;

DROP POLICY IF EXISTS "Employees and managers read recurring tasks" ON public.employee_task_schedules;
CREATE POLICY "Employees and managers read recurring tasks"
  ON public.employee_task_schedules FOR SELECT TO authenticated
  USING (
    target_user_id = auth.uid()
    OR public.can_manage_employee_task_schedule(department_id)
  );

DROP POLICY IF EXISTS "Managers create scoped recurring tasks" ON public.employee_task_schedules;
CREATE POLICY "Managers create scoped recurring tasks"
  ON public.employee_task_schedules FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND public.can_manage_employee_task_schedule(department_id)
    AND EXISTS (
      SELECT 1
      FROM public.employees AS employee
      JOIN public.profiles AS profile
        ON lower(trim(profile.email)) = lower(trim(employee.email))
      WHERE employee.id = employee_task_schedules.employee_id
        AND employee.department_id IS NOT DISTINCT FROM employee_task_schedules.department_id
        AND employee.status = 'active'
        AND profile.id = employee_task_schedules.target_user_id
    )
  );

DROP POLICY IF EXISTS "Managers update scoped recurring tasks" ON public.employee_task_schedules;
CREATE POLICY "Managers update scoped recurring tasks"
  ON public.employee_task_schedules FOR UPDATE TO authenticated
  USING (public.can_manage_employee_task_schedule(department_id))
  WITH CHECK (
    public.can_manage_employee_task_schedule(department_id)
    AND EXISTS (
      SELECT 1
      FROM public.employees AS employee
      JOIN public.profiles AS profile
        ON lower(trim(profile.email)) = lower(trim(employee.email))
      WHERE employee.id = employee_task_schedules.employee_id
        AND employee.department_id IS NOT DISTINCT FROM employee_task_schedules.department_id
        AND employee.status = 'active'
        AND profile.id = employee_task_schedules.target_user_id
    )
  );

DROP POLICY IF EXISTS "Managers delete scoped recurring tasks" ON public.employee_task_schedules;
CREATE POLICY "Managers delete scoped recurring tasks"
  ON public.employee_task_schedules FOR DELETE TO authenticated
  USING (public.can_manage_employee_task_schedule(department_id));

DROP POLICY IF EXISTS "Employees read assigned work center tasks" ON public.employee_tasks;
CREATE POLICY "Employees read assigned work center tasks"
  ON public.employee_tasks FOR SELECT TO authenticated
  USING (assigned_user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.generate_my_scheduled_employee_tasks(_for_date date DEFAULT (timezone('Asia/Baghdad', now()))::date)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _user_id uuid := auth.uid();
  _created integer := 0;
BEGIN
  IF _user_id IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول أولاً'; END IF;
  IF _for_date IS DISTINCT FROM (timezone('Asia/Baghdad', now()))::date THEN
    RAISE EXCEPTION 'يمكن إنشاء مهام اليوم الحالي فقط';
  END IF;

  INSERT INTO public.employee_tasks (
    employee_id, task_date, title, description, status, duration_minutes,
    created_by, department_id, assigned_user_id, task_source_schedule_id
  )
  SELECT
    schedule.employee_id, _for_date, schedule.title, schedule.description,
    'in_progress', 0, _user_id, schedule.department_id, _user_id, schedule.id
  FROM public.employee_task_schedules AS schedule
  JOIN public.employees AS employee ON employee.id = schedule.employee_id
  WHERE schedule.target_user_id = _user_id
    AND schedule.is_active
    AND schedule.starts_on <= _for_date
    AND (schedule.ends_on IS NULL OR schedule.ends_on >= _for_date)
    AND employee.status = 'active'
    AND (
      schedule.frequency = 'daily'
      OR (schedule.frequency = 'weekly' AND schedule.weekday = extract(dow FROM _for_date)::smallint)
    )
  ON CONFLICT (task_source_schedule_id, task_date)
    WHERE task_source_schedule_id IS NOT NULL
    DO NOTHING;

  GET DIAGNOSTICS _created = ROW_COUNT;
  RETURN _created;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_my_work_center_task(_task_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _task public.employee_tasks%ROWTYPE;
  _user_id uuid := auth.uid();
BEGIN
  IF _user_id IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول أولاً'; END IF;
  SELECT * INTO _task FROM public.employee_tasks WHERE id = _task_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'المهمة غير موجودة'; END IF;
  IF _task.created_by <> _user_id AND _task.assigned_user_id IS DISTINCT FROM _user_id THEN
    RAISE EXCEPTION 'لا تملك صلاحية إكمال هذه المهمة';
  END IF;
  UPDATE public.employee_tasks SET status = 'completed' WHERE id = _task_id AND status <> 'completed';
END;
$$;

REVOKE ALL ON FUNCTION public.generate_my_scheduled_employee_tasks(date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_my_work_center_task(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_my_scheduled_employee_tasks(date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_my_work_center_task(uuid) TO authenticated;
