-- Create the table before adding it to Realtime. Permission policies and grants
-- are defined in the follow-up migration `20261003190000_employee_guidance_notes.sql`.
CREATE TABLE IF NOT EXISTS public.employee_guidance_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  target_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 2 AND 200),
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 5000),
  guidance_date date NOT NULL DEFAULT CURRENT_DATE,
  author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.employee_tasks;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
