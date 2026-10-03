
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.employee_tasks;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
