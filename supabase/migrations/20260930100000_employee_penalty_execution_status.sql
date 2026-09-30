-- Track whether a penalty was executed, separately from its recorded penalty type.
ALTER TABLE public.employee_penalties
  ADD COLUMN IF NOT EXISTS executed_at timestamptz,
  ADD COLUMN IF NOT EXISTS executed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS employee_penalties_execution_idx
  ON public.employee_penalties(executed_at, penalty_date DESC);

-- Recover historical absence executions where the attendance override proves execution.
UPDATE public.employee_penalties AS penalties
SET executed_at = attendance.updated_at,
    executed_by = attendance.updated_by
FROM public.attendance_day_status AS attendance
WHERE penalties.executed_at IS NULL
  AND penalties.penalty_type = 'absence'
  AND penalties.employee_id = attendance.employee_id
  AND penalties.penalty_date = attendance.work_date
  AND attendance.status = 'absent'
  AND attendance.notes = 'عقوبة غياب — ' || penalties.employee_name;
