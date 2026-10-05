CREATE OR REPLACE FUNCTION public.normalize_ar_name(_s text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT regexp_replace(translate(lower(trim(coalesce(_s,''))), 'أإآىةـ', 'ااايه'), '\s+', ' ', 'g')
$$;

CREATE OR REPLACE FUNCTION public.current_employee_id() RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _email text; _name text; _id uuid; _n int;
BEGIN
  SELECT email, full_name INTO _email, _name FROM profiles WHERE id = auth.uid();
  IF _email IS NOT NULL THEN
    SELECT id INTO _id FROM employees WHERE lower(email) = lower(_email) LIMIT 1;
    IF _id IS NOT NULL THEN RETURN _id; END IF;
  END IF;
  IF coalesce(trim(_name),'') = '' THEN RETURN NULL; END IF;
  SELECT count(*), min(id::text)::uuid INTO _n, _id FROM employees
   WHERE normalize_ar_name(full_name) = normalize_ar_name(_name)
      OR normalize_ar_name(full_name) LIKE normalize_ar_name(_name) || ' %';
  IF _n = 1 THEN RETURN _id; END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.employee_user_id(_employee_id uuid) RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _email text; _name text; _id uuid; _n int;
BEGIN
  SELECT email, full_name INTO _email, _name FROM employees WHERE id = _employee_id;
  IF _email IS NOT NULL THEN
    SELECT id INTO _id FROM profiles WHERE lower(email) = lower(_email) LIMIT 1;
    IF _id IS NOT NULL THEN RETURN _id; END IF;
  END IF;
  SELECT count(*), min(id::text)::uuid INTO _n, _id FROM profiles
   WHERE coalesce(trim(full_name),'') <> '' AND (normalize_ar_name(_name) = normalize_ar_name(full_name)
      OR normalize_ar_name(_name) LIKE normalize_ar_name(full_name) || ' %');
  IF _n = 1 THEN RETURN _id; END IF;
  RETURN NULL;
END $$;

GRANT EXECUTE ON FUNCTION public.current_employee_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.employee_user_id(uuid) TO authenticated;

ALTER TABLE public.employee_tasks ADD COLUMN IF NOT EXISTS template_id uuid REFERENCES public.team_task_templates(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS employee_tasks_template_occurrence_uidx ON public.employee_tasks (template_id, employee_id, task_date) WHERE template_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS employee_tasks_employee_date_idx ON public.employee_tasks (employee_id, task_date);

ALTER TABLE public.employee_tasks DROP CONSTRAINT IF EXISTS employee_tasks_task_type_check;
ALTER TABLE public.employee_tasks ADD CONSTRAINT employee_tasks_task_type_check CHECK (task_type = ANY (ARRAY['one_time','daily','weekly','monthly','recurring','urgent','follow_up','guidance']));

ALTER TABLE public.team_task_templates ADD COLUMN IF NOT EXISTS weekdays integer[];
ALTER TABLE public.team_task_templates ADD COLUMN IF NOT EXISTS month_day integer CHECK (month_day IS NULL OR month_day BETWEEN 1 AND 31);
ALTER TABLE public.team_task_templates ADD COLUMN IF NOT EXISTS due_offset_days integer NOT NULL DEFAULT 0;

CREATE POLICY "assigned employee reads own tasks" ON public.employee_tasks FOR SELECT TO authenticated USING (employee_id IS NOT NULL AND employee_id = public.current_employee_id());
CREATE POLICY "assigned employee updates own tasks" ON public.employee_tasks FOR UPDATE TO authenticated USING (employee_id IS NOT NULL AND employee_id = public.current_employee_id()) WITH CHECK (employee_id = public.current_employee_id());

CREATE OR REPLACE FUNCTION public.generate_recurring_tasks(_from date, _to date) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t record; d date; emp uuid; emps uuid[]; _count int := 0; _rows int; _end date;
BEGIN
  IF auth.uid() IS NULL THEN RETURN 0; END IF;
  IF _to - _from > 62 THEN _to := _from + 62; END IF;
  FOR t IN SELECT * FROM team_task_templates WHERE active AND start_date <= _to AND (end_date IS NULL OR end_date >= _from) LOOP
    emps := CASE WHEN coalesce(array_length(t.assignee_employee_ids,1),0) > 0 THEN t.assignee_employee_ids
      ELSE ARRAY(SELECT id FROM employees WHERE department_id = t.department_id AND status = 'active') END;
    _end := LEAST(_to, coalesce(t.end_date, _to));
    d := GREATEST(_from, t.start_date);
    WHILE d <= _end LOOP
      IF (t.recurrence_rule = 'daily')
         OR (t.recurrence_rule = 'weekdays' AND extract(dow FROM d) <> 5)
         OR (t.recurrence_rule = 'weekly' AND (CASE WHEN coalesce(array_length(t.weekdays,1),0) > 0 THEN extract(dow FROM d)::int = ANY(t.weekdays) ELSE extract(dow FROM d) = extract(dow FROM t.start_date) END))
         OR (t.recurrence_rule = 'monthly' AND extract(day FROM d)::int = LEAST(coalesce(t.month_day, extract(day FROM t.start_date)::int), extract(day FROM (date_trunc('month', d) + interval '1 month - 1 day'))::int))
         OR (t.recurrence_rule = 'interval' AND coalesce(t.interval_days,0) > 0 AND (d - t.start_date) % t.interval_days = 0) THEN
        FOREACH emp IN ARRAY emps LOOP
          INSERT INTO employee_tasks (employee_id, department_id, task_date, start_date, due_date, title, description, status, duration_minutes, created_by, task_type, priority, template_id)
          VALUES (emp, t.department_id, d, d, d + t.due_offset_days, t.title, t.description, 'not_started', 0, t.created_by,
            CASE t.recurrence_rule WHEN 'weekly' THEN 'weekly' WHEN 'monthly' THEN 'monthly' ELSE 'daily' END, t.priority, t.id)
          ON CONFLICT (template_id, employee_id, task_date) WHERE template_id IS NOT NULL DO NOTHING;
          GET DIAGNOSTICS _rows = ROW_COUNT; _count := _count + _rows;
        END LOOP;
      END IF;
      d := d + 1;
    END LOOP;
  END LOOP;
  RETURN _count;
END $$;
GRANT EXECUTE ON FUNCTION public.generate_recurring_tasks(date, date) TO authenticated;