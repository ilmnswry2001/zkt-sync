-- Recurring work used to be generated up to 31 days ahead, so employees saw
-- several future copies at once. Generate only today's Baghdad occurrence;
-- the existing unique (template, employee, date) key keeps each day separate.
CREATE OR REPLACE FUNCTION public.generate_recurring_tasks(_from date, _to date)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  t record;
  d date;
  emp uuid;
  emps uuid[];
  _count int := 0;
  _rows int;
  _end date;
  _today date := (clock_timestamp() AT TIME ZONE 'Asia/Baghdad')::date;
BEGIN
  IF auth.uid() IS NULL THEN RETURN 0; END IF;

  _from := GREATEST(_from, _today);
  _to := LEAST(_to, _today);
  IF _from > _to THEN RETURN 0; END IF;

  FOR t IN
    SELECT * FROM public.team_task_templates
    WHERE active AND start_date <= _to AND (end_date IS NULL OR end_date >= _from)
  LOOP
    emps := CASE
      WHEN coalesce(array_length(t.assignee_employee_ids, 1), 0) > 0 THEN t.assignee_employee_ids
      ELSE ARRAY(
        SELECT id FROM public.employees
        WHERE department_id = t.department_id AND status = 'active'
      )
    END;
    _end := LEAST(_to, coalesce(t.end_date, _to));
    d := GREATEST(_from, t.start_date);

    WHILE d <= _end LOOP
      IF (t.recurrence_rule = 'daily')
         OR (t.recurrence_rule = 'weekdays' AND extract(dow FROM d) <> 5)
         OR (t.recurrence_rule = 'weekly' AND (
           CASE
             WHEN coalesce(array_length(t.weekdays, 1), 0) > 0 THEN extract(dow FROM d)::int = ANY(t.weekdays)
             ELSE extract(dow FROM d) = extract(dow FROM t.start_date)
           END
         ))
         OR (t.recurrence_rule = 'monthly' AND extract(day FROM d)::int = LEAST(
           coalesce(t.month_day, extract(day FROM t.start_date)::int),
           extract(day FROM (date_trunc('month', d) + interval '1 month - 1 day'))::int
         ))
         OR (t.recurrence_rule = 'interval' AND coalesce(t.interval_days, 0) > 0 AND (d - t.start_date) % t.interval_days = 0) THEN
        FOREACH emp IN ARRAY emps LOOP
          INSERT INTO public.employee_tasks (
            employee_id, department_id, task_date, start_date, due_date, title,
            description, status, duration_minutes, created_by, task_type, priority, template_id
          )
          VALUES (
            emp, t.department_id, d, d, d + t.due_offset_days, t.title,
            t.description, 'not_started', 0, t.created_by,
            CASE t.recurrence_rule WHEN 'weekly' THEN 'weekly' WHEN 'monthly' THEN 'monthly' ELSE 'daily' END,
            t.priority, t.id
          )
          ON CONFLICT (template_id, employee_id, task_date)
            WHERE template_id IS NOT NULL DO NOTHING;
          GET DIAGNOSTICS _rows = ROW_COUNT;
          _count := _count + _rows;
        END LOOP;
      END IF;
      d := d + 1;
    END LOOP;
  END LOOP;
  RETURN _count;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_recurring_tasks(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_recurring_tasks(date, date) TO authenticated;
