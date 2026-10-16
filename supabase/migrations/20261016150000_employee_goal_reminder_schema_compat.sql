-- Keep goal assignment and proposals compatible with databases that already
-- have employee_goals but predate the reminder settings columns.
ALTER TABLE IF EXISTS public.employee_goals
  ADD COLUMN IF NOT EXISTS reminder_days_before smallint NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS reminders_enabled boolean NOT NULL DEFAULT true;

DO $$
BEGIN
  IF to_regclass('public.employee_goals') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conrelid = to_regclass('public.employee_goals')
         AND conname = 'employee_goals_reminder_days_before_check'
     ) THEN
    ALTER TABLE public.employee_goals
      ADD CONSTRAINT employee_goals_reminder_days_before_check
      CHECK (reminder_days_before BETWEEN 0 AND 30);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
