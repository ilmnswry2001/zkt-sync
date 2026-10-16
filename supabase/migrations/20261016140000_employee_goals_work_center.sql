-- Employee goals, employee proposals, and immutable progress/history records.
CREATE TABLE public.employee_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  department_id uuid NOT NULL REFERENCES public.departments(id) ON DELETE RESTRICT,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (char_length(trim(title)) BETWEEN 2 AND 200),
  description text,
  desired_result text,
  category text NOT NULL DEFAULT 'custom',
  status text NOT NULL DEFAULT 'approved' CHECK (status IN ('draft','pending_review','needs_changes','rejected','approved','in_progress','at_risk','completed_pending_review','completed','incomplete','cancelled','postponed')),
  start_date date NOT NULL DEFAULT CURRENT_DATE,
  due_date date NOT NULL,
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  success_metric text,
  target_value numeric,
  current_value numeric,
  unit text,
  tracking_methods text[] NOT NULL DEFAULT ARRAY['periodic'],
  tracking_frequency text NOT NULL DEFAULT 'weekly',
  reminder_days_before smallint NOT NULL DEFAULT 3 CHECK (reminder_days_before BETWEEN 0 AND 30),
  reminders_enabled boolean NOT NULL DEFAULT true,
  action_plan text,
  support_needed text,
  manager_note text,
  proposal_reason text,
  proposal_original jsonb,
  manager_feedback text,
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  completion_requested_at timestamptz,
  manager_rating smallint CHECK (manager_rating IS NULL OR manager_rating BETWEEN 1 AND 5),
  manager_evaluation text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (due_date >= start_date),
  CHECK (cardinality(tracking_methods) > 0),
  CHECK (target_value IS NULL OR target_value > 0)
);
CREATE INDEX employee_goals_employee_status_idx ON public.employee_goals(employee_id, status, due_date);
CREATE INDEX employee_goals_department_due_idx ON public.employee_goals(department_id, due_date, status);

CREATE TABLE public.employee_goal_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id uuid NOT NULL REFERENCES public.employee_goals(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(trim(title)) BETWEEN 1 AND 240),
  due_date date,
  status text NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started','in_progress','completed','cancelled')),
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX employee_goal_steps_goal_idx ON public.employee_goal_steps(goal_id, sort_order);

CREATE TABLE public.employee_goal_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id uuid NOT NULL REFERENCES public.employee_goals(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT,
  update_type text NOT NULL DEFAULT 'progress' CHECK (update_type IN ('progress','manager_comment','evaluation')),
  progress_percent numeric CHECK (progress_percent IS NULL OR progress_percent BETWEEN 0 AND 100),
  current_value numeric,
  completed_work text,
  remaining_work text,
  obstacles text,
  help_requested text,
  note text,
  proof_storage_path text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX employee_goal_updates_goal_idx ON public.employee_goal_updates(goal_id, created_at DESC);

CREATE TABLE public.employee_goal_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id uuid NOT NULL REFERENCES public.employee_goals(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  old_values jsonb,
  new_values jsonb,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX employee_goal_events_goal_idx ON public.employee_goal_events(goal_id, created_at DESC);

CREATE TABLE public.employee_goal_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  goal_id uuid NOT NULL REFERENCES public.employee_goals(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL,
  notification_key text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, goal_id, title, created_at)
);
CREATE INDEX employee_goal_notifications_user_idx ON public.employee_goal_notifications(user_id, created_at DESC);
CREATE UNIQUE INDEX employee_goal_notifications_dedupe_idx ON public.employee_goal_notifications(user_id, notification_key) WHERE notification_key IS NOT NULL;

ALTER TABLE public.employee_tasks ADD COLUMN goal_id uuid REFERENCES public.employee_goals(id) ON DELETE SET NULL;
CREATE INDEX employee_tasks_goal_idx ON public.employee_tasks(goal_id) WHERE goal_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.can_access_employee_goal(_goal_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.employee_goals g
    WHERE g.id = _goal_id AND (
      g.employee_id = public.current_employee_id()
      OR public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'hr')
      OR ((public.has_role(auth.uid(), 'department_manager') OR public.has_role(auth.uid(), 'supervisor')) AND g.department_id IS NOT NULL AND public.can_access_department(auth.uid(), g.department_id))
    )
  );
$$;
CREATE OR REPLACE FUNCTION public.can_manage_employee_goal(_goal_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.employee_goals g
    WHERE g.id = _goal_id AND (public.current_employee_id() IS NULL OR g.employee_id <> public.current_employee_id()) AND (
      public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'hr')
      OR ((public.has_role(auth.uid(), 'department_manager') OR public.has_role(auth.uid(), 'supervisor')) AND g.department_id IS NOT NULL AND public.can_access_department(auth.uid(), g.department_id))
    )
  );
$$;
REVOKE ALL ON FUNCTION public.can_access_employee_goal(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_manage_employee_goal(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_employee_goal(uuid), public.can_manage_employee_goal(uuid) TO authenticated;

ALTER TABLE public.employee_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_goal_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_goal_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_goal_events ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.employee_goals TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_goal_steps TO authenticated;
GRANT SELECT, INSERT ON public.employee_goal_updates TO authenticated;
GRANT SELECT ON public.employee_goal_events TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.employee_goal_events FROM authenticated;
REVOKE UPDATE, DELETE ON public.employee_goal_updates FROM authenticated;
GRANT ALL ON public.employee_goals, public.employee_goal_steps, public.employee_goal_updates, public.employee_goal_events, public.employee_goal_notifications TO service_role;

CREATE POLICY employee_goals_read_scope ON public.employee_goals FOR SELECT TO authenticated
  USING (employee_id = public.current_employee_id() OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'hr') OR ((public.has_role(auth.uid(),'department_manager') OR public.has_role(auth.uid(),'supervisor')) AND public.can_access_department(auth.uid(),department_id)));
CREATE POLICY employee_goals_create_manager ON public.employee_goals FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND (public.current_employee_id() IS NULL OR employee_id <> public.current_employee_id()) AND status = 'approved' AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'hr') OR ((public.has_role(auth.uid(),'department_manager') OR public.has_role(auth.uid(),'supervisor')) AND public.can_access_department(auth.uid(),department_id))));
CREATE POLICY employee_goals_propose_self ON public.employee_goals FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND employee_id = public.current_employee_id() AND status = 'pending_review' AND proposal_original IS NOT NULL);
CREATE POLICY employee_goals_manage_scope ON public.employee_goals FOR UPDATE TO authenticated
  USING ((public.current_employee_id() IS NULL OR employee_id <> public.current_employee_id()) AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'hr') OR ((public.has_role(auth.uid(),'department_manager') OR public.has_role(auth.uid(),'supervisor')) AND public.can_access_department(auth.uid(),department_id))))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'hr') OR ((public.has_role(auth.uid(),'department_manager') OR public.has_role(auth.uid(),'supervisor')) AND public.can_access_department(auth.uid(),department_id)));
CREATE POLICY employee_goals_edit_own_proposal ON public.employee_goals FOR UPDATE TO authenticated
  USING (created_by = auth.uid() AND employee_id = public.current_employee_id() AND status = 'needs_changes')
  WITH CHECK (created_by = auth.uid() AND employee_id = public.current_employee_id() AND status = 'pending_review');
CREATE POLICY employee_goals_update_own_progress ON public.employee_goals FOR UPDATE TO authenticated
  USING (employee_id = public.current_employee_id() AND status IN ('approved','in_progress','at_risk'))
  WITH CHECK (employee_id = public.current_employee_id() AND status IN ('approved','in_progress','at_risk','completed_pending_review'));
CREATE POLICY employee_goal_steps_read ON public.employee_goal_steps FOR SELECT TO authenticated USING (public.can_access_employee_goal(goal_id));
CREATE POLICY employee_goal_steps_manage ON public.employee_goal_steps FOR ALL TO authenticated USING (public.can_manage_employee_goal(goal_id)) WITH CHECK (public.can_manage_employee_goal(goal_id));
CREATE POLICY employee_goal_updates_read ON public.employee_goal_updates FOR SELECT TO authenticated USING (public.can_access_employee_goal(goal_id));
CREATE POLICY employee_goal_updates_add ON public.employee_goal_updates FOR INSERT TO authenticated WITH CHECK (
  actor_id = auth.uid() AND public.can_access_employee_goal(goal_id)
  AND (update_type <> 'progress' OR EXISTS (SELECT 1 FROM public.employee_goals g WHERE g.id=goal_id AND g.employee_id=public.current_employee_id()))
  AND (update_type = 'progress' OR public.can_manage_employee_goal(goal_id))
);
CREATE POLICY employee_goal_events_read ON public.employee_goal_events FOR SELECT TO authenticated USING (public.can_access_employee_goal(goal_id));

CREATE OR REPLACE FUNCTION public.log_employee_goal_changes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.employee_goal_events(goal_id, actor_id, event_type, new_values)
    VALUES (NEW.id, auth.uid(), CASE WHEN NEW.status='pending_review' THEN 'proposed' ELSE 'created' END, to_jsonb(NEW));
    RETURN NEW;
  END IF;
  IF OLD IS DISTINCT FROM NEW THEN
    INSERT INTO public.employee_goal_events(goal_id, actor_id, event_type, old_values, new_values, reason)
    VALUES (NEW.id, auth.uid(), CASE WHEN NEW.status IS DISTINCT FROM OLD.status THEN NEW.status ELSE 'updated' END,
      to_jsonb(OLD), to_jsonb(NEW), NEW.manager_feedback);
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION public.guard_employee_goal_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  NEW.updated_at := now();
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.employee_id IS DISTINCT FROM OLD.employee_id OR NEW.department_id IS DISTINCT FROM OLD.department_id
    OR NEW.proposal_original IS DISTINCT FROM OLD.proposal_original THEN
    RAISE EXCEPTION 'لا يمكن تغيير الموظف أو القسم أو نسخة الاقتراح الأصلية';
  END IF;
  IF NEW.status = 'completed' AND OLD.status NOT IN ('completed_pending_review','completed') THEN
    RAISE EXCEPTION 'يجب إرسال الإنجاز للمراجعة قبل اعتماده';
  END IF;
  IF NEW.status = 'completed_pending_review' AND OLD.status IS DISTINCT FROM 'completed_pending_review'
    AND OLD.employee_id IS DISTINCT FROM public.current_employee_id() THEN
    RAISE EXCEPTION 'يرفع الموظف المسند إليه طلب تقييم الإنجاز';
  END IF;
  IF NEW.status IN ('rejected','needs_changes') AND OLD.status IS DISTINCT FROM 'pending_review' THEN
    RAISE EXCEPTION 'لا يمكن رفض أو إعادة هدف إلا إذا كان بانتظار المراجعة';
  END IF;
  IF NEW.status = 'incomplete' AND (OLD.due_date >= (now() AT TIME ZONE 'Asia/Baghdad')::date) THEN
    RAISE EXCEPTION 'لا يمكن تسجيل الهدف غير مكتمل قبل انتهاء موعده';
  END IF;
  IF NEW.status IN ('cancelled','postponed','at_risk','incomplete') AND NEW.status IS DISTINCT FROM OLD.status
    AND coalesce(trim(NEW.manager_feedback),'') = '' THEN
    RAISE EXCEPTION 'سجل سبب تغيير حالة الهدف';
  END IF;
  IF (NEW.manager_rating IS DISTINCT FROM OLD.manager_rating OR NEW.manager_evaluation IS DISTINCT FROM OLD.manager_evaluation)
    AND NEW.status <> 'completed' THEN
    RAISE EXCEPTION 'يُسجل تقييم المدير عند اعتماد الإنجاز فقط';
  END IF;
  IF NEW.status = 'completed_pending_review' AND OLD.status IS DISTINCT FROM 'completed_pending_review'
    AND OLD.employee_id = public.current_employee_id()
    AND NOT EXISTS (
      SELECT 1 FROM public.employee_goal_updates u
      WHERE u.goal_id=OLD.id AND u.update_type='progress'
        AND (u.progress_percent >= 100 OR (OLD.target_value IS NOT NULL AND coalesce(NEW.current_value,OLD.current_value) >= OLD.target_value))
    ) THEN RAISE EXCEPTION 'سجل إنجازاً بنسبة 100% أو بلغ القيمة المستهدفة قبل طلب التقييم';
  END IF;
  IF NEW.status = 'approved' AND OLD.status = 'pending_review' THEN
    IF OLD.created_by = auth.uid() THEN RAISE EXCEPTION 'لا يمكن اعتماد اقتراحك بنفسك'; END IF;
    NEW.approved_by := auth.uid(); NEW.approved_at := now();
  ELSIF NEW.status = 'completed' AND OLD.status = 'completed_pending_review' THEN
    IF NEW.manager_rating IS NULL OR coalesce(trim(NEW.manager_evaluation),'') = '' THEN RAISE EXCEPTION 'أدخل تقييم الإنجاز وملاحظاته'; END IF;
    NEW.approved_by := auth.uid(); NEW.approved_at := now();
  ELSIF NEW.status IN ('rejected','needs_changes') AND OLD.status = 'pending_review' THEN
    IF OLD.created_by = auth.uid() THEN RAISE EXCEPTION 'لا يمكن مراجعة اقتراحك بنفسك'; END IF;
    IF coalesce(trim(NEW.manager_feedback),'') = '' THEN RAISE EXCEPTION 'أدخل ملاحظة المراجعة'; END IF;
  ELSIF OLD.created_by = auth.uid() AND OLD.employee_id = public.current_employee_id() AND OLD.status = 'needs_changes' THEN
    IF NEW.status <> 'pending_review' OR NEW.id IS DISTINCT FROM OLD.id OR NEW.created_by IS DISTINCT FROM OLD.created_by
      OR NEW.employee_id IS DISTINCT FROM OLD.employee_id OR NEW.department_id IS DISTINCT FROM OLD.department_id
      OR NEW.proposal_original IS DISTINCT FROM OLD.proposal_original OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
      OR NEW.approved_at IS DISTINCT FROM OLD.approved_at OR NEW.manager_feedback IS DISTINCT FROM OLD.manager_feedback THEN
      RAISE EXCEPTION 'يمكنك تعديل بيانات الاقتراح وإعادة إرساله فقط';
    END IF;
  ELSIF OLD.employee_id = public.current_employee_id() AND OLD.status IN ('approved','in_progress','at_risk') THEN
    IF NEW.title IS DISTINCT FROM OLD.title OR NEW.description IS DISTINCT FROM OLD.description
      OR NEW.desired_result IS DISTINCT FROM OLD.desired_result OR NEW.category IS DISTINCT FROM OLD.category
      OR NEW.department_id IS DISTINCT FROM OLD.department_id OR NEW.employee_id IS DISTINCT FROM OLD.employee_id
      OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.due_date IS DISTINCT FROM OLD.due_date
      OR NEW.start_date IS DISTINCT FROM OLD.start_date OR NEW.priority IS DISTINCT FROM OLD.priority
      OR NEW.success_metric IS DISTINCT FROM OLD.success_metric OR NEW.target_value IS DISTINCT FROM OLD.target_value
      OR NEW.unit IS DISTINCT FROM OLD.unit OR NEW.tracking_methods IS DISTINCT FROM OLD.tracking_methods
      OR NEW.tracking_frequency IS DISTINCT FROM OLD.tracking_frequency OR NEW.action_plan IS DISTINCT FROM OLD.action_plan
      OR NEW.support_needed IS DISTINCT FROM OLD.support_needed OR NEW.manager_note IS DISTINCT FROM OLD.manager_note
      OR NEW.proposal_reason IS DISTINCT FROM OLD.proposal_reason OR NEW.proposal_original IS DISTINCT FROM OLD.proposal_original
      OR NEW.manager_feedback IS DISTINCT FROM OLD.manager_feedback OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
      OR NEW.approved_at IS DISTINCT FROM OLD.approved_at OR NEW.completion_requested_at IS DISTINCT FROM OLD.completion_requested_at
      OR NEW.manager_rating IS DISTINCT FROM OLD.manager_rating OR NEW.manager_evaluation IS DISTINCT FROM OLD.manager_evaluation
      OR NEW.reminder_days_before IS DISTINCT FROM OLD.reminder_days_before OR NEW.reminders_enabled IS DISTINCT FROM OLD.reminders_enabled
      OR NEW.status NOT IN ('approved','in_progress','at_risk','completed_pending_review') THEN
      RAISE EXCEPTION 'لا تملك صلاحية تعديل معايير الهدف المعتمد';
    END IF;
    IF NEW.status = 'completed_pending_review' THEN NEW.completion_requested_at := now(); END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER employee_goals_guard BEFORE UPDATE ON public.employee_goals
  FOR EACH ROW EXECUTE FUNCTION public.guard_employee_goal_update();
CREATE TRIGGER employee_goals_audit AFTER INSERT OR UPDATE ON public.employee_goals
  FOR EACH ROW EXECUTE FUNCTION public.log_employee_goal_changes();

ALTER TABLE public.employee_goal_notifications ENABLE ROW LEVEL SECURITY;
GRANT SELECT, UPDATE (read_at) ON public.employee_goal_notifications TO authenticated;
CREATE POLICY employee_goal_notifications_read ON public.employee_goal_notifications FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY employee_goal_notifications_mark_read ON public.employee_goal_notifications FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.notify_employee_goal_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  _employee_user uuid;
  _manager_user uuid;
  _title text;
  _body text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'approved' THEN
      _employee_user := public.employee_user_id(NEW.employee_id);
      IF _employee_user IS NOT NULL AND _employee_user <> auth.uid() THEN
        INSERT INTO public.employee_goal_notifications(user_id,goal_id,title,body,notification_key)
        VALUES (_employee_user,NEW.id,'هدف جديد','تم إسناد الهدف: '||NEW.title,'created:'||NEW.id::text) ON CONFLICT DO NOTHING;
      END IF;
    ELSIF NEW.status = 'pending_review' THEN
      SELECT dm.user_id INTO _manager_user FROM public.department_managers dm WHERE dm.department_id=NEW.department_id ORDER BY dm.created_at LIMIT 1;
      _manager_user := coalesce(_manager_user,(SELECT d.manager_user_id FROM public.departments d WHERE d.id=NEW.department_id));
      IF _manager_user IS NOT NULL THEN
        INSERT INTO public.employee_goal_notifications(user_id,goal_id,title,body,notification_key)
        VALUES (_manager_user,NEW.id,'اقتراح هدف جديد','أرسل الموظف اقتراح الهدف: '||NEW.title,'proposal:'||NEW.id::text) ON CONFLICT DO NOTHING;
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    _employee_user := public.employee_user_id(NEW.employee_id);
    _title := CASE NEW.status WHEN 'approved' THEN 'تم اعتماد الهدف' WHEN 'needs_changes' THEN 'الهدف بحاجة إلى تعديل' WHEN 'rejected' THEN 'تم رفض اقتراح الهدف' WHEN 'completed' THEN 'تم اعتماد الإنجاز' WHEN 'completed_pending_review' THEN 'الهدف بانتظار التقييم' ELSE 'تحديث حالة الهدف' END;
    _body := NEW.title || coalesce(' · '||NEW.manager_feedback,'');
    IF _employee_user IS NOT NULL AND _employee_user <> auth.uid() THEN
      INSERT INTO public.employee_goal_notifications(user_id,goal_id,title,body,notification_key) VALUES (_employee_user,NEW.id,_title,_body,'status:'||NEW.id::text||':'||NEW.status) ON CONFLICT DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER employee_goals_notify AFTER INSERT OR UPDATE ON public.employee_goals
  FOR EACH ROW EXECUTE FUNCTION public.notify_employee_goal_change();

CREATE OR REPLACE FUNCTION public.notify_employee_goal_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE _goal public.employee_goals%ROWTYPE; _recipient uuid;
BEGIN
  SELECT * INTO _goal FROM public.employee_goals WHERE id=NEW.goal_id;
  IF NEW.update_type IN ('manager_comment','evaluation') THEN
    _recipient := public.employee_user_id(_goal.employee_id);
  ELSE
    SELECT dm.user_id INTO _recipient FROM public.department_managers dm WHERE dm.department_id=_goal.department_id ORDER BY dm.created_at LIMIT 1;
    _recipient := coalesce(_recipient,(SELECT d.manager_user_id FROM public.departments d WHERE d.id=_goal.department_id));
  END IF;
  IF _recipient IS NOT NULL AND _recipient <> auth.uid() THEN
    INSERT INTO public.employee_goal_notifications(user_id,goal_id,title,body,notification_key)
    VALUES (_recipient,_goal.id,
      CASE NEW.update_type WHEN 'manager_comment' THEN 'تعليق جديد من المدير' WHEN 'evaluation' THEN 'تقييم جديد للهدف' ELSE 'تحديث تقدم جديد' END,
      coalesce(NEW.note,NEW.help_requested,NEW.completed_work,_goal.title),
      'update:'||NEW.id::text) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER employee_goal_updates_notify AFTER INSERT ON public.employee_goal_updates
  FOR EACH ROW EXECUTE FUNCTION public.notify_employee_goal_update();

CREATE OR REPLACE FUNCTION public.create_employee_goal_task(_goal_id uuid, _title text, _description text DEFAULT NULL, _due_date date DEFAULT NULL, _priority text DEFAULT 'normal')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE _goal public.employee_goals%ROWTYPE; _task_id uuid;
BEGIN
  IF NOT public.can_manage_employee_goal(_goal_id) THEN RAISE EXCEPTION 'لا تملك صلاحية إنشاء مهمة لهذا الهدف'; END IF;
  SELECT * INTO _goal FROM public.employee_goals WHERE id=_goal_id;
  INSERT INTO public.employee_tasks(employee_id,department_id,task_date,start_date,due_date,title,description,status,duration_minutes,created_by,task_type,priority,assignment_source,closing_requirement,require_review,goal_id)
  VALUES (_goal.employee_id,_goal.department_id,CURRENT_DATE,CURRENT_DATE,coalesce(_due_date,_goal.due_date),trim(_title),_description,'not_started',0,auth.uid(),'one_time',_priority,'assigned','none',false,_goal.id)
  RETURNING id INTO _task_id;
  RETURN _task_id;
END;
$$;
REVOKE ALL ON FUNCTION public.create_employee_goal_task(uuid,text,text,date,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_employee_goal_task(uuid,text,text,date,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.generate_employee_goal_reminders()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE _count integer := 0; _added integer := 0; _today date := (now() AT TIME ZONE 'Asia/Baghdad')::date;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'يلزم تسجيل الدخول'; END IF;
  INSERT INTO public.employee_goal_notifications(user_id,goal_id,title,body,notification_key)
  SELECT auth.uid(),g.id,
    CASE WHEN g.due_date < _today THEN 'هدف متأخر' ELSE 'اقترب موعد الهدف' END,
    CASE WHEN g.due_date < _today THEN 'انتهى الموعد المحدد للهدف: '||g.title ELSE 'بقي على الموعد النهائي للهدف: '||g.title||' حتى '||g.due_date::text END,
    CASE WHEN g.due_date < _today THEN 'overdue:'||g.id::text||':'||g.due_date::text ELSE 'due:'||g.id::text||':'||g.due_date::text END
  FROM public.employee_goals g
  WHERE public.can_access_employee_goal(g.id) AND g.reminders_enabled
    AND g.status IN ('approved','in_progress','at_risk')
    AND (g.due_date < _today OR g.due_date BETWEEN _today AND _today + g.reminder_days_before)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS _count = ROW_COUNT;
  INSERT INTO public.employee_goal_notifications(user_id,goal_id,title,body,notification_key)
  SELECT auth.uid(),g.id,'تحديث التقدم مستحق','حان موعد تحديث التقدم للهدف: '||g.title,
    'progress:'||g.id::text||':'||coalesce(last_update.last_at::text,g.start_date::text)
  FROM public.employee_goals g
  LEFT JOIN LATERAL (
    SELECT max(u.created_at) AS last_at FROM public.employee_goal_updates u
    WHERE u.goal_id=g.id AND u.update_type='progress'
  ) last_update ON true
  WHERE public.can_access_employee_goal(g.id) AND g.reminders_enabled
    AND g.status IN ('approved','in_progress','at_risk') AND g.start_date <= _today AND g.due_date >= _today
    AND coalesce(last_update.last_at, g.created_at) < now() - CASE g.tracking_frequency
      WHEN 'daily' THEN interval '1 day' WHEN 'monthly' THEN interval '30 days' ELSE interval '7 days' END
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS _added = ROW_COUNT;
  _count := _count + _added;
  RETURN _count;
END;
$$;
REVOKE ALL ON FUNCTION public.generate_employee_goal_reminders() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_employee_goal_reminders() TO authenticated;

CREATE OR REPLACE FUNCTION public.log_employee_goal_step_changes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE _goal_id uuid;
BEGIN
  IF TG_OP='DELETE' THEN _goal_id := OLD.goal_id; ELSE _goal_id := NEW.goal_id; END IF;
  INSERT INTO public.employee_goal_events(goal_id,actor_id,event_type,old_values,new_values)
  VALUES (_goal_id,auth.uid(),'step_'||lower(TG_OP),CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END,CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END);
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
CREATE TRIGGER employee_goal_steps_audit AFTER INSERT OR UPDATE OR DELETE ON public.employee_goal_steps
  FOR EACH ROW EXECUTE FUNCTION public.log_employee_goal_step_changes();

CREATE POLICY employee_goal_steps_update_own ON public.employee_goal_steps FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.employee_goals g WHERE g.id=goal_id AND g.employee_id=public.current_employee_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.employee_goals g WHERE g.id=goal_id AND g.employee_id=public.current_employee_id()));

CREATE OR REPLACE FUNCTION public.guard_employee_goal_step_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.can_manage_employee_goal(OLD.goal_id) AND (
    NEW.id IS DISTINCT FROM OLD.id OR NEW.goal_id IS DISTINCT FROM OLD.goal_id
    OR NEW.title IS DISTINCT FROM OLD.title OR NEW.due_date IS DISTINCT FROM OLD.due_date
    OR NEW.sort_order IS DISTINCT FROM OLD.sort_order OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.completed_at IS DISTINCT FROM OLD.completed_at
    OR NEW.status NOT IN ('not_started','in_progress','completed','cancelled')
  ) THEN RAISE EXCEPTION 'يمكن للموظف تحديث حالة المرحلة فقط'; END IF;
  IF NEW.status='completed' AND OLD.status IS DISTINCT FROM 'completed' THEN NEW.completed_at := now(); END IF;
  IF NEW.status <> 'completed' THEN NEW.completed_at := NULL; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER employee_goal_steps_guard BEFORE UPDATE ON public.employee_goal_steps
  FOR EACH ROW EXECUTE FUNCTION public.guard_employee_goal_step_update();

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES ('goal-evidence','goal-evidence',false,20971520,ARRAY['application/pdf','image/jpeg','image/png','image/webp','text/plain'])
ON CONFLICT (id) DO NOTHING;
CREATE POLICY employee_goal_evidence_read ON storage.objects FOR SELECT TO authenticated USING (
  bucket_id='goal-evidence' AND public.can_access_employee_goal(nullif(split_part(name,'/',1),'')::uuid)
);
CREATE POLICY employee_goal_evidence_upload ON storage.objects FOR INSERT TO authenticated WITH CHECK (
  bucket_id='goal-evidence' AND split_part(name,'/',2)=auth.uid()::text
  AND public.can_access_employee_goal(nullif(split_part(name,'/',1),'')::uuid)
);
