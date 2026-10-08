-- Previously the broad staff policy allowed supervisors and data-entry accounts to write
-- deduction amounts that immediately changed payroll. Keep their absence/warning workflow,
-- but reserve monetary deductions and edits to HR and system administrators.
DROP POLICY IF EXISTS "staff manage penalties" ON public.employee_penalties;
DROP POLICY IF EXISTS "authenticated read penalties" ON public.employee_penalties;

CREATE OR REPLACE FUNCTION public.can_access_employee_penalty(_employee_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL AND (
    public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'hr') OR
    public.has_role(auth.uid(), 'data_entry') OR
    (
      _employee_id IS NOT NULL AND
      (public.has_role(auth.uid(), 'supervisor') OR public.has_role(auth.uid(), 'department_manager')) AND
      EXISTS (
        SELECT 1 FROM public.employees AS employee
        WHERE employee.id = _employee_id
          AND public.can_access_department(auth.uid(), employee.department_id)
      )
    )
  );
$$;
GRANT EXECUTE ON FUNCTION public.can_access_employee_penalty(uuid) TO authenticated;

CREATE POLICY "staff read scoped penalties"
  ON public.employee_penalties FOR SELECT TO authenticated
  USING (public.can_access_employee_penalty(employee_id));

CREATE POLICY "hr manage all penalties"
  ON public.employee_penalties FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'hr'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'hr'));

CREATE POLICY "staff insert nonfinancial penalties"
  ON public.employee_penalties FOR INSERT TO authenticated
  WITH CHECK (
    (public.has_role(auth.uid(), 'supervisor') OR public.has_role(auth.uid(), 'data_entry'))
    AND penalty_type IN ('absence', 'warning')
    AND deduction_amount = 0
    AND public.can_access_employee_penalty(employee_id)
  );

CREATE POLICY "staff delete unexecuted nonfinancial penalties"
  ON public.employee_penalties FOR DELETE TO authenticated
  USING (
    (public.has_role(auth.uid(), 'supervisor') OR public.has_role(auth.uid(), 'data_entry'))
    AND penalty_type IN ('absence', 'warning')
    AND deduction_amount = 0
    AND executed_at IS NULL
    AND public.can_access_employee_penalty(employee_id)
  );

CREATE OR REPLACE FUNCTION public.execute_absence_penalty(_penalty_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _user_id uuid := auth.uid();
  _penalty public.employee_penalties%ROWTYPE;
  _notes text;
BEGIN
  IF _user_id IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول أولاً'; END IF;
  SELECT * INTO _penalty
  FROM public.employee_penalties
  WHERE id = _penalty_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'سجل العقوبة غير موجود'; END IF;
  IF _penalty.executed_at IS NOT NULL THEN RAISE EXCEPTION 'تم تنفيذ هذه العقوبة مسبقاً'; END IF;
  IF _penalty.penalty_type <> 'absence' THEN RAISE EXCEPTION 'تنفيذ سجل الحضور متاح لعقوبة الغياب فقط'; END IF;
  IF _penalty.employee_id IS NULL THEN RAISE EXCEPTION 'اربط العقوبة بموظف قبل تنفيذها'; END IF;
  IF NOT public.can_access_employee_penalty(_penalty.employee_id) THEN RAISE EXCEPTION 'لا تملك صلاحية إدارة هذا الموظف'; END IF;

  _notes := 'عقوبة غياب — ' || _penalty.employee_name;

  -- Do not let an absence penalty silently replace an approved attendance, leave, holiday, or rest day.
  IF EXISTS (
    SELECT 1 FROM public.attendance_day_status
    WHERE employee_id = _penalty.employee_id
      AND work_date = _penalty.penalty_date
      AND status <> 'absent'
  ) THEN
    RAISE EXCEPTION 'يوجد اعتماد حضور أو إجازة لهذا التاريخ؛ راجع الحالة قبل تنفيذ الغياب';
  END IF;

  INSERT INTO public.attendance_day_status(employee_id, work_date, status, notes, overtime_hours, updated_by)
  VALUES (_penalty.employee_id, _penalty.penalty_date, 'absent', _notes, 0, _user_id)
  ON CONFLICT (employee_id, work_date) DO UPDATE
    SET status = 'absent', notes = EXCLUDED.notes, overtime_hours = 0, updated_by = _user_id;

  UPDATE public.employee_penalties
  SET executed_at = now(), executed_by = _user_id
  WHERE id = _penalty_id;
END;
$$;

REVOKE ALL ON FUNCTION public.execute_absence_penalty(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.execute_absence_penalty(uuid) TO authenticated;
