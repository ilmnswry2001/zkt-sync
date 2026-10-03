-- Deliver new manager guidance to employee sessions immediately.
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.employee_guidance_notes;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
