ALTER TABLE public.employee_tasks
  ADD COLUMN IF NOT EXISTS task_type text NOT NULL DEFAULT 'daily',
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS start_date date,
  ADD COLUMN IF NOT EXISTS due_date date,
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS completion_note text,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.employee_tasks DROP CONSTRAINT IF EXISTS employee_tasks_status_check;
ALTER TABLE public.employee_tasks DROP CONSTRAINT IF EXISTS employee_tasks_task_type_check;
ALTER TABLE public.employee_tasks DROP CONSTRAINT IF EXISTS employee_tasks_priority_check;
ALTER TABLE public.employee_tasks
  ADD CONSTRAINT employee_tasks_status_check CHECK (status IN ('not_started', 'in_progress', 'completed', 'overdue', 'cancelled', 'pending_review', 'needs_follow_up')),
  ADD CONSTRAINT employee_tasks_task_type_check CHECK (task_type IN ('daily', 'recurring', 'one_time', 'urgent', 'follow_up', 'guidance')),
  ADD CONSTRAINT employee_tasks_priority_check CHECK (priority IN ('low', 'normal', 'high', 'urgent'));

CREATE INDEX IF NOT EXISTS employee_tasks_due_date_idx ON public.employee_tasks(due_date, status, department_id);
CREATE INDEX IF NOT EXISTS employee_tasks_type_idx ON public.employee_tasks(task_type, task_date, department_id);

CREATE TABLE IF NOT EXISTS public.team_task_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(trim(title)) BETWEEN 2 AND 200),
  description text,
  task_type text NOT NULL DEFAULT 'recurring' CHECK (task_type = 'recurring'),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  recurrence_rule text NOT NULL CHECK (recurrence_rule IN ('daily', 'weekly', 'monthly', 'weekdays', 'interval')),
  interval_days integer CHECK (interval_days IS NULL OR interval_days > 0),
  start_date date NOT NULL DEFAULT CURRENT_DATE,
  end_date date,
  scheduled_time time,
  assignee_employee_ids uuid[] NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date IS NULL OR end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS team_task_templates_department_idx ON public.team_task_templates(department_id, active, start_date);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.team_task_templates TO authenticated;
GRANT ALL ON public.team_task_templates TO service_role;
ALTER TABLE public.team_task_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "team managers read task templates" ON public.team_task_templates;
CREATE POLICY "team managers read task templates" ON public.team_task_templates FOR SELECT TO authenticated USING (
  public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'hr') OR public.can_access_department(auth.uid(), department_id)
);
DROP POLICY IF EXISTS "team managers create task templates" ON public.team_task_templates;
CREATE POLICY "team managers create task templates" ON public.team_task_templates FOR INSERT TO authenticated WITH CHECK (
  created_by = auth.uid() AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'hr') OR public.can_access_department(auth.uid(), department_id))
);
DROP POLICY IF EXISTS "team managers update task templates" ON public.team_task_templates;
CREATE POLICY "team managers update task templates" ON public.team_task_templates FOR UPDATE TO authenticated USING (
  public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'hr') OR public.can_access_department(auth.uid(), department_id)
) WITH CHECK (
  public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'hr') OR public.can_access_department(auth.uid(), department_id)
);
DROP POLICY IF EXISTS "team managers delete task templates" ON public.team_task_templates;
CREATE POLICY "team managers delete task templates" ON public.team_task_templates FOR DELETE TO authenticated USING (
  public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'hr') OR public.can_access_department(auth.uid(), department_id)
);

CREATE TABLE IF NOT EXISTS public.team_guidance_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guidance_id uuid NOT NULL REFERENCES public.team_guidance_notes(id) ON DELETE CASCADE,
  employee_id uuid REFERENCES public.employees(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (employee_id IS NOT NULL OR user_id IS NOT NULL),
  UNIQUE (guidance_id, employee_id),
  UNIQUE (guidance_id, user_id)
);
CREATE INDEX IF NOT EXISTS team_guidance_recipients_user_idx ON public.team_guidance_recipients(user_id, read_at);
CREATE INDEX IF NOT EXISTS team_guidance_recipients_employee_idx ON public.team_guidance_recipients(employee_id, read_at);
GRANT SELECT, INSERT, UPDATE ON public.team_guidance_recipients TO authenticated;
GRANT ALL ON public.team_guidance_recipients TO service_role;
ALTER TABLE public.team_guidance_recipients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "guidance recipients read own or managers" ON public.team_guidance_recipients;
CREATE POLICY "guidance recipients read own or managers" ON public.team_guidance_recipients FOR SELECT TO authenticated USING (
  user_id = auth.uid()
  OR public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'hr')
  OR EXISTS (SELECT 1 FROM public.team_guidance_notes n WHERE n.id = guidance_id AND public.can_access_department(auth.uid(), n.department_id))
);
DROP POLICY IF EXISTS "guidance recipients create managers" ON public.team_guidance_recipients;
CREATE POLICY "guidance recipients create managers" ON public.team_guidance_recipients FOR INSERT TO authenticated WITH CHECK (
  public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'hr')
  OR EXISTS (SELECT 1 FROM public.team_guidance_notes n WHERE n.id = guidance_id AND public.can_access_department(auth.uid(), n.department_id))
);
DROP POLICY IF EXISTS "guidance recipients mark own read" ON public.team_guidance_recipients;
CREATE POLICY "guidance recipients mark own read" ON public.team_guidance_recipients FOR UPDATE TO authenticated USING (
  user_id = auth.uid() OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'hr')
) WITH CHECK (
  user_id = auth.uid() OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'hr')
);

DROP POLICY IF EXISTS "employees read own tasks" ON public.employee_tasks;
CREATE POLICY "employees read own tasks" ON public.employee_tasks FOR SELECT TO authenticated USING (
  created_by = auth.uid()
  OR public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'hr')
  OR public.has_role(auth.uid(), 'supervisor')
  OR (department_id IS NOT NULL AND public.can_access_department(auth.uid(), department_id))
  OR employee_id IN (SELECT e.id FROM public.employees e JOIN public.profiles p ON lower(p.email) = lower(e.email) WHERE p.id = auth.uid())
);
DROP POLICY IF EXISTS "employees update own tasks" ON public.employee_tasks;
CREATE POLICY "employees update own tasks" ON public.employee_tasks FOR UPDATE TO authenticated USING (
  created_by = auth.uid()
  OR public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'hr')
  OR public.has_role(auth.uid(), 'supervisor')
  OR (department_id IS NOT NULL AND public.can_access_department(auth.uid(), department_id))
  OR employee_id IN (SELECT e.id FROM public.employees e JOIN public.profiles p ON lower(p.email) = lower(e.email) WHERE p.id = auth.uid())
) WITH CHECK (
  created_by = auth.uid()
  OR public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'hr')
  OR public.has_role(auth.uid(), 'supervisor')
  OR (department_id IS NOT NULL AND public.can_access_department(auth.uid(), department_id))
  OR employee_id IN (SELECT e.id FROM public.employees e JOIN public.profiles p ON lower(p.email) = lower(e.email) WHERE p.id = auth.uid())
);

DROP TRIGGER IF EXISTS trg_team_task_templates_updated_at ON public.team_task_templates;
CREATE TRIGGER trg_team_task_templates_updated_at BEFORE UPDATE ON public.team_task_templates FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();