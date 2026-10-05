-- Operational task data extends the existing employee_tasks/template records.
-- Existing tasks remain readable; the new proof/review requirements are opt-in
-- for legacy rows and enabled for newly assigned work by the application.
ALTER TABLE public.employee_tasks
  ADD COLUMN IF NOT EXISTS assignment_source text NOT NULL DEFAULT 'assigned',
  ADD COLUMN IF NOT EXISTS closing_requirement text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS require_review boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS proof_note text,
  ADD COLUMN IF NOT EXISTS proof_storage_path text,
  ADD COLUMN IF NOT EXISTS proof_link text,
  ADD COLUMN IF NOT EXISTS proof_result text,
  ADD COLUMN IF NOT EXISTS submitted_for_review_at timestamptz,
  ADD COLUMN IF NOT EXISTS delay_reason text,
  ADD COLUMN IF NOT EXISTS delay_reason_note text,
  ADD COLUMN IF NOT EXISTS guidance_id uuid REFERENCES public.employee_guidance_notes(id) ON DELETE SET NULL;

ALTER TABLE public.employee_tasks DROP CONSTRAINT IF EXISTS employee_tasks_assignment_source_check;
ALTER TABLE public.employee_tasks ADD CONSTRAINT employee_tasks_assignment_source_check
  CHECK (assignment_source IN ('assigned', 'personal'));
ALTER TABLE public.employee_tasks DROP CONSTRAINT IF EXISTS employee_tasks_closing_requirement_check;
ALTER TABLE public.employee_tasks ADD CONSTRAINT employee_tasks_closing_requirement_check
  CHECK (closing_requirement IN ('none', 'note', 'file', 'attachment', 'link', 'result'));
ALTER TABLE public.employee_tasks DROP CONSTRAINT IF EXISTS employee_tasks_delay_reason_check;
ALTER TABLE public.employee_tasks ADD CONSTRAINT employee_tasks_delay_reason_check
  CHECK (delay_reason IS NULL OR delay_reason IN ('waiting_data', 'waiting_approval', 'resource_shortage', 'external_blocker', 'other_priority', 'other'));
CREATE INDEX IF NOT EXISTS employee_tasks_guidance_id_idx ON public.employee_tasks(guidance_id) WHERE guidance_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS employee_tasks_assignment_source_idx ON public.employee_tasks(assignment_source, employee_id, task_date);
DROP POLICY IF EXISTS "employees create personal work tasks" ON public.employee_tasks;
CREATE POLICY "employees create personal work tasks" ON public.employee_tasks
  FOR INSERT TO authenticated WITH CHECK (
    created_by = auth.uid()
    AND assignment_source = 'personal'
    AND employee_id = public.current_employee_id()
    AND status = 'not_started'
    AND template_id IS NULL
  );
-- Keep legacy self-owned rows in the personal-task view when their owner can be matched.
UPDATE public.employee_tasks task SET assignment_source = 'personal'
WHERE task.assignment_source = 'assigned' AND task.employee_id IS NOT NULL
  AND public.employee_user_id(task.employee_id) = task.created_by;

ALTER TABLE public.team_task_templates
  ADD COLUMN IF NOT EXISTS checklist_items text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS closing_requirement text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS require_review boolean NOT NULL DEFAULT true;
ALTER TABLE public.team_task_templates DROP CONSTRAINT IF EXISTS team_task_templates_closing_requirement_check;
ALTER TABLE public.team_task_templates ADD CONSTRAINT team_task_templates_closing_requirement_check
  CHECK (closing_requirement IN ('none', 'note', 'file', 'attachment', 'link', 'result'));

CREATE OR REPLACE FUNCTION public.populate_work_task_from_template()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.template_id IS NOT NULL THEN
    SELECT template.closing_requirement, template.require_review
      INTO NEW.closing_requirement, NEW.require_review
    FROM public.team_task_templates template
    WHERE template.id = NEW.template_id;
    IF FOUND THEN NEW.assignment_source := 'assigned'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_populate_work_task_from_template ON public.employee_tasks;
CREATE TRIGGER trg_populate_work_task_from_template BEFORE INSERT ON public.employee_tasks
  FOR EACH ROW EXECUTE FUNCTION public.populate_work_task_from_template();

CREATE TABLE IF NOT EXISTS public.task_checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.employee_tasks(id) ON DELETE CASCADE,
  label text NOT NULL CHECK (char_length(trim(label)) BETWEEN 1 AND 240),
  is_completed boolean NOT NULL DEFAULT false,
  completed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  completed_at timestamptz,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS task_checklist_items_task_order_idx ON public.task_checklist_items(task_id, sort_order, created_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_checklist_items TO authenticated;
GRANT ALL ON public.task_checklist_items TO service_role;
ALTER TABLE public.task_checklist_items ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.employee_task_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.employee_tasks(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_name text,
  event_type text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS employee_task_events_task_time_idx ON public.employee_task_events(task_id, created_at DESC);
GRANT SELECT ON public.employee_task_events TO authenticated;
GRANT ALL ON public.employee_task_events TO service_role;
ALTER TABLE public.employee_task_events ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.can_access_work_task(_task_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.employee_tasks task
    WHERE task.id = _task_id AND (
      task.created_by = auth.uid()
      OR public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'hr')
      OR public.has_role(auth.uid(), 'supervisor')
      OR (task.department_id IS NOT NULL AND public.can_access_department(auth.uid(), task.department_id))
      OR task.employee_id = public.current_employee_id()
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_work_task(_task_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.employee_tasks task
    WHERE task.id = _task_id AND (
      public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'hr')
      OR public.has_role(auth.uid(), 'supervisor')
      OR (task.department_id IS NOT NULL AND public.can_access_department(auth.uid(), task.department_id))
      OR (task.created_by = auth.uid() AND task.assignment_source = 'personal')
    )
  );
$$;
GRANT EXECUTE ON FUNCTION public.can_access_work_task(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_work_task(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.can_access_work_task(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_manage_work_task(uuid) FROM PUBLIC;

DROP POLICY IF EXISTS "task checklist readable in task scope" ON public.task_checklist_items;
CREATE POLICY "task checklist readable in task scope" ON public.task_checklist_items
  FOR SELECT TO authenticated USING (public.can_access_work_task(task_id));
DROP POLICY IF EXISTS "task checklist managed in task scope" ON public.task_checklist_items;
CREATE POLICY "task checklist managed in task scope" ON public.task_checklist_items
  FOR INSERT TO authenticated WITH CHECK (public.can_manage_work_task(task_id) AND created_by = auth.uid());
DROP POLICY IF EXISTS "task checklist update in task scope" ON public.task_checklist_items;
CREATE POLICY "task checklist update in task scope" ON public.task_checklist_items
  FOR UPDATE TO authenticated USING (public.can_access_work_task(task_id)) WITH CHECK (public.can_access_work_task(task_id));
DROP POLICY IF EXISTS "task checklist delete by manager" ON public.task_checklist_items;
CREATE POLICY "task checklist delete by manager" ON public.task_checklist_items
  FOR DELETE TO authenticated USING (public.can_manage_work_task(task_id));

CREATE OR REPLACE FUNCTION public.guard_task_checklist_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF public.can_manage_work_task(OLD.task_id) THEN RETURN NEW; END IF;
  IF NOT public.can_access_work_task(OLD.task_id)
    OR NEW.task_id IS DISTINCT FROM OLD.task_id
    OR NEW.label IS DISTINCT FROM OLD.label
    OR NEW.sort_order IS DISTINCT FROM OLD.sort_order
    OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'لا تملك صلاحية تعديل عناصر قائمة التحقق';
  END IF;
  IF NEW.is_completed IS DISTINCT FROM OLD.is_completed THEN
    NEW.completed_by := CASE WHEN NEW.is_completed THEN auth.uid() ELSE NULL END;
    NEW.completed_at := CASE WHEN NEW.is_completed THEN now() ELSE NULL END;
  ELSIF NEW.completed_by IS DISTINCT FROM OLD.completed_by OR NEW.completed_at IS DISTINCT FROM OLD.completed_at THEN
    RAISE EXCEPTION 'لا يمكن تغيير بيانات إنجاز عنصر التحقق مباشرة';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_task_checklist_update ON public.task_checklist_items;
CREATE TRIGGER trg_guard_task_checklist_update BEFORE UPDATE ON public.task_checklist_items
  FOR EACH ROW EXECUTE FUNCTION public.guard_task_checklist_update();

DROP POLICY IF EXISTS "task events read in task scope" ON public.employee_task_events;
CREATE POLICY "task events read in task scope" ON public.employee_task_events
  FOR SELECT TO authenticated USING (public.can_access_work_task(task_id));

CREATE OR REPLACE FUNCTION public.copy_template_checklist_to_task()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.template_id IS NOT NULL THEN
    INSERT INTO public.task_checklist_items(task_id, label, sort_order, created_by)
    SELECT NEW.id, trim(item), ordinal::integer - 1, NEW.created_by
    FROM public.team_task_templates template,
         unnest(template.checklist_items) WITH ORDINALITY AS checklist(item, ordinal)
    WHERE template.id = NEW.template_id AND char_length(trim(item)) BETWEEN 1 AND 240;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_copy_template_checklist_to_task ON public.employee_tasks;
CREATE TRIGGER trg_copy_template_checklist_to_task AFTER INSERT ON public.employee_tasks
  FOR EACH ROW EXECUTE FUNCTION public.copy_template_checklist_to_task();

CREATE OR REPLACE FUNCTION public.guard_employee_task_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _manager boolean;
  _assigned boolean;
BEGIN
  _manager := public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'hr')
    OR public.has_role(auth.uid(), 'supervisor')
    OR (OLD.department_id IS NOT NULL AND public.can_access_department(auth.uid(), OLD.department_id));
  _assigned := OLD.employee_id IS NOT NULL AND OLD.employee_id = public.current_employee_id();
  _manager := _manager AND NOT (_assigned AND OLD.status <> 'pending_review');

  IF _manager THEN
    IF OLD.status = 'pending_review' AND NEW.status = 'completed' THEN
      IF _assigned THEN RAISE EXCEPTION 'لا يمكن اعتماد المهمة من الموظف المسندة إليه'; END IF;
      NEW.reviewed_at := coalesce(NEW.reviewed_at, now());
      NEW.reviewed_by := coalesce(NEW.reviewed_by, auth.uid());
    ELSIF OLD.status = 'pending_review' AND NEW.status = 'needs_follow_up' THEN
      IF _assigned THEN RAISE EXCEPTION 'لا يمكن إعادة المهمة من الموظف المسندة إليه'; END IF;
      IF coalesce(trim(NEW.manager_note), '') = '' THEN
        RAISE EXCEPTION 'اكتب سبب إعادة المهمة للموظف';
      END IF;
      NEW.reviewed_at := coalesce(NEW.reviewed_at, now());
      NEW.reviewed_by := coalesce(NEW.reviewed_by, auth.uid());
    ELSIF NEW.status = 'completed' AND OLD.status <> 'completed' AND NEW.require_review AND OLD.status <> 'pending_review' THEN
      RAISE EXCEPTION 'اعتمد المهمة بعد إرسالها للمراجعة';
    END IF;
  ELSIF _assigned THEN
    IF NEW.title IS DISTINCT FROM OLD.title
      OR NEW.description IS DISTINCT FROM OLD.description
      OR NEW.department_id IS DISTINCT FROM OLD.department_id
      OR NEW.employee_id IS DISTINCT FROM OLD.employee_id
      OR NEW.priority IS DISTINCT FROM OLD.priority
      OR NEW.due_date IS DISTINCT FROM OLD.due_date
      OR NEW.assignment_source IS DISTINCT FROM OLD.assignment_source
      OR NEW.closing_requirement IS DISTINCT FROM OLD.closing_requirement
      OR NEW.require_review IS DISTINCT FROM OLD.require_review
      OR NEW.guidance_id IS DISTINCT FROM OLD.guidance_id
      OR NEW.created_by IS DISTINCT FROM OLD.created_by
      OR NEW.task_date IS DISTINCT FROM OLD.task_date
      OR NEW.start_date IS DISTINCT FROM OLD.start_date
      OR NEW.manager_note IS DISTINCT FROM OLD.manager_note
      OR NEW.duration_minutes IS DISTINCT FROM OLD.duration_minutes
      OR NEW.template_id IS DISTINCT FROM OLD.template_id
      OR NEW.archived_at IS DISTINCT FROM OLD.archived_at
      OR NEW.started_at IS DISTINCT FROM OLD.started_at
      OR NEW.completed_at IS DISTINCT FROM OLD.completed_at
      OR NEW.submitted_for_review_at IS DISTINCT FROM OLD.submitted_for_review_at
      OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at
      OR NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by THEN
      RAISE EXCEPTION 'لا تملك صلاحية تعديل تفاصيل المهمة';
    END IF;
    IF OLD.status = 'pending_review' AND NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'المهمة بانتظار اعتماد المدير';
    END IF;
    IF NEW.status = 'completed' AND OLD.status <> 'completed' THEN
      NEW.completed_at := coalesce(NEW.completed_at, now());
      IF NEW.require_review THEN
        NEW.status := 'pending_review';
        NEW.submitted_for_review_at := now();
        NEW.completed_at := NULL;
      END IF;
    ELSIF NEW.status = 'in_progress' AND OLD.status = 'needs_follow_up' THEN
      NEW.completed_at := NULL;
      NEW.submitted_for_review_at := NULL;
      NEW.reviewed_at := NULL;
      NEW.reviewed_by := NULL;
    END IF;
    IF NEW.status = 'in_progress' AND NEW.started_at IS NULL THEN NEW.started_at := now(); END IF;
  ELSIF OLD.created_by = auth.uid() AND OLD.assignment_source = 'personal' THEN
    IF NEW.id IS DISTINCT FROM OLD.id
      OR NEW.created_by IS DISTINCT FROM OLD.created_by
      OR NEW.assignment_source IS DISTINCT FROM OLD.assignment_source
      OR NEW.employee_id IS DISTINCT FROM OLD.employee_id
      OR NEW.department_id IS DISTINCT FROM OLD.department_id
      OR NEW.template_id IS DISTINCT FROM OLD.template_id
      OR NEW.guidance_id IS DISTINCT FROM OLD.guidance_id
      OR NEW.require_review IS DISTINCT FROM OLD.require_review
      OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at
      OR NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by
      OR NEW.submitted_for_review_at IS DISTINCT FROM OLD.submitted_for_review_at
      OR NEW.archived_at IS DISTINCT FROM OLD.archived_at THEN
      RAISE EXCEPTION 'لا يمكن تغيير إسناد المهمة الشخصية أو بيانات مراجعتها';
    END IF;
  ELSE
    RAISE EXCEPTION 'لا تملك صلاحية تعديل هذه المهمة';
  END IF;

  IF NEW.status IN ('completed', 'pending_review') THEN
    IF EXISTS (
      SELECT 1 FROM public.task_checklist_items item
      WHERE item.task_id = NEW.id AND NOT item.is_completed
    ) THEN RAISE EXCEPTION 'أكمل قائمة التحقق قبل إرسال المهمة'; END IF;
    IF NEW.closing_requirement = 'note' AND coalesce(trim(NEW.proof_note), '') = '' THEN
      RAISE EXCEPTION 'أضف ملاحظة الإثبات المطلوبة قبل الإغلاق';
    ELSIF NEW.closing_requirement IN ('file', 'attachment') AND coalesce(trim(NEW.proof_storage_path), '') = '' THEN
      RAISE EXCEPTION 'أرفق الملف المطلوب قبل الإغلاق';
    ELSIF NEW.closing_requirement = 'link' AND coalesce(trim(NEW.proof_link), '') !~ '^https?://' THEN
      RAISE EXCEPTION 'أضف رابطاً صحيحاً قبل الإغلاق';
    ELSIF NEW.closing_requirement = 'result' AND coalesce(trim(NEW.proof_result), '') = '' THEN
      RAISE EXCEPTION 'أدخل نتيجة العمل قبل الإغلاق';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_employee_task_update ON public.employee_tasks;
CREATE TRIGGER trg_guard_employee_task_update BEFORE UPDATE ON public.employee_tasks
  FOR EACH ROW EXECUTE FUNCTION public.guard_employee_task_update();

CREATE OR REPLACE FUNCTION public.audit_employee_task_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _actor uuid;
  _actor_name text;
  _event text;
  _details jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    _actor := CASE WHEN NEW.template_id IS NULL THEN NEW.created_by ELSE NULL END;
    _event := CASE WHEN NEW.template_id IS NULL THEN 'created' ELSE 'recurrence_generated' END;
    _details := jsonb_build_object('title', NEW.title, 'employee_id', NEW.employee_id, 'task_date', NEW.task_date, 'template_id', NEW.template_id);
    SELECT full_name INTO _actor_name FROM public.profiles WHERE id = _actor;
    IF NEW.template_id IS NOT NULL THEN _actor_name := 'النظام'; END IF;
    INSERT INTO public.employee_task_events(task_id, actor_id, actor_name, event_type, details)
    VALUES (NEW.id, _actor, _actor_name, _event, _details);
    RETURN NEW;
  END IF;
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    _event := 'status_changed';
    _details := jsonb_build_object('from', OLD.status, 'to', NEW.status, 'manager_note', NEW.manager_note);
  ELSIF OLD.employee_id IS DISTINCT FROM NEW.employee_id THEN
    _event := 'assignment_changed';
    _details := jsonb_build_object('from', OLD.employee_id, 'to', NEW.employee_id);
  ELSE
    _event := 'updated';
    _details := jsonb_build_object(
      'changed', jsonb_strip_nulls(jsonb_build_object(
        'title', CASE WHEN OLD.title IS DISTINCT FROM NEW.title THEN jsonb_build_array(OLD.title, NEW.title) END,
        'description', CASE WHEN OLD.description IS DISTINCT FROM NEW.description THEN jsonb_build_array(OLD.description, NEW.description) END,
        'priority', CASE WHEN OLD.priority IS DISTINCT FROM NEW.priority THEN jsonb_build_array(OLD.priority, NEW.priority) END,
        'due_date', CASE WHEN OLD.due_date IS DISTINCT FROM NEW.due_date THEN jsonb_build_array(OLD.due_date, NEW.due_date) END,
        'completion_note', CASE WHEN OLD.completion_note IS DISTINCT FROM NEW.completion_note THEN jsonb_build_array(OLD.completion_note, NEW.completion_note) END,
        'proof_note', CASE WHEN OLD.proof_note IS DISTINCT FROM NEW.proof_note THEN jsonb_build_array(OLD.proof_note, NEW.proof_note) END,
        'proof_storage_path', CASE WHEN OLD.proof_storage_path IS DISTINCT FROM NEW.proof_storage_path THEN jsonb_build_array(OLD.proof_storage_path, NEW.proof_storage_path) END,
        'proof_link', CASE WHEN OLD.proof_link IS DISTINCT FROM NEW.proof_link THEN jsonb_build_array(OLD.proof_link, NEW.proof_link) END,
        'proof_result', CASE WHEN OLD.proof_result IS DISTINCT FROM NEW.proof_result THEN jsonb_build_array(OLD.proof_result, NEW.proof_result) END,
        'delay_reason', CASE WHEN OLD.delay_reason IS DISTINCT FROM NEW.delay_reason THEN jsonb_build_array(OLD.delay_reason, NEW.delay_reason) END,
        'delay_reason_note', CASE WHEN OLD.delay_reason_note IS DISTINCT FROM NEW.delay_reason_note THEN jsonb_build_array(OLD.delay_reason_note, NEW.delay_reason_note) END,
        'submitted_for_review_at', CASE WHEN OLD.submitted_for_review_at IS DISTINCT FROM NEW.submitted_for_review_at THEN jsonb_build_array(OLD.submitted_for_review_at, NEW.submitted_for_review_at) END,
        'reviewed_at', CASE WHEN OLD.reviewed_at IS DISTINCT FROM NEW.reviewed_at THEN jsonb_build_array(OLD.reviewed_at, NEW.reviewed_at) END,
        'reviewed_by', CASE WHEN OLD.reviewed_by IS DISTINCT FROM NEW.reviewed_by THEN jsonb_build_array(OLD.reviewed_by, NEW.reviewed_by) END
      ))
    );
  END IF;
  _actor := auth.uid();
  SELECT full_name INTO _actor_name FROM public.profiles WHERE id = _actor;
  INSERT INTO public.employee_task_events(task_id, actor_id, actor_name, event_type, details)
  VALUES (NEW.id, _actor, _actor_name, _event, _details);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_audit_employee_task_change ON public.employee_tasks;
CREATE TRIGGER trg_audit_employee_task_change AFTER INSERT OR UPDATE ON public.employee_tasks
  FOR EACH ROW EXECUTE FUNCTION public.audit_employee_task_change();

CREATE OR REPLACE FUNCTION public.audit_task_checklist_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _row public.task_checklist_items%ROWTYPE;
  _event text;
BEGIN
  IF TG_OP = 'DELETE' THEN _row := OLD; ELSE _row := NEW; END IF;
  _event := CASE WHEN TG_OP = 'INSERT' THEN 'checklist_added' WHEN TG_OP = 'DELETE' THEN 'checklist_removed' ELSE 'checklist_updated' END;
  IF TG_OP = 'UPDATE' AND OLD.is_completed IS DISTINCT FROM NEW.is_completed THEN
    _event := CASE WHEN NEW.is_completed THEN 'checklist_completed' ELSE 'checklist_reopened' END;
  END IF;
  INSERT INTO public.employee_task_events(task_id, actor_id, actor_name, event_type, details)
  SELECT _row.task_id, auth.uid(), profile.full_name, _event,
    jsonb_build_object('item', _row.label, 'is_completed', _row.is_completed)
  FROM (SELECT 1) AS source
  LEFT JOIN public.profiles profile ON profile.id = auth.uid();
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
DROP TRIGGER IF EXISTS trg_audit_task_checklist_change ON public.task_checklist_items;
CREATE TRIGGER trg_audit_task_checklist_change AFTER INSERT OR UPDATE OR DELETE ON public.task_checklist_items
  FOR EACH ROW EXECUTE FUNCTION public.audit_task_checklist_change();

-- Private proof files are stored by task ID; the same task visibility scope controls reads and uploads.
INSERT INTO storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
VALUES ('task-evidence', 'task-evidence', false, 20971520, ARRAY['application/pdf','image/jpeg','image/png','image/webp','text/plain'])
ON CONFLICT (id) DO NOTHING;
DROP POLICY IF EXISTS "work task evidence read" ON storage.objects;
CREATE POLICY "work task evidence read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'task-evidence' AND CASE WHEN split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN public.can_access_work_task(split_part(name, '/', 1)::uuid) ELSE false END);
DROP POLICY IF EXISTS "work task evidence upload" ON storage.objects;
CREATE POLICY "work task evidence upload" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'task-evidence' AND CASE WHEN split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN public.can_access_work_task(split_part(name, '/', 1)::uuid) ELSE false END);

CREATE OR REPLACE FUNCTION public.create_work_task_assignments(
  _department_id uuid,
  _employee_ids uuid[],
  _task_date date,
  _due_date date,
  _title text,
  _description text,
  _manager_note text,
  _priority text,
  _closing_requirement text,
  _require_review boolean,
  _checklist_items text[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _employee_id uuid;
  _task_id uuid;
  _count integer := 0;
  _expected_count integer;
  _item text;
  _sort integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول أولاً'; END IF;
  IF NOT (
    public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'hr')
    OR public.has_role(auth.uid(), 'supervisor')
    OR public.can_access_department(auth.uid(), _department_id)
  ) THEN RAISE EXCEPTION 'لا تملك صلاحية إسناد مهام لهذا القسم'; END IF;
  IF char_length(trim(coalesce(_title, ''))) NOT BETWEEN 2 AND 200 THEN RAISE EXCEPTION 'عنوان المهمة غير صالح'; END IF;
  IF _due_date IS NOT NULL AND _due_date < _task_date THEN RAISE EXCEPTION 'الموعد النهائي قبل تاريخ المهمة'; END IF;
  IF _priority IS NULL OR _priority NOT IN ('low', 'normal', 'high', 'urgent') THEN RAISE EXCEPTION 'أولوية المهمة غير صحيحة'; END IF;
  IF _closing_requirement IS NULL OR _closing_requirement NOT IN ('none', 'note', 'file', 'attachment', 'link', 'result') THEN RAISE EXCEPTION 'متطلب الإغلاق غير صحيح'; END IF;
  IF coalesce(array_length(_employee_ids, 1), 0) = 0 THEN RAISE EXCEPTION 'اختر موظفاً واحداً على الأقل'; END IF;
  IF coalesce(array_length(_checklist_items, 1), 0) > 50 THEN RAISE EXCEPTION 'قائمة التحقق لا تتجاوز 50 عنصراً'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(coalesce(_checklist_items, ARRAY[]::text[])) AS checklist(item) WHERE char_length(trim(item)) NOT BETWEEN 1 AND 240) THEN
    RAISE EXCEPTION 'أحد عناصر قائمة التحقق غير صالح';
  END IF;

  SELECT count(DISTINCT employee.id) INTO _expected_count
  FROM public.employees employee
  WHERE employee.id = ANY(_employee_ids)
    AND employee.department_id = _department_id
    AND employee.status = 'active';
  IF _expected_count <> cardinality(_employee_ids) THEN
    RAISE EXCEPTION 'تحتوي القائمة على موظف غير نشط أو خارج القسم المسموح';
  END IF;

  FOREACH _employee_id IN ARRAY _employee_ids LOOP
    INSERT INTO public.employee_tasks(
      employee_id, department_id, task_date, start_date, due_date, title, description,
      manager_note, status, duration_minutes, created_by, task_type, priority,
      assignment_source, closing_requirement, require_review
    ) VALUES (
      _employee_id, _department_id, _task_date, _task_date, _due_date, trim(_title),
      nullif(trim(coalesce(_description, '')), ''), nullif(trim(coalesce(_manager_note, '')), ''),
      'not_started', 0, auth.uid(), 'one_time', _priority, 'assigned', _closing_requirement, _require_review
    ) RETURNING id INTO _task_id;
    _sort := 0;
    FOREACH _item IN ARRAY coalesce(_checklist_items, ARRAY[]::text[]) LOOP
      INSERT INTO public.task_checklist_items(task_id, label, sort_order, created_by)
      VALUES (_task_id, trim(_item), _sort, auth.uid());
      _sort := _sort + 1;
    END LOOP;
    _count := _count + 1;
  END LOOP;
  RETURN _count;
END;
$$;
REVOKE ALL ON FUNCTION public.create_work_task_assignments(uuid, uuid[], date, date, text, text, text, text, text, boolean, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_work_task_assignments(uuid, uuid[], date, date, text, text, text, text, text, boolean, text[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.send_work_guidance(
  _department_id uuid,
  _employee_ids uuid[],
  _title text,
  _content text,
  _guidance_date date,
  _create_task boolean,
  _task_due_date date,
  _task_priority text
)
RETURNS TABLE(guidances_sent integer, tasks_created integer, unlinked_employees integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _employee_id uuid;
  _target_user_id uuid;
  _guidance_id uuid;
  _expected_count integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول أولاً'; END IF;
  IF NOT (
    public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'hr')
    OR public.has_role(auth.uid(), 'supervisor')
    OR public.can_access_department(auth.uid(), _department_id)
  ) THEN RAISE EXCEPTION 'لا تملك صلاحية إرسال توجيه لهذا القسم'; END IF;
  IF char_length(trim(coalesce(_title, ''))) < 2 OR char_length(trim(coalesce(_content, ''))) = 0 THEN
    RAISE EXCEPTION 'أدخل عنوان التوجيه ونصه';
  END IF;
  IF coalesce(array_length(_employee_ids, 1), 0) = 0 THEN RAISE EXCEPTION 'اختر مستلماً واحداً على الأقل'; END IF;
  IF _create_task AND _task_due_date IS NOT NULL AND _task_due_date < _guidance_date THEN
    RAISE EXCEPTION 'موعد تنفيذ التوجيه يسبق تاريخ التوجيه';
  END IF;
  IF _task_priority IS NULL OR _task_priority NOT IN ('low', 'normal', 'high', 'urgent') THEN
    RAISE EXCEPTION 'أولوية المهمة غير صحيحة';
  END IF;

  SELECT count(DISTINCT employee.id) INTO _expected_count
  FROM public.employees employee
  WHERE employee.id = ANY(_employee_ids)
    AND employee.department_id = _department_id
    AND employee.status = 'active';
  IF _expected_count <> cardinality(_employee_ids) THEN
    RAISE EXCEPTION 'تحتوي القائمة على موظف غير نشط أو خارج القسم المسموح';
  END IF;

  guidances_sent := 0;
  tasks_created := 0;
  unlinked_employees := 0;
  FOREACH _employee_id IN ARRAY _employee_ids LOOP
    _target_user_id := public.employee_user_id(_employee_id);
    _guidance_id := NULL;
    IF _target_user_id IS NOT NULL THEN
      INSERT INTO public.employee_guidance_notes(
        department_id, target_user_id, target_employee_id, title, content, guidance_date, author_id
      ) VALUES (
        _department_id, _target_user_id, _employee_id, trim(_title), trim(_content), _guidance_date, auth.uid()
      ) RETURNING id INTO _guidance_id;
      guidances_sent := guidances_sent + 1;
    ELSE
      unlinked_employees := unlinked_employees + 1;
    END IF;

    IF _create_task THEN
      INSERT INTO public.employee_tasks(
        employee_id, department_id, task_date, start_date, due_date, title, description,
        status, duration_minutes, created_by, task_type, priority, assignment_source,
        require_review, guidance_id
      ) VALUES (
        _employee_id, _department_id, _guidance_date, _guidance_date, _task_due_date,
        'تنفيذ التوجيه: ' || trim(_title), trim(_content), 'not_started', 0, auth.uid(),
        'one_time', _task_priority, 'assigned', true, _guidance_id
      );
      tasks_created := tasks_created + 1;
    END IF;
  END LOOP;
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.send_work_guidance(uuid, uuid[], text, text, date, boolean, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.send_work_guidance(uuid, uuid[], text, text, date, boolean, date, text) TO authenticated;
